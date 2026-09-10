// Part 11, reference strings: where they come from. Generated with locality (random, a loop, phases, a random walk),
// plotted page against time with the working-set size along it, and the fault curve that locality buys; and traced
// from a C program of the course's subset, address by address, then pages, then a replacement run.
(function (S) {
  'use strict';
  const H = S.P10, V = () => S.VM, M = () => S.Mem, C = () => S.Kit.curve, T = () => S.Kit.p11;
  const POL4 = [{ value: 'lru', label: 'LRU' }, { value: 'fifo', label: 'FIFO' }, { value: 'clock', label: 'Clock' }, { value: 'opt', label: 'OPT' }];

  /** a page-against-time plot: one dot a reference, pages by rank on the y axis, named by number */
  function pagePlot(prefix, refs, box, opts) {
    opts = opts || {};
    const pages = [...new Set(refs.map((r) => r.page))].sort((a, b) => a - b), rank = new Map(pages.map((p, i) => [p, i]));
    const step = Math.max(1, Math.ceil(pages.length / 9));
    const ax = C().axes({ prefix, x: box.x, y: box.y, w: box.w, h: box.h, xr: [0, Math.max(1, refs.length - 1)], yr: [-0.5, pages.length - 0.5], xticks: C().ticks(1, refs.length, 5).filter((v) => Number.isInteger(v) && v >= 1).map((v) => v - 1), yticks: pages.map((_, i) => i).filter((i) => i % step === 0), fmtY: (v) => String(pages[Math.round(v)]), fmtX: (v) => String(v + 1), xname: opts.xname || 'reference', yname: 'page', grid: false, tickSize: 12 });
    const r = refs.length > 120 ? 2 : refs.length > 50 ? 3 : 4;
    const items = [...ax.items];
    refs.forEach((x, i) => items.push({ key: prefix + ':d' + i, kind: 'dot', x: ax.X(i), y: ax.Y(rank.get(x.page)), r, cls: 'p11-ref' + (x.write ? ' w' : '') + (opts.faults && opts.faults[i] ? ' f' : ''), audit: 'overlap-ok' }));
    return { items, ax, pages };
  }

  S.topic({
    id: 'vmem-refs', family: 'p11-refs', order: 10, title: 'Reference strings with locality',
    blurb: 'Programs do not touch pages at random: a loop revisits the same few, a computation stays in one region for a while and then moves on, a traversal creeps to its neighbours. This locality is why paging works. Generate a string of each kind from a seed, see it page against time with the working-set size (the distinct pages in the last Δ references) beneath it, and compare its fault curve with a random string of the same length over the same pages.',
    inputs: [
      { id: 'kind', kind: 'choice', label: 'Kind', def: 'phases', options: [{ value: 'random', label: 'random' }, { value: 'loop', label: 'a loop' }, { value: 'phases', label: 'phases of locality' }, { value: 'walk', label: 'a random walk' }] },
      { id: 'length', kind: 'number', label: 'Length', def: 60, min: 10, max: 120 },
      { id: 'pages', kind: 'number', label: 'Pages', def: 10, min: 3, max: 16 },
      { id: 'seed', kind: 'number', label: 'Seed', def: 7, min: 0, max: 9999 },
      { id: 'delta', kind: 'number', label: 'Window Δ', def: 6, min: 2, max: 20 },
      { id: 'policy', kind: 'choice', label: 'Policy', def: 'lru', options: POL4 },
    ],
    presets: [
      { label: 'Phases of locality', values: {} },
      { label: 'A loop over four pages', values: { kind: 'loop', seed: 3 } },
      { label: 'A random walk', values: { kind: 'walk', seed: 11 } },
      { label: 'Random: no locality', values: { kind: 'random' } },
      { label: 'Long phases, 16 pages, FIFO', values: { kind: 'phases', length: 120, pages: 16, policy: 'fifo', delta: 10, seed: 2 } },
    ],
    counters: [{ id: 'distinct', label: 'distinct pages' }],
    run(inp) {
      const refs = V().refgen({ kind: inp.kind, length: inp.length, pages: inp.pages, seed: inp.seed }).map((page) => ({ page, write: false }));
      const rand = V().refgen({ kind: 'random', length: inp.length, pages: inp.pages, seed: inp.seed });
      const ws = V().workingSet(refs.map((r) => r.page), inp.delta);
      const P = refs.map((r) => r.page), distinct = new Set(P).size;
      const F = new S.Frames(['distinct']), view = H.box(0, 0, 800, 480);
      const left = pagePlot('pp', refs, { x: 44, y: 50, w: 420, h: 220 });
      const wsMax = Math.max(...ws.steps.map((s) => s.wss), 1);
      const wax = C().axes({ prefix: 'wa', x: 44, y: 330, w: 420, h: 100, xr: [0, Math.max(1, refs.length - 1)], yr: [0, Math.max(inp.delta, wsMax)], xticks: 0, yticks: [0, Math.max(inp.delta, wsMax)], yname: 'working-set size, Δ = ' + inp.delta, xname: 'reference', grid: false, tickSize: 12 });
      const wline = C().line(wax, 'wl', ws.steps.map((s, i) => [i, s.wss]), 'c0');
      const maxN = Math.min(inp.pages, 10);
      const cur = M().faultCurve(inp.policy, P, 1, maxN), curR = M().faultCurve(inp.policy, rand, 1, maxN);
      const fax = C().axes({ prefix: 'fa', x: 548, y: 50, w: 230, h: 220, xr: [1, maxN], yr: [0, inp.length], xticks: maxN > 6 ? 2 : 1, yticks: C().ticks(0, inp.length, 4), xname: 'frames', yname: 'faults (' + M().policyName(inp.policy) + ')', grid: false, tickSize: 12 });
      const strLines = [];
      for (let k = 0; k < P.length && strLines.length < 3; k += 24) strLines.push(P.slice(k, k + 24).join(' ') + (k + 24 < P.length && strLines.length === 2 ? ' …' : ''));
      const top = (extra) => [...left.items, H.text('kind', 0, 22, inp.kind === 'phases' ? 'phases of locality' : inp.kind === 'loop' ? 'a loop' : inp.kind === 'walk' ? 'a random walk' : 'random', 'p10-sum', 15), H.text('meta', 800, 22, inp.length + ' references over ' + inp.pages + ' pages, seed ' + inp.seed, 'tick', 13, 'end')].concat(extra || []);
      F.set('distinct', distinct);
      F.add({ items: top(strLines.map((l, i) => H.text('s' + i, 44, 340 + i * 22, l, 'mono', 12))), say: `${inp.length} references over ${inp.pages} pages (${distinct} of them used): ${inp.kind === 'random' ? 'every reference picks a page at random' : inp.kind === 'loop' ? 'a loop over a few neighbouring pages, with now and then a stray reference' : inp.kind === 'walk' ? 'each step moves to a nearby page, now and then jumping anywhere' : 'the program settles on a small set of pages, then moves to another set'}.`, meta: { phase: 'string', distinct, n: inp.length, pages: inp.pages, seed: inp.seed }, view, hl: { d: [0] } });
      F.add({ items: top([...wax.items, wline]), say: `Beneath it, the working-set size: the distinct pages among the last ${inp.delta} references. It averages ${H.f(ws.avg, 2)} and peaks at ${ws.max}, against ${distinct} pages used in all.`, meta: { phase: 'ws', avg: ws.avg, max: ws.max, distinct, delta: inp.delta }, view, hl: { d: [1] } });
      const pts = cur.map((c) => [c.n, c.faults]), ptsR = curR.map((c) => [c.n, c.faults]);
      const half = cur.find((c) => c.faults <= distinct + (inp.length - distinct) * 0.25), halfR = curR.find((c) => c.faults <= distinct + (inp.length - distinct) * 0.25);
      F.add({ items: top([...wax.items, wline, ...fax.items, C().line(fax, 'fr', ptsR, 'faint'), C().line(fax, 'fc', pts, 'c1'), ...pts.map(([x, y]) => C().dot(fax, 'fd' + x, x, y, 'c1', 3.5)), ...C().legend('lg', 548, 330, [{ text: 'this string', cls: 'c1' }, { text: 'random, same pages', cls: 'faint' }], { dir: 'col' })]), say: `Under ${M().policyName(inp.policy)}: with 1 frame this string faults ${cur[0].faults} times, with ${maxN} frames ${cur[maxN - 1].faults}. ` + (half ? `${H.plural(half.n, 'frame')} already cut the misses past the first touches to a quarter` : `Even ${H.plural(maxN, 'frame')} leave many misses past the first touches`) + (halfR ? `; the random string needs ${halfR.n}.` : '; the random string never gets there.'), meta: { phase: 'curve', first: cur[0].faults, last: cur[maxN - 1].faults, maxN, half: half ? half.n : null, halfR: halfR ? halfR.n : null, curve: cur.map((c) => c.faults), curveR: curR.map((c) => c.faults) }, view, hl: { d: [2] } });
      return { frames: F.list, def: H.def('Locality', ['temporal: a page used now is used again soon', 'spatial: its neighbours are used soon too', 'working set W(t, Δ): the distinct pages in the last Δ references', 'enough frames for the working set: few faults']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'ws', pick: 'option', ask: 'Will this string need fewer frames than a random one over the same pages to fault rarely?', options: ['yes', 'no, about the same', 'no, more'], answer: (fr) => { const m = fr[2].meta; const a = m.half === null ? 99 : m.half, b = m.halfR === null ? 99 : m.halfR; return a < b ? 'yes' : a === b ? 'no, about the same' : 'no, more'; }, explain: (fr) => fr[2].say },
    ],
    quiz: [
      { q: 'A loop walks through the same 4 pages again and again. With 4 frames, how many faults after the first pass?', options: ['none, apart from stray references', 'one each pass', 'four each pass', 'it depends on the seed only'], answer: 0, why: 'All four pages stay resident.' },
      { q: 'What does the working-set size measure?', options: ['the distinct pages among the last Δ references', 'the pages in memory', 'the faults so far', 'the size of the address space'], answer: 0, why: 'It estimates how many frames the process needs right now.' },
      { q: 'Why does a random reference string page so badly?', options: ['it has no locality: every page is as likely next', 'random strings are longer', 'LRU cannot run on it', 'it has more writes'], answer: 0, why: 'With no locality the frames hold the next page only by chance, frames / pages of the time.' },
      { q: 'A program moves from one phase to another. What happens to its working set?', options: ['it changes, and faults rise while the new set loads', 'it stays the same', 'it becomes empty', 'it doubles forever'], answer: 0, why: 'The new locality must be faulted in.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Traced from a C program
  // ---------------------------------------------------------------------------------------------------------------
  const PROGS = {
    rows: { label: 'Sum a grid by rows', src: 'int grid[16][16];\n\nint main(void) {\n  int r, c, sum = 0;\n  for (r = 0; r < 16; r++)\n    for (c = 0; c < 16; c++)\n      sum += grid[r][c];\n  return sum;\n}' },
    cols: { label: 'Sum the same grid by columns', src: 'int grid[16][16];\n\nint main(void) {\n  int r, c, sum = 0;\n  for (c = 0; c < 16; c++)\n    for (r = 0; r < 16; r++)\n      sum += grid[r][c];\n  return sum;\n}' },
    list: { label: 'Follow links through a pool', src: 'struct node { int val; int next; };\nstruct node pool[48];\n\nint main(void) {\n  int i, at = 0, sum = 0;\n  for (i = 0; i < 48; i++) {\n    pool[i].val = i;\n    pool[i].next = (i * 17 + 5) % 48;\n  }\n  for (i = 0; i < 48; i++) {\n    sum += pool[at].val;\n    at = pool[at].next;\n  }\n  return sum % 256;\n}' },
    recur: { label: 'Recursion that grows the stack', src: 'int depth(int n) {\n  char note[40];\n  note[0] = n;\n  if (n == 0) return note[0];\n  return depth(n - 1) + note[0];\n}\n\nint main(void) {\n  return depth(14) % 256;\n}' },
  };
  const traceOf = (prog, pageBytes, stack) => H.once('trace:' + prog + ':' + pageBytes + ':' + stack, () => {
    const src = PROGS[prog].src, t = V().traceC(src, { pageBytes });
    const stackBase = S.CLang.compile(src).stackBase;
    const acc = stack === 'with' ? t.accesses : t.accesses.filter((a) => a.addr < stackBase);
    const r = V().refsFromTrace(acc, pageBytes);
    return { t, acc, refs: r.refs, pages: r.pages, stackBase, all: t.accesses.length };
  });

  S.topic({
    id: 'vmem-refs-c', family: 'p11-refs', order: 20, title: 'A reference string from a C program',
    blurb: 'Run a small C program and record every address it reads and writes. Dividing each address by the page size gives its page, and runs of the same page collapse into one reference: the program\'s reference string. The same sum over a grid by rows touches each page once; by columns it hops between pages on every step. Locals can be left out, as if they lived in registers, or kept, as this machine stores them on the stack.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'cols', options: Object.entries(PROGS).map(([value, p]) => ({ value, label: p.label })) },
      { id: 'pageBytes', kind: 'choice', label: 'Page size', def: '128', options: ['64', '128', '256', '512'].map((value) => ({ value, label: value + ' B' })) },
      { id: 'stack', kind: 'choice', label: 'Locals', def: 'without', options: [{ value: 'without', label: 'in registers (stack left out)' }, { value: 'with', label: 'on the stack' }] },
      { id: 'policy', kind: 'choice', label: 'Policy', def: 'lru', options: POL4 },
      { id: 'frames', kind: 'number', label: 'Frames', def: 4, min: 1, max: 12 },
    ],
    presets: [
      { label: 'By columns, 128 B pages, 4 frames', values: {} },
      { label: 'By rows, the same machine', values: { prog: 'rows' } },
      { label: 'By columns, 512 B pages', values: { pageBytes: '512', frames: 2 } },
      { label: 'Links through a pool, 64 B pages', values: { prog: 'list', pageBytes: '64', frames: 3 } },
      { label: 'Recursion, stack kept', values: { prog: 'recur', stack: 'with', pageBytes: '64', frames: 3, policy: 'fifo' } },
    ],
    counters: [{ id: 'refs', label: 'references' }, { id: 'faults', label: 'faults' }],
    srcOf: (prog) => PROGS[prog].src,
    check: (inp) => (inp.prog === 'recur' && inp.stack !== 'with' ? 'This program keeps all its data on the stack: choose Locals: on the stack' : null),
    run(inp) {
      const pb = Number(inp.pageBytes), T0 = traceOf(inp.prog, pb, inp.stack), refs = T0.refs, n = refs.length;
      const F = new S.Frames(['refs', 'faults']), view = H.box(0, 0, 800, 480);
      const lines = PROGS[inp.prog].src.split('\n');
      const code = (hl) => lines.map((l, i) => H.text('ln' + i, 30, 50 + i * 21, l || ' ', 'p11-code' + (hl && hl.includes(i + 1) ? ' act' : ''), 13)).concat(lines.map((_, i) => H.text('lnn' + i, 22, 50 + i * 21, String(i + 1), 'tick', 12, 'end')));
      const reads = T0.acc.filter((a) => !a.write).length, writes = T0.acc.length - reads;
      const head = H.text('sum', 0, 22, PROGS[inp.prog].label + ', ' + pb + '-byte pages', 'p10-sum', 15);
      F.add({ items: [head, ...code([]), H.title('rt', 430, 50, 'what the run touched'), ...[['addresses recorded: ' + T0.acc.length], ['reads ' + reads + ', writes ' + writes], ['pages: ' + T0.pages.length + (T0.pages.length <= 10 ? ' (' + T0.pages.join(', ') + ')' : '')], [inp.stack === 'with' ? 'locals on the stack are kept' : (T0.all - T0.acc.length) + ' stack accesses left out']].map((l, i) => H.text('rt' + i, 430, 80 + i * 24, l[0], 'strong', 14))], say: `The program runs to the end and every load and store is recorded: ${T0.acc.length} addresses, ${reads} reads and ${writes} writes` + (inp.stack === 'with' ? '' : `, leaving out ${T0.all - T0.acc.length} accesses to locals on the stack`) + `. They fall in ${H.plural(T0.pages.length, 'page')} of ${pb} bytes.`, meta: { phase: 'source', acc: T0.acc.length, reads, writes, pages: T0.pages, left: T0.all - T0.acc.length, pb }, view, hl: { d: [0] } });
      // the first accesses, each with its page
      const first = T0.acc.slice(0, 12);
      const rows = first.map((a, i) => ({ key: 'a' + i, cls: '', cells: [a.line, a.addr, a.write ? 'write' : 'read', Math.floor(a.addr / pb)] }));
      F.add({ items: [head, ...code([...new Set(first.map((a) => a.line))]), ...T().table({ prefix: 'tr', x: 430, y: 60, title: 'the first accesses', cols: [{ name: 'line', w: 48 }, { name: 'address', w: 96 }, { name: 'r / w', w: 64 }, { name: 'page', w: 60 }], rows, rowH: 26 }).items, H.text('div', 430, 60 + 26 + rows.length * 26 + 24, 'page = ⌊address / ' + pb + '⌋', 'mono', 13)], say: `Each address becomes a page by dividing by ${pb}: address ${first[0].addr} is in page ${Math.floor(first[0].addr / pb)}` + (first.length > 1 ? `, address ${first[first.length - 1].addr} in page ${Math.floor(first[first.length - 1].addr / pb)}` : '') + `. Consecutive accesses to the same page collapse into one reference, which leaves ${n} references.`, meta: { phase: 'trace', first: first.map((a) => [a.addr, Math.floor(a.addr / pb), a.line]), n, pb }, view, hl: { d: [1, 2] } });
      F.set('refs', n);
      const run = M().replace(inp.policy, refs, inp.frames);
      const plot = pagePlot('pp', refs, { x: 380, y: 56, w: 400, h: 330 });
      const used = [...new Set(T0.acc.map((a) => a.line))];
      F.add({ items: [head, ...code(used), ...plot.items, H.text('pn', 800, 22, n + ' references, ' + T0.pages.length + ' pages', 'tick', 13, 'end')], say: `The reference string: ${n} references over ${H.plural(T0.pages.length, 'page')}, page against time.` + (inp.prog === 'cols' ? ' Down a column the program hops to the next row\'s page on every step.' : inp.prog === 'rows' ? ' Along each row the program stays on one page until it is used up.' : inp.prog === 'list' ? ' The links jump about the pool, so pages are revisited out of order.' : ' Each call goes one stack frame deeper, then the returns come back up.'), meta: { phase: 'refs', n, pages: T0.pages.length }, view, hl: { d: [2] } });
      F.set('faults', run.faults);
      const maxN = Math.min(12, Math.max(2, T0.pages.length + 1)), curve = M().faultCurve(inp.policy, refs, 1, maxN);
      const plot2 = pagePlot('pp', refs, { x: 380, y: 56, w: 400, h: 170 }, { faults: run.steps.map((s) => !s.hit) });
      const fax = C().axes({ prefix: 'fa', x: 380, y: 290, w: 400, h: 120, xr: [1, maxN], yr: [0, Math.max(1, n)], xticks: maxN > 6 ? 2 : 1, yticks: C().ticks(0, n, 4), xname: 'frames', yname: 'faults', grid: false, tickSize: 12 });
      F.add({ items: [head, ...code(used), ...plot2.items, ...fax.items, C().line(fax, 'fc', curve.map((c) => [c.n, c.faults]), 'c1'), ...curve.map((c) => C().dot(fax, 'fd' + c.n, c.n, c.faults, c.n === inp.frames ? 'act' : 'c1', c.n === inp.frames ? 6 : 3.5)), H.text('pn', 800, 22, M().policyName(inp.policy) + ', ' + H.plural(inp.frames, 'frame') + ': ' + H.plural(run.faults, 'fault'), 'tick', 13, 'end')], say: `Under ${M().policyName(inp.policy)} with ${H.plural(inp.frames, 'frame')} the string faults ${run.faults} times (the orange dots); ${T0.pages.length} of those ${T0.pages.length === 1 ? 'is' : 'are'} the first touches no number of frames can avoid. The curve below shows the faults for 1 to ${maxN} frames.`, meta: { phase: 'run', faults: run.faults, pages: T0.pages.length, maxN, curve: curve.map((c) => c.faults), frames: inp.frames }, view, hl: { d: [3] } });
      if (inp.prog === 'rows' || inp.prog === 'cols') {
        const other = inp.prog === 'rows' ? 'cols' : 'rows', T1 = traceOf(other, pb, inp.stack), r1 = M().replace(inp.policy, T1.refs, inp.frames);
        F.add({ items: [head, ...code(used), ...plot2.items, ...fax.items, C().line(fax, 'fc', curve.map((c) => [c.n, c.faults]), 'c1'), ...curve.map((c) => C().dot(fax, 'fd' + c.n, c.n, c.faults, c.n === inp.frames ? 'act' : 'c1', c.n === inp.frames ? 6 : 3.5)), H.text('pn', 800, 22, 'by ' + (other === 'rows' ? 'rows' : 'columns') + ': ' + H.plural(r1.faults, 'fault'), other === 'rows' ? 'good' : 'bad', 14, 'end')], say: `The same sum ${other === 'rows' ? 'by rows' : 'by columns'} makes ${T1.refs.length} references and ${H.plural(r1.faults, 'fault')} on the same machine, against ${run.faults} here: the loop order alone changes the paging.`, meta: { phase: 'other', n2: T1.refs.length, faults2: r1.faults, faults: run.faults }, view, hl: { d: [3] } });
      }
      return { frames: F.list, def: H.def('From addresses to pages', ['record every load and store', 'page = ⌊address / page size⌋', 'a run of the same page: one reference', 'run the string under a policy']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'trace', pick: 'option', ask: 'How many references will the collapsed string have, roughly?', options: (fr, i) => { const n = fr[i].meta.n; return [...new Set([n, Math.max(1, Math.round(n / 4)), n * 4])].sort((a, b) => a - b).map(String); }, answer: (fr, i) => String(fr[i].meta.n), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A 16 × 16 int grid (1024 bytes) is summed by rows with 128-byte pages. How many references does the grid give?', options: ['8: one a page', '256: one an element', '16: one a row', '2'], answer: 0, why: 'Consecutive elements share a page, so each page is one run.' },
      { q: 'The same grid summed by columns with 2 frames under LRU faults on…', options: ['nearly every reference', 'only the first touches', 'none', 'half the references'], answer: 0, why: 'Each step moves to another row\'s page; 2 frames cannot hold the 8 pages a column crosses.' },
      { q: 'Doubling the page size for the column sum…', options: ['halves the pages a column crosses', 'doubles the faults', 'changes nothing', 'removes the stack'], answer: 0, why: 'Two rows that shared nothing now share a page.' },
      { q: 'Why can stack accesses be left out of the string?', options: ['a real compiler keeps most locals in registers', 'the stack is never paged', 'the stack is in the TLB', 'they are all writes'], answer: 0, why: 'This machine stores every local; optimised code rarely touches memory for them.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
