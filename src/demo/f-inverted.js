// An inverted page-table lookup: (pid, page) hashed to an anchor, the chain followed entry by entry until the
// pair matches, and the frame number read off as the entry's position. Then the size of the table against flat
// forward tables for the same machine. The frames, the anchors and the lookup are the student's; the table is
// built by the engine (src/core/mem-b-inverted.js) from a fixed set of resident pages of three processes.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const PIDS = [3, 5, 8], PCLS = { 3: 'p0', 5: 'p1', 8: 'p2' };
  // the pages resident in frames 0, 1, 2, ... (pid, page): three processes' working sets, scattered over memory
  const RES = [[5, 13], [3, 2], [8, 7], [3, 9], [5, 4], [8, 0], [3, 14], [5, 1], [8, 11], [3, 6], [5, 9], [8, 3], [3, 0], [5, 6], [8, 15], [3, 5]];
  const LOOKUPS = ['deep in a chain', 'head of a chain', 'other process', 'not resident'];
  const PAGE = 4096, OFF = 0x2a4, VA_BITS = 32;

  function setup(knobs) {
    const M = S.Mem, frames = [8, 12, 16][Math.round(knobs.frames)], anchors = [4, 8, 16][Math.round(knobs.anchors)];
    const T = M.ipt({ frames, anchors, pageBytes: PAGE, vaBits: VA_BITS, entryBytes: 8, anchorBytes: 4 });
    for (let f = 0; f < frames; f++) T.place(f, RES[f][0], RES[f][1]);
    // the longest chain, for the first two lookups; ties go to the lowest slot
    let long = 0;
    for (let s = 1; s < anchors; s++) if (T.chain(s).length > T.chain(long).length) long = s;
    const chain = T.chain(long), resident = (p, v) => T.entries.some((e) => e && e.pid === p && e.vpn === v);
    const which = LOOKUPS[Math.round(knobs.lookup)];
    let q;
    if (which === 'deep in a chain') { const e = T.entries[chain[chain.length - 1]]; q = [e.pid, e.vpn]; }
    else if (which === 'head of a chain') { const e = T.entries[chain[0]]; q = [e.pid, e.vpn]; }
    else if (which === 'other process') {
      // a page number that is resident for one process, asked for by another that does not have it
      for (const f of chain.concat([...Array(frames).keys()])) { const e = T.entries[f]; const p = PIDS.find((x) => x !== e.pid && !resident(x, e.vpn)); if (p !== undefined) { q = [p, e.vpn]; break; } }
    } else { q = [5, 10]; }
    const look = T.lookup(q[0], q[1], OFF);
    return { M, T, frames, anchors, q, which, look };
  }

  /** for the other-process lookup: whose page of that number is resident, and where */
  function other(m) {
    if (m.which !== 'other process') return '';
    const f = m.T.entries.findIndex((e) => e && e.vpn === m.q[1] && e.pid !== m.q[0]);
    return ' Page ' + m.q[1] + ' of process ' + m.T.entries[f].pid + ' is in frame ' + f + ', but the pid is part of the key: that is not this page.';
  }

  function trace(knobs) {
    const m = setup(knobs), M = m.M, sz = m.T.size(), fwd = M.forwardBytes({ vaBits: VA_BITS, pageBytes: PAGE, pteBytes: 4, procs: PIDS.length });
    const steps = [{ kind: 'setup', say: 'Physical memory has ' + m.frames + ' frames, and the inverted table one entry for each, saying which (pid, page) lives there. Process ' + m.q[0] + ' asks for page ' + m.q[1] + ', offset ' + M.hex(OFF, 12) + '.' + other(m) }];
    steps.push(...m.look.steps);
    const big = 16 * 2 ** 30 / PAGE;
    steps.push({ kind: 'size', ipt: sz.total, fwd, say: 'Size: the inverted table and its anchors take ' + sz.iptBytes + ' + ' + sz.anchorBytes + ' = ' + sz.total + ' bytes, against ' + M.bytes(fwd) + ' for a flat forward table in each of the ' + PIDS.length + ' processes. It grows with physical memory, not with the processes: 16 GiB of 4 KiB frames needs ' + M.bytes(big * 8) + '.' });
    return steps;
  }

  function frames(narrow, knobs) {
    const M = S.Mem, m = setup(knobs), T = m.T, steps = trace(knobs), q = m.q, look = m.look;
    const rh = narrow ? 26 : 29, top = narrow ? 186 : 70;
    // columns: the anchor table, then the inverted table (frame, pid, page, next)
    const A = narrow ? { x: 34, iw: 32, vw: 60 } : { x: 450, iw: 44, vw: 84 };
    const I = narrow ? { x: 164, cols: [44, 62, 62, 62] } : { x: 720, cols: [76, 96, 96, 96] };
    const iX = (c) => I.x + I.cols.slice(0, c).reduce((a, b) => a + b, 0), iW = iX(4) - I.x;
    const rowY = (k) => top + 32 + k * rh;
    const hashBox = narrow ? { x: 10, y: 56, w: 400, h: 50 } : { x: 20, y: 96, w: 330, h: 56 };
    const sizeY = narrow ? rowY(Math.max(m.frames, m.anchors)) + 26 : 330;
    const view = narrow ? box(0, -4, 420, sizeY + 206) : box(0, 0, 1180, rowY(16) + 24);
    const sz = T.size(), fwd = M.forwardBytes({ vaBits: VA_BITS, pageBytes: PAGE, pteBytes: 4, procs: PIDS.length });
    return steps.map((st, si) => {
      const items = [];
      const k = st.kind;
      const visited = [];
      for (let j = 1; j <= si; j++) if (steps[j].kind === 'compare') visited.push(steps[j].frame);
      const cur = k === 'compare' || k === 'frame' ? st.frame : -1;
      const found = (k === 'frame' || k === 'size') && look.ok ? look.frame : -1;
      const showChain = si >= 2 && k !== 'size';
      const chain = new Set(T.chain(look.slot));
      // ---- the question and the hash
      items.push({ key: 'q', kind: 'chip', x: narrow ? 210 : 185, y: narrow ? 26 : 50, text: 'pid ' + q[0] + ' · page ' + q[1] + ' · offset ' + M.hex(OFF, 12), size: 14, cls: 'mb-q ' + PCLS[q[0]], onWire: false });
      const hashed = si >= 1 && k !== 'setup';
      items.push({ key: 'hash', kind: 'cell', x: hashBox.x, y: hashBox.y, w: hashBox.w, h: hashBox.h, rx: 6, lines: ['hash = (page + 7 × pid) mod ' + m.anchors, hashed ? '(' + q[1] + ' + 7 × ' + q[0] + ') mod ' + m.anchors + ' = ' + look.slot : 'one anchor a hash value'], size: 13, cls: 'mb-reg' + (k === 'hash' ? ' act' : '') });
      // ---- the anchor table
      items.push({ key: 'ah', kind: 'cell', x: A.x, y: top, w: A.iw + A.vw, h: 28, rx: 4, text: 'anchors', size: 12, cls: 'mb-colh' });
      for (let s = 0; s < m.anchors; s++) {
        const y = rowY(s), on = s === look.slot && hashed;
        items.push({ key: 'ai' + s, kind: 'cell', x: A.x, y, w: A.iw, h: rh, rx: 0, text: String(s), size: 12, cls: 'mb-fno' + (on ? ' act' : '') });
        items.push({ key: 'av' + s, kind: 'cell', x: A.x + A.iw, y, w: A.vw, h: rh, rx: 0, text: T.anchor[s] < 0 ? '—' : '→ ' + T.anchor[s], size: 13, cls: 'mb-ent' + (T.anchor[s] < 0 ? ' nil' : '') + (on && k === 'anchor' ? ' act' : on ? ' seen' : '') });
      }
      // ---- the inverted table
      ['frame', 'pid', 'page', 'next'].forEach((h, c) => items.push({ key: 'ih' + c, kind: 'cell', x: iX(c), y: top, w: I.cols[c], h: 28, rx: c === 0 ? 4 : 0, text: h, size: 12, cls: 'mb-colh' }));
      for (let f = 0; f < m.frames; f++) {
        const e = T.entries[f], y = rowY(f);
        let st2 = '';
        if (f === found) st2 = ' good';
        else if (f === cur) st2 = ' act';
        else if (visited.includes(f)) st2 = ' seen';
        else if (showChain && chain.has(f)) st2 = ' chain';
        const bad = k === 'fault' && f === visited[visited.length - 1];
        items.push({ key: 'if' + f, kind: 'cell', x: iX(0), y, w: I.cols[0], h: rh, rx: 0, text: String(f), size: 12, cls: 'mb-fno' + (f === found ? ' good' : f === cur ? ' act' : '') });
        items.push({ key: 'ip' + f, kind: 'cell', x: iX(1), y, w: I.cols[1], h: rh, rx: 0, text: String(e.pid), size: 13, cls: 'mb-ent ' + (st2 ? st2 : PCLS[e.pid]) + (bad ? ' bad' : '') });
        items.push({ key: 'iv' + f, kind: 'cell', x: iX(2), y, w: I.cols[2], h: rh, rx: 0, text: String(e.vpn), size: 13, cls: 'mb-ent' + st2 + (bad ? ' bad' : '') });
        items.push({ key: 'in' + f, kind: 'cell', x: iX(3), y, w: I.cols[3], h: rh, rx: 0, text: e.next < 0 ? '—' : '→ ' + e.next, size: 13, cls: 'mb-ent' + (e.next < 0 ? ' nil' : '') + st2 + (bad ? ' bad' : '') });
      }
      // ---- the wire of this step: hash to anchor, anchor to the chain's head, or one link of the chain
      const mid = (r) => rowY(r) + rh / 2;
      if (k === 'hash') {
        const lane = narrow ? 18 : 400;
        const pts = narrow ? [[lane, hashBox.y + hashBox.h], [lane, mid(look.slot)], [A.x, mid(look.slot)]] : [[hashBox.x + hashBox.w, hashBox.y + hashBox.h / 2], [lane, hashBox.y + hashBox.h / 2], [lane, mid(look.slot)], [A.x, mid(look.slot)]];
        items.push({ key: 'w', kind: 'wire', pts, head: true, cls: 'act' });
      } else if (k === 'anchor' && st.frame >= 0) {
        const lane = narrow ? 148 : 650;
        items.push({ key: 'w', kind: 'wire', pts: [[A.x + A.iw + A.vw, mid(look.slot)], [lane, mid(look.slot)], [lane, mid(st.frame)], [I.x, mid(st.frame)]], head: true, cls: 'act' });
      } else if (k === 'compare' && visited.length > 1) {
        const from = visited[visited.length - 2], lane = iX(4) + (narrow ? 12 : 24);
        items.push({ key: 'w', kind: 'wire', pts: [[iX(4), mid(from) - 5], [lane, mid(from) - 5], [lane, mid(st.frame) + 5], [iX(4), mid(st.frame) + 5]], head: true, cls: 'act' });
      }
      // ---- the result and the sizes
      const resY = narrow ? 134 : 200;
      const res = k === 'frame' || (k === 'size' && look.ok) ? 'frame ' + look.frame + ' → physical address ' + M.hex(look.pa, 16) : k === 'fault' || (k === 'size' && !look.ok) ? 'page fault: not resident' : k === 'compare' ? (st.hit ? 'match in entry ' + st.frame : 'entry ' + st.frame + ': no match') : k === 'anchor' ? (st.frame < 0 ? 'empty anchor: page fault' : 'chain starts at entry ' + st.frame) : '';
      items.push({ key: 'res', kind: 'text', x: narrow ? 30 : 20, y: resY, text: res || ' ', size: narrow ? 14 : 16, cls: 'mb-big' + (k === 'fault' || (k === 'size' && !look.ok) || (k === 'anchor' && st.frame < 0) ? ' bad' : found >= 0 ? ' good' : '') });
      const acc = k === 'setup' || k === 'hash' ? 0 : k === 'anchor' ? 1 : k === 'compare' ? st.access : k === 'frame' ? st.accesses : look.accesses;
      items.push({ key: 'acc', kind: 'text', x: narrow ? 30 : 20, y: resY + (narrow ? 24 : 30), text: 'memory accesses: ' + acc, size: 13, cls: 'strong' });
      const sx = narrow ? 10 : 20, sw = narrow ? 400 : 330, on = k === 'size';
      items.push({ key: 'sz:t', kind: 'text', x: sx, y: sizeY, text: 'table size for this machine', size: 13, cls: 'title' });
      items.push({ key: 'sz:i', kind: 'cell', x: sx, y: sizeY + 12, w: sw, h: 50, rx: 6, lines: ['inverted: ' + m.frames + ' × 8 B + ' + m.anchors + ' × 4 B', '= ' + M.bytes(sz.total) + ', for all processes'], size: 13, cls: 'mb-reg' + (on ? ' good' : '') });
      items.push({ key: 'sz:f', kind: 'cell', x: sx, y: sizeY + 70, w: sw, h: 50, rx: 6, lines: ['forward, flat: 2²⁰ × 4 B a process', '× ' + PIDS.length + ' processes = ' + M.bytes(fwd)], size: 13, cls: 'mb-reg' + (on ? ' bad' : '') });
      items.push({ key: 'sz:n', kind: 'text', x: sx, y: sizeY + 144, text: VA_BITS + '-bit addresses, ' + PAGE / 1024 + ' KiB pages', size: 12, cls: 'tick' });
      const title = { setup: 'the table', hash: 'hash', anchor: 'anchor', compare: 'entry ' + st.frame, frame: 'frame', fault: 'page fault', size: 'size' }[k];
      return { items, say: st.say, view, title, i: si };
    });
  }

  const DEF = { frames: 2, anchors: 1, lookup: 0 };
  D.add({
    id: 'inverted-table', order: 60, tag: 'Memory · inverted tables', short: 'Inverted table', title: 'Looking up a page in an inverted page table',
    blurb: 'One entry a physical frame, found by hashing (pid, page) to an anchor and following the chain; the frame number is where the match sits. Change the frames, the anchors and the page asked for.',
    knobs: [
      { id: 'frames', label: 'Frames', type: 'select', value: DEF.frames, options: [8, 12, 16].map((n, i) => ({ value: i, label: String(n) })) },
      { id: 'anchors', label: 'Anchors', type: 'select', value: DEF.anchors, options: [4, 8, 16].map((n, i) => ({ value: i, label: String(n) })) },
      { id: 'lookup', label: 'Lookup', type: 'select', value: DEF.lookup, options: LOOKUPS.map((n, i) => ({ value: i, label: n })) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, Object.assign({}, DEF, knobs || {})); },
    trace: (knobs) => trace(Object.assign({}, DEF, knobs || {})),
  });
})(globalThis.Proses = globalThis.Proses || {});
