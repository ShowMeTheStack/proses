// The Sync lab, part nine: frames. A run's beats become the pictures the stage plays, at about 980 units wide
// (or one column for a phone): the problem's scene when there is one, the threads as cards, every lock,
// semaphore and condition with its owner and queue, the shared variables, and in a check the failing schedule as
// a strip with the checker's verdict. Each frame carries its sentence, the editor's thread tags, its tables and
// its metrics.
//   SL.frames(P, run, o) -> [frame]   run: {beats, R (a check), waiting, bad, picks}; o: {narrow, mode}
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const tw = (t, size, o) => S.textWidth(String(t), size || 13, o);
  const q = (v) => '`' + v + '`';

  /** the object a beat's main event names, for the panel to light */
  function litOf(b, P) {
    const out = new Set();
    if (!b.rec) return out;
    for (const e of b.rec.events) if (e.obj) out.add(P.I.at(+String(e.obj).split(':')[2]));
    return out;
  }

  /** by hand: the choices at this beat, the one taken, or (the last beat, waiting) the ones to click */
  function chooser(run, k, x, y, b, next) {
    const items = [], last = k === run.beats.length - 1;
    const label = (t, cls) => items.push({ key: 'ch:lab', kind: 'text', x, y: y + 19, text: t, size: 14, cls: 'chlab' + (cls ? ' ' + cls : '') });
    if (last && run.waiting) {
      const t = run.bad ? 'not ready: ' + run.bad.want + ' · run next:' : 'your turn · run next:';
      label(t, 'strong');
      let cx = x + Math.ceil(tw(t, 14, { bold: true })) + 12;
      for (const c of run.waiting) {
        const th = b.world.threads.find((z) => z.tid === c), name = run.label ? run.label(c) : th ? th.name : String(c), cw = Math.ceil(tw(name, 14, { bold: true })) + 26;
        items.push({ key: 'pick:' + name, kind: 'cell', x: cx, y: y + 2, w: cw, h: 26, rx: 13, text: name, size: 14, cls: 'pickchip ' + (th ? th.cls : ''), pick: true });
        cx += cw + 8;
      }
      if (run.picks.length) items.push({ key: 'pick:undo', kind: 'cell', x: cx + 8, y: y + 2, w: Math.ceil(tw('↶ undo', 13)) + 22, h: 26, rx: 13, text: '↶ undo', size: 13, cls: 'pickchip undo', pick: true });
    } else if (next && next.rec) {
      const th = next.world.threads.find((z) => z.tid === next.rec.tid);
      label('next: ' + (th ? th.name : next.rec.tid) + (next.rec.picked ? ', your choice' : ', the only thread that can run'));
    } else label(b.status === 'running' ? 'the run stops here' : b.status === 'deadlock' ? 'deadlock: nobody can run' : 'every thread has finished', b.status === 'deadlock' ? 'hot' : '');
    return items;
  }

  SL.frames = function (P, run, o) {
    o = o || {};
    const beats = run.beats, narrow = !!o.narrow, C = SL.context(beats, P, { narrow }), sc = C.scene, R = run.R;
    const W = narrow ? 370 : 980;
    const sched = R && R.schedule ? R.schedule.map((c, i) => {
      const b = beats[i + 1], tid = b && b.rec ? b.rec.tid : c, t = b && b.world.threads.find((z) => z.tid === tid);
      const name = b && b.rec && b.rec.label ? b.rec.label : t ? (t.main ? 'M' : t.name) : String(c);
      return { k: t ? (b.names[tid] || {}).k || 0 : 0, name, cls: t ? t.cls : 'p0' };
    }) : null;
    const lit = R && R.verdict === 'starve' ? Array.from({ length: R.schedule.length - R.cycleFrom }, (_, i) => R.cycleFrom + i) : [];
    // the same layout for every frame: sizes measured over the whole run
    const objH = Math.max(...beats.map((b) => SL.panels.objects('x', 0, 0, b, C, new Set()).h));
    const varH = beats[0].world.vars.length && !(sc && sc.kind === 'race') ? 24 + beats[0].world.vars.length * 34 : 0;
    const scH = sc ? Math.max(...beats.map((b, k) => SL.scene(sc, b, beats[k - 1], 0, 0, { narrow }).h)) : 0;
    const scW = sc ? Math.max(...beats.map((b, k) => SL.scene(sc, b, beats[k - 1], 0, 0, { narrow }).w)) : 0;
    const top = o.mode === 'hand' ? 44 : 0;
    const frames = [];
    beats.forEach((b, k) => {
      const prev = beats[k - 1], items = [], litSet = litOf(b, P);
      if (o.mode === 'hand') items.push(...chooser(run, k, 0, 0, b, beats[k + 1]));
      let y = top;
      if (!narrow) {
        const rx = sc ? Math.max(scW + 40, 520) : 520;
        let ly = y;
        if (sc) { items.push(...SL.scene(sc, b, prev, 0, y, { regs: C.regAt[k] }).items); ly = y + scH + 20; }
        const ob = SL.panels.objects('ob', rx, y, b, C, litSet);
        items.push(...ob.items);
        if (varH) items.push(...SL.panels.vars('vr', rx, y + objH + 6, b, C, prev).items);
        const rightH = objH + (varH ? varH + 12 : 0);
        let cy;
        if (sc) cy = Math.max(ly, y + rightH + 20) + 10;
        else cy = y + 10;
        items.push({ key: 'th:t', kind: 'text', x: 0, y: cy - 12, text: 'the threads: state, and where each is (its line, or what it waits for)', size: 13, cls: 'title' });
        const cards = SL.panels.cards('th', 0, cy, sc ? W : rx - 30, b, C, k);
        items.push(...cards.items);
        y = Math.max(cy + cards.h, sc ? 0 : y + rightH) + 30;
      } else {
        if (sc) { items.push(...SL.scene(sc, b, prev, 0, y, { narrow: true, regs: C.regAt[k] }).items); y += scH + 16; }
        items.push({ key: 'th:t', kind: 'text', x: 0, y: y + 2, text: 'the threads', size: 13, cls: 'title' });
        const cards = SL.panels.cards('th', 0, y + 14, W, b, C, k);
        items.push(...cards.items); y += 14 + cards.h + 18;
        items.push(...SL.panels.objects('ob', 0, y, b, C, litSet).items); y += objH + 6;
        // on a phone the scene stands for the variables it draws
        if (varH && !sc) { items.push(...SL.panels.vars('vr', 0, y, b, C, prev).items); y += varH + 16; }
      }
      if (R) {
        if (sched) {
          const sw = narrow ? W : 560;
          const st = SL.panels.strip('sc', 0, y, sw, sched, k, C, { lit, title: R.verdict === 'starve' ? (narrow ? 'the way in, then the cycle' : 'the way in, then the cycle (outlined), twice') : 'the shortest failing schedule', rows: narrow ? 1 : 2 });
          items.push(...st.items);
          if (narrow) y += st.h + 16;
          items.push(...SL.panels.verdict('vd', narrow ? 0 : 600, narrow ? y : y - 4, narrow ? W : 380, R, narrow).items);
        } else items.push(...SL.panels.verdict('vd', 0, y, narrow ? W : 560, R, narrow).items);
      }
      frames.push({ items, at: k, title: b.rec ? b.rec.label || (b.names[b.rec.tid] || {}).name || '' : 'start', marks: P.machine ? [] : marks(b) });
    });
    return { frames, C };
  };
  function marks(b) {
    const act = b.rec ? b.rec.tid : null;
    return b.world.threads.filter((t) => t.state !== 'done' && t.line).map((t) => ({ line: t.line, tag: t.name, cls: t.cls === 'pm' ? 'p5' : t.cls, act: t.tid === act, title: t.name + ', ' + t.state + (t.on ? ', waiting for ' + t.on.name : '') }));
  }

  /** the side panel's tables for a beat */
  SL.tables = function (P, b, asserts) {
    const T = [];
    T.push({ title: 'Threads', cols: ['thread', 'starts in', 'state', 'line', 'waits for'], rows: b.world.threads.map((t) => [t.name, t.fn, { text: t.state, cls: t.state === 'blocked' ? 'bad' : t.state === 'done' ? 'good' : '' }, t.state === 'done' ? '–' : String(t.line), t.on ? t.on.name : '–']), hl: b.rec ? b.world.threads.findIndex((t) => t.tid === b.rec.tid) : -1 });
    const spec = b.truth.map((x) => [x.row.text || x.row.what || x.row.kind, x.ok === true ? { text: 'holds', cls: 'good' } : x.ok === false ? { text: 'broken', cls: 'bad' } : x.row.error ? { text: 'cannot be read', cls: 'bad' } : '–', x.why || '']);
    for (const a of asserts) spec.push(['assert(' + a.text + '), line ' + a.line, b.status === 'error' && /assert/.test(b.failure || '') && (b.failure || '').includes(a.text) ? { text: 'failed', cls: 'bad' } : '–', 'checked when that line runs']);
    T.push({ title: 'Specification, in this state', cols: ['property', 'now', 'note'], rows: spec, note: 'Check it tests every property in every state it reaches; the liveness ones over whole runs.' });
    const objs = b.world.mutexes.map((m) => [m.name, 'mutex', m.owner || 'free', m.queue.join(' ') || '–']).concat(b.world.sems.map((s) => [s.name, 'semaphore', s.value === null ? 'not set up' : String(s.value), s.queue.join(' ') || '–']), b.world.conds.map((c) => [c.name, 'condition', '–', c.queue.join(' ') || '–']));
    if (objs.length) T.push({ title: 'Locks, semaphores and conditions', cols: ['name', 'kind', 'owner or value', 'queue'], rows: objs });
    if (b.world.vars.length) T.push({ title: 'Shared variables', cols: ['name', 'value'], rows: b.world.vars.map((v) => [v.name, SL.showVal(v.value)]) });
    return T;
  };
  SL.q = q;
})(globalThis.Proses = globalThis.Proses || {});
