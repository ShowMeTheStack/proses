// Part 7, the critical-section problem: two threads, each looping through an entry protocol, the critical section
// and an exit protocol, over shared flags and a turn. Three requirements: mutual exclusion (never both inside),
// progress (if someone wants in, someone gets in) and bounded waiting (a waiting thread gets in after a bounded
// number of the other's entries). The broken attempts are checked by the model checker, which finds the schedule
// that breaks one requirement and replays it; Peterson's algorithm is stepped under a seeded scheduler and then
// proved over every reachable state.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7;
  const NAMES = { 'check-then-set': 'look, then raise a flag', 'flags-only': 'raise a flag, then wait', 'turn-only': 'strict turns', correct: 'Peterson: flags and a turn' };

  /** two listings side by side, the shared variables, the room with who is inside, the requirement table */
  function duo(spec, st, o) {
    o = o || {};
    const items = [], inside = st.threads.filter((t) => t.cs > 0).map((t) => t.name);
    st.threads.forEach((th, i) => {
      const x = i * 300;
      items.push(...K7().threads({ prefix: 'th' + i, x, y: 0, threads: [{ id: i, name: th.name, state: th.state === 'ready' && o.act === i ? 'running' : th.state, act: o.act === i, cs: th.cs > 0 }], w: 70, h: 34 }).items);
      items.push(H.text('rg' + i, x + 82, 23, Object.keys(th.reg).filter((k) => th.reg[k] !== null && th.reg[k] !== undefined).map((k) => k + ' = ' + th.reg[k]).join(' · ') || 'no registers yet', 'thsub', 13));
      items.push(...H.code('cd' + i, x, 48, spec, st, [i], { act: o.act, line: o.line, textW: 244, size: 13, lh: 28, markW: 32 }).items);
    });
    const vx = 620, V = st.vars, used = H.usedVars(spec);
    const rows = [];
    if (V.flag && used.includes('flag')) V.flag.forEach((f, i) => rows.push({ name: 'flag[' + i + ']', value: f, act: (o.obj === 'flag' && o.op === 'write' && o.act === i && !o.sb) || (o.kind === 'flush' && o.flushed === 'flag[' + i + ']') }));
    if (used.includes('turn')) rows.push({ name: 'turn', value: V.turn, act: (o.obj === 'turn' && o.op === 'write' && !o.sb) || (o.kind === 'flush' && o.flushed === 'turn') });
    items.push(...K7().vars({ prefix: 'vr', x: vx, y: 0, rows, nameW: 78, valW: 52, title: 'shared memory' }).items);
    if (o.sb) st.threads.forEach((th, i) => {
      const y = 24 + rows.length * 34 + 14 + i * 40;
      items.push(H.text('sbn' + i, vx, y + 21, th.name + ' buffer', 'p7note', 13));
      if (!th.sb.length) items.push(H.text('sbe' + i, vx + 96, y + 21, 'empty', 'qnone', 13));
      th.sb.forEach((e, j) => items.push({ key: 'sb' + i + ':' + j + ':' + e.join(), kind: 'cell', x: vx + 96 + j * 92, y: y + 2, w: 86, h: 28, rx: 5, text: e[0] + (e[1] === null ? '' : '[' + e[1] + ']') + '=' + e[2], size: 13, cls: 'sbuf' }));
    });
    const ry = o.sb ? 24 + rows.length * 34 + 104 : 24 + rows.length * 34 + 22;
    const bad = inside.length > 1;
    items.push({ key: 'room', kind: 'region', x: vx, y: ry, w: 250, h: 74, rx: 10, cls: bad ? 'hot' : inside.length ? 'act' : 'frame' });
    items.push(H.text('roomt', vx + 12, ry + 20, 'critical section', 'roomlabel', 13));
    items.push(H.text('roomin', vx + 125, ry + 50, inside.length ? inside.join(' and ') + (bad ? ': both inside!' : ' inside') : 'empty', bad ? 'hot' : inside.length ? 'strong' : 'p7note', 15, 'middle'));
    if (o.req) o.req.forEach((r, i) => {
      items.push(H.text('rq' + i, vx, ry + 104 + i * 26, (r.ok === true ? '✓ ' : r.ok === false ? '✗ ' : '· ') + r.name, r.ok === true ? 'good' : r.ok === false ? 'hot' : 'p7note', 14));
    });
    if (o.strip) items.push(...K7().strip({ prefix: 'sc', x: 0, y: o.stripY || 300, w: 600, steps: o.strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 18, lit: H.cycleLit(o.cycle), title: o.cycle ? 'the schedule (pink outline: the cycle)' : o.stripTitle || 'the schedule' }).items);
    return items;
  }
  H.duo = duo;

  function requirements(chk) {
    const r = chk.res, live = r.liveness ? r.liveness.results : [];
    const me = !(r.safety.violation && r.safety.violation.kind === 'invariant');
    const prog = r.safety.violation ? null : live.every((x) => x.holds);
    return [{ name: 'mutual exclusion', ok: me }, { name: 'progress, no starvation', ok: prog }];
  }

  H.topic({
    id: 'sync-cs-attempts', family: 'p07-cs', order: 10, title: 'The critical-section problem',
    blurb: 'Two threads loop for ever: an entry protocol, the critical section, an exit protocol. A correct protocol keeps them from being inside together (mutual exclusion), lets one in whenever someone wants in (progress), and makes nobody wait for ever (bounded waiting). Simple-looking attempts each break one of these, and the model checker finds the schedule that shows it.',
    inputs: [{ id: 'variant', kind: 'choice', label: 'Entry protocol', def: 'check-then-set', options: Object.entries(NAMES).map(([value, label]) => ({ value, label })) }],
    presets: Object.entries(NAMES).map(([value, label]) => ({ label, values: { variant: value } })),
    counters: [{ id: 'states', label: 'states searched' }, { id: 'step', label: 'replay step' }],
    run(inp) {
      const spec = Y().peterson(inp.variant), chk = H.check(spec), F = new S.Frames(['states', 'step']);
      const st0 = Y().machine(spec).snap(), req = requirements(chk), v = H.verdictText(chk);
      const strip = chk.sched ? H.stripSteps(spec, chk.sched) : null;
      F.add({ items: duo(spec, st0, { req: req.map((r) => ({ name: r.name, ok: null })) }), say: `${NAMES[inp.variant]}: ${spec.about} Both threads loop for ever; each listing shows the entry protocol, the critical section and the exit.`, meta: { vals: [] } });
      F.set('states', chk.stats.states);
      const live = chk.res.liveness ? chk.res.liveness.results : [];
      let say;
      if (chk.res.safety.violation) say = `The model checker explored ${chk.stats.states} states and found a schedule of ${H.plural(chk.sched.length, 'step')} that puts both threads in the critical section: mutual exclusion fails.`;
      else if (chk.lasso) say = `Mutual exclusion holds in all ${chk.stats.states} reachable states. But the liveness check finds a fair schedule in which ${chk.lasso.name.replace(/ eventually.*/, '')} never gets in: after ${H.plural(chk.lasso.lasso.prefix.length, 'step')}, a cycle of ${chk.lasso.lasso.cycle.length} repeats for ever.`;
      else say = `Mutual exclusion holds in all ${chk.stats.states} reachable states, and in every fair schedule each thread gets in again and again (${live.map((x) => x.name).join('; ')}).`;
      F.add({ items: duo(spec, st0, { req, strip, upto: 0 }).concat(K7().verdict({ prefix: 'vd', x: 620, y: 300, w: 250, kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched'] }).items), say, meta: { vals: v.vals.concat([chk.stats.states]) } });
      if (chk.steps) H.replay(F, spec, chk, (st, o) => { F.set('step', o.k + 1); return duo(spec, st, Object.assign({ req, strip: o.strip, upto: o.upto }, o)); });
      const end = chk.res.safety.violation ? `Both threads are inside at once. ${inp.variant === 'check-then-set' ? 'Each looked at the other\'s flag before raising its own, so each saw it down.' : ''}`
        : chk.lasso ? (inp.variant === 'flags-only' ? 'Both flags are up and each waits for the other\'s to fall: they spin for ever, and no one enters although both want to. Progress fails.' : 'T1 has stopped wanting in, but the turn is still T1\'s: T0 waits for a turn that never comes. Progress fails.')
          : 'Every requirement holds: the flag says "I want in", the turn breaks the tie, and the last to write turn waits.';
      F.add({ items: duo(spec, chk.steps ? chk.steps[chk.steps.length - 1].state : st0, { req, strip, upto: strip ? strip.length : 0 }).concat(K7().verdict({ prefix: 'vd', x: 620, y: 300, w: 250, kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched'] }).items), say: end.trim(), meta: { vals: [] } });
      return { frames: F.list, def: H.def('The three requirements', ['mutual exclusion: never two inside', 'progress: if some want in and none is', '  inside, one of them gets in', 'bounded waiting: after a thread asks,', '  the other enters a bounded number', '  of times before it does', 'checked: safety over every state,', '  progress under weak fairness']) };
    },
    predict: [H.predictNext('Which thread takes the next step of this schedule?')],
    quiz: [
      { q: '"Look at the other\'s flag, then raise mine" fails because…', options: ['both can look before either raises, and both go in', 'the flags never fall', 'it needs a turn variable to compile', 'it starves T1'], answer: 0, why: 'The look and the raise are separate steps; another thread can slip between them.' },
      { q: '"Raise my flag, then wait while the other\'s is up" can…', options: ['leave both waiting for ever with both flags up', 'let both in', 'only work with three threads', 'never block'], answer: 0, why: 'Each waits for the other to lower a flag it never lowers: no progress.' },
      { q: 'Strict alternation (wait for my turn) breaks…', options: ['progress: a thread that no longer wants in still blocks the other', 'mutual exclusion', 'nothing', 'the hardware'], answer: 0, why: 'The turn passes only when the other uses it.' },
      { q: 'In Peterson\'s algorithm, after both raise their flags, who enters first?', options: ['the one that did not write turn last', 'always T0', 'the one that wrote turn last', 'the one with the higher id'], answer: 0, why: 'Each writes turn = other; the last writer gives the turn away and waits.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
