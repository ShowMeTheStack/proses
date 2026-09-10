// Part 11, frames among processes. How many frames each process gets (equal shares, in proportion to size, or to
// size × priority, floored with the frames left going to the largest remainders), and global against local
// replacement: processes taking turns, a fault taking a free frame, or a victim from anyone (global) or only from
// the process's own frames (local).
(function (S) {
  'use strict';
  const H = S.P10, V = () => S.VM;

  /** "A:10:1" -> {name, size, priority} */
  const parseProcs = (xs) => xs.map((x) => { const [name, size, pr] = String(x).split(':'); return { name, size: Number(size), priority: pr === undefined ? 1 : Number(pr) }; });
  const procCheck = (v) => {
    if (v.length < 2 || v.length > 5) return 'Processes: two to five, each written name:size or name:size:priority';
    const seen = new Set();
    for (const x of v) {
      const m = /^([A-Za-z][A-Za-z0-9]{0,5}):(\d{1,4})(?::(\d{1,2}))?$/.exec(x);
      if (!m) return 'Processes: "' + x + '" is not name:size or name:size:priority (P1:40:2)';
      if (+m[2] < 1) return 'Processes: ' + m[1] + ' needs a size of at least 1 page';
      if (m[3] !== undefined && +m[3] < 1) return 'Processes: a priority of at least 1';
      if (seen.has(m[1])) return 'Processes: two are called ' + m[1];
      seen.add(m[1]);
    }
    return null;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Frame allocation
  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'vmem-frame-alloc', family: 'p11-frames', order: 10, title: 'Sharing out the frames',
    blurb: 'Before any page is replaced, the kernel decides how many frames each process may hold. Equal allocation gives every process the same number, whatever its size. Proportional allocation gives each process its share of the total size, and a priority can weight that share. Shares are rarely whole numbers: each is rounded down, every process keeps a minimum it cannot run without, and the frames left over go one each to the largest remainders.',
    inputs: [
      { id: 'frames', kind: 'number', label: 'Frames', def: 62, min: 2, max: 400 },
      { id: 'scheme', kind: 'choice', label: 'Scheme', def: 'proportional', options: [{ value: 'equal', label: 'equal' }, { value: 'proportional', label: 'proportional to size' }, { value: 'priority', label: 'size × priority' }] },
      { id: 'procs', kind: 'list', label: 'Processes (name:size[:priority])', def: ['P1:10', 'P2:127', 'P3:45'], check: procCheck },
      { id: 'min', kind: 'number', label: 'Minimum each', def: 2, min: 0, max: 20 },
    ],
    check(inp) { const n = inp.procs.length; if (inp.scheme !== 'equal' && inp.min * n > inp.frames) return 'Minimum each: ' + n + ' processes × ' + inp.min + ' is more than the ' + inp.frames + ' frames'; return null; },
    presets: [
      { label: 'A small and a large process, proportional', values: {} },
      { label: 'The same, equal shares', values: { scheme: 'equal' } },
      { label: 'Priority doubles P1\'s weight', values: { scheme: 'priority', procs: ['P1:10:2', 'P2:127:1', 'P3:45:1'] } },
      { label: 'The minimum takes frames back', values: { frames: 20, procs: ['P1:2', 'P2:3', 'P3:150'], min: 4 } },
      { label: 'Four processes, 100 frames', values: { frames: 100, procs: ['ed:30', 'db:210', 'web:90', 'cc:70'], min: 3 } },
    ],
    counters: [{ id: 'given', label: 'frames given' }, { id: 'spare', label: 'frames spare' }],
    run(inp) {
      const P = parseProcs(inp.procs), F = inp.frames, sch = inp.scheme, n = P.length;
      const r = V().allocFrames({ frames: F, procs: P, scheme: sch, min: inp.min });
      const w = P.map((p) => (sch === 'priority' ? p.size * p.priority : sch === 'equal' ? 1 : p.size)), W = w.reduce((a, b) => a + b, 0);
      const fl = r.alloc.map((a) => Math.floor(a.exact)), fin = r.alloc.map((a) => a.frames);
      const maxV = Math.max(...r.alloc.map((a) => a.exact), ...fin, 1);
      const X0 = 230, BW = 380, rowH = Math.min(62, Math.floor(300 / n)), y0 = 80;
      const FR = new S.Frames(['given', 'spare']), view = H.box(0, 0, 780, y0 + n * rowH + 86);
      const head = [H.text('hdr', 4, 22, F + ' frames among ' + H.plural(n, 'process', 'processes') + ', ' + (sch === 'equal' ? 'equal shares' : sch === 'priority' ? 'in proportion to size × priority' : 'in proportion to size') + (sch !== 'equal' ? ', at least ' + inp.min + ' each' : ''), 'p10-sum', 15)];
      // stage: 'procs' | 'weights' | 'exact' | 'floor' | 'final'
      const draw = (stage, actRow) => {
        const items = head.slice();
        items.push(H.text('c:name', 4, y0 - 16, 'process', 'tick', 12), H.text('c:w', 150, y0 - 16, sch === 'priority' ? 'size × pri' : sch === 'equal' ? 'weight' : 'size', 'tick', 12, 'end'));
        items.push(H.text('c:bar', X0, y0 - 16, stage === 'procs' || stage === 'weights' ? 'its weight' : 'exact share and frames given', 'tick', 12));
        items.push(H.text('c:f', 776, y0 - 16, 'frames', 'tick', 12, 'end'));
        P.forEach((p, j) => {
          const y = y0 + j * rowH, bh = Math.min(30, rowH - 14);
          items.push(H.text('n' + j, 4, y + bh / 2 + 5, p.name, H.pc(j), 15));
          items.push(H.text('w' + j, 150, y + bh / 2 + 5, sch === 'priority' ? p.size + ' × ' + p.priority : String(w[j]), 'mono', 13, 'end'));
          if (stage === 'procs' || stage === 'weights') {
            const ww = Math.max(2, (w[j] / Math.max(...w)) * BW);
            items.push(H.cell('b' + j, X0, y, ww, bh, '', 'p10-run ' + H.pc(j) + (actRow === j ? ' act' : '')));
            if (stage === 'weights') items.push(H.text('v' + j, 776, y + bh / 2 + 5, w[j] + ' / ' + W, 'mono', 13, 'end'));
            return;
          }
          const ex = r.alloc[j].exact, give = stage === 'floor' ? fl[j] : fin[j];
          items.push(H.cell('b' + j, X0, y, Math.max(2, (give / maxV) * BW), bh, '', 'p10-run ' + H.pc(j) + (actRow === j ? ' act' : '')));
          if (stage !== 'final' || sch !== 'equal') items.push({ key: 'x' + j, kind: 'line', x1: Math.round(X0 + (ex / maxV) * BW), y1: y - 4, x2: Math.round(X0 + (ex / maxV) * BW), y2: y + bh + 4, cls: 'p10-mark', audit: 'ignore', layer: 'top' });
          items.push(H.text('e' + j, X0 + BW + 12, y + bh / 2 + 5, H.f(ex, 2), 'tick mono', 12));
          const diff = fin[j] - fl[j];
          items.push(H.text('v' + j, 776, y + bh / 2 + 5, stage === 'floor' ? String(fl[j]) : String(fin[j]) + (sch !== 'equal' && diff ? ' (' + (diff > 0 ? '+' : '−') + Math.abs(diff) + ')' : ''), 'p10-sum' + (stage === 'final' && diff > 0 ? ' good' : stage === 'final' && diff < 0 ? ' bad' : ''), 15, 'end'));
        });
        // the frames themselves, coloured by owner
        const yb = y0 + n * rowH + 22;
        const given = stage === 'final' ? fin : stage === 'floor' ? fl : null;
        if (given) {
          let at = 0;
          const runs = [];
          given.forEach((g, j) => { if (g > 0) runs.push({ key: 'r' + j, start: at, size: g, cls: H.pc(j), text: P[j].name }); at += g; });
          if (at < F) runs.push({ key: 'spare', start: at, size: F - at, cls: 'free', text: 'spare' });
          items.push(...S.Kit.p10.hbar({ prefix: 'fb', x: 10, y: yb, w: 740, h: 34, total: F, runs, ticks: [0, F], size: 13 }).items);
          items.push(H.text('fbl', 4, yb - 10, 'the ' + F + ' frames', 'tick', 12));
        }
        return items;
      };
      const meta0 = { names: P.map((p) => p.name), min0: inp.min, F, n, W, w, exact: r.alloc.map((a) => a.exact), floor: fl, final: fin, spare: r.spare };
      FR.add({ items: draw('procs'), say: `${F} frames to share among ${H.list(P.map((p) => p.name + ' (' + p.size + ' pages' + (sch === 'priority' ? ', priority ' + p.priority : '') + ')'))}.` + (sch === 'equal' ? ' Equal allocation ignores the sizes.' : ' The larger a process, the more frames it is likely to use.'), meta: Object.assign({ phase: 'procs', sizes: P.map((p) => p.size), pri: P.map((p) => p.priority) }, meta0), view, hl: { d: [sch === 'equal' ? 0 : sch === 'priority' ? 2 : 1] } });
      if (sch === 'equal') {
        const each = fin[0];
        FR.set('given', F - r.spare).set('spare', r.spare);
        FR.add({ items: draw('final'), say: r.say + ` ${F} / ${n} = ${H.f(F / n, 2)}, rounded down to ${each}` + (r.spare ? `; the ${H.plural(r.spare, 'frame')} left over can serve as a free pool for faults.` : '.') + ` ${P.reduce((a, p) => (p.size < a.size ? p : a)).name}, the smallest, gets as many as ${P.reduce((a, p) => (p.size > a.size ? p : a)).name}, the largest.`, meta: Object.assign({ phase: 'final', each, ratio: F / n }, meta0), view, hl: { d: [0] } });
      } else {
        FR.add({ items: draw('weights'), say: `Each weight is ${sch === 'priority' ? 'size × priority' : 'the size'}: ${H.list(P.map((p, j) => p.name + ' ' + w[j]))}, ${W} in all.`, meta: Object.assign({ phase: 'weights' }, meta0), view, hl: { d: [sch === 'priority' ? 2 : 1] } });
        FR.add({ items: draw('exact'), say: `The exact shares, weight / ${W} × ${F}: ${H.list(P.map((p, j) => p.name + ' ' + H.f(r.alloc[j].exact, 2)))}. Nobody can have part of a frame.`, meta: Object.assign({ phase: 'exact' }, meta0), view, hl: { d: [1] } });
        const sumFl = fl.reduce((a, b) => a + b, 0);
        FR.set('given', sumFl).set('spare', F - sumFl);
        FR.add({ items: draw('floor'), say: `Rounded down: ${H.list(P.map((p, j) => p.name + ' ' + fl[j]))}, ${sumFl} of ${F}, so ${H.plural(F - sumFl, 'frame')} ${F - sumFl === 1 ? 'is' : 'are'} still to give.`, meta: Object.assign({ phase: 'floor', sumFl, left: F - sumFl }, meta0), view, hl: { d: [3] } });
        const up = P.map((p, j) => [j, fin[j] - fl[j]]).filter((x) => x[1] > 0), down = P.map((p, j) => [j, fin[j] - fl[j]]).filter((x) => x[1] < 0);
        const minHit = P.map((p, j) => j).filter((j) => fl[j] < inp.min);
        FR.set('given', F).set('spare', 0);
        FR.add({ items: draw('final', up.length ? up[0][0] : -1), say: (minHit.length ? `${H.list(minHit.map((j) => P[j].name))} ${minHit.length === 1 ? 'is' : 'are'} raised to the minimum of ${inp.min}` + (down.length ? `, paid for by ${H.list(down.map(([j, d]) => P[j].name + ' (' + d + ')'))}` : '') + '. ' : '') + (up.filter(([j]) => !minHit.includes(j)).length ? `The frames left go to the largest remainders: ${H.list(up.filter(([j]) => !minHit.includes(j)).map(([j, d]) => P[j].name + ' (' + H.f(r.alloc[j].exact - fl[j], 2) + ') +' + d))}. ` : '') + `Final: ${H.list(P.map((p, j) => p.name + ' ' + fin[j]))}, all ${F} frames.`, meta: Object.assign({ phase: 'final', rem: r.alloc.map((a, j) => a.exact - fl[j]), up: up.map((x) => x[1]), down: down.map((x) => x[1]), min: inp.min }, meta0), view, hl: { d: [3, 4] } });
      }
      return { frames: FR.list, def: H.def('Sharing out m frames', ['equal: ⌊m / n⌋ each', 'proportional: aᵢ = sᵢ / S × m', 'priority: weight sᵢ × priorityᵢ', 'round each share down, keep the minimum', 'leftovers: largest remainders first']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'procs', pick: 'option', ask: 'Which process will end up with the most frames?', options: (fr) => fr[0].meta.names, answer: (fr) => { const f = fr[0].meta.final, m = Math.max(...f); return f.filter((x) => x === m).length > 1 ? null : fr[0].meta.names[f.indexOf(m)]; }, explain: (fr) => fr[fr.length - 1].say },
      { at: (f) => f.meta.phase === 'floor' && f.meta.left > 0, pick: 'option', ask: 'Which process gets the first leftover frame?', options: (fr, i) => fr[i].meta.names, answer: (fr, i) => { const m = fr[i].meta, rem = m.exact.map((e, j) => e - m.floor[j]); let best = 0; rem.forEach((x, j) => { if (x > rem[best]) best = j; }); return m.final[best] > m.floor[best] && m.floor[best] >= m.min0 ? m.names[best] : null; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: '93 frames, two processes of 10 and 300 pages, proportional. About how many does the small one get?', options: ['3', '46', '10', '31'], answer: 0, why: '10 / 310 × 93 = 3.' },
      { q: 'Same frames, equal allocation?', options: ['46 each, 1 spare', '47 and 46', '3 and 90', '93 each'], answer: 0, why: '⌊93 / 2⌋ = 46, and 1 is left.' },
      { q: 'Why does every process need a minimum number of frames?', options: ['one instruction may touch several pages, and all must be resident for it to finish', 'the TLB needs them', 'the disk is faster that way', 'to keep the shares whole numbers'], answer: 0, why: 'An instruction that reads and writes across page boundaries cannot complete with fewer frames than pages it touches.' },
      { q: 'Proportional shares are 4.7, 3.6 and 1.7 of 10 frames. Who gets the frames left after rounding down?', options: ['the 4.7 and the 1.7 (remainders 0.7)', 'the largest process only', 'the smallest process', 'nobody: they stay spare'], answer: 0, why: '4 + 3 + 1 = 8; the two largest remainders, 0.7 and 0.7, each get one.' },
      { q: 'With priority weighting, a process of 20 pages and priority 3 weighs as much as…', options: ['a process of 60 pages and priority 1', 'a process of 23 pages', 'a process of 20 pages', 'nothing: priority is ignored'], answer: 0, why: 'Its weight is 20 × 3 = 60.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Global against local replacement
  // ---------------------------------------------------------------------------------------------------------------
  const refList = (label) => ({ kind: 'list', label, min: 1, max: 12, check: (v) => { for (const x of v) if (!/^\d{1,2}$/.test(x)) return label + ': page numbers 0 to 99 ("' + x + '")'; return null; } });
  S.topic({
    id: 'vmem-global-local', family: 'p11-frames', order: 20, title: 'Global against local replacement',
    blurb: 'When a process faults and no frame is free, whose page goes? Global replacement picks the victim among all frames, so a busy process can take frames from a quiet one and grow. Local replacement picks only among the faulting process\'s own frames, so each keeps its quota and its fault rate depends on its own behaviour alone. Here the processes take turns, and every frame shows whose page it holds.',
    inputs: [
      Object.assign({ id: 'a', def: ['1', '2', '3', '1', '2', '4', '1', '5', '2', '6', '1', '7'] }, refList('A refs')),
      Object.assign({ id: 'b', def: ['1', '2', '1', '2', '1', '2', '1', '2'] }, refList('B refs')),
      { id: 'frames', kind: 'number', label: 'Frames', def: 6, min: 2, max: 10 },
      { id: 'mode', kind: 'choice', label: 'Replacement', def: 'global', options: [{ value: 'global', label: 'global' }, { value: 'local', label: 'local (equal quotas)' }] },
      { id: 'policy', kind: 'choice', label: 'Victim', def: 'lru', options: [{ value: 'lru', label: 'LRU' }, { value: 'fifo', label: 'FIFO' }] },
      { id: 'quantum', kind: 'number', label: 'Turn (references)', def: 2, min: 1, max: 6 },
    ],
    presets: [
      { label: 'A busy process and a quiet one, global', values: {} },
      { label: 'The same, local', values: { mode: 'local' } },
      { label: 'Global with FIFO: B loses its pages', values: { policy: 'fifo', a: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], b: ['1', '2', '1', '2', '1', '2', '1', '2', '1', '2'] } },
      { label: 'Two equal loops, four frames, local', values: { frames: 4, mode: 'local', a: ['1', '2', '1', '2', '1', '2', '1', '2'], b: ['5', '6', '5', '6', '5', '6', '5', '6'] } },
      { label: 'Two equal loops, four frames, global', values: { frames: 4, a: ['1', '2', '1', '2', '1', '2', '1', '2'], b: ['5', '6', '5', '6', '5', '6', '5', '6'] } },
    ],
    counters: [{ id: 'fa', label: 'faults of A' }, { id: 'fb', label: 'faults of B' }],
    run(inp) {
      const procs = [{ name: 'A', refs: inp.a.map(Number) }, { name: 'B', refs: inp.b.map(Number) }];
      const r = V().globalLocal({ procs, frames: inp.frames, mode: inp.mode, policy: inp.policy, quantum: inp.quantum });
      const other = V().globalLocal({ procs, frames: inp.frames, mode: inp.mode === 'global' ? 'local' : 'global', policy: inp.policy, quantum: inp.quantum });
      const quota = V().allocFrames({ frames: inp.frames, procs: procs.map((p) => ({ name: p.name, size: 1 })), scheme: 'equal' }).alloc.map((a) => a.frames);
      const N = r.steps.length, Fn = inp.frames, FR = new S.Frames(['fa', 'fb']), view = H.box(0, 0, 790, 480);
      const lw = 34, cw = Math.min(34, Math.floor((780 - lw) / N)), ch = Math.min(30, Math.floor(250 / (Fn + 1))), gx = lw, gy = 56;
      const draw = (upto) => {
        const items = [H.text('hdr', 4, 20, (inp.mode === 'global' ? 'global' : 'local, ' + quota[0] + ' frames each') + ' · ' + (inp.policy === 'lru' ? 'LRU' : 'FIFO') + ' victim · turns of ' + inp.quantum, 'p10-sum', 15)];
        items.push(H.text('rl', gx - 6, gy + ch / 2 + 5, 'ref', 'tick', 12, 'end'));
        r.steps.forEach((st, j) => {
          items.push(H.cell('r' + j, gx + j * cw, gy, cw, ch, (st.proc ? 'B' : 'A') + st.page, 'p11-ref ' + H.pc(st.proc) + (j === upto ? ' act' : j > upto ? ' dim' : ''), 12, { rx: 0 }));
          if (j > upto) return;
          st.frames.forEach((f, k) => {
            const isIn = k === st.frame && !st.hit, isHit = k === st.frame && st.hit;
            items.push(H.cell('c' + j + '_' + k, gx + j * cw, gy + ch + 6 + k * ch, cw, ch, f.proc < 0 ? '' : String(f.page), 'p11-slot ' + (f.proc < 0 ? 'empty' : H.pc(f.proc)) + (isIn ? ' in' : isHit ? ' hit' : ''), 13, { rx: 0 }));
          });
          items.push(H.text('m' + j, gx + j * cw + cw / 2, gy + ch + 6 + Fn * ch + 18, st.hit ? '✓' : 'F', st.hit ? 'good' : 'bad', 13, 'middle'));
        });
        for (let k = 0; k < Fn; k++) items.push(H.text('fl' + k, gx - 6, gy + ch + 6 + k * ch + ch / 2 + 5, 'f' + k, 'tick', 12, 'end'));
        // frames held over time, one line a process
        const ay = gy + ch + 6 + Fn * ch + 56, ax = S.Kit.curve.axes({ prefix: 'ax', x: gx, y: ay, w: N * cw, h: 470 - ay - 24, xr: [0.5, N + 0.5], yr: [0, Fn], xticks: 0, yticks: Fn <= 6 ? 1 : 2, yname: 'frames held', tickSize: 12 });
        items.push(...ax.items);
        const cur = Math.max(0, upto);
        [0, 1].forEach((p) => {
          if (upto < 0) return;
          const pts = [];
          for (let j = 0; j <= cur; j++) { pts.push([j + 0.5, r.steps[j].held[p]]); pts.push([j + 1.5, r.steps[j].held[p]]); }
          items.push(S.Kit.curve.line(ax, 'hl' + p, pts, 'p11-held ' + H.pc(p)));
          items.push(H.text('hv' + p, Math.min(gx + (cur + 1) * cw + 6, 760), ax.Y(r.steps[cur].held[p]) + (p ? 14 : -4), (p ? 'B ' : 'A ') + r.steps[cur].held[p], H.pc(p), 13));
        });
        return items;
      };
      FR.add({ items: draw(-1), say: `${Fn} frames, all free. A references ${procs[0].refs.length} pages and B ${procs[1].refs.length}, taking turns of ${inp.quantum}. ` + (inp.mode === 'global' ? 'Under global replacement a fault may take any frame.' : `Under local replacement each holds at most ${H.plural(quota[0], 'frame')} and replaces only its own pages.`), meta: { phase: 'start', frames: Fn, quota, lens: procs.map((p) => p.refs.length) }, view, hl: { d: [inp.mode === 'global' ? 0 : 1] } });
      r.steps.forEach((st, j) => {
        if (!st.hit) FR.count(st.proc ? 'fb' : 'fa');
        const stole = st.victim && st.victim.proc !== st.proc;
        FR.add({ items: draw(j), say: st.say, meta: { phase: 'ref', proc: procs[st.proc].name, page: st.page, hit: st.hit, frame: st.frame, stole, victim: st.victim ? [st.victim.proc, st.victim.page] : null, held: st.held, i: j }, view, hl: { d: stole ? [0, 2] : st.hit ? [] : [inp.mode === 'global' ? 0 : 1] } });
      });
      const [g, l] = inp.mode === 'global' ? [r, other] : [other, r];
      FR.add({ items: draw(N - 1), say: `A faulted ${H.plural(r.faults[0], 'time')} and B ${H.plural(r.faults[1], 'time')}, and at the end A holds ${H.plural(r.held[0], 'frame')} and B ${r.held[1]}. The same run with ${inp.mode === 'global' ? 'local' : 'global'} replacement makes A fault ${H.plural(other.faults[0], 'time')} and B ${H.plural(other.faults[1], 'time')}.` + (g.faults[1] > l.faults[1] ? ' Under global replacement B paid for A\'s appetite.' : g.faults[0] < l.faults[0] ? ' Global replacement let the busy process grow.' : ''), meta: { phase: 'end', faults: r.faults, held: r.held, other: other.faults, g: g.faults, l: l.faults }, view, hl: { d: [0, 1] } });
      return { frames: FR.list, def: H.def('Whose frame?', ['global: victim among all frames', 'local: victim among the process\'s own', 'global: a process\'s fault rate depends on others', 'local: frames idle in one process cannot help another']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'ref' && fr[i + 1] && fr[i + 1].meta.phase === 'ref' && !fr[i + 1].meta.hit && fr[i + 1].meta.victim, once: true, pick: 'option', ask: (fr, i) => `${fr[i + 1].meta.proc} references page ${fr[i + 1].meta.page} next and faults with no free frame. Whose page goes?`, options: ['one of A\'s', 'one of B\'s'], answer: (fr, i) => (fr[i + 1].meta.victim[0] ? 'one of B\'s' : 'one of A\'s'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Under local replacement, can a process\'s fault rate rise because another process behaves badly?', options: ['no: it replaces only its own pages', 'yes, always', 'only with FIFO', 'only with more frames'], answer: 0, why: 'Its frames are its own; others cannot take them.' },
      { q: 'Global replacement usually gives better total throughput because…', options: ['frames move to the processes that need them', 'it never faults', 'it needs no page table', 'it keeps quotas fixed'], answer: 0, why: 'Idle frames in one process can serve another.' },
      { q: 'A drawback of global replacement?', options: ['a process cannot control its own fault rate', 'it wastes frames', 'it cannot use LRU', 'it needs equal sizes'], answer: 0, why: 'Its pages can be taken by whoever is faulting.' },
      { q: 'With local replacement and equal quotas, a process loops over 5 pages with a quota of 4. With LRU, how often does it fault in the loop?', options: ['on every reference', 'never', 'once per loop', 'every other reference'], answer: 0, why: 'LRU always evicts the page needed next in a loop one larger than the frames.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
