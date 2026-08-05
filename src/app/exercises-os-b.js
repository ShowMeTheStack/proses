// Answer areas of the operating-systems exercise kinds, part 2: the ones with a picture or a grid of their own: a
// Gantt chart painted tick by tick with its metrics, a page-replacement table, a semaphore trace, a
// resource-allocation graph whose nodes are clicked, and a process table with parents, zombies and orphans.
(function (S) {
  'use strict';
  const V = (S.ExerciseViews = S.ExerciseViews || {});
  const h = (...a) => S.UI.h(...a);
  const W = () => S.ExWidgets;
  const pcls = (i) => 'p' + (i % 6);

  // ---- gantt: pick a job, then click or drag across the ticks ------------------------------------------------------------
  V.gantt = (x, host, draft) => {
    const G = S.Check.kinds.gantt, rt = G.isRT(x), multi = G.isMulti(x);
    const jobs = x.jobs || (rt ? x.tasks : x.workload).map((j) => String(j.id));
    const cols = x.metrics || (rt ? ['response'] : ['finish', 'waiting']), ask = x.ask || 'both';
    const job = (id, i) => h('th', h('span.ex-job.' + pcls(i), String(id)));
    if (rt) {
      host.appendChild(h('div.fit-table', h('table.ex-mat.ex-work', h('thead', h('tr', h('th', 'Task'), h('th', 'Needs (C)'), h('th', 'Period (T)'), h('th', 'Deadline (D)'), h('th', 'First release'))),
        h('tbody', ...x.tasks.map((t, i) => h('tr', job(t.id, i), h('td.mono', String(t.C)), h('td.mono', String(t.T)), h('td.mono', String(t.D || t.T)), h('td.mono', String(t.phase || 0))))))));
    } else {
      const hasPrio = x.workload.some((j) => j.prio !== undefined), hasCls = x.policy === 'mlq' || x.workload.some((j) => j.cls !== undefined);
      const clsName = (c) => { const k = (x.params && x.params.classes) || []; const q = k[Math.min(c || 0, k.length - 1)]; return String(c || 0) + (q && q.name ? ' · ' + q.name : ''); };
      host.appendChild(h('div.fit-table', h('table.ex-mat.ex-work', h('thead', h('tr', h('th', 'Job'), h('th', 'Arrives'), h('th', 'Bursts (CPU, I/O, ..)'), hasPrio ? h('th', 'Priority') : null, hasCls ? h('th', 'Class') : null)),
        h('tbody', ...x.workload.map((j, i) => h('tr', job(j.id, i), h('td.mono', String(j.arrive)), h('td.mono', j.bursts.join(', ')), hasPrio ? h('td.mono', String(j.prio)) : null, hasCls ? h('td.mono', clsName(j.cls)) : null))))));
    }
    host.appendChild(W().given([['Policy', h('span', G.paramsText(x))]]));
    let chart = null, metrics = null;
    if (ask !== 'metrics') {
      const p = x.params || {}, nl = multi ? (p.cores || 2) : 1;
      let n;
      if (rt) n = Math.min(64, (p.horizon || G.want(x).tr.end));
      else {
        const work = x.workload.reduce((s, j) => s + j.bursts.reduce((a, b) => a + b, 0), 0), cs = p.cs ? 4 * x.workload.length : 0;
        n = Math.min(64, Math.ceil(work / nl) + Math.max(...x.workload.map((j) => j.arrive)) + cs + 2 + (multi ? 2 : 0));
      }
      const start = (c) => (draft && (draft.lanes ? draft.lanes[c] : c === 0 ? draft.ticks : null)) || [];
      const lanes = Array.from({ length: nl }, (_, c) => Array.from({ length: n }, (_, k) => start(c)[k] || '-'));
      let pen = jobs[0];
      const pal = h('div.ex-pal', { role: 'radiogroup', 'aria-label': 'Paint with' }, h('span.muted', 'Paint with'));
      const choices = jobs.map((j, i) => [j, pcls(i), j]).concat([['-', 'idle', 'idle']]).concat(p.cs ? [['cs', 'cs', 'switch']] : []);
      for (const [v, cls, label] of choices) {
        const b = h('button.ex-penbtn.' + cls, { type: 'button', role: 'radio', 'aria-checked': String(v === pen), dataset: { v } }, label);
        b.addEventListener('click', () => { pen = v; for (const c of pal.querySelectorAll('button')) c.setAttribute('aria-checked', String(c.dataset.v === v)); });
        pal.appendChild(b);
      }
      const rows = [], cells = [];
      let down = false;
      const draw = () => cells.forEach((rowCells, c) => rowCells.forEach((el, k) => { const v = lanes[c][k], i = jobs.indexOf(v); el.className = 'ex-tick ' + (v === '-' ? 'idle' : v === 'cs' ? 'cs' : pcls(i)); el.textContent = v === '-' ? '' : v; el.setAttribute('aria-label', (nl > 1 ? 'core ' + c + ', ' : '') + 't = ' + k + ': ' + (v === '-' ? 'idle' : v)); }));
      const paint = (c, k) => { lanes[c][k] = pen; draw(); };
      // a real-time task set: its releases above the chart and its deadlines under it, each in its task's colour
      const marks = rt ? G.rtMarks(x, n) : [];
      const markRow = (what) => {
        const r = h('div.ex-marks.' + what, { 'aria-label': what === 'release' ? 'Releases' : 'Deadlines' });
        for (let k = 0; k <= n; k++) {
          const at = marks.filter((m) => m.what === what && m.t === k);
          r.appendChild(h('span', at.map((m) => h('i.ex-mk.' + pcls(jobs.indexOf(m.task)), { title: 'task ' + m.task + (what === 'release' ? ' releases a job at t = ' : ' has a deadline at t = ') + k }, (what === 'release' ? '↓' : '↑') + m.task))));
        }
        return h('div.ex-lane', h('span.ex-lanelab', what === 'release' ? 'released' : 'deadline'), r);
      };
      for (let c = 0; c < nl; c++) {
        const row = h('div.ex-ticks', { role: 'grid', 'aria-label': nl > 1 ? 'Core ' + c + ', one cell a tick' : 'The chart, one cell a tick' }), rc = [];
        for (let k = 0; k < n; k++) {
          const el = h('button', { type: 'button', dataset: { k: String(k), core: String(c) } });
          el.addEventListener('pointerdown', (e) => { e.preventDefault(); down = true; paint(c, k); });
          el.addEventListener('pointerenter', () => { if (down) paint(c, k); });
          el.addEventListener('keydown', (e) => { if (e.key === 'Backspace' || e.key === 'Delete') { lanes[c][k] = '-'; draw(); } });
          el.addEventListener('click', (e) => { if (e.detail === 0) paint(c, k); });
          rc.push(el); row.appendChild(el);
        }
        cells.push(rc);
        rows.push(h('div.ex-lane', nl > 1 || rt ? h('span.ex-lanelab', nl > 1 ? 'core ' + c : 'CPU') : null, row));
      }
      const axis = h('div.ex-axis');
      for (let k = 0; k < n; k++) axis.appendChild(h('span', k % 5 === 0 ? String(k) : ''));
      window.addEventListener('pointerup', () => { down = false; });
      draw();
      const clear = h('button.btn.small', { type: 'button' }, 'Clear the chart');
      clear.addEventListener('click', () => { for (const l of lanes) l.fill('-'); draw(); });
      const pad = nl > 1 || rt ? h('span.ex-lanelab') : null;
      const chartBox = h('div.ex-chart', rt ? markRow('release') : null, ...rows, rt ? markRow('deadline') : null, h('div.ex-lane', pad, axis));
      // the note about scrolling shows only while the chart is wider than its box
      const more = h('span.ex-more', { hidden: true }, ' Scroll sideways for the later ticks.');
      const fit = () => { const over = chartBox.scrollWidth > chartBox.clientWidth + 1; more.hidden = !over; S.UI.scrollRow(chartBox); };
      requestAnimationFrame(fit);
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fit()).observe(chartBox);
      host.appendChild(h('div.ex-gantt', pal, chartBox, h('div.ans-row', h('p.muted.ans-note', 'Pick a job, then click or drag across its ticks. Leave idle ticks empty.' + (nl > 1 ? ' One row a core.' : ''), more), clear)));
      const one = (c) => lanes[c].slice();
      chart = {
        get: () => (nl > 1 ? { lanes: lanes.map((_, c) => one(c)) } : { ticks: one(0) }),
        mark: (r) => cells.forEach((rc, c) => rc.forEach((el, k) => el.classList.toggle('wrong', !!(r.cells && r.cells[(nl > 1 ? c + '|' : '') + 't|' + k] === false)))),
      };
    }
    if (ask !== 'chart') {
      const LABEL = { finish: 'Finish', waiting: 'Waiting', turnaround: 'Turnaround', response: 'Response', missed: 'Missed?' };
      const rowIds = rt ? G.want(x).rows.map((r) => r.id) : jobs;
      metrics = W().fillGrid(host, { corner: rt ? 'job' : 'job', rows: rowIds.map((j) => ({ key: j, label: j })), cols: cols.map((c) => ({ key: c, label: LABEL[c] || c })), draft: draft && draft.metrics, placeholder: '' });
      if (rt) host.appendChild(h('p.muted.ans-note', 'One row a released job (A1 is task A\'s first). Write - for a job not finished by the end' + (cols.includes('missed') ? ', and yes or no under Missed?.' : '.')));
    }
    return {
      get: () => Object.assign({}, chart ? chart.get() : {}, { metrics: metrics ? metrics.get() : undefined }),
      mark: (r) => { if (chart) chart.mark(r); if (metrics) metrics.mark(r); },
    };
  };

  // ---- replacement-table and semaphore-trace ----------------------------------------------------------------------------
  V['replacement-table'] = (x, host, draft) => {
    const NAMES = { fifo: 'FIFO', lru: 'LRU', opt: 'OPT', clock: 'Clock', second: 'Second chance' };
    host.appendChild(W().given([['Policy', NAMES[x.policy] || x.policy], ['Frames', x.frames], ['References', x.refs.map((r) => (typeof r === 'object' ? r.page + (r.write ? 'w' : '') : r)).join(' ')]]));
    const rows = Array.from({ length: x.frames }, (_, f) => ({ key: 'f' + f, label: 'frame ' + f })).concat([{ key: 'fault', label: 'fault?' }]);
    const cols = x.refs.map((r, i) => ({ key: String(i + 1), label: String(typeof r === 'object' ? r.page : r), sub: i + 1 }));
    const g = W().fillGrid(host, { corner: 'ref', rows, cols, draft, placeholder: '', narrow: true });
    host.appendChild(h('p.muted.ans-note', 'Each column: the page in each frame after that reference (empty while a frame is free), and F under a fault.'));
    return g;
  };
  V['semaphore-trace'] = (x, host, draft) => {
    host.appendChild(h('div.ex-threads', ...x.threads.map((t, i) => h('div.ex-thread', h('b.ex-job.' + pcls(i), t.name), h('ol.mono', ...t.prog.map((op) => h('li', op)))))));
    host.appendChild(W().given([['Starts', x.sems.map((s) => s.id + ' = ' + (s.init || 0)).join(', ')], ['Schedule', x.schedule.join(' → ')]]));
    const cols = x.sems.map((s) => ({ key: s.id, label: s.id })).concat(x.blocked === false ? [] : [{ key: 'blocked', label: 'blocked' }]);
    return W().fillGrid(host, { corner: 'step', rows: x.schedule.map((who, k) => ({ key: String(k + 1), label: (k + 1) + ' · ' + who })), cols, draft, placeholder: '' });
  };

  // ---- graph-cycle: click the nodes -------------------------------------------------------------------------------------
  /**
   * Where each node of a resource-allocation graph goes: the longest simple cycle (or, with none, the longest path)
   * round a circle in its own order, so its arrows are the sides of a convex polygon and cannot cross; every other
   * node further out, beside the neighbour that brought it in, so its arrow to that neighbour runs outward.
   * -> {pos: {name: {x, y}}, w, h, ring: [names on the circle]}
   */
  V.ragLayout = function (procs, res, edges) {
    const nodes = procs.concat(res), out = new Map(nodes.map((v) => [v, []]));
    for (const e of edges) if (out.has(e.from)) out.get(e.from).push(e.to);
    let cyc = [], line = [];
    const path = [], on = new Set();
    const dfs = (v, start) => {
      if (path.length > line.length) line = path.slice();
      for (const w of out.get(v) || []) {
        if (w === start && path.length > cyc.length) cyc = path.slice();
        else if (!on.has(w)) { on.add(w); path.push(w); dfs(w, start); path.pop(); on.delete(w); }
      }
    };
    for (const v of nodes) { path.length = 0; path.push(v); on.clear(); on.add(v); dfs(v, v); }
    const ring = cyc.length ? cyc : line.length ? line : nodes.slice(0, 1);
    const n = Math.max(3, ring.length), closed = cyc.length > 0;
    const rad = Math.max(100, Math.round((n * 122) / (2 * Math.PI)));
    const pol = {};
    // an open path takes most of the circle but leaves a gap where it would close
    ring.forEach((v, i) => { pol[v] = { r: rad, a: -Math.PI / 2 + (2 * Math.PI * i) / (closed ? n : n + 0.6), lvl: 0 }; });
    const near = (v) => edges.filter((e) => e.from === v || e.to === v).map((e) => (e.from === v ? e.to : e.from));
    let rest = nodes.filter((v) => !(v in pol));
    const kids = {};
    while (rest.length) {
      const k = rest.findIndex((v) => near(v).some((w) => w in pol));
      const v = rest[Math.max(0, k)];
      rest = rest.filter((w) => w !== v);
      if (k < 0) { pol[v] = { r: rad + 190, a: Math.PI / 2 + 0.5 * Object.keys(kids).length, lvl: 2 }; kids[v] = 0; continue; }
      const par = near(v).find((w) => w in pol), P = pol[par];
      const m = (kids[par] = (kids[par] || 0) + 1), R2 = rad + 100, step = 108 / R2;
      if (P.lvl === 0) {
        // the first ring outside: straight out from its neighbour, more of them fanned either side
        const off = m === 1 ? 0 : Math.ceil((m - 1) / 2) * (m % 2 ? -1 : 1) * step;
        pol[v] = { r: R2, a: P.a + off, lvl: 1, dir: off < 0 ? -1 : 1 };
      } else {
        // further along: round the outer ring the way its neighbour leans, so a chain curls round the drawing
        const dir = (P.dir || 1) * (m % 2 ? 1 : -1);
        pol[v] = { r: R2, a: P.a + dir * step * Math.ceil(m / 2), lvl: P.lvl + 1, dir };
      }
    }
    const pts = Object.entries(pol).map(([v, q]) => [v, q.r * Math.cos(q.a), q.r * Math.sin(q.a)]);
    const x0 = Math.min(...pts.map((p) => p[1])) - 46, y0 = Math.min(...pts.map((p) => p[2])) - 46;
    const x1 = Math.max(...pts.map((p) => p[1])) + 46, y1 = Math.max(...pts.map((p) => p[2])) + 46;
    const pos = {};
    for (const [v, x, y] of pts) pos[v] = { x: Math.round(x - x0), y: Math.round(y - y0) };
    return { pos, w: Math.round(x1 - x0), h: Math.round(y1 - y0), ring };
  };
  V['graph-cycle'] = (x, host, draft) => {
    const R = S.Check.os.ragNodes(x), procs = x.graph.procs;
    const NS = 'http://www.w3.org/2000/svg', svg = (t, a) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a || {})) e.setAttribute(k, v); return e; };
    const units = Object.fromEntries(x.graph.res.map((r) => [r.name, r.units]));
    const lay = V.ragLayout(procs, x.graph.res.map((r) => r.name), R.edges), W0 = lay.w, H0 = lay.h;
    const pos = {};
    for (const [name, q] of Object.entries(lay.pos)) pos[name] = { x: q.x, y: q.y, kind: name in units ? 'r' : 'p', units: units[name] };
    const s = svg('svg', { style: 'max-width: ' + Math.max(300, W0) + 'px', viewBox: '0 0 ' + W0 + ' ' + H0, class: 'ex-rag', role: 'group', 'aria-label': 'The resource-allocation graph: click the nodes on a cycle' });
    const defs = svg('defs'); const mk = svg('marker', { id: 'exArrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }); mk.appendChild(svg('path', { d: 'M0 0L10 5L0 10z', class: 'ex-arrowhead' })); defs.appendChild(mk); s.appendChild(defs);
    const chosen = new Set(Array.isArray(draft) ? draft : []);
    // edges: shorten to the node's rim; a pair of opposite edges bends apart
    for (const e of R.edges) {
      const a = pos[e.from], b = pos[e.to], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const ra = a.kind === 'p' ? 26 : 30, rb = b.kind === 'p' ? 29 : 33;
      const both = R.edges.some((f) => f.from === e.to && f.to === e.from);
      const off = both ? 16 : 0, nx = (-dy / L) * off, ny = (dx / L) * off;
      const x1 = a.x + (dx / L) * ra + nx, y1 = a.y + (dy / L) * ra + ny, x2 = b.x - (dx / L) * rb + nx, y2 = b.y - (dy / L) * rb + ny;
      s.appendChild(svg('line', { x1, y1, x2, y2, class: 'ex-edge ' + e.kind, 'marker-end': 'url(#exArrow)' }));
    }
    const nodes = {};
    for (const [name, p] of Object.entries(pos)) {
      const g = svg('g', { class: 'ex-node ' + (p.kind === 'p' ? 'proc' : 'res'), tabindex: '0', role: 'checkbox', 'aria-label': name, 'data-name': name });
      g.appendChild(p.kind === 'p' ? svg('circle', { cx: p.x, cy: p.y, r: 26 }) : svg('rect', { x: p.x - 30, y: p.y - 30, width: 60, height: 60, rx: 8 }));
      const t = svg('text', { x: p.x, y: p.y + 5, 'text-anchor': 'middle' }); t.textContent = name; g.appendChild(t);
      if (p.kind === 'r') for (let u = 0; u < p.units; u++) g.appendChild(svg('circle', { cx: p.x - (p.units - 1) * 6 + u * 12, cy: p.y + 18, r: 3, class: 'ex-unit' }));
      const flip = () => { if (chosen.has(name)) chosen.delete(name); else chosen.add(name); draw(); };
      g.addEventListener('click', flip);
      g.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
      nodes[name] = g; s.appendChild(g);
    }
    let none = draft === 'none';
    const noneBtn = h('button.btn.small', { type: 'button', 'aria-pressed': String(none) }, 'There is no cycle');
    const said = h('span.mono.ex-picked');
    const draw = () => {
      if (chosen.size) none = false;
      for (const [n, g] of Object.entries(nodes)) { g.classList.toggle('on', chosen.has(n)); g.setAttribute('aria-checked', String(chosen.has(n))); }
      noneBtn.classList.toggle('on', none); noneBtn.setAttribute('aria-pressed', String(none));
      said.textContent = none ? 'none' : chosen.size ? '{' + [...chosen].join(', ') + '}' : 'nothing picked yet';
    };
    noneBtn.addEventListener('click', () => { none = !none; if (none) chosen.clear(); draw(); });
    host.appendChild(h('div.ex-ragbox', s));
    host.appendChild(h('div.ans-row', h('p.muted.ans-note', 'Circles are processes, squares resources (a dot a unit). A dashed arrow into a resource is a request; a solid one out of it, an assignment. Click the nodes on a cycle. Your pick: ', said), noneBtn));
    draw();
    return { get: () => (none ? 'none' : [...chosen]), mark: (r) => { s.classList.toggle('right', !!r.ok); s.classList.toggle('wrong', !r.ok); } };
  };

  // ---- process-tree: each process's parent, and the zombie and orphan marks ----------------------------------------------
  V['process-tree'] = (x, host, draft) => {
    W().listing(host, x.src);
    const F = S.Check.os.procFacts(x), ask = x.ask || ['parents', 'zombie', 'orphan'];
    const names = F.procs, all = ['sh'].concat(names);
    const d = draft || {}, inputs = {};
    const body = h('tbody');
    names.forEach((p, i) => {
      const tr = h('tr', h('th', h('span.ex-job.' + pcls(i), p)));
      if (ask.includes('parents') && !(p in F.parents)) tr.appendChild(h('td.muted.ex-sh', 'the shell'));
      else if (ask.includes('parents')) {
        const sel = h('select', { 'aria-label': 'Parent of ' + p, dataset: { key: 'parent|' + p } }, h('option', { value: '' }, '?'), ...all.filter((q) => q !== p).map((q) => h('option', { value: q }, q === 'sh' ? 'the shell' : q)));
        sel.value = (d.parents && d.parents[p]) || '';
        inputs['parent|' + p] = sel;
        tr.appendChild(h('td', sel));
      }
      for (const k of ['zombie', 'orphan']) {
        if (!ask.includes(k)) continue;
        const cb = h('input', { type: 'checkbox', 'aria-label': p + ' is ' + (k === 'zombie' ? 'a zombie' : 'an orphan') });
        cb.checked = (d[k] || []).includes(p);
        inputs[k + '|' + p] = cb;
        tr.appendChild(h('td.ex-cb', h('label', cb)));
      }
      body.appendChild(tr);
    });
    const head = h('tr', h('th', 'Process'), ask.includes('parents') ? h('th', 'Parent') : null, ask.includes('zombie') ? h('th', 'Zombie') : null, ask.includes('orphan') ? h('th', 'Orphan') : null);
    host.appendChild(h('div.fit-table', h('table.fill-table.ex-ptab', h('thead', head), body)));
    return {
      get() {
        const out = { parents: {}, zombie: [], orphan: [] };
        for (const [k, el] of Object.entries(inputs)) { const [what, p] = k.split('|'); if (what === 'parent') { if (el.value) out.parents[p] = el.value; } else if (el.checked) out[what].push(p); }
        return out;
      },
      mark(r) { for (const [k, el] of Object.entries(inputs)) { const c = r.cells ? r.cells[k] : undefined; const box = el.type === 'checkbox' ? el.closest('td') : el; box.classList.toggle('right', c === true); box.classList.toggle('wrong', c === false); } },
    };
  };

  // every graph-cycle exercise goes before the diagram checker (content registers after this file, so once loaded)
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', () => {
    if (!S.Checks || !S.Content) return;
    for (const x of S.Content.exercises.values()) {
      if (x.kind !== 'graph-cycle' || S.Checks.some((c) => c.hash === 'exercise=' + x.id)) continue;
      S.Checks.push({ group: 'learn', name: 'graph-cycle exercise ' + x.id, hash: 'exercise=' + x.id, ready: "document.querySelector('#exerciseView .ex-rag')", sel: '#main' });
    }
  });
})(globalThis.Proses = globalThis.Proses || {});
