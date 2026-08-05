// Process exercise kinds, checked by running C on the simulated kernel (S.Kern):
//   fork-outputs  {src, ask: 'count' | 'set' | 'lines', tty, input, sleep: 'free' | 'timed', granularity: 'machine'}
//                 count: how many different outputs the program can produce (Answer: a number)
//                 set:   every output it can produce (Answer: [text..] or one output a line, each output's own
//                        newlines written as spaces)
//                 lines: how many lines it prints, the same in every run (Answer: a number)
//   process-tree  {src, names: {pid: 'P'}, policy: 'fifo' | 'random', seed, ask: ['parents', 'zombie', 'orphan']}
//                 Answer: {parents: {A: 'P', ..}, zombie: ['A'], orphan: ['B']}. The parent is the process that
//                 forked it; a zombie is one that exits and stays unreaped while other processes go on running; an
//                 orphan is one re-parented to init because its parent exited first. From one run with that seed.
//   code          {starter, tests: [{name, input, files, argv, tty, stdout | match: 'regex' | expect(sys) -> true |
//                  'why not', exit, seeds: [1, 2, 3], policy: 'random', crash: true or signal: 11 | 'SIGSEGV' | [..] (the
//                  run is expected to crash, with that signal; any other crash still fails)}], mc: {deadlock: true, maxStates, preemptions,
//                  failOnError}, maxSteps, granularity: 'statement' | 'machine' (loads and stores are steps, so count++
//                  can race), outputs: [text..] | {set, subset, maxStates} (every schedule's output, exactly that set,
//                  or within it with subset), spec: [{kind: 'always' | 'never' | 'end' | 'live' | 'deadlock', what}]
//                  (the Sync lab's property rows, e.g. {kind: 'live', what: 'worker calls enter'}: no starvation)}
//                 Answer: the program's source. It must compile (the compiler's line, column and hint come back as
//                 result.error), pass every test with every seed, and, with mc, no schedule may deadlock or crash;
//                 outputs and spec are checked over every schedule. A failing spec gives result.replay ({src, spec,
//                 gran, schedule, cycleFrom, cycleLen}) and result.starved (the thread that starves).
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  const O = () => K.os;
  const outKey = (t) => String(t).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const compileErr = (src) => { try { S.Kern.compile(src); return null; } catch (e) { return e; } };
  const where = (e) => (e.line ? 'line ' + e.line + (e.col ? ', column ' + e.col : '') + ': ' : '') + (e.msg || e.message);

  // ---- fork-outputs ------------------------------------------------------------------------------------------------
  // sleep: 'timed' (sleeps order the processes as real timing would) or 'free' (the default: a sleep only yields);
  // granularity: 'machine' (loads and stores are steps, so threads can race)
  const outcomes = (x) => S.Kern.outcomes(x.src, { tty: x.tty !== false, input: x.input || '', maxStates: x.maxStates || 200000, sleep: x.sleep, granularity: x.granularity });
  O().kind('fork-outputs', {
    remote: true,
    outputs(x) { return [...outcomes(x).outputs.keys()]; },
    check(x, a) {
      const outs = this.outputs(x), ask = x.ask || 'count';
      if (ask === 'count' || ask === 'lines') {
        const t = String(a === undefined || a === null ? '' : a).trim();
        if (!t) return { ok: false, message: 'Type a number first.' };
        if (!/^\d+$/.test(t)) return { ok: false, message: t + ' is not a whole number.' };
        const want = ask === 'count' ? outs.length : outs[0].split('\n').filter((l, i, all) => l !== '' || i < all.length - 1).length;
        const g = +t;
        if (g === want) return { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') };
        return { ok: false, message: 'Not quite: ' + (ask === 'count' ? 'the program can produce ' + (g < want ? 'more' : 'fewer') + ' different outputs than ' + g : 'it prints ' + (g < want ? 'more' : 'fewer') + ' lines than ' + g) + '.' + (x.whyNot ? ' ' + x.whyNot : ''), details: [ask === 'count' ? 'Two runs differ only in the order the processes print in: list the orders the schedule allows.' : 'Count every process alive at each printf, and remember what a buffered printf does at fork.'] };
      }
      const got = (Array.isArray(a) ? a : String(a === undefined || a === null ? '' : a).split('\n')).map(outKey).filter(Boolean);
      if (!got.length) return { ok: false, message: 'Write the outputs first, one a line.' };
      const want = new Set(outs.map(outKey)), have = new Set(got);
      const extra = [...have].filter((g) => !want.has(g)), missing = [...want].filter((w) => !have.has(w));
      if (!extra.length && !missing.length) return { ok: true, message: 'Right: all ' + O().plural(want.size, 'output') + '.' + (x.why ? ' ' + x.why : '') };
      const bits = [];
      if (extra.length) bits.push('"' + extra[0] + '"' + (extra.length > 1 ? ' and ' + (extra.length - 1) + ' more' : '') + ' cannot happen');
      if (missing.length) bits.push(O().plural(missing.length, 'possible output is', 'possible outputs are') + ' missing');
      return { ok: false, message: 'Not quite: ' + bits.join(', and ') + '.' };
    },
    lint(x) {
      const p = [], e = compileErr(x.src);
      if (e) return ['the program does not compile: ' + where(e)];
      const o = outcomes(x);
      if (!o.complete) p.push('the search did not finish: the program has too many schedules');
      if (o.outputs.size > 40) p.push('the program has ' + o.outputs.size + ' outputs: too many to list');
      if (x.ask === 'lines' && new Set([...o.outputs.keys()].map((t) => t.split('\n').length)).size > 1) p.push('the number of lines differs between runs, so ask: lines has no single answer');
      return p;
    },
    wrongFrom(x) { const outs = this.outputs(x), ask = x.ask || 'count'; if (ask === 'set') return [outs.slice(1).map(outKey), outs.map(outKey).concat(['nothing at all'])].filter((w) => w.length); const n = ask === 'count' ? outs.length : outs[0].split('\n').length - 1; return [String(n + 1), String(Math.max(0, n - 1))]; },
    example() {
      return {
        id: 'k-fork', kind: 'fork-outputs', title: 'Who prints first?', level: 1, ask: 'set',
        text: ['Write every output this program can produce on a terminal, one a line (write each output\'s line breaks as spaces).'],
        src: '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    if (fork() == 0) {\n        printf("kid\\n");\n        return 0;\n    }\n    printf("mum\\n");\n    wait(NULL);\n    printf("end\\n");\n    return 0;\n}',
        hints: ['After the fork, either process may run first.', 'The parent prints "end" only after wait returns, so after the child has printed.', 'kid mum end, and mum kid end.'],
        solution: ['kid mum end', 'mum kid end'], wrong: [['kid mum end'], ['kid mum end', 'mum kid end', 'mum end kid']],
      };
    },
  });

  // ---- process-tree ------------------------------------------------------------------------------------------------
  const PROG = new Set(['print', 'block', 'fork', 'exit', 'buffer', 'wait', 'wake', 'step']);
  K.os.procFacts = function (x) {
    const sys = S.Kern.run(x.src, { policy: x.policy || 'fifo', seed: x.seed || 1, names: x.names || {}, cow: false });
    const nm = (pid) => (x.names && x.names[pid]) || (pid === 1 ? 'init' : pid === 2 ? 'sh' : String(pid));
    const parents = {}, zombie = new Set(), orphan = new Set(), since = new Map();
    for (const e of sys.trace) {
      if (e.kind === 'fork') parents[nm(e.child)] = nm(e.pid);
      if (e.kind === 'reparent') orphan.add(nm(e.pid));
      if (e.kind === 'zombie') { const p = sys.proc(e.pid); since.set(e.pid, { par: p ? p.ppid : 0, reaping: false }); }
      if (e.kind === 'reap') since.delete(e.pid);
      // another program process doing something while one is a zombie makes that one a zombie worth naming; a
      // parent already blocked in wait only wakes to reap it (its wake, its wait returning, its step out of the
      // call), so a child exiting under a waiting parent is reaped at once and never stays a zombie
      if (PROG.has(e.kind) && e.pid >= 100) for (const [pid, z] of since) {
        if (pid === e.pid) continue;
        if (e.pid === z.par && ((e.kind === 'wake' && e.why === 'child') || e.kind === 'wait')) { z.reaping = true; continue; }
        if (e.pid === z.par && z.reaping && e.kind === 'step') continue;
        zombie.add(nm(pid));
      }
    }
    return { sys, parents, zombie: [...zombie], orphan: [...orphan], procs: sys.procs.filter((p) => p.pid >= 100).map((p) => nm(p.pid)) };
  };
  O().kind('process-tree', {
    check(x, a) {
      a = a || {};
      const F = K.os.procFacts(x), ask = x.ask || ['parents', 'zombie', 'orphan'], bad = [], cells = {};
      if (ask.includes('parents')) {
        const P = a.parents || {};
        let wrong = 0;
        for (const [child, par] of Object.entries(F.parents)) { const ok = O().norm(P[child]) === O().norm(par); cells['parent|' + child] = ok; if (!ok) wrong++; }
        if (wrong) bad.push(O().plural(wrong, 'parent is', 'parents are') + ' not right');
      }
      for (const k of ['zombie', 'orphan']) {
        if (!ask.includes(k)) continue;
        const got = new Set(O().list(a[k] || []).map((v) => v.toLowerCase())), want = new Set(F[k].map((v) => v.toLowerCase()));
        for (const p of F.procs) cells[k + '|' + p] = got.has(p.toLowerCase()) === want.has(p.toLowerCase());
        const miss = [...want].filter((v) => !got.has(v)).length, extra = [...got].filter((v) => !want.has(v)).length;
        if (miss || extra) bad.push('the ' + k + 's: ' + [miss ? O().plural(miss, k) + ' not marked' : '', extra ? O().plural(extra, 'process', 'processes') + ' marked that ' + (extra === 1 ? 'is' : 'are') + ' not' + (k === 'zombie' ? ' left a zombie' : ' re-parented') : ''].filter(Boolean).join(' and '));
      }
      if (!bad.length) return { ok: true, cells, message: 'Right.' + (x.why ? ' ' + x.why : '') };
      return { ok: false, cells, message: 'Not quite: ' + bad.join('; ') + '.', details: ['A zombie has exited but its parent has not yet waited for it; an orphan\'s parent exited first, so init adopts it.'] };
    },
    solve(x) { const F = K.os.procFacts(x); return { parents: F.parents, zombie: F.zombie, orphan: F.orphan }; },
    lint(x) { const e = compileErr(x.src); if (e) return ['the program does not compile: ' + where(e)]; const F = K.os.procFacts(x); return F.procs.length > 10 ? ['more than 10 processes: too many to label'] : []; },
    wrongFrom(x) { const s = this.solve(x); return [Object.assign({}, s, { zombie: s.zombie.length ? [] : F0(x) }), Object.assign({}, s, { orphan: s.orphan.length ? [] : F0(x) })]; },
    example() {
      return {
        id: 'k-tree', kind: 'process-tree', title: 'Name the zombie and the orphan', level: 2,
        text: ['Run this program with the kernel picking the first ready process each time. Give each process\'s parent, and mark the zombie and the orphan.'],
        names: { 100: 'P', 101: 'A', 102: 'B' }, policy: 'fifo', seed: 1,
        src: '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    pid_t a = fork();\n    if (a == 0) {\n        printf("A leaves\\n");\n        exit(0);\n    }\n    pid_t b = fork();\n    if (b == 0) {\n        sleep(2);\n        printf("B ends\\n");\n        exit(0);\n    }\n    sleep(1);\n    waitpid(a, NULL, 0);\n    return 0;\n}',
        hints: ['P forks both A and B.', 'A exits at once, but P is asleep: nobody has waited for A yet.', 'A is the zombie until P\'s waitpid; P returns before B wakes, so B is the orphan.'],
        solution: { parents: { A: 'P', B: 'P' }, zombie: ['A'], orphan: ['B'] },
        wrong: [{ parents: { A: 'P', B: 'A' }, zombie: ['A'], orphan: ['B'] }, { parents: { A: 'P', B: 'P' }, zombie: ['B'], orphan: ['A'] }],
      };
    },
  });
  const F0 = (x) => K.os.procFacts(x).procs.slice(0, 1);

  // ---- code ----------------------------------------------------------------------------------------------------------
  const gran = (x) => (x.granularity === 'machine' ? 'machine' : 'statement');
  const tname = (sys, tid) => { const t = sys.thread(tid); return t && t.main ? 'main (thread ' + tid + ')' : 'thread ' + tid; };
  /** a run that hit its step limit: who kept running and who got nowhere in its last stretch */
  function stalled(sys, max) {
    const tail = sys.trace.slice(-4000).filter((e) => e.kind === 'step' && e.tid !== undefined);
    const ran = new Map();
    for (const e of tail) ran.set(e.tid, (ran.get(e.tid) || 0) + 1);
    const alive = sys.threads.filter((t) => t.state !== 'done' && sys.proc(t.pid) && sys.proc(t.pid).role === 'prog');
    // a thread that could run but never did starves; a blocked one is only waiting (for a join, say)
    const starved = alive.filter((t) => !ran.get(t.tid) && t.state !== 'blocked'), busy = alive.filter((t) => ran.get(t.tid));
    const lines = (ts) => [...new Set(ts.map((t) => t.line))].join(' and ');
    let say = 'the run did not finish in ' + max + ' steps';
    if (starved.length && busy.length) say += ': ' + starved.map((t) => tname(sys, t.tid) + ' (ready at line ' + t.line + ')').join(' and ') + ' never got to run while ' + busy.map((t) => tname(sys, t.tid)).join(' and ') + ' kept running, so ' + (starved.length > 1 ? 'they starve' : 'it starves');
    else if (busy.length) say += ': ' + busy.map((t) => tname(sys, t.tid)).join(' and ') + ' kept going round at line ' + lines(busy) + ' without getting anywhere' + (busy.length > 1 ? ', each waiting for the other (a livelock)' : '');
    return say;
  }
  /** run one test with one seed: null when it passes, else a sentence */
  function runTest(x, src, t, seed) {
    const sys = new S.Kern.System(src, { policy: t.policy || 'random', seed, input: t.input || '', files: t.files || {}, argv: t.argv, tty: t.tty !== false, cow: false, granularity: gran(x) });
    const max = x.maxSteps || 200000;
    sys.run(max);
    const label = 'test "' + (t.name || 'run') + '"' + (t.seeds && t.seeds.length > 1 ? ' (schedule seed ' + seed + ')' : '');
    // a test may expect crashes: crash: true (any), or signal: 11 | [11, 8] (killed by those signals only);
    // a crash it does not expect fails the run, and an expected one that never comes does too
    const SIG = { SIGSEGV: 11, SIGFPE: 8, SIGABRT: 6, SIGKILL: 9, SIGTERM: 15, SIGINT: 2, SIGBUS: 7, SIGPIPE: 13 };
    const want = t.signal !== undefined ? [].concat(t.signal).map((v) => (typeof v === 'string' ? SIG[v.toUpperCase()] || +v : v)) : null;
    const crashes = sys.trace.filter((e) => e.kind === 'error');
    const allowed = (e) => (want ? want.includes(e.signal) : !!t.crash);
    const errEv = crashes.find((e) => !allowed(e));
    if (errEv) return label + ': ' + errEv.say.replace(/`/g, '') + (want || t.crash ? ' (the test expects ' + (want ? 'only signal ' + want.join(' or ') : 'a crash') + ', not this)' : '');
    if ((want || t.crash) && !crashes.length) return label + ': no process crashed, but the test expects ' + (want ? 'one killed by signal ' + want.join(' or ') : 'a crash');
    if (sys.trace.some((e) => e.kind === 'limit')) return label + ': ' + stalled(sys, max);
    if (sys.status() === 'deadlock') return label + ': the program is stuck, with every thread blocked';
    if (t.stdout !== undefined && sys.out !== t.stdout) return label + ': it printed ' + JSON.stringify(sys.out.length > 80 ? sys.out.slice(0, 80) + '…' : sys.out) + ', which is not the output wanted';
    if (t.match !== undefined && !new RegExp(t.match).test(sys.out)) return label + ': the output ' + JSON.stringify(sys.out.slice(0, 80)) + ' does not have the form wanted';
    if (t.exit !== undefined) { const p = sys.proc(100); if (!p || p.exitCode !== t.exit) return label + ': main ends with ' + (p ? p.exitCode : '?') + ', not ' + t.exit; }
    if (t.expect) { const r = t.expect(sys); if (r !== true) return label + ': ' + (typeof r === 'string' ? r : 'the result is not right'); }
    return null;
  }
  K.os.runTest = runTest;
  /** every output the program can print over every schedule, at the exercise's granularity */
  K.os.allOutputs = function (x, src) {
    const r = S.Kern.outcomes(src, { maxStates: (x.outputs && x.outputs.maxStates) || 60000, granularity: gran(x), tty: true });
    return { outs: [...r.outputs.keys()].map(outKey), complete: r.complete, deadlocks: r.deadlocks.size };
  };
  /** the outputs property: the set printed over all schedules must be exactly the set wanted (or within it) */
  function outputsCheck(x, src) {
    const o = Array.isArray(x.outputs) ? { set: x.outputs } : x.outputs;
    const want = new Set(o.set.map(outKey)), got = K.os.allOutputs(x, src);
    const have = new Set(got.outs);
    const extra = [...have].filter((v) => !want.has(v)), missing = o.subset ? [] : [...want].filter((v) => !have.has(v));
    if (extra.length) return 'some schedule prints ' + JSON.stringify(extra[0]) + ', which is not one of the outputs wanted' + (extra.length > 1 ? ' (and ' + (extra.length - 1) + ' more like it)' : '');
    if (missing.length) return 'no schedule ever prints ' + JSON.stringify(missing[0]) + (missing.length > 1 ? ' (nor ' + (missing.length - 1) + ' more of the outputs wanted)' : '');
    if (!got.complete) return 'there are too many schedules to list every output; make the program smaller';
    return null;
  }
  /**
   * The specification rows, as the Sync lab writes them ({kind: always | never | end | live | deadlock, what}),
   * checked by the Sync lab's own checker (S.SyncLab.prepare and check): invariants over every reachable state,
   * and "eventually A calls B" (no starvation, under weak fairness) by S.MC.live, with the lasso when it fails.
   */
  function specCheck(x, src) {
    const SL = S.SyncLab;
    if (!SL || !SL.prepare || !SL.check) return { why: 'the property checker (the Sync lab) is not in this build' };
    const P = SL.prepare({ src, spec: x.spec, gran: gran(x) });
    if (P.error) return { why: 'the program cannot be read for its properties: ' + (P.error.msg || P.error.message) };
    if (P.spec.errors.length) return { why: P.spec.errors[0] };
    const mc = x.mc || {};
    const R = SL.check(P, { search: 'full', maxStates: mc.maxStates || 6000, preempt: mc.preemptions === undefined ? Infinity : mc.preemptions });
    const replay = R.schedule ? { src, spec: x.spec, gran: gran(x), schedule: R.schedule.slice(), cycleFrom: R.cycleFrom, cycleLen: R.cycleLen } : null;
    if (R.verdict === 'starve') {
      const who = String(R.name || '').replace(/ eventually calls .*$/, ''), what = (/ eventually calls (\w+)/.exec(R.name || '') || [])[1];
      const say = R.kind === 'stuck' ? who + ' can be stuck for ever: a schedule leaves it blocked with nothing able to wake it'
        : who + ' can starve: the other threads go round a cycle of ' + R.cycleLen + ' steps for ever and ' + who + ' never ' + (what ? 'calls ' + what : 'gets in') + ' (the cycle starts after ' + R.cycleFrom + ' steps)';
      return { why: say, replay, starved: who };
    }
    if (R.verdict === 'violation') {
      const say = R.kind === 'deadlock' ? 'one schedule deadlocks, ' + R.schedule.length + ' steps in' : R.kind === 'assert' ? 'an assert fails in one schedule (' + String(R.violationSay || '').replace(/`/g, '') + ')' : 'the property "' + R.name + '" breaks in one schedule, ' + R.schedule.length + ' steps in';
      return { why: say, replay };
    }
    return { ok: true, states: R.stats ? R.stats.states : 0, complete: R.verdict === 'ok' };
  }
  function judge(x, src) {
    src = String(src === undefined || src === null ? '' : src);
    if (!src.trim()) return { ok: false, message: 'Write the program first.' };
    const e = compileErr(src);
    if (e) return { ok: false, error: { line: e.line, col: e.col, msg: e.msg || e.message, hint: e.hint }, message: 'It does not compile: ' + where(e) + '.', details: e.hint ? ['Hint: ' + e.hint] : [] };
    let passed = 0, total = 0;
    for (const t of x.tests || []) for (const seed of t.seeds || [1]) {
      total++;
      const why = runTest(x, src, t, seed);
      if (why && x.spec && x.spec.length && /did not finish in/.test(why)) {
        // a run that never ends: the properties' checker can say who starves, with the lasso to replay
        const r = specCheck(x, src);
        if (!r.ok && r.replay) return { ok: false, message: 'Not yet: ' + r.why + '.', replay: r.replay, starved: r.starved || null, details: ['A test run (' + why.replace(/^test "[^"]*"(?: \(schedule seed \d+\))?: /, '') + ') showed it first.', 'Replay it step by step in the Sync lab to watch ' + (r.starved ? r.starved + ' wait for ever' : 'the failing schedule') + '.'] };
      }
      if (why) return { ok: false, message: 'Not yet: ' + why + '.', details: [passed + ' of ' + total + ' runs passed before this one.'] };
      passed++;
    }
    const done = [O().plural(total, 'test run') + ' passed'];
    if (x.outputs) {
      const why = outputsCheck(x, src);
      if (why) return { ok: false, message: 'Not yet: the tests pass, but ' + why + '.', details: ['Every schedule was tried' + (gran(x) === 'machine' ? ', with loads and stores as separate steps' : '') + '.'] };
      done.push('every schedule prints one of the outputs wanted');
    }
    if (x.mc) {
      const make = S.MC.kernel(src, { failOnError: x.mc.failOnError !== false, granularity: gran(x) });
      const r = S.MC.check(make, { deadlock: x.mc.deadlock !== false, invariants: x.mc.invariants || [] }, { maxStates: x.mc.maxStates || 60000, preemptions: x.mc.preemptions === undefined ? Infinity : x.mc.preemptions });
      if (r.verdict === 'violation') return { ok: false, message: 'Not yet: the tests pass, but one schedule ' + (r.violation.kind === 'deadlock' ? 'deadlocks' : 'fails: ' + (r.violation.say || r.violation.name || r.violation.kind)) + ' (' + r.violation.schedule.length + ' steps in).', details: ['Every interleaving of the threads was searched, ' + r.stats.states + ' states.'] };
      done.push(r.verdict === 'ok' ? 'no schedule out of ' + r.stats.states + ' states deadlocks or fails' : 'no failing schedule was found within the search bound');
    }
    if (x.spec && x.spec.length) {
      const r = specCheck(x, src);
      if (!r.ok) return { ok: false, message: 'Not yet: the tests pass, but ' + r.why + '.', replay: r.replay || null, starved: r.starved || null, details: r.replay ? ['Replay it step by step in the Sync lab to watch ' + (r.starved ? r.starved + ' wait for ever' : 'the failing schedule') + '.'] : [] };
      done.push('every property holds' + (r.complete ? ' in all ' + r.states + ' reachable states' : ' within the search bound'));
    }
    return { ok: true, message: 'Right: ' + done.join(', and ') + '.' + (x.why ? ' ' + x.why : '') };
  }
  K.os.specCheck = specCheck;
  O().kind('code', {
    remote: true,
    check: judge,
    checkAsync(x, src) { return new Promise((res) => setTimeout(() => res(judge(x, src)), 0)); },
    lint(x) {
      const p = [];
      if (!(x.tests || []).length) p.push('a code exercise needs at least one test');
      if (x.starter !== undefined && typeof x.starter !== 'string') p.push('the starter is not text');
      if (x.granularity !== undefined && !['statement', 'machine'].includes(x.granularity)) p.push('granularity is statement or machine');
      if (x.outputs !== undefined && !(Array.isArray(x.outputs) ? x.outputs : (x.outputs || {}).set || []).length) p.push('outputs lists no output');
      for (const [i, r] of (x.spec || []).entries()) if (!['always', 'never', 'end', 'live', 'deadlock'].includes(r.kind)) p.push('spec row ' + (i + 1) + ': the kind is always, never, end, live or deadlock');
      if (x.spec && x.spec.length && x.solution && S.SyncLab && S.SyncLab.prepare) { const P = S.SyncLab.prepare({ src: x.solution, spec: x.spec, gran: x.granularity }); if (!P.error && P.spec.errors.length) p.push('spec: ' + P.spec.errors[0]); }
      return p;
    },
    example() {
      return {
        id: 'k-code', kind: 'code', title: 'Wait for the child', level: 2,
        text: ['Fork a child that prints `child`, and make the parent print `parent` only after the child has finished, whatever the schedule.'],
        starter: '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    \n    return 0;\n}\n',
        tests: [{ name: 'order', stdout: 'child\nparent\n', seeds: [1, 2, 3, 4] }],
        hints: ['fork returns 0 in the child.', 'The parent waits with wait(NULL) before it prints.', 'if (fork() == 0) { printf("child\\n"); return 0; } wait(NULL); printf("parent\\n");'],
        solution: '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    if (fork() == 0) {\n        printf("child\\n");\n        return 0;\n    }\n    wait(NULL);\n    printf("parent\\n");\n    return 0;\n}\n',
        wrong: ['#include <stdio.h>\n#include <unistd.h>\n\nint main(void) {\n    if (fork() == 0) {\n        printf("child\\n");\n        return 0;\n    }\n    printf("parent\\n");\n    return 0;\n}\n', 'int main(void) {\n    printf("child\\n")\n    return 0;\n}\n'],
      };
    },
    /** more samples: a race only machine granularity shows (checked by its set of outputs), and a lock that lets
     *  a thread starve (checked by an "eventually" property, with the lasso) */
    examples() {
      const race = (body) => '#include <stdio.h>\n#include <pthread.h>\n\nint hits = 0;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\n\nvoid *tally(void *arg) {\n    for (int k = 0; k < 2; k++) {\n' + body + '\n    }\n    return NULL;\n}\n\nint main(void) {\n    pthread_t a, b;\n    pthread_create(&a, NULL, tally, NULL);\n    pthread_create(&b, NULL, tally, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    printf("hits = %d\\n", hits);\n    return 0;\n}\n';
      const gate = (body) => '#include <stdio.h>\n#include <pthread.h>\n\nint want[2];\nint favoured = 0;\nint inside = 0;\n\nvoid enter_room(void) {\n    inside++;\n    inside--;\n}\n\nvoid *visitor(void *arg) {\n    int me = (int) arg, other = 1 - me;\n    for (int k = 0; k < 2; k++) {\n' + body + '\n    }\n    return NULL;\n}\n\nint main(void) {\n    pthread_t v0, v1;\n    pthread_create(&v0, NULL, visitor, (void *) 0);\n    pthread_create(&v1, NULL, visitor, (void *) 1);\n    pthread_join(v0, NULL);\n    pthread_join(v1, NULL);\n    printf("both done\\n");\n    return 0;\n}\n';
      return [this.example(), {
        id: 'k-code-race', kind: 'code', title: 'Two tallies, one total', level: 2, granularity: 'machine',
        text: ['Two threads each add 1 to `hits` twice. Make the total 4 in every schedule, even when `hits++` is a load, an add and a store.'],
        starter: race('        hits++;'),
        tests: [{ name: 'one run', stdout: 'hits = 4\n', seeds: [1, 2] }], outputs: ['hits = 4'],
        hints: ['Two loads of the same old value lose an increment.', 'Only one thread at a time may run hits++.', 'Wrap hits++ in pthread_mutex_lock(&m) and pthread_mutex_unlock(&m).'],
        solution: race('        pthread_mutex_lock(&m);\n        hits++;\n        pthread_mutex_unlock(&m);'),
        wrong: [race('        hits++;'), race('        pthread_mutex_lock(&m);\n        pthread_mutex_unlock(&m);\n        hits++;')],
      }, {
        id: 'k-code-gate', kind: 'code', title: 'A gate nobody waits at for ever', level: 3, granularity: 'machine', maxSteps: 20000,
        text: ['Two visitors use the room twice each, with only plain loads and stores of `want` and `favoured`. Never two inside, and neither may wait for ever.'],
        starter: gate('        want[me] = 1;\n        while (want[other])\n            ;\n        enter_room();\n        want[me] = 0;'),
        tests: [{ name: 'one run', stdout: 'both done\n', seeds: [1, 2] }],
        spec: [{ kind: 'never', what: 'in(enter_room) > 1' }, { kind: 'live', what: 'visitor calls enter_room' }],
        hints: ['With only want[], both can raise their flags and wait on each other for ever.', 'Let a waiting visitor give way: favoured says who goes first when both want in.', 'want[me] = 1; favoured = other; while (want[other] && favoured == other) ; enter_room(); want[me] = 0;'],
        solution: gate('        want[me] = 1;\n        favoured = other;\n        while (want[other] && favoured == other)\n            ;\n        enter_room();\n        want[me] = 0;'),
        wrong: [gate('        want[me] = 1;\n        while (want[other])\n            ;\n        enter_room();\n        want[me] = 0;'), gate('        while (want[other])\n            ;\n        want[me] = 1;\n        enter_room();\n        want[me] = 0;')],
      }].map((x) => Object.assign({ chapter: 'kinds' }, x));
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
