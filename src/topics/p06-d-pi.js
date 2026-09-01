// Part 6: priority inversion and the protocols that bound it. Each task is a row, most urgent on top: where it ran
// (outlined where it held the mutex, and marked where it ran above its own priority), where it waited ready, and
// where it was blocked on the mutex. Under the rows, the mutex with its holder and waiters, and every task's base and
// effective priority. The protocols topic ends with all three protocols on the same tasks.
(function (S) {
  'use strict';
  const P = S.P05, Q = S.P06, Sch = () => S.Sched, G = () => S.Kit.gantt;

  /** "L 3 0: run 1, lock m, run 4, unlock m, run 1" per line (name, priority, arrival: ops) -> {tasks} or {error} */
  Q.parseScript = function (text) {
    const lines = String(text || '').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
    if (!lines.length || lines.length > 5) return { error: 'Tasks: one to five lines, as L 3 0: run 1, lock m, run 4, unlock m, run 1' };
    const tasks = [], seen = new Set();
    let total = 0;
    for (const l of lines) {
      const m = /^([A-Za-z][A-Za-z0-9]{0,2})\s+(\d+)\s+(\d+)\s*:\s*(.+)$/.exec(l);
      if (!m) return { error: `Tasks: "${l}" should read name, priority, arrival, then a colon and the steps` };
      if (seen.has(m[1])) return { error: `Tasks: two tasks are named ${m[1]}` };
      seen.add(m[1]);
      const ops = [], held = new Set();
      for (const part of m[4].split(',').map((x) => x.trim()).filter(Boolean)) {
        const o = /^(run)\s+(\d+)$|^(lock|unlock)\s+([A-Za-z]\w{0,5})$/.exec(part);
        if (!o) return { error: `Tasks: "${part}" in ${m[1]} is not run n, lock name or unlock name` };
        if (o[1]) { const n = +o[2]; if (n < 1 || n > 12) return { error: `Tasks: run takes 1 to 12 ticks (${m[1]})` }; ops.push(['run', n]); total += n; }
        else if (o[3] === 'lock') { if (held.has(o[4])) return { error: `Tasks: ${m[1]} locks ${o[4]} twice` }; held.add(o[4]); ops.push(['lock', o[4]]); }
        else { if (!held.has(o[4])) return { error: `Tasks: ${m[1]} unlocks ${o[4]} without holding it` }; held.delete(o[4]); ops.push(['unlock', o[4]]); }
      }
      if (held.size) return { error: `Tasks: ${m[1]} ends still holding ${[...held].join(', ')}` };
      if (!ops.some((o) => o[0] === 'run')) return { error: `Tasks: ${m[1]} needs at least one run` };
      tasks.push({ id: m[1], prio: +m[2], arrive: +m[3], script: ops });
    }
    if (total > 40) return { error: 'Tasks: at most 40 ticks of running in all, so the picture stays readable' };
    return { tasks };
  };
  const fmtTask = (k) => `${k.id} ${k.prio} ${k.arrive}: ` + k.script.map((o) => o.join(' ')).join(', ');
  const PI_DEF = () => Sch().PI_TASKS.map(fmtTask).join('\n');
  const scriptInput = (def) => ({ id: 'tasks', kind: 'program', label: 'Tasks: name, priority (lower is more urgent), arrival: steps', def, check: (v) => Q.parseScript(v).error || null });
  const CHAIN = 'L 4 0: run 1, lock mtx, run 3, unlock mtx, run 1\nH 1 2: run 1, lock mtx, run 1, unlock mtx, run 1\nM1 2 3: run 4\nM2 3 4: run 4';
  const TWO = 'L 3 0: run 1, lock a, run 4, unlock a, run 1\nM 2 1: run 1, lock b, run 4, unlock b\nH 1 3: run 1, lock b, run 1, unlock b, lock a, run 1, unlock a';

  /** the picture of one trace up to tick t */
  function draw(tr, t, end) {
    const items = [], ord = tr.tasks.slice().sort((a, b) => a.prio - b.prio), ids = tr.tasks.map((k) => k.id);
    const T = tr.end, x0 = 70, x1 = P.W_, per = (x1 - x0) / T, X = (u) => Math.round((x0 + u * per) * 10) / 10, rowH = 30, gap = 14, y0 = 40;
    const upTo = end ? T : t;
    items.push(...G().axis({ prefix: 'ax', X, t1: T, y: y0 - 16, step: P.tickStep(per, 24), size: 13 }));
    ord.forEach((k, i) => {
      const y = y0 + i * (rowH + gap), ci = ids.indexOf(k.id);
      items.push(P.text('n' + k.id, x0 - 10, y + rowH / 2 + 5, k.id, 'glname', 15, 'end'));
      items.push(P.text('p' + k.id, x0 - 34, y + rowH / 2 + 5, 'p' + k.prio, 'glabel', 13, 'end'));
      items.push(...G().track({ prefix: 'tk' + k.id, x: x0, y, w: x1 - x0, h: rowH }));
      // per tick: what this task was doing
      let cur = null;
      const runs = [];
      for (let u = 0; u < upTo; u++) {
        const st = tr.steps[u];
        const holds = Object.keys(st.holders || {}).filter((m) => st.holders[m] === k.id);
        const s = st.run === k.id ? (holds.length ? 'hold' : 'run') + (st.eff[k.id] < k.prio ? '+' : '') : (st.blocked || []).some((b) => b.id === k.id) ? 'blocked' : (st.ready || []).includes(k.id) ? 'ready' : null;
        if (cur && cur.s === s && cur.end === u) cur.end = u + 1; else { cur = { s, start: u, end: u + 1 }; runs.push(cur); }
      }
      runs.forEach((r) => {
        if (!r.s) return;
        const w = X(r.end) - X(r.start), boosted = r.s.endsWith('+'), base = r.s.replace('+', '');
        const word = base === 'blocked' ? 'blocked' : base === 'ready' ? 'wait' : base === 'hold' ? 'lock' : '';
        const cls = base === 'blocked' ? 'p06blk' : base === 'ready' ? 'p05lane p05wait' : 'gseg p' + (ci % 6) + (base === 'hold' ? ' p06hold' : '') + (boosted ? ' p06boost' : '');
        items.push({ key: 's' + k.id + r.start, kind: 'cell', x: X(r.start), y, w: Math.round(w * 10) / 10, h: rowH, text: w > S.geom.textWidth(word, 13) + 8 ? word : '', size: 13, cls });
      });
    });
    const rowsH = ord.length * (rowH + gap) - gap;
    if (!end) items.push(...G().cursor({ prefix: 'cur', X, t, y1: y0 - 6, y2: y0 + rowsH + 4 }));
    // the mutexes and the priorities now
    const st = tr.steps[Math.min(t, tr.steps.length - 1)], by = y0 + rowsH + 58;
    const muts = Object.keys(tr.ceilings);
    muts.forEach((m, i) => {
      const x = i * 270, h = end ? null : st.holders[m], ws = end ? [] : st.waiters[m] || [];
      items.push({ key: 'mx' + m, kind: 'cell', x, y: by, w: 250, h: 62, text: '', cls: 'p06mutex', audit: 'group', layer: 'back' });
      items.push(P.text('mxn' + m, x + 12, by + 22, m + (tr.params.protocol === 'ceiling' ? ' (ceiling p' + tr.ceilings[m] + ')' : ''), 'glname', 15));
      items.push(P.text('mxh' + m, x + 12, by + 48, h ? 'held by ' + h : 'free', h ? 'p05val' : 'glabel', 14));
      if (ws.length) items.push(P.text('mxw' + m, x + 120, by + 48, 'waiting: ' + ws.join(', '), 'hot', 14));
    });
    const rows = ord.map((k) => ({ key: k.id, cells: [{ text: k.id, cls: 'p' + (ids.indexOf(k.id) % 6) }, String(k.prio), end ? String(k.prio) : { text: String(st.eff[k.id]), cls: st.eff[k.id] < k.prio ? 'fresh' : '' }] }));
    items.push(...G().table({ prefix: 'pr', x: 560, y: by, cols: [{ w: 60, label: 'task' }, { w: 80, label: 'base' }, { w: 100, label: 'effective' }], rows, rowH: 26, size: 14 }).items);
    return { items, legendY: y0 + rowsH + 30 };
  }
  const legend = (y) => P.laneLegend('lg', 0, y, ['ready']).concat([
    { key: 'lgb', kind: 'cell', x: 230, y: y - 13, w: 22, h: 16, text: '', cls: 'p06blk' }, P.text('lgbt', 258, y, 'blocked on a mutex', 'glabel', 13),
    { key: 'lgh', kind: 'cell', x: 400, y: y - 13, w: 22, h: 16, text: '', cls: 'gseg p0 p06hold' }, P.text('lght', 428, y, 'holding a mutex', 'glabel', 13),
    { key: 'lgu', kind: 'cell', x: 552, y: y - 13, w: 22, h: 16, text: '', cls: 'gseg p0 p06boost' }, P.text('lgut', 580, y, 'above its own priority', 'glabel', 13)]);

  function frames(tr, sayEnd) {
    const out = [], urgent = tr.metrics.rows.slice().sort((a, b) => a.prio - b.prio)[0];
    const ts = tr.steps.map((s, t) => (s.kind === 'end' || s.decision !== 'continue' || tr.events.some((e) => e.t === t && ['lock', 'unlock', 'block'].includes(e.kind)) ? t : -1)).filter((t) => t >= 0);
    for (const t of ts) {
      const st = tr.steps[t], end = st.kind === 'end', d = draw(tr, t, end);
      const items = [P.now('now', 0, -14, t, end), ...d.items, ...legend(d.legendY)];
      const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready: st.ready || [], decision: st.decision, step: st, eff: st.eff, holders: st.holders };
      let say = P.clean(st.say);
      if (end) { meta.rows = tr.metrics.rows; meta.urgent = urgent; say = sayEnd(tr, urgent); }
      out.push({ items, say, meta, title: end ? 'end' : st.decision === 'preempt' ? 'preempt' : 't = ' + t });
    }
    return out;
  }
  const defs = () => P.def(['Priority inversion', 'A more urgent task waits for a less urgent one. A short wait for the holder of a lock is unavoidable; the danger is a middle task, needing no lock, that preempts the holder and so delays the urgent task for as long as it likes.'], ['Inheritance', 'While a task holds a mutex that more urgent tasks wait for, it runs at the most urgent of their priorities; a middle task can no longer preempt it.'], ['Ceiling', 'Each mutex has a ceiling, the most urgent priority of any task that uses it. A task that locks it runs at the ceiling at once, until it unlocks.'], ['Input', 'One task per line: name, priority (lower is more urgent), arrival, a colon, then steps: run n, lock name, unlock name.']);

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'pi-inversion', family: 'p06-pi', order: 10, title: 'Priority inversion',
    blurb: 'Three tasks: L (least urgent) locks a mutex; H (most urgent) arrives and needs the same mutex, so it blocks until L unlocks. That wait is expected, and short. But then M, of middle priority and needing no lock, arrives and preempts L. Now H waits for M as well, though M is less urgent than H: the inversion lasts as long as M runs, without any bound.',
    inputs: [scriptInput(PI_DEF())],
    presets: [
      { label: 'L, M and H, one mutex', values: { tasks: PI_DEF() } },
      { label: 'Two middle tasks: a longer inversion', values: { tasks: CHAIN } },
      { label: 'No middle task: a bounded wait', values: { tasks: 'L 3 0: run 1, lock mtx, run 4, unlock mtx, run 1\nH 1 3: run 1, lock mtx, run 2, unlock mtx, run 1' } },
    ],
    run(inp) {
      const tr = Sch().inversion(Q.parseScript(inp.tasks).tasks, { protocol: 'none' });
      const fr = frames(tr, (tr, h) => `Every task has finished at t = ${tr.end}. ${h.id} spent ${P.s(h.blockedOnMutex, 'tick')} blocked on the mutex and ${P.s(h.inversion, 'tick')} in all waiting while a less urgent task ran, finishing ${h.turnaround} ticks after it arrived.`);
      P.markAsks(fr, 2, (f, nx) => nx.meta.decision !== 'continue');
      return { frames: fr, def: defs() };
    },
    predict: [P.askNextOpt()],
    quiz: [
      { q: 'What makes a priority inversion unbounded?', options: ['A middle-priority task preempting the lock holder while the urgent task waits', 'The urgent task holding the lock', 'Two tasks of equal priority', 'A deadlock'], answer: 0, why: 'The urgent task then waits for work that has nothing to do with the lock.' },
      { q: 'H waits for a mutex held by L, and no other task exists. How long can H wait?', options: ['At most as long as L holds the mutex', 'For ever', 'One quantum', 'Not at all'], answer: 0, why: 'That inversion is bounded by the critical section.' },
      { q: 'In the inversion, which task is effectively running ahead of H?', options: ['M, the middle task', 'L only', 'H itself', 'no task'], answer: 0, why: 'M preempts L, and L must finish before H can go.' },
      { q: 'Why can\'t the scheduler simply run H?', options: ['H is blocked on the mutex, which only L can unlock', 'H has the lowest priority', 'H has not arrived', 'H is in I/O'], answer: 0, why: 'A blocked task cannot run, whatever its priority.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'pi-protocols', family: 'p06-pi', order: 20, title: 'Priority inheritance and the priority ceiling',
    blurb: 'Two protocols bound the inversion. With priority inheritance, a task holding a mutex runs at the priority of the most urgent task waiting for it, so a middle task cannot cut in. With the priority ceiling, a task that locks a mutex runs at once at the mutex\'s ceiling, the most urgent priority of any task that uses it. Choose a protocol; the last step runs all three on the same tasks.',
    inputs: [scriptInput(PI_DEF()), { id: 'proto', kind: 'choice', label: 'Protocol', def: 'inherit', options: [{ value: 'none', label: 'none' }, { value: 'inherit', label: 'priority inheritance' }, { value: 'ceiling', label: 'priority ceiling' }] }],
    presets: [
      { label: 'Inheritance', values: { tasks: PI_DEF(), proto: 'inherit' } },
      { label: 'Ceiling', values: { tasks: PI_DEF(), proto: 'ceiling' } },
      { label: 'Two middle tasks, inheritance', values: { tasks: CHAIN, proto: 'inherit' } },
      { label: 'Two mutexes, inheritance through a chain', values: { tasks: TWO, proto: 'inherit' } },
      { label: 'Two mutexes, ceiling', values: { tasks: TWO, proto: 'ceiling' } },
    ],
    run(inp) {
      const tasks = Q.parseScript(inp.tasks).tasks, tr = Sch().inversion(tasks, { protocol: inp.proto });
      const all = ['none', 'inherit', 'ceiling'].map((p) => Sch().inversion(tasks, { protocol: p }));
      const fr = frames(tr, (tr, h) => `Every task has finished at t = ${tr.end}. Under ${tr.name}, ${h.id} spent ${P.s(h.blockedOnMutex, 'tick')} blocked on a mutex and ${P.s(h.inversion, 'tick')} waiting while a less urgent task ran.`);
      const last = fr[fr.length - 1], urgent = tasks.slice().sort((a, b) => a.prio - b.prio)[0].id;
      const rows = all.map((x) => { const r = x.metrics.rows.find((y) => y.id === urgent); return { key: x.params.protocol, cells: [x.name, String(r.blockedOnMutex), String(r.inversion), String(r.finish), String(r.turnaround)], cls: x.params.protocol === inp.proto ? 'fresh' : '' }; });
      const items = last.items.filter((it) => !/^(pr:|mx|lg)/.test(it.key));
      const ty = items.reduce((a, it) => (it.key.startsWith('s') || it.key.startsWith('tk') ? Math.max(a, (it.y || 0) + (it.h || 0)) : a), 0) + 40;
      items.push(P.text('cmpT', 0, ty - 10, `${urgent}, the most urgent task, under each protocol`, 'glabel', 14));
      items.push(...G().table({ prefix: 'cmp', x: 0, y: ty, cols: [{ w: 190, label: 'protocol' }, { w: 120, label: 'blocked' }, { w: 120, label: 'inversion' }, { w: 90, label: 'finish' }, { w: 130, label: 'turnaround' }], rows, rowH: 28, size: 14 }).items);
      const inv = all.map((x) => x.metrics.rows.find((y) => y.id === urgent).inversion);
      fr.push({ items, say: `${urgent} waited while a less urgent task ran for ${inv[0]} ticks with no protocol, ${inv[1]} with inheritance and ${inv[2]} with the ceiling.`, meta: { phase: 'compare', inv, urgent, chosen: inv[['none', 'inherit', 'ceiling'].indexOf(inp.proto)] }, title: 'compare' });
      P.markAsks(fr, 2, (f, nx) => nx.meta.decision !== 'continue');
      return { frames: fr, def: defs() };
    },
    predict: [P.askNextOpt(), { at: (f, i, fr) => f.meta.phase === 'end', pick: 'option', ask: 'With no protocol, will the most urgent task wait longer behind less urgent ones than under the protocol you chose?', options: ['longer', 'the same', 'shorter'], answer: (fr, i) => { const m = fr[i + 1].meta; return m.inv[0] > m.chosen ? 'longer' : m.inv[0] === m.chosen ? 'the same' : 'shorter'; }, explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'Under inheritance, L holds the mutex and H waits on it. At what priority does L run?', options: ['H\'s priority', 'its own', 'M\'s priority', 'the lowest'], answer: 0, why: 'It inherits the most urgent waiter\'s priority.' },
      { q: 'When does L drop back to its own priority under inheritance?', options: ['When it unlocks the mutex', 'When its quantum ends', 'When M finishes', 'Never'], answer: 0, why: 'Inheritance lasts while it holds what H needs.' },
      { q: 'Under the ceiling protocol, when does L\'s priority rise?', options: ['As soon as it locks the mutex', 'Only when H blocks', 'When M arrives', 'Never'], answer: 0, why: 'It runs at the ceiling for the whole critical section.' },
      { q: 'What must be known in advance for the ceiling protocol?', options: ['Which tasks use which mutex, to set each ceiling', 'Every burst length', 'The hyperperiod', 'Nothing'], answer: 0, why: 'The ceiling is the most urgent priority among a mutex\'s users.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
