// Geometry shared by the stage and the drawing kits: text widths (estimated without a browser, so kits
// can place labels when topics run in node), shapes' boundaries, the paths of edges between shapes,
// and the small tests a layout needs (segments crossing, a segment through a box).
(function (S) {
  'use strict';
  const G = S.geom = {};

  // ---- text ---------------------------------------------------------------------------------------------
  // Widths in em of the system sans-serif, rounded up a little so estimates err on the wide side.
  const NARROW = new Set([...'iljI.,:;|!\'`()[]{} ']), MID = new Set([...'frtJ-"/\\*']), WIDE = new Set([...'mwMW@%']);
  const SYM = new Set([...'→←↦⇒∅εΣΓδλμσ∪∩×·⊔⊢∗≤≥≠∈∉⊆⊂′']);
  /** Estimated width in px of a string at a font size; opts {mono, bold} */
  G.textWidth = function (s, size, opts) {
    s = String(s === undefined || s === null ? '' : s);
    size = size || 14;
    // text drawn in capitals with letter spacing (CSS text-transform and letter-spacing) is measured that way
    if (opts && opts.caps) s = s.toUpperCase();
    const spacing = opts && opts.spacing ? opts.spacing * size * [...s].length : 0;
    if (opts && opts.mono) return [...s].length * size * 0.61 + spacing;
    let w = 0;
    for (const ch of s) {
      if (NARROW.has(ch)) w += 0.3;
      else if (MID.has(ch)) w += 0.4;
      else if (WIDE.has(ch)) w += 0.88;
      else if (SYM.has(ch)) w += 0.66;
      else if (ch >= 'A' && ch <= 'Z') w += 0.68;
      else if (ch >= '0' && ch <= '9') w += 0.6;
      else if (ch.charCodeAt(0) >= 0x2080 && ch.charCodeAt(0) <= 0x209c) w += 0.42;
      else if (ch === '⊕' || ch === '⊞' || ch === '…') w += 0.82;
      else if (ch.charCodeAt(0) > 0x2000) w += 0.8;
      else w += 0.57;
    }
    return w * size * (opts && opts.bold ? 1.06 : 1) + spacing;
  };
  S.textWidth = G.textWidth;

  // ---- shapes -------------------------------------------------------------------------------------------
  /**
   * A shape is {x, y} centre plus either r (a circle) or w, h, rx (a rounded box). `state` items are both:
   * a circle is a box with w = h = 2r and rx = r. shapeOf turns an item's numbers into a shape.
   */
  G.shapeOf = function (c) {
    if (c.w !== undefined && c.h !== undefined) return { x: c.x, y: c.y, w: c.w, h: c.h, rx: c.rx === undefined ? Math.min(c.w, c.h) / 2 : c.rx };
    const r = c.r === undefined ? 0 : c.r;
    return { x: c.x, y: c.y, w: 2 * r, h: 2 * r, rx: r };
  };
  const isCircle = (s) => Math.abs(s.w - s.h) < 0.5 && s.rx >= s.w / 2 - 0.5;
  /** Where the ray from a shape's centre towards (tx, ty) leaves the shape, pushed out by gap */
  G.boundary = function (s, tx, ty, gap) {
    gap = gap || 0;
    let dx = tx - s.x, dy = ty - s.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    if (!s.w) return { x: s.x + dx * gap, y: s.y + dy * gap };
    if (isCircle(s)) { const r = s.w / 2 + gap; return { x: s.x + dx * r, y: s.y + dy * r }; }
    const hw = s.w / 2, hh = s.h / 2, rx = Math.min(s.rx || 0, hw, hh);
    // the flat sides first
    let t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    let px = dx * t, py = dy * t;
    // a hit in a corner zone lands on that corner's arc instead
    if (rx > 0 && Math.abs(px) > hw - rx && Math.abs(py) > hh - rx) {
      const cx = Math.sign(dx) * (hw - rx), cy = Math.sign(dy) * (hh - rx);
      // solve |t*d - c| = rx for the larger root
      const b = dx * cx + dy * cy, cc = cx * cx + cy * cy - rx * rx;
      const disc = b * b - cc;
      if (disc >= 0) { t = b + Math.sqrt(disc); px = dx * t; py = dy * t; }
    }
    return { x: s.x + px + dx * gap, y: s.y + py + dy * gap };
  };

  // ---- edges --------------------------------------------------------------------------------------------
  /**
   * The path of an edge from shape A to shape B (B may be a point {x, y} with no size).
   * opts: {bend: sideways offset of the middle in px (+ is to the left of A→B), loop: angle in radians
   *   for an edge from a shape to itself, gapA, gapB: space left at each end (B's leaves room for the head)}
   * Returns {d, a, b, c (control points), at(t) -> point, tan(t) -> unit tangent, mid, len}.
   */
  G.edge = function (A, B, opts) {
    opts = opts || {};
    if (opts.loop !== undefined && opts.loop !== null) return loopPath(A, opts.loop, opts);
    const bend = opts.bend || 0;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    const nx = dy / L, ny = -dx / L;          // the left-hand normal of A→B (screen coordinates: y down)
    const mx = (A.x + B.x) / 2 + nx * bend * 2, my = (A.y + B.y) / 2 + ny * bend * 2; // control point; the curve's middle is bend away
    const a = G.boundary(A, bend ? mx : B.x, bend ? my : B.y, opts.gapA || 0);
    const b = G.boundary(B, bend ? mx : A.x, bend ? my : A.y, opts.gapB === undefined ? 1 : opts.gapB);
    if (!bend) {
      const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const tan = () => ({ x: (b.x - a.x) / l, y: (b.y - a.y) / l });
      return { d: `M${r2(a.x)},${r2(a.y)} L${r2(b.x)},${r2(b.y)}`, a, b, at, tan, mid: at(0.5), len: l, straight: true };
    }
    // a quadratic through a and b whose control point keeps the middle bend px off the chord
    const c = { x: mx, y: my };
    const at = (t) => { const u = 1 - t; return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }; };
    const tan = (t) => { const x = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x), y = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y); const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
    return { d: `M${r2(a.x)},${r2(a.y)} Q${r2(c.x)},${r2(c.y)} ${r2(b.x)},${r2(b.y)}`, a, b, c, at, tan, mid: at(0.5), len: L };
  };
  /** A loop leaving a shape and coming back, pointing out at angle th */
  function loopPath(A, th, opts) {
    const spread = 0.42, size = opts.loopSize || 40;
    const s = G.shapeOf(A);
    const p1 = G.boundary(s, s.x + Math.cos(th - spread) * 100, s.y + Math.sin(th - spread) * 100, opts.gapA || 0);
    const p2 = G.boundary(s, s.x + Math.cos(th + spread) * 100, s.y + Math.sin(th + spread) * 100, opts.gapB === undefined ? 1 : opts.gapB);
    const ext = Math.max(s.w, s.h) / 2;
    const k = ext + size * 1.55;
    const c1 = { x: s.x + Math.cos(th - spread * 1.5) * k, y: s.y + Math.sin(th - spread * 1.5) * k };
    const c2 = { x: s.x + Math.cos(th + spread * 1.5) * k, y: s.y + Math.sin(th + spread * 1.5) * k };
    const at = (t) => { const u = 1 - t; return { x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x, y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y }; };
    const tan = (t) => { const q = at(Math.min(1, t + 0.01)), p = at(Math.max(0, t - 0.01)); const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }; };
    const mid = at(0.5);
    return { d: `M${r2(p1.x)},${r2(p1.y)} C${r2(c1.x)},${r2(c1.y)} ${r2(c2.x)},${r2(c2.y)} ${r2(p2.x)},${r2(p2.y)}`, a: p1, b: p2, at, tan, mid, len: size * 3, loop: true, dir: { x: Math.cos(th), y: Math.sin(th) } };
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  G.r2 = r2;
  /** Points along an edge path, for collision tests */
  G.sample = function (e, n) {
    if (e.straight) return [e.a, e.b];
    n = n || 16;
    const out = [];
    for (let i = 0; i <= n; i++) out.push(e.at(i / n));
    return out;
  };

  // ---- tests ----------------------------------------------------------------------------------------------
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  /** Do segments pq and rs cross properly (not at a shared end)? */
  G.segCross = function (p, q, r, s) {
    const d1 = cross(r, s, p), d2 = cross(r, s, q), d3 = cross(p, q, r), d4 = cross(p, q, s);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  /** Does segment pq pass through box b {x, y, w, h} (top-left)? */
  G.segBox = function (p, q, b) {
    if (Math.max(p.x, q.x) <= b.x || Math.min(p.x, q.x) >= b.x + b.w || Math.max(p.y, q.y) <= b.y || Math.min(p.y, q.y) >= b.y + b.h) return false;
    const inside = (r) => r.x > b.x && r.x < b.x + b.w && r.y > b.y && r.y < b.y + b.h;
    if (inside(p) || inside(q)) return true;
    const c = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
    for (let i = 0; i < 4; i++) if (G.segCross(p, q, c[i], c[(i + 1) % 4])) return true;
    return false;
  };
  /** Does a polyline pass through the box? */
  G.polyBox = function (pts, b) { for (let i = 1; i < pts.length; i++) if (G.segBox(pts[i - 1], pts[i], b)) return true; return false; };
  /** How many times two polylines cross */
  G.polyCross = function (A, B) {
    let n = 0;
    for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) if (G.segCross(A[i - 1], A[i], B[j - 1], B[j])) n++;
    return n;
  };
  G.boxHit = (a, b, pad) => { pad = pad || 0; return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad; };
  /** Distance from point p to segment ab */
  G.segDist = function (p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  /** The box a label of this text takes when centred at (x, y) */
  G.labelBox = function (text, x, y, size, opts) {
    const lines = String(text).split('\n');
    const w = Math.max(...lines.map((l) => G.textWidth(l, size, opts))) + 6, h = lines.length * size * 1.25 + 2;
    return { x: x - w / 2, y: y - h / 2, w, h };
  };

  /** Bounds {x, y, w, h} of a list of boxes */
  G.union = function (boxes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) { if (!b) continue; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
})(globalThis.Proses = globalThis.Proses || {});
