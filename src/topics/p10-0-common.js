// Part 10, main memory: the families, and the small helpers every memory and virtual-memory topic shares (part 11
// uses them too): text items, a fixed view box, English lists and plurals, sizes in bytes, and a cache for engine
// results that several frames read.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'memory', order, title, blurb });
  fam('p10-binding', 10, 'Addresses and the MMU', 'Logical against physical addresses, the base and limit registers that relocate and protect, and whole processes swapped out and back.');
  fam('p10-contig', 20, 'Contiguous allocation', 'Each process in one run of memory: first, best, worst and next fit, the holes they leave, and compaction.');
  fam('p10-seg', 30, 'Segmentation', 'An address as a segment and an offset: the segment table with its limits, growth directions and protection bits.');
  fam('p10-paging', 40, 'Paging', 'Pages and frames: the address split, the page table, and the waste inside the last page.');
  fam('p10-tlb', 50, 'The TLB', 'A cache of translations: hits and misses, the effective access time, address-space ids against flushes, and the reach.');
  fam('p10-tables', 60, 'Page-table structures', 'Linear, hierarchical with any number of levels, hashed and inverted tables, walked step by step and compared by the memory they take.');

  const H = (S.P10 = {});
  /**
   * One camera for a whole run, fitted to what is drawn: the box round every item of every frame, with a margin of
   * pad stage units, so nothing touches the stage's edge and no band of the stage is left empty.
   */
  H.fitView = function (out, pad) {
    const frames = Array.isArray(out) ? out : (out && out.frames) || [];
    pad = pad === undefined ? 18 : pad;
    let box = null;
    for (const f of frames) { const b = f && f.items && S.stageBounds(f.items.filter(Boolean), { margin: 0 }); if (b) box = box ? S.geom.union([box, b]) : b; }
    if (box) { const v = { x: Math.floor(box.x - pad), y: Math.floor(box.y - pad), w: Math.ceil(box.w + 2 * pad), h: Math.ceil(box.h + 2 * pad) }; for (const f of frames) if (f) f.view = v; }
    return out;
  };
  // every topic of parts 10 and 11 is fitted this way (an adapter here, so the shared topic code stays as it is)
  if (!S.topic.fitsMemory) {
    const register = S.topic;
    S.topic = function (t) {
      if (/^p1[01]-/.test(t.family || '') && typeof t.run === 'function') { const run = t.run; t.run = function (inp) { return H.fitView(run.call(this, inp)); }; }
      return register(t);
    };
    S.topic.fitsMemory = true;
  }
  const cache = new Map();
  /** an engine result computed once per key */
  H.once = (k, f) => { if (!cache.has(k)) { if (cache.size > 400) cache.clear(); cache.set(k, f()); } return cache.get(k); };
  H.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: Math.round(x), y: Math.round(y), text: String(text), cls: cls === undefined ? 'strong' : cls }; if (size) it.size = size; if (anchor) it.anchor = anchor; if (/\bp10-sum\b|\bmb-big\b|\bp11-code\b/.test(it.cls)) it.mono = true; return it; };
  H.title = (key, x, y, text, anchor) => { const it = { key, kind: 'text', x: Math.round(x), y: Math.round(y), text, cls: 'title' }; if (anchor) it.anchor = anchor; return it; };
  H.box = (x, y, w, h) => ({ x, y, w, h });
  /** a cell: top-left x, y */
  H.cell = (key, x, y, w, h, text, cls, size, more) => Object.assign({ key, kind: 'cell', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), rx: 4, text: text === undefined ? '' : String(text), cls: cls || '', size: size || 14 }, more || {});
  H.cellL = (key, x, y, w, h, lines, cls, size, more) => Object.assign({ key, kind: 'cell', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), rx: 5, lines, cls: cls || '', size: size || 14 }, more || {});
  H.wire = (key, pts, cls, head) => ({ key, kind: 'wire', pts: pts.map((p) => [Math.round(p[0]), Math.round(p[1])]), cls: cls || '', head: head !== false });
  /** a, b and c */
  H.list = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  /** 1 page, 3 pages */
  H.plural = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  /** a or an before a word or number, by its sound */
  H.an = (w) => {
    const s = String(w);
    const v = /^\d/.test(s) ? /^(8|11|18)(\D|$)/.test(s) || /^8\d/.test(s) : /^[A-Z][A-Z0-9]*$/.test(s) ? /^[AEFHILMNORSX]/.test(s) : /^[aeiou]/i.test(s) && !/^(one|uni|use|usu|eu)/i.test(s);
    return (v ? 'an ' : 'a ') + s;
  };
  /** a number with at most d decimals, trailing zeros dropped */
  H.f = (v, d) => String(+(+v).toFixed(d === undefined ? 2 : d));
  H.pct = (v, d) => H.f(v * 100, d === undefined ? 1 : d) + '%';
  H.bytes = (n) => S.Mem.bytes(n);
  /** a size as the course writes it: 4096 → '4 KiB', 1000 → '1000 B' */
  H.size = (n) => (n >= 1024 && n % 1024 === 0 ? S.Mem.bytes(n) : n + ' B');
  /** a key-safe form of any value */
  H.k = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, '_');
  /** the classes that tell processes apart, by index */
  H.pc = (i) => 'p' + (((i % 6) + 6) % 6);
  /** parse a list of whole numbers from list input; throws a sentence on anything else */
  H.ints = (xs, what) => xs.map((x) => { const v = Number(x); if (!Number.isInteger(v)) throw new Error((what || 'value') + ' "' + x + '" is not a whole number'); return v; });
  /** a definition panel of one math section */
  H.def = (title, lines) => ({ sections: [{ id: 'd', kind: 'math', title, text: lines.join('\n') }] });
})(globalThis.Proses = globalThis.Proses || {});
