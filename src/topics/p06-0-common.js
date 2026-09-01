// Part 6, multicore and real-time scheduling: the families, and the pictures the topics share. Several cores are
// drawn as lanes, one per core with its running job (and, with per-core queues, its own queue), under a shared queue
// when there is one; the Gantt chart has a row per core. Real-time tasks are drawn as rows with their releases
// (arrows up) and deadlines (marks), and the jobs that ran in between. Helpers from part 5 (S.P05) are reused.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'multicore', order, title, blurb });
  fam('p06-multi', 10, 'Several cores', 'One queue or one per core, moving work between cores by push and pull, and keeping a job near the cache it warmed.');
  fam('p06-rt', 20, 'Real-time scheduling', 'Periodic tasks with deadlines, scheduled by rate-monotonic priority or by earliest deadline first, and the misses drawn.');
  fam('p06-analysis', 30, 'Will it meet its deadlines?', 'Utilisation bounds, response-time analysis and the processor-demand test: deciding before running.');
  fam('p06-pi', 40, 'Priority inversion', 'An urgent task waiting on a lock held by an unimportant one, while a middling task runs: and the protocols that bound the wait.');

  const P = S.P05, Q = (S.P06 = {}), G = () => S.Kit.gantt;

  /**
   * the cores, their queues and the I/O: o {st, jobs, shared: bool, x, y, w, laneH, gap, end, sub(id, core) -> text}.
   * Returns {items, laneY(k) (core k's lane), h, sharedY}
   */
  Q.cores = function (o) {
    const items = [], st = o.st, n = st.cores.length, laneH = o.laneH || 52, gap = o.gap || 8, w = o.w || 680;
    let y = o.y;
    const box = (id, x, yy, cls, sub) => {
      const bw = sub ? Math.max(48, Math.ceil(S.geom.textWidth(sub, 14) + 14)) : 44;
      const b = G().job('j:' + id, x, yy + (laneH - 40) / 2, id, o.jobs, { w: bw, h: 40, cls });
      if (sub) { b.lines = [id, sub]; b.size = 14; }
      items.push(b);
      return bw;
    };
    let sharedY = null;
    if (o.shared) {
      sharedY = y;
      items.push({ key: 'shq', kind: 'cell', x: o.x, y, w, h: laneH, text: '', cls: 'glane top', audit: 'group', layer: 'back' });
      items.push(P.text('shqL', o.x + 12, y + laneH / 2 + 5, 'shared queue', 'glname', 15));
      let x = o.x + 150;
      if (!st.shared.length) items.push(P.text('shqE', x, y + laneH / 2 + 5, 'empty', 'glabel', 14));
      for (const id of st.shared) x += box(id, x, y, '', null) + 6;
      y += laneH + gap + 6;
    }
    const laneY = [];
    st.cores.forEach((c, k) => {
      laneY.push(y);
      items.push({ key: 'core' + k, kind: 'cell', x: o.x, y, w, h: laneH, text: '', cls: 'gcpu p06core', audit: 'group', layer: 'back' });
      items.push(P.text('coreL' + k, o.x + 12, y + laneH / 2 + 5, 'core ' + c.id, 'glname', 15));
      let x = o.x + 82;
      if (c.run) x += box(c.run, x, y, 'run' + (c.cs ? ' p05sw' : ''), c.warm ? 'warming' : c.cs ? 'switch' : o.sub ? o.sub(c.run, k) : null) + 18;
      else { items.push({ key: 'idle' + k, kind: 'cell', x, y: y + (laneH - 40) / 2, w: 56, h: 40, text: o.end ? 'done' : 'idle', size: 14, cls: 'gslot' }); x += 74; }
      if (!o.shared) {
        items.push(P.text('cq' + k, x, y + laneH / 2 + 5, 'queue', 'glabel', 14));
        x += 54;
        if (!c.queue.length) items.push(P.text('cqE' + k, x, y + laneH / 2 + 5, 'empty', 'glabel', 14));
        for (const id of c.queue) x += box(id, x, y, '', null) + 6;
      }
      y += laneH + gap;
    });
    // the jobs in I/O
    items.push(P.text('ioL', o.x + 12, y + 22, 'I/O', 'glname', 15));
    let x = o.x + 82;
    if (!(st.io || []).length) items.push(P.text('ioE', x, y + 22, 'none', 'glabel', 14));
    for (const e of st.io || []) {
      const sub = 'to ' + e.until, bw = Math.max(48, Math.ceil(S.geom.textWidth(sub, 14) + 14));
      const b = G().job('j:' + e.id, x, y, e.id, o.jobs, { w: bw, h: 40, cls: 'io' });
      b.lines = [e.id, sub]; b.size = 14;
      items.push(b);
      x += bw + 6;
    }
    return { items, laneY, laneH, h: y + 40 - o.y, sharedY };
  };

  /** the decision moments of a multicore trace: every tick something happens, and the end */
  Q.moments = (tr) => tr.steps.map((s, t) => (s.kind === 'end' || s.decision === 'event' || t === 0 ? t : -1)).filter((t) => t >= 0);

  /** the per-core table: core, busy ticks, utilisation */
  Q.coreTable = (tr, x, y) => G().table({ prefix: 'ct', x, y, cols: [{ w: 70, label: 'core' }, { w: 90, label: 'busy' }, { w: 120, label: 'utilisation' }], rows: tr.perCore.map((c) => ({ key: 'c' + c.id, cells: [String(c.id), String(c.busy), Math.round(100 * c.util) + '%'] })), rowH: 28, size: 14 });
})(globalThis.Proses = globalThis.Proses || {});
