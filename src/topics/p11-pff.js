// Part 11, page-fault-frequency control: a process runs LRU within its frames; after every interval its fault rate
// is compared with two bounds, and it gains a frame above the upper bound and gives one up below the lower.
(function (S) {
  'use strict';
  const H = S.P10, V = () => S.VM, C = () => S.Kit.curve;

  S.topic({
    id: 'vmem-pff', family: 'p11-frames', order: 50, title: 'Page-fault frequency',
    blurb: 'The working set is costly to track exactly, but its effect is easy to measure: the fault rate. Page-fault-frequency control sets an upper and a lower bound. When a process faults more often than the upper bound it is short of frames and gets another; when it faults less often than the lower bound it has more than it needs and gives one back. Its allocation follows its locality.',
    inputs: [
      { id: 'refs', kind: 'list', label: 'References', min: 4, max: 40, def: '1 2 1 3 2 1 3 2 1 3 5 6 7 5 6 7 8 5 6 7 8 5 6 7 1 2 1 2 1 2'.split(' '), check: (v) => { for (const x of v) if (!/^\d{1,2}$/.test(x)) return 'References: page numbers 0 to 99 ("' + x + '")'; return null; } },
      { id: 'interval', kind: 'number', label: 'Interval (references)', def: 5, min: 2, max: 10 },
      { id: 'lower', kind: 'number', label: 'Lower bound', def: 0.2, min: 0, max: 1, integer: false },
      { id: 'upper', kind: 'number', label: 'Upper bound', def: 0.5, min: 0, max: 1, integer: false },
      { id: 'frames', kind: 'number', label: 'Frames at the start', def: 2, min: 1, max: 8 },
      { id: 'max', kind: 'number', label: 'At most', def: 6, min: 1, max: 8 },
    ],
    check(inp) {
      if (inp.lower >= inp.upper) return 'Lower bound: below the upper bound';
      if (inp.frames > inp.max) return 'Frames at the start: no more than "At most"';
      return null;
    },
    presets: [
      { label: 'Three localities', values: {} },
      { label: 'A tight band: 0.3 to 0.4', values: { lower: 0.3, upper: 0.4 } },
      { label: 'Short intervals of 3', values: { interval: 3 } },
      { label: 'Starts with too many frames', values: { frames: 6, refs: '1 2 1 2 1 2 1 2 1 2 1 2 1 2 1 2 1 2 1 2'.split(' ') } },
      { label: 'A growing loop', values: { refs: '1 2 1 2 1 2 1 2 3 1 2 3 1 2 3 4 1 2 3 4 1 2 3 4 5 4 3 2 1 5 4 3 2 1'.split(' '), max: 8 } },
    ],
    counters: [{ id: 'faults', label: 'faults' }, { id: 'frames', label: 'frames' }],
    run(inp) {
      const refs = inp.refs.map(Number), N = refs.length, I = inp.interval;
      const r = V().pff({ refs, frames: inp.frames, lower: inp.lower, upper: inp.upper, interval: I, min: 1, max: inp.max });
      const FR = new S.Frames(['faults', 'frames']), view = H.box(0, 0, 790, 476);
      const x0 = 58, cw = Math.min(30, Math.floor(660 / N)), ry = 48, ch = 28;
      const refSteps = r.steps.filter((s) => s.kind === 'ref'), adj = r.steps.filter((s) => s.kind === 'adjust');
      const rax = C().axes({ prefix: 'ra', x: x0, y: 214, w: N * cw, h: 92, xr: [0, N], yr: [0, 1], xticks: 0, yticks: [0, 0.5, 1], yname: 'fault rate per interval', tickSize: 12 });
      const fax = C().axes({ prefix: 'fa', x: x0, y: 360, w: N * cw, h: 84, xr: [0, N], yr: [0, inp.max], xticks: 0, yticks: inp.max > 4 ? 2 : 1, yname: 'frames allocated', tickSize: 12 });
      const draw = (t, adjK, fin) => {
        const items = [H.text('rl', x0 - 6, ry + 19, 'ref', 'tick', 12, 'end')];
        refs.forEach((p, j) => {
          const st = refSteps[j], seen = j <= t;
          items.push(H.cell('r' + j, x0 + j * cw, ry, cw, ch, String(p), 'p11-ref' + (j === t && adjK < 0 && !fin ? ' act' : !seen ? ' dim' : '') + (seen && !st.hit ? ' fault' : ''), 13, { rx: 0 }));
          if (seen) items.push(H.text('m' + j, x0 + j * cw + cw / 2, ry + ch + 16, st.hit ? '✓' : 'F', st.hit ? 'good' : 'bad', 12, 'middle'));
        });
        for (let k = 1; k * I < N; k++) items.push({ key: 'iv' + k, kind: 'line', x1: x0 + k * I * cw, y1: ry - 6, x2: x0 + k * I * cw, y2: ry + ch + 22, cls: 'faint', audit: 'ignore' });
        // the resident pages
        const st = t >= 0 ? (adjK >= 0 ? adj[adjK] : refSteps[t]) : null, fr = st ? st.frames : inp.frames, res = st ? st.resident : [];
        items.push(H.text('rsl', x0 - 6, 128 + 19, 'frames', 'tick', 12, 'end'));
        for (let k = 0; k < inp.max; k++) {
          const on = k < fr, p = res[k];
          items.push(H.cell('s' + k, x0 + k * 46, 128, 40, 30, p === undefined || !on ? '' : String(p), 'p11-slot' + (on ? (p === undefined ? ' empty' : '') : ' off') + (st && adjK < 0 && on && p === st.page ? (st.hit ? ' hit' : ' in') : ''), 14, { rx: 3 }));
        }
        items.push(H.text('rsn', x0 + inp.max * 46 + 10, 148, fr + ' of at most ' + inp.max, 'p10-sum', 14));
        // the rates, and the band
        items.push(...rax.items, C().hline(rax, 'up', inp.upper, ''), C().hline(rax, 'lo', inp.lower, ''));
        const gap = Math.max(0, 15 - (rax.Y(inp.lower) - rax.Y(inp.upper))) / 2;
        items.push(H.text('upl', x0 + N * cw + 6, rax.Y(inp.upper) + 4 - gap, 'upper ' + inp.upper, 'tick', 12), H.text('lol', x0 + N * cw + 6, rax.Y(inp.lower) + 4 + gap, 'lower ' + inp.lower, 'tick', 12));
        adj.forEach((a, k) => {
          if (!fin && !(a.t < t || k <= adjK)) return;
          const xa = x0 + (a.t + 1 - I) * cw + 3, w = I * cw - 6;
          items.push(H.cell('rb' + k, xa, rax.Y(a.rate), w, Math.max(1, rax.Y(0) - rax.Y(a.rate)), '', 'p11-bar' + (a.rate > inp.upper ? ' over' : a.rate < inp.lower ? ' under' : '') + (k === adjK && !fin ? ' cur' : ''), 12, { rx: 0 }));
        });
        items.push(...fax.items);
        const upto = fin ? N - 1 : t;
        if (upto >= 0) { const pts = []; for (let j = 0; j <= upto; j++) { pts.push([j, r.framesOver[j]]); pts.push([j + 1, r.framesOver[j]]); } items.push(C().line(fax, 'fl', [[0, inp.frames]].concat(pts), 'p11-step')); }
        return items;
      };
      FR.set('frames', inp.frames);
      FR.add({ items: draw(-1, -1, false), say: `The process starts with ${H.plural(inp.frames, 'frame')}. Every ${I} references its fault rate is checked against the band from ${inp.lower} to ${inp.upper}.`, meta: { phase: 'start', frames: inp.frames, interval: I, lower: inp.lower, upper: inp.upper }, view, hl: { d: [0] } });
      let k = -1;
      r.steps.forEach((st) => {
        if (st.kind === 'ref') {
          if (!st.hit) FR.count('faults');
          FR.add({ items: draw(st.t, -1, false), say: 't = ' + (st.t + 1) + ': ' + (st.hit ? 'page ' + st.page + ' is resident.' : 'a fault on page ' + st.page + (st.victim !== null ? '; it replaces page ' + st.victim + ', the least recently used.' : ', which takes a free frame.')), meta: { phase: 'ref', t: st.t + 1, page: st.page, hit: st.hit, victim: st.victim, frames: st.frames }, view, hl: { d: [] } });
        } else {
          k++;
          FR.set('frames', st.frames);
          const prev = k ? adj[k - 1].frames : inp.frames;
          FR.add({ items: draw(st.t, k, false), say: st.say, meta: { phase: 'adjust', t: st.t + 1, rate: st.rate, faultsIn: Math.round(st.rate * I), frames: st.frames, prev, change: st.frames - prev, interval: I, lower: inp.lower, upper: inp.upper }, view, hl: { d: st.frames > prev ? [1] : st.frames < prev ? [2] : [3] } });
        }
      });
      FR.add({ items: draw(N - 1, -1, true), say: r.say + ` The allocation ranged from ${Math.min(...r.framesOver, inp.frames)} to ${Math.max(...r.framesOver, inp.frames)} frames as the locality changed.`, meta: { phase: 'end', faults: r.faults, final: r.framesOver[N - 1], lo: Math.min(...r.framesOver, inp.frames), hi: Math.max(...r.framesOver, inp.frames) }, view, hl: { d: [0, 1, 2] } });
      return { frames: FR.list, def: H.def('Page-fault frequency', ['rate = faults in the interval / its length', 'rate > upper: give the process a frame', 'rate < lower: take a frame (its LRU page goes)', 'in between: leave it', 'no frame to give: suspend a process']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'adjust', once: true, pick: 'option', ask: (fr, i) => `The interval ends here with ${H.plural(fr[i + 1].meta.faultsIn, 'fault')} in ${fr[i + 1].meta.interval} references. What happens to the allocation?`, options: ['one more frame', 'one frame fewer', 'no change'], answer: (fr, i) => { const m = fr[i + 1].meta; return m.change > 0 ? 'one more frame' : m.change < 0 ? 'one frame fewer' : 'no change'; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A process faults 6 times in an interval of 10 references; the band is 0.2 to 0.5. PFF…', options: ['gives it a frame', 'takes a frame', 'does nothing', 'suspends it'], answer: 0, why: '0.6 is above the upper bound.' },
      { q: 'Same band, 1 fault in 10?', options: ['takes a frame', 'gives a frame', 'does nothing', 'flushes its pages'], answer: 0, why: '0.1 is below the lower bound: it has frames to spare.' },
      { q: 'What does PFF do when a process needs a frame and none is free?', options: ['suspends some process to free frames', 'gives it a frame anyway', 'ignores the rate', 'lowers the upper bound'], answer: 0, why: 'Granting frames that do not exist would be thrashing by another name.' },
      { q: 'PFF measures the fault rate rather than the working set because…', options: ['it is cheap to count faults', 'the working set cannot be defined', 'faults never change', 'it needs no bounds'], answer: 0, why: 'A counter per process suffices; tracking the window exactly needs reference times for every page.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
