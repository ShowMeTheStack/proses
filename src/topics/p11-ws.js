// Part 11, thrashing and the working set. CPU utilisation against the degree of multiprogramming (the climb, the
// peak and the collapse once each process holds fewer frames than it needs), the working set as a window of the
// last Δ references sliding along the string, and page-fault-frequency control granting and taking frames.
(function (S) {
  'use strict';
  const H = S.P10, V = () => S.VM, C = () => S.Kit.curve;
  const pageList = (label, max) => ({ kind: 'list', label, min: 2, max, check: (v) => { for (const x of v) if (!/^\d{1,2}$/.test(x)) return label + ': page numbers 0 to 99 ("' + x + '")'; return null; } });

  // ---------------------------------------------------------------------------------------------------------------
  // Thrashing
  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'vmem-thrashing', family: 'p11-frames', order: 30, title: 'Thrashing',
    blurb: 'Add processes and the CPU gets busier, because while one waits for the paging disk another computes. But memory is fixed: each new process leaves fewer frames for every one. Once a process holds fewer frames than its working set it faults almost at once after every fault, every process queues at the paging disk, and CPU utilisation collapses. The scheduler, seeing an idle CPU, may admit even more processes, which is exactly wrong.',
    inputs: [
      { id: 'frames', kind: 'number', label: 'Frames', def: 1000, min: 50, max: 5000 },
      { id: 'wss', kind: 'number', label: 'Frames a process needs', def: 100, min: 5, max: 2000 },
      { id: 'lifetime', kind: 'number', label: 'Compute between faults (ms)', def: 20, min: 1, max: 200 },
      { id: 'disk', kind: 'number', label: 'Fault service (ms)', def: 10, min: 1, max: 100 },
      { id: 'k', kind: 'number', label: 'Steepness k', def: 2, min: 1, max: 4 },
      { id: 'maxN', kind: 'number', label: 'Up to n processes', def: 24, min: 4, max: 30 },
    ],
    check(inp) { if (inp.wss * 2 > inp.frames * inp.maxN) return 'Frames a process needs: too large to fit even one process; lower it or add frames'; return null; },
    presets: [
      { label: '1000 frames, 100 each needed', values: {} },
      { label: 'Twice the memory', values: { frames: 2000, maxN: 30 } },
      { label: 'A slow paging disk (25 ms)', values: { disk: 25 } },
      { label: 'Gentle: k = 1', values: { k: 1 } },
      { label: 'Big working sets (300 of 1200)', values: { frames: 1200, wss: 300, maxN: 10 } },
    ],
    counters: [{ id: 'n', label: 'processes' }],
    run(inp) {
      const r = V().thrashing({ frames: inp.frames, wss: inp.wss, lifetime: inp.lifetime, disk: inp.disk, k: inp.k, maxN: inp.maxN });
      const P = r.points, best = P[r.best - 1], FR = new S.Frames(['n']), view = H.box(0, 0, 790, 470);
      const ax = C().axes({ prefix: 'ax', x: 48, y: 50, w: 460, h: 340, xr: [0.5, inp.maxN + 0.5], yr: [0, 100], xticks: inp.maxN > 12 ? 2 : 1, yticks: 20, xname: 'processes in memory (degree of multiprogramming)', yname: 'utilisation %', tickSize: 12 });
      const fit = Math.floor(inp.frames / inp.wss);
      const draw = (n, fin) => {
        const items = [...ax.items], up = P.slice(0, n);
        items.push(C().line(ax, 'cpu', up.map((p) => [p.n, p.cpu * 100]), 'p11-cpu'), C().line(ax, 'disk', up.map((p) => [p.n, p.disk * 100]), 'p11-disk'));
        if (fit >= 1 && fit < inp.maxN) { items.push(C().vline(ax, 'fit', fit, '')); if (n > fit) { const right = ax.X(fit) + 260 < ax.o.x + ax.o.w; items.push(H.text('fitl', ax.X(fit) + (right ? 6 : -6), ax.o.y + ax.o.h - 8, 'right of the line: fewer frames than needed', 'tick', 12, right ? 'start' : 'end')); } }
        const p = P[n - 1];
        // the marks of this n: the CPU and the disk (a disk mark on top of the CPU mark is left to its line), and the peak
        const near = (a, b) => Math.abs(ax.Y(a) - ax.Y(b)) < 13;
        if (!(fin && p.n === best.n)) items.push(C().dot(ax, 'dc', p.n, p.cpu * 100, 'act', 6));
        if (!near(p.disk * 100, p.cpu * 100) && !(fin && Math.abs(ax.X(p.n) - ax.X(best.n)) < 13 && near(p.disk * 100, best.cpu * 100))) items.push(C().dot(ax, 'dd', p.n, p.disk * 100, 'hot', 5));
        if (fin) { const bx = ax.X(best.n), left = bx - 40 < ax.o.x + 8; items.push(C().dot(ax, 'db', best.n, best.cpu * 100, 'good', 7), H.text('bl', left ? bx + 10 : bx, ax.Y(best.cpu * 100) - 14, 'peak ' + Math.round(best.cpu * 100) + '%', 'good', 13, left ? 'start' : 'middle')); }
        items.push(...C().legend('lg', 540, 60, [{ text: 'CPU', cls: 'p11-cpu' }, { text: 'paging disk', cls: 'p11-disk' }]));
        // the panel: one process's frames against what it needs
        const px = 540, pw = 240;
        const kv = [['processes', String(p.n)], ['frames each', H.f(p.framesEach, 1)], ['needed', String(inp.wss)], ['compute between faults', H.f(p.lifetime, 2) + ' ms'], ['CPU busy', H.pct(p.cpu)], ['disk busy', H.pct(p.disk)]];
        kv.forEach(([k, v], j) => { items.push(H.text('k' + j, px, 112 + j * 30, k, 'p11-k', 13), H.text('v' + j, px + pw, 112 + j * 30, v, 'p11-v' + (j === 4 ? (p.cpu >= best.cpu - 1e-9 ? ' good' : '') : ''), 14, 'end')); });
        const has = Math.min(1, p.framesEach / Math.max(inp.wss, p.framesEach)), need = inp.wss / Math.max(inp.wss, p.framesEach);
        items.push(H.text('bh', px, 324, 'one process', 'tick', 12));
        items.push(H.cell('has', px, 334, Math.max(2, has * pw), 24, '', 'p11-bar' + (p.framesEach < inp.wss ? ' over' : ' under')), H.text('hasl', px, 374, 'has ' + H.f(p.framesEach, 1), 'tick', 12));
        items.push(H.cell('need', px, 384, Math.max(2, need * pw), 24, '', 'p11-bar soft'), H.text('needl', px, 424, 'needs ' + inp.wss, 'tick', 12));
        return items;
      };
      P.forEach((p, i) => {
        FR.set('n', p.n);
        const enough = p.framesEach >= inp.wss;
        const prev = P[i - 1];
        const say = `n = ${p.n}: ${H.f(p.framesEach, 1)} frames each` + (enough ? `, at least the ${inp.wss} a process needs, so it computes ${H.f(p.lifetime, 2)} ms between faults.` : `, short of the ${inp.wss} it needs, so it computes only ${H.f(p.lifetime, 2)} ms between faults.`) + ` The CPU is ${H.pct(p.cpu)} busy and the paging disk ${H.pct(p.disk)}` + (prev ? (p.cpu > prev.cpu ? ', more work overlapping the waits.' : p.cpu < prev.cpu ? ': the CPU is idler than with ' + prev.n + '.' : '.') : '.');
        FR.add({ items: draw(p.n, false), say, meta: { phase: 'n', n: p.n, each: p.framesEach, lifetime: p.lifetime, cpu: p.cpu, disk: p.disk, wss: inp.wss, prev: prev ? prev.n : 0, up: prev ? p.cpu > prev.cpu : true, best: r.best }, view, hl: { d: enough ? [0] : [1, 2] } });
      });
      const last = P[P.length - 1];
      FR.add({ items: draw(P.length, true), say: r.say + ' Past the peak the cure is fewer processes in memory, not more.', meta: { phase: 'end', best: r.best, bestCpu: best.cpu, bestEach: Math.floor(best.framesEach), last: last.n, lastEach: Math.floor(last.framesEach), lastDisk: last.disk, lastCpu: last.cpu, wss: inp.wss }, view, hl: { d: [2, 3] } });
      return { frames: FR.list, def: H.def('Thrashing', ['frames each = m / n', 'enough frames: long runs between faults', 'too few: a fault soon after every fault', 'the disk saturates, the CPU idles', 'cure: suspend processes, not add them']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'n' && f.meta.n === 1, pick: 'option', ask: 'A second process joins. Does CPU utilisation go up or down?', options: ['up', 'down'], answer: (fr, i) => (fr[i + 1].meta.cpu > fr[i].meta.cpu ? 'up' : 'down'), explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'n' && f.meta.n === f.meta.best, pick: 'option', ask: 'One more process joins. Does CPU utilisation go up or down?', options: ['up', 'down'], answer: (fr, i) => (fr[i + 1].meta.phase === 'n' ? (fr[i + 1].meta.cpu > fr[i].meta.cpu ? 'up' : 'down') : null), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Thrashing is…', options: ['a process spending more time paging than computing', 'the CPU running too many instructions', 'a disk head crash', 'two processes sharing a frame'], answer: 0, why: 'With too few frames each process faults almost continuously.' },
      { q: 'CPU utilisation is low and the paging disk is saturated. The right move is to…', options: ['suspend or swap out some processes', 'admit more processes', 'add a faster CPU', 'shorten the time slice'], answer: 0, why: 'Fewer processes leave more frames for each.' },
      { q: '1000 frames, each process needs about 100. Roughly where does thrashing begin?', options: ['past 10 processes', 'past 2 processes', 'past 100 processes', 'never'], answer: 0, why: 'At 10 each still has 100 frames; with more, each has fewer than it needs.' },
      { q: 'Why does utilisation rise at first as processes are added?', options: ['one computes while others wait for the disk', 'each process runs faster', 'faults disappear', 'the TLB grows'], answer: 0, why: 'Multiprogramming overlaps computation with I/O waits.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The working set
  // ---------------------------------------------------------------------------------------------------------------
  const refsRow = (items, refs, x0, y, cw, ch, cur, lo, faults) => {
    refs.forEach((p, j) => items.push(H.cell('r' + j, x0 + j * cw, y, cw, ch, String(p), 'p11-ref' + (j === cur ? ' act' : j >= lo && j <= cur ? ' inwin' : j > cur ? ' dim' : '') + (faults && faults[j] && j <= cur ? ' fault' : ''), 13, { rx: 0 })));
  };
  S.topic({
    id: 'vmem-working-set', family: 'p11-frames', order: 40, title: 'The working set',
    blurb: 'A program uses a few pages at a time, its locality, and moves from one locality to the next. The working set W(t, Δ) is the set of distinct pages among the last Δ references. If each process holds its working set the faults stay rare; if the working sets of all processes add up to more than the frames there are, some process should be suspended. Too small a Δ misses part of the locality; too large a Δ spans several.',
    inputs: [
      Object.assign({ id: 'refs', def: '2 6 2 4 6 2 4 6 9 8 9 8 7 9 8 7 2 6 2 6'.split(' ') }, pageList('References', 30)),
      { id: 'delta', kind: 'number', label: 'Window Δ', def: 4, min: 1, max: 15 },
    ],
    presets: [
      { label: 'Three localities, Δ = 4', values: {} },
      { label: 'The same, Δ = 2: too small', values: { delta: 2 } },
      { label: 'The same, Δ = 10: spans two localities', values: { delta: 10 } },
      { label: 'A loop of three, then a loop of four', values: { refs: '1 2 3 1 2 3 1 2 3 5 6 7 8 5 6 7 8 5 6 7 8'.split(' '), delta: 5 } },
      { label: 'A scan: every page new', values: { refs: '1 2 3 4 5 6 7 8 9 10 11 12'.split(' '), delta: 3 } },
    ],
    counters: [{ id: 'wss', label: 'working-set size' }],
    run(inp) {
      const refs = inp.refs.map(Number), D = inp.delta, r = V().workingSet(refs, D), N = refs.length;
      const FR = new S.Frames(['wss']), view = H.box(0, 0, 790, 460);
      const x0 = 40, cw = Math.min(36, Math.floor(670 / N)), ch = 30, ry = 50;
      const maxW = Math.max(...r.steps.map((s) => s.wss), 1);
      const ax = C().axes({ prefix: 'ax', x: x0, y: 250, w: N * cw, h: 170, xr: [0, N], yr: [0, maxW], xticks: 0, yticks: maxW > 8 ? 2 : 1, yname: 'working-set size', tickSize: 12 });
      const draw = (t, fin) => {
        const items = [H.text('rl', x0 - 6, ry + 20, 'ref', 'tick', 12, 'end')];
        refsRow(items, refs, x0, ry, cw, ch, fin ? -1 : t, fin ? N : Math.max(0, t - D + 1));
        refs.forEach((_, j) => { if (j % 5 === 4 || j === 0) items.push(H.text('tn' + j, x0 + j * cw + cw / 2, ry - 8, String(j + 1), 'tick', 12, 'middle')); });
        if (t >= 0 && !fin) {
          const lo = Math.max(0, t - D + 1);
          items.push({ key: 'win', kind: 'region', x: x0 + lo * cw - 3, y: ry - 4, w: (t - lo + 1) * cw + 6, h: ch + 8, rx: 5, text: '', cls: 'p11-win', audit: 'overlap-ok', layer: 'back' });
          items.push({ key: 'br', kind: 'bracket', x1: x0 + lo * cw, x2: x0 + (t + 1) * cw, y: ry + ch + 8, side: 'below', text: 'Δ = ' + D, cls: 'act' });
          const st = r.steps[t];
          items.push(H.text('wst', x0, 150, 'W(' + (t + 1) + ', ' + D + ')', 'strong', 14));
          const pages = st.ws.map((p) => [p, st.entered.includes(p) ? ' new' : '']).concat(st.left.map((p) => [p, ' gone']));
          pages.forEach(([p, c], k) => items.push(H.cell('ws' + p, x0 + 110 + k * 46, 132, 40, 30, String(p), 'p11-chip' + c, 14)));
          items.push(H.text('wsn', x0 + 110 + pages.length * 46 + 8, 152, '= ' + st.wss + ' page' + (st.wss === 1 ? '' : 's'), 'p10-sum', 15));
          if (st.left.length) items.push(H.text('gl', x0 + 110, 186, 'dashed: left the window', 'tick', 12));
        }
        items.push(...ax.items);
        const upto = fin ? N - 1 : t;
        for (let j = 0; j <= upto; j++) { const w = r.steps[j].wss; items.push(H.cell('b' + j, x0 + j * cw + 3, ax.Y(w), cw - 6, Math.max(1, ax.Y(0) - ax.Y(w)), '', 'p11-bar' + (j === t && !fin ? ' cur' : ''), 12, { rx: 0 })); }
        if (fin) { items.push(C().hline(ax, 'avg', r.avg, 'act'), H.text('avgl', x0 + N * cw + 6, ax.Y(r.avg) + 4, 'mean ' + H.f(r.avg, 2), 'act', 12)); }
        return items;
      };
      FR.add({ items: draw(-1, false), say: `${N} references and a window of Δ = ${D}: at each step the working set is the set of distinct pages among the last ${H.plural(D, 'reference')}.`, meta: { phase: 'start', n: N, delta: D }, view, hl: { d: [0] } });
      r.steps.forEach((st, t) => {
        FR.set('wss', st.wss);
        FR.add({ items: draw(t, false), say: `t = ${t + 1}, page ${st.page}: the last ${H.plural(Math.min(D, t + 1), 'reference')} hold ${H.plural(st.wss, 'distinct page')} {${st.ws.join(', ')}}` + (st.left.length ? `; ${st.left.length === 1 ? 'page ' + st.left[0] + ' falls' : 'pages ' + H.list(st.left) + ' fall'} out of the window.` : '.') + (st.entered.length && t > 0 ? ' ' + (st.entered.length === 1 ? 'Page ' + st.entered[0] + ' joins.' : 'Pages ' + H.list(st.entered) + ' join.') : ''), meta: { phase: 'step', t: t + 1, page: st.page, ws: st.ws, wss: st.wss, entered: st.entered, left: st.left, win: Math.min(D, t + 1) }, view, hl: { d: [0, 1] } });
      });
      FR.add({ items: draw(N - 1, true), say: r.say + ` A process given ${H.plural(r.max, 'frame')} would hold its working set at every step; the peaks mark the moves between localities, when the old pages have not yet left the window.`, meta: { phase: 'end', avg: r.avg, max: r.max, delta: D }, view, hl: { d: [2, 3] } });
      return { frames: FR.list, def: H.def('Working set', ['W(t, Δ) = distinct pages in refs t−Δ+1 … t', 'WSS = |W(t, Δ)|', 'D = Σ WSSᵢ over the processes', 'D > frames: suspend a process', 'Δ too small: misses the locality; too large: spans several']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'step' && f.meta.t >= 4 && fr[i + 1] && fr[i + 1].meta.phase === 'step', once: true, pick: 'option', ask: (fr, i) => `The next reference is page ${fr[i + 1].meta.page}. How many pages will the working set hold?`, options: (fr, i) => { const w = fr[i + 1].meta.wss; return [...new Set([w - 1, w, w + 1, w + 2].filter((x) => x >= 1))].map(String); }, answer: (fr, i) => String(fr[i + 1].meta.wss), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'References 3 5 3 7 5 3 with Δ = 4, at the last reference. The working set?', options: ['{3, 5, 7}', '{3, 5}', '{3, 7}', '{3, 5, 7, 9}'], answer: 0, why: 'The last four references are 3 7 5 3.' },
      { q: 'Making Δ larger can only…', options: ['keep the working set the same or make it larger', 'shrink it', 'make it random', 'empty it'], answer: 0, why: 'A wider window contains every page of the narrower one.' },
      { q: 'The working sets of the running processes add up to more than the frames. The kernel should…', options: ['suspend a process', 'add a process', 'shrink Δ until they fit', 'flush the TLB'], answer: 0, why: 'Otherwise every process runs short and the system thrashes.' },
      { q: 'Why does the working-set size spike when a program changes locality?', options: ['the old pages are still in the window while the new ones arrive', 'the program uses more memory forever', 'Δ grows', 'the TLB is flushed'], answer: 0, why: 'For Δ references both localities are inside the window.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
