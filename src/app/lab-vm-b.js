// The Virtual memory lab, part two: one reference at a time under each chosen policy. The reference string across the
// top (a window of it when it is long), the working-set window bracketed over it; then a block a policy: its frames
// column by column (a fault red, a hit green, the page evicted named under the column), and beside it the frame
// table after this reference: the page, its use and dirty bits, the clock's hand, and what the policy ranks by.
//   VL.D (item helpers)   VL.stepFrames(v, refs, runs, narrow) -> [frame..]
(function (S) {
  'use strict';
  const VL = S.VMLab;
  const M = () => S.Mem, T11 = () => S.Kit.p11;
  const r = Math.round;
  const D = (VL.D = {});
  D.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: r(x), y: r(y), text: String(text), cls: cls === undefined ? 'strong' : cls }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  D.cell = (key, x, y, w, h, text, cls, size, more) => Object.assign({ key, kind: 'cell', x: r(x), y: r(y), w: r(w), h: r(h), rx: 3, text: String(text), cls: cls || '', size: size || 13 }, more || {});
  const CLOCKS = new Set(['clock', 'second', 'eclock']);
  const EXTRA = { fifo: 'age rank', second: 'queue', lru: 'recency', opt: 'next use', lfu: 'count', mfu: 'count', aging: 'register', nru: 'class', clock: '', eclock: 'class' };

  /** what a policy ranks frames by, after step i, for frame k */
  function extra(run, st, k, refs) {
    const p = run.policy, page = st.frames[k];
    if (page === null) return '';
    if (p === 'fifo' || p === 'second' || p === 'lru') return String(st.order.indexOf(page) + 1);
    if (p === 'opt') { for (let j = st.i + 1; j < refs.length; j++) if (refs[j].page === page) return 'ref ' + (j + 1); return 'never'; }
    if (p === 'lfu' || p === 'mfu') return String(st.counts[k]);
    if (p === 'aging') return st.ages[k];
    if (p === 'nru' || p === 'eclock') return '(' + st.use[k] + ', ' + st.dirty[k] + ')';
    return '';
  }

  VL.stepFrames = function (v, refs, runs, narrow) {
    const n = refs.length, nF = v.frames, W = narrow ? 380 : 1000, P = runs.length;
    const digits = Math.max(1, ...refs.map((x) => VL.label(x).length));
    const tableW = narrow ? 0 : 272, gridW = W - tableW - (narrow ? 0 : 26), lab = 34;
    const cw = Math.max(26, Math.min(44, 12 + 8.2 * digits, Math.floor((gridW - lab) / Math.max(1, n)))), maxCols = Math.max(4, Math.min(n, Math.floor((gridW - lab) / cw)));
    const ch = Math.max(20, Math.min(28, Math.floor((narrow ? 260 : 300) / Math.max(1, P * nF))));
    const ws = v.delta ? S.VM.workingSet(refs.map((x) => x.page), v.delta) : null;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const items = [], ref = refs[i];
      const w0 = Math.max(0, Math.min(n - maxCols, i - maxCols + 4)), w1 = Math.min(n, w0 + maxCols);
      const X = (j) => lab + (j - w0) * cw;
      items.push(D.text('hd', 0, 14, 'reference ' + (i + 1) + ' of ' + n + ': page ' + ref.page + (ref.write ? ', a write' : ''), 'strong', narrow ? 13 : 14));
      if (ws && !narrow) items.push(D.text('wsl', W, 14, 'working set, Δ = ' + v.delta + ': {' + ws.steps[i].ws.join(', ') + '}, ' + ws.steps[i].wss + ' page' + (ws.steps[i].wss === 1 ? '' : 's'), 'tick', 13, 'end'));
      const ry = 58;
      items.push(D.text('rl', lab - 8, ry + 18, 'ref', 'tick', 13, 'end'));
      for (let j = w0; j < w1; j++) items.push(D.cell('r' + j, X(j), ry, cw, 26, VL.label(refs[j]), 'mb-ref' + (j === i ? ' act' : j > i ? ' dim' : ''), 13, { rx: 0 }));
      if (w0 > 0) items.push(D.text('rmore', lab - 8, ry - 6, '…', 'tick', 12, 'end'));
      if (ws) {
        const a = Math.max(w0, i - v.delta + 1);
        items.push({ key: 'wsb', kind: 'bracket', x1: X(a) + 2, x2: X(i) + cw - 2, y: ry - 4, side: 'above', text: narrow ? 'Δ ' + v.delta + ': ' + ws.steps[i].wss : 'Δ = ' + v.delta, cls: 'vl-ws' });
      }
      let y = ry + 50;
      runs.forEach((run, k) => {
        const st = run.steps[i], P0 = 'p' + k + ':';
        const wb = run.steps.slice(0, i + 1).filter((s) => s.writeBack).length;
        items.push(D.text(P0 + 'nm', 0, y + 14, run.name, 'mb-ptitle', 15));
        items.push(D.text(P0 + 'ft', narrow ? W : Math.round(S.geom.textWidth(run.name, 15, { bold: true }) + 18), y + 14, st.faults + ' fault' + (st.faults === 1 ? '' : 's') + (wb ? ', ' + wb + ' written back' : ''), 'p10-sum' + (st.hit ? ' good' : ' bad'), 14, narrow ? 'end' : 'start'));
        const gy = y + 26;
        for (let f = 0; f < nF; f++) {
          items.push(D.text(P0 + 'fl' + f, lab - 8, gy + f * ch + ch / 2 + 4, 'f' + f, 'tick', 13, 'end'));
          for (let j = w0; j <= i && j < w1; j++) {
            const s = run.steps[j], page = s.frames[f];
            let cls = 'mb-slot';
            if (s.slot === f) cls += s.hit ? ' hit' : ' in';
            if (page === null) cls += ' empty';
            if (j !== i && s.slot !== f) cls += ' old';
            items.push(D.cell(P0 + 'c' + j + '_' + f, X(j), gy + f * ch, cw, ch, page === null ? '' : page, cls, 13, { rx: 0 }));
          }
        }
        const my = gy + nF * ch + 14;
        for (let j = w0; j <= i && j < w1; j++) {
          const s = run.steps[j];
          items.push(D.text(P0 + 'm' + j, X(j) + cw / 2, my + 2, s.hit ? '✓' : 'F', s.hit ? 'good' : 'bad', 13, 'middle'));
          const tight = S.geom.textWidth('−' + s.victim, 13) + 4 > cw;
          if (s.victim !== null) items.push(D.text(P0 + 'v' + j, X(j) + cw / 2, my + 18 + (tight && j % 2 ? 14 : 0), '−' + s.victim, 'tick' + (s.writeBack ? ' bad' : ''), 13, 'middle'));
        }
        if (!narrow) {
          // the frame table after this reference, its rows level with the frames
          const ex = EXTRA[run.policy], clock = CLOCKS.has(run.policy);
          const cols = [{ name: clock ? 'hand' : '', w: 40 }, { name: 'frame', w: 50 }, { name: 'page', w: 54 }, { name: 'use', w: 40 }, { name: 'dirty', w: 44 }].concat(ex ? [{ name: ex, w: 72 }] : []);
          const tw = cols.reduce((a, c) => a + c.w, 0), tx = W - tw;
          const rows = st.frames.map((page, f) => ({ key: 'f' + f, cls: f === st.victimSlot && !st.hit ? 'hot' : f === st.slot ? 'act' : '',
            cells: [clock && st.hand === f ? { text: '→', cls: 'good' } : '', 'f' + f, page === null ? '–' : String(page), page === null ? '' : { text: String(st.use[f]), cls: st.use[f] ? 'on' : 'off' }, page === null ? '' : { text: String(st.dirty[f]), cls: st.dirty[f] ? 'off' : '' }].concat(ex ? [extra(run, st, f, refs)] : []) }));
          items.push(...T11().table({ prefix: P0 + 'tb', x: tx, y: gy - 24, cols, rows, rowH: ch, headH: 24, size: 13 }).items);
        }
        y = my + 26 + (runs.some(() => digits > 1) ? 12 : 0);
      });
      const ft = runs.map((rr) => rr.name + ' ' + rr.steps[i].faults).join(', ');
      const clause = (rr) => { const s = rr.steps[i]; return rr.name + (s.hit ? ' hits in frame ' + s.slot : s.victim === null ? ' faults into free frame ' + s.slot : ' faults and evicts page ' + s.victim + ' (' + s.reason + ')' + (s.writeBack ? ', written back first' : '')); };
      const say = runs.length === 1 ? runs[0].steps[i].say : 'Reference ' + (i + 1) + ', page ' + ref.page + (ref.write ? ' (a write)' : '') + ': ' + runs.map(clause).join('; ') + '.';
      frames.push({ items, say, title: 'ref ' + (i + 1), at: i, hold: 1000,
        tables: [{ title: 'Faults so far', cols: ['Policy', 'Faults', 'Hits', 'Write-backs'], rows: runs.map((rr) => [rr.name, String(rr.steps[i].faults), String(rr.steps[i].hits), String(rr.steps[i].writeBacks)]) }],
        metrics: [{ label: 'Reference', value: (i + 1) + ' of ' + n }].concat(runs.map((rr) => ({ label: rr.name + ' faults', value: rr.steps[i].faults, cls: rr.steps[i].hit ? 'good' : 'bad' }))).concat(ws ? [{ label: 'Working set (Δ = ' + v.delta + ')', value: ws.steps[i].wss, unit: 'pages' }] : []),
        ft });
    }
    return frames;
  };
})(globalThis.Proses = globalThis.Proses || {});
