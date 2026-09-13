// Part 13, the kernel I/O subsystem (3): the block layer's request queue. Requests for runs of sectors arrive,
// neighbours of the same kind merge into one, and an elevator picks the next to dispatch: in arrival order (noop),
// sweeping up and down (LOOK), or sweeping up but serving a request first once it has waited too long
// (deadline). Every decision and time comes from S.IO.blockQueue (src/core/io-c-kernel.js).
(function (S) {
  'use strict';
  const R = Math.round;
  const ELV = { noop: 'noop (arrival order)', look: 'LOOK (sweep up and down)', deadline: 'deadline (sweep up, expire old ones)' };
  const parse = (v) => String(v).split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s*([rw])?$/i); return m ? { at: +m[1], sector: +m[2], count: +m[3], op: (m[4] || 'r').toLowerCase() } : null; });
  /** the requests waiting in the queue at frame i (queued, not merged or sent) */
  const waitingAt = (fr, i) => { const of = {}; for (let j = 1; j <= i; j++) { const q = fr[j].meta; if (q.phase === 'queue') of[q.id] = 'q'; if (q.phase === 'merge') of[q.id] = 'm'; if (q.phase === 'dispatch') for (const id of q.ids) of[id] = 'd'; } return Object.keys(of).filter((id) => of[id] === 'q').map((id) => 'R' + id); };
  const span = (q) => q.sector + '–' + (q.sector + q.count - 1);

  S.topic({
    id: 'io-block-queue', family: 'p13-kernel', order: 40, title: 'The request queue: merging and the elevator',
    blurb: 'Before a request reaches the disk it waits in the block layer’s queue. Two requests for neighbouring sectors of the same kind merge into one larger request, which costs one seek instead of two. Then an I/O scheduler, the elevator, chooses the order: as they came, in a sweep across the disk, or in a sweep that rescues any request waiting past its deadline.',
    inputs: [
      { id: 'reqs', kind: 'text', label: 'requests: arrival, first sector, sectors, r or w; …', def: '0 100 8 r; 0 108 8 r; 1 20 8 w; 1 300 8 r; 2 92 8 r; 3 116 8 r' },
      { id: 'elevator', kind: 'choice', label: 'elevator', def: 'look', options: Object.keys(ELV).map((k) => ({ value: k, label: ELV[k] })) },
      { id: 'merge', kind: 'choice', label: 'merging', def: 'on', options: [{ value: 'on', label: 'merge neighbours' }, { value: 'off', label: 'no merging' }] },
      { id: 'start', kind: 'number', label: 'head starts at sector', def: 0, min: 0, max: 100000 },
      { id: 'seek', kind: 'number', label: 'time a sector of travel', def: 0.01, min: 0, max: 1, integer: false },
      { id: 'readExpire', kind: 'number', label: 'read deadline', def: 50, min: 1, max: 10000 },
      { id: 'writeExpire', kind: 'number', label: 'write deadline', def: 500, min: 1, max: 10000 },
    ],
    check(inp) { const q = parse(inp.reqs); if (!q.length || q.some((x) => !x)) return 'requests: each as arrival time, first sector, number of sectors and r or w, separated by ;'; if (q.length > 14) return 'at most 14 requests'; if (q.some((x) => x.count < 1 || x.count > 256)) return 'sectors from 1 to 256'; return null; },
    presets: [
      { label: 'Neighbours merge, LOOK sweeps', values: { reqs: '0 100 8 r; 0 108 8 r; 1 20 8 w; 1 300 8 r; 2 92 8 r; 3 116 8 r', elevator: 'look', merge: 'on', start: 0, seek: 0.01, readExpire: 50, writeExpire: 500 } },
      { label: 'The same without merging', values: { reqs: '0 100 8 r; 0 108 8 r; 1 20 8 w; 1 300 8 r; 2 92 8 r; 3 116 8 r', elevator: 'look', merge: 'off', start: 0, seek: 0.01, readExpire: 50, writeExpire: 500 } },
      { label: 'Arrival order: the head zigzags', values: { reqs: '0 500 8 r; 0 40 8 r; 0 460 8 r; 0 80 8 r; 0 420 8 r; 0 120 8 r', elevator: 'noop', merge: 'on', start: 0, seek: 0.02, readExpire: 50, writeExpire: 500 } },
      { label: 'The zigzag swept by LOOK', values: { reqs: '0 500 8 r; 0 40 8 r; 0 460 8 r; 0 80 8 r; 0 420 8 r; 0 120 8 r', elevator: 'look', merge: 'on', start: 0, seek: 0.02, readExpire: 50, writeExpire: 500 } },
      { label: 'Deadline rescues a read left behind', values: { reqs: '0 900 8 r; 0 100 8 r; 0 200 8 w; 4 240 8 w; 8 280 8 w; 12 320 8 w; 16 360 8 w; 20 400 8 w; 24 440 8 w; 28 480 8 w', elevator: 'deadline', merge: 'off', start: 150, seek: 0.01, readExpire: 10, writeExpire: 500 } },
    ],
    counters: [{ id: 'merges', label: 'merges' }, { id: 'sent', label: 'dispatched' }],
    run(inp) {
      const t = S.T12, reqs = parse(inp.reqs), o = { elevator: inp.elevator, merge: inp.merge === 'on', start: inp.start, seek: inp.seek, readExpire: inp.readExpire, writeExpire: inp.writeExpire };
      const res = S.IO.blockQueue(reqs, o), F = new S.Frames(['merges', 'sent']), n = reqs.length;
      const maxS = Math.max(inp.start, ...reqs.map((r) => r.sector + r.count)), smax = Math.max(16, Math.ceil(maxS / t.niceStep(maxS, 4)) * t.niceStep(maxS, 4));
      const X0 = 90, X1 = 790, X = (s) => t.r1(X0 + (s / smax) * (X1 - X0)), rowH = n > 6 ? 21 : 26, top = 50;
      const base = { o, totals: res.totals, n, dispatched: res.dispatched, spans: reqs.map((r) => [r.sector, r.sector + r.count - 1]), runs: res.dispatched.map((d) => [d.sector, d.sector + d.count - 1, t.r3(d.end - d.start)]) };
      // the state after each step: which requests arrived, which merged into which, which went out
      const pic = (state, act) => {
        const items = [t.title('bq:t', 0, 16, 'requests by sector')];
        reqs.forEach((r, i) => {
          const y = top + i * rowH, st = state.of[i];
          items.push(t.text('bq:l' + i, X0 - 10, y + 16, 'R' + i + ' ' + r.op, st === 'future' ? 'tick' : 'strong', 13, 'end'));
          if (st === 'future') return;
          const lit = act && act.includes(i), x = X(r.sector), w = Math.max(16, X(r.sector + r.count) - x);
          items.push({ key: 'bq:r' + i, kind: 'cell', x, y: y + 3, w, h: rowH - 6, rx: 3, text: '', cls: 'rq' + (r.op === 'w' ? ' w' : '') + (st === 'merged' ? ' merged' : '') + (st === 'done' ? ' done' : '') + (lit ? ' act' : '') });
          const lbl = span(r), right = x + w + 8 + t.tw(lbl, 12) < X1 + 10;
          items.push(t.text('bq:s' + i, right ? x + w + 8 : x - 8, y + 16, lbl, 'tick', 13, right ? 'start' : 'end'));
        });
        const ay = top + n * rowH + 10;
        const step = t.niceStep(smax, 5);
        let d = `M${X0},${ay} H${X1}`;
        for (let s = 0; s <= smax + 1e-9; s += step) { d += ` M${X(s)},${ay} v6`; items.push(t.text('bq:tk' + s, X(s), ay + 22, String(s), 'tick', 13, 'middle')); }
        items.push({ key: 'bq:ax', kind: 'path', d, cls: 'axis', audit: 'ignore', layer: 'back' });
        items.push(t.text('bq:an', X1, ay + 42, 'sector', 'tick', 13, 'end'));
        items.push({ key: 'bq:head', kind: 'line', x1: X(state.head), y1: top - 4, x2: X(state.head), y2: ay, cls: 'tl-now', audit: 'ignore', layer: 'top' });
        items.push(t.text('bq:hl', X(state.head), top - 10, 'head ' + state.head, 'strong act-t', 13, X(state.head) > X1 - 40 ? 'end' : X(state.head) < X0 + 40 ? 'start' : 'middle'));
        // the head's path: one row for each dispatch, in order
        const py = ay + 74, ph = n > 6 ? 18 : 22;
        items.push(t.title('bq:pt', 0, py - 10, 'the head’s path'));
        const pts = [[X(inp.start), py + 8]].concat(state.sent.map((dsp, k) => [X(dsp.sector), py + 8 + (k + 1) * ph]));
        items.push(t.text('bq:p0', X0 - 10, py + 13, 'start', 'tick', 13, 'end'));
        if (pts.length > 1) items.push({ key: 'bq:path', kind: 'path', d: 'M' + pts.map((p) => p.join(',')).join(' L'), cls: 'arm-path', audit: 'ignore', layer: 'lines' });
        state.sent.forEach((dsp, k) => {
          const y = py + 8 + (k + 1) * ph, lbl = dsp.ids.map((id) => 'R' + id).join('+'), cur = k === state.sent.length - 1 && act;
          items.push({ key: 'bq:pd' + k, kind: 'dot', x: X(dsp.sector), y, r: 5, cls: 'req done' + (cur ? ' act' : ''), audit: 'ignore' });
          items.push(t.text('bq:pl' + k, X0 - 10, y + 5, lbl, cur ? 'strong act-t' : 'strong', 13, 'end'));
        });
        items.push({ key: 'bq:pb', kind: 'region', x: X0, y: py, w: X1 - X0, h: (n + 1) * ph, rx: 4, cls: 'band13' });
        items.push(t.text('bq:time', 800, 16, 't = ' + state.t, 'mono', 13, 'end'));
        return items;
      };
      const state = { of: reqs.map(() => 'future'), head: inp.start, sent: [], t: 0 };
      const snap = () => ({ of: state.of.slice(), head: state.head, sent: state.sent.slice(), t: state.t });
      F.add({ items: pic(snap(), null), title: 'the requests', say: `${t.cap(t.plural(n, 'request'))} will arrive for runs of sectors; the head starts at sector ${inp.start}. The elevator is ${ELV[inp.elevator]}${o.merge ? ', and neighbouring requests of the same kind merge' : ', with merging off'}.`, meta: Object.assign({ phase: 'start' }, base) });
      let merges = 0, k = 0;
      for (const s of res.steps) {
        state.t = s.t;
        let act = null, say = s.say, extra = {};
        if (s.kind === 'queue') { state.of[s.id] = 'queued'; act = [s.id]; }
        else if (s.kind === 'merge') { state.of[s.id] = 'merged'; merges++; act = [s.id, s.into]; }
        else if (s.kind === 'dispatch') {
          const dsp = res.dispatched[k++];
          for (const id of dsp.ids) state.of[id] = 'done';
          state.sent.push(dsp); act = dsp.ids.slice();
          state.head = dsp.sector + dsp.count - 1;
          say += ` It waited ${dsp.wait}; the head ends at sector ${state.head}.`;
          extra = { dsp, headAfter: state.head };
        }
        F.set('merges', merges).set('sent', k);
        F.add({ items: pic(snap(), act), title: s.kind, say, meta: Object.assign({ phase: s.kind, at: s.t, id: s.id, into: s.into, ids: s.ids, k }, extra, base) });
      }
      const T = res.totals;
      state.t = T.time;
      F.add({ items: pic(snap(), null), title: 'totals', say: `${t.cap(t.plural(T.requests, 'request'))} went out as ${t.plural(T.dispatches, 'dispatch', 'dispatches')} after ${t.plural(T.merges, 'merge')}. The head travelled ${T.movement} sectors; requests waited ${T.meanWait} on average and ${T.maxWait} at most; all done at t = ${T.time}.`, meta: Object.assign({ phase: 'done' }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'The block layer', text: ['merge: same kind, and one ends where the other', '       begins (back merge, front merge)', 'noop:     dispatch in arrival order', 'LOOK:     nearest ahead; turn when none is left', 'deadline: sweep upward, but first any request', '          older than its deadline (reads sooner)', 'a dispatch: base + sectors × time + travel × time'].join('\n') }, { id: 't', kind: 'text', text: 'The same choices on the disk arm itself: part 12’s disk-arm scheduling.' }] } };
    },
    predict: [{
      at: (f, i, fr) => i > 0 && i + 1 < fr.length && fr[i + 1].meta.phase === 'dispatch' && fr[i + 1].meta.k >= 2 && f.meta.phase !== 'dispatch', once: true, pick: 'option',
      ask: 'Which request goes out next?',
      options: (fr, i) => waitingAt(fr, i),
      answer: (fr, i) => { const w = waitingAt(fr, i), m = fr[i + 1].meta; return w.length >= 2 && m.ids && w.includes('R' + m.ids[0]) ? 'R' + m.ids[0] : null; },
      explain: (fr, i) => fr[i + 1].say,
    }],
    quiz: [
      { q: 'Requests for sectors 100–107 and 108–115, both reads, are queued. What happens?', options: ['they merge into one request for 100–115', 'they go out separately', 'the second is dropped', 'they are reordered by size'], answer: 0, why: 'One ends where the other begins and they are the same kind: a back merge.' },
      { q: 'Why merge requests at all?', options: ['one larger request costs one seek and one interrupt instead of two', 'merging frees memory', 'the disk cannot read small requests', 'it sorts them'], answer: 0, why: 'The fixed cost of a request is paid once for the merged run.' },
      { q: 'Why does the deadline scheduler give reads shorter deadlines than writes?', options: ['a process usually waits for its read; a write can often finish in the background', 'reads are smaller', 'writes are faster', 'reads never merge'], answer: 0, why: 'A late read stalls a program; a late write usually stalls nobody.' },
      { q: 'For a fast SSD with no seek, which elevator often does best?', options: ['noop: the order hardly matters', 'LOOK', 'deadline', 'SSTF'], answer: 0, why: 'Without head travel, reordering buys little; merging still helps.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
