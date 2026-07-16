// Virtual-memory engines, part 5: reference strings. Seeded generators with locality for the labs, a converter from
// a memory trace (addresses) to pages, and an adapter that runs a C program of the course's subset and records the
// addresses it reads and writes.
//   S.VM.refgen({kind, length, pages, seed, base, writeRatio, ...}) -> [page] | [{page, write}]
//     kind 'random'   uniform over pages base .. base + pages − 1
//          'loop'     a loop over loop pages (default 4) from a random start, with noise (default 0.1) the share of
//                     references that go anywhere
//          'phases'   phases of phaseLen references (default 20); each phase picks a locality of setSize pages
//                     (default 3) and stays in it with probability stay (default 0.9)
//          'walk'     a random walk: the next page is a neighbour (±1, ±2) with probability stay (0.85), else anywhere
//     writeRatio: when given, each reference is {page, write} and writes with that probability
//   S.VM.refsFromTrace(accesses: [addr | {addr, write}], pageBytes, {collapse}) -> {refs, pages}
//     collapse (default true) merges runs of references to the same page into one
//   S.VM.traceC(src, {pageBytes, maxSteps, stdin, argv, runtime}) -> {accesses: [{addr, n, write, line}], refs, pages, halted,
//     status, out, error}   runs the program alone with S.CLang.runProgram and records every access the machine
//     makes through the S.CLang.watch hook (any watcher already set is still called); the C library's start-up
//     and exit code (line 0) is left out unless runtime: true
(function (S) {
  'use strict';
  const V = (S.VM = S.VM || {});

  V.refgen = function (o) {
    const R = S.Mem.rng(o.seed === undefined ? 1 : o.seed), n = o.length || 20, P = o.pages || 8, base = o.base || 0, kind = o.kind || 'random';
    const any = () => Math.floor(R() * P);
    const out = [];
    if (kind === 'random') for (let i = 0; i < n; i++) out.push(any());
    else if (kind === 'loop') {
      const L = Math.min(P, o.loop || 4), start = Math.floor(R() * (P - L + 1)), noise = o.noise === undefined ? 0.1 : o.noise;
      for (let i = 0; i < n; i++) out.push(R() < noise ? any() : start + (i % L));
    } else if (kind === 'phases') {
      const len = o.phaseLen || 20, k = Math.min(P, o.setSize || 3), stay = o.stay === undefined ? 0.9 : o.stay;
      let set = [];
      for (let i = 0; i < n; i++) {
        if (i % len === 0) { set = []; while (set.length < k) { const p = any(); if (!set.includes(p)) set.push(p); } }
        out.push(R() < stay ? set[Math.floor(R() * k)] : any());
      }
    } else if (kind === 'walk') {
      const stay = o.stay === undefined ? 0.85 : o.stay;
      let p = any();
      for (let i = 0; i < n; i++) { out.push(p); if (R() < stay) { const d = [-2, -1, 1, 2][Math.floor(R() * 4)]; p = Math.min(P - 1, Math.max(0, p + d)); } else p = any(); }
    } else throw new Error('unknown kind ' + kind);
    const refs = out.map((p) => p + base);
    if (o.writeRatio === undefined) return refs;
    return refs.map((page) => ({ page, write: R() < o.writeRatio }));
  };

  V.refsFromTrace = function (acc, pageBytes, o) {
    const collapse = !o || o.collapse !== false, refs = [];
    for (const a of acc) {
      const addr = typeof a === 'object' ? a.addr : a, write = typeof a === 'object' && !!a.write, page = Math.floor(addr / pageBytes);
      const last = refs[refs.length - 1];
      if (collapse && last && last.page === page) { last.write = last.write || write; continue; }
      refs.push({ page, write });
    }
    return { refs, pages: [...new Set(refs.map((r) => r.page))].sort((a, b) => a - b) };
  };

  V.traceC = function (src, o) {
    o = o || {};
    const C = S.CLang;
    if (!C || !C.runProgram) throw new Error('the C engine is not loaded');
    const accesses = [], pageBytes = o.pageBytes || 256, before = C.watch;
    let r;
    C.watch = (addr, n, rw, st) => { if (o.runtime || (st && st.line > 0)) accesses.push({ addr, n, write: rw === 'w', line: st && st.line }); if (before) before(addr, n, rw, st); };
    try { r = C.runProgram(src, { max: o.maxSteps || 200000, stdin: o.stdin, argv: o.argv }); } finally { C.watch = before; }
    const t = V.refsFromTrace(accesses, pageBytes);
    return { accesses, refs: t.refs, pages: t.pages, halted: r.status !== null && !r.error, status: r.status, out: r.out, error: r.error ? String(r.error.msg || r.error.message || r.error) : null };
  };

  (S.engines = S.engines || []).push({ name: 'Reference strings' });
})(globalThis.Proses = globalThis.Proses || {});
