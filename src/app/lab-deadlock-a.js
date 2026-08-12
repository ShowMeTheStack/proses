// The Deadlock lab, part one: what its four modes share (S.DlLab). Item makers and wording; the setup's typed data
// read into engine inputs (processes, resource types with their units, the script of requests and releases, a graph
// typed or drawn by clicking); a layout for any resource-allocation graph (processes and resources round an ellipse,
// ordered so that, where possible, no two edges cross and no edge runs through a node); and the pieces of the
// pictures: the scripts as rows of cells with each process's place, the wait-for graph beside the allocation graph.
//   DL.readRes(v) -> [{name, units}]       DL.readScript(v) -> [{who, op, r, n, k}]     DL.parseEdges(text, n, res)
//   DL.layout(n, res, edgeSets, o) -> {pos, wpos, box, wbox}   positions relative to the centre of each graph
//   DL.scriptRows(prefix, x, y, sim, procs, o) -> {items, h, w}  DL.wfItems(prefix, g, wpos, x, y, o) -> {items}
(function (S) {
  'use strict';
  const DL = (S.DlLab = S.DlLab || {});
  const tw = (t, size, o) => S.textWidth(String(t), size || 14, o);
  DL.tw = tw;
  DL.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: Math.round(x), y: Math.round(y), text: String(text), cls: cls === undefined ? 'strong' : cls, size: size || 14 }; if (anchor) it.anchor = anchor; return it; };
  DL.title = (key, x, y, text, anchor) => { const it = { key, kind: 'text', x: Math.round(x), y: Math.round(y), text, cls: 'title', size: 13 }; if (anchor) it.anchor = anchor; return it; };
  DL.box = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  DL.vec = (v) => '(' + v.join(', ') + ')';
  DL.plural = (k, w, many) => k + ' ' + (Number(k) === 1 ? w : many || w + 's');
  DL.list = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  DL.plain = (s) => String(s || '').replace(/`/g, '');
  DL.cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  DL.RES = 'ABCD';
  DL.pname = (i) => 'P' + i;
  /** wrapped text, top-left at (x, y) */
  DL.para = (prefix, x, y, text, w, cls, size) => { size = size || 14; return S.Kit.proc.wrap(DL.plain(text), w, size).map((l, i) => DL.text(prefix + i, x, y + i * Math.round(size * 1.45), l, cls === undefined ? '' : cls, size)); };
  DL.paraH = (text, w, size) => { size = size || 14; return S.Kit.proc.wrap(DL.plain(text), w, size).length * Math.round(size * 1.45); };

  // ---- the setup, read ----------------------------------------------------------------------------------------
  DL.readRes = (v) => (v.res || []).map((r) => ({ name: String(r.name), units: r.units }));
  DL.resIndex = (res, name) => res.findIndex((r) => r.name === String(name).trim());
  /** the script rows as engine ops, each with its place k in the list */
  DL.readScript = (v) => {
    const res = DL.readRes(v);
    return (v.script || []).map((row, k) => ({ who: +String(row.who).replace(/^P/, ''), op: row.op, r: row.op === 'work' ? -1 : DL.resIndex(res, row.res), n: row.op === 'work' ? 1 : row.n || 1, k }));
  };
  /** why a script cannot run, or null */
  DL.scriptWhy = (v) => {
    const res = DL.readRes(v), n = v.nproc;
    const names = new Set();
    for (const r of res) { if (names.has(r.name)) return 'Resources: two are called ' + r.name; names.add(r.name); }
    for (let k = 0; k < (v.script || []).length; k++) {
      const row = v.script[k], who = +String(row.who).replace(/^P/, '');
      if (!(who >= 0 && who < n)) return 'Script, row ' + (k + 1) + ': ' + row.who + ' is not one of the ' + n + ' processes (P0 to P' + (n - 1) + ')';
      if (row.op === 'work') continue;
      const j = DL.resIndex(res, row.res);
      if (j < 0) return 'Script, row ' + (k + 1) + ': there is no resource called ' + row.res;
      if (row.op === 'req' && row.n > res[j].units) return 'Script, row ' + (k + 1) + ': ' + res[j].name + ' has only ' + DL.plural(res[j].units, 'unit');
    }
    return null;
  };
  /** a graph typed (or drawn) as "P0>R1 R1>P2": request edges P>R, one assignment edge R>P per unit held */
  DL.parseEdges = (text, n, res) => {
    const hold = [], want = [], toks = String(text || '').split(/[\s,;]+/).filter(Boolean);
    const node = (t) => { const p = /^P(\d)$/.exec(t); if (p && +p[1] < n) return { k: 'p', i: +p[1] }; const j = DL.resIndex(res, t); return j >= 0 ? { k: 'r', i: j } : null; };
    for (const tok of toks) {
      const m = /^([^>→-]+)(?:->|>|→)([^>→]+)$/.exec(tok);
      if (!m) return { error: '"' + tok + '" is not an edge like P0>R1 or R1>P0' };
      const a = node(m[1]), b = node(m[2]);
      if (!a || !b) return { error: '"' + tok + '": ' + (!a ? m[1] : m[2]) + ' is not a process (P0 to P' + (n - 1) + ') or a resource' };
      if (a.k === b.k) return { error: '"' + tok + '" joins two ' + (a.k === 'p' ? 'processes' : 'resources') + ': an edge runs between a process and a resource' };
      if (a.k === 'p') { if (!want.some(([p, r]) => p === a.i && r === b.i)) want.push([a.i, b.i]); } else hold.push([b.i, a.i]);
    }
    for (let j = 0; j < res.length; j++) { const h = hold.filter(([, r]) => r === j).length; if (h > res[j].units) return { error: res[j].name + ' has ' + DL.plural(res[j].units, 'unit') + ' but ' + h + ' assignment edges' }; }
    return { hold, want };
  };
  DL.edgesText = (g, res) => g.want.map(([p, r]) => 'P' + p + '>' + res[r].name).concat(g.hold.map(([p, r]) => res[r].name + '>P' + p)).join(' ');

  // ---- a layout: round an ellipse, ordered to avoid crossings ---------------------------------------------------
  const PR = () => S.Kit.rag.PR, BH = () => S.Kit.rag.BH;
  const sizeOf = (id, res) => (id[0] === 'p' ? { w: 2 * PR() + 8, h: 2 * PR() + 8 } : { w: S.Kit.rag.resW(res[+id.slice(1)].units) + 8, h: BH() + 8 });
  const cross = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  /** does the segment a-b pass through the box centred at c (w × h)? */
  const hitsBox = (a, b, c, w, h) => {
    const x0 = c.x - w / 2, x1 = c.x + w / 2, y0 = c.y - h / 2, y1 = c.y + h / 2;
    for (let t = 0.04; t < 0.97; t += 0.03) { const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; if (x > x0 && x < x1 && y > y0 && y < y1) return true; }
    return false;
  };
  /**
   * n processes and the resource types res, with every edge any frame will draw (edgeSets: [[from, to]..] of node
   * ids 'p0', 'r1'; wait-for edges as [i, j] in wf): positions round an ellipse, the order chosen by a deterministic
   * search that counts crossings and edges through nodes, in the allocation graph and in the wait-for graph.
   */
  DL.layout = function (n, res, edges, wf, o) {
    o = o || {};
    const m = res.length, N = n + m, ids = [];
    for (let k = 0; k < Math.max(n, m); k++) { if (k < n) ids.push('p' + k); if (k < m) ids.push('r' + k); }
    const ry0 = Math.max(118, Math.min(215, 62 + 19 * N)), ry = o.ry || (o.narrow ? Math.min(ry0, 140) : ry0), rx = o.rx || Math.round(ry * (o.narrow ? 1.12 : N <= 4 ? 1.18 : 1.32));
    const wry = Math.max(70, Math.min(110, 34 + 16 * n)), wrx = Math.round(wry * 1.45);
    const at = (slot, a, b) => { const t = -Math.PI / 2 + (2 * Math.PI * slot) / N; return { x: Math.round(a * Math.cos(t)), y: Math.round(b * Math.sin(t)) }; };
    const E = []; const seen = new Set();
    for (const [a, b] of edges) { const k = a < b ? a + '|' + b : b + '|' + a; if (!seen.has(k)) { seen.add(k); E.push([a, b]); } }
    const W = []; const ws = new Set();
    for (const [a, b] of wf) { const k = Math.min(a, b) + '|' + Math.max(a, b); if (!ws.has(k)) { ws.add(k); W.push([a, b]); } }
    const cost = (order) => {
      const pos = {}; order.forEach((id, s) => { pos[id] = at(s, rx, ry); });
      let c = 0;
      for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
        const [a, b] = E[i], [x, y] = E[j];
        if (a === x || a === y || b === x || b === y) continue;
        if (cross(pos[a], pos[b], pos[x], pos[y])) c += 10;
      }
      for (const [a, b] of E) for (const id of order) if (id !== a && id !== b) { const s = sizeOf(id, res); if (hitsBox(pos[a], pos[b], pos[id], s.w + 10, s.h + 10)) c += 14; }
      // the wait-for graph keeps the processes' order round its own ellipse
      const procs = order.filter((id) => id[0] === 'p'), wp = {};
      procs.forEach((id, s) => { const t = -Math.PI / 2 + (2 * Math.PI * order.indexOf(id)) / N; wp[+id.slice(1)] = { x: wrx * Math.cos(t), y: wry * Math.sin(t) }; });
      for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
        const [a, b] = W[i], [x, y] = W[j];
        if (a === x || a === y || b === x || b === y) continue;
        if (cross(wp[a], wp[b], wp[x], wp[y])) c += 6;
      }
      for (const [a, b] of W) for (let k = 0; k < n; k++) if (k !== a && k !== b && hitsBox(wp[a], wp[b], wp[k], 54, 54)) c += 8;
      // a light preference for processes and resources taking turns round the ring
      order.forEach((id, s) => { if (order[(s + 1) % N][0] === id[0]) c += 0.2; });
      return c;
    };
    let best = ids.slice(), bc;
    const kept = o.order && o.order.length === N && ids.every((id) => o.order.includes(id));
    if (kept) best = o.order.slice();
    else if (o.base) {
      // keep the order of the nodes already placed; each new node goes where it costs least
      best = o.base.filter((id) => ids.includes(id));
      const missing = ids.filter((id) => !best.includes(id));
      while (missing.length) {
        const id = missing.shift();
        let pick = null, pc = Infinity;
        for (let s = 0; s <= best.length; s++) { const t = best.slice(0, s).concat([id], best.slice(s)), c = cost(t.concat(missing)); if (c < pc) { pc = c; pick = t; } }
        best = pick;
      }
    }
    bc = cost(best);
    for (let round = 0; round < 6 && bc > 0 && !kept && !o.base; round++) {
      let better = false;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const t = best.slice(); [t[i], t[j]] = [t[j], t[i]];
        const c = cost(t);
        if (c < bc - 1e-9) { best = t; bc = c; better = true; }
      }
      if (!better) break;
    }
    const pos = {}, wpos = {};
    best.forEach((id, s) => { pos[id] = at(s, rx, ry); if (id[0] === 'p') wpos[id] = at(s, wrx, wry); });
    const maxResW = Math.max(0, ...res.map((r) => S.Kit.rag.resW(r.units)));
    return { pos, wpos, order: best, crossings: bc, rx, ry, wrx, wry, w: 2 * rx + Math.max(2 * PR(), maxResW), h: 2 * ry + 2 * PR() + 8, ww: 2 * wrx + 2 * PR(), wh: 2 * wry + 2 * PR() };
  };

  // ---- the scripts as rows of cells -----------------------------------------------------------------------------
  const opText = (sim, op) => (op.op === 'work' ? 'work' : op.op === 'reqAll' ? 'req all' : (op.op === 'req' ? 'req ' : 'rel ') + (op.n > 1 ? op.n + ' ' : '') + sim.res[op.r].name);
  DL.opText = opText;
  /** each process's script on a row, the ops done greyed, the next one outlined, a blocked one amber */
  DL.scriptRows = function (prefix, x, y, sim, procs, o) {
    o = o || {};
    const items = [DL.title(prefix + ':t', x, y, o.title || 'scripts')], ch = o.ch || 30, rh = o.rh || 40, size = 13;
    let maxX = x + 120;
    sim.progs.forEach((p, i) => {
      const yy = y + 14 + i * rh, st = procs[i];
      items.push(DL.text(prefix + ':n' + i, x, yy + ch / 2 + 5, p.name, 'rowname' + (o.act === i ? ' act' : ''), 14));
      let cx = x + 34;
      p.script.forEach((op, k) => {
        const t = opText(sim, op), w = Math.max(50, Math.round(tw(t, size, { mono: true })) + 14);
        const cls = k < st.pc || st.state === 'done' ? 'done' : k === st.pc ? (st.state === 'blocked' ? 'wait' : 'next') : '';
        items.push({ key: prefix + ':o' + i + '_' + k, kind: 'cell', x: cx, y: yy, w, h: ch, rx: 5, text: t, size, cls: 'op ' + cls });
        cx += w + 5;
      });
      if (!p.script.length) items.push(DL.text(prefix + ':e' + i, cx, yy + ch / 2 + 5, 'no steps', 'qnone', 13));
      else if (st.state === 'done') items.push(DL.text(prefix + ':d' + i, cx + 3, yy + ch / 2 + 5, 'done', 'good', 13));
      maxX = Math.max(maxX, cx + 40);
    });
    return { items, h: 14 + sim.progs.length * rh, w: maxX - x };
  };
  /** the widest the script rows get (for laying out the columns) */
  DL.scriptW = (sim) => 34 + Math.max(90, ...sim.progs.map((p) => p.script.reduce((a, op) => a + Math.max(50, Math.round(tw(opText(sim, op), 13, { mono: true })) + 14) + 5, 0) + 40));

  // ---- the graphs ------------------------------------------------------------------------------------------------
  const stCls = (s) => ({ ready: 's-ready', blocked: 's-blocked', done: 's-done' }[s] || 's-ready');
  DL.stCls = stCls;
  DL.cycleSet = (cyc) => { const hot = new Set(); if (cyc) cyc.forEach((v, k) => hot.add(v + '>' + cyc[(k + 1) % cyc.length])); return hot; };
  /** the allocation graph g at (x, y) (its centre), procs' states colouring the circles */
  DL.ragItems = function (prefix, g, L, x, y, o) {
    o = o || {};
    const d = S.Kit.rag.draw({ prefix, g, pos: L.pos, x, y, hot: o.hot, act: o.act, wantN: o.wantN, procCls: (i) => (o.procCls ? o.procCls(i) : 's-ready') + (o.actP === i ? ' act' : '') + (o.sel === 'p' + i ? ' act' : ''), resCls: (j) => (o.resCls ? o.resCls(j) : '') + (o.sel === 'r' + j ? ' act' : '') });
    if (o.pick) for (const it of d.items) if (/^[^:]+:(p\d+|r\d+|e.*)$/.test(it.key)) it.pick = true;
    return d;
  };
  /** the wait-for graph of g, or (several units) a note on why it does not apply */
  DL.wfItems = function (prefix, g, L, x, y, o) {
    o = o || {};
    const items = [DL.title(prefix + ':t', x - L.wrx - S.Kit.rag.PR, y - L.wry - S.Kit.rag.PR - 14, 'wait-for graph')];
    const multi = g.res.filter((r) => r.units > 1);
    if (multi.length) {
      const why = 'Not drawn: ' + DL.list(multi.map((r) => r.name)) + (multi.length > 1 ? ' have' : ' has') + ' several units, so a request does not point at one holder. The detection algorithm decides instead.';
      items.push(...DL.para(prefix + ':w', x - L.wrx - S.Kit.rag.PR, y - L.wry + 8, why, Math.max(250, 2 * L.wrx + 30), 'p7note', 13));
      return { items, edges: [] };
    }
    const W = S.Rag.waitFor(g), hot = new Set();
    if (o.cycle) { const ps = o.cycle.filter((v) => v[0] === 'p').map((v) => +v.slice(1)); ps.forEach((p, k) => hot.add(p + '>' + ps[(k + 1) % ps.length])); }
    const w = S.Kit.rag.waitFor({ prefix, procs: g.procs, edges: W, pos: L.wpos, x, y, hot, via: true, res: g.res.map((r) => r.name), procCls: (i) => (o.procCls ? o.procCls(i) : 's-ready') });
    items.push(...w.items);
    if (!W.length) items.push(DL.text(prefix + ':none', x, y + 5, 'nobody waits', 'qnone', 13, 'middle'));
    return { items, edges: W };
  };
  /** the matrices of a RAG: Allocation (units held) and Request (units asked for) */
  DL.ragMatrices = (g, wantN) => {
    const n = g.procs.length, m = g.res.length, alloc = Array.from({ length: n }, () => Array(m).fill(0)), request = Array.from({ length: n }, () => Array(m).fill(0));
    for (const [p, r] of g.hold) alloc[p][r]++;
    for (const [p, r] of g.want) request[p][r] = (wantN && wantN[p + '>' + r]) || 1;
    const avail = g.res.map((r, j) => r.units - alloc.reduce((s, row) => s + row[j], 0));
    return { alloc, request, avail };
  };
  DL.holdTable = (g, wantN, procs) => {
    const M = DL.ragMatrices(g, wantN);
    return { title: 'Who holds and who waits', cols: ['', ...g.res.map((r) => r.name + ' held'), 'waits for', 'state'], rows: g.procs.map((p, i) => [p, ...M.alloc[i].map(String), g.want.filter(([q]) => q === i).map(([, r]) => (M.request[i][r] > 1 ? M.request[i][r] + ' ' : '') + g.res[r].name).join(', ') || '–', procs ? { text: procs[i].state, cls: procs[i].state === 'blocked' ? 'bad' : procs[i].state === 'done' ? 'good' : '' } : (g.want.some(([q]) => q === i) ? { text: 'waiting', cls: 'bad' } : 'running')]), note: 'Available: ' + g.res.map((r, j) => M.avail[j] + ' ' + r.name).join(', ') + '.' };
  };
})(globalThis.Proses = globalThis.Proses || {});
