// The workspace of a 'disk-sched' challenge: the policy and the starting direction (or, when the challenge allows
// it, an order of the visible queue typed by hand), and the arm's path over a sample queue drawn as it changes:
// cylinders across, requests served down the page, with the movement added up.
(function (S) {
  'use strict';
  const KIND = () => S.Challenges.kinds['disk-sched'];
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v)); return e; };

  /** the path: one row per request served, the arm's position as a dot, the moves as lines */
  function pathView(q, order) {
    const { h } = S.UI;
    const W = 1000, rowH = 34, n = order.length, H = (n + 1) * rowH;
    const X = (c) => Math.round(20 + (W - 40) * c / Math.max(1, q.cylinders - 1));
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'chd-svg', 'aria-hidden': 'true' });
    s.style.height = H + 'px';
    for (const c of q.requests) s.appendChild(svg('line', { x1: X(c), y1: 0, x2: X(c), y2: H, class: 'chd-req' }));
    let at = q.start;
    const pts = [[X(at), rowH / 2]];
    order.forEach((i, k) => { at = q.requests[i]; pts.push([X(at), (k + 1.5) * rowH]); });
    s.appendChild(svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'chd-path' }));
    // the dots are HTML, so they stay round however the plot is stretched
    const dots = pts.map((p, k) => h('span.' + (k ? 'chd-dot' : 'chd-start'), { style: { left: (100 * p[0] / W).toFixed(2) + '%', top: p[1] + 'px' } }));
    const rows = h('div.chd-rows');
    let prev = q.start;
    rows.appendChild(h('div.chd-row', h('span.mono', 'start'), h('b.mono', String(q.start)), h('span.mono', '')));
    order.forEach((i) => { const c = q.requests[i]; rows.appendChild(h('div.chd-row', h('span.mono', '#' + (i + 1)), h('b.mono', String(c)), h('span.mono', '+' + Math.abs(c - prev)))); prev = c; });
    return h('div.chd', rows, h('div.chd-plot', h('div.chd-box', s, ...dots), h('div.chd-axis', h('span', '0'), h('span', 'cylinder'), h('span', String(q.cylinders - 1)))));
  }

  S.DiskSchedWorkspace = function (host, x, draft, onChange) {
    const { h } = S.UI, KIT = S.ChallengeKit, k = KIND(), L = x.limits || {};
    let a = Object.assign({}, k.start(x), draft || {});
    const allowed = L.policies || Object.keys(k.NAMES);
    const sample = x.queue || x.preview || k.cases(Object.assign({}, x, { cases: null, queue: null, hidden: Object.assign({}, x.hidden, { seed: ((x.hidden && x.hidden.seed) || 1) + 1000, count: 1 }) }))[0];
    const canOrder = !!(L.order && x.queue);
    const mode = KIT.select({ id: 'chMode', label: 'Answer with', value: a.order ? 'order' : 'policy', options: [{ value: 'policy', label: 'a policy' }, { value: 'order', label: 'my own order' }], onChange: (v) => { if (v === 'order') { a = { order: a.order || sample.requests.map((_, i) => i) }; orderList.set(a.order.map((i) => i + 1)); } else a = k.start(x); show(); changed(); } });
    const pol = KIT.select({ id: 'chDiskPolicy', label: 'Policy', value: a.policy || allowed[0], options: allowed.map((p) => ({ value: p, label: k.NAMES[p] })), onChange: (v) => { a.policy = v; changed(); } });
    const dir = KIT.select({ id: 'chDir', label: 'The arm starts moving', value: a.dir || 'up', options: [{ value: 'up', label: 'up (towards higher cylinders)' }, { value: 'down', label: 'down' }], onChange: (v) => { a.dir = v; changed(); } });
    const orderHost = h('div.chk-field.wide', h('span.chk-lab', 'Order (request numbers)'));
    const orderList = S.LabWidgets.list(orderHost, { id: 'chOrder', label: 'Order of requests', value: (a.order || sample.requests.map((_, i) => i)).map((i) => i + 1), min: 1, max: sample.requests.length, onChange: (v) => { a.order = v.map((i) => i - 1); changed(); } });
    void orderList;
    const view = h('div.chk-preview', { id: 'chDiskView' });
    const nums = h('div.chk-nums');
    const err = h('div.chk-status.bad');
    const form = h('div.chk-form', canOrder ? mode.el : null, pol.el, dir.el, canOrder ? orderHost : null);
    host.appendChild(h('div.chk-grid',
      KIT.panel('Your schedule', form, h('p.chk-sub', (x.queue ? 'The queue' : 'The arm runs a sample queue; the hidden queues are like it') + ': ' + sample.requests.map((c, i) => '#' + (i + 1) + ' ' + c).join(', ') + '; the arm starts at ' + sample.start + '.')),
      KIT.panel('The arm', view, nums, err)));
    function show() { const o = !!a.order; pol.el.style.display = dir.el.style.display = o ? 'none' : ''; orderHost.style.display = o ? '' : 'none'; }
    function draw() {
      view.innerHTML = ''; nums.innerHTML = ''; err.textContent = '';
      const probs = k.limitsProblems(Object.assign({}, x, { limits: Object.assign({}, L, { maxPassed: undefined }) }), a);
      if (probs.length) { err.textContent = probs[0].replace(/^./, (c) => c.toUpperCase()) + '.'; return; }
      const r = k.serve(sample, a.order ? a : Object.assign({}, a, { dir: a.dir || 'up' }));
      view.appendChild(pathView(sample, r.order));
      const mp = k.maxPassed(r.order);
      nums.append(h('div.chk-num', h('span', 'movement'), h('b.mono', String(r.movement))), h('div.chk-num' + (L.maxPassed !== undefined ? (mp > L.maxPassed ? '.bad' : '.good') : ''), h('span', 'most overtakes'), h('b.mono', String(mp))));
    }
    const later = S.UI.debounce(draw, 60);
    function changed() { later(); if (onChange) onChange(); }
    show(); draw();
    return {
      get: () => (a.order ? { order: a.order.slice() } : { policy: a.policy || allowed[0], dir: a.dir || 'up' }),
      load(v) { a = Object.assign({}, v && (v.order || v.policy) ? v : k.start(x)); mode.set(a.order ? 'order' : 'policy'); if (a.policy) pol.set(a.policy); dir.set(a.dir || 'up'); if (a.order) orderList.set(a.order.map((i) => i + 1)); show(); draw(); },
      redraw: draw,
    };
  };
})(globalThis.Proses = globalThis.Proses || {});
