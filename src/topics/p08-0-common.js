// Part 8, classic problems and concurrency bugs: the families, and the helpers its topics share (S.P08). Every
// problem is a machine spec from S.Sync (src/core/sync-d-classic.js, sync-e-more.js, sync-f-locks.js), stepped by
// S.Sync.run or checked by the model checker (S.MC through S.P07.check); a failing schedule is replayed step by step
// with full snapshots on the problem's own picture. The event loop has no engine of its own: a small model of it is
// here (S.P08.events), and tests/claims-p08.mjs checks it against a second simulation written independently.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'classic', order, title, blurb });
  fam('p08-buffer', 10, 'The bounded buffer', 'Producers and consumers sharing a ring of slots: with semaphores, with a mutex and condition variables, and the ways each can break.');
  fam('p08-rw', 20, 'Readers and writers', 'Many readers or one writer: who gets the room next, and who can be kept out of it for ever.');
  fam('p08-phil', 30, 'Dining philosophers', 'Forks shared round a table: the deadlock, the fixes that break the circle of waits, and clean and dirty forks.');
  fam('p08-more', 40, 'More classic problems', 'The sleeping barber, the cigarette smokers, barriers and boat crews of two rowers and a cox.');
  fam('p08-bugs', 50, 'Concurrency bugs', 'Atomicity and order violations, deadlocks and lost wake-ups: each found by the checker, replayed, and fixed.');
  fam('p08-events', 60, 'Event-based concurrency', 'One thread, an event queue and asynchronous I/O, against a thread for every request.');

  const H = (S.P08 = {});
  const P7 = () => S.P07, Y = () => S.Sync, MC = () => S.MC, K7 = () => S.Kit.sync7;
  H.box = (x, y, w, h) => ({ x, y, w, h });

  /** the text of the op a thread runs next (its place in its program), or what stops it */
  H.nextOp = function (spec, st, th) {
    if (th.state === 'done') return 'done';
    if (th.state === 'error') return 'failed';
    const prog = spec.threads[th.id]._asm || Y().assemble(spec.threads[th.id].prog), o = prog[th.pc];
    if (th.state === 'blocked') return 'waits: ' + (th.on ? th.on.id : '');
    return o ? P7().opText(o) : 'done';
  };
  /** a line under a card, cut to 20 characters */
  H.short = (x) => (x.length > 20 ? x.slice(0, 19) + '…' : x);
  /** the width a thread card needs so that any line under it fits (the same for every frame of a spec) */
  H.cardW = function (spec) {
    if (spec._cardW) return spec._cardW;
    const texts = ['done', 'failed'];
    for (const t of spec.threads) for (const o of t._asm || Y().assemble(t.prog)) { texts.push(P7().opText(o)); for (const k of ['m', 's', 'c', 'l', 'b']) if (typeof o[k] === 'string') texts.push('waits: ' + o[k]); }
    spec._cardW = Math.ceil(Math.max(...texts.map((x) => S.textWidth(H.short(x), 13, { mono: true, bold: true }))) + 10);
    return spec._cardW;
  };
  /** the height the cards of a spec take (rows of 70) */
  H.cardsH = (spec, maxW) => { const w = Math.max(72, H.cardW(spec)), per = Math.max(1, Math.floor(((maxW || 780) + 12) / (w + 12))); return Math.ceil(spec.threads.length / per) * 70; };
  /** thread cards with the op each runs next under it, wrapping into rows within o.maxW */
  H.cards = function (prefix, x, y, spec, st, act, o) {
    o = o || {};
    const w = Math.max(o.w || 72, H.cardW(spec)), gap = o.gap || 12, per = Math.max(1, Math.min(o.perRow || 99, Math.floor(((o.maxW || 780) + gap) / (w + gap))));
    const ths = st.threads.map((th) => ({ id: th.id, name: th.name, state: th.state === 'ready' && act === th.id ? 'running' : th.state, act: act === th.id, sub: H.short(o.sub ? o.sub(th) : H.nextOp(spec, st, th)), subCls: th.state === 'blocked' ? 'hot' : th.state === 'error' ? 'hot' : '' }));
    return K7().threads({ prefix, x, y, threads: ths, w, h: o.h || 34, gap, perRow: per, size: 14, subSize: 13 });
  };

  /**
   * A broken (or correct) program, checked and then replayed: the frames go into F.
   *   o: {spec, picture(st, ctx) -> items (ctx: {act, step, end, k, cycle}), strip: {x, y, w, cw}, verdict: {x, y, w},
   *       intro, introVals, why(end) -> the closing sentence, opts (for the checker), name}
   * The first frame is the start; the second the checker's answer with the states it searched; then each step of
   * the failing schedule (a liveness failure: the way in, then the cycle that can go round for ever); then the end.
   */
  H.checkAndReplay = function (F, o) {
    const spec = o.spec, c = P7().check(spec, o.opts), st0 = Y().machine(spec).snap();
    const V = P7().verdictText(c), sched = c.sched || [];
    const strip = (upto, lit) => (sched.length ? K7().strip({ prefix: 'sc', x: o.strip.x, y: o.strip.y, w: o.strip.w, steps: P7().stripSteps(spec, sched), upto, cw: o.strip.cw || 36, ch: 26, size: 13, title: c.lasso ? 'the schedule: the way in, then the cycle (outlined) for ever' : 'the failing schedule', lit }).items : []);
    const cycFrom = c.lasso ? c.lasso.lasso.prefix.length : Infinity, lit = sched.map((_, k) => k).filter((k) => k >= cycFrom);
    const verdict = (lines) => K7().verdict({ prefix: 'vd', x: o.verdict.x, y: o.verdict.y, w: o.verdict.w || 330, kind: V.kind, head: V.head, lines }).items;
    const states = c.stats.states;
    F.add({ items: o.picture(st0, { k: 0 }).concat(strip(0, [])), say: o.intro, meta: { vals: (o.introVals || []).concat([states]), st: st0 } });
    let vLines, vSay;
    if (c.res.safety.violation) {
      vLines = ['searched ' + states + ' states', 'failing schedule: ' + sched.length + ' steps'];
      vSay = `The model checker explores every schedule from the start, \`${states}\` distinct states in all, and stops at a failure: ${c.res.safety.violation.say} ${o.opts && o.opts.minimal === false ? 'One schedule that gets there (the first the search met, not the shortest)' : 'The shortest schedule that gets there'} has \`${sched.length}\` steps; here it is, replayed.`;
    } else if (c.lasso) {
      const L = c.lasso.lasso;
      vLines = ['no deadlock in ' + states + ' states', c.lasso.name + ': fails', L.prefix.length + ' steps in, then a cycle of ' + L.cycle.length];
      vSay = `Every one of the \`${states}\` states is safe, but a liveness check over every reachable state finds a way to starve: ${c.lasso.say} Here is that schedule: \`${L.prefix.length}\` steps in, then the cycle of \`${L.cycle.length}\` steps, which can repeat for ever.`;
    } else {
      vLines = ['searched ' + states + ' states', 'no deadlock, no broken invariant'].concat(c.res.liveness ? ['every thread makes progress'] : []);
      vSay = `The model checker explores every schedule: \`${states}\` distinct states, none of them a deadlock or a broken invariant${c.res.liveness ? ', and the liveness check finds no way for any thread to wait for ever (assuming the scheduler is weakly fair)' : ''}. ${c.res.verdict === 'ok' ? 'The program is correct for every schedule.' : 'The search hit its bounds, so this is no proof.'}`;
    }
    F.add({ items: o.picture(st0, { k: 0 }).concat(strip(0, []), verdict(vLines)), say: vSay, meta: { vals: V.vals.concat([states]), st: st0, verdict: V.kind } });
    const N = sched.length, mark = (k) => (N ? k + ' of ' + N : 'none');
    F.list.slice(-2).forEach((f) => { f.counters.step = mark(0); });
    if (!sched.length) return { c, frames: F.list };
    let prev = st0;
    const names = st0.threads.map((th) => th.name);
    c.steps.forEach((s, k) => {
      const inCycle = k >= cycFrom, round = inCycle ? ' (the cycle, step ' + (k - cycFrom + 1) + ' of ' + (sched.length - cycFrom) + ')' : '';
      const nx = c.steps[k + 1];
      const ask = k === c.steps.length - 2 && !c.lasso && typeof sched[k + 1] === 'number';
      F.add({ items: o.picture(s.state, { act: s.tid, step: s, k: k + 1, prev }).concat(strip(k + 1, lit)), say: s.say + round, counters: { step: mark(k + 1) }, meta: { vals: [k + 1, sched.length, sched.length - cycFrom, k - cycFrom + 1], st: s.state, prev, next: ask ? nx.name : null, options: ask ? names : null } });
      prev = s.state;
    });
    const last = c.steps[c.steps.length - 1].state;
    let endSay;
    if (c.res.safety.violation) {
      const M = c.res.replay.sys, kind = c.res.safety.violation.kind;
      const why = o.why ? o.why(c) : '';
      endSay = kind === 'deadlock' ? Y().ending(M, 'deadlock').say + (why ? ' ' + why : '') : why ? 'Why it fails: ' + why : c.res.safety.violation.say;
    } else endSay = `The cycle brings the program back to where it entered it, so it can go round again and again; meanwhile ${c.lasso.name.replace(/ eventually.*$/, '')} never gets its turn, though no thread is ever stuck.` + (o.why ? ' ' + o.why(c) : '');
    F.add({ items: o.picture(last, { end: true, k: sched.length }).concat(strip(sched.length, lit), verdict(vLines)), say: endSay, counters: { step: mark(N) }, meta: { vals: V.vals.concat([last.t, states]), st: last } });
    return { c, frames: F.list };
  };
  /** the prediction checkAndReplay sets up: which thread takes the step that breaks it */
  H.predictLast = { at: (f) => !!(f.meta && f.meta.next && f.meta.options), pick: 'option', once: true, ask: 'Which thread takes the last step of the failing schedule?', options: (fr, i) => fr[i].meta.options, answer: (fr, i) => fr[i].meta.next, explain: (fr, i) => fr[i + 1].say };

  /** locks, semaphores, conditions and barriers of a snapshot, one row each (rows rowH apart): {items, h} */
  H.objects = function (prefix, x, y, spec, st, o) {
    o = o || {};
    const items = [], nm = (i) => st.threads[i].name, rh = o.rowH || 50, lit = o.lit;
    // the names column fits the longest name drawn
    const allNames = [...Object.keys(st.mutex), ...Object.keys(st.sem), ...Object.keys(st.cond)].map((id) => { const e = [...(spec.mutexes || []), ...(spec.sems || []), ...(spec.conds || [])].map((q) => (typeof q === 'string' ? { id: q } : q)).find((q) => q.id === id); return (e && e.name) || id; });
    const nameW = Math.max(o.nameW || 84, ...allNames.map((t) => Math.ceil(S.textWidth(t, 16, { mono: true, bold: true })) + 14));
    let yy = y;
    const used = new Set();
    for (const t of spec.threads) for (const op of t.prog) for (const k of ['m', 's']) if (typeof op[k] === 'string') used.add(op[k]);
    const unused = (id) => !used.has(id) && !(spec.threads.some((t) => t.prog.some((op) => typeof op.m === 'function')));
    const named = (list, id) => { const e = (list || []).map((q) => (typeof q === 'string' ? { id: q } : q)).find((q) => q.id === id); return (e && e.name) || id; };
    Object.keys(st.mutex).forEach((id, k) => {
      const m = st.mutex[id], P = prefix + 'm' + id, free = m.owner === null, ow = 58, y0 = yy + 8;
      items.push({ key: P + ':name', kind: 'text', x, y: y0 + 22, text: named(spec.mutexes, id), size: 16, cls: 'semname' + (lit === id ? ' act' : '') });
      if (!k) items.push({ key: prefix + 'mcap', kind: 'text', x: x + nameW + ow / 2, y: y0 - 6, text: 'owner', anchor: 'middle', size: 13, cls: 'tick' });
      items.push({ key: P + ':own', kind: 'cell', x: x + nameW, y: y0, w: ow, h: 34, rx: 7, text: free ? 'free' : nm(m.owner), size: free ? 13 : 15, cls: 'mxown ' + (free ? 'free' : 'held') + (lit === id ? ' act' : '') });
      const qx = x + nameW + ow + 14;
      if (!m.queue.length) items.push({ key: P + ':none', kind: 'text', x: qx, y: y0 + 22, text: o.none || 'no one waits', size: 13, cls: 'qnone' });
      m.queue.forEach((i, j) => items.push({ key: P + ':q' + i, kind: 'cell', x: qx + j * 46, y: y0 + 3, w: 40, h: 28, rx: 5, text: nm(i), size: 13, cls: 'qcell s-blocked' }));
      yy += rh;
    });
    for (const id of Object.keys(st.sem)) {
      const s = st.sem[id];
      const r = S.Kit.sync.sem({ prefix: prefix + 's' + id, x, y: yy, name: named(spec.sems, id), value: s.value, queue: s.queue.map(nm), act: lit === id, nameW, perRow: o.perRow || 5, none: unused(id) ? 'not used in this version' : o.none });
      if (unused(id)) r.items.forEach((it) => { it.dim = true; });
      items.push(...r.items); yy += Math.max(rh, r.h + 10);
    }
    for (const id of Object.keys(st.cond)) {
      const c = st.cond[id];
      items.push({ key: prefix + 'c' + id + ':n', kind: 'text', x, y: yy + 25, text: named(spec.conds, id), size: 16, cls: 'semname' + (lit === id ? ' act' : '') });
      items.push({ key: prefix + 'c' + id + ':k', kind: 'text', x: x + nameW, y: yy + 25, text: 'asleep:', size: 13, cls: 'tick' });
      c.queue.forEach((i, j) => items.push({ key: prefix + 'c' + id + ':q' + i, kind: 'cell', x: x + nameW + 56 + j * 44, y: yy + 8, w: 40, h: 28, rx: 5, text: nm(i), size: 13, cls: 'qcell s-blocked' }));
      if (!c.queue.length) items.push({ key: prefix + 'c' + id + ':e', kind: 'text', x: x + nameW + 56, y: yy + 25, text: 'nobody', size: 13, cls: 'qnone' });
      yy += rh;
    }
    for (const id of Object.keys(st.barrier)) {
      const b = st.barrier[id], spB = spec.barriers.find((q) => q.id === id);
      items.push({ key: prefix + 'b' + id + ':n', kind: 'text', x, y: yy + 25, text: 'barrier', size: 16, cls: 'semname' + (lit === id ? ' act' : '') });
      items.push({ key: prefix + 'b' + id + ':k', kind: 'text', x: x + nameW, y: yy + 25, text: b.waiting.length + ' of ' + spB.n + ' in:', size: 13, cls: 'tick' });
      b.waiting.forEach((i, j) => items.push({ key: prefix + 'b' + id + ':q' + i, kind: 'cell', x: x + nameW + 66 + j * 44, y: yy + 8, w: 40, h: 28, rx: 5, text: nm(i), size: 13, cls: 'qcell s-blocked' }));
      yy += rh;
    }
    return { items, h: yy - y };
  };

  /** a seeded run under the random scheduler, one frame a step: {run, frames} */
  H.randomRun = function (F, o) {
    const run = Y().run(o.spec, { policy: 'random', seed: o.seed, quantum: o.quantum || 2, max: o.steps });
    let prev = Y().machine(o.spec).snap();
    run.steps.forEach((s, k) => {
      F.add({ items: o.picture(s.state, { act: s.tid, step: s, k: k + 1, prev }), say: (k === 0 && o.lead ? o.lead : '') + s.say, counters: { step: 'random ' + (k + 1) }, meta: { vals: [k + 1, o.seed], st: s.state, prev, step: s } });
      prev = s.state;
    });
    return run;
  };

  // ---- the event loop against a thread per request -------------------------------------------------------------
  /**
   * Requests {name, at, cpu, io, cpu2}: each arrives at `at`, needs `cpu` ms of CPU to parse it and start its I/O,
   * waits `io` ms for the device, then needs `cpu2` ms to answer. One core.
   *   H.events(reqs, mode, {stack, sw})  mode: 'loop' (one thread, an event queue, asynchronous I/O) | 'threads' (a
   *   thread per request, blocking I/O, first come first served on the core, sw ms per switch) | 'serial' (one
   *   thread, blocking I/O: the next request waits for the whole of this one)
   *   -> {segs: [{job, start, end, what}] (the core's work), io: [{job, start, end}], done: {name: t}, trace (loop
   *   only: [{t, ev, job, queue: [..], pending: [..], start, end}]), maxThreads, makespan, mean, busy}
   */
  H.events = function (reqs, mode, o) {
    o = o || {};
    const sw = o.sw || 0, segs = [], io = [], done = {}, trace = [];
    const R = reqs.map((r) => Object.assign({}, r));
    let t = 0, maxThreads = 1;
    if (mode === 'serial') {
      for (const r of R.slice().sort((a, b) => a.at - b.at)) {
        t = Math.max(t, r.at);
        segs.push({ job: r.name, start: t, end: t + r.cpu, what: 'parse' }); t += r.cpu;
        io.push({ job: r.name, start: t, end: t + r.io }); t += r.io;
        segs.push({ job: r.name, start: t, end: t + r.cpu2, what: 'answer' }); t += r.cpu2;
        done[r.name] = t;
      }
    } else if (mode === 'loop') {
      // events: an arrival or an I/O completion, queued in the order they happen (ties: arrivals first, then by name)
      const future = R.map((r) => ({ t: r.at, ev: 'request', job: r.name })), queue = [];
      const take = (upto) => {
        const due = future.filter((e) => e.t <= upto).sort((a, b) => a.t - b.t || (a.ev === b.ev ? 0 : a.ev === 'request' ? -1 : 1) || (a.job < b.job ? -1 : 1));
        for (const e of due) { future.splice(future.indexOf(e), 1); queue.push(e); }
      };
      while (future.length || queue.length) {
        take(t);
        if (!queue.length) { t = Math.min(...future.map((e) => e.t)); continue; }
        const e = queue.shift(), r = R.find((x) => x.name === e.job);
        const cost = e.ev === 'request' ? r.cpu : r.cpu2, start = t;
        segs.push({ job: r.name, start, end: t + cost, what: e.ev === 'request' ? 'parse' : 'answer' });
        t += cost;
        if (e.ev === 'request') { io.push({ job: r.name, start: t, end: t + r.io }); future.push({ t: t + r.io, ev: 'io done', job: r.name }); } else done[r.name] = t;
        take(t);
        trace.push({ t: start, end: t, ev: e.ev, job: r.name, queue: queue.map((q) => q.ev + ' ' + q.job), pending: future.filter((f) => f.ev === 'io done').map((f) => f.job) });
      }
    } else {
      // a thread per request: ready queue FIFO; a thread runs its CPU burst to the end, then blocks on I/O
      const st = R.map((r) => ({ r, phase: 0, readyAt: r.at })), ready = [];
      let last = null;
      const arrive = (upto) => {
        const due = st.filter((x) => x.readyAt !== null && x.readyAt <= upto && !ready.includes(x)).sort((a, b) => a.readyAt - b.readyAt || (a.phase - b.phase) || (a.r.name < b.r.name ? -1 : 1));
        for (const x of due) ready.push(x);
      };
      while (st.some((x) => x.phase < 2)) {
        arrive(t);
        if (!ready.length) { t = Math.min(...st.filter((x) => x.readyAt !== null && x.phase < 2).map((x) => x.readyAt)); continue; }
        const x = ready.shift();
        if (last !== null && last !== x && sw) { segs.push({ job: '·', start: t, end: t + sw, what: 'switch' }); t += sw; }
        last = x;
        const cost = x.phase === 0 ? x.r.cpu : x.r.cpu2;
        segs.push({ job: x.r.name, start: t, end: t + cost, what: x.phase === 0 ? 'parse' : 'answer' }); t += cost;
        x.readyAt = null;
        if (x.phase === 0) { x.phase = 1; io.push({ job: x.r.name, start: t, end: t + x.r.io }); x.readyAt = t + x.r.io; } else { x.phase = 2; done[x.r.name] = t; }
      }
    }
    // threads alive at once: requests that have arrived and are not finished, at each arrival
    if (mode === 'threads') maxThreads = Math.max(...R.map((r) => R.filter((x) => x.at <= r.at && done[x.name] > r.at).length));
    const fin = Object.values(done), makespan = Math.max(...fin);
    const mean = R.reduce((s, r) => s + (done[r.name] - r.at), 0) / R.length;
    const busy = segs.filter((s) => s.what !== 'switch').reduce((s, g) => s + g.end - g.start, 0);
    return { segs, io, done, trace, maxThreads: mode === 'threads' ? maxThreads : 1, makespan, mean, busy, stackKB: (mode === 'threads' ? maxThreads : 1) * (o.stack || 64) };
  };
})(globalThis.Proses = globalThis.Proses || {});
