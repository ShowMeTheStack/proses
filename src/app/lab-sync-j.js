// The Sync lab itself: a C program with threads, mutexes, condition variables and semaphores, its specification as
// plain lines, and three ways to run it: by hand (the student picks the thread at every choice), a seeded random
// schedule, or "Check it" (the model checker with partial-order reduction and bounds, or PCT and random runs for
// bigger programs, then the liveness properties over every reachable state, with the shortest failing schedule or
// a starvation lasso replayed step by step). Statement or machine granularity.
// Side tabs: Tables, Metrics, Programs (every ready-made program, correct and broken), Step model (the same
// problem in the step machine's catalogue, checked there, and for a data structure its scaling with threads), Trace.
(function (S) {
  'use strict';
  const L = S.Labs, SL = S.SyncLab;
  const q = (v) => '`' + v + '`';
  const MODES = [{ value: 'hand', label: 'Step by hand: you pick the thread' }, { value: 'random', label: 'A random schedule, from the seed' }, { value: 'check', label: 'Check it: search the schedules' }];
  const SEARCH = [{ value: 'auto', label: 'Every schedule, then PCT if too big' }, { value: 'full', label: 'Every schedule (model checker)' }, { value: 'pct', label: 'PCT: random priorities, d changes' }, { value: 'random', label: 'Seeded random runs' }];
  const BOUND = [{ value: -1, label: 'no bound' }, { value: 0, label: '0 (no preemption)' }, { value: 1, label: 'at most 1' }, { value: 2, label: 'at most 2' }, { value: 3, label: 'at most 3' }];
  const def = () => SL.prog('phil');
  const valuesOf = (p) => ({ source: 'c', src: p.src, spec: p.spec.map((r) => Object.assign({}, r)), gran: p.gran, mode: p.mode, sched: '' });
  const CHIPS = ['race', 'peterson-check', 'buffer', 'cv-if', 'rw-readers', 'rw-fair', 'phil', 'phil-ordered', 'barber-nomutex', 'bug-wakeup', 'lock-order', 'livelock', 'list-broken'];

  // ---- results kept while the page is open (a check can take seconds) -----------------------------------------
  const memo = new Map();
  const keep = (k, f) => { if (memo.has(k)) return memo.get(k); const v = f(); memo.set(k, v); if (memo.size > 24) memo.delete(memo.keys().next().value); return v; };

  const checkOpts = (v, ctx) => ({ search: v.search, preempt: v.preempt < 0 ? Infinity : v.preempt, maxStates: v.maxStates, runs: v.runs, seed: ctx.seed, depth: 3 });
  const checkKey = (v, o) => JSON.stringify([v.src, v.spec, v.gran, o]);
  /** a check in the worker, with the states made so far and a Cancel button under the stage; null when there is
   *  no worker (the check then runs on the page) or the answer is already known */
  async function remoteCheck(v, ctx, page) {
    const o = checkOpts(v, ctx), key = checkKey(v, o);
    if (memo.has(key) || !SL.remote || !SL.remote.available()) return null;
    const P = SL.prepare(v);
    if (P.error) return null;
    const { h } = S.UI;
    const msg = h('span', 'Searching the schedules in the background…');
    const stop = h('button.btn.lab-cancel', { type: 'button', id: 'btnSyncCancel' }, 'Cancel');
    stop.addEventListener('click', () => SL.remote.cancel('user'));
    if (page && page.sayEl) { page.sayEl.classList.remove('bad'); page.sayEl.innerHTML = ''; page.sayEl.append(h('span.step', 'Checking'), msg, ' ', stop); }
    const t0 = Date.now();
    try {
      const R = await SL.remote.check(v, o, (n) => { msg.textContent = 'Searching the schedules: ' + n + ' states made so far (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)…'; });
      if (R.schedule) { const rp = SL.replay(P, R.schedule); R.beats = rp.beats; R.names = rp.names; }
      keep(key, () => R);
      return null;
    } catch (e) {
      if (!e.cancelled) return null;
      // a newer run took over: this one's answer would only overwrite it
      if (!e.user) return new Promise(() => {});
      const run = { beats: SL.replay(P, []).beats };
      const { frames } = SL.frames(P, run, { narrow: ctx.narrow, mode: 'random' });
      frames[0].say = 'The check was cancelled after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s. Run it again, or lower the states limit, or try PCT for a quicker hunt.';
      frames[0].metrics = [{ label: 'Check', value: 'cancelled', cls: 'act' }];
      return { frames, trace: [{ kind: 'cancelled', say: frames[0].say }] };
    }
  }

  function runIt(v, ctx) {
    const P = SL.prepare(v);
    if (P.error) return { error: P.error };
    const mode = v.mode, picks = String(v.sched || '').trim().split(/[\s,]+/).filter(Boolean);
    let run;
    if (mode === 'hand') { const r = SL.hand(P, picks, 600); run = Object.assign(r, { picks }); }
    else if (mode === 'random') run = SL.random(P, ctx.seed, v.steps);
    else {
      const o = checkOpts(v, ctx);
      const R = keep(checkKey(v, o), () => SL.check(P, o));
      // with no failure to replay, one schedule among those checked is played instead, from the seed
      run = { R, beats: R.beats || SL.random(P, ctx.seed, 60).beats };
    }
    return { P, run, mode };
  }

  function build(v, ctx) {
    if (v.source === 'model') return SL.machineBuild(v, ctx);
    const x = runIt(v, ctx);
    if (x.error) return { error: x.error, frames: [] };
    const { P, run, mode } = x, R = run.R, asserts = SL.asserts(v.src);
    const { frames } = SL.frames(P, run, { narrow: ctx.narrow, mode });
    const beats = run.beats, n = beats.length;
    const trace = beats.map((b, k) => ({ kind: b.rec ? (b.names[b.rec.tid] || {}).name || 'step' : 'start', say: k ? SL.say(b, beats[k - 1], P) : SL.say(b, null, P), tid: b.rec ? b.rec.tid : null, lines: b.rec ? b.rec.lines : [] }));
    frames.forEach((f, k) => {
      const b = beats[k];
      f.say = trace[k].say;
      f.tables = SL.tables(P, b, asserts);
      const blocked = b.world.threads.filter((t) => t.state === 'blocked').length, held = b.world.mutexes.filter((m) => m.owner).length;
      f.metrics = [{ label: 'Step', value: k + ' of ' + (n - 1) }, { label: 'Threads', value: b.world.threads.filter((t) => t.state !== 'done').length + ' alive' }, { label: 'Blocked', value: blocked, cls: blocked ? 'bad' : '' }, { label: 'Mutexes held', value: held + ' of ' + b.world.mutexes.length }];
      const broke = SL.broken(P, b);
      if (broke && mode !== 'check') { if (broke.kind === 'invariant') { const why = SL.explain(P.spec, b, broke.name); f.say += ' Here the property "' + broke.name + '" is broken' + (why ? ': ' + why : '') + '.'; } f.metrics.push({ label: 'Specification', value: broke.kind === 'deadlock' ? 'deadlock' : 'broken', cls: 'bad' }); }
      if (R) f.metrics = checkMetrics(R).concat(f.metrics);
    });
    if (mode === 'hand' && n) {
      const last = frames[n - 1], b = beats[n - 1];
      if (run.bad) last.say += ' Your schedule asks for ' + q(run.bad.want) + ' next, but only ' + run.bad.could.map(q).join(', ') + ' can run now: click one of them, or edit the choices.';
      else if (run.waiting) last.say += ' Your turn: ' + run.waiting.map((c) => q((b.names[c] || {}).name || c)).join(', ') + ' can run. Click one: it runs until it does something another thread could notice.';
    }
    if (mode === 'random' && run.limit) frames[n - 1].say += ' The run stops after ' + q(n - 1) + ' steps (the limit in the setup).';
    if (R) checkSay(R, frames, beats, P);
    for (const f of frames) f.hold = mode === 'check' ? 1300 : undefined;
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics, sync: { P, run, mode } };
  }

  function checkMetrics(R) {
    const st = R.stats, out = [{ label: 'Verdict', value: SL.verdictBox(R).head, cls: R.verdict === 'ok' ? 'good' : R.verdict === 'violation' || R.verdict === 'starve' ? 'bad' : 'act' }];
    if (st) out.push({ label: 'States searched', value: st.states }, { label: 'Transitions', value: st.transitions }, { label: R.how === 'graph' ? 'Search' : 'Pruned by reduction', value: R.how === 'graph' ? 'every state, breadth first' : st.slept, note: R.how === 'graph' ? 'liveness needs the whole graph' : 'sleep sets' });
    if (R.runs) out.push({ label: /random/.test(R.how) ? 'Random runs' : 'PCT runs', value: R.runs + ' (' + R.steps + ' steps)' });
    if (R.live) out.push({ label: 'Liveness', value: R.live.results.filter((x) => x.holds).length + ' of ' + R.live.results.length + ' hold', note: 'weak fairness' + (R.live.complete ? '' : ', within the bound') });
    if (R.schedule) out.push({ label: 'Schedule', value: R.schedule.length + ' steps' });
    if (R.limit) out.push({ label: 'States limit', value: R.limit, note: 'raised by itself while it alone stopped the search' });
    out.push({ label: 'Time', value: R.ms, unit: 'ms' });
    return out;
  }
  function checkSay(R, frames, beats, P) {
    const st = R.stats, n = frames.length;
    const where = st ? (R.how === 'graph' ? 'every reachable state, ' + q(st.states) + ' of them, breadth first' : q(st.states) + ' states, with ' + q(st.slept) + ' choices pruned by partial-order reduction') : '';
    const pct = R.runs ? q(R.runs) + ' ' + (/random/.test(R.how) ? 'random' : 'PCT') + ' runs' : '';
    const searched = [where, pct].filter(Boolean).join(', then ');
    if (R.verdict === 'violation') {
      frames[0].say = 'The checker searched ' + searched + ' and found a failure: ' + SL.rename(R.violationSay, beats[n - 1], P).replace(/\.$/, '') + '. The shortest schedule there has ' + q(R.schedule.length) + ' steps; here it is, step by step.';
      if (R.kind === 'invariant') { const why = SL.explain(P.spec, beats[n - 1], R.name); frames[n - 1].say += ' Here the property "' + R.name + '" is broken' + (why ? ': ' + why : '') + '.'; }
    } else if (R.verdict === 'starve') {
      const bad = R.live.results.find((x) => !x.holds);
      frames[0].say = 'Safety holds in ' + searched + ', but ' + q(bad.name) + ' can fail: the others can go round a cycle of ' + q(R.cycleLen) + ' steps for ever while it never gets there, and the schedule is fair (every thread that can run all along gets turns). The way in takes ' + q(R.cycleFrom) + ' steps; the cycle is shown twice.';
      if (frames[R.cycleFrom + 1]) frames[R.cycleFrom + 1].say = 'The cycle begins: from here these ' + q(R.cycleLen) + ' steps can repeat for ever. ' + frames[R.cycleFrom + 1].say;
      if (frames[R.cycleFrom + R.cycleLen + 1]) frames[R.cycleFrom + R.cycleLen + 1].say = 'Round 2 of the cycle, from the same state: ' + frames[R.cycleFrom + R.cycleLen + 1].say;
    } else {
      const lv = R.live ? ' Liveness: ' + R.live.results.map((x) => x.name).join(', ') + (R.live.complete ? ' hold' : ' hold within the bound') + ', assuming weak fairness.' : '';
      if (frames[1]) frames[1].say = 'One schedule out of all those searched, chosen by the seed: ' + frames[1].say.charAt(0).toLowerCase() + frames[1].say.slice(1);
      frames[0].say = (R.verdict === 'ok' ? 'Correct in every schedule: the checker searched ' + searched + ' and found no deadlock, no failed assertion and no broken property.' : R.verdict === 'none' ? (R.searchSay || 'The runs found nothing wrong.') + ' Likely correct, not proven.' : 'Nothing found in ' + searched + ', but the search stopped at its bound, so this is no proof: raise the states limit, or try PCT.') + lv;
    }
  }

  // ---- the lab ---------------------------------------------------------------------------------------------------
  L.add({
    id: 'sync', part: 'sync', title: 'Sync lab', wide: true,
    blurb: 'Write threads in C with mutexes, condition variables and semaphores, or open a classic problem, correct or broken. Step it by hand, run a seeded schedule, or let the model checker search every schedule against your specification.',
    setup: {
      fields: [
        { id: 'source', label: 'Source', type: 'select', group: 'Program', options: [{ value: 'c', label: 'A C program (the editor)' }, { value: 'model', label: 'A step-machine program (ready-made)' }], def: 'c', help: 'The step machine runs ready-made programs of primitive steps, including what this C cannot write: test-and-set, compare-and-swap, ticket and queue locks, Peterson on a machine that buffers stores, the Chandy–Misra table.' },
        { id: 'cat', label: 'Step-machine program', type: 'select', options: SL.CATALOG, def: () => (SL.CATALOG.find((o) => o.value === 'lock-tas') || SL.CATALOG[0] || {}).value, show: (v) => v.source === 'model' },
        { id: 'src', label: 'Program', type: 'code', def: () => def().src, files: 'sync', minLines: 14, maxHeight: 520, show: (v) => v.source !== 'model' },
        { id: 'spec', label: 'Properties', type: 'table', group: 'Specification', def: () => def().spec, minRows: 0, maxRows: 8, live: false, show: (v) => v.source !== 'model',
          help: 'Each line is checked in every state: **always** and **never** take a C expression over the globals (also `in(f)`, threads inside function f; `value(s)`, a semaphore; `sum`, `max`, `min`, `count(a, v)`); **at the end** once all have finished; **eventually** as "philosopher calls eat". An `assert` in the code counts too.',
          columns: [{ id: 'kind', label: 'Kind', type: 'select', options: SL.KINDS, width: '118px' }, { id: 'what', label: 'Property', type: 'text', required: false, maxLen: 90 }],
          newRow: () => ({ kind: 'always', what: '' }),
          check: (r) => (r.kind !== 'deadlock' && !String(r.what || '').trim() ? { what: 'write the property' } : null) },
        { id: 'gran', label: 'Granularity', type: 'select', group: 'Running', options: [{ value: 'statement', label: 'Statement: each line is one step' }, { value: 'machine', label: 'Machine: loads and stores are steps' }], def: () => def().gran, show: (v) => v.source !== 'model', help: 'At machine granularity `count++` is a load, an add and a store, so a race can show.' },
        { id: 'mode', label: 'Run mode', type: 'select', options: MODES, def: () => def().mode },
        { id: 'sched', label: 'Your choices so far', type: 'text', def: '', placeholder: 'click a thread on the stage', pattern: '^[A-Za-z0-9_:\\s]*$', patternWhy: 'thread names, like P0 P1 main',  show: (v) => v.mode === 'hand', help: 'Each name runs that thread until it does something another thread could notice. A lone choice is taken for you.' },
        { id: 'steps', label: 'Steps to run', type: 'number', min: 5, max: 400, def: 80, show: (v) => v.mode === 'random' },
        { id: 'search', label: 'Search', type: 'select', options: SEARCH, def: 'auto', show: (v) => v.mode === 'check' && v.source !== 'model' },
        { id: 'preempt', label: 'Preemption bound', type: 'select', options: BOUND, def: -1, show: (v) => v.mode === 'check' && (v.source === 'model' || v.search === 'auto' || v.search === 'full'), help: 'A preemption takes the processor from a thread that could go on. Most bugs need very few.' },
        { id: 'maxStates', label: 'States, at most', type: 'number', min: 200, max: 40000, def: 10000, show: (v) => v.mode === 'check' && (v.source === 'model' || v.search === 'auto' || v.search === 'full') },
        { id: 'runs', label: 'Runs', type: 'number', min: 10, max: 1000, def: 150, show: (v) => v.mode === 'check' && v.source !== 'model' && v.search !== 'full' },
      ],
      presets: CHIPS.map((id) => ({ label: SL.prog(id).label, values: valuesOf(SL.prog(id)) })),
    },
    async run(v, ctx) {
      const P = S.app && S.app.page && S.app.page.lab;
      hook();
      if (v.mode === 'check' && v.source !== 'model' && typeof document !== 'undefined') {
        const r = await remoteCheck(v, ctx, P);
        if (r) return r;
        if (P && P.sayEl && !memo.has(checkKey(v, checkOpts(v, ctx)))) {
          P.sayEl.innerHTML = ''; P.sayEl.append(S.UI.h('span.step', 'Checking'), 'Searching the schedules… a bigger program can take some seconds.');
          await new Promise((res) => setTimeout(res, 40));
        }
      } else if (SL.remote) SL.remote.cancel();
      return build(v, ctx);
    },
    views: [
      { id: 'programs', label: 'Programs', render: (host, ctx) => SL.renderPrograms(host, ctx) },
      { id: 'listing', label: 'Listing', render: (host, ctx) => SL.renderListing(host, ctx) },
      { id: 'model', label: 'Model', render: (host, ctx) => SL.renderModel(host, ctx) },
    ],
  });
  SL.build = build;
  SL.checkSay = checkSay;
  SL.checkMetrics = checkMetrics;

  // ---- by hand: a click on a thread ----------------------------------------------------------------------------
  function hook() {
    if (typeof setTimeout === 'undefined') return;
    setTimeout(() => {
      const P = S.app && S.app.page && S.app.page.lab;
      if (!P || !P.lab || P.lab.id !== 'sync' || !P.stage) return;
      P.stage.onPick = (key) => SL.pick(P, key);
    }, 0);
  }
  SL.pick = async function (P, key) {
    const r = P.res && P.res.sync;
    if (!r || r.mode !== 'hand' || !r.run.waiting || P.i !== P.frames.length - 1) return;
    const m = /^pick:(.+)$/.exec(key);
    if (!m) return;
    const list = r.run.picks.slice(0, r.run.used);
    if (m[1] === 'undo') list.pop(); else list.push(m[1]);
    const v = Object.assign({}, P.values, { sched: list.join(' ') });
    P.values = v; P.setup.set(v); P.save();
    await P.runNow(false);
    if (P.frames.length > 1) { P.go(P.frames.length - 2, true); P.go(P.frames.length - 1); }
  };
  SL.open = async function (P, id) {
    const p = SL.prog(id);
    if (!P || !p) return;
    const v = S.LabSetup.merge(P.lab, Object.assign({}, P.values, valuesOf(p)));
    P.values = v; P.setup.set(v); P.save();
    await P.runNow(false);
  };
})(globalThis.Proses = globalThis.Proses || {});
