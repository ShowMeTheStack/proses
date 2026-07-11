// The thread-step machine: threads run small programs of primitive steps over shared objects, one primitive per
// step. The primitives themselves are in sync-b-ops.js; this file holds the state, the stepping, the snapshots and
// what a model checker needs (choices, clone, hash, footprints). A later C-subset interpreter can sit on the same
// primitives (S.Sync.ops) by calling them from its statements.
//
//   S.Sync.machine(spec, opts) -> M
//     spec: {threads: [{name, prog: [op | {label}], loop, iters}], mutexes: [id | {id, name}],
//            sems: [{id, name, init, binary}], conds: [id | {id, name}], rwlocks: [{id, name, policy}],
//            barriers: [{id, name, n}], vars: {name: value}, hoare, tso, sbCap (store-buffer entries, default 2)}
//       prog: a list of ops (see sync-b-ops.js); an entry {label: 'x'} names the next op, so jumps can say to: 'x'.
//       loop: the program starts again at the top when it ends; iters: and stops after that many rounds.
//       hoare: condition variables hand the monitor straight to the woken thread (the signaller waits);
//       otherwise Mesa: the woken thread queues for the mutex. tso: every thread's stores wait in its own store
//       buffer until a separate flush step makes them visible (a machine that reorders a store after a later load).
//     opts: {light: true}  steps carry no snapshot (fast, for the model checker)
//   M.step(choice) -> {t, tid, name, pc, op, obj (the mutex, semaphore, condition, lock, barrier or variable it
//     names), label, mark, kind, say, woke, state (a snapshot, unless light)}
//     mark: the op's own mark, e.g. 'progress' on the step a liveness property waits for
//     choice: a thread id; 'f' + id to flush that thread's oldest buffered store (tso only); 'c' + id + ':' + k for a
//     thread at a choose op (n choices: the value k is the schedule's to pick)
//   M.runnable() -> [tid]   M.choices() -> [choice]   M.status() -> 'running' | 'done' | 'deadlock' | 'error'
//   M.snap() -> a deep copy of the state   M.clone() -> an independent machine   M.hash() -> a string naming the state
//   M.canon() -> the same up to the symmetry of spec.symmetry ([[tid..]..]: threads no property tells apart)
//   M.footprint(choice) -> {r: [object..], w: [object..]}  what the step would read and write (for partial-order
//     reduction); M.owner(choice) -> the thread it belongs to; M.runner(choice) -> the same, or null for a flush;
//     M.local(choice) -> whether the step is invisible and touches only its thread (jump, local, think, work); M.waitFor() -> {edges, cycle}; M.failure: the last
//     error or assertion message
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});
  const LOCAL = new Set(['jump', 'local', 'think', 'work']);
  const copy = (v) => (Array.isArray(v) ? v.map(copy) : v && typeof v === 'object' ? Object.assign({}, v) : v);

  /** resolve labels: {label: 'x'} entries vanish and every jump's `to` becomes an index */
  function assemble(prog) {
    const out = [], at = {};
    for (const e of prog) { if (e && e.label !== undefined && !e.op) at[e.label] = out.length; else out.push(e); }
    return out.map((o) => (o.op === 'jump' && typeof o.to === 'string' ? Object.assign({}, o, { to: at[o.to] }) : o));
  }

  class Machine {
    constructor(spec, opts, skip) {
      this.spec = spec; this.opts = opts || {};
      this.hoare = !!spec.hoare; this.tso = !!spec.tso; this.sbCap = spec.sbCap || 2;
      if (skip) return;
      this.t = 0; this.failure = null;
      this.threads = (spec.threads || []).map((th, i) => {
        const prog = th._asm || (th._asm = assemble(th.prog));
        return { id: i, name: th.name || 'T' + i, prog, loop: !!th.loop, iters: th.iters || 0, pc: 0, state: prog.length ? 'ready' : 'done', on: null, reg: Object.assign({}, th.reg || {}), meals: 0, steps: 0, rounds: 0, cs: 0, sb: [], resume: false, reacquire: null };
      });
      this.mutex = {}; this.sem = {}; this.cond = {}; this.rw = {}; this.barrier = {}; this.vars = {};
      this.order = { mutex: [], sem: [], cond: [], rw: [], barrier: [] };
      for (const m of spec.mutexes || []) { const o = typeof m === 'string' ? { id: m } : m; this.mutex[o.id] = { id: o.id, name: o.name || o.id, owner: null, queue: [], urgent: [] }; this.order.mutex.push(o.id); }
      for (const s of spec.sems || []) { this.sem[s.id] = { id: s.id, name: s.name || s.id, value: s.init || 0, init: s.init || 0, binary: !!s.binary, queue: [] }; this.order.sem.push(s.id); }
      for (const c of spec.conds || []) { const o = typeof c === 'string' ? { id: c } : c; this.cond[o.id] = { id: o.id, name: o.name || o.id, queue: [] }; this.order.cond.push(o.id); }
      for (const r of spec.rwlocks || []) { this.rw[r.id] = { id: r.id, name: r.name || r.id, policy: r.policy || 'fair', readers: [], writer: null, queue: [] }; this.order.rw.push(r.id); }
      for (const b of spec.barriers || []) { this.barrier[b.id] = { id: b.id, name: b.name || b.id, n: b.n, waiting: [], gen: 0 }; this.order.barrier.push(b.id); }
      for (const k in spec.vars || {}) this.vars[k] = copy(spec.vars[k]);
    }
    T(tid) { return this.threads[tid]; }
    nm(tid) { return this.threads[tid].name; }
    qs(q) { return q.length ? '[' + q.map((i) => this.nm(i)).join(', ') + ']' : 'empty'; }
    /** move a thread past its current op (to the top again for a looping program, or done) */
    advance(th) {
      th.pc++;
      if (th.pc >= th.prog.length) {
        th.rounds++;
        if (th.loop && (!th.iters || th.rounds < th.iters)) th.pc = 0; else { th.state = 'done'; th.on = null; th.pc = th.prog.length; }
      }
    }
    block(th, kind, id) { th.state = 'blocked'; th.on = { kind, id }; }
    /** a blocked thread can go on: past its op, or (resume) back to where it stopped without moving */
    wake(th) { th.state = 'ready'; th.on = null; if (th.resume) th.resume = false; else this.advance(th); }
    /** the mutex passes to the next in line (a Hoare signaller first), or becomes free */
    giveMutex(mx) {
      const w = mx.urgent.length ? mx.urgent.shift() : mx.queue.length ? mx.queue.shift() : null;
      mx.owner = w;
      if (w !== null) this.wake(this.T(w));
      return w;
    }
    runnable() { return this.threads.filter((th) => th.state === 'ready').map((th) => th.id); }
    choices() {
      const c = [];
      for (const th of this.threads) {
        if (th.state !== 'ready') continue;
        const o = th.prog[th.pc];
        if (o.op === 'choose') for (let k = 0; k < o.n; k++) c.push('c' + th.id + ':' + k); else c.push(th.id);
      }
      if (this.tso) for (const th of this.threads) if (th.sb.length) c.push('f' + th.id);
      return c;
    }
    owner(choice) { return typeof choice === 'string' ? parseInt(choice.slice(1), 10) : choice; }
    runner(choice) { return typeof choice === 'string' && choice[0] === 'f' ? null : this.owner(choice); }
    status() {
      if (this.failure) return 'error';
      if (this.choices().length) return 'running';
      if (this.threads.some((th) => th.state === 'blocked')) return 'deadlock';
      return this.threads.some((th) => th.state === 'error') ? 'error' : 'done';
    }
    /** a shared variable as a thread sees it: its own newest buffered store first (tso), then memory */
    load(th, v, at) {
      for (let i = th.sb.length - 1; i >= 0; i--) { const s = th.sb[i]; if (s[0] === v && s[1] === at) return s[2]; }
      return at === null ? this.vars[v] : this.vars[v][at];
    }
    store(th, v, at, val, direct) {
      if (this.tso && !direct) {
        // a full buffer stalls the store until its oldest entry reaches memory
        if (th.sb.length >= this.sbCap) { const [v0, a0, x0] = th.sb.shift(); this.store(th, v0, a0, x0, true); }
        th.sb.push([v, at, val]); return;
      }
      if (at === null) this.vars[v] = copy(val); else this.vars[v][at] = val;
    }
    /** drain a thread's store buffer into memory (before an atomic op or a fence) */
    drain(th) { while (th.sb.length) { const [v, at, val] = th.sb.shift(); this.store(th, v, at, val, true); } }
    /** a step that touches only its own thread and changes nothing a property looks at (a jump, a local
     *  computation, thinking or working): the model checker may take it alone */
    local(choice) {
      if (typeof choice === 'string') return false;
      const th = this.T(choice), o = th.prog[th.pc];
      return !!o && LOCAL.has(o.op);
    }
    footprint(choice) {
      if (typeof choice === 'string') { if (choice[0] === 'c') return { r: [], w: [] }; const th = this.T(this.owner(choice)), s = th.sb[0]; return { r: [], w: ['v:' + s[0]] }; }
      const th = this.T(choice), o = th.prog[th.pc], d = Y.ops[o.op];
      const fp = d && d.fp ? d.fp(this, th, o) : { r: [], w: [] };
      return fp;
    }
    step(choice) {
      if (typeof choice === 'string' && choice[0] === 'c') {
        // a thread's own nondeterministic choice: the value is part of the schedule
        const th = this.T(this.owner(choice)), k = +choice.split(':')[1], o = th.prog[th.pc], pc = th.pc;
        th.reg[o.into || 'k'] = k; this.advance(th); this.t++; th.steps++;
        const r = { t: this.t, tid: th.id, name: th.name, pc, op: 'choose', label: o.label || null, mark: o.mark || null, kind: 'choose', say: o.say ? o.say(k, th) : `${th.name} chooses \`${k}\`${o.label ? ' (' + o.label + ')' : ''}.` };
        if (!this.opts.light) r.state = this.snap();
        return r;
      }
      if (typeof choice === 'string') {
        const th = this.T(this.owner(choice));
        if (!th.sb.length) throw new Error(th.name + ' has nothing to flush');
        const [v, at, val] = th.sb.shift();
        this.store(th, v, at, val, true);
        this.t++;
        const r = { t: this.t, tid: th.id, name: th.name, pc: th.pc, op: 'flush', label: null, kind: 'flush', say: `${th.name}'s buffered store of \`${val}\` to ${v}${at === null ? '' : '[' + at + ']'} reaches memory, where other threads can see it.` };
        if (!this.opts.light) r.state = this.snap();
        return r;
      }
      const th = this.T(choice);
      if (!th || th.state !== 'ready') throw new Error('thread ' + choice + ' cannot run now');
      const o = th.prog[th.pc], pc = th.pc, d = Y.ops[o.op];
      if (!d) throw new Error('unknown op ' + o.op);
      const obj = typeof o.m === 'function' ? Y.mid(o, th) : o.m || o.s || o.c || o.l || o.b || o.v || null;
      const r = d.run(this, th, o);
      if (r.kind === 'error' || r.kind === 'assert') { th.state = 'error'; th.on = null; this.failure = r.say; }
      this.t++; th.steps++;
      const out = Object.assign({ t: this.t, tid: th.id, name: th.name, pc, op: o.op, obj, label: o.label || null, mark: o.mark || null }, r);
      if (!this.opts.light) out.state = this.snap();
      return out;
    }
    /** the wait-for graph: a thread blocked on a mutex (or a write lock) points at its owner */
    waitFor() {
      const edges = [];
      for (const th of this.threads) {
        if (th.state !== 'blocked' || !th.on) continue;
        if (th.on.kind === 'mutex') { const mx = this.mutex[th.on.id]; if (mx.owner !== null) edges.push({ from: th.id, to: mx.owner, via: mx.id }); }
        if (th.on.kind === 'rw') { const l = this.rw[th.on.id]; for (const h of l.writer !== null ? [l.writer] : l.readers) if (h !== th.id) edges.push({ from: th.id, to: h, via: l.id }); }
      }
      const next = new Map();
      for (const e of edges) if (!next.has(e.from)) next.set(e.from, e);
      let cycle = null;
      for (const th of this.threads) {
        if (cycle) break;
        const seen = new Set(); let at = th.id;
        while (next.has(at) && !seen.has(at)) { seen.add(at); at = next.get(at).to; }
        if (seen.has(at)) {
          cycle = []; let u = at;
          do { const e = next.get(u), obj = this.mutex[e.via] || this.rw[e.via]; cycle.push({ tid: u, on: { kind: 'mutex', id: e.via, name: obj.name }, holder: e.to }); u = e.to; } while (u !== at);
        }
      }
      return { edges, cycle };
    }
    snap() {
      const o = this.order;
      return {
        t: this.t,
        threads: this.threads.map((th) => ({ id: th.id, name: th.name, pc: th.pc, state: th.state, on: th.on ? Object.assign({}, th.on) : null, meals: th.meals, steps: th.steps, rounds: th.rounds, cs: th.cs, reg: Object.assign({}, th.reg), sb: th.sb.map((s) => s.slice()) })),
        mutex: Object.fromEntries(o.mutex.map((k) => [k, { owner: this.mutex[k].owner, queue: this.mutex[k].queue.slice() }])),
        sem: Object.fromEntries(o.sem.map((k) => [k, { value: this.sem[k].value, queue: this.sem[k].queue.slice() }])),
        cond: Object.fromEntries(o.cond.map((k) => [k, { queue: this.cond[k].queue.slice() }])),
        rw: Object.fromEntries(o.rw.map((k) => [k, { readers: this.rw[k].readers.slice(), writer: this.rw[k].writer, queue: this.rw[k].queue.map((q) => Object.assign({}, q)) }])),
        barrier: Object.fromEntries(o.barrier.map((k) => [k, { waiting: this.barrier[k].waiting.slice(), gen: this.barrier[k].gen }])),
        vars: Object.fromEntries(Object.keys(this.vars).map((k) => [k, copy(this.vars[k])])),
      };
    }
    clone() {
      const M = new Machine(this.spec, this.opts, true);
      M.t = this.t; M.failure = this.failure; M.order = this.order;
      M.threads = this.threads.map((th) => Object.assign({}, th, { on: th.on && Object.assign({}, th.on), reg: Object.assign({}, th.reg), sb: th.sb.map((s) => s.slice()) }));
      const dup = (src, f) => Object.fromEntries(Object.keys(src).map((k) => [k, f(src[k])]));
      M.mutex = dup(this.mutex, (m) => Object.assign({}, m, { queue: m.queue.slice(), urgent: m.urgent.slice() }));
      M.sem = dup(this.sem, (s) => Object.assign({}, s, { queue: s.queue.slice() }));
      M.cond = dup(this.cond, (c) => Object.assign({}, c, { queue: c.queue.slice() }));
      M.rw = dup(this.rw, (r) => Object.assign({}, r, { readers: r.readers.slice(), queue: r.queue.map((q) => Object.assign({}, q)) }));
      M.barrier = dup(this.barrier, (b) => Object.assign({}, b, { waiting: b.waiting.slice() }));
      M.vars = dup(this.vars, copy);
      return M;
    }
    /** a string naming everything that decides the future: not the step counts, meal counts or the clock */
    hash(perm) {
      const P = perm ? (i) => (i === null || i === undefined ? i : perm[i]) : (i) => i;
      const regs = (r) => Object.keys(r).sort().map((k) => k + '=' + JSON.stringify(r[k])).join(',');
      const one = (x) => [x.pc, x.state[0], x.on ? x.on.kind + ':' + x.on.id : '', regs(x.reg), x.cs, x.resume ? 1 : 0, x.reacquire || '', x.iters ? x.rounds : '', JSON.stringify(x.sb)].join('|');
      let th = this.threads.map(one);
      if (perm) { const t2 = []; th.forEach((h, i) => { t2[perm[i]] = h; }); th = t2; }
      const ob = (src, f) => Object.keys(src).map((k) => f(src[k])).join(';');
      const q = (a) => a.map(P).join(',');
      return [th.join('/'), ob(this.mutex, (m) => P(m.owner) + ':' + q(m.queue) + ':' + q(m.urgent)), ob(this.sem, (s) => s.value + ':' + q(s.queue)), ob(this.cond, (c) => q(c.queue)),
        ob(this.rw, (r) => r.readers.map(P).sort().join(',') + ':' + P(r.writer) + ':' + r.queue.map((x) => P(x.tid) + x.mode)), ob(this.barrier, (b) => b.waiting.map(P).sort().join(',')), JSON.stringify(this.vars)].join('#');
    }
    /** the hash up to symmetry: threads in a group of spec.symmetry ([[tid..]..], threads with the same program
     *  that no property tells apart) are renumbered into a canonical order, so states that differ only by which
     *  of them is where count once */
    canon() {
      const groups = this.spec.symmetry;
      if (!groups) return this.hash();
      const where = this.threads.map(() => []);
      const note = (list, tag) => list.forEach((i, k) => { if (i !== null && i !== undefined) where[i].push(tag + k); });
      for (const k of Object.keys(this.mutex)) { const m = this.mutex[k]; note([m.owner], 'o' + k); note(m.queue, 'q' + k); note(m.urgent, 'u' + k); }
      for (const k of Object.keys(this.sem)) note(this.sem[k].queue, 's' + k);
      for (const k of Object.keys(this.cond)) note(this.cond[k].queue, 'c' + k);
      for (const k of Object.keys(this.rw)) { const r = this.rw[k]; note(r.readers.map(() => null), ''); r.readers.forEach((i) => where[i].push('r' + k)); note([r.writer], 'w' + k); note(r.queue.map((x) => x.tid), 'l' + k); }
      for (const k of Object.keys(this.barrier)) this.barrier[k].waiting.forEach((i) => where[i].push('b' + k));
      const perm = this.threads.map((_, i) => i);
      for (const g of groups) {
        const sig = (i) => { const x = this.threads[i]; return [x.pc, x.state, x.on ? x.on.kind + x.on.id : '', JSON.stringify(x.reg), x.cs, x.rounds, where[i].join(',')].join('|'); };
        const sorted = g.slice().sort((a, b) => (sig(a) < sig(b) ? -1 : sig(a) > sig(b) ? 1 : 0));
        sorted.forEach((old, k) => { perm[old] = g[k]; });
      }
      return this.hash(perm);
    }
  }
  Y.Machine = Machine;
  Y.assemble = assemble;
  Y.machine = (spec, opts) => new Machine(spec, opts);
})(globalThis.Proses = globalThis.Proses || {});
