// Part 7, synchronisation tools: the families, and the helpers its topics share with part 8 (S.P07). Every picture
// here is drawn from the thread-step machine (S.Sync, src/core/sync-*.js) and every verdict from the model checker
// (S.MC, src/core/mc-*.js): a snapshot gives each thread's place and state, every lock's owner and queue, every
// semaphore's value and every shared variable; a checker's answer gives the states searched and, for a broken
// program, the failing schedule, which is replayed step by step with full snapshots.
// A frame carries meta.vals, the numbers its narration may quote, all taken from those engines.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'sync', order, title, blurb });
  fam('p07-race', 10, 'The race', 'count++ is three machine steps, and two threads can interleave them: every schedule drawn, and the lost update found.');
  fam('p07-cs', 20, 'The critical-section problem', 'Mutual exclusion, progress and bounded waiting; the attempts that break each one, and Peterson\'s algorithm, on a plain machine and on one that reorders stores.');
  fam('p07-atomic', 30, 'Atomic instructions and spinlocks', 'Test-and-set, compare-and-swap and fetch-and-add, the spinlocks built from them, ticket locks that serve in order, and queue locks.');
  fam('p07-sleep', 40, 'Sleeping locks, semaphores and conditions', 'Mutexes with sleep queues, counting and binary semaphores, condition variables with signal and broadcast, and monitors.');
  fam('p07-structs', 50, 'Lock-based data structures', 'A counter, a list, a hash table and a queue, each with one big lock and with finer locks, and what each costs.');
  fam('p07-checker', 60, 'Checking concurrent programs', 'A model checker explores every schedule of a small program, prunes the ones that cannot differ, and hands back a failing schedule to replay.');

  const H = (S.P07 = {});
  const Y = () => S.Sync, MC = () => S.MC;
  H.KS = () => S.Kit.sync;
  H.K7 = () => S.Kit.sync7;

  /** register a topic whose narration may carry the engines' `value` marks: the topic player shows plain text, so
   *  the marks are taken out of every frame's sentence */
  H.topic = function (t) {
    const run = t.run;
    t.run = function (inp) {
      const out = run.call(this, inp), fr = Array.isArray(out) ? out : out.frames;
      for (const f of fr) if (f && typeof f.say === 'string') f.say = f.say.replace(/`/g, '');
      return out;
    };
    return S.topic(t);
  };

  // ---- words ----
  H.plural = (k, word, many) => k + ' ' + (Number(k) === 1 ? word : many || word + 's');
  H.list = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  H.cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  H.box = (x, y, w, h) => ({ x, y, w, h });
  H.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x, y, text, cls: cls === undefined ? 'strong' : cls }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  H.title = (key, x, y, text) => ({ key, kind: 'text', x, y, text, cls: 'title' });
  H.def = (title, lines) => ({ sections: [{ id: 'd', kind: 'math', title, text: lines.join('\n') }] });

  // ---- programs ----
  /** the text of one op of a program, for a listing */
  H.opText = function (o) {
    if (o.label && !/^(enters|leaves|thinks|eats|reads|writes)/.test(o.label)) return o.label;
    switch (o.op) {
      case 'enter': return 'critical section';
      case 'leave': return 'leave it';
      case 'lock': return 'lock(' + o.m + ')';
      case 'unlock': return 'unlock(' + o.m + ')';
      case 'wait': return 'wait(' + o.s + ')';
      case 'post': return 'post(' + o.s + ')';
      default: return o.label || o.op;
    }
  };
  /** a thread's program as listing lines (labels resolved, as the machine runs it) */
  H.lines = (th) => (th._asm || Y().assemble(th.prog)).map(H.opText);
  /** what a thread is doing, in a few words, for the line under its card */
  H.doing = function (spec, st, th) {
    if (th.state === 'done') return 'done';
    if (th.state === 'error') return 'failed';
    if (th.state === 'blocked') {
      const on = th.on, nm = on.kind === 'mutex' ? st.mutex[on.id] && on.id : on.id;
      return 'waits on ' + (spec.names && spec.names[nm] || nm);
    }
    const prog = spec.threads[th.id]._asm || Y().assemble(spec.threads[th.id].prog);
    return 'next: line ' + (th.pc + 1) + (prog[th.pc] ? '' : '');
  };
  /** thread cards from a snapshot */
  H.cards = (spec, st, act, o) => st.threads.map((th) => ({ id: th.id, name: th.name, state: th.state === 'ready' && act === th.id ? 'running' : th.state, act: act === th.id, cs: th.cs > 0, sub: (o && o.sub) ? o.sub(th) : H.doing(spec, st, th), subCls: th.state === 'blocked' ? 'hot' : '' }));
  /** a listing of one program with the threads that run it marked at their next line */
  H.code = function (prefix, x, y, spec, st, tids, o) {
    o = o || {};
    const prog = spec.threads[tids[0]], lines = o.lines || H.lines(prog);
    const marks = lines.map(() => []);
    for (const i of tids) {
      const th = st.threads[i];
      if (th.state === 'done' || th.pc >= lines.length) continue;
      marks[th.pc].push({ name: th.name, cls: S.Kit.sync7.stateCls(th.state === 'ready' && o.act === i ? 'running' : th.state) + (o.act === i ? ' act' : '') });
    }
    const act = o.act !== undefined && tids.includes(o.act) && o.line !== undefined ? o.line : -1;
    return H.KS().code({ prefix, x, y, lines, marks, act, hot: o.hot, lh: o.lh || 30, size: o.size || 14, markW: o.markW || 34, title: o.title, textW: o.textW });
  };
  /** every synchronisation object of a snapshot as a panel: locks, semaphores, conditions, rw locks, barriers */
  H.objects = function (prefix, x, y, spec, st, o) {
    o = o || {};
    const items = [], nm = (i) => st.threads[i].name, gap = o.gap || 50;
    let yy = y;
    const lit = o.lit || null;
    // the names column fits the longest name
    const allNames = [].concat((spec.mutexes || []).map((x) => (typeof x === 'string' ? x : x.name || x.id)), (spec.sems || []).map((x) => x.name || x.id), Object.keys(st.cond), Object.keys(st.rw), Object.keys(st.barrier));
    o = Object.assign({}, o, { nameW: o.nameW || Math.max(64, ...allNames.map((t) => Math.ceil(S.textWidth(String(t), 16, { mono: true, bold: true })) + 14)) });
    for (const id of Object.keys(st.mutex)) {
      const m = st.mutex[id], name = (spec.mutexes || []).map((x) => (typeof x === 'string' ? { id: x } : x)).find((x) => x.id === id);
      const r = H.K7().mutex({ prefix: prefix + 'm' + id, x, y: yy, name: (name && name.name) || id, owner: m.owner === null ? null : nm(m.owner), ownerCls: m.owner === null ? '' : S.Kit.sync7.pcls(m.owner), queue: m.queue.map(nm), act: lit === id, nameW: o.nameW });
      items.push(...r.items); yy += gap;
    }
    for (const id of Object.keys(st.sem)) {
      const s = st.sem[id], name = (spec.sems || []).find((x) => x.id === id);
      const r = H.KS().sem({ prefix: prefix + 's' + id, x, y: yy - 3, name: (name && name.name) || id, value: s.value, queue: s.queue.map(nm), act: lit === id, nameW: o.nameW || 76, perRow: o.perRow || 6 });
      items.push(...r.items); yy += Math.max(gap, r.h + 8);
    }
    for (const id of Object.keys(st.cond)) {
      const c = st.cond[id];
      const r = H.K7().mutex({ prefix: prefix + 'c' + id, x, y: yy, name: id, owner: null, queue: c.queue.map(nm), kind: 'cond', act: lit === id, nameW: o.nameW, label: 'condition', none: 'no one sleeps here' });
      // a condition has no owner: its middle box says how many sleep on it
      r.items[1].text = c.queue.length + ' asleep'; r.items[1].cls = 'mxown free'; r.items[1].size = 13;
      r.items.splice(2, 1);
      items.push(...r.items); yy += gap;
    }
    for (const id of Object.keys(st.rw)) {
      const l = st.rw[id], who = l.writer !== null ? nm(l.writer) + ' writes' : l.readers.length ? l.readers.map(nm).join(', ') + ' read' : null;
      const r = H.K7().mutex({ prefix: prefix + 'r' + id, x, y: yy, name: id, owner: who, ownerCls: l.writer !== null ? 'wr' : 'rd', queue: l.queue.map((q) => nm(q.tid) + (q.mode === 'w' ? '·w' : '·r')), act: lit === id, nameW: o.nameW, ownerW: Math.max(58, S.textWidth(who || 'free', 15, { bold: true }) + 20), label: 'holders' });
      items.push(...r.items); yy += gap;
    }
    for (const id of Object.keys(st.barrier)) {
      const b = st.barrier[id], spB = (spec.barriers || []).find((x) => x.id === id);
      const r = H.K7().mutex({ prefix: prefix + 'b' + id, x, y: yy, name: id, owner: b.waiting.length + ' of ' + spB.n, queue: b.waiting.map(nm), act: lit === id, nameW: o.nameW, label: 'arrived', none: 'nobody waits' });
      r.items[1].cls = 'mxown free'; r.items[1].size = 13;
      r.items.splice(2, 1);
      items.push(...r.items); yy += gap;
    }
    return { items, h: yy - y };
  };
  /** the shared variables a program names (in the order the spec declares them) */
  H.usedVars = (spec) => { const used = new Set(); for (const th of spec.threads) for (const o of th.prog) if (o.v) used.add(o.v); return Object.keys(spec.vars || {}).filter((v) => used.has(v)); };
  /** the step indexes of a lasso's cycle on a strip (drawn with a pink outline: K7.strip's lit) */
  H.cycleLit = (cycle) => (cycle ? Array.from({ length: cycle[1] - cycle[0] }, (_, i) => cycle[0] + i) : []);
  /** shared variables of a snapshot as rows (arrays shown as [a, b]) */
  H.show = (v) => (v === null || v === undefined ? '–' : Array.isArray(v) ? '[' + v.map(H.show).join(', ') + ']' : String(v));
  H.varRows = (st, names, act) => names.map((n) => ({ name: n, value: H.show(st.vars[n]), act: act === n }));

  // ---- schedules ----
  /** the text of a schedule choice: a thread's name, or a flush of its store buffer */
  H.chName = (M, c) => (typeof c === 'string' ? (c[0] === 'f' ? 'fl' + M.threads[M.owner(c)].name.replace(/^T/, '') : M.threads[M.owner(c)].name + ':' + c.split(':')[1]) : M.threads[c].name);
  H.stripSteps = (spec, sched) => { const M = Y().machine(spec); return sched.map((c) => ({ tid: M.owner(c), text: typeof c === 'string' && c[0] === 'f' ? 'fl' : spec.threads[M.owner(c)].name || 'T' + M.owner(c), cls: typeof c === 'string' && c[0] === 'f' ? 'flush ' + S.Kit.sync7.pcls(M.owner(c)) : null })); };
  /** check a spec and replay its failing schedule (if any) with full snapshots: {res, steps, end, sched} */
  H.check = function (spec, opts) {
    const res = MC().verify(spec, opts);
    let sched = null, steps = null, end = null, lasso = null;
    if (res.safety.violation) { sched = res.safety.violation.schedule; steps = res.replay.steps; end = res.replay.end; }
    else if (res.liveness) {
      const bad = res.liveness.results.find((r) => !r.holds);
      if (bad) {
        lasso = bad;
        sched = bad.lasso.prefix.concat(bad.lasso.cycle);
        const rp = MC().replay(() => Y().machine(spec), sched, spec.check);
        steps = rp.steps; end = null;
      }
    }
    return { res, sched, steps, end, lasso, stats: res.safety.stats };
  };
  /** the checker's verdict in words, with its numbers (as meta.vals) */
  H.verdictText = function (c) {
    const st = c.stats, r = c.res;
    if (r.safety.violation) return { kind: 'bad', head: { invariant: 'Invariant broken', deadlock: 'Deadlock found', assert: 'Assertion failed' }[r.safety.violation.kind] || 'Violation', vals: [st.states, c.sched.length] };
    if (c.lasso) return { kind: 'warn', head: c.lasso.kind === 'stuck' ? 'Can be stuck for ever' : 'Can starve', vals: [st.states, c.lasso.lasso.prefix.length, c.lasso.lasso.cycle.length] };
    return { kind: 'ok', head: r.verdict === 'ok' ? 'Correct in every schedule' : 'Nothing found within the bounds', vals: [st.states] };
  };


  // ---- replaying a checker's schedule ----
  H.nums = (s) => [...String(s).matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => +m[0]);
  /** one frame a step of a checked schedule (chk from H.check): draw(state, {act, line, op, obj, upto, k, step,
   *  inCycle}) gives the items; a liveness lasso's cycle is replayed `rounds` times (default 2), its first step
   *  announced. Frames carry meta.vals (the numbers of the engine's sentence and the step number), meta.next
   *  (who moves next) and meta.options (every thread's name) for H.predictNext. Returns the frames added. */
  H.replay = function (F, spec, chk, draw, o) {
    o = o || {};
    let sched = chk.sched || [], steps = chk.steps || [];
    const cyc = chk.lasso ? chk.lasso.lasso.cycle : [], pre = chk.lasso ? chk.lasso.lasso.prefix.length : -1;
    if (chk.lasso && cyc.length && (o.rounds || 2) > 1) {
      for (let r = 1; r < (o.rounds || 2); r++) sched = sched.concat(cyc);
      steps = MC().replay(() => Y().machine(spec), sched, spec.check).steps;
    }
    const M = Y().machine(spec), names = spec.threads.map((t, i) => t.name || 'T' + i), strip = H.stripSteps(spec, sched);
    const out = [];
    steps.forEach((s, k) => {
      const inCycle = pre >= 0 && k >= pre, round = inCycle && cyc.length ? Math.floor((k - pre) / cyc.length) + 1 : 0;
      const first = inCycle && (k - pre) % cyc.length === 0;
      let say = s.say;
      if (first) say = (round === 1 ? `The cycle begins: from here the same ${H.plural(cyc.length, 'step')} can repeat for ever. ` : `Round ${round} of the cycle: back in the same state, the same ${H.plural(cyc.length, 'step')} again. `) + say;
      const next = steps[k + 1];
      const f = F.add({ items: draw(s.state, { act: s.kind === 'flush' ? M.owner(sched[k]) : s.tid, line: s.pc, op: s.op, obj: s.obj, kind: s.kind, upto: k + 1, k, step: s, strip, inCycle, round, sched, cycle: pre >= 0 && cyc.length ? [pre, sched.length] : null }), say, meta: { vals: H.nums(s.say).concat([k + 1, cyc.length, round, pre]), next: next && typeof sched[k + 1] === 'number' ? names[sched[k + 1]] : null, options: names.length > 1 ? names : null, step: k } });
      out.push(f);
    });
    return out;
  };

  // ---- predictions ----
  /** a prediction on the thread that takes the next step of a replay: frames carry meta.next (the thread's name) */
  H.predictNext = (ask, every) => ({ once: !every, at: (f) => !!(f.meta && f.meta.next && f.meta.options), pick: 'option', ask: ask || 'Which thread does the failing schedule run next?', options: (fr, i) => fr[i].meta.options, answer: (fr, i) => fr[i].meta.next, explain: (fr, i) => fr[i + 1].say });
})(globalThis.Proses = globalThis.Proses || {});
