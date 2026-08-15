// The Virtual memory lab, part one: where the reference string comes from, and the runs every picture is drawn from.
// S.VMLab (VL):
//   VL.PROGS [{name, src}]                       example C programs (each original) for the editor
//   VL.parseRefs(['3', '5w', ..]) -> [{page, write}]   a typed string; w marks a write (throws a sentence)
//   VL.refs(v, seed) -> {refs: [{page, write}], source, trace?, error?}   typed, generated (S.VM.refgen with the
//     seed), or traced from the C program in the editor (S.VM.traceC), its first v.maxRefs references
//   VL.policies(v) -> [policy ids, the chosen ones, each once]
//   VL.runs(v, refs) -> [S.Mem.replace(policy, refs, frames, opts)..]
//   VL.label(r) '5' or '5w'
(function (S) {
  'use strict';
  const VL = (S.VMLab = S.VMLab || {});
  const M = () => S.Mem, V = () => S.VM;

  VL.PROGS = [
    { name: 'transpose.c', src: '/* copy a 8 x 16 grid into its 16 x 8 transpose:\n   a is read along its rows, b is written down its columns */\nint a[8][16];\nint b[16][8];\n\nint main(void) {\n    int i, j;\n    for (i = 0; i < 8; i++)\n        for (j = 0; j < 16; j++)\n            b[j][i] = a[i][j];\n    return 0;\n}\n' },
    { name: 'histogram.c', src: '/* count the values of a long array into 12 bins:\n   the data streams past once, the bins are used again and again */\nint data[160];\nint bins[12];\n\nint main(void) {\n    int i;\n    for (i = 0; i < 160; i++)\n        data[i] = (i * 7 + 3) % 12;\n    for (i = 0; i < 160; i++)\n        bins[data[i]]++;\n    return bins[5];\n}\n' },
    { name: 'three-streams.c', src: '/* z = x + y, element by element: three arrays walked\n   side by side, so three pages are in use at once */\nint x[64];\nint y[64];\nint z[64];\n\nint main(void) {\n    int i;\n    for (i = 0; i < 64; i++)\n        z[i] = x[i] + y[i];\n    return z[63];\n}\n' },
    { name: 'hop-table.c', src: '/* follow a chain of indexes that hops across a table:\n   little locality, so most references fault */\nint next[96];\n\nint main(void) {\n    int i, at = 0, steps = 0;\n    for (i = 0; i < 96; i++)\n        next[i] = (i * 37 + 11) % 96;\n    while (steps < 40) {\n        at = next[at];\n        steps++;\n    }\n    return at;\n}\n' },
  ];

  VL.label = (r) => String(r.page) + (r.write ? 'w' : '');
  VL.parseRefs = function (xs) {
    return xs.map((x) => {
      const m = /^(\d{1,4})(w?)$/i.exec(String(x).trim());
      if (!m) throw new Error('References: "' + x + '" should be a page number, with w after it for a write (like 7 or 7w)');
      return { page: +m[1], write: !!m[2] };
    });
  };

  VL.refs = function (v, seed) {
    if (v.source === 'typed') return { refs: VL.parseRefs(v.refs), source: 'typed' };
    if (v.source === 'gen') {
      const out = V().refgen({ kind: v.gen, length: v.length, pages: v.pages, seed, writeRatio: v.writes, loop: v.loopLen, setSize: v.setSize });
      return { refs: out.map((r) => (typeof r === 'object' ? r : { page: r, write: false })), source: 'gen' };
    }
    // traced from the program in the editor
    let ce = null;
    try { S.CLang.compile(v.src); } catch (e) { ce = e; }
    if (ce) return { refs: [], source: 'c', error: ce };
    const t = V().traceC(v.src, { pageBytes: v.pageBytes, maxSteps: 400000 });
    if (t.error && !t.accesses.length) return { refs: [], source: 'c', error: { msg: t.error } };
    let acc = t.accesses;
    if (!v.stack) { const sb = S.CLang.compile(v.src).stackBase; acc = acc.filter((a) => a.addr < sb); }
    const r = V().refsFromTrace(acc, v.pageBytes);
    // the line each reference came from: the first access of its run of one page
    const lines = [];
    let last = null;
    for (const a of acc) { const pg = Math.floor(a.addr / v.pageBytes); if (pg !== last) lines.push(a.line); last = pg; }
    return { refs: r.refs.slice(0, v.maxRefs), lines: lines.slice(0, v.maxRefs), all: r.refs.length, source: 'c', trace: t, accesses: acc.length, pages: r.pages };
  };

  VL.policies = function (v) {
    const out = [];
    for (const p of [v.pol1, v.pol2, v.pol3]) if (p && p !== 'none' && !out.includes(p)) out.push(p);
    return out;
  };
  VL.opts = (v) => ({ bits: v.agingBits || 8, tick: 1, reset: v.nruReset || 4 });
  VL.runs = (v, refs) => VL.policies(v).map((p) => M().replace(p, refs, v.frames, VL.opts(v)));
})(globalThis.Proses = globalThis.Proses || {});
