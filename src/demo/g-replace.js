// Two page-replacement policies side by side on the same reference string with the same frames: the frames after
// every reference, hits and faults, what each evicts and why, the clock's hand sweeping over the use bits (or the
// LRU recency order, the FIFO queue, OPT's next uses), and the fault totals. The frames, the string and the pair are
// the student's; the policies are the engine's (src/core/mem-d-replace.js).
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const STRINGS = [
    { name: 'hot page', refs: [3, 7, 3, 1, 3, 4, 7, 3, 2, 1, 3, 7, 4, 3, 1, 2] },
    { name: 'loop of five', refs: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1] },
    { name: 'two phases', refs: [2, 6, 2, 4, 6, 2, 4, 9, 6, 2, 8, 9, 8, 4, 9, 8] },
    { name: 'FIFO anomaly', refs: [6, 4, 3, 5, 6, 4, 1, 6, 2, 4, 3, 1, 6] },
  ];
  const PAIRS = [['lru', 'clock'], ['fifo', 'clock'], ['fifo', 'lru'], ['opt', 'lru']];
  const DEF = { frames: 4, str: 0, pair: 0 };
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  function setup(knobs) {
    const M = S.Mem, n = Math.round(knobs.frames), s = STRINGS[Math.round(knobs.str)], pair = PAIRS[Math.round(knobs.pair)];
    return { M, n, s, refs: s.refs, pair, runs: pair.map((p) => M.replace(p, s.refs, n)) };
  }

  /** what one policy did at one reference, in a clause */
  function clause(name, st) {
    if (st.hit) return name + ' hits in frame ' + st.slot + (/Clock/.test(name) ? ' and sets its use bit' : '');
    const swept = st.cleared.length ? 'the hand clears the use bit' + (st.cleared.length > 1 ? 's' : '') + ' of frame' + (st.cleared.length > 1 ? 's ' : ' ') + list(st.cleared) + ', then ' : '';
    if (st.free) return name + ' faults: ' + swept + 'page ' + st.page + ' fills free frame ' + st.slot;
    return name + ' faults: ' + swept + 'evicts page ' + st.victim + ' from frame ' + st.slot + ' (' + st.reason + ')';
  }

  function trace(knobs) {
    const m = setup(knobs), [A, B] = m.runs;
    const steps = [{ kind: 'setup', say: A.name + ' and ' + B.name + ' each start with ' + m.n + ' empty frames and see the same ' + m.refs.length + ' references: `' + m.refs.join(' ') + '`.' }];
    m.refs.forEach((p, i) => steps.push({ kind: 'ref', i, page: p, a: A.steps[i], b: B.steps[i], say: 'Reference ' + (i + 1) + ' is page ' + p + ': ' + clause(A.name, A.steps[i]) + '; ' + clause(B.name, B.steps[i]) + '.' }));
    let say = 'After ' + m.refs.length + ' references with ' + m.n + ' frames: ' + A.name + ' faulted ' + A.faults + ' times and ' + B.name + ' ' + B.faults + (A.faults === B.faults ? ', a tie.' : '; ' + (A.faults < B.faults ? A.name : B.name) + ' did better by ' + Math.abs(A.faults - B.faults) + '.');
    if (m.pair.includes('fifo')) {
      const c = m.M.faultCurve('fifo', m.refs, 1, 6);
      const up = c.findIndex((x, k) => k > 0 && x.faults > c[k - 1].faults);
      if (up > 0) say += ' On this string FIFO with ' + c[up - 1].n + ' frames faults ' + c[up - 1].faults + ' times but with ' + c[up].n + ' frames ' + c[up].faults + ': more memory, more faults (Belady’s anomaly).';
    }
    if (m.pair.includes('clock') && m.pair.includes('lru') && A.faults !== B.faults) say += ' The clock only approximates recency with one bit a frame.';
    steps.push({ kind: 'total', faults: [A.faults, B.faults], say });
    return steps;
  }

  /** one policy's panel at reference index `upto` (−1 before the first, refs.length − 1 at the end) */
  function panel(P, run, refs, n, upto, L, isFinal, best) {
    const KM = S.Kit.mem, items = [], st = upto >= 0 ? run.steps[upto] : null;
    const faults = st ? st.faults : 0;
    items.push({ key: P + ':name', kind: 'text', x: L.x, y: L.y, text: run.name, size: 17, cls: 'mb-ptitle' });
    items.push({ key: P + ':tot', kind: 'text', x: L.x + L.w, y: L.y, text: faults + ' fault' + (faults === 1 ? '' : 's') + (isFinal ? '' : ' so far'), anchor: 'end', size: 15, cls: 'mb-big' + (isFinal ? (best ? ' good' : ' bad') : '') });
    const gy = L.y + 26, g = KM.grid({ prefix: P + 'g', x: L.x, y: gy, cw: L.cw, ch: L.ch, labelW: L.lw, refs, nFrames: n, steps: run.steps, upto: isFinal ? refs.length - 1 : upto, cur: isFinal ? -1 : upto, size: L.fs });
    items.push(...g.items);
    // the victims, under the faults
    const vy = gy + (n + 2) * L.ch + 22;
    items.push({ key: P + ':outl', kind: 'text', x: L.x + L.lw - 8, y: vy + 4, text: 'out', anchor: 'end', size: 12, cls: 'tick' });
    for (let j = 0; j <= (isFinal ? refs.length - 1 : upto); j++) { const v = run.steps[j].victim; if (v !== null) items.push({ key: P + ':out' + j, kind: 'text', x: L.x + L.lw + j * L.cw + L.cw / 2, y: vy + 4, text: String(v), anchor: 'middle', size: 13, cls: 'hot' }); }
    const by = vy + 30;
    if (run.policy === 'clock') {
      const frames = st ? st.frames : Array(n).fill(null), use = st ? st.use : Array(n).fill(0);
      const r = KM.ring({ prefix: P + 'k', cx: L.x + L.w / 2, cy: by + L.R + 44, R: L.R, frames, use, hand: st ? st.hand : 0, act: st && !isFinal ? st.slot : -1, victim: -1, cleared: st && !isFinal ? st.cleared : [], boxW: L.bw, boxH: L.bh, size: L.fs + 2 });
      items.push(...r.items);
      items.push({ key: P + ':kt', kind: 'text', x: L.x, y: by + 12, text: 'the hand and the use bits', size: 12, cls: 'tick' });
    } else {
      let title, cells;
      if (run.policy === 'opt') {
        title = 'next use of each resident page';
        const fr = st ? st.frames : [];
        cells = fr.map((p, k) => { if (p === null) return null; const j = refs.indexOf(p, upto + 1); return { key: 's' + k, text: p + ': ' + (j < 0 ? 'never' : 'r' + (j + 1)), cls: st && !isFinal && st.slot === k ? 'act' : '' }; }).filter(Boolean);
      } else {
        title = run.policy === 'lru' ? 'least recent → most recent' : 'loaded first → loaded last';
        cells = (st ? st.order : []).map((p) => ({ key: 'p' + p, text: String(p), cls: st && !isFinal && p === st.page ? 'act' : '' }));
      }
      if (!cells.length) cells = [{ key: 'none', text: 'empty', cls: 'none' }];
      const cw = run.policy === 'opt' ? L.ow : L.qw;
      items.push(...KM.row({ prefix: P + 'o', x: L.x + L.lw, y: by + 24, cw, ch: L.qh, title, cells, size: L.fs }).items);
    }
    return items;
  }

  function frames(narrow, knobs) {
    const m = setup(knobs), steps = trace(knobs), n = m.n, len = m.refs.length;
    const L = narrow
      ? { w: 404, lw: 30, ch: 25, fs: 13, R: 66, bw: 50, bh: 42, qw: 40, qh: 30, ow: 70 }
      : { w: 560, lw: 40, ch: 30, fs: 14, R: 84, bw: 58, bh: 46, qw: 48, qh: 34, ow: 84 };
    L.cw = Math.min(narrow ? 26 : 34, Math.floor((L.w - L.lw) / len));
    // a panel's height: title, grid, victims, then the ring or the order row
    const phOf = (p) => 26 + (n + 2) * L.ch + 22 + 30 + (p === 'clock' ? 2 * L.R + 44 + 62 : 70);
    const [h0, h1] = m.pair.map(phOf), ph = Math.max(h0, h1);
    const pos = narrow ? [{ x: 8, y: 22 }, { x: 8, y: 22 + h0 + 26 }] : [{ x: 20, y: 24 }, { x: 600, y: 24 }];
    const view = narrow ? box(0, -2, 420, h0 + h1 + 52) : box(0, -4, 1180, ph + 24);
    const [A, B] = m.runs;
    return steps.map((st, si) => {
      const upto = st.kind === 'setup' ? -1 : st.kind === 'ref' ? st.i : len - 1, fin = st.kind === 'total';
      const items = [];
      m.runs.forEach((run, k) => items.push(...panel(k ? 'B' : 'A', run, m.refs, n, upto, Object.assign({}, L, pos[k]), fin, run.faults <= (k ? A : B).faults)));
      if (!narrow) items.push({ key: 'sep', kind: 'line', x1: 590, y1: 10, x2: 590, y2: ph + 4, cls: 'faint', audit: 'ignore' });
      const title = st.kind === 'setup' ? 'start' : st.kind === 'ref' ? 'page ' + st.page : 'totals';
      return { items, say: st.say, view, title, i: si };
    });
  }

  D.add({
    id: 'replace-pair', order: 70, tag: 'Virtual memory · replacement', short: 'LRU against clock', title: 'Page replacement: two policies, one reference string',
    blurb: 'The same references and the same frames for two policies: every hit, every fault, what each evicts and why. The clock keeps one use bit a frame and a hand that sweeps; LRU keeps the full order.',
    knobs: [
      { id: 'frames', label: 'Frames', min: 2, max: 6, step: 1, value: DEF.frames },
      { id: 'str', label: 'String', type: 'select', value: DEF.str, options: STRINGS.map((s, i) => ({ value: i, label: s.name })) },
      { id: 'pair', label: 'Policies', type: 'select', value: DEF.pair, options: PAIRS.map((pr, i) => ({ value: i, label: pr.map((p) => S.Mem.policyName(p)).join(' vs ') })) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, Object.assign({}, DEF, knobs || {})); },
    trace: (knobs) => trace(Object.assign({}, DEF, knobs || {})),
  });
})(globalThis.Proses = globalThis.Proses || {});
