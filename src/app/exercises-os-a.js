// Answer areas of the operating-systems exercise kinds, part 1: the pieces they share (what the exercise gives, a
// form of named fields, a grid of cells to fill) and the kinds whose answer is a few fields or a text: address-split,
// page-walk, inode-walk, disk-order, raid-parity, banker, fork-outputs and code.
//   S.ExWidgets.given(rows)                 a small definition list of what the exercise gives: [[label, value | node]]
//   S.ExWidgets.fieldForm(host, fields, draft)  fields: [{key, label, placeholder, wide}] -> {get(), mark(result)}
//   S.ExWidgets.fillGrid(host, {rows: [{key, label}], cols: [{key, label, sub}], cell(r, c) -> key | null, draft,
//     placeholder, width}) -> {get(), mark(result)}    keys are 'row|col' as the checkers name them
//   S.ExWidgets.listing(host, src)          a C program shown read-only, with the editor's highlighting
(function (S) {
  'use strict';
  const W = (S.ExWidgets = S.ExWidgets || {});
  const V = (S.ExerciseViews = S.ExerciseViews || {});
  const h = (...a) => S.UI.h(...a);
  const markCells = (inputs, r) => { for (const [k, i] of Object.entries(inputs)) { const c = r && r.cells ? r.cells[k] : undefined; i.classList.toggle('right', c === true); i.classList.toggle('wrong', c === false); } };

  W.given = (rows) => h('dl.ex-given', ...rows.filter(Boolean).flatMap(([k, v]) => [h('dt', k), h('dd', v instanceof Node ? v : h('span.mono', String(v)))]));

  W.fieldForm = function (host, fields, draft) {
    const inputs = {};
    const box = h('div.ex-form');
    for (const f of fields) {
      const i = h('input.mono', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': f.label, placeholder: f.placeholder || '', dataset: { key: f.key } });
      if (draft && draft[f.key] !== undefined) i.value = draft[f.key];
      inputs[f.key] = i;
      box.appendChild(h('label.ex-field' + (f.wide ? '.wide' : ''), h('span', f.label), i));
    }
    host.appendChild(box);
    return { inputs, get: () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])), mark: (r) => markCells(inputs, r) };
  };

  W.fillGrid = function (host, o) {
    const inputs = {};
    const head = h('tr', h('th', o.corner || ''), ...o.cols.map((c) => h('th', h('span', c.label), c.sub !== undefined ? h('small', String(c.sub)) : null)));
    const body = h('tbody');
    for (const r of o.rows) {
      const tr = h('tr', h('th.mono', r.label));
      for (const c of o.cols) {
        const key = o.cell ? o.cell(r, c) : r.key + '|' + c.key;
        if (key === null) { tr.appendChild(h('td.none')); continue; }
        const i = h('input.mono', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': r.label + ', ' + c.label, placeholder: o.placeholder || '', dataset: { key } });
        if (o.draft && o.draft[key] !== undefined) i.value = o.draft[key];
        inputs[key] = i;
        tr.appendChild(h('td', i));
      }
      body.appendChild(tr);
    }
    host.appendChild(h('div.fit-table.ans-table.ex-grid' + (o.narrow ? '.narrow' : ''), h('table.fill-table', h('thead', head), body)));
    return { inputs, get: () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])), mark: (r) => markCells(inputs, r) };
  };

  W.listing = function (host, src) {
    const box = h('div.ex-listing');
    host.appendChild(box);
    if (S.LabEditor) S.LabEditor.create(box, { value: src, readOnly: true, label: 'The program', minLines: 3, maxHeight: 4000 });
    else box.appendChild(h('pre.mono', src));
    return box;
  };

  // ---- address-split, page-walk ------------------------------------------------------------------------------------
  const cfgRows = (x) => [['Virtual address', x.vaBits + ' bits'], ['Page size', x.pageBytes + ' bytes'], ['Levels', x.levels + (x.bits ? ' (' + x.bits.join(' + ') + ' bits)' : '')], x.pteBytes ? ['Entry size', x.pteBytes + ' bytes'] : null, ['Address', String(x.va)]];
  V['address-split'] = (x, host, draft) => {
    host.appendChild(W.given(cfgRows(x)));
    const fs = S.Check.kinds['address-split'].fieldsOf(x).map((f) => ({ key: f.key, label: f.label, placeholder: 'decimal or 0x' }));
    return W.fieldForm(host, fs, draft);
  };
  V['page-walk'] = (x, host, draft) => {
    const map = h('span.mono', (x.map || []).map(([v, p]) => 'page 0x' + Number(v).toString(16) + ' → frame 0x' + Number(p).toString(16)).join(', '));
    host.appendChild(W.given(cfgRows(x).concat([['Mapped', map]])));
    const fields = S.Check.kinds['page-walk'].fieldsOf(x);
    const levels = [...new Set(fields.filter((f) => f.key.includes('|')).map((f) => f.key.split('|')[0]))];
    const asks = [...new Set(fields.filter((f) => f.key.includes('|')).map((f) => f.key.split('|')[1]))];
    const NAMES = { index: 'index', entry: 'entry address', next: 'it holds' };
    const g = W.fillGrid(host, { corner: 'level', rows: levels.map((l) => ({ key: l, label: l })), cols: asks.map((a) => ({ key: a, label: NAMES[a] || a })), placeholder: '0x…', draft });
    const pa = W.fieldForm(host, [{ key: 'pa', label: 'Physical address (or fault)', placeholder: '0x…' }], draft);
    return { get: () => Object.assign(g.get(), pa.get()), mark: (r) => { g.mark(r); pa.mark(r); } };
  };

  // ---- inode-walk, disk-order, raid-parity --------------------------------------------------------------------------
  V['inode-walk'] = (x, host, draft) => {
    host.appendChild(W.given([['Block size', x.bs + ' bytes'], ['Pointer size', x.ps + ' bytes'], ['Direct pointers', x.ndirect], ['Indirect levels', x.levels === undefined ? 3 : x.levels], x.ask === 'max' ? null : ['Byte N', x.N]]));
    if (x.ask === 'max') { const f = W.fieldForm(host, [{ key: 'v', label: 'Largest file, in bytes' }], draft === undefined || draft === null ? null : { v: draft }); return { get: () => f.get().v }; }
    const part = h('select', { 'aria-label': 'Which part maps it', dataset: { key: 'part' } }, h('option', { value: '' }, 'choose…'), ...['direct', 'single', 'double', 'triple', 'beyond'].map((p) => h('option', { value: p }, p === 'beyond' ? 'beyond the largest file' : p === 'direct' ? 'a direct pointer' : p + ' indirect')));
    if (draft && draft.part) part.value = draft.part;
    host.appendChild(h('div.ex-form', h('label.ex-field', h('span', 'The part'), part)));
    const f = W.fieldForm(host, [{ key: 'indices', label: 'Index at each level (top first)', placeholder: '3, 17', wide: true }, { key: 'offset', label: 'Offset in the block' }], draft);
    return { get: () => Object.assign({ part: part.value }, f.get()), mark: (r) => { f.mark(r); part.classList.toggle('wrong', !!(r.cells && r.cells.part === false)); part.classList.toggle('right', !!(r.cells && r.cells.part)); } };
  };
  V['disk-order'] = (x, host, draft) => {
    const NAMES = { fcfs: 'FCFS', sstf: 'SSTF (shortest seek first)', scan: 'SCAN', look: 'LOOK', cscan: 'C-SCAN', clook: 'C-LOOK' };
    host.appendChild(W.given([['Policy', NAMES[x.policy] || x.policy], ['Cylinders', '0 to ' + ((x.cylinders || 200) - 1)], ['Head at', x.start + (x.dir ? ', moving ' + x.dir : '')], ['Queue', x.requests.join(', ')]]));
    const fs = S.Check.kinds['disk-order'].fieldsOf(x).map((f) => ({ key: f.key, label: f.key === 'order' ? 'Service order (cylinders)' : 'Total head movement (cylinders)', wide: f.key === 'order', placeholder: f.key === 'order' ? '72, 91, …' : '' }));
    return W.fieldForm(host, fs, draft);
  };
  V['raid-parity'] = (x, host, draft) => {
    host.appendChild(W.given(x.chunks.map((c, k) => ['Data disk ' + k, h('span.mono', S.Check.os.hex(S.Check.os.int(c), 2) + '  ' + Number(S.Check.os.int(c)).toString(2).padStart(8, '0'))])));
    const f = W.fieldForm(host, [{ key: 'v', label: x.ask === 'q' ? 'The Q byte' : 'The parity byte', placeholder: '0x..' }], draft === undefined || draft === null ? null : { v: draft });
    return { get: () => f.get().v };
  };

  // ---- banker ------------------------------------------------------------------------------------------------------
  V.banker = (x, host, draft) => {
    const P = x.names || x.alloc.map((_, i) => 'P' + i), R = x.res || x.avail.map((_, j) => String.fromCharCode(65 + j));
    const mat = (title, m) => h('table.ex-mat', h('caption', title), h('thead', h('tr', h('th'), ...R.map((r) => h('th', r)))), h('tbody', ...m.map((row, i) => h('tr', h('th', P[i]), ...row.map((v) => h('td.mono', String(v)))))));
    host.appendChild(h('div.ex-mats', mat('Allocation', x.alloc), mat('Max', x.max), h('table.ex-mat', h('caption', 'Available'), h('thead', h('tr', ...R.map((r) => h('th', r)))), h('tbody', h('tr', ...x.avail.map((v) => h('td.mono', String(v))))))));
    if (x.request) host.appendChild(W.given([['Request', P[x.request.who] + ' asks for (' + x.request.req.join(', ') + ')']]));
    if (x.ask === 'verdict') {
      const opts = x.request ? [['granted', 'Granted'], ['wait', 'Waits: not enough is free'], ['unsafe', 'Refused: the state would be unsafe'], ['over-need', 'Refused: more than its declared need']] : [['safe', 'Safe'], ['unsafe', 'Unsafe']];
      const row = h('div.choices', { role: 'radiogroup' });
      let chosen = draft || null;
      for (const [v, label] of opts) {
        const b = h('button.quiz-opt.choice', { type: 'button', role: 'radio', 'aria-checked': String(chosen === v), dataset: { v } }, h('span.box'), h('span', label));
        b.classList.toggle('on', chosen === v);
        b.addEventListener('click', () => { chosen = v; for (const c of row.children) { const on = c.dataset.v === v; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); c.classList.remove('right', 'wrong'); } });
        row.appendChild(b);
      }
      host.appendChild(row);
      return { get: () => chosen, mark: (r) => { for (const c of row.children) { c.classList.toggle('right', r.ok && c.dataset.v === chosen); c.classList.toggle('wrong', !r.ok && c.dataset.v === chosen); } } };
    }
    const f = W.fieldForm(host, [{ key: 'v', label: 'A safe sequence (or none)', placeholder: P.slice(0, 3).join(', ') + ', …', wide: true }], draft === undefined || draft === null ? null : { v: draft });
    return { get: () => f.get().v, mark: (r) => f.inputs.v.classList.toggle('wrong', !r.ok) };
  };

  // ---- fork-outputs and code ---------------------------------------------------------------------------------------
  V['fork-outputs'] = (x, host, draft) => {
    W.listing(host, x.src);
    if ((x.ask || 'count') !== 'set') { const f = W.fieldForm(host, [{ key: 'v', label: x.ask === 'lines' ? 'Lines printed' : 'Different outputs' }], draft === undefined || draft === null ? null : { v: draft }); return { get: () => f.get().v }; }
    const ta = h('textarea.mono.ex-outs', { rows: '5', spellcheck: 'false', 'aria-label': 'Every possible output, one a line', placeholder: 'one output a line, its line breaks as spaces' });
    ta.value = Array.isArray(draft) ? draft.join('\n') : draft || '';
    host.appendChild(h('label.ex-field.wide', h('span', 'Every possible output, one a line'), ta));
    return { get: () => ta.value.split('\n').map((l) => l.trim()).filter(Boolean) };
  };
  V.code = (x, host, draft, page) => {
    const ed = S.LabEditor.create(host, { value: typeof draft === 'string' ? draft : x.starter || '', files: 'ex:' + x.id, id: 'ansCode', label: 'Your program', minLines: 10, onRun: () => { const b = document.getElementById('btnCheck'); if (b) b.click(); } });
    if (page && page.editors) page.editors.push(ed);
    return {
      get: () => ed.get(), editor: ed,
      after(r, box) {
        ed.setError(r && r.error ? r.error : null);
        // a failing schedule (a starvation lasso, a deadlock, a broken property): replay it in the Sync lab
        if (r && r.replay && S.Labs && S.Labs.get('sync') && box) {
          const b = h('button.btn.small', { type: 'button', id: 'btnReplay' }, S.UI.icon('history'), r.starved ? 'Replay the lasso: watch ' + r.starved + ' starve' : 'Replay the failing schedule');
          b.addEventListener('click', () => { S.Labs.preset('sync', { src: r.replay.src, spec: r.replay.spec, gran: r.replay.gran, mode: 'check', search: 'full' }); location.hash = 'labs/sync'; });
          box.appendChild(h('div.ex-d', b));
        }
      },
    };
  };
})(globalThis.Proses = globalThis.Proses || {});
