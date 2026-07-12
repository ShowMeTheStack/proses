// Adapters: one call to check a ready-made program, and the model checker over the simulated kernel.
//   S.MC.maker(specOrSystem) -> make()   a fresh S.Sync machine (light) for a spec, or a clone of a ready system
//   S.MC.verify(specOrSystem, opts) -> {verdict: 'ok' | 'deadlock' | 'invariant' | 'assert' | 'starve' | 'bounded',
//     safety (S.MC.check's answer), liveness (S.MC.live's, when safety holds and the spec has liveness
//     properties), replay: the counterexample replayed with full snapshots (steps from S.MC.replay) or null, say}
//     opts: passed to S.MC.check and S.MC.live ({por, maxStates, maxDepth, preemptions, minimal})
//   S.MC.kernel(src | compiled, opts) -> make()   a C program on the simulated kernel (S.Kern.System, k-*.js:
//     processes, threads, pthread mutexes, condition variables and semaphores) as a system: the kernel's own
//     choices (ready threads, and alarms), steps, footprints (so partial-order reduction works) and hash; status
//     'deadlock' when nothing can run and a thread is blocked ('input', waiting for the terminal, counts as done).
//     opts go to the System (granularity: 'machine' splits count++ into its loads and stores) and failOnError:
//     true makes a crashing process an assertion failure. spec.terminal(sys) can collect sys.out at every
//     finished state, so S.MC.check enumerates every output of a program.
(function (S) {
  'use strict';
  const MC = (S.MC = S.MC || {});

  MC.maker = function (x) {
    if (x && typeof x.choices === 'function') return () => x.clone();
    return () => S.Sync.machine(x, { light: true });
  };
  MC.verify = function (x, opts) {
    const make = MC.maker(x), spec = x.check || (x.spec && x.spec.check) || {};
    const safety = MC.check(make, spec, opts);
    let liveness = null, verdict = safety.verdict === 'violation' ? safety.violation.kind : safety.verdict;
    if (safety.verdict !== 'violation' && (spec.liveness || []).length) {
      liveness = MC.live(make, spec.liveness, opts);
      if (liveness.results.some((r) => !r.holds)) verdict = 'starve';
    }
    let replay = null;
    if (safety.violation) {
      const full = x && typeof x.choices === 'function' ? () => x.clone() : () => S.Sync.machine(x);
      replay = MC.replay(full, safety.violation.schedule, spec);
    }
    const bad = liveness ? liveness.results.filter((r) => !r.holds) : [];
    const say = safety.verdict === 'violation' ? safety.say : bad.length ? bad.map((r) => r.say).join(' ') : safety.say + (liveness ? ' ' + liveness.results.map((r) => r.say).join(' ') : '');
    return { verdict, safety, liveness, replay, say };
  };

  /** the kernel as a system for the checker: its own choices, steps, footprints and hash, with the names the
   *  checker uses (an alarm firing, 'a' + pid, is nobody's turn for the preemption bound) */
  class KernelSys {
    constructor(sys) { this.sys = sys; this.failure = null; }
    choices() { return this.sys.choices(); }
    owner(c) { return c; }
    runner(c) { return typeof c === 'string' ? null : c; }
    footprint(c) { const f = this.sys.footprint(c); return { r: [...f.r], w: [...f.w] }; }
    step(c) {
      const evs = this.sys.step(c), last = evs[evs.length - 1] || { kind: 'step', say: '' };
      const err = evs.find((e) => e.kind === 'error');
      if (err && this.failOnError) this.failure = err.say;
      return { tid: c, kind: last.kind, say: last.say, events: evs };
    }
    clone() { const c = this.sys.clone(); c.trace = []; c.term = []; const k = new KernelSys(c); k.failure = this.failure; k.failOnError = this.failOnError; return k; }
    hash() { return this.sys.hash(); }
    status() {
      if (this.failure) return 'error';
      const st = this.sys.status();
      return st === 'input' ? 'done' : st;
    }
    get out() { return this.sys.out; }
  }
  MC.kernel = function (src, opts) {
    opts = opts || {};
    const K = S.Kern, start = new K.System(src, Object.assign({ tty: true, sleep: 'free', policy: 'hand', choose: (c) => c[0] }, opts));
    start.trace = []; start.term = [];
    return () => { const c = start.clone(); c.trace = []; c.term = []; const k = new KernelSys(c); k.failOnError = !!opts.failOnError; return k; };
  };
})(globalThis.Proses = globalThis.Proses || {});
