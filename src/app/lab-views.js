// The lab shell's side panel and its ways out: the tabs of tables, metrics and the trace (and a lab's own views),
// share links that carry the whole setup in the URL hash, compressed, and exports of the trace as JSON and of the
// picture as SVG and PNG.
//   Tables:  [{title, cols: [name..], rows: [[cell..]..], hl: row | [rows], note}]   a cell is text or {text, cls}
//   Metrics: [{label, value, unit, note, cls: 'good' | 'bad' | 'act'}]
//   Trace:   the run's steps [{kind, say, ...}]; a frame's at (an index into it) lights the step it shows
//   A lab's own view: {id, label, render(host, ctx)}; ctx = {lab, values, seed, result, frame, i, go(i)}
//   S.LabViews.link(lab, values, seed) -> Promise of the hash 'labs/<id>?s=<code>'
//   S.LabViews.readLink(rest) -> Promise of {values, seed} | null     (rest: what follows #labs/<id>)
//   S.LabViews.svgText(svg) -> the picture as a standalone SVG document, its colours and fonts written in
//   S.LabViews.png(svg, scale) -> Promise of a PNG Blob
(function (S) {
  'use strict';
  const V = (S.LabViews = S.LabViews || {});
  const CODE = /(?:^|[?&])s=([A-Za-z0-9._-]+)/;

  // ---- share links ------------------------------------------------------------------------------------------------
  V.link = async function (lab, values, seed) {
    const code = await S.Share.pack({ lab: lab.id, setup: values, seed });
    return 'labs/' + lab.id + '?s=' + code;
  };
  V.readLink = async function (rest) {
    const m = CODE.exec(String(rest || ''));
    if (!m) return null;
    const d = await S.Share.unpack(m[1]);
    if (!d || typeof d !== 'object') throw new Error('This share code holds no lab setup.');
    return { lab: d.lab, values: d.setup || {}, seed: d.seed };
  };

  // ---- the side panel -----------------------------------------------------------------------------------------
  const cellText = (c) => (c && typeof c === 'object' ? String(c.text === undefined ? '' : c.text) : String(c === undefined || c === null ? '' : c));
  V.tables = function (host, list) {
    const { h } = S.UI;
    if (!list || !list.length) { host.appendChild(S.UI.empty('grid', 'No tables yet', 'Run the lab: its tables show here, step by step.')); return; }
    for (const t of list) {
      const hl = new Set([].concat(t.hl === undefined ? [] : t.hl));
      const tb = h('table.lab-table', h('thead', h('tr', ...(t.cols || []).map((c) => h('th', c)))), h('tbody', ...(t.rows || []).map((r, i) => h('tr' + (hl.has(i) ? '.hl' : ''), ...r.map((c, j) => h(j === 0 ? 'th' : 'td', { class: c && typeof c === 'object' && c.cls ? c.cls : null }, cellText(c)))))));
      host.appendChild(h('section.lab-tsec', t.title ? h('h4', t.title) : null, h('div.lab-tscroll', tb), t.note ? h('p.lab-note', S.UI.inline(t.note)) : null));
    }
  };
  V.metrics = function (host, list) {
    const { h } = S.UI;
    if (!list || !list.length) { host.appendChild(S.UI.empty('numbers', 'No metrics yet', 'Run the lab: what it measures shows here.')); return; }
    host.appendChild(h('div.lab-metrics', ...list.map((m) => h('div.lab-metric' + (m.cls ? '.' + m.cls : ''), h('span.lm-k', m.label), h('span.lm-v.mono', String(m.value), m.unit ? h('small', ' ' + m.unit) : null), m.note ? h('span.lm-n', S.UI.inline(m.note)) : null))));
  };
  V.trace = function (host, steps, at, go) {
    const { h } = S.UI;
    if (!steps || !steps.length) { host.appendChild(S.UI.empty('history', 'No trace yet', 'Run the lab: every step it takes is listed here.')); return; }
    const ol = h('ol.lab-trace', { id: 'labTrace' });
    const shown = steps.length > 600 ? 600 : steps.length;
    for (let i = 0; i < shown; i++) {
      const s = steps[i];
      const li = h('li' + (i === at ? '.on' : ''), { dataset: { i: String(i) } }, h('span.lt-k', s.kind || ''), h('span.lt-s', ...S.UI.inline(String(s.say || ''))));
      if (go) li.addEventListener('click', () => go(i));
      ol.appendChild(li);
    }
    host.appendChild(ol);
    if (steps.length > shown) host.appendChild(h('p.lab-note', 'The first ' + shown + ' of ' + steps.length + ' steps; export the trace for all of them.'));
    if (at >= 0) requestAnimationFrame(() => { const el = ol.querySelector('li.on'); if (el && host.offsetParent) { const r = el.getBoundingClientRect(), b = host.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) el.scrollIntoView({ block: 'nearest' }); } });
  };

  // ---- exports ----------------------------------------------------------------------------------------------------
  const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'visibility', 'display'];
  V.svgText = function (svg) {
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < src.length; i++) {
      const cs = getComputedStyle(src[i]);
      let st = '';
      for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) st += p + ':' + v + ';'; }
      dst[i].setAttribute('style', st + (dst[i].getAttribute('transform') ? '' : ''));
      dst[i].removeAttribute('class');
    }
    const vb = (svg.getAttribute('viewBox') || '0 0 800 400').split(/\s+/).map(Number);
    const r = svg.getBoundingClientRect();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(Math.round(r.width || vb[2])));
    clone.setAttribute('height', String(Math.round(r.height || vb[3])));
    const bg = getComputedStyle(svg.parentElement || svg).getPropertyValue('--st-bg').trim() || '#ffffff';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(vb[0])); rect.setAttribute('y', String(vb[1])); rect.setAttribute('width', String(vb[2])); rect.setAttribute('height', String(vb[3])); rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  };
  V.png = function (svg, scale) {
    scale = scale || 2;
    const text = V.svgText(svg), r = svg.getBoundingClientRect();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round((r.width || 800) * scale); c.height = Math.round((r.height || 400) * scale);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be drawn'))), 'image/png');
      };
      img.onerror = () => reject(new Error('the picture could not be drawn'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
    });
  };
  /** the run as JSON a reader can keep: the lab, its setup, the seed, the trace and the final tables and metrics */
  V.traceJSON = function (lab, values, seed, result) {
    const strip = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v, (k, x) => (typeof x === 'bigint' ? x.toString() : k === 'snap' || k === 'state' ? undefined : x)));
    return JSON.stringify({ proses: 1, lab: lab.id, title: lab.title, setup: values, seed, trace: strip((result && result.trace) || []), tables: strip(result && result.tables), metrics: strip(result && result.metrics) }, null, 1);
  };
})(globalThis.Proses = globalThis.Proses || {});
