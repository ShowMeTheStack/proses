// Part 11, copy-on-write and mapped files. Copy-on-write after fork: two page tables pointing at shared frames with
// reference counts, a write that copies and a last sharer that just takes the frame back, and pages that start as
// the shared zero frame. mmap: a file's pages in the page cache, seen by processes that map it shared or private.
(function (S) {
  'use strict';
  const H = S.P10, V = () => S.VM, T = () => S.Kit.p11;
  /** engine sentences name processes as P1, P2, as the picture does */
  const pn = (s) => String(s).replace(/\b[Pp]rocess (\d)/g, 'P$1');
  const STATE = { rw: 'writable', cow: 'COW', zfod: 'demand-0' };

  // ---- copy-on-write ----
  const COW_TOK = /^(fork|exit[12]|[rw][12]\.\d+(=\d+)?)$/;
  /** run the script through the engine: the steps, or an error sentence */
  function cowRun(pages, script) {
    const C = V().cow(), steps = [];
    const init = pages.map((x) => (x === 'zero' ? 'zero' : Number(x)));
    steps.push(Object.assign(C.spawn(1, init), { tok: 'spawn' }));
    let forked = false, value = 10;
    for (const tok of script) {
      if (!COW_TOK.test(tok)) throw new Error('step "' + tok + '": fork, r1.0 (process 1 reads page 0), w2.1 or w2.1=7 (process 2 writes page 1), or exit2');
      if (tok === 'fork') { if (forked) throw new Error('only one fork: process 1 forks process 2'); forked = true; steps.push(Object.assign(C.fork(1, 2), { tok })); continue; }
      const m = /^(exit|r|w)(\d)(?:\.(\d+))?(?:=(\d+))?$/.exec(tok), pid = +m[2];
      if (pid === 2 && !forked) throw new Error('step "' + tok + '": process 2 does not exist before the fork');
      if (steps.some((s) => s.kind === 'exit' && s.pid === pid)) throw new Error('step "' + tok + '": process ' + pid + ' has exited');
      if (m[1] === 'exit') { steps.push(Object.assign(C.exit(pid), { tok })); continue; }
      const page = +m[3];
      if (page >= init.length) throw new Error('step "' + tok + '": there is no page ' + page + ' (pages 0 to ' + (init.length - 1) + ')');
      steps.push(Object.assign(m[1] === 'r' ? C.read(pid, page) : C.write(pid, page, m[4] === undefined ? value++ : +m[4]), { tok }));
    }
    return steps;
  }

  S.topic({
    id: 'vmem-cow', family: 'p11-cow', order: 10, title: 'Copy-on-write and zero-fill',
    blurb: 'fork would be slow if it copied every page, and wasted if the child calls exec at once. Instead the child gets a copy of the page table: both point at the same frames, each frame counts its references, and every writable page turns read-only and copy-on-write in both. The first write faults: if others still share the frame it is copied, if not, the writer simply gets it back writable. Pages that have never been touched start as demand-zero: a read maps the one shared zero frame, a write gets a fresh zeroed frame.',
    inputs: [
      { id: 'pages', kind: 'list', label: 'Process 1\'s pages (values, or zero)', def: ['5', '8', '3', 'zero'], min: 1, max: 6, check: (v) => (v.some((x) => x !== 'zero' && !/^\d+$/.test(x)) ? 'Pages: a number each, or zero for a demand-zero page' : null) },
      { id: 'script', kind: 'list', label: 'Steps (fork, r1.0, w2.1=7, exit2)', def: ['fork', 'r2.0', 'w2.0=9', 'w1.0=6', 'w1.1=4', 'r2.3', 'w2.3=1', 'exit2'], min: 1, max: 12 },
    ],
    check(inp) { try { cowRun(inp.pages, inp.script); return null; } catch (e) { return e.message; } },
    presets: [
      { label: 'Fork, then both write', values: {} },
      { label: 'The last sharer takes the frame back', values: { pages: ['5', '8'], script: ['fork', 'w2.0=1', 'w1.0=2', 'w2.1=3', 'w1.1=4'] } },
      { label: 'Zero-fill on demand', values: { pages: ['7', 'zero', 'zero', 'zero'], script: ['r1.1', 'r1.2', 'w1.1=5', 'w1.3=6'] } },
      { label: 'Fork then exit: nothing was copied', values: { pages: ['4', '6', '2'], script: ['fork', 'r2.0', 'r2.1', 'exit2', 'w1.0=9'] } },
      { label: 'A zero page shared across fork', values: { pages: ['3', 'zero'], script: ['r1.1', 'fork', 'r2.1', 'w2.1=8', 'w1.1=2'] } },
    ],
    counters: [{ id: 'copies', label: 'pages copied' }, { id: 'frames', label: 'frames in use' }],
    run(inp) {
      const steps = cowRun(inp.pages, inp.script), np = inp.pages.length;
      const F = new S.Frames(['copies', 'frames']), view = H.box(0, 0, 800, 470);
      const rh = Math.max(24, Math.min(33, Math.floor(360 / Math.max(np, ...steps.map((s) => s.snapshot.frames.length)))));
      const draw = (st) => {
        const snap = st.snapshot, items = [], top = 64;
        const tableOf = (pid, x) => {
          const pt = snap.procs[pid];
          if (!pt) { items.push(H.cellL('ghost' + pid, x, top, 216, 60, ['P' + pid, st.kind === 'exit' && st.pid === pid ? 'exited' : 'not forked yet'], 'p10-box ghost')); return null; }
          const rows = pt.map((e) => ({ key: 'e' + e.page, cls: st.pid === pid && st.page === e.page ? (st.kind === 'cow-copy' || st.kind === 'zero-fill' ? 'hot' : 'act') : '', cells: [e.page, e.frame === null ? '—' : 'f' + e.frame, { text: STATE[e.state], cls: 'name' + (e.state === 'cow' ? ' shared' : e.state === 'zfod' ? ' zero' : '') }] }));
          return T().table({ prefix: 'pt' + pid, x, y: top, rowH: rh, size: 14, title: 'P' + pid + ' page table', cols: [{ name: 'page', w: 56 }, { name: 'frame', w: 64 }, { name: 'state', w: 96 }], rows });
        };
        const t1 = tableOf(1, 0), t2 = tableOf(2, 584);
        if (t1) items.push(...t1.items);
        if (t2) items.push(...t2.items);
        const frows = snap.frames.map((f) => ({ key: 'f' + f.id, cls: f.id === st.frame ? (st.kind === 'cow-copy' || st.kind === 'zero-fill' ? 'good' : 'act') : f.id === st.from ? 'hot' : '', cells: ['f' + f.id, f.id === snap.zeroFrame ? 'zeros' : f.value, { text: f.refs, cls: f.refs > 1 ? 'shared' : '' }] }));
        const ft = T().table({ prefix: 'fr', x: 302, y: top, rowH: rh, size: 14, title: 'frames', cols: [{ name: 'frame', w: 64 }, { name: 'holds', w: 72 }, { name: 'refs', w: 60 }], rows: frows });
        items.push(...ft.items);
        // the mapping this step made or used: from the process's entry to the frame
        if (st.frame !== undefined && st.frame !== null && st.page !== undefined) {
          const src = st.pid === 1 ? t1 : t2, a = src && src.row('e' + st.page), b = ft.row('f' + st.frame);
          if (a && b) {
            const ya = a.y + rh / 2, yb = b.y + rh / 2;
            items.push(st.pid === 1 ? H.wire('w:map', [[216, ya], [259, ya], [259, yb], [302, yb]], 'act') : H.wire('w:map', [[584, ya], [541, ya], [541, yb], [498, yb]], 'act'));
          }
        }
        const inUse = snap.frames.filter((f) => f.id !== snap.zeroFrame).length;
        items.push(H.text('sum', 0, 24, (st.tok === 'spawn' ? 'process 1 starts' : st.tok) + ': ' + KIND[st.kind], 'p10-sum' + (st.kind === 'cow-copy' ? ' bad' : st.kind === 'cow-reuse' ? ' good' : ''), 15));
        items.push(H.text('cnt', 800, 24, snap.copies + ' copied · ' + inUse + ' frames in use', 'tick', 13, 'end'));
        items.push(H.text('leg', 0, 456, 'COW: shared, read-only until a write · demand-0: no frame yet · refs: page-table entries pointing at the frame', 'tick', 12));
        return { items, inUse };
      };
      steps.forEach((st) => {
        const d = draw(st);
        F.set('copies', st.snapshot.copies).set('frames', d.inUse);
        const nz = inp.pages.filter((x) => x === 'zero').length, nm = np - nz, ns = st.kind === 'fork' ? (st.snapshot.procs[1] || []).filter((e) => e.frame !== null).length : 0;
        const say = st.kind === 'spawn' ? `P1 starts with ${H.plural(np, 'page')}: ${nm} in frames of ${nm === 1 ? 'its' : 'their'} own and ${nz} demand-zero (no frame until touched).`
          : st.kind === 'fork' ? `P1 forks P2: nothing is copied. ${ns === 1 ? 'The one mapped page is' : 'The ' + ns + ' mapped pages are'} shared, every writable one now read-only and marked copy-on-write in both page tables.` : pn(st.say);
        F.add({ items: d.items, say, meta: { phase: st.kind, tok: st.tok, pid: st.pid, child: st.child, page: st.page, frame: st.frame, from: st.from, value: st.value, copies: st.snapshot.copies, inUse: d.inUse, snap: st.snapshot, np, ns, init: inp.pages.filter((x) => x !== 'zero').length, zeros: inp.pages.filter((x) => x === 'zero').length }, view, hl: { d: HL[st.kind] || [] } });
      });
      const last = steps[steps.length - 1].snapshot, d = draw(Object.assign({}, steps[steps.length - 1], { kind: 'end', tok: 'end', frame: null }));
      const naive = inp.script.includes('fork') ? inp.pages.filter((x) => x !== 'zero').length : 0;
      F.add({ items: d.items, say: `At the end: ${H.plural(last.copies, 'page')} copied` + (naive ? `, where an eager fork would have copied all ${H.plural(naive, 'mapped page')} at once` : '') + `; ${H.plural(d.inUse, 'frame')} in use.`, meta: { phase: 'end', copies: last.copies, naive, inUse: d.inUse }, view });
      return { frames: F.list, def: H.def('Copy-on-write', ['fork: share every frame, refs + 1', '  writable pages become read-only COW in both', 'write to a COW page: a fault', '  refs > 1: copy into a new frame, refs − 1', '  refs = 1: just make it writable again', 'demand-zero: read maps the zero frame', '  write gets a fresh zeroed frame', 'exit: refs − 1 on each frame; 0 frees it']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && /^w/.test(fr[i + 1].meta.tok), pick: 'option', ask: (fr, i) => `P${fr[i + 1].meta.pid} writes page ${fr[i + 1].meta.page}. What does the kernel do?`, options: ['copy the frame', 'make the frame writable, no copy', 'give it a fresh zeroed frame', 'nothing: the page is writable'], answer: (fr, i) => ({ 'cow-copy': 'copy the frame', 'cow-reuse': 'make the frame writable, no copy', 'zero-fill': 'give it a fresh zeroed frame', write: 'nothing: the page is writable' }[fr[i + 1].meta.phase]), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Right after fork with copy-on-write, how many pages have been copied?', options: ['none', 'all of them', 'only the stack', 'only the writable ones'], answer: 0, why: 'Only the page table is copied; frames are shared.' },
      { q: 'Two processes share a COW frame; one writes. Then the other writes the same page. What happens on the second write?', options: ['the frame is made writable without a copy', 'another copy is made', 'the process is killed', 'the first copy is discarded'], answer: 0, why: 'Its reference count is now 1: the last sharer just takes it back.' },
      { q: 'Why does a read of a demand-zero page not need a new frame?', options: ['it can map the shared zero frame read-only', 'reads never fault', 'the TLB holds zeros', 'it reads from swap'], answer: 0, why: 'All such pages read as zeros, so one read-only frame serves them all until someone writes.' },
      { q: 'A child forks and immediately calls exec. With copy-on-write, the cost of fork was mostly…', options: ['copying the page table', 'copying every page', 'reading the program from disk', 'zero-filling the heap'], answer: 0, why: 'No frame was copied, and exec throws the shared mappings away.' },
    ],
  });
  const KIND = { spawn: 'its own frames', fork: 'share everything', read: 'a plain read', 'zero-map': 'map the zero frame', write: 'a plain write', 'zero-fill': 'a fresh zeroed frame', 'cow-copy': 'copy on write', 'cow-reuse': 'last sharer, no copy', exit: 'frames released', end: 'the end' };
  const HL = { fork: [0, 1], 'cow-copy': [2, 3], 'cow-reuse': [2, 4], 'zero-map': [5], 'zero-fill': [6], exit: [7] };

  // ---- mmap ----
  const MM_TOK = /^(m[12][sp]|[rw][12]\.\d+(=\d+)?|[su][12])$/;
  function mmRun(file, script) {
    const Fm = V().mmap({ file: file.map(Number) }), steps = [], mapped = new Set();
    for (const tok of script) {
      if (!MM_TOK.test(tok)) throw new Error('step "' + tok + '": m1s or m2p (map shared or private), r1.0, w2.1=7, s1 (msync) or u1 (unmap)');
      const pid = +tok[1];
      if (tok[0] === 'm') { if (mapped.has(pid)) throw new Error('step "' + tok + '": process ' + pid + ' has mapped the file already'); mapped.add(pid); steps.push(Object.assign(Fm.map(pid, tok[2] === 's' ? 'shared' : 'private'), { tok })); continue; }
      if (!mapped.has(pid)) throw new Error('step "' + tok + '": process ' + pid + ' has not mapped the file');
      if (tok[0] === 's') { steps.push(Object.assign(Fm.msync(pid), { tok })); continue; }
      if (tok[0] === 'u') { mapped.delete(pid); steps.push(Object.assign(Fm.unmap(pid), { tok, mode: [...steps].reverse().find((s) => s.kind === 'map' && s.pid === pid).mode })); continue; }
      const m = /^([rw])\d\.(\d+)(?:=(\d+))?$/.exec(tok), page = +m[2];
      if (page >= file.length) throw new Error('step "' + tok + '": the file has pages 0 to ' + (file.length - 1));
      steps.push(Object.assign(m[1] === 'r' ? Fm.read(pid, page) : Fm.write(pid, page, m[3] === undefined ? 100 + steps.length : +m[3]), { tok }));
    }
    return steps;
  }

  S.topic({
    id: 'vmem-mmap', family: 'p11-cow', order: 20, title: 'Memory-mapped files',
    blurb: 'mmap puts a file into the address space: its pages come in on the first touch, into the page cache, and loads and stores replace read and write calls. A shared mapping writes into the cached page itself, so every process that maps it shared sees the change, and the dirty page reaches the file on msync or unmap. A private mapping is copy-on-write: the first store gives the process its own copy, which the file and everyone else never see.',
    inputs: [
      { id: 'file', kind: 'list', label: 'The file\'s pages', def: ['10', '20', '30', '40'], min: 1, max: 5, check: (v) => (v.some((x) => !/^\d+$/.test(x)) ? 'The file: a number a page' : null) },
      { id: 'script', kind: 'list', label: 'Steps (m1s, m2p, r1.0, w1.0=5, s1, u1)', def: ['m1s', 'm2s', 'r1.0', 'w1.0=11', 'r2.0', 's1', 'w2.2=33', 'u1', 'u2'], min: 1, max: 12 },
    ],
    check(inp) { try { mmRun(inp.file, inp.script); return null; } catch (e) { return e.message; } },
    presets: [
      { label: 'Two shared mappings', values: {} },
      { label: 'Private: a write never reaches the file', values: { script: ['m1p', 'm2s', 'r1.1', 'w1.1=99', 'r2.1', 'r1.1', 'u1', 'u2'] } },
      { label: 'Unmap writes the dirty pages back', values: { script: ['m1s', 'w1.2=7', 'w1.3=8', 'r1.0', 'u1'] } },
      { label: 'Private sees shared writes until it copies', values: { script: ['m1p', 'm2s', 'r1.0', 'w2.0=55', 'r1.0', 'w1.0=66', 'r2.0', 's2'] } },
    ],
    counters: [{ id: 'cached', label: 'pages cached' }, { id: 'writes', label: 'file writes' }],
    run(inp) {
      const steps = mmRun(inp.file, inp.script), np = inp.file.length;
      const F = new S.Frames(['cached', 'writes']), view = H.box(0, 0, 800, 470);
      const cw = 110, x0 = 170, X = (p) => x0 + p * (cw + 14);
      const rowY = { 1: 70, 2: 160, cache: 270, file: 380 };
      const draw = (st) => {
        const sn = st.snapshot, items = [];
        for (let p = 0; p < np; p++) items.push(H.text('ph' + p, X(p) + cw / 2, 50, 'page ' + p, 'tick', 13, 'middle'));
        const cached = new Map(sn.cache.map((c) => [c.page, c]));
        for (const pid of [1, 2]) {
          const mode = sn.maps[pid];
          items.push(H.cellL('pl' + pid, 0, rowY[pid], 150, 52, ['P' + pid, mode ? mode : 'not mapped'], 'p10-box ' + (mode ? H.pc(pid - 1) : 'ghost')));
          for (let p = 0; p < np; p++) {
            const own = mode === 'private' && sn.private[pid] && sn.private[pid][p] !== undefined;
            const seen = !mode ? '' : own ? sn.private[pid][p] : cached.has(p) ? cached.get(p).value : '—';
            const on = st.pid === pid && st.page === p;
            items.push(H.cellL('v' + pid + '_' + p, X(p), rowY[pid], cw, 52, own ? [String(seen), 'own copy'] : [String(seen)], 'p11-td' + (own ? ' hot' : '') + (on ? ' act' : '') + (!mode ? ' dim' : ''), 14));
          }
        }
        items.push(H.cellL('cl', 0, rowY.cache, 150, 52, ['page cache', 'in memory'], 'p10-box'));
        items.push(H.cellL('fl', 0, rowY.file, 150, 52, ['the file', sn.fileWrites + ' page writes'], 'p10-box'));
        for (let p = 0; p < np; p++) {
          const c = cached.get(p), loadedNow = c && st.page === p && (st.kind === 'read' || st.kind === 'write');
          items.push(H.cellL('c' + p, X(p), rowY.cache, cw, 52, c ? (c.dirty ? [String(c.value), 'dirty'] : [String(c.value)]) : ['—'], 'p11-td' + (c && c.dirty ? ' dirty' : '') + (loadedNow ? ' act' : '') + (!c ? ' muted' : ''), 14));
          const wrote = (st.pages || []).includes(p);
          items.push(H.cellL('f' + p, X(p), rowY.file, cw, 52, [String(sn.file[p])], 'p11-td' + (wrote ? ' good' : ''), 14));
          if (wrote) items.push(H.wire('w:wb' + p, [[X(p) + cw / 2, rowY.cache + 52], [X(p) + cw / 2, rowY.file]], 'hot'));
          if (st.fresh && st.page === p) items.push(H.wire('w:ld' + p, [[X(p) + cw / 2, rowY.file], [X(p) + cw / 2, rowY.cache + 52]], 'act'));
        }
        items.push(H.text('sum', 0, 24, st.tok + ': ' + st.line, 'p10-sum', 15));
        return items;
      };
      let prevCache = 0;
      steps.forEach((st) => {
        const sn = st.snapshot;
        st.fresh = sn.cache.length > prevCache && (st.kind === 'read' || st.kind === 'write');
        prevCache = sn.cache.length;
        let say = pn(st.say), line = st.kind;
        if (st.kind === 'msync' || st.kind === 'unmap') {
          const ps = st.pages || [];
          const wb = ps.length ? `${ps.length === 1 ? 'dirty page ' + ps[0] + ' is' : 'dirty pages ' + H.list(ps) + ' are'} written back to the file` : 'nothing is dirty, so the file is already up to date';
          say = st.kind === 'msync' ? `msync by P${st.pid}: ${wb}.` : st.mode === 'shared' ? `P${st.pid} unmaps the file: ${wb}.` : `P${st.pid} unmaps its private mapping: its own copies are thrown away and the file is untouched.`;
          line = ps.length ? 'write back page' + (ps.length > 1 ? 's ' : ' ') + ps.join(', ') : 'nothing to write';
        } else if (st.kind === 'map') line = 'map ' + st.mode;
        else line = (st.kind === 'read' ? 'reads ' : 'writes ') + 'page ' + st.page + (st.fresh ? ' (fault: loaded)' : '');
        st.line = line;
        F.set('cached', sn.cache.length).set('writes', sn.fileWrites);
        F.add({ items: draw(st), say, meta: { phase: st.kind, tok: st.tok, pid: st.pid, page: st.page, value: st.value, pages: st.pages || [], fresh: st.fresh, snap: sn, mode: st.mode }, view, hl: { d: st.kind === 'map' ? [0] : st.kind === 'read' ? [1] : st.kind === 'write' ? (sn.maps[st.pid] === 'shared' ? [2] : [4]) : [3] } });
      });
      const sn = steps[steps.length - 1].snapshot;
      const changed = sn.file.map((v, p) => [p, v]).filter(([p, v]) => v !== Number(inp.file[p]));
      F.add({ items: draw({ snapshot: sn, tok: 'end', line: sn.fileWrites + ' page writes to the file', kind: 'end' }), say: `At the end the file holds ${H.list(sn.file)}: ` + (changed.length ? `${H.plural(changed.length, 'page')} changed (${H.list(changed.map(([p]) => 'page ' + p))}), by shared stores that were written back.` : 'unchanged, since no shared store was written back.'), meta: { phase: 'end', file: sn.file, changed: changed.map(([p]) => p), n: changed.length }, view });
      return { frames: F.list, def: H.def('mmap', ['map: no page is read yet', 'first touch: a fault reads the page into the page cache', 'shared store: the cached page changes and is dirty', 'msync or unmap: dirty pages are written to the file', 'private store: copy-on-write, a copy of its own']) };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'read' && i > 0, pick: 'option', ask: (fr, i) => `P${fr[i + 1].meta.pid} reads page ${fr[i + 1].meta.page}. What value does it see?`, options: (fr, i) => { const sn = fr[i].meta.snap || fr[i + 1].meta.snap; const vals = new Set([fr[i + 1].meta.value]); for (const c of sn.cache) vals.add(c.value); for (const v of sn.file) vals.add(v); return [...vals].slice(0, 4).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.value), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Two processes map a file shared. One stores to a page. When does the other see it?', options: ['at once: they share the cached page', 'after msync', 'after unmap', 'never'], answer: 0, why: 'Both mappings point at the same page in the page cache.' },
      { q: 'A process maps a file private and writes a page. What reaches the file?', options: ['nothing', 'the page, on unmap', 'the page, on msync', 'the page, at once'], answer: 0, why: 'A private store goes to a copy-on-write copy of the process\'s own.' },
      { q: 'What does msync do for a shared mapping?', options: ['writes the dirty cached pages to the file', 'reads the file again', 'discards private copies', 'unmaps the file'], answer: 0, why: 'It makes the file match memory without waiting for unmap or eviction.' },
      { q: 'When is a mapped page first read from the file?', options: ['on its first touch, by a page fault', 'at mmap', 'at msync', 'at exec'], answer: 0, why: 'Mapping is lazy: demand paging brings each page in.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
