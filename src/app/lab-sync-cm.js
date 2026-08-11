// The Sync lab's second source: the step machine's ready-made programs (S.Sync.catalog), including those C cannot
// write here (spinlocks from test-and-set, compare-and-swap, tickets and queues; Peterson's algorithm on a machine
// that buffers stores, with and without a fence; the Chandy–Misra table). They run on the primitive machine with
// the same views as a C program: thread cards, locks with owners and queues, semaphores, shared variables, and
// the problem's scene; by hand, from a seed, or checked by S.MC.verify with the failing schedule replayed.
//   SL.CATALOG -> [{value, label}]          the programs, for the setup's select
//   SL.machineBuild(v, ctx) -> a lab result (the same shape as SL.build's), with sync.P.machine set
//   SL.listing(P, beat) -> [{name, lines: [text], at: {line: [thread names]}}]   each distinct program's listing
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const q = (v) => '`' + v + '`';
  const FAM = { counter: 'Counter', peterson: 'Peterson', spinlock: 'Spinlock', philosophers: 'Philosophers', buffer: 'Buffer', 'readers-writers': 'Readers–writers', barber: 'Barber', smokers: 'Smokers', barrier: 'Barrier', crews: 'Boat crews', bugs: 'Bug', 'lock-order': 'Lock order', livelock: 'Livelock', structures: 'Structure' };
  SL.CATALOG = (S.Sync && S.Sync.catalog ? S.Sync.catalog : []).map((c) => ({ value: c.id, label: (FAM[c.family] || c.family) + ': ' + c.title }));
  /** the catalogue programs a C program in this lab cannot be: they need atomics, a reordering machine or tokens */
  SL.MACHINE_ONLY = ['lock-tas', 'lock-cas', 'lock-ticket', 'lock-mcs', 'peterson-tso', 'peterson-tso-fence', 'chandy-correct', 'chandy-cyclic'];

  const opText = (o) => (o.label ? o.label : o.op + (o.m ? ' ' + (typeof o.m === 'string' ? o.m : 'm') : o.s ? ' ' + o.s : o.c ? ' ' + o.c : o.l ? ' ' + o.l : o.b ? ' ' + o.b : o.v ? ' ' + o.v : ''));
  const shortOp = (t) => (t.length > 16 ? t.slice(0, 15) + '…' : t);
  const show = (x) => (x === null || x === undefined ? 0 : typeof x === 'object' ? JSON.stringify(x) : x);

  function prepare(id) {
    const c = S.Sync.catalog.find((x) => x.id === id) || S.Sync.catalog[0];
    const x = c.build(), system = typeof x.choices === 'function';
    const spec = system ? x.spec : x;
    const fresh = system ? () => x.clone() : () => S.Sync.machine(spec);
    const phil = /philosophers/.test(c.family), n = system ? x.snap().phil.length : spec.threads.length;
    const scene = phil ? { kind: 'table', base: 'forks', n: system ? n : (spec.mutexes || []).filter((m) => /^f\d+$/.test(typeof m === 'string' ? m : m.id)).length, title: 'the table' }
      : spec.vars && Array.isArray(spec.vars.buf) && spec.vars.in !== undefined ? { kind: 'ring', n: spec.vars.buf.length, title: 'the ring of slots' } : null;
    const I = { fns: [], mutexes: [], sems: [], conds: [], vars: [], consts: {}, lines: [], at: () => '', fnOfLine: () => null };
    const P = { machine: { c, x, system, spec, scene, fresh }, I, spec: { rows: [], live: [], endExprs: [], invariants: [] }, gran: 'statement', src: '' };
    return P;
  }

  /** one picture's worth of state from the machine (or the Chandy–Misra table) */
  function world(P, M) {
    const m = P.machine, st = M.snap();
    if (m.system) {
      const threads = st.phil.map((p, i) => ({ tid: i, name: 'P' + i, fn: 'philosopher', arg: i, state: p.state === 'done' ? 'done' : 'ready', line: 0, cur: p.state === 'eating' ? 'eat' : p.state, on: null, cls: 'p' + (i % 6), main: false }));
      // the table numbers fork j between seats j and j − 1; the Chandy–Misra fork f lies between f and f + 1
      const n = st.forks.length, F = Array.from({ length: n }, (_, j) => st.forks[(j - 1 + n) % n]);
      const mutexes = F.map((f, j) => ({ name: 'forks[' + j + ']', base: 'forks', i: j, owner: f.holder === null ? null : 'P' + f.holder, ownerTid: f.holder, ownerCls: f.holder === null ? '' : 'p' + (f.holder % 6), queue: [], qTids: [] }));
      const vars = [{ name: 'dirty', arr: true, value: F.map((f) => (f.dirty ? 1 : 0)) }, { name: 'token at', arr: true, value: F.map((f) => (f.token === null || f.token === undefined ? -1 : f.token)) }, { name: 'meals', arr: true, value: st.phil.map((p) => p.meals) }];
      return { threads, mutexes, sems: [], conds: [], vars, status: M.status(), mem: true };
    }
    const spec = m.spec, nm = (i) => (st.threads[i] ? st.threads[i].name : 'T' + i);
    const named = (list, id) => { const e = (list || []).map((x) => (typeof x === 'string' ? { id: x } : x)).find((x) => x.id === id); return (e && e.name) || id; };
    const threads = st.threads.map((th) => {
      const prog = spec.threads[th.id]._asm || S.Sync.assemble(spec.threads[th.id].prog), o = prog[th.pc];
      const role = spec.threads[th.id].role || (/philosophers/.test(m.c.family) ? 'philosopher' : 'thread');
      const on = th.state === 'blocked' && th.on ? { kind: th.on.kind, name: th.on.kind === 'mutex' && /^f\d+$/.test(th.on.id) ? 'forks[' + th.on.id.slice(1) + ']' : named(spec.mutexes, th.on.id) } : null;
      let cur = o ? shortOp(opText(o)) : null;
      if (o && o.op === 'eat') cur = 'eat';
      if (th.sb && th.sb.length) cur = th.sb.length + ' store' + (th.sb.length > 1 ? 's' : '') + ' buffered';
      return { tid: th.id, name: th.name, fn: role, arg: th.id, state: th.state, line: th.pc + 1, cur, on, cls: 'p' + (th.id % 6), main: false, reg: th.reg };
    });
    const forkName = (id) => (/^f\d+$/.test(id) && /philosophers/.test(m.c.family) ? 'forks[' + id.slice(1) + ']' : named(spec.mutexes, id));
    const mutexes = Object.keys(st.mutex).map((id) => { const x = st.mutex[id]; return { name: forkName(id), base: /^f\d+$/.test(id) ? 'forks' : id, i: /^f\d+$/.test(id) ? +id.slice(1) : 0, owner: x.owner === null ? null : nm(x.owner), ownerTid: x.owner, ownerCls: x.owner === null ? '' : 'p' + (x.owner % 6), queue: x.queue.map(nm), qTids: x.queue.slice() }; });
    for (const id of Object.keys(st.rw)) { const l = st.rw[id]; mutexes.push({ name: id, base: id, i: 0, owner: l.writer !== null ? nm(l.writer) : l.readers.length ? l.readers.map(nm).join(' ') : null, ownerTid: l.writer, ownerCls: l.writer !== null ? 'p' + (l.writer % 6) : '', queue: l.queue.map((x) => nm(x.tid)), qTids: [] }); }
    const sems = Object.keys(st.sem).map((id) => ({ name: named(spec.sems, id), base: id, i: 0, value: st.sem[id].value, queue: st.sem[id].queue.map(nm), qTids: st.sem[id].queue.slice() }));
    const conds = Object.keys(st.cond).map((id) => ({ name: id, base: id, i: 0, queue: st.cond[id].queue.map(nm), qTids: [] }))
      .concat(Object.keys(st.barrier).map((id) => ({ name: 'barrier ' + id, base: id, i: 0, queue: st.barrier[id].waiting.map(nm), qTids: [] })));
    const vars = Object.keys(st.vars).map((k) => { const v = st.vars[k]; return { name: k, arr: Array.isArray(v), value: Array.isArray(v) ? v.map(show) : show(v) }; });
    // on a machine that buffers stores, each thread's buffer: stores the others cannot see yet
    if (spec.tso) for (const th of st.threads) vars.push({ name: th.name + "'s buffer", arr: false, value: th.sb.length ? th.sb.map((e) => (Array.isArray(e) ? e[0] + (e[1] !== undefined && e[1] !== null ? '[' + e[1] + ']' : '') + '=' + e[2] : JSON.stringify(e))).join(' ') : 'empty' });
    return { threads, mutexes, sems, conds, vars, status: M.status(), mem: true };
  }
  const label = (P, M, c) => {
    if (typeof c === 'number') return P.machine.system ? String(c) : (M.threads ? M.threads[c].name : 'T' + c);
    if (P.machine.system) return c;
    const own = M.owner(c), name = M.threads[own].name;
    return c[0] === 'f' ? 'fl' + name : name + ':' + c.split(':')[1];
  };
  function beatOf(P, M, rec, c) {
    const names = {};
    const w = world(P, M);
    for (const t of w.threads) names[t.tid] = { name: t.name, fn: t.fn, k: t.tid, arg: t.arg };
    const inv = (P.machine.system ? P.machine.spec.check : P.machine.spec.check || {}).invariants || [];
    const truth = inv.map((x) => ({ row: { text: x.name, kind: 'always' }, ok: !!x.holds(M), why: '' }))
      .concat(((P.machine.spec.check || {}).liveness || []).map((x) => ({ row: { text: x.name, kind: 'live' }, ok: null, why: 'checked over every schedule by Check it' })));
    const st = M.status();
    const tid = rec ? (P.machine.system ? M.owner(c) : typeof c === 'number' ? c : M.owner(c)) : null;
    const full = rec ? label(P, M, c) : null, short = rec ? (P.machine.system ? 'P' + tid : full) : null;
    // a short engine sentence ("P1 thinks.") gets the place the thread has reached
    let say = rec ? String(rec.say || '') : '';
    const t = rec && w.threads.find((x) => x.tid === tid);
    if (rec && say.length < 40 && t && t.line) say = say.replace(/\.?$/, '.') + ' Its next step is line ' + q(t.line) + (t.cur ? ': ' + t.cur : '') + '.';
    return { choice: c, rec: rec ? { tid, events: [], lines: [], label: short, full } : null, say, world: w, names, truth, status: st, failure: M.failure || null };
  }

  /** run the machine by a chooser: (M, choices, k) -> a choice or undefined (stop and wait) */
  function drive(P, pick, max) {
    const M = P.machine.fresh(), beats = [beatOf(P, M, null, null)];
    let waiting = null;
    for (let n = 0; n < max && M.status() === 'running'; n++) {
      const cs = M.choices(), c = pick(M, cs, n);
      if (c === undefined) { waiting = cs; break; }
      const rec = M.step(c);
      beats.push(beatOf(P, M, rec, c));
    }
    return { beats, waiting, M };
  }

  SL.machineBuild = function (v, ctx) {
    const P = prepare(v.cat), mode = v.mode;
    let run, R = null;
    if (mode === 'hand') {
      const picks = String(v.sched || '').trim().split(/[\s,]+/).filter(Boolean);
      let k = 0, bad = null;
      const r = drive(P, (M, cs) => {
        if (cs.length === 1) return cs[0];
        const want = picks[k];
        if (want === undefined) return undefined;
        const c = cs.find((x) => label(P, M, x) === want);
        if (c === undefined) { bad = { at: k, want, could: cs.map((x) => label(P, M, x)) }; return undefined; }
        k++; return c;
      }, 600);
      const M = r.M;
      run = { beats: r.beats, waiting: r.waiting, bad, picks, used: k, label: (c) => label(P, M, c) };
    } else if (mode === 'random') {
      const rnd = S.MC.rng(ctx.seed || 1);
      run = drive(P, (M, cs) => cs[Math.floor(rnd() * cs.length)], v.steps || 80);
      run.limit = run.M.status() === 'running';
    } else {
      const t0 = Date.now();
      // the limit grows (four times at a go, to 200000 states) while it alone stops the search
      let lim = v.maxStates || 10000, res;
      for (;;) {
        res = S.MC.verify(P.machine.x, { maxStates: lim, preemptions: v.preempt < 0 ? Infinity : v.preempt });
        const cut = res.verdict === 'bounded' || (res.liveness && !res.liveness.complete);
        if (!cut || v.preempt >= 0 || lim >= 200000) break;
        lim = Math.min(200000, lim * 4);
      }
      R = { how: 'full', stats: res.safety.stats, verdict: res.verdict === 'ok' ? 'ok' : res.verdict === 'bounded' ? 'bounded' : res.verdict === 'starve' ? 'starve' : 'violation', kind: null, schedule: null, cycleFrom: -1, runs: 0, steps: 0, live: res.liveness, ms: 0 };
      if (res.safety.violation) { R.kind = res.safety.violation.kind; R.name = res.safety.violation.name; R.violationSay = res.safety.violation.say; R.schedule = res.safety.violation.schedule; }
      else if (res.liveness && res.liveness.results.some((x) => !x.holds)) {
        const bad = res.liveness.results.find((x) => !x.holds);
        R.kind = bad.kind; R.name = bad.name; R.violationSay = bad.say;
        R.schedule = bad.lasso.prefix.concat(bad.lasso.cycle, bad.lasso.cycle); R.cycleFrom = bad.lasso.prefix.length; R.cycleLen = bad.lasso.cycle.length;
      }
      R.ms = Date.now() - t0; R.limit = lim;
      if (R.schedule) { let k = 0; run = drive(P, (M, cs) => (cs.includes(R.schedule[k]) ? R.schedule[k++] : undefined), R.schedule.length); }
      else { const rnd = S.MC.rng(ctx.seed || 1); run = drive(P, (M, cs) => cs[Math.floor(rnd() * cs.length)], 60); }
      run.R = R;
    }
    const { frames } = SL.frames(P, run, { narrow: ctx.narrow, mode });
    const beats = run.beats, n = beats.length;
    const trace = beats.map((b, k) => ({ kind: b.rec ? b.rec.full : 'start', say: k ? b.say : 'Before anything runs: ' + P.machine.c.title + ', ' + q(beats[0].world.threads.length) + ' threads at their first step. ' + (P.machine.spec.about || ''), tid: b.rec ? b.rec.tid : null }));
    frames.forEach((f, k) => {
      const b = beats[k];
      f.say = trace[k].say;
      f.tables = SL.tables(P, b, []);
      const blocked = b.world.threads.filter((t) => t.state === 'blocked').length;
      f.metrics = [{ label: 'Step', value: k + ' of ' + (n - 1) }, { label: 'Threads', value: b.world.threads.length }, { label: 'Blocked', value: blocked, cls: blocked ? 'bad' : '' }];
      if (R) f.metrics = SL.checkMetrics(R).concat(f.metrics);
    });
    if (mode === 'hand' && n) {
      const last = frames[n - 1], M0 = run;
      if (run.bad) last.say += ' Your schedule asks for ' + q(run.bad.want) + ' next, but only ' + run.bad.could.map(q).join(', ') + ' can run now.';
      else if (run.waiting) last.say += ' Your turn: ' + run.waiting.map((c) => q(M0.label(c))).join(', ') + ' can run. Click one to take its next step.';
    }
    if (R) SL.checkSay(R, frames, beats, P);
    return { frames, trace, tables: frames[n - 1].tables, metrics: frames[n - 1].metrics, sync: { P, run, mode } };
  };

  /** each distinct program of the machine, its lines, and the threads at each line now */
  SL.listing = function (P, b) {
    const m = P.machine;
    if (m.system) return [];
    const groups = new Map();
    m.spec.threads.forEach((th, i) => {
      const prog = th._asm || S.Sync.assemble(th.prog), key = prog.map(opText).join('\n');
      if (!groups.has(key)) groups.set(key, { name: th.role || th.name, lines: prog.map(opText), at: {}, threads: [] });
      const g = groups.get(key); g.threads.push(th.name);
      const t = b.world.threads.find((x) => x.tid === i);
      if (t && t.state !== 'done') (g.at[t.line] = g.at[t.line] || []).push({ name: t.name, cls: t.cls, act: b.rec && b.rec.tid === i });
    });
    return [...groups.values()];
  };
})(globalThis.Proses = globalThis.Proses || {});
