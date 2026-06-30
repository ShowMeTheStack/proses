// Geometry checks for the diagrams on the page, run inside the browser by tools/check-diagrams.mjs
// (the family's checker, with a role for edges that may cross and one for values drawn on wires).
// ProsesAudit.run(root) looks at every visible <svg> under root (and text in HTML boxes) and returns a list of
// problems: shapes that overlap, edges that cross each other or run through a shape or a label, labels that
// collide, labels that spill out of their box or are cut off by the drawing's edge or a clipping container.
//
// What counts as what is guessed from the elements, and can be stated with data-audit:
//   data-audit="ignore"  skip the element and everything inside it (backgrounds, grids, decorations)
//   data-audit="node"    a shape that edges join and nothing may overlap; with data-audit-ends="strict" too, the
//                        edges that end at it join it at its border and may not pass through its inside either
//   data-audit="edge"    a connector
//   data-audit="label"   text that must not collide (default for <text>)
//   data-audit="group"   a container shape that other nodes may sit inside (a cluster, a lane, a page)
//   data-audit="overlap-ok" a shape that may overlap others (a highlight, a selection)
//   data-audit="edge-x"  a connector that may cross other connectors (the dense graphs a reduction builds),
//                        but must still keep clear of shapes and labels
//   data-audit="small-ok" a secondary label that may be drawn down to 9px (see auditText): bit indexes and the
//                        row names of a bit matrix
//   data-audit="point"   a point marked on a plot: curves and lines may pass through it (it lies on them), but
//                        labels must keep clear of it
//   data-audit="on-wire" a value drawn on a wire on purpose, over an opaque pill that hides the wire under it (a
//                        chip): wires may pass under it, but it must not touch other labels or shapes
// Edges may share endpoints; an edge may touch the nodes at its two ends.
//
(function (root) {
  'use strict';
  const EPS = 1.5;

  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      if (e.dataset && e.dataset.audit === 'ignore') return false;
      if (e.tagName === 'marker' || e.tagName === 'defs' || e.tagName === 'clipPath' || e.tagName === 'pattern' || e.tagName === 'symbol') return false;
      // the body of a closed <details> is not drawn, though it still has boxes
      if (e.parentNode && e.parentNode.tagName === 'DETAILS' && !e.parentNode.open && e.tagName !== 'SUMMARY') return false;
    }
    return true;
  };
  const role = (el) => { for (let e = el; e && e.nodeType === 1 && e.tagName !== 'svg'; e = e.parentNode) if (e.dataset && e.dataset.audit && e.dataset.audit !== 'ignore') return e.dataset.audit; return null; };

  // ---- geometry ---------------------------------------------------------------------------------------------------
  const rect = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const shrink = (a, d) => ({ x: a.x + d, y: a.y + d, w: Math.max(0, a.w - 2 * d), h: Math.max(0, a.h - 2 * d) });
  const contains = (a, b, d) => b.x >= a.x - (d || 0) && b.y >= a.y - (d || 0) && b.x + b.w <= a.x + a.w + (d || 0) && b.y + b.h <= a.y + a.h + (d || 0);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  /** proper intersection of two segments, ignoring touches within EPS of an endpoint */
  function segX(p1, p2, p3, p4, ends) {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      const t = d1 / (d1 - d2);
      const pt = { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
      const near = (q) => Math.hypot(q.x - pt.x, q.y - pt.y) < EPS * 2;
      // ends: the true ends of two edges (inner vertices of a curve or polyline are no excuse)
      if ((ends || [p1, p2, p3, p4]).some(near)) return null;
      return pt;
    }
    // collinear overlap of two edges running on top of each other
    if (Math.abs(d1) < 1e-6 && Math.abs(d2) < 1e-6) {
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const proj = (q) => ((q.x - p1.x) * (p2.x - p1.x) + (q.y - p1.y) * (p2.y - p1.y)) / len;
      const a = Math.max(0, Math.min(proj(p3), proj(p4))), b = Math.min(len, Math.max(proj(p3), proj(p4)));
      if (b - a > 4) return { x: p1.x + (p2.x - p1.x) * ((a + b) / 2 / len), y: p1.y + (p2.y - p1.y) * ((a + b) / 2 / len), along: true };
    }
    return null;
  }
  function segBox(p, q, b) {
    // does the segment pass through the interior of box b?
    if (Math.max(p.x, q.x) <= b.x || Math.min(p.x, q.x) >= b.x + b.w || Math.max(p.y, q.y) <= b.y || Math.min(p.y, q.y) >= b.y + b.h) return false;
    const inside = (r) => r.x > b.x && r.x < b.x + b.w && r.y > b.y && r.y < b.y + b.h;
    if (inside(p) || inside(q)) return true;
    const c = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
    for (let i = 0; i < 4; i++) if (segX(p, q, c[i], c[(i + 1) % 4])) return true;
    return false;
  }
  const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };

  /** an element's outline in page coordinates: points along its geometry */
  function points(el) {
    const m = el.getScreenCTM();
    if (!m) return [];
    const tr = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    const t = el.tagName;
    if (t === 'line') return [tr(+el.getAttribute('x1') || 0, +el.getAttribute('y1') || 0), tr(+el.getAttribute('x2') || 0, +el.getAttribute('y2') || 0)];
    if (t === 'polyline' || t === 'polygon') { const ps = [...el.points].map((p) => tr(p.x, p.y)); if (t === 'polygon' && ps.length) ps.push(ps[0]); return ps; }
    if (t === 'path') {
      let len = 0; try { len = el.getTotalLength(); } catch (e) { return []; }
      const d = el.getAttribute('d') || '';
      const curved = /[CcQqSsTtAa]/.test(d);
      if (!curved) {
        // straight segments: take the vertices
        const out = []; let cur = { x: 0, y: 0 }, start = null;
        const toks = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
        let cmd = 'M', i = 0;
        const num = () => +toks[i++];
        while (i < toks.length) {
          if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
          if (cmd === 'Z' || cmd === 'z') { if (start) out.push(tr(start.x, start.y)); cur = start || cur; continue; }
          if (cmd === 'M' || cmd === 'L') { cur = { x: num(), y: num() }; if (cmd === 'M') { start = cur; out.push(null); } out.push(tr(cur.x, cur.y)); if (cmd === 'M') cmd = 'L'; }
          else if (cmd === 'm' || cmd === 'l') { cur = { x: cur.x + num(), y: cur.y + num() }; if (cmd === 'm') { start = cur; out.push(null); } out.push(tr(cur.x, cur.y)); if (cmd === 'm') cmd = 'l'; }
          else if (cmd === 'H') { cur = { x: num(), y: cur.y }; out.push(tr(cur.x, cur.y)); }
          else if (cmd === 'h') { cur = { x: cur.x + num(), y: cur.y }; out.push(tr(cur.x, cur.y)); }
          else if (cmd === 'V') { cur = { x: cur.x, y: num() }; out.push(tr(cur.x, cur.y)); }
          else if (cmd === 'v') { cur = { x: cur.x, y: cur.y + num() }; out.push(tr(cur.x, cur.y)); }
          else i++;
        }
        return out;
      }
      const n = Math.max(8, Math.min(300, Math.ceil(len / 6)));
      const out = [];
      for (let k = 0; k <= n; k++) { const p = el.getPointAtLength((len * k) / n); out.push(tr(p.x, p.y)); }
      return out;
    }
    return [];
  }
  const segs = (pts) => { const out = []; for (let i = 1; i < pts.length; i++) if (pts[i - 1] && pts[i]) out.push([pts[i - 1], pts[i]]); return out; };


  const filled = (el) => { const cs = getComputedStyle(el); return !clear(cs.fill) && +cs.fillOpacity > 0.05; };
  const clear = (c) => !c || c === 'none' || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(c);
  const stroked = (el) => { const cs = getComputedStyle(el); return !clear(cs.stroke) && parseFloat(cs.strokeWidth) > 0 && +cs.strokeOpacity > 0.05; };
  const label = (el) => { const s = (el.textContent || '').trim().replace(/\s+/g, ' '); return s.length > 28 ? s.slice(0, 26) + '…' : s; };
  const where = (el) => { const parts = []; for (let e = el; e && e.nodeType === 1 && parts.length < 3; e = e.parentNode) { const c = e.getAttribute && e.getAttribute('class'); parts.unshift(e.tagName.toLowerCase() + (c ? '.' + String(c).trim().split(/\s+/).slice(0, 2).join('.') : '')); if (e.tagName === 'svg') break; } return parts.join(' > '); };

  /** the clip a container puts on an element: the intersection of every overflow-hidden ancestor's box */
  function clipOf(el, stop) {
    let c = null;
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(hidden|clip|auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY) && e.tagName !== 'svg') {
        // scrolling containers clip only what cannot be scrolled to: their full scroll area
        const r = e.getBoundingClientRect();
        const scrolls = /(auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY);
        const b = scrolls ? { x: r.left - e.scrollLeft, y: r.top - e.scrollTop, w: Math.max(r.width, e.scrollWidth), h: Math.max(r.height, e.scrollHeight) } : rect(r);
        c = c ? { x: Math.max(c.x, b.x), y: Math.max(c.y, b.y), w: Math.min(c.x + c.w, b.x + b.w) - Math.max(c.x, b.x), h: Math.min(c.y + c.h, b.y + b.h) - Math.max(c.y, b.y) } : b;
        // what lies in a scroll area can be scrolled into view: the containers above clip the scroller, not it
        if (scrolls) break;
      }
      if (e === stop) break;
    }
    return c;
  }

  // ---- one svg ----------------------------------------------------------------------------------------------------
  function auditSvg(svg, out, ctx) {
    const sr = rect(svg.getBoundingClientRect());
    if (sr.w < 20 || sr.h < 20) return;
    const svgArea = sr.w * sr.h;
    const all = [...svg.querySelectorAll('rect,circle,ellipse,polygon,path,line,polyline,text')].filter(vis);
    const nodes = [], edges = [], texts = [], groups = [];
    for (const el of all) {
      const r = role(el);
      if (r === 'ignore') continue;
      if (el.tagName === 'text') { if (label(el)) texts.push({ el, b: rect(el.getBoundingClientRect()), r }); continue; }
      const b = rect(el.getBoundingClientRect());
      if (b.w * b.h > svgArea * 0.6 && r !== 'node') continue; // a background
      if (r === 'group') { groups.push({ el, b }); continue; }
      if (r === 'edge' || r === 'edge-x') { edges.push({ el, b, pts: points(el), x: r === 'edge-x' }); continue; }
      if (r === 'node' || r === 'overlap-ok' || r === 'point') { nodes.push({ el, b, poly: el.tagName === 'polygon' ? points(el) : null, ok: r === 'overlap-ok', pt: r === 'point', strict: el.dataset && el.dataset.auditEnds === 'strict' }); continue; }
      const t = el.tagName;
      const isFilled = filled(el);
      if (t === 'line' || t === 'polyline' || (t === 'path' && !isFilled)) { if (stroked(el) && Math.hypot(b.w, b.h) > 18) edges.push({ el, b, pts: points(el), x: r === 'edge-x' }); continue; }
      if (!isFilled && !stroked(el)) continue;
      if (b.w < 6 && b.h < 6) continue; // dots, small markers
      if (t === 'polygon' && b.w * b.h < 200 && !(el.parentNode && el.parentNode.querySelector('text'))) continue; // arrowheads
      if (t === 'path' && isFilled && b.w * b.h < 200) continue;
      nodes.push({ el, b, poly: t === 'polygon' ? points(el) : null });
    }
    // HTML laid over the drawing (cards, labels next to it in the same box) takes part when it says what it is
    for (const el of svg.parentElement ? svg.parentElement.querySelectorAll('[data-audit]') : []) {
      if (el instanceof SVGElement || !vis(el)) continue;
      const r = el.dataset.audit, b = rect(el.getBoundingClientRect());
      if (b.w * b.h <= 0) continue;
      if (r === 'label' && label(el)) texts.push({ el, b, r });
      else if (r === 'node' || r === 'overlap-ok') nodes.push({ el, b, poly: null, ok: r === 'overlap-ok' });
    }
    const add = (kind, msg, a, b2) => out.push({ svg: ctx.name, kind, msg, a: a ? where(a) : '', b: b2 ? where(b2) : '' });

    // view box: what can be seen of the drawing (the svg's own box, clipped by its containers)
    const clip = clipOf(svg);
    // an svg that lets its drawing overflow is bounded only by its containers
    if (clip && getComputedStyle(svg).overflow === 'visible') sr.x = clip.x, sr.y = clip.y, sr.w = clip.w, sr.h = clip.h;
    const view = clip ? { x: Math.max(sr.x, clip.x), y: Math.max(sr.y, clip.y), w: Math.min(sr.x + sr.w, clip.x + clip.w) - Math.max(sr.x, clip.x), h: Math.min(sr.y + sr.h, clip.y + clip.h) - Math.max(sr.y, clip.y) } : sr;

    // labels cut off by the drawing's edge
    // a stage showing a close-up for a narrow screen (data-narrow) cuts at its edge on purpose
    const narrow = svg.dataset && svg.dataset.narrow === '1';
    if (!narrow) for (const t of texts) if (t.b.w > 0 && !contains(view, t.b, 1.5)) add('label-cut', '"' + label(t.el) + '" is cut off by the edge of the drawing', t.el);
    if (!narrow) for (const n of nodes) if (!n.ok && n.b.w > 0 && !contains(view, n.b, 2)) add('shape-cut', 'a ' + n.el.tagName + ' is cut off by the edge of the drawing', n.el);

    // labels colliding with each other
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const ov = inter(shrink(a.b, 1), shrink(b.b, 1));
      if (ov > 2) add('label-overlap', '"' + label(a.el) + '" overlaps "' + label(b.el) + '"', a.el, b.el);
    }
    // the box a label belongs to: the smallest node containing its centre (a highlight owns nothing)
    const owner = (t) => { const c = { x: t.b.x + t.b.w / 2, y: t.b.y + t.b.h / 2 }; let best = null; for (const n of nodes) { if (n.ok) continue; const inside = n.poly ? inPoly(c, n.poly) : c.x > n.b.x && c.x < n.b.x + n.b.w && c.y > n.b.y && c.y < n.b.y + n.b.h; if (inside && (!best || n.b.w * n.b.h < best.b.w * best.b.h)) best = n; } return best; };
    for (const t of texts) {
      const o = owner(t);
      t.owner = o;
      if (o) {
        const tb = shrink(t.b, 1);
        const fits = o.poly ? [{ x: tb.x, y: tb.y }, { x: tb.x + tb.w, y: tb.y }, { x: tb.x, y: tb.y + tb.h }, { x: tb.x + tb.w, y: tb.y + tb.h }].every((p) => inPoly(p, o.poly)) : contains(o.b, tb, 0.5);
        if (!fits) add('label-spill', '"' + label(t.el) + '" does not fit inside its ' + o.el.tagName, t.el, o.el);
      }
      // a label lying on a shape it is not inside
      for (const n of nodes) if (n !== o && !n.ok && inter(shrink(t.b, 1), n.b) > 4 && !contains(n.b, t.b, 0) && !(o && contains(n.b, o.b, 1))) add('label-on-shape', '"' + label(t.el) + '" lies across a ' + n.el.tagName, t.el, n.el);
    }
    // shapes overlapping (nesting is fine)
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.ok || b.ok) continue;
      if (contains(a.b, b.b, 1) || contains(b.b, a.b, 1)) continue;
      if (a.el.parentNode === b.el.parentNode && a.el.tagName === b.el.tagName && Math.abs(a.b.x - b.b.x) < 8 && Math.abs(a.b.y - b.b.y) < 8) continue; // a double border
      let ov = inter(shrink(a.b, 1), shrink(b.b, 1));
      if (ov > 4 && (a.poly || b.poly)) {
        // polygons: check the real outlines
        const pa = a.poly || [{ x: a.b.x, y: a.b.y }, { x: a.b.x + a.b.w, y: a.b.y }, { x: a.b.x + a.b.w, y: a.b.y + a.b.h }, { x: a.b.x, y: a.b.y + a.b.h }, { x: a.b.x, y: a.b.y }];
        const pb = b.poly || [{ x: b.b.x, y: b.b.y }, { x: b.b.x + b.b.w, y: b.b.y }, { x: b.b.x + b.b.w, y: b.b.y + b.b.h }, { x: b.b.x, y: b.b.y + b.b.h }, { x: b.b.x, y: b.b.y }];
        const hit = segs(pa).some(([p, q]) => segs(pb).some(([r, s]) => segX(p, q, r, s))) || pa.some((p) => inPoly(p, pb)) || pb.some((p) => inPoly(p, pa));
        if (!hit) ov = 0;
      }
      if (ov > 4) add('shape-overlap', 'a ' + a.el.tagName + ' and a ' + b.el.tagName + ' overlap' + (label(a.el.parentNode) ? ' ("' + label(a.el.parentNode) + '")' : ''), a.el, b.el);
    }
    // edges: crossings, through shapes, through labels
    const ends = (e) => { const ps = e.pts.filter(Boolean); return ps.length ? [ps[0], ps[ps.length - 1]] : []; };
    const touches = (pt, b, d) => pt.x >= b.x - d && pt.x <= b.x + b.w + d && pt.y >= b.y - d && pt.y <= b.y + b.h + d;
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      if (edges[i].x && edges[j].x) continue;
      const A = segs(edges[i].pts), B = segs(edges[j].pts);
      let hit = null;
      const E = ends(edges[i]).concat(ends(edges[j]));
      for (const [p, q] of A) { for (const [r, s] of B) { hit = segX(p, q, r, s, E); if (hit) break; } if (hit) break; }
      if (hit) {
        // parallel strokes of one double line are one edge
        if (hit.along && edges[i].el.parentNode === edges[j].el.parentNode) continue;
        // edges that leave one point (or reach one) run together as a bundle before they part
        const same = (p, q) => p && q && Math.hypot(p.x - q.x, p.y - q.y) < 2;
        const ea = ends(edges[i]), eb = ends(edges[j]);
        if (same(ea[0], eb[0]) || same(ea[1], eb[1])) {
          if (hit.along) continue;
          // where they still run together, two drawings of one curve sampled apart may cross by a hair: not a crossing
          const dSeg = (p, a, b) => { const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)); return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y)); };
          const dPoly = (p, ss) => Math.min(...ss.map(([a, b]) => dSeg(p, a, b)));
          const nearA = edges[i].pts.filter((p) => p && Math.hypot(p.x - hit.x, p.y - hit.y) < 14);
          if (nearA.every((p) => dPoly(p, B) < 2)) continue;
        }
        add(hit.along ? 'edge-overlap' : 'edge-cross', 'two edges ' + (hit.along ? 'run on top of each other' : 'cross') + ' at (' + Math.round(hit.x - sr.x) + ', ' + Math.round(hit.y - sr.y) + ')', edges[i].el, edges[j].el);
      }
    }
    for (const e of edges) {
      const [p0, p1] = ends(e);
      if (!p0) continue;
      for (const n of nodes) {
        if (n.ok || n.pt) continue;
        if (touches(p0, n.b, 6) || touches(p1, n.b, 6)) {
          // an end of the edge: it may touch the shape, but a shape whose edges join it at its border (a block of the
          // diagram, wired at its ports) must not have an edge run through or under its inside
          if (n.strict && segs(e.pts).some(([p, q]) => segBox(p, q, shrink(n.b, 7)))) add('edge-through-shape', 'an edge runs through or under the shape it joins' + (label(n.el.parentNode) ? ' ("' + label(n.el.parentNode) + '")' : ''), e.el, n.el);
          continue;
        }
        if (n.el.parentNode === e.el.parentNode && n.b.w * n.b.h < 200) continue; // a marker drawn on the edge itself (a crow's foot circle)
        if (segs(e.pts).some(([p, q]) => segBox(p, q, shrink(n.b, 2)))) add('edge-through-shape', 'an edge runs through a ' + n.el.tagName + (label(n.el.parentNode) ? ' ("' + label(n.el.parentNode) + '")' : ''), e.el, n.el);
      }
      for (const t of texts) {
        if (t.owner && (touches(p0, t.owner.b, 6) || touches(p1, t.owner.b, 6))) continue;
        if (t.r === 'on-wire') continue;
        if (segs(e.pts).some(([p, q]) => segBox(p, q, shrink(t.b, 1.5)))) add('edge-through-label', 'an edge runs through "' + label(t.el) + '"', e.el, t.el);
      }
    }
  }

  // ---- text in HTML boxes -----------------------------------------------------------------------------------------
  // Every run of text (not only leaf elements, so a narration with a bold word in it counts) must lie inside
  // every box that clips it; a box whose content is wider than it and scrolls sideways must say so
  // (data-scroll-affordance, which T.UI.fitTables sets with a visible note and fade); a text box must show
  // all its text; and the page itself must not scroll sideways.
  function auditHtml(rootEl, out, ctx) {
    const add = (kind, msg, e) => out.push({ svg: ctx.name, kind, msg, a: e ? where(e) : '', b: '' });
    const els = [rootEl, ...rootEl.querySelectorAll('*')].filter((e) => !(e instanceof SVGElement) && vis(e));
    for (const e of els) {
      const cs = getComputedStyle(e);
      const txt = e.children.length === 0 && (e.textContent || '').trim();
      if (txt && (/(hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY) || cs.textOverflow === 'ellipsis') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2) && !e.title) add('html-cut', '"' + label(e) + '" is cut off by its box', e);
      // sideways scrolling nobody can see
      if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && !e.closest('[data-scroll-affordance]') && !e.matches('.main,.side,.modal-body,.ed-canvas-wrap,.cat-topics') && e !== document.scrollingElement) add('html-scroll', 'the content of a ' + e.tagName.toLowerCase() + ' is ' + (e.scrollWidth - e.clientWidth) + 'px wider than it and scrolls sideways with no sign of it', e);
      // a text box that hides part of its text (one the reader opened, or that was meant to show it all)
      if (e.tagName === 'TEXTAREA' && !e.dataset.scrollOk && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 0) add('html-cut', 'a text box shows ' + Math.round(e.clientHeight) + 'px of ' + e.scrollHeight + 'px of its text', e);
    }
    // every piece of text against the boxes that clip it
    const walk = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() && n.parentElement && !(n.parentElement instanceof SVGElement) && !n.parentElement.closest('svg,input,textarea,select,option,.ed-hl,.ed-ta,script,style') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const range = document.createRange();
    const seenEl = new Set();
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const e = n.parentElement;
      if (seenEl.has(e) || !vis(e)) continue;
      range.selectNodeContents(n);
      const r = rect(range.getBoundingClientRect());
      if (r.w <= 0 || r.h <= 0) continue;
      const c = clipOf(e, rootEl);
      if (c && !contains(c, r, 2) && inter(c, r) > 0) { seenEl.add(e); add('html-cut', '"' + label(e) + '" is partly hidden by a container', e); }
      else if (c && inter(c, r) <= 0 && c.w > 0 && c.h > 0 && !/(auto|scroll)/.test(getComputedStyle(e.parentElement || e).overflow)) { /* scrolled out of view, not cut */ }
    }
    if (ctx.page) {
      const m = document.querySelector('.main');
      if (m && m.scrollWidth > m.clientWidth + 1) add('html-overflow', 'the page is ' + (m.scrollWidth - m.clientWidth) + 'px wider than the screen and scrolls sideways', m);
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) add('html-overflow', 'the window scrolls sideways', document.documentElement);
    }
  }

  // ---- text size and filling the stage --------------------------------------------------------------------------
  // Text drawn smaller than 11px on screen at desktop size is a problem. On a phone (under 600px wide) text under
  // 10px is only a warning, since the stage there can be pinched and zoomed. A secondary label marked
  // data-audit="small-ok" (on it or an ancestor: a bit index, the row names of a bit matrix) may go down to 9px. A
  // thumbnail (data-audit-text="small" on it or an ancestor) is exempt. Axis tick labels on one row keep 6px
  // apart (tick labels are the texts of items whose key holds ":t:"). A stage picture that fills less than 55% of
  // the stage's width while it has room to grow (its height is not what limits it) is a warning.
  function auditText(svg, out, ctx, opts) {
    if (svg.closest('[data-audit-text="small"]')) return;
    const phone = innerWidth < 600;
    const min = opts.minText || (phone ? 10 : 11), minOk = 9;
    const smallOk = (t) => { for (let e = t; e && e !== svg && e.nodeType === 1; e = e.parentNode) if (e.dataset && e.dataset.audit === 'small-ok') return true; return false; };
    const small = [];
    for (const t of svg.querySelectorAll('text')) {
      if (!vis(t) || !label(t) || role(t) === 'ignore') continue;
      const r = t.getBoundingClientRect();
      if (r.width === 0) continue;
      const m = t.getScreenCTM();
      const px = parseFloat(getComputedStyle(t).fontSize) * (m ? Math.hypot(m.a, m.b) : 1);
      const floor = smallOk(t) ? Math.min(min, minOk) : min;
      if (px < floor - 0.05) small.push([px, t, floor]);
    }
    small.sort((a, b) => a[0] - b[0]);
    for (const [px, t, floor] of small.slice(0, 6)) out.push({ svg: ctx.name, kind: 'tiny-text', warn: phone || undefined, msg: '"' + label(t) + '" is drawn at ' + Math.round(px * 10) / 10 + 'px, under ' + floor + 'px' + (small.length > 6 ? ' (' + small.length + ' texts in all)' : ''), a: where(t), b: '' });
    const ticks = [...svg.querySelectorAll('[data-key*=":t:"] text')].filter(vis).map((t) => t.getBoundingClientRect()).filter((r) => r.width);
    const rows = new Map();
    for (const r of ticks) { const k = Math.round(r.top); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(r); }
    let tight = 0;
    for (const list of rows.values()) { list.sort((a, b) => a.left - b.left); for (let i = 1; i < list.length; i++) if (list[i].left - list[i - 1].right < 6) tight++; }
    if (tight) out.push({ svg: ctx.name, kind: 'tick-crowd', msg: tight + ' axis tick labels closer than 6px to the next', a: '', b: '' });
    if (svg.classList.contains('stage-svg') && !svg.dataset.narrow) {
      const S = rect(svg.getBoundingClientRect());
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const g of svg.querySelectorAll('[data-key]')) {
        if (!vis(g) || g.parentNode.closest('[data-key]')) continue;
        const r = g.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
      }
      if (x2 > x1 && S.w > 200) {
        const fw = (x2 - x1) / S.w, fh = (y2 - y1) / S.h;
        if (fw < 0.55 && fh < 0.8) out.push({ svg: ctx.name, kind: 'under-filled', warn: true, msg: 'the picture fills ' + Math.round(fw * 100) + '% of the stage\'s width and ' + Math.round(fh * 100) + '% of its height', a: '', b: '' });
      }
    }
  }

  function run(rootEl, opts) {
    rootEl = rootEl || document.body;
    opts = opts || {};
    // parts of a page drawn only when scrolled to (content-visibility: auto) have no layout to measure: draw them
    for (const e of rootEl.querySelectorAll('*')) if (getComputedStyle(e).contentVisibility === 'auto') e.style.contentVisibility = 'visible';
    const out = [];
    const svgs = [...rootEl.querySelectorAll('svg')].filter((s) => vis(s) && !s.closest('button,.btn,.icon,.ic') && s.getBoundingClientRect().width > 40 && s.getBoundingClientRect().height > 40 && !(s.parentNode && s.parentNode.closest('svg')));
    svgs.forEach((s, i) => { const ctx = { name: (s.getAttribute('aria-label') || s.getAttribute('class') || 'svg') + '#' + i }; auditSvg(s, out, ctx); if (opts.text !== false) auditText(s, out, ctx, opts); });
    if (opts.html !== false) auditHtml(rootEl, out, { name: 'html', page: !!opts.page });
    // one line per distinct problem
    const seen = new Set();
    return out.filter((p) => { const k = p.kind + '|' + p.msg + '|' + p.a + '|' + p.b; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  root.ProsesAudit = { run };
})(typeof window !== 'undefined' ? window : globalThis);
