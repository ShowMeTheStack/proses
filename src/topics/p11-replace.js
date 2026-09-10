// Part 11, page replacement: one policy on a reference string, step by step, with the policy's own state drawn under
// the frames (the FIFO queue, the LRU order, OPT's next uses, the clock's ring and hand, the use and dirty bits, the
// counts, the aging registers, the NRU classes), and why each victim was chosen.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem, KM = () => S.Kit.mem, T = () => S.Kit.p11;
  const parseRefs = (xs) => xs.map((x) => { const m = /^(\d+)(w?)$/.exec(x); if (!m) throw new Error('reference "' + x + '": a page number, with w after it for a write'); return { page: +m[1], write: !!m[2] }; });
  const label = (r) => r.page + (r.write ? 'w' : '');
  /** an engine sentence of the replacement engine, reworded where it would read badly: "page 1 faults" reads as a count */
  const tidy = (say) => String(say).replace('; it must be written back; it is dirty, so it is written back first.', '; it is dirty, so it is written back first.')
    .replace(/^Reference (\d+): page (\d+)( \(a write\))? faults and goes/, 'Reference $1, page $2$3: a fault, and it goes').replace(/^Reference (\d+): page (\d+)( \(a write\))? faults;/, 'Reference $1, page $2$3: a fault;');
  S.P11R = { parseRefs, label, tidy };

  const RULE = {
    fifo: ['FIFO: evict the page loaded first', 'a hit changes nothing'],
    opt: ['OPT: evict the page used farthest ahead', '(never again is farthest); needs the future'],
    lru: ['LRU: evict the page used longest ago', 'a hit makes the page most recent'],
    clock: ['Clock: the hand sweeps the frames', 'use bit 1: clear it, move on; 0: evict'],
    second: ['Second chance: FIFO order, but a page', 'with use bit 1 goes to the back, bit cleared'],
    eclock: ['Enhanced clock: classes (use, dirty)', 'scan for (0,0); then for (0,1), clearing use bits'],
    lfu: ['LFU: evict the page used fewest times', 'since it was loaded; ties the oldest'],
    mfu: ['MFU: evict the page used most times', 'since it was loaded; ties the oldest'],
    aging: ['Aging: a register a page; every tick it shifts', 'right with the use bit in on top; evict the smallest'],
    nru: ['NRU: class = 2 × use + dirty, evict the lowest', 'use bits clear every few references'],
  };

  /** the state panel under the grid for one policy at one step (st null: before the first reference) */
  function statePanel(pol, st, nf, refs, i, y, o) {
    const items = [], frames = st ? st.frames : Array(nf).fill(null);
    const cls = (k) => (st && st.slot === k ? (st.hit ? 'good' : 'act') : st && st.cleared.includes(k) ? 'hot' : '');
    let tx = 0;
    if (pol === 'clock' || pol === 'eclock') {
      const R = o.R, cx = 10 + R + 50, cy = y + R + 68;
      items.push(...KM().ring({ prefix: 'ck', cx, cy, R, frames, use: st ? st.use : Array(nf).fill(0), hand: st ? st.hand : 0, act: st && !st.hit ? st.slot : st ? st.slot : -1, victim: -1, cleared: st ? st.cleared : [], boxW: 52, boxH: 42, size: 14 }).items);
      items.push(H.title('ckt', 0, y + 2, 'the hand and the use bits'));
      tx = cx + R + 110;
    }
    const cols = [{ name: 'frame', w: 54 }, { name: 'page', w: 54 }];
    const cell = [];
    const add = (name, w, f) => { cols.push({ name, w }); cell.push(f); };
    if (['clock', 'second', 'eclock', 'nru', 'aging'].includes(pol)) add('use', 48, (k) => (st ? st.use[k] : 0));
    if (['eclock', 'nru'].includes(pol)) { add('dirty', 52, (k) => (st ? st.dirty[k] : 0)); add('class', 56, (k) => (st ? 2 * st.use[k] + st.dirty[k] : 0)); }
    if (pol === 'lfu' || pol === 'mfu') add('count', 60, (k) => (st ? st.counts[k] : 0));
    if (pol === 'aging') add('register', 100, (k) => (st ? st.ages[k] : '0'.repeat(o.bits)));
    if (pol === 'opt') add('next use', 86, (k) => { if (frames[k] === null) return ''; let j = i + 1; while (j < refs.length && refs[j].page !== frames[k]) j++; return j < refs.length ? 'ref ' + (j + 1) : 'never'; });
    if (pol === 'fifo' || pol === 'second' || pol === 'lru') add(pol === 'lru' ? 'recency' : 'queue', 70, (k) => { const q = st && st.order ? st.order.indexOf(frames[k]) : -1; return q < 0 ? '' : pol === 'lru' ? (q === 0 ? 'oldest' : q === st.order.length - 1 ? 'newest' : String(q + 1)) : String(q + 1); });
    const rows = frames.map((p, k) => ({ key: 'f' + k, cls: cls(k), cells: ['f' + k, p === null ? '—' : p].concat(cell.map((f) => (p === null ? '' : f(k)))) }));
    items.push(...T().table({ prefix: 'ft', x: tx, y: y + 14, rowH: o.rowH, title: 'the frames', cols, rows, size: 14 }).items);
    if (st && st.order && (pol === 'fifo' || pol === 'second' || pol === 'lru')) {
      const tw = cols.reduce((a, c) => a + c.w, 0);
      items.push(...KM().row({ prefix: 'q', x: tx + tw + 40, y: y + 40, cw: 42, ch: 34, title: pol === 'lru' ? 'least recent → most recent' : 'loaded first → loaded last', cells: st.order.map((p) => ({ key: 'p' + p, text: String(p), cls: p === st.page ? 'act' : '' })), size: 14 }).items);
    }
    return items;
  }

  S.topic({
    id: 'vmem-replace', family: 'p11-replace', order: 10, title: 'One replacement policy, step by step',
    blurb: 'When a page faults and every frame is full, a resident page must go. Each policy keeps its own state to choose: FIFO a queue of load order, LRU the order of use, OPT a look at the future (the unbeatable yardstick), the clock one use bit a frame and a sweeping hand, enhanced clock the dirty bit too, LFU and MFU counts, aging a shift register, NRU four classes. Pick one, give it a reference string (w marks a write) and watch its state choose each victim.',
    inputs: [
      { id: 'policy', kind: 'choice', label: 'Policy', def: 'clock', options: M().policies.map((value) => ({ value, label: M().policyName(value) })) },
      { id: 'refs', kind: 'list', label: 'References (w = a write)', def: ['2', '5', '2', '8', '2', '6', '5', '2', '9', '8', '2', '5', '6', '2'], min: 1, max: 20, check: (v) => { try { parseRefs(v); return null; } catch (e) { return e.message; } } },
      { id: 'frames', kind: 'number', label: 'Frames', def: 3, min: 1, max: 6 },
      { id: 'bits', kind: 'number', label: 'Aging: register bits', def: 4, min: 2, max: 8 },
      { id: 'reset', kind: 'number', label: 'NRU: clear use bits every', def: 4, min: 1, max: 20 },
    ],
    presets: [
      { label: 'Clock, a hot page', values: {} },
      { label: 'LRU on a loop one page too big', values: { policy: 'lru', refs: ['1', '2', '3', '4', '1', '2', '3', '4', '1', '2', '3', '4'], frames: 3 } },
      { label: 'OPT on the same loop', values: { policy: 'opt', refs: ['1', '2', '3', '4', '1', '2', '3', '4', '1', '2', '3', '4'], frames: 3 } },
      { label: 'Enhanced clock with writes', values: { policy: 'eclock', refs: ['1w', '2', '3w', '4', '1', '5', '2w', '6', '3', '1', '4w', '2'], frames: 4 } },
      { label: 'LFU keeps an old favourite', values: { policy: 'lfu', refs: ['7', '7', '7', '7', '1', '2', '3', '1', '2', '3', '1', '2', '3'], frames: 3 } },
      { label: 'Aging with 4-bit registers', values: { policy: 'aging', refs: '1 2 3 1 4 1 2 5 1 2 4 3 5'.split(' '), frames: 3, bits: 4 } },
    ],
    counters: [{ id: 'faults', label: 'faults' }, { id: 'hits', label: 'hits' }, { id: 'wb', label: 'write-backs' }],
    run(inp) {
      const refs = parseRefs(inp.refs), n = refs.length, nf = inp.frames, pol = inp.policy;
      const run = M().replace(pol, refs, nf, { bits: inp.bits, reset: inp.reset });
      const F = new S.Frames(['faults', 'hits', 'wb']);
      const ch = nf > 4 ? 26 : 30, cw = Math.min(40, Math.floor(740 / n)), gy = 40, gridH = (nf + 2) * ch + 14;
      const outY = gy + gridH + 18, panelY = outY + 30;
      const ring = pol === 'clock' || pol === 'eclock', R = nf > 4 ? 66 : 56, rowH = nf > 4 ? 26 : 30;
      const panelH = Math.max(ring ? 2 * R + 136 : 0, 26 + 14 + nf * rowH + 10);
      const view = H.box(0, 0, 800, Math.max(480, panelY + panelH));
      const draw = (i, fin) => {
        const st = i >= 0 ? run.steps[i] : null, items = [];
        items.push(...KM().grid({ prefix: 'rg', x: 0, y: gy, cw, ch, labelW: 40, refs: refs.map(label), nFrames: nf, steps: run.steps, upto: i, cur: fin ? -1 : i, size: 14 }).items);
        items.push(H.text('outl', 32, outY + 4, 'out', 'tick', 12, 'end'));
        for (let j = 0; j <= i; j++) { const v = run.steps[j].victim; if (v !== null) items.push(H.text('out' + j, 40 + j * cw + cw / 2, outY + 4, String(v), run.steps[j].writeBack ? 'bad' : 'hot', 13, 'middle')); }
        items.push(...statePanel(pol, st, nf, refs, i, panelY, { R, rowH, bits: inp.bits }));
        const f = st ? st.faults : 0;
        items.push(H.text('sum', 0, 22, M().policyName(pol) + ', ' + H.plural(nf, 'frame') + ': ' + H.plural(f, 'fault') + (fin ? ' in all' : ' so far'), 'p10-sum' + (fin ? ' bad' : ''), 15));
        items.push(H.text('rule', 800, 22, RULE[pol][0], 'tick', 12, 'end'));
        return items;
      };
      F.add({ items: draw(-1), say: `${M().policyName(pol)} starts with ${H.plural(nf, 'empty frame')} and ${n} references: ${RULE[pol][0]}, ${RULE[pol][1]}.`, meta: { phase: 'start', n, nf, bits: inp.bits, reset: inp.reset }, view, hl: { d: [0, 1] } });
      run.steps.forEach((st, i) => {
        F.set('faults', st.faults).set('hits', st.hits).set('wb', st.writeBacks);
        const next = run.steps[i + 1];
        F.add({ items: draw(i), say: S.P11R.tidy(st.say), meta: { phase: st.hit ? 'hit' : st.free ? 'fill' : 'evict', i, n: i + 1, st, nextVictimSlot: next && next.victim !== null ? next.victimSlot : -1, bits: inp.bits }, view, hl: { d: st.hit ? [1] : st.free ? [2] : [0, 1] } });
      });
      const cmp = { opt: M().replace('opt', refs, nf).faults, lru: M().replace('lru', refs, nf).faults, fifo: M().replace('fifo', refs, nf).faults };
      F.add({ items: draw(n - 1, true), say: `${M().policyName(pol)}: ${H.plural(run.faults, 'fault')} and ${H.plural(run.hits, 'hit')} in ${n} references` + (run.writeBacks ? `, with ${H.plural(run.writeBacks, 'dirty victim')} written back` : '') + `. On the same string OPT makes ${H.plural(cmp.opt, 'fault')}, LRU ${cmp.lru} and FIFO ${cmp.fifo}.`, meta: { phase: 'end', faults: run.faults, hits: run.hits, wb: run.writeBacks, cmp, n }, view });
      return { frames: F.list, def: H.def(M().policyName(pol), [RULE[pol][0], RULE[pol][1], 'empty frames are filled first, in order', 'a write sets the page\'s dirty bit; a dirty victim is written back']) };
    },
    predict: [
      { at: (f) => f.meta.nextVictimSlot >= 0, pick: 'item', ask: (fr, i) => `The next reference, page ${fr[i + 1].meta.st.page}, faults. Click the page the policy will evict, in the current column.`, answer: (fr, i) => 'rg:c' + fr[i].meta.i + '_' + fr[i].meta.nextVictimSlot, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Which policy can no real kernel run exactly?', options: ['OPT', 'FIFO', 'LRU', 'clock'], answer: 0, why: 'OPT needs to know the future references; it serves as the yardstick.' },
      { q: 'The clock\'s hand reaches a frame whose use bit is 1. What does it do?', options: ['clears the bit and moves on', 'evicts the page', 'sets the dirty bit', 'stops the sweep'], answer: 0, why: 'A set use bit buys the page a second chance.' },
      { q: 'Why does enhanced clock prefer a (use 0, dirty 0) page to a (use 0, dirty 1) one?', options: ['a clean page need not be written back', 'dirty pages are newer', 'it has fewer bits set', 'dirty pages are locked'], answer: 0, why: 'Evicting a dirty page costs a disk write first.' },
      { q: 'An 8-bit aging register reads 00000000 for page A and 10000000 for page B. Which goes first?', options: ['A', 'B', 'neither: a tie', 'whichever was loaded first'], answer: 0, why: 'B was used in the last tick; A not in the last eight.' },
      { q: 'LFU keeps a page that was used heavily long ago. What is the weakness?', options: ['old counts never fade, so stale favourites stay', 'it evicts the newest page', 'it needs the future', 'it ignores hits'], answer: 0, why: 'Counts since loading keep a once-busy page resident after its phase is over.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
