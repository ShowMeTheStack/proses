// The Sync lab, part one: how it reads a C program running on the simulated kernel (S.Kern). Shared by the lab's
// other files through S.SyncLab (SL):
//   SL.compile(src) -> prog          compiled with a small memory image (a heap for its threads' 2 KB stacks), so that
//                                    the model checker, which copies the whole state at every step, stays quick
//   SL.withStacks(fn)                runs fn with the kernel's thread stacks at 2 KB (put back afterwards)
//   SL.info(prog, src) -> I          what the pictures and the specification need from the program: its globals
//                                    (numbers, arrays, locks, semaphores, conditions), the function each line is
//                                    in, the object at an address ("forks[1]"), its integer #defines
//   SL.Sys                           a kernel System as a system for the model checker (S.MC): one step lets a
//                                    thread run until it does something another thread could notice (touches
//                                    shared memory, a lock, a semaphore, the terminal), at statement or machine
//                                    granularity; a step's record lists the lines it ran and the functions entered
//   SL.boot(prog, o) -> Sys          a fresh system ({gran, keep: true keeps the kernel's trace for the pictures})
//   SL.world(sys, I, names) -> W     one picture's worth of state: the threads (name, state, line, function, what
//                                    blocks them), every mutex (owner, queue), semaphore (value, queue) and
//                                    condition (sleepers), the shared variables, the output
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  SL.STACK = 4096; SL.TSTACK = 2048;

  /** a heap just big enough for the threads the program can start (each stack is a block of it) and a little more */
  SL.heapFor = function (src) {
    const text = String(src), sites = (text.match(/\bpthread_create\s*\(/g) || []).length;
    let most = sites;
    if (/for\s*\([^)]*\)\s*\{?\s*pthread_create/.test(text) || /for\s*\([^)]*\)\s*\n\s*pthread_create/.test(text)) {
      const nums = [...text.matchAll(/#define\s+\w+\s+(\d+)/g)].map((m) => +m[1]).concat([...text.matchAll(/<\s*(\d+)\s*;/g)].map((m) => +m[1])).filter((n) => n <= 16);
      most = sites + Math.max(4, ...nums);
    }
    const mallocs = /\b(malloc|calloc|realloc|strdup)\s*\(/.test(text) ? 8192 : 0;
    return 2048 + Math.min(16, Math.max(1, most)) * (SL.TSTACK + 96) + mallocs;
  };
  const cache = new Map();
  SL.compile = function (src) {
    if (cache.has(src)) return cache.get(src);
    const prog = S.CLang.compile(src, { heap: SL.heapFor(src), stack: SL.STACK });
    if (cache.size > 40) cache.clear();
    cache.set(src, prog);
    return prog;
  };
  SL.withStacks = function (fn) {
    const K = S.Kern, old = K.TSTACK;
    K.TSTACK = SL.TSTACK;
    try { return fn(); } finally { K.TSTACK = old; }
  };

  // ---- the program: globals, functions, names of addresses ----------------------------------------------------
  const OBJ_RE = /\b(pthread_mutex_t|pthread_cond_t|sem_t|pthread_t)\s+([^;(){}]+);/g;
  SL.info = function (prog, src) {
    const C = S.CLang, kinds = {};
    let m;
    OBJ_RE.lastIndex = 0;
    while ((m = OBJ_RE.exec(String(src)))) for (const part of m[2].split(',')) { const w = /^\s*\**\s*([A-Za-z_]\w*)/.exec(part); if (w) kinds[w[1]] = m[1] === 'pthread_mutex_t' ? 'mutex' : m[1] === 'pthread_cond_t' ? 'cond' : m[1] === 'sem_t' ? 'sem' : 'thread'; }
    const globals = [];
    for (const [name, g] of prog.globals) {
      if (name.startsWith('__') || g.lib || g.addr < C.LIBC.end || g.fn) continue;
      const t = g.type, arr = t.k === 'arr', el = arr ? t.of : t, n = arr ? t.n || 0 : 1, es = C.T.size(el);
      let kind = kinds[name] || (C.T.isInt(el) && es <= 8 ? (arr ? 'arr' : 'int') : t.k === 'struct' ? 'struct' : 'other');
      if (arr && el.k === 'arr') kind = 'other';
      globals.push({ name, addr: g.addr, size: C.T.size(t), es, n, arr, kind, signed: !el.u, line: g.line, type: t });
    }
    globals.sort((a, b) => a.addr - b.addr);
    const fns = prog.fnList.filter((f) => f && f.body !== false && f.line).map((f) => ({ name: f.name, line: f.line })).sort((a, b) => a.line - b.line);
    const fnOfLine = (line) => { let f = null; for (const x of fns) { if (x.line <= line) f = x.name; else break; } return f; };
    const at = (addr) => {
      for (const g of globals) if (addr >= g.addr && addr < g.addr + g.size) {
        if (!g.arr) return g.name;
        return g.name + '[' + Math.floor((addr - g.addr) / g.es) + ']';
      }
      return String(addr);
    };
    // integer #defines (N, CHAIRS ...), evaluated once
    const macros = {};
    try {
      const pre = C.preprocess(String(src));
      for (const [k, mac] of Object.entries(pre.macros)) {
        if (mac.params || !/^[A-Z_][A-Z0-9_]*$/.test(k) || /^(SIG|E[A-Z]|O_|W[A-Z]|SEEK|STD|INT_|UINT|LONG|ULONG|CHAR|SCHAR|UCHAR|SHRT|USHRT|LLONG|ULLONG|RAND|BUFSIZ|EOF|EXIT|PTHREAD|NULL|SIZE|SSIZE|SA_|SIG_|PATH|FILENAME|L_|TMP|FOPEN|PIPE|S_I|F_|R_OK|W_OK|X_OK|_IO|CLOCKS|MB_|true|false|bool)/.test(k)) continue;
        if (!mac.line) continue;
        const txt = mac.body.map((t) => t.s).join(' ');
        if (/^[\d\s()+\-*/%A-Z_]+$/.test(txt)) macros[k] = txt;
      }
    } catch (e) { /* the compiler has already said what is wrong */ }
    const consts = {};
    for (const k of Object.keys(macros)) { try { const v = SL.expr(macros[k], { globals: [], macros, consts: {} }).fn({ get: () => 0 }); if (Number.isFinite(v)) consts[k] = v; } catch (e) { /* not a number */ } }
    const of = (kind) => globals.filter((g) => g.kind === kind);
    return { prog, src: String(src), globals, fns, fnOfLine, at, macros, consts, mutexes: of('mutex'), sems: of('sem'), conds: of('cond'), vars: globals.filter((g) => g.kind === 'int' || g.kind === 'arr'), lines: String(src).split('\n') };
  };

  // ---- the kernel as a system for the checker -------------------------------------------------------------------
  class Sys {
    constructor(sys, ctx) { this.sys = sys; this.ctx = ctx; this.failure = null; this.h = null; this.end = null; }
    choices() { return this.sys.choices(); }
    owner(c) { return c; }
    runner(c) { return typeof c === 'string' ? null : c; }
    /** run thread c until it does something another thread could notice (or blocks, or ends) */
    run(c) {
      const sys = this.sys, I = this.ctx.I, r = new Set(), w = new Set(), evs = [], lines = [], enter = [];
      const t0 = sys.thread(c);
      let before = t0 ? I.fnOfLine(t0.line) : null, steps = 0;
      for (let n = 0; n < 400; n++) {
        steps++;
        const t = sys.thread(c);
        if (t && t.line && (!lines.length || lines[lines.length - 1] !== t.line)) lines.push(t.line);
        sys.fp = { r: new Set(), w: new Set() };
        const e = sys.step(c);
        const f = sys.fp;
        sys.fp = null;
        for (const x of f.r) r.add(x);
        for (const x of f.w) w.add(x);
        for (const x of e) evs.push(x);
        // the last state with memory is what "at the end" sees (the program's exit frees it)
        if (this.ctx.endExprs && this.ctx.endExprs.length || this.ctx.keep) { const vm = this.mem(); if (vm) { this.snapEnd(vm); if (this.ctx.keep) this.vars = SL.readVars(this.ctx.I, vm); } }
        const err = e.find((x) => x.kind === 'error');
        if (err) { this.failure = err.say; break; }
        const t2 = sys.thread(c);
        // entering or leaving a function the specification watches (in(f), or "calls f") is visible: it changes
        // what a property sees, so the step ends there and writes the function's own pseudo-object, which makes
        // two such steps dependent for the partial-order reduction
        let watched = false;
        const fn2 = t2 && t2.state !== 'done' ? I.fnOfLine(t2.line) : null;
        if (fn2 !== before) {
          const watch = this.ctx.watch;
          if (watch && (watch.has(fn2) || watch.has(before))) { watched = true; for (const g of [before, fn2]) if (g && watch.has(g)) w.add('fn:' + g); }
          if (fn2) enter.push(fn2);
          before = fn2;
        }
        const shared = f.r.size + f.w.size > 0;
        if (shared || watched || this.ctx.single || !t2 || t2.state !== 'running' || e.some((x) => x.kind !== 'step' && x.kind !== 'buffer')) break;
      }
      // the shell reaping the program once it has exited is nobody's decision: it happens at once
      for (let n = 0; n < 8; n++) {
        const cs = sys.choices();
        if (!cs.length || !cs.every((x) => { const t = typeof x === 'number' && sys.thread(x); return t && sys.proc(t.pid).role !== 'prog'; })) break;
        for (const x of sys.step(cs[0])) evs.push(x);
      }
      this.h = null;
      return { tid: c, evs, lines, enter, r: [...r], w: [...w], n: steps };
    }
    step(c) { const x = this.run(c), last = x.evs[x.evs.length - 1] || { kind: 'step', say: '' }; return { tid: c, kind: last.kind, say: last.say, events: x.evs, lines: x.lines, enter: x.enter, fp: { r: x.r, w: x.w }, n: x.n }; }
    footprint(c) {
      const memo = this.ctx.fpMemo, k = this.hash() + '#' + c;
      let f = memo.get(k);
      if (!f) { const x = this.clone().run(c); f = { r: x.r, w: x.w }; if (memo.size > 40000) memo.clear(); memo.set(k, f); }
      return f;
    }
    clone() {
      const c = this.sys.clone();
      if (!this.ctx.keep) { c.trace = []; c.term = []; }
      const k = new Sys(c, this.ctx); k.failure = this.failure; k.end = this.end; k.vars = this.vars;
      if (this.ctx.tick) this.ctx.tick();
      return k;
    }
    // the kernel's key names exit codes and the first crash; the values the "at the end" properties read are added
    hash() { return this.h || (this.h = this.sys.hash() + (this.end ? '|end:' + this.end.join(',') : '')); }
    status() {
      if (this.failure) return 'error';
      const st = this.sys.status();
      return st === 'input' ? 'done' : st;
    }
    /** the program's process, and a machine context that can read its memory (while it has one) */
    mem() {
      const p = this.sys.procs.find((q) => q.role === 'prog');
      if (!p || !p.M) return null;
      const t = this.sys.threads.find((x) => x.pid === p.pid && x.vm) || null;
      return t ? t.vm : null;
    }
    /** what the "at the end" properties need, kept from the last state that still had memory */
    snapEnd(vm) { const ex = this.ctx.endExprs; if (!ex || !ex.length) return; vm = vm || this.mem(); if (vm) this.end = ex.map((x) => SL.evalIn(x, this, vm)); }
  }
  SL.Sys = Sys;
  SL.boot = function (prog, o) {
    o = o || {};
    return SL.withStacks(() => {
      const sys = new S.Kern.System(prog, { tty: true, sleep: 'free', policy: 'hand', choose: (c) => c[0], granularity: o.gran === 'machine' ? 'machine' : 'statement', snap: false, cow: false, shell: true });
      if (!o.keep) { sys.trace = []; sys.term = []; }
      return new Sys(sys, { I: o.I || SL.info(prog, o.src || ''), keep: !!o.keep, fpMemo: new Map(), endExprs: o.endExprs || null, gran: o.gran, watch: o.watch && o.watch.size ? o.watch : null, single: !!o.single });
    });
  };

  // ---- one picture's worth of state ------------------------------------------------------------------------------
  const C = () => S.CLang;
  const loadNum = (vm, g, i) => { try { const v = C().load(vm, g.addr + (i || 0) * g.es, g.es, g.signed ? 1 : 0); return typeof v === 'bigint' ? Number(v) : v; } catch (e) { return null; } };
  SL.loadNum = loadNum;
  /** names for the program's threads, from the kernel's thread events so far: {tid: {name, fn, arg, k}} */
  SL.nameThreads = function (sys, prev) {
    const out = Object.assign({}, prev || {});
    const p = sys.procs.find((q) => q.role === 'prog');
    if (p) { const m = sys.threads.find((t) => t.pid === p.pid && t.main); if (m && !out[m.tid]) out[m.tid] = { name: 'main', fn: 'main', arg: null, k: -1 }; }
    for (const e of sys.trace) if (e.kind === 'thread' && !out[e.tid]) out[e.tid] = { name: null, fn: e.fn, arg: e.arg, k: Object.keys(out).length - 1 };
    SL.labelThreads(out);
    return out;
  };
  /** short names: the start function's initial and an index (its argument when that is a small number) */
  SL.labelThreads = function (map) {
    const list = Object.entries(map).filter(([, x]) => x.fn !== 'main');
    const fns = [...new Set(list.map(([, x]) => x.fn))];
    const init = (f) => f.replace(/^_+/, '').charAt(0).toUpperCase();
    const two = (f) => { const s = f.replace(/^_+/, ''); return s.charAt(0).toUpperCase() + (s.charAt(1) || ''); };
    const tag = {};
    for (const f of fns) tag[f] = fns.filter((g) => init(g) === init(f)).length > 1 ? two(f) : init(f);
    for (const f of fns) {
      const mine = list.filter(([, x]) => x.fn === f);
      const args = mine.map(([, x]) => x.arg);
      const byArg = args.every((a) => typeof a === 'number' && a >= 0 && a < 10) && new Set(args).size === args.length;
      mine.forEach(([tid, x], k) => { map[tid].name = tag[f] + (byArg ? x.arg : k); map[tid].k = list.findIndex(([t]) => t === tid); });
    }
    return map;
  };
  SL.world = function (sys, I, names, prevVars) {
    const p = sys.procs.find((q) => q.role === 'prog');
    const pid = p ? p.pid : 0;
    const nm = (tid) => (names[tid] && names[tid].name) || 't' + tid;
    const cls = (tid) => (names[tid] && names[tid].fn === 'main' ? 'pm' : 'p' + (((names[tid] ? names[tid].k : 0) % 6) + 6) % 6);
    const threads = sys.threads.filter((t) => t.pid === pid).map((t) => {
      const w = t.wait;
      let on = null;
      if (t.state === 'blocked' && w) on = w.kind === 'join' ? { kind: 'join', name: nm(w.tid) } : w.key ? { kind: w.kind, name: I.at(+String(w.key).split(':')[2]) } : { kind: w.kind, name: w.kind };
      return { tid: t.tid, name: nm(t.tid), fn: names[t.tid] ? names[t.tid].fn : '?', arg: names[t.tid] ? names[t.tid].arg : null, state: p && (p.state === 'zombie' || p.state === 'reaped') ? 'done' : t.state, line: t.line, cur: t.state === 'done' ? null : I.fnOfLine(t.line), on, cls: cls(t.tid), main: !!t.main };
    });
    const obj = (kind, addr) => sys.objs[kind + ':' + pid + ':' + addr] || null;
    const each = (gs, f) => { const out = []; for (const g of gs) for (let i = 0; i < (g.arr ? g.n : 1); i++) out.push(f(g, g.addr + i * (g.arr ? g.es : 0), g.arr ? g.name + '[' + i + ']' : g.name, i)); return out; };
    const mutexes = each(I.mutexes, (g, a, name, i) => { const o = obj('mutex', a); return { name, base: g.name, i, owner: o && o.owner ? nm(o.owner) : null, ownerTid: o && o.owner ? o.owner : null, ownerCls: o && o.owner ? cls(o.owner) : '', queue: o ? o.q.map(nm) : [], qTids: o ? o.q.slice() : [] }; });
    const sems = each(I.sems, (g, a, name, i) => { const o = obj('sem', a); return { name, base: g.name, i, value: o && o.value !== undefined ? o.value : null, queue: o ? o.q.map(nm) : [], qTids: o ? o.q.slice() : [] }; });
    const conds = each(I.conds, (g, a, name, i) => { const o = obj('cond', a); return { name, base: g.name, i, queue: o ? o.q.map(nm) : [], qTids: o ? o.q.slice() : [] }; });
    const vm = sysMem(sys);
    const vars = vm ? SL.readVars(I, vm) : prevVars || I.vars.map((g) => ({ name: g.name, arr: g.arr, value: g.arr ? [] : null }));
    return { threads, mutexes, sems, conds, vars, out: sys.out, status: sys.status(), pid, mem: !!vm };
  };
  SL.readVars = (I, vm) => I.vars.map((g) => ({ name: g.name, arr: g.arr, value: g.arr ? Array.from({ length: Math.min(g.n, 16) }, (_, i) => loadNum(vm, g, i)) : loadNum(vm, g, 0) }));
  function sysMem(sys) {
    const p = sys.procs.find((q) => q.role === 'prog');
    if (!p || !p.M || p.state === 'zombie' || p.state === 'reaped') return null;
    const t = sys.threads.find((x) => x.pid === p.pid && x.vm);
    return t ? t.vm : null;
  }
  SL.sysMem = sysMem;
})(globalThis.Proses = globalThis.Proses || {});
