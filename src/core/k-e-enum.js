// The simulated kernel, part five: every output a small program can produce, over every schedule. A depth-first
// search over the choices (which ready thread runs next, or which pending alarm fires), with three reductions
// that lose no output:
//   - a thread's steps that touch nothing shared (by their footprint: no system call beyond the purely local
//     ones, no shared memory) run together up to its next shared action;
//   - an action no other process can ever notice is taken alone, in one order only: a fork (children are named
//     by their place in the fork tree, not by pid number), the exit of a process with no children, holding only
//     terminal descriptors, whose parent is init or the shell; a reap by init or the shell; a getppid once the
//     parent is init or the shell; never a step of a process with a signal handler, nor one that touches signal
//     state, since another process's kill may land before or after it;
//   - a state met before (same key) is not explored again.
// By default (sleep: 'free') a sleep only yields and an alarm may fire at any moment, so the set holds what any real
// machine prints, whatever its timing (what a model checker wants). With sleep: 'timed' time moves only when
// nothing can run: the clock jumps to the first deadline and the sleepers and alarms due then wake, in deadline
// order; so the set holds what a run with real timing prints, for programs that order themselves with sleep (a
// fork-outputs exercise). With pids: 'exact' forks are ordered too.
//   S.Kern.outcomes(src, {tty, input, files, programs, maxStates, pids, sleep: 'free' | 'timed'}) -> {outputs: Map(text -> one schedule),
//     states, complete, deadlocks: Map(text -> schedule)}  (a deadlock: no choice left with a thread blocked)
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const QUIET = new Set(['step', 'buffer', 'sleep', 'flush', 'cow', 'cow-share', 'mask', 'disposition', 'alarm']);

  K.outcomes = function (src, opts) {
    opts = opts || {};
    const max = opts.maxStates || 200000, sym = opts.pids !== 'exact';
    const timed = opts.sleep === 'timed';
    const start = new K.System(src, Object.assign({}, opts, { tty: opts.tty !== false, sleep: timed ? 'timed' : 'free', tick: timed ? false : undefined, policy: 'hand', shell: opts.shell !== false, cow: false, snap: false }));
    const seen = new Set(), outputs = new Map(), deadlocks = new Map();
    let states = 0, complete = true;
    const alive = (sys, pid) => { const q = sys.proc(pid); return !!q && q.role === 'prog' && q.state !== 'zombie' && q.state !== 'reaped'; };
    /** run a choice; a thread goes on until it does something another could notice */
    const macro = (sys, c) => {
      const evs = [], fp = { r: new Set(), w: new Set() };
      for (let n = 0; n < 5000; n++) {
        sys.fp = { r: new Set(), w: new Set() };
        sys.shared = false;
        const e = sys.step(c);
        evs.push(...e);
        for (const x of sys.fp.r) fp.r.add(x);
        for (const x of sys.fp.w) fp.w.add(x);
        const t = typeof c === 'number' && sys.thread(c);
        const mine = (x) => t && x === 'buf:' + t.pid;
        // a process with a handler can be interrupted between any two statements: no merging then
        const caught = t && Object.values(sys.proc(t.pid).sig.handlers).some((h) => h && h.fn);
        if (!t || t.state !== 'running' || caught || [...sys.fp.r].some((x) => !mine(x)) || [...sys.fp.w].some((x) => !mine(x)) || e.some((x) => !QUIET.has(x.kind))) break;
      }
      sys.fp = null;
      return { evs, fp };
    };
    /** can no other process ever tell when this action happened? */
    const hidden = (before, c, m) => {
      if (typeof c !== 'number') return false;
      const t = before.thread(c), p = before.proc(t.pid), kinds = new Set(m.evs.map((e) => e.kind));
      // a process with a handler can take another's signal between any two of its steps; and a step that reads
      // or changes signal state (a mask, a disposition, pending signals) depends on every kill
      if (Object.values(p.sig.handlers).some((h) => h && h.fn)) return false;
      for (const x of [...m.fp.r, ...m.fp.w]) if (/^sig:/.test(x)) return false;
      for (const k of kinds) if (!QUIET.has(k) && !/^(fork|exit|zombie|close)$/.test(k)) return false;
      if (before.threads.filter((o) => o.pid === p.pid && o.state !== 'done').length > 1) return false;
      for (const w of m.fp.w) if (!/^(pid|sys|proc:\d+|of:\d+|buf:\d+)$/.test(w)) return false;
      for (const r of m.fp.r) if (/^proc:/.test(r) && alive(before, p.ppid)) return false;
      if (kinds.has('fork') && !sym) return false;
      if (kinds.has('exit')) {
        if (alive(before, p.ppid) || before.kids(p).length) return false;
        if (p.fds.some((id) => id !== null && id !== undefined && before.ofiles[id] && !/^(tty|sink|null)$/.test(before.ofiles[id].kind))) return false;
      }
      return true;
    };
    const stack = [[start, []]];
    while (stack.length && complete) {
      const [sys, path] = stack.pop();
      let cs = sys.choices();
      if (!cs.length && timed) {
        // nothing can run: the clock jumps to the first deadline, and the sleepers (and alarms) due then wake
        const s2 = sys.clone();
        s2.trace = []; s2.term = [];
        if (s2.advance() && s2.choices().length) {
          const k = s2.key(sym);
          if (!seen.has(k)) { seen.add(k); if (++states > max) { complete = false; break; } stack.push([s2, path]); }
          continue;
        }
      }
      if (!cs.length) {
        const st = sys.status();
        if (st === 'deadlock' || st === 'input') { if (!deadlocks.has(sys.out)) deadlocks.set(sys.out, path); }
        if (!outputs.has(sys.out)) outputs.set(sys.out, path);
        continue;
      }
      // init and the shell reap: no program can see that, so it is done at once
      const reaper = cs.find((c) => typeof c === 'number' && sys.proc(sys.thread(c).pid).role !== 'prog');
      if (reaper !== undefined) cs = [reaper];
      const next = [];
      for (const c of cs) {
        const s2 = sys.clone();
        s2.trace = []; s2.term = [];
        const m = macro(s2, c);
        if (reaper !== undefined || hidden(sys, c, m)) { next.length = 0; next.push([s2, c]); break; }
        next.push([s2, c]);
      }
      for (const [s2, c] of next) {
        const k = s2.key(sym);
        if (seen.has(k)) continue;
        seen.add(k);
        if (++states > max) { complete = false; break; }
        stack.push([s2, path.concat(c)]);
      }
    }
    return { outputs, states, complete, deadlocks };
  };
  (S.engines = S.engines || []).push({ name: 'Process kernel: processes, files, pipes, signals, threads' });
})(globalThis.Proses = globalThis.Proses || {});
