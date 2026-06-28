// Tree diagrams on the stage: a binary (or n-ary) tree laid out tidily, leaves in order and every parent centred
// over its children (a process tree, a buddy allocator, a directory tree, an inode's indirect blocks), each node a
// box of a few lines and each edge named beside its middle, on the outer side, so names never sit on another edge.
//   S.Kit.tree.layout(root, {x, y, levelH, boxW, boxH, gapX}) -> places every node: node.x, node.y (centre)
//     root: {id, lines: [..], cls, kids: [node..], edge: 'name of the edge into it', bar: [n0, n1..]}
//   S.Kit.tree.draw(root, {prefix, boxW, boxH, size, bar}) -> items: box prefix:n<id>, edge prefix:e<id>
//   S.Kit.tree.bounds(root, boxW, boxH) -> {x, y, w, h}
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const T = (K.tree = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  const walk = (n, f, d) => { f(n, d || 0); for (const k of n.kids || []) walk(k, f, (d || 0) + 1); };

  T.layout = function (root, o) {
    const gapX = o.gapX === undefined ? 18 : o.gapX, bw = o.boxW || 120, levelH = o.levelH || 110;
    let next = 0;
    const place = (n, d) => {
      n.depth = d;
      n.y = r2(o.y + d * levelH);
      if (!n.kids || !n.kids.length) { n.x = r2(o.x + next * (bw + gapX) + bw / 2); next++; return; }
      n.kids.forEach((k) => place(k, d + 1));
      n.x = r2((n.kids[0].x + n.kids[n.kids.length - 1].x) / 2);
    };
    place(root, 0);
    return root;
  };
  T.bounds = function (root, bw, bh) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    walk(root, (n) => { x0 = Math.min(x0, n.x - bw / 2); x1 = Math.max(x1, n.x + bw / 2); y0 = Math.min(y0, n.y - bh / 2); y1 = Math.max(y1, n.y + bh / 2); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  T.draw = function (root, o) {
    const P = o.prefix || 'tr', bw = o.boxW || 120, bh = o.boxH || 64, fs = o.size || 13, items = [], es = o.edgeSize || 13;
    walk(root, (n) => {
      const it = { key: P + ':n' + n.id, kind: 'state', x: n.x, y: n.y, w: bw, h: bh, rx: 8, lines: n.lines, size: fs, cls: 'tnode ' + (n.cls || '') };
      if (n.enter) it.enter = n.enter;
      items.push(it);
      // the class mix of the node, as a bar along its bottom edge inside the box
      if (n.bar && o.bar !== false) {
        const tot = n.bar.reduce((a, b) => a + b, 0) || 1, bx = n.x - bw / 2 + 8, by = n.y + bh / 2 - 9, w = bw - 16;
        let cx = bx;
        n.bar.forEach((c, k) => {
          const ww = (w * c) / tot;
          if (ww > 0.3) items.push({ key: P + ':b' + n.id + '_' + k, kind: 'cell', x: r2(cx), y: r2(by), w: r2(ww), h: 4, rx: 0, text: '', cls: 'tbar c' + k, audit: 'ignore' });
          cx += ww;
        });
      }
      (n.kids || []).forEach((k, i) => {
        const left = i < (n.kids.length - 1) / 2, mid = { x: (n.x + k.x) / 2, y: (n.y + bh / 2 + k.y - bh / 2) / 2 };
        const tw = S.geom.textWidth(k.edge || '', es, { bold: true });
        const e = { key: P + ':e' + k.id, kind: 'edge', from: P + ':n' + n.id, to: P + ':n' + k.id, cls: 'tedge ' + (k.edgeCls || ''), size: es };
        if (k.edge) { e.label = k.edge; e.lx = r2(mid.x + (left ? -1 : 1) * (tw / 2 + 10)); e.ly = r2(mid.y); }
        items.push(e);
      });
    });
    return items;
  };
})(globalThis.Proses = globalThis.Proses || {});
