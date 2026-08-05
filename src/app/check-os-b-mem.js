// Memory exercise kinds: split an address into its fields, walk a page table entry by entry, and fill in a
// page-replacement table. Every expected value comes from the engines (S.Mem).
//   address-split      {vaBits, pageBytes, levels, bits?: [top..], pteBytes, va: number | '0x..'}
//                      Answer: {L1: '3', L2: '0x12', .., offset: '52'} (decimal, 0x hex or 0b binary)
//   page-walk          {vaBits, pageBytes, levels, bits?, pteBytes, paBits, map: [[vpn, pfn]..], tableFrame?, va,
//                       ask: ['index', 'entry', 'next'] (default all three)}
//                      Answer: {'L1|index', 'L1|entry' (the entry's physical address), 'L1|next' (the frame it
//                       holds), .., pa} (pa 'fault' when a level has no valid entry: then that level's next is 'fault')
//   replacement-table  {refs: [page..], frames: n, policy: 'fifo' | 'lru' | 'opt' | 'clock' | .., opts}
//                      Answer: {'f0|1': '7', .., 'fault|1': 'F'} (row fN: frame N after reference k, empty when
//                       the frame is free; row fault: F for a fault, empty for a hit; columns 1..refs.length)
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  const O = () => K.os;
  const cfgOf = (x) => S.Mem.config({ vaBits: x.vaBits, pageBytes: x.pageBytes, levels: x.levels, bits: x.bits, pteBytes: x.pteBytes || 8, paBits: x.paBits });
  const vaOf = (x) => (typeof x.va === 'bigint' ? x.va : O().int(x.va));
  const fieldName = (f) => (f.level < 0 ? 'offset' : f.name);

  // ---- address-split ---------------------------------------------------------------------------------------------
  O().kind('address-split', {
    fieldsOf(x) { return S.Mem.split(cfgOf(x), vaOf(x)).map((f) => ({ key: fieldName(f), label: fieldName(f) + ' (' + f.bits + ' bits)', want: BigInt(f.value), kind: 'int' })); },
    check(x, a) { return O().fields(x, this.fieldsOf(x), a); },
    solve(x) { return Object.fromEntries(this.fieldsOf(x).map((f) => [f.key, String(f.want)])); },
    lint(x) { const p = []; try { cfgOf(x); if (vaOf(x) === null) p.push('the address is not a number'); else if (vaOf(x) >= 2n ** BigInt(x.vaBits)) p.push('the address does not fit ' + x.vaBits + ' bits'); } catch (e) { p.push('the configuration is refused: ' + e.message); } return p; },
    wrongFrom(x) { const s = this.solve(x), k = Object.keys(s)[0]; return [Object.assign({}, s, { [k]: String(BigInt(s[k]) + 1n) })]; },
    example() {
      const x = { id: 'k-split', kind: 'address-split', title: 'Split a 16-bit address', level: 1, text: ['A machine has 16-bit virtual addresses, 256-byte pages and a two-level page table whose top level takes 2 bits. Split `0xB7E4` into its fields.'], vaBits: 16, pageBytes: 256, levels: 2, bits: [2, 6], pteBytes: 2, va: '0xB7E4',
        hints: ['256-byte pages leave 8 bits of offset; the 8 bits above it are the page number, 2 for the top level and 6 for the second.', 'Write 0xB7E4 in binary: 1011 0111 1110 0100.', 'L1 = 0b10 = 2, L2 = 0b110111 = 55, offset = 0xE4 = 228.'] };
      x.solution = this.solve(x);
      x.wrong = [{ L1: '2', L2: '0x37', offset: '0xE5' }, { L1: '0xB', L2: '0x7', offset: '0xE4' }];
      return x;
    },
  });

  // ---- page-walk ---------------------------------------------------------------------------------------------------
  O().kind('page-walk', {
    walk(x) { const cfg = cfgOf(x); const pt = S.Mem.build(cfg, (x.map || []).map(([v, p]) => [BigInt(v), BigInt(p)]), x.tableFrame !== undefined ? { tableFrame: x.tableFrame } : undefined); return S.Mem.translate(pt, vaOf(x)); },
    fieldsOf(x) {
      const t = this.walk(x), ask = x.ask || ['index', 'entry', 'next'], out = [];
      const reads = t.steps.filter((s) => s.kind === 'read' || s.kind === 'fault');
      t.fields.filter((f) => f.level >= 0).forEach((f, lv) => {
        const r = reads.find((s) => s.level === lv);
        if (!r) return;
        const L = 'L' + (lv + 1);
        if (ask.includes('index')) out.push({ key: L + '|index', label: L + ' index', want: BigInt(r.index !== undefined ? r.index : f.value), kind: 'int' });
        if (ask.includes('entry') && r.entryAddr !== undefined) out.push({ key: L + '|entry', label: L + ' entry address', want: BigInt(r.entryAddr), kind: 'int' });
        if (ask.includes('next')) out.push(r.valid === false || r.kind === 'fault' ? { key: L + '|next', label: L + ' entry holds', want: 'fault', kind: 'text' } : { key: L + '|next', label: L + ' entry holds (frame)', want: BigInt(r.next), kind: 'int' });
      });
      out.push(t.ok ? { key: 'pa', label: 'physical address', want: BigInt(t.pa), kind: 'int' } : { key: 'pa', label: 'physical address', want: 'fault', kind: 'text' });
      return out;
    },
    check(x, a) { return O().fields(x, this.fieldsOf(x), a); },
    solve(x) { return Object.fromEntries(this.fieldsOf(x).map((f) => [f.key, typeof f.want === 'bigint' ? O().hex(f.want) : f.want])); },
    lint(x) { const p = []; try { this.walk(x); } catch (e) { p.push('the walk does not run: ' + e.message); } return p; },
    wrongFrom(x) { const s = this.solve(x); return [Object.assign({}, s, { pa: s.pa === 'fault' ? '0x0' : 'fault' })]; },
    example() {
      const x = { id: 'k-walk', kind: 'page-walk', title: 'Walk a two-level table', level: 2, text: ['16-bit virtual addresses, 256-byte pages, a two-level table (1 bit, then 7 bits) with 2-byte entries. Virtual page 0x12 is in frame 0x7 and page 0x13 in frame 0x9. The tables sit in frames 0x100 and up. Walk the address `0x1234`: each level\'s index, the physical address of the entry read, the frame it holds, and the physical address in the end.'],
        vaBits: 16, pageBytes: 256, levels: 2, pteBytes: 2, map: [[0x12, 7], [0x13, 9]], va: '0x1234',
        hints: ['Split the address first: 1 bit, 7 bits, then 8 bits of offset.', 'An entry\'s address is the table\'s base plus index × entry size; the top table is in frame 0x100 (address 0x10000) and the second-level table in frame 0x101.', 'The last entry holds frame 0x7, so the physical address is 0x734.'] };
      x.solution = this.solve(x);
      x.wrong = [Object.assign({}, x.solution, { pa: '0x1234' }), Object.assign({}, x.solution, { 'L2|index': '19', 'L2|next': '0x9' })];
      return x;
    },
  });

  // ---- replacement-table -------------------------------------------------------------------------------------------
  const runRep = (x) => S.Mem.replace(x.policy || 'fifo', x.refs, x.frames, x.opts);
  const pageOf = (r) => (r && typeof r === 'object' ? r.page : r);
  K.tables = K.tables || {};
  /** the table layout, also used by the answer area: rows f0.. and fault, columns 1..n */
  K.tables.replacement = (x) => {
    const r = runRep(x), rows = [], expected = {};
    for (let f = 0; f < x.frames; f++) rows.push('f' + f);
    rows.push('fault');
    r.steps.forEach((st, i) => {
      for (let f = 0; f < x.frames; f++) expected['f' + f + '|' + (i + 1)] = st.frames[f] === null || st.frames[f] === undefined ? '' : String(st.frames[f]);
      expected['fault|' + (i + 1)] = st.hit ? '' : 'F';
    });
    const cols = x.refs.map((v, i) => String(i + 1));
    return { rows, cols, colHead: x.refs.map(pageOf).map(String), corner: 'ref', cell: (ri, ci) => rows[ri] + '|' + cols[ci], expected, kind: 'text', run: r };
  };
  O().kind('replacement-table', {
    check(x, a) {
      a = a || {};
      const SP = K.tables.replacement(x), cells = {};
      let wrong = 0, filled = 0, first = -1;
      for (const [key, want] of Object.entries(SP.expected)) {
        let got = String(a[key] === undefined || a[key] === null ? '' : a[key]).trim();
        if (got) filled++;
        if (key.startsWith('fault|')) got = /^(f|fault|x|1|yes|✗)$/i.test(got) ? 'F' : '';
        cells[key] = got.toLowerCase() === want.toLowerCase();
        if (!cells[key]) { wrong++; const col = +key.split('|')[1]; if (first < 0 || col < first) first = col; }
      }
      if (!filled) return { ok: false, cells, message: 'Fill in the table first: the page in each frame after each reference, and F under a fault.' };
      if (!wrong) return { ok: true, cells, message: 'Right: ' + O().plural(SP.run.faults, 'fault') + ' and ' + O().plural(SP.run.hits, 'hit') + '.' + (x.why ? ' ' + x.why : '') };
      return { ok: false, cells, message: 'Not quite: ' + O().plural(wrong, 'cell is', 'cells are') + ' not right (marked in red); the first wrong column is reference ' + first + ' (page ' + pageOf(x.refs[first - 1]) + ').', details: [x.whyNot || 'A frame keeps its page until that page is the victim; write F under every reference that faults.'] };
    },
    solve(x) { return Object.assign({}, K.tables.replacement(x).expected); },
    lint(x) { const p = []; if (!Array.isArray(x.refs) || !x.refs.length) p.push('no reference string'); if (!(x.frames >= 1 && x.frames <= 8)) p.push('frames must be 1 to 8'); if ((x.refs || []).length > 24) p.push('at most 24 references, so the table fits'); try { runRep(x); } catch (e) { p.push('the policy does not run: ' + e.message); } return p; },
    wrongFrom(x) { const s = this.solve(x), k = Object.keys(s).find((q) => q.startsWith('fault|')); return [Object.assign({}, s, { [k]: s[k] ? '' : 'F' })]; },
    example() {
      const x = { id: 'k-repl', kind: 'replacement-table', title: 'LRU with three frames', level: 2, text: ['Fill in the frames after each reference under LRU with 3 frames, and mark each fault with F.'], refs: [4, 2, 5, 2, 1, 4, 5, 2], frames: 3, policy: 'lru',
        hints: ['Empty frames fill in frame order first.', 'On a fault with every frame full, evict the page whose last use is longest ago.', 'Faults at references 1, 2, 3, 5, 6, 7 and 8: seven in all, and one hit.'] };
      x.solution = this.solve(x);
      const w = Object.assign({}, x.solution); w['fault|4'] = 'F';
      x.wrong = [w, Object.assign({}, x.solution, { 'f0|5': '4' })];
      return x;
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
