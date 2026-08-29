// Part 4, threads: the families, and the helpers its topics share (S.P04). Programs are real C run on the
// simulated kernel (S.Kern, src/core/k-*.js): H.kern steps a program and records, at every step that does
// something a reader can see (a create, a join, a print, a lock, a fork, an exit), each thread's state, line and
// stack range, every global's value and every live local's address and value, read from the machine's memory
// (S.CLang). H.mapSim is a small model of user threads mapped onto kernel threads and cores, for the threading
// models, where no kernel run exists to draw from; the claims check reworks it independently.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'threads', order, title, blurb });
  fam('p04-model', 10, 'Threads and the address space', 'Several threads in one process: one copy of the code, the globals and the heap, and a stack and registers for each thread.');
  fam('p04-mapping', 20, 'User and kernel threads', 'Who schedules a thread: a library in the process or the kernel, and how user threads are mapped onto kernel threads and cores.');
  fam('p04-api', 30, 'The thread API', 'pthread_create and pthread_join, a thread\'s own copy of a variable, and stopping a thread safely.');
  fam('p04-patterns', 40, 'Pools, fork-join and implicit threading', 'Ways to put many threads to work: a fixed pool fed from a queue, splitting work and joining the parts, parallel loops, and the limit Amdahl\'s law puts on all of them.');
  fam('p04-fork', 50, 'fork and exec in a threaded program', 'fork copies only the thread that calls it, and exec ends every thread: what that does to locks and to work in progress.');

  const H = (S.P04 = {});
  /** S.topic, with the engines' `value` marks taken out of the narration (the topic player shows plain text) */
  H.topic = function (t) {
    const run = t.run;
    t.run = function (input) {
      const out = run.call(this, input), fr = Array.isArray(out) ? out : out.frames;
      for (const f of fr || []) if (f && typeof f.say === 'string') f.say = f.say.replace(/`/g, '');
      return out;
    };
    return S.topic(t);
  };
  H.HDR = '#include <stdio.h>\n#include <stdlib.h>\n#include <pthread.h>\n#include <unistd.h>\n#include <sys/wait.h>\n';
  H.plural = (k, word, many) => k + ' ' + (Number(k) === 1 ? word : many || word + 's');
  H.list = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  H.hex = (a) => '0x' + Number(a).toString(16);
  H.box = (x, y, w, h) => ({ x, y, w, h });
  H.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x, y, text, cls: cls === undefined ? 'strong' : cls }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  H.title = (key, x, y, text) => ({ key, kind: 'text', x, y, text, cls: 'title' });
  H.def = (title, lines) => ({ sections: [{ id: 'd', kind: 'math', title, text: lines.join('\n') }] });
  H.pcls = (k) => 'p' + (((k % 6) + 6) % 6);
  const QUIET = new Set(['step', 'buffer', 'sleep', 'flush', 'cow', 'cow-share', 'mask', 'disposition']);

  /** a C value read from memory, by its type (int, long, char, pointer) */
  function read(vm, addr, type) {
    const k = type && type.k;
    const kind = k === 'int' ? 'i' : k === 'long' ? 'l' : k === 'char' ? 'c' : k === 'ptr' ? 'p' : k === 'uint' ? 'u' : null;
    if (!kind) return null;
    try { const v = S.CLang.ld(vm, addr, kind); return typeof v === 'bigint' ? Number(v) : v; } catch (e) { return null; }
  }
  H.read = read;
  /** what a picture needs of a system, now */
  function capture(sys) {
    const C = S.CLang, prog = sys.procs.filter((p) => p.role === 'prog');
    const threads = sys.threads.filter((t) => prog.includes(sys.proc(t.pid)) && t.vm).map((t) => ({ tid: t.tid, pid: t.pid, main: t.main, state: t.state, line: t.line, lo: t.vm.stackLo, hi: t.vm.stackHi, sp: t.vm.sp, why: t.wait ? t.wait.kind : '' }));
    const globals = {}, locals = {};
    for (const p of prog) {
      const m = sys.threads.find((t) => t.pid === p.pid && t.vm && t.main) || sys.threads.find((t) => t.pid === p.pid && t.vm);
      if (!m || !p.prog) continue;
      const g = {};
      for (const [name, x] of p.prog.globals) {
        if (x.lib || name.startsWith('__')) continue;
        if (x.type.k === 'arr' && x.type.n <= 16) g[name] = { addr: x.addr, value: Array.from({ length: x.type.n }, (_, i) => read(m.vm, x.addr + i * C.T.size(x.type.of), x.type.of)) };
        else g[name] = { addr: x.addr, value: read(m.vm, x.addr, x.type) };
      }
      globals[p.pid] = g;
      for (const t of sys.threads.filter((q) => q.pid === p.pid && q.vm && q.state !== 'done')) {
        let objs = [];
        try { objs = C.objects(p.prog, t.vm).filter((o) => o.kind === 'local' && o.live); } catch (e) { objs = []; }
        locals[t.tid] = objs.map((o) => ({ name: o.name, fn: o.fn, addr: o.addr, value: read(t.vm, o.addr, o.type), depth: o.depth }));
      }
    }
    const procs = prog.map((p) => ({ pid: p.pid, ppid: p.ppid, state: p.state, exitCode: p.exitCode, image: p.image }));
    const objs = Object.entries(sys.objs || {}).map(([key, o]) => ({ key, kind: o.kind, pid: o.pid, addr: o.addr, owner: o.owner || 0, q: (o.q || []).slice(), value: o.value }));
    return { threads, globals, locals, procs, objs, out: sys.out, term: sys.term.map((x) => ({ pid: x.pid, text: x.text })), t: sys.t };
  }
  H.capture = capture;
  /** an event with its line numbers counted in the program as the reader sees it (without the #include lines) */
  H.local = (e) => Object.assign({}, e, { say: String(e.say || '').replace(/line `(\d+)`/g, (m, n) => 'line `' + (n - H.off()) + '`'), line: e.line ? e.line - H.off() : e.line });
  /** run a program, keeping every step something visible happens: [{events, choice, cap}] and the system */
  H.kern = function (src, o) {
    o = o || {};
    const K = S.Kern, sys = new K.System(H.HDR + src, Object.assign({ policy: 'fifo', seed: 1 }, o.sys || {}));
    const steps = [{ events: [], choice: null, cap: capture(sys) }];
    let n = 0, mark = sys.trace.length;
    while (n < (o.max || 3000)) {
      if (!sys.advance()) { sys.done(); const tail = sys.trace.slice(mark).filter((e) => !QUIET.has(e.kind) && e.kind !== 'done').map(H.local); if (tail.length) steps.push({ events: tail, choice: null, cap: capture(sys), n }); break; }
      const c = sys.pick(); if (c === null) break;
      sys.step(c); n++;
      const evs = sys.trace.slice(mark); mark = sys.trace.length;
      const seen = evs.filter((e) => !QUIET.has(e.kind) && !(o.skip && o.skip(e))).map(H.local);
      if (seen.length || (o.every && o.every(evs, sys))) steps.push({ events: seen, choice: c, cap: capture(sys), n });
    }
    return { steps, sys, status: sys.status(), out: sys.out, prog: sys.prog };
  };
  /** the line numbers of a program as the kernel sees them (the header comes first) */
  H.off = () => H.HDR.split('\n').length - 1;
  /** a C listing with thread tags at their lines: marks {line: [{pid: label, cls}]} (lines of the user's text) */
  H.code = function (prefix, x, y, w, src, marks, act, title, o) {
    return S.Kit.proc.code(Object.assign({ prefix, x, y, w, src: src.split('\n'), marks, act, title, lineH: 22, size: 13, indent: 0.5, tagSize: 13 }, o || {}));
  };
  /** tags for the threads of one process at their current lines */
  H.marks = function (cap, pid, actTid, name) {
    const m = {}, off = H.off();
    for (const t of cap.threads) {
      if (t.pid !== pid || t.state === 'done') continue;
      const ln = t.line - off;
      if (ln < 1) continue;
      (m[ln] = m[ln] || []).push({ pid: name ? name(t) : t.tid, cls: (t.state === 'blocked' ? 's-blocked' : t.tid === actTid ? 's-running' : 's-ready') + (t.tid === actTid ? ' act' : '') });
    }
    return m;
  };
  H.stateCls = (st) => ({ ready: 's-ready', running: 's-running', blocked: 's-blocked', done: 's-done', stopped: 's-blocked', zombie: 's-zombie', reaped: 's-done' })[st] || 's-ready';
  /** the terminal rows so far, each tagged with the writer */
  H.term = (cap) => cap.out.split('\n').filter((l, i, a) => i < a.length - 1 || l).map((text) => ({ tags: [], text }));

  /** a mutex and a condition variable of a machine snapshot: the owner and the sleepers */
  H.lockCond = function (prefix, x, y, st, mid, cid, lit) {
    const K7 = S.Kit.sync7, nm = (i) => st.threads[i].name, m = st.mutex[mid], c = st.cond[cid], items = [];
    items.push(...K7.mutex({ prefix: prefix + 'm', x, y, name: mid, owner: m.owner === null ? null : nm(m.owner), queue: m.queue.map(nm), act: lit === mid, nameW: 40, ownerW: 84 }).items);
    if (c) {
      const r = K7.mutex({ prefix: prefix + 'c', x, y: y + 66, name: cid, owner: c.queue.length + ' asleep', queue: c.queue.map(nm), act: lit === cid, nameW: 40, ownerW: 84, label: 'condition', none: 'no one sleeps here' });
      r.items[1].cls = 'mxown free'; r.items[1].size = 13;
      items.push(...r.items);
    }
    return items;
  };

  // ---- parallel loops ------------------------------------------------------------------------------------------------
  /**
   * H.parfor({costs: [t..], workers, policy: 'static' | 'cyclic' | 'dynamic', chunk}) -> {segs: [{w, start, end, it}],
   *   events: [{t, w, its}], end, busy: [time per worker]}
   * static: worker w gets one contiguous block (the first n mod w blocks one longer); cyclic: iteration i goes to
   * worker i mod w; dynamic: an idle worker takes the next chunk of `chunk` iterations (the lowest-numbered idle
   * worker first when several are idle at once). Each worker runs its iterations one after another.
   */
  H.parfor = function (o) {
    const n = o.costs.length, W = o.workers, segs = [], events = [], free = Array(W).fill(0);
    const give = (w, its) => { events.push({ t: free[w], w, its: its.slice() }); for (const i of its) { segs.push({ w, start: free[w], end: free[w] + o.costs[i], it: i }); free[w] += o.costs[i]; } };
    if (o.policy === 'static') {
      let i = 0;
      for (let w = 0; w < W; w++) { const len = Math.floor(n / W) + (w < n % W ? 1 : 0), its = []; for (let k = 0; k < len; k++) its.push(i++); if (its.length) give(w, its); }
    } else if (o.policy === 'cyclic') {
      for (let w = 0; w < W; w++) { const its = []; for (let i = w; i < n; i += W) its.push(i); if (its.length) give(w, its); }
    } else {
      const c = Math.max(1, o.chunk || 1);
      for (let i = 0; i < n; i += c) {
        let w = 0; for (let k = 1; k < W; k++) if (free[k] < free[w]) w = k;
        give(w, Array.from({ length: Math.min(c, n - i) }, (_, k) => i + k));
      }
    }
    events.sort((a, b) => a.t - b.t || a.w - b.w);
    return { segs, events, end: Math.max(...free), busy: free.slice(), total: o.costs.reduce((a, b) => a + b, 0) };
  };

  // ---- threading models -------------------------------------------------------------------------------------------
  /**
   * H.mapSim({model: 'many-to-one' | 'one-to-one' | 'many-to-many', kernel: m, cores, work: [[burst..]..]})
   * Each user thread's work alternates CPU and blocking bursts: [cpu, io, cpu, ...]. Time moves in ticks. The kernel
   * gives cores to ready kernel threads in a fixed order (lowest number first that ran least recently); a library
   * puts ready user threads on idle kernel threads (first come, first served). A user thread in a blocking call
   * holds its kernel thread, which blocks with it (no scheduler activations). One-to-one: a kernel thread each;
   * many-to-one: one in all; many-to-many: m of them.
   * -> {ticks: [{core: [user id | null], blocked: [ids], ready: [ids], kt: [user id | null]}], finish: [t], end,
   *     busy (core-ticks used), bound: [kernel thread of each user thread at each tick]}
   */
  H.mapSim = function (o) {
    const n = o.work.length, K = o.model === 'one-to-one' ? n : o.model === 'many-to-one' ? 1 : Math.max(1, Math.min(o.kernel, n));
    const left = o.work.map((w) => w.slice()), phase = o.work.map(() => 0), finish = o.work.map(() => null);
    const kt = Array(K).fill(null), lastRun = Array(K).fill(-1), ticks = [];
    const ready = [];
    for (let u = 0; u < n; u++) ready.push(u);
    const ioLeft = Array(n).fill(0);
    let t = 0, busy = 0;
    while (finish.some((f) => f === null) && t < 400) {
      // the library binds waiting user threads to free kernel threads
      for (let k = 0; k < K && ready.length; k++) if (kt[k] === null) kt[k] = ready.shift();
      // kernel threads whose user thread is computing may run; the kernel picks up to cores of them
      const runnable = [];
      for (let k = 0; k < K; k++) if (kt[k] !== null && ioLeft[kt[k]] === 0) runnable.push(k);
      runnable.sort((a, b) => lastRun[a] - lastRun[b] || a - b);
      const run = runnable.slice(0, o.cores);
      const core = Array(o.cores).fill(null);
      run.sort((a, b) => a - b).forEach((k, i) => { core[i] = kt[k]; lastRun[k] = t; });
      const blocked = []; for (let u = 0; u < n; u++) if (ioLeft[u] > 0) blocked.push(u);
      ticks.push({ core, blocked, ready: ready.slice(), kt: kt.slice() });
      busy += run.length;
      // a tick passes: computing threads use their CPU, waiting threads their I/O
      for (let u = 0; u < n; u++) if (ioLeft[u] > 0) { ioLeft[u]--; left[u][phase[u]]--; }
      for (const k of run) { const u = kt[k]; left[u][phase[u]]--; }
      t++;
      for (let k = 0; k < K; k++) {
        const u = kt[k];
        if (u === null || left[u][phase[u]] > 0) continue;
        phase[u]++;
        if (phase[u] >= left[u].length) { finish[u] = t; kt[k] = null; continue; }
        if (phase[u] % 2 === 1) ioLeft[u] = left[u][phase[u]];
      }
    }
    return { ticks, finish, end: t, busy, K };
  };
})(globalThis.Proses = globalThis.Proses || {});
