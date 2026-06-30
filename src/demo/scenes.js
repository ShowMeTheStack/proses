// The sample scenes of the demo page, and what they share. Every value a scene shows comes from the setup it
// draws (a workload, a program, a reference string, a disk image of our own) through an engine in src/core.
// A scene file (src/demo/<letter>-<name>.js) calls S.Demo.add({id, order, tag, short, title, blurb, knobs?,
// frames({narrow, knobs}) -> [{items, say, view, narrowView?, title?, hold?}]}); the player is src/app/player.js.
(function (S) {
  'use strict';
  const D = (S.Demo = { scenes: [] });
  D.add = (scene) => { D.scenes.push(scene); D.scenes.sort((a, b) => a.order - b.order); };
  D.byId = (id) => D.scenes.find((s) => s.id === id);
  /** a box {x, y, w, h} */
  D.box = (x, y, w, h) => ({ x, y, w, h });
  /** a number for narration: n significant digits, a true minus sign */
  D.num = (v, n) => { if (!isFinite(v)) return String(v); const s = Math.abs(v) >= 1000 ? String(Math.round(v)) : String(+(+v).toPrecision(n || 3)); return s.replace(/^-/, '−'); };
  D.fix = (v, d) => (+v).toFixed(d === undefined ? 2 : d).replace(/^-/, '−');
  /** a small number in scientific form with superscript digits: 5.8×10⁻⁴ */
  D.sci = (v, d) => { const [m, e] = (+v).toExponential(d === undefined ? 1 : d).split('e'); const sup = { '-': '⁻', '+': '', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }; return m.replace('-', '−') + '×10' + [...e].map((c) => sup[c]).join(''); };
  D.pct = (v) => Math.round(v * 100) + '%';
  /** an engine's result, computed once per page however often the frames are built */
  const cache = new Map();
  D.once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
  /** signed bars: one bar per value, up (blue) for positive and down (vermilion) for negative, names under */
  D.bars = function (key, x, y, w, h, vals, names, o) {
    o = o || {};
    const n = vals.length, slot = w / n, bw = Math.min(o.bw || 26, slot * 0.7), max = o.max || Math.max(1e-9, ...vals.map(Math.abs)), mid = y + h / 2, items = [];
    items.push({ key: key + ':zero', kind: 'path', d: `M${x},${mid} h${w}`, cls: 'axis', audit: 'ignore', layer: 'back' });
    vals.forEach((v, i) => {
      const bh = Math.max(1, (Math.abs(v) / max) * (h / 2 - 2)), cx = x + slot * (i + 0.5);
      items.push({ key: key + ':b' + i, kind: 'cell', x: cx - bw / 2, y: v >= 0 ? mid - bh : mid, w: bw, h: bh, rx: 2, text: '', cls: 'bar ' + (v >= 0 ? 'pos' : 'neg'), audit: 'ignore' });
      if (names) items.push({ key: key + ':n' + i, kind: 'text', x: cx, y: y + h + 16, text: names[i], anchor: 'middle', size: o.size || 12, cls: 'tick' });
    });
    return items;
  };
})(globalThis.Proses = globalThis.Proses || {});
