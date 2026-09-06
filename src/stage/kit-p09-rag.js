// Resource-allocation graphs and wait-for graphs (part 9). A process is a circle coloured by its state; a resource
// type is a box with one dot per unit; an assignment edge leaves the dot of the unit held, a request edge runs from
// the waiting process to the box. Positions come from the caller (a layout made so the edges do not cross).
//   S.Kit.rag.draw({prefix, g: {procs, res: [{name, units}], hold: [[p, r]..], want: [[p, r]..], claim: [[p, r]..]},
//     pos: {p0: {x, y}, r0: {x, y}, ..}, x, y (the origin added to every position), procCls(i), resCls(j),
//     hot: Set('p0>r1', 'r1>p1' ..) (edges drawn hot, e.g. a cycle), act: Set (edges drawn as this step's),
//     wantN: {'p>r': n} (a request for n units, named on the edge), sub(i) (a line under process i)})
//     -> {items, box, node(id) -> {x, y}}   keys: prefix:p<i>, prefix:r<j>, prefix:u<j>_<k>, prefix:e<from>><to>[#k]
//   S.Kit.rag.waitFor({prefix, procs: [name..], edges: [{from, to, via}], pos: {p0: {x, y}..}, x, y, hot: Set('0>1'),
//     procCls(i), via: true (name the resource on each edge)}) -> {items, box}
//   S.Kit.rag.legend({prefix, x, y, size, claim}) -> {items, w, h}
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const R = (K.rag = {});
  const PR = 25, BH = 40;
  const resW = (units) => Math.max(72, 46 + units * 16);
  R.resW = resW; R.PR = PR; R.BH = BH;

  R.draw = function (o) {
    const P = o.prefix || 'rag', g = o.g, ox = o.x || 0, oy = o.y || 0, items = [];
    const hot = o.hot || new Set(), act = o.act || new Set();
    const at = (id) => ({ x: Math.round(ox + o.pos[id].x), y: Math.round(oy + o.pos[id].y) });
    const xs = [], ys = [];
    g.procs.forEach((name, i) => {
      const c = at('p' + i);
      items.push({ key: P + ':p' + i, kind: 'state', x: c.x, y: c.y, r: PR, text: name, cls: 'ragp ' + (o.procCls ? o.procCls(i) || '' : 's-ready'), sub: o.sub ? o.sub(i) : undefined });
      xs.push(c.x - PR, c.x + PR); ys.push(c.y - PR, c.y + PR + (o.sub && o.sub(i) ? 22 : 0));
    });
    // which unit each holder has: units given out in the order of the hold list
    const unitOf = [], next = g.res.map(() => 0);
    g.hold.forEach(([p, r]) => { unitOf.push(next[r]++); });
    g.res.forEach((r, j) => {
      const c = at('r' + j), w = resW(r.units), x = c.x - w / 2, y = c.y - BH / 2;
      items.push({ key: P + ':r' + j, kind: 'cell', x: Math.round(x), y: Math.round(y), w, h: BH, rx: 6, text: '', cls: 'ragr ' + (o.resCls ? o.resCls(j) || '' : '') });
      items.push({ key: P + ':rn' + j, kind: 'text', x: Math.round(x + 9), y: Math.round(c.y + 5), text: r.name, size: 14, cls: 'ragname' });
      const nameW = Math.max(18, S.geom.textWidth(r.name, 14, { bold: true }) + 4);
      const dx0 = x + 17 + nameW, step = Math.min(16, (w - 14 - nameW - 8) / Math.max(1, r.units - 1 || 1));
      for (let k = 0; k < r.units; k++) {
        const held = g.hold.some(([, rr], q) => rr === j && unitOf[q] === k);
        items.push({ key: P + ':u' + j + '_' + k, kind: 'dot', x: Math.round(dx0 + k * step), y: Math.round(c.y), r: 5, layer: 'labels', cls: 'ragu' + (held ? ' held' : '') });
      }
      xs.push(x, x + w); ys.push(y, y + BH);
    });
    const ecls = (k, base) => base + (hot.has(k) ? ' hot' : act.has(k) ? ' act' : '');
    g.hold.forEach(([p, r], q) => {
      const k = 'r' + r + '>p' + p, dup = g.hold.slice(0, q).filter(([pp, rr]) => pp === p && rr === r).length;
      items.push({ key: P + ':e' + k + (dup ? '#' + dup : ''), kind: 'edge', from: P + ':u' + r + '_' + unitOf[q], to: P + ':p' + p, cls: ecls(k, 'raga') });
    });
    g.want.forEach(([p, r]) => {
      const k = 'p' + p + '>r' + r, n = o.wantN && o.wantN[p + '>' + r];
      const e = { key: P + ':e' + k, kind: 'edge', from: P + ':p' + p, to: P + ':r' + r, cls: ecls(k, 'ragw') };
      // a process that already holds a unit of the type it asks for: bend the request clear of the assignment
      if (g.hold.some(([pp, rr]) => pp === p && rr === r)) e.bend = 0.35;
      if (n && n > 1) { const a = at('p' + p), b = at('r' + r), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, L = Math.hypot(b.x - a.x, b.y - a.y) || 1; e.label = '×' + n; e.lx = Math.round(mx - ((b.y - a.y) / L) * 16); e.ly = Math.round(my + ((b.x - a.x) / L) * 16); }
      items.push(e);
    });
    (g.claim || []).forEach(([p, r]) => {
      const k = 'p' + p + '>r' + r;
      if (g.want.some(([pp, rr]) => pp === p && rr === r) || g.hold.some(([pp, rr]) => pp === p && rr === r)) return;
      items.push({ key: P + ':c' + k, kind: 'edge', from: P + ':p' + p, to: P + ':r' + r, cls: ecls(k, 'ragc') });
    });
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    return { items, box, node: at };
  };

  R.waitFor = function (o) {
    const P = o.prefix || 'wf', ox = o.x || 0, oy = o.y || 0, items = [], hot = o.hot || new Set();
    const at = (i) => ({ x: Math.round(ox + o.pos['p' + i].x), y: Math.round(oy + o.pos['p' + i].y) });
    o.procs.forEach((name, i) => { const c = at(i); items.push({ key: P + ':p' + i, kind: 'state', x: c.x, y: c.y, r: PR - 3, text: name, cls: 'ragp ' + (o.procCls ? o.procCls(i) || '' : 's-ready') }); });
    const seen = new Set();
    for (const e of o.edges) {
      const k = e.from + '>' + e.to;
      if (seen.has(k)) continue;
      seen.add(k);
      const a = at(e.from), b = at(e.to), back = o.edges.some((f) => f.from === e.to && f.to === e.from);
      const it = { key: P + ':e' + k, kind: 'edge', from: P + ':p' + e.from, to: P + ':p' + e.to, cls: 'ragwf' + (hot.has(k) ? ' hot' : '') };
      if (back) it.bend = 0.28;
      if (o.via) {
        const names = o.edges.filter((f) => f.from === e.from && f.to === e.to).map((f) => o.res[f.via]).join(', ');
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, L = Math.hypot(b.x - a.x, b.y - a.y) || 1, off = back ? 30 : 15;
        it.label = names; it.lx = Math.round(mx + ((b.y - a.y) / L) * off); it.ly = Math.round(my - ((b.x - a.x) / L) * off); it.size = 14;
      }
      items.push(it);
    }
    const ps = o.procs.map((_, i) => at(i));
    const box = { x: Math.min(...ps.map((p) => p.x)) - PR, y: Math.min(...ps.map((p) => p.y)) - PR, w: Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)) + 2 * PR, h: Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y)) + 2 * PR };
    return { items, box };
  };

  R.legend = function (o) {
    const P = o.prefix || 'lg', x = o.x, y = o.y, size = o.size || 13, items = [];
    const rows = [['ragw', 'request: waits for a unit'], ['raga', 'assignment: holds a unit']];
    if (o.claim) rows.push(['ragc', 'claim: may ask later']);
    if (o.hot) rows.push(['hot', 'on the cycle']);
    rows.forEach(([c, t], i) => {
      const yy = y + i * 24;
      items.push({ key: P + ':l' + i, kind: 'line', x1: x, y1: yy, x2: x + 34, y2: yy, cls: 'raglg ' + c });
      items.push({ key: P + ':t' + i, kind: 'text', x: x + 44, y: yy + 5, text: t, size, cls: '' });
    });
    return { items, w: 44 + Math.max(...rows.map((r) => S.geom.textWidth(r[1], size))), h: rows.length * 24 };
  };
})(globalThis.Proses = globalThis.Proses || {});
