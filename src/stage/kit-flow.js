// Flow on the stage: blocks (layers of a system, a request's path, a pipeline of processes), operators (⊕, ⊞), wires drafted in straight runs with
// square corners and junction dots, buses marked with their width, values riding along wires as chips, and the
// curved wires, from an output port on a block's right to an input port on another's left. A net collects the items of one drawing and knows where every port is,
// so wires start and end exactly on the edges of what they join.
//   const N = S.Kit.flow.net('cbc')
//   N.box(id, x, y, w, h, text | [lines], cls)   a block centred on (x, y)
//   N.op(id, x, y, 'xor' | 'add', cls, r)        an operator centred on (x, y)
//   N.port(id, side, along)                      a point on a side ('n', 's', 'e', 'w') of a block or operator;
//                                                along (−1..1) moves it from the middle towards the corners
//   N.wire(id, pts, {head, cls})                 a wire through points ([x, y] or ports); head: an arrow at the end
//   N.bus(id, pts, width, {head, cls, at})       a heavy wire with a slash and its width in bits
//   N.dot(x, y, cls)                             a junction where a wire branches
//   N.chip(id, text, at | {path, t}, cls)        a value in a pill, at a point or riding along a path
//   N.label(id, x, y, text, cls, anchor, size)   free text
//   N.items                                      everything, in drawing order
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const F = (K.flow = {});
  const r2 = (v) => Math.round(v * 100) / 100;

  F.net = function (prefix) {
    const P = prefix || 'n', shapes = new Map(), items = [];
    let nDot = 0;
    const N = {
      items,
      key: (id) => P + ':' + id,
      shape: (id) => shapes.get(id),
      box(id, x, y, w, h, text, cls, more) {
        shapes.set(id, { x, y, w, h, kind: 'box' });
        const it = Object.assign({ key: P + ':' + id, kind: 'state', x: r2(x), y: r2(y), w, h, rx: 6, cls: 'block ' + (cls || '') }, more || {});
        if (Array.isArray(text)) it.lines = text; else it.text = text;
        items.push(it);
        return it;
      },
      op(id, x, y, op, cls, r) {
        r = r || 11;
        shapes.set(id, { x, y, w: 2 * r, h: 2 * r, kind: 'op' });
        const it = { key: P + ':' + id, kind: 'op', x: r2(x), y: r2(y), r, op: op || 'xor', cls: cls || '' };
        items.push(it);
        return it;
      },
      port(id, side, along) {
        const s = shapes.get(id);
        if (!s) throw new Error('no shape ' + id);
        const a = along || 0;
        if (side === 'n') return [r2(s.x + (a * s.w) / 2), r2(s.y - s.h / 2)];
        if (side === 's') return [r2(s.x + (a * s.w) / 2), r2(s.y + s.h / 2)];
        if (side === 'w') return [r2(s.x - s.w / 2), r2(s.y + (a * s.h) / 2)];
        return [r2(s.x + s.w / 2), r2(s.y + (a * s.h) / 2)];
      },
      wire(id, pts, o) {
        o = o || {};
        const it = { key: P + ':w:' + id, kind: 'wire', pts: pts.map((p) => [r2(p[0]), r2(p[1])]), head: !!o.head, cls: o.cls || '' };
        if (o.dim) it.dim = true;
        items.push(it);
        return it;
      },
      /** a bus: a heavy wire with a short slash across it and its width written beside the slash */
      bus(id, pts, width, o) {
        o = o || {};
        const it = N.wire(id, pts, Object.assign({}, o, { cls: 'bus ' + (o.cls || '') }));
        if (width) {
          // the slash sits on the first run, at o.at (0..1) along it
          const [a, b] = [pts[0], pts[1]], t = o.at === undefined ? 0.5 : o.at;
          const mx = a[0] + (b[0] - a[0]) * t, my = a[1] + (b[1] - a[1]) * t, vert = Math.abs(b[0] - a[0]) < 0.5;
          items.push({ key: P + ':ws:' + id, kind: 'wire', pts: vert ? [[r2(mx - 6), r2(my + 5)], [r2(mx + 6), r2(my - 5)]] : [[r2(mx - 5), r2(my + 6)], [r2(mx + 5), r2(my - 6)]], cls: 'tick ' + (o.cls || ''), audit: 'ignore' });
          items.push({ key: P + ':wl:' + id, kind: 'text', x: r2(vert ? mx + (o.side === 'w' ? -10 : 10) : mx), y: r2(vert ? my + 4 : my - 11), text: String(width), anchor: vert ? (o.side === 'w' ? 'end' : 'start') : 'middle', size: 12, cls: 'width' });
        }
        return it;
      },
      dot(x, y, cls) { items.push({ key: P + ':d:' + nDot++, kind: 'dot', x: r2(x), y: r2(y), r: 3.6, cls: cls || '' }); },
      chip(id, text, at, cls, more) {
        const it = Object.assign({ key: P + ':c:' + id, kind: 'chip', text, cls: cls || '' }, more || {});
        if (Array.isArray(at)) { it.x = r2(at[0]); it.y = r2(at[1]); } else { it.path = at.path; it.t = at.t === undefined ? 1 : at.t; it.x = 0; it.y = 0; }
        items.push(it);
        return it;
      },
      label(id, x, y, text, cls, anchor, size) {
        const it = { key: P + ':l:' + id, kind: 'text', x: r2(x), y: r2(y), text, cls: cls || '', anchor: anchor || 'middle' };
        if (size) it.size = size;
        items.push(it);
        return it;
      },
      add(...its) { items.push(...its.flat()); },
    };
    return N;
  };

  /**
   * A curved wire from an output port a {x, y} to an input port b {x, y}: a cubic that leaves a rightwards and
   * enters b rightwards. When b lies behind a, the wire loops round below (or above, with up) both blocks.
   * Returns {d, mid: {x, y}, pts: sampled points}.
   */
  F.curve = function (a, b, opts) {
    opts = opts || {};
    let d;
    if (b.x - a.x > 40) {
      const k = Math.max(40, (b.x - a.x) * 0.5);
      d = `M${r2(a.x)},${r2(a.y)} C${r2(a.x + k)},${r2(a.y)} ${r2(b.x - k)},${r2(b.y)} ${r2(b.x)},${r2(b.y)}`;
    } else {
      const off = opts.clear || 70, yy = opts.up ? Math.min(a.y, b.y) - off : Math.max(a.y, b.y) + off;
      d = `M${r2(a.x)},${r2(a.y)} C${r2(a.x + 80)},${r2(a.y)} ${r2(a.x + 80)},${r2(yy)} ${r2(a.x)},${r2(yy)} L${r2(b.x)},${r2(yy)} C${r2(b.x - 80)},${r2(yy)} ${r2(b.x - 80)},${r2(b.y)} ${r2(b.x)},${r2(b.y)}`;
    }
    const at = (t) => { const u = 1 - t, k = Math.max(40, (b.x - a.x) * 0.5), p1 = [a.x + k, a.y], p2 = [b.x - k, b.y]; return { x: u * u * u * a.x + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * b.y }; };
    return { d, mid: b.x - a.x > 40 ? at(0.5) : { x: (a.x + b.x) / 2, y: opts.up ? Math.min(a.y, b.y) - (opts.clear || 70) : Math.max(a.y, b.y) + (opts.clear || 70) } };
  };
})(globalThis.Proses = globalThis.Proses || {});
