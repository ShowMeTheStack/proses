// Part 11, page replacement compared: several policies on one reference string and one number of frames (stepped
// side by side for two or three, as fault totals for more), and Belady's anomaly: faults against frames, where FIFO
// can fault more with more memory and the stack algorithms (LRU, OPT) never do.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem, KM = () => S.Kit.mem, C = () => S.Kit.curve;
  const R = () => S.P11R;
  const POLICY_CHECK = (v) => { for (const p of v) if (!S.Mem.policies.includes(p)) return 'Policies: "' + p + '" is not one of ' + S.Mem.policies.join(', '); return new Set(v).size === v.length ? null : 'Policies: each once'; };
  const refsCheck = (v) => { try { R().parseRefs(v); return null; } catch (e) { return e.message; } };

  S.topic({
    id: 'vmem-compare', family: 'p11-replace', order: 20, title: 'Policies side by side',
    blurb: 'The same references and the same frames for every policy. OPT sets the floor no policy can beat. LRU usually comes closest; the clock and second chance approximate it with one bit a frame; FIFO ignores use altogether; LFU and MFU bet on counts. Name two or three policies to step through them together, or more to see their totals as bars.',
    inputs: [
      { id: 'refs', kind: 'list', label: 'References (w = a write)', def: ['1', '3', '5', '1', '3', '7', '1', '4', '3', '1', '5', '7', '3', '4', '1', '6', '3', '1'], min: 1, max: 20, check: refsCheck },
      { id: 'frames', kind: 'number', label: 'Frames', def: 3, min: 1, max: 6 },
      { id: 'pols', kind: 'list', label: 'Policies', def: ['opt', 'lru', 'fifo', 'clock', 'second', 'eclock', 'lfu', 'mfu', 'aging', 'nru'], min: 1, max: 10, check: POLICY_CHECK },
    ],
    presets: [
      { label: 'All ten, three frames', values: {} },
      { label: 'LRU against clock, stepped', values: { pols: ['lru', 'clock'] } },
      { label: 'FIFO, LRU and OPT, stepped', values: { pols: ['fifo', 'lru', 'opt'], refs: ['4', '2', '6', '4', '1', '2', '4', '6', '3', '2', '4', '1'], frames: 3 } },
      { label: 'A loop of four in three frames', values: { refs: '1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4'.split(' '), frames: 3 } },
      { label: 'Writes: enhanced clock saves write-backs', values: { pols: ['clock', 'eclock'], refs: ['1w', '2', '3w', '4', '1', '5', '2', '6w', '3', '1', '4', '2'], frames: 3 } },
    ],
    counters: [{ id: 'shown', label: 'policies run' }],
    run(inp) {
      const refs = R().parseRefs(inp.refs), n = refs.length, nf = inp.frames, pols = inp.pols;
      const runs = pols.map((p) => M().replace(p, refs, nf));
      const F = new S.Frames(['shown']);
      const label = refs.map(R().label);
      if (pols.length <= 3) {
        const ch = nf > 4 ? 20 : 24, cw = Math.min(38, Math.floor(740 / n)), gh = (nf + 2) * ch + 14, block = gh + 34;
        const view = H.box(0, 0, 800, Math.max(470, pols.length * block + 30));
        const draw = (i, fin) => {
          const items = [];
          runs.forEach((r, k) => {
            const y = 30 + k * block, st = i >= 0 ? r.steps[i] : null;
            items.push(H.text('nm' + k, 0, y + 6, r.name, 'mb-ptitle', 15));
            items.push(H.text('ft' + k, 800, y + 6, H.plural(st ? st.faults : 0, 'fault') + (r.writeBacks && fin ? ', ' + r.writeBacks + ' written back' : ''), 'p10-sum' + (fin ? (r.faults === Math.min(...runs.map((x) => x.faults)) ? ' good' : '') : ''), 14, 'end'));
            items.push(...KM().grid({ prefix: 'g' + k, x: 0, y: y + 18, cw, ch, labelW: 40, refs: label, nFrames: nf, steps: r.steps, upto: i, cur: fin ? -1 : i, size: 13 }).items);
          });
          return items;
        };
        F.set('shown', pols.length);
        F.add({ items: draw(-1), say: `${H.list(runs.map((r) => r.name))} each start with ${H.plural(nf, 'empty frame')} and see the same ${n} references.`, meta: { phase: 'start', n, nf }, view });
        for (let i = 0; i < n; i++) {
          const parts = runs.map((r) => { const st = r.steps[i]; return st.hit ? r.name + ' hits' : st.free ? r.name + ' fills frame ' + st.slot : r.name + ' evicts page ' + st.victim; });
          F.add({ items: draw(i), say: `Reference ${i + 1}, page ${refs[i].page}: ${H.list(parts)}.`, meta: { phase: 'ref', i, n: i + 1, page: refs[i].page, names: runs.map((r) => r.name), steps: runs.map((r) => r.steps[i]), faults: runs.map((r) => r.steps[i].hit ? 0 : 1) }, view });
        }
        const best = Math.min(...runs.map((r) => r.faults));
        F.add({ items: draw(n - 1, true), say: `Totals: ${H.list(runs.map((r) => r.name + ' ' + r.faults))} faults. ` + (runs.filter((r) => r.faults === best).length === runs.length ? 'A tie.' : `${H.list(runs.filter((r) => r.faults === best).map((r) => r.name))} did best.`), meta: { phase: 'end', faults: runs.map((r) => r.faults), wb: runs.map((r) => r.writeBacks) }, view });
        return { frames: F.list, def: H.def('Comparing', ['same references, same frames', 'OPT: the fewest faults possible', 'a fault: the column is red; a hit: green']) };
      }
      // more policies: their totals as bars, one at a time, with the grid of the one just run
      const ch = nf > 4 ? 20 : 22, cw = Math.min(34, Math.floor(740 / n)), barH = 24, bx = 130, bw = 600;
      const gy = 40 + pols.length * (barH + 4) + 30, view = H.box(0, 0, 800, Math.max(480, gy + (nf + 2) * ch + 30));
      const maxF = Math.max(...runs.map((r) => r.faults), 1), best = Math.min(...runs.map((r) => r.faults)), worst = Math.max(...runs.map((r) => r.faults));
      const draw = (upto, fin) => {
        const items = [H.title('bt', 0, 24, 'faults with ' + H.plural(nf, 'frame') + ', ' + n + ' references')];
        runs.forEach((r, k) => {
          const y = 40 + k * (barH + 4);
          items.push(H.text('bn' + k, bx - 10, y + 17, r.name, k === upto ? 'act' : 'strong', 13, 'end'));
          if (k <= upto) {
            const w = Math.max(2, Math.round((r.faults / maxF) * bw));
            items.push(H.cell('bar' + k, bx, y, w, barH, '', 'p11-bar ' + (fin ? (r.faults === best ? 'best' : r.faults === worst ? 'worst' : 'soft') : k === upto ? 'act' : 'soft')));
            items.push(H.text('bv' + k, bx + w + 8, y + 17, String(r.faults), 'mono', 13));
          }
        });
        const k = Math.max(0, Math.min(upto, runs.length - 1));
        if (upto >= 0) {
          items.push(H.text('gt', 0, gy - 8, runs[k].name + ', reference by reference', 'tick', 13));
          items.push(...KM().grid({ prefix: 'g', x: 0, y: gy, cw, ch, labelW: 40, refs: label, nFrames: nf, steps: runs[k].steps, upto: n - 1, cur: -1, size: 13 }).items);
        }
        return items;
      };
      F.add({ items: draw(-1), say: `${pols.length} policies, each with ${H.plural(nf, 'frame')}, on the same ${n} references.`, meta: { phase: 'start', n, nf, k: pols.length }, view });
      runs.forEach((r, k) => {
        F.set('shown', k + 1);
        F.add({ items: draw(k), say: `${r.name}: ${H.plural(r.faults, 'fault')} and ${H.plural(r.hits, 'hit')}` + (r.writeBacks ? `, ${r.writeBacks} of the victims dirty` : '') + '.', meta: { phase: 'policy', k, policy: r.policy, faults: r.faults, hits: r.hits, wb: r.writeBacks }, view });
      });
      const order = runs.slice().sort((a, b) => a.faults - b.faults);
      F.add({ items: draw(runs.length - 1, true), say: `Fewest faults: ${H.list(order.filter((r) => r.faults === best).map((r) => r.name))} with ${best}; most: ${H.list(order.filter((r) => r.faults === worst).map((r) => r.name))} with ${worst}.` + (pols.includes('opt') ? ` No policy can beat OPT's ${runs[pols.indexOf('opt')].faults}.` : ''), meta: { phase: 'end', best, worst, faults: runs.map((r) => r.faults) }, view });
      return { frames: F.list, def: H.def('Comparing', ['same references, same frames', 'OPT: the fewest faults possible', 'green: the fewest; red: the most']) };
    },
    predict: [
      {
        at: (f, i, fr) => f.meta.phase === 'start' && fr.some((x) => x.meta.phase === 'policy') && fr.filter((x) => x.meta.phase === 'policy' && x.meta.policy !== 'opt').length > 1, pick: 'option', ask: 'Leaving OPT aside, which policy will fault least here?',
        options: (fr) => fr.filter((x) => x.meta.phase === 'policy' && x.meta.policy !== 'opt').map((x) => S.Mem.policyName(x.meta.policy)),
        answer: (fr) => { const ps = fr.filter((x) => x.meta.phase === 'policy' && x.meta.policy !== 'opt'), m = Math.min(...ps.map((x) => x.meta.faults)); return ps.filter((x) => x.meta.faults === m).map((x) => S.Mem.policyName(x.meta.policy)); },
        explain: (fr) => fr[fr.length - 1].say,
      },
      {
        at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'ref' && fr[i + 1].meta.faults.filter(Boolean).length === 1, pick: 'option',
        ask: (fr, i) => `Reference ${fr[i + 1].meta.n} is page ${fr[i + 1].meta.page}. Only one of these policies faults on it: which?`,
        options: (fr, i) => fr[i + 1].meta.names, answer: (fr, i) => fr[i + 1].meta.names[fr[i + 1].meta.faults.indexOf(1)], explain: (fr, i) => fr[i + 1].say,
      },
    ],
    quiz: [
      { q: 'Can any policy fault fewer times than OPT on the same string and frames?', options: ['no', 'yes, LRU sometimes', 'yes, with luck', 'only FIFO'], answer: 0, why: 'OPT evicts the page needed farthest ahead, which is provably the fewest faults.' },
      { q: 'A loop over 5 pages runs with 4 frames under LRU. How do the references after the first loop do?', options: ['every one faults', 'every one hits', 'half hit', 'only the first faults'], answer: 0, why: 'LRU always evicts the page the loop needs next.' },
      { q: 'Why is the clock used instead of exact LRU?', options: ['keeping an exact use order on every access is too costly', 'it faults less than LRU', 'it needs no hardware bit', 'it knows the future'], answer: 0, why: 'A use bit set by hardware is cheap; a full order would need work on every memory access.' },
      { q: 'Two policies fault equally often. What else could make one better?', options: ['fewer dirty victims, so fewer write-backs', 'a longer reference string', 'more frames for one of them', 'nothing'], answer: 0, why: 'Each dirty victim costs an extra disk write.' },
    ],
  });
  // ---------------------------------------------------------------------------------------------------------------
  // Belady's anomaly
  // ---------------------------------------------------------------------------------------------------------------
  const STACK = ['lru', 'opt'];
  const LINE = { fifo: 'c1', clock: 'c2', second: 'c2', lfu: 'c3', mfu: 'c3', aging: 'c3', nru: 'c3', eclock: 'c2', lru: 'c0', opt: 'faint' };
  S.topic({
    id: 'vmem-belady', family: 'p11-replace', order: 30, title: 'Belady\'s anomaly',
    blurb: 'More frames should never mean more faults, and for LRU and OPT it never does: they are stack algorithms, whose pages with n frames are always among their pages with n + 1. FIFO is not, and on some strings one more frame gives more faults. Sweep the frames to see the curves, or let a search find a string where the anomaly shows.',
    inputs: [
      { id: 'source', kind: 'choice', label: 'String', def: 'typed', options: [{ value: 'typed', label: 'the one typed' }, { value: 'search', label: 'search for an anomaly' }] },
      { id: 'refs', kind: 'list', label: 'References', def: ['2', '4', '5', '6', '2', '4', '3', '2', '1', '3', '4', '5', '3'], min: 1, max: 18, check: refsCheck },
      { id: 'policy', kind: 'choice', label: 'Policy under test', def: 'fifo', options: ['fifo', 'clock', 'second', 'lfu', 'mfu', 'nru', 'lru'].map((value) => ({ value, label: S.Mem.policyName(value) })) },
      { id: 'max', kind: 'number', label: 'Most frames', def: 6, min: 3, max: 7 },
      { id: 'seed', kind: 'number', label: 'Search seed', def: 4, min: 0, max: 999 },
    ],
    presets: [
      { label: 'FIFO, three frames against four', values: {} },
      { label: 'The same string under LRU', values: { policy: 'lru' } },
      { label: 'Search: FIFO, seed 4', values: { source: 'search', seed: 4 } },
      { label: 'Search: second chance, seed 5', values: { source: 'search', policy: 'second', seed: 5 } },
      { label: 'A loop: no anomaly', values: { refs: ['1', '2', '3', '4', '1', '2', '3', '4', '1', '2', '3', '4'], max: 5 } },
    ],
    counters: [{ id: 'n', label: 'frames tried' }],
    run(inp) {
      let refs = inp.source === 'typed' ? R().parseRefs(inp.refs).map((r) => r.page) : null, found = null;
      if (!refs) {
        found = S.P10.once('belady:' + inp.policy + ':' + inp.seed, () => M().findBelady({ policy: inp.policy, length: 14, pages: 5, frames: 3, seed: inp.seed, tries: 12000 }));
        refs = found ? found.refs : R().parseRefs(inp.refs).map((r) => r.page);
      }
      const n = refs.length, pol = inp.policy, max = Math.min(inp.max, n);
      const curves = {};
      for (const p of [pol, 'lru', 'opt']) curves[p] = M().faultCurve(p, refs, 1, max);
      const F = new S.Frames(['n']), view = H.box(0, 0, 800, 500);
      const ax = C().axes({ prefix: 'ax', x: 54, y: 66, w: 380, h: 180, xr: [1, max], yr: [0, n], xticks: 1, yticks: n > 10 ? 4 : 2, xname: 'frames', yname: 'faults', tickSize: 12 });
      const anomalies = [];
      for (let k = 1; k < curves[pol].length; k++) if (curves[pol][k].faults > curves[pol][k - 1].faults) anomalies.push(curves[pol][k - 1].n);
      const draw = (upto, grids) => {
        const items = [...ax.items];
        for (const p of [pol, 'lru', 'opt'].filter((x, i, a) => a.indexOf(x) === i)) {
          const pts = curves[p].filter((c) => c.n <= upto).map((c) => [c.n, c.faults]);
          if (pts.length > 1) items.push(C().line(ax, 'l' + p, pts, LINE[p]));
          for (const [x, y] of pts) items.push(C().dot(ax, 'd' + p + x, x, y, LINE[p] + (p === pol && anomalies.includes(x - 1) ? ' hot' : ''), p === pol ? 5 : 4));
        }
        items.push(...C().legend('lg', 60, 300, [pol, 'lru', 'opt'].filter((x, i, a) => a.indexOf(x) === i).map((p) => ({ text: M().policyName(p), cls: LINE[p] }))));
        // the table of faults
        const cols = [pol, 'lru', 'opt'].filter((x, i, a) => a.indexOf(x) === i);
        items.push(H.text('th', 470, 56, 'frames', 'tick', 13));
        cols.forEach((p, j) => items.push(H.text('th' + p, 560 + j * 80, 56, M().policyName(p), 'tick', 13, 'middle')));
        for (let k = 1; k <= upto; k++) {
          const y = 56 + k * 24;
          items.push(H.text('tn' + k, 490, y, String(k), 'mono', 13, 'middle'));
          cols.forEach((p, j) => { const v = curves[p][k - 1].faults, up = k > 1 && v > curves[p][k - 2].faults; items.push(H.text('tv' + p + k, 560 + j * 80, y, String(v), up ? 'bad' : 'mono', 13, 'middle')); });
        }
        items.push(H.text('str', 0, 22, 'references: ' + refs.join(' '), 'p10-sum', 14));
        if (grids) {
          const [a, b] = grids, cw = Math.min(24, Math.floor(340 / n)), ch = 20;
          [a, b].forEach((m, j) => {
            const run = M().replace(pol, refs, m), x = j * 410, y = 330;
            items.push(H.text('gn' + j, x, y - 8, M().policyName(pol) + ', ' + m + ' frames: ' + run.faults + ' faults', j ? 'bad' : 'strong', 13));
            items.push(...KM().grid({ prefix: 'g' + j, x, y: y + 4, cw, ch, labelW: 30, refs, nFrames: m, steps: run.steps, upto: n - 1, cur: -1, size: 12 }).items);
          });
        }
        return items;
      };
      F.add({ items: draw(0), say: (found ? `The search found this string after ${found.tries} tries. ` : inp.source === 'search' ? 'The search found no anomaly with this seed, so the typed string is used. ' : '') + `${n} references; ${M().policyName(pol)} will run with 1 to ${max} frames, with LRU and OPT beside it.`, meta: { phase: 'start', n, max, tries: found ? found.tries : 0 }, view, hl: { d: [0] } });
      for (let k = 1; k <= max; k++) {
        F.set('n', k);
        const v = curves[pol][k - 1].faults, up = k > 1 && v > curves[pol][k - 2].faults;
        F.add({ items: draw(k), say: `With ${H.plural(k, 'frame')}: ${M().policyName(pol)} faults ${v} times` + (pol !== 'lru' ? `, LRU ${curves.lru[k - 1].faults}` : '') + `, OPT ${curves.opt[k - 1].faults}.` + (up ? ` That is more than the ${curves[pol][k - 2].faults} with one frame fewer: the anomaly.` : ''), meta: { phase: 'sweep', k, faults: v, lru: curves.lru[k - 1].faults, opt: curves.opt[k - 1].faults, prev: k > 1 ? curves[pol][k - 2].faults : null, up }, view, hl: { d: up ? [1] : [0] } });
      }
      if (anomalies.length) {
        const a = anomalies[0], ra = M().replace(pol, refs, a), rb = M().replace(pol, refs, a + 1);
        // the first reference after which the smaller memory holds a page the larger one does not
        let at = -1, page = null;
        for (let i = 0; i < n && at < 0; i++) { const x = ra.steps[i].frames.filter((p) => p !== null), y = rb.steps[i].frames; const miss = x.find((p) => !y.includes(p)); if (miss !== undefined) { at = i; page = miss; } }
        F.add({ items: draw(max, [a, a + 1]), say: `${M().policyName(pol)} with ${a} frames: ${ra.faults} faults; with ${a + 1}: ${rb.faults}. After reference ${at + 1} the ${a} frames hold page ${page} but the ${a + 1} frames do not, so the bigger memory is not a superset of the smaller one, and it pays for it later.`, meta: { phase: 'anomaly', a, b: a + 1, fa: ra.faults, fb: rb.faults, at: at + 1, page }, view, hl: { d: [1, 2] } });
      } else {
        F.add({ items: draw(max, [Math.max(1, max - 1), max]), say: `No anomaly here: ${M().policyName(pol)}'s faults never rise as frames are added, from ${curves[pol][0].faults} with 1 frame to ${curves[pol][max - 1].faults} with ${max}.` + (STACK.includes(pol) ? ' As a stack algorithm it cannot have one on any string.' : ' On another string it could.'), meta: { phase: 'none', first: curves[pol][0].faults, last: curves[pol][max - 1].faults, max, a: Math.max(1, max - 1) }, view, hl: { d: [3] } });
      }
      return { frames: F.list, def: H.def('Belady\'s anomaly', ['usually: more frames, fewer faults', 'FIFO can fault more with n + 1 frames than with n', 'it happens when n frames hold a page n + 1 do not', 'stack algorithms (LRU, OPT): pages with n ⊆ pages with n + 1, so never']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'sweep' && fr[i + 1] && fr[i + 1].meta.phase === 'sweep', pick: 'option', ask: (fr, i) => `With one more frame (${fr[i + 1].meta.k}), will the faults go down, stay the same, or go up?`, options: ['down', 'the same', 'up'], answer: (fr, i) => { const m = fr[i + 1].meta; return m.faults < m.prev ? 'down' : m.faults === m.prev ? 'the same' : 'up'; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Which policy can show Belady\'s anomaly?', options: ['FIFO', 'LRU', 'OPT', 'none of them'], answer: 0, why: 'FIFO is not a stack algorithm; LRU and OPT are.' },
      { q: 'What makes LRU immune?', options: ['its n most recent pages are always among its n + 1 most recent', 'it uses a use bit', 'it never evicts', 'it knows the future'], answer: 0, why: 'The inclusion (stack) property: adding a frame never removes a page from memory.' },
      { q: 'FIFO faults 9 times with 3 frames and 10 times with 4 on a string. Is that a bug?', options: ['no: it is Belady\'s anomaly', 'yes: more frames always help', 'yes: FIFO is wrong', 'only if pages were written'], answer: 0, why: 'FIFO\'s pages with 4 frames need not include its pages with 3.' },
      { q: 'Does the clock algorithm guarantee no anomaly?', options: ['no', 'yes: it approximates LRU', 'yes: it is a stack algorithm', 'only with dirty bits'], answer: 0, why: 'It approximates LRU but is not a stack algorithm.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
