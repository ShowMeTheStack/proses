// The Memory lab, part one: the machine a setup describes. S.MemLab (ML) holds what the other parts share:
//   ML.ARCH {id: {label, va, pa, page, levels, pte, flags}}      the real layouts the presets fill in
//   ML.parseAddr('0x7fff_f00c:w') -> {va: BigInt, access: 'r' | 'w' | 'x'} | {error}
//   ML.parseHex('0x40_0000') -> BigInt | null
//   ML.cfg(v) -> S.Mem.config(..) for the setup (throws a sentence when the bits do not add up)
//   ML.regions(v, cfg) -> [{name, start: vpn, pages, perm, cls}]   typed, or a sparse or dense space laid out
//   ML.model(v) -> {cfg, regions, map: [{vpn, pfn, region}], pt, usage, hpt, ipt, resident, addrs, flags}
//     data frames come after the page tables' own frames; the inverted table holds the first `frames` pages
//   ML.flagBits(flags, entry) -> [0 | 1 per flag]   the flags an entry would carry, by the usual names
//   ML.check(v) -> 'why not' | null      every limit the engines and the drawing need, in one sentence
// Small words: ML.hx(v) hex with no padding, ML.h(text) a key-safe form.
(function (S) {
  'use strict';
  const ML = (S.MemLab = S.MemLab || {});
  const M = () => S.Mem;
  const B = (v) => BigInt(v);

  ML.ARCH = {
    'x86-64': { label: 'x86-64, four levels', va: 48, pa: 52, page: 4096, levels: 4, pte: 8, flags: ['P', 'RW', 'US', 'A', 'D', 'G', 'NX'] },
    'x86-64-5': { label: 'x86-64, five levels', va: 57, pa: 52, page: 4096, levels: 5, pte: 8, flags: ['P', 'RW', 'US', 'A', 'D', 'G', 'NX'] },
    sv39: { label: 'RISC-V Sv39', va: 39, pa: 56, page: 4096, levels: 3, pte: 8, flags: ['V', 'R', 'W', 'X', 'U', 'G', 'A', 'D'] },
    sv48: { label: 'RISC-V Sv48', va: 48, pa: 56, page: 4096, levels: 4, pte: 8, flags: ['V', 'R', 'W', 'X', 'U', 'G', 'A', 'D'] },
    'x86-32': { label: '32-bit, two levels', va: 32, pa: 32, page: 4096, levels: 2, pte: 4, flags: ['P', 'RW', 'US', 'A', 'D', 'G'] },
  };
  ML.PAGES = [256, 512, 1024, 2048, 4096, 8192, 16384, 65536, 2097152];
  ML.MAX_PAGES = 4096;

  ML.hx = (v) => '0x' + B(v).toString(16);
  ML.h = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, '_');
  ML.parseHex = function (t) {
    const s = String(t).trim().toLowerCase().replace(/_/g, '');
    if (/^0x[0-9a-f]+$/.test(s)) return B(s);
    if (/^\d+$/.test(s)) return B(s);
    return null;
  };
  ML.parseAddr = function (t) {
    const m = /^(.*?)(?::([rwx]))?$/i.exec(String(t).trim());
    const va = ML.parseHex(m[1]);
    if (va === null) return { error: '"' + t + '" is not an address (hex like 0x7fff_f00c, then :w for a write or :x to run it)' };
    return { va, access: (m[2] || 'r').toLowerCase() };
  };

  /** the bits per level: "auto" (S.Mem.autoSplit) or the numbers typed, top level first */
  ML.bitsOf = function (v) {
    const t = String(v.bits || 'auto').trim().toLowerCase();
    if (!t || t === 'auto') return null;
    return t.split(/[\s,+-]+/).filter(Boolean).map(Number);
  };
  ML.cfg = function (v) {
    const bits = ML.bitsOf(v), off = M().log2(v.page);
    if (bits) {
      if (bits.some((b) => !Number.isInteger(b))) throw new Error('Bits per level: whole numbers, top level first, or auto');
      if (bits.length !== v.levels) throw new Error('Bits per level: ' + bits.length + ' numbers for ' + v.levels + ' level' + (v.levels === 1 ? '' : 's'));
      const sum = bits.reduce((a, b) => a + b, 0);
      if (sum + off !== v.va) throw new Error('Bits per level: ' + bits.join(' + ') + ' + the ' + off + '-bit offset make ' + (sum + off) + ', not the ' + v.va + ' address bits');
    }
    if (v.va - off < v.levels) throw new Error('The ' + (v.va - off) + ' page-number bits cannot be shared among ' + v.levels + ' levels');
    const cfg = M().config({ vaBits: v.va, paBits: v.pa, pageBytes: v.page, levels: v.levels, bits: bits || undefined, pteBytes: v.pte });
    if (cfg.bits.some((b) => b > 22)) throw new Error('A level indexed by ' + Math.max(...cfg.bits) + ' bits would be a table of ' + M().bytes(2 ** Math.max(...cfg.bits) * v.pte) + ': use more levels (at most 22 bits a level here)');
    return cfg;
  };

  /** the regions of the address space, as page numbers */
  ML.regions = function (v, cfg) {
    const top = 1n << B(cfg.vpnBits), pg = B(cfg.pageBytes), cap = (n) => Math.max(1, Math.min(n, ML.MAX_PAGES));
    if (v.space === 'typed') {
      return (v.regions || []).map((r, i) => ({ name: r.name, start: (ML.parseHex(r.start) || 0n) / pg, pages: r.pages, perm: r.perm, cls: 'p' + (i % 6) }));
    }
    const n = cap(v.n);
    if (v.space === 'dense') return [{ name: 'data', start: 0n, pages: n, perm: 'rw', cls: 'p1' }];
    // sparse: code low, a heap above it, a library in the middle, the stack at the top, the way a process looks
    const at = (addr) => B(addr) / pg;
    let code = at(0x400000), heap = at(0x600000);
    if (code + 4n >= top / 4n) { code = 1n; heap = top / 8n > 8n ? top / 8n : 6n; }
    const lib = top / 4n, stack = top - 4n;
    const out = [{ name: 'code', start: code, pages: 4, perm: 'rx', cls: 'p0' }, { name: 'heap', start: heap, pages: Math.max(1, n), perm: 'rw', cls: 'p1' }];
    if (lib > heap + B(n) + 4n && lib + 4n < stack) out.push({ name: 'library', start: lib, pages: 3, perm: 'rx', cls: 'p2' });
    if (stack > heap + B(n)) out.push({ name: 'stack', start: stack, pages: 4, perm: 'rw', cls: 'p3' });
    return out;
  };

  /** the flags an entry carries, by name: valid, the permissions, accessed, dirty; others clear */
  ML.flagBits = function (flags, e) {
    const riscv = flags.some((f) => f.toUpperCase() === 'R');
    return flags.map((f) => {
      const n = f.toUpperCase();
      if (n === 'P' || n === 'V') return e.valid ? 1 : 0;
      if (!e.valid) return 0;
      // a pointer to the next table: RISC-V marks it by R = W = X = 0; x86 sets RW, US and A on the way down
      if (!e.leaf) return riscv ? 0 : n === 'RW' || n === 'US' || n === 'A' ? 1 : 0;
      const p = e.perm || 'rw';
      if (n === 'R') return 1;
      if (n === 'W' || n === 'RW') return p.includes('w') ? 1 : 0;
      if (n === 'X') return p.includes('x') ? 1 : 0;
      if (n === 'NX' || n === 'XD') return p.includes('x') ? 0 : 1;
      if (n === 'U' || n === 'US') return 1;
      if (n === 'A') return 1;
      if (n === 'D') return e.dirty ? 1 : 0;
      return 0;
    });
  };

  ML.model = function (v) {
    const cfg = ML.cfg(v), regions = ML.regions(v, cfg);
    const pages = [];
    regions.forEach((r, k) => { for (let j = 0; j < r.pages; j++) pages.push({ vpn: r.start + B(j), region: k }); });
    // the tables first (they need frames of their own), then the data frames after them
    const probe = M().build(cfg, pages.map((p, i) => [p.vpn, B(i)]), { tableFrame: 1 });
    const tableFrames = M().usage(probe).frames, base = 1 + tableFrames;
    const map = pages.map((p, i) => ({ vpn: p.vpn, pfn: B(base + i), region: p.region }));
    const pt = M().build(cfg, map.map((m) => [m.vpn, m.pfn]), { tableFrame: 1 });
    const usage = M().usage(pt);
    const byVpn = new Map(map.map((m) => [m.vpn, m]));
    let hpt = null, ipt = null, resident = null;
    {
      hpt = M().hpt({ buckets: v.buckets, pageBytes: cfg.pageBytes, vaBits: cfg.vaBits, entryBytes: 2 * cfg.pteBytes, bucketBytes: cfg.pteBytes });
      for (const m of map) hpt.insert(Number(m.vpn), Number(m.pfn));
    }
    {
      // the inverted table: one entry a physical frame; this process's pages sit in frames 0, 1, 2, .. as far as they go
      ipt = M().ipt({ frames: v.frames, anchors: v.buckets, pageBytes: cfg.pageBytes, vaBits: cfg.vaBits, entryBytes: cfg.pteBytes, anchorBytes: 4 });
      resident = new Map();
      map.slice(0, v.frames).forEach((m, f) => { ipt.place(f, 1, Number(m.vpn)); resident.set(m.vpn, f); });
    }
    const addrs = (v.addrs || []).map((t) => ML.parseAddr(t));
    return { cfg, regions, map, byVpn, pt, usage, hpt, ipt, resident, addrs, flags: (v.flags || []).map(String), tableFrames };
  };

  /** every limit, in one sentence (the shell shows it under the setup and does not run) */
  ML.check = function (v) {
    if (v.mode === 'alloc') return S.MemLab.checkAlloc ? S.MemLab.checkAlloc(v) : null;
    let cfg;
    try { cfg = ML.cfg(v); } catch (e) { return e.message; }
    if (v.pa < cfg.offBits + 1) return 'Physical address bits: at least ' + (cfg.offBits + 1) + ' with ' + M().bytes(cfg.pageBytes) + ' pages';
    const pfnBits = v.pa - cfg.offBits, room = v.pte * 8;
    if (pfnBits + (v.flags || []).length > room) return 'A ' + v.pte + '-byte entry has ' + room + ' bits: a ' + pfnBits + '-bit frame number and ' + (v.flags || []).length + ' flags do not fit';
    if (v.tlb > 0 && v.ways > 0 && v.tlb % v.ways) return 'TLB: ' + v.tlb + ' entries cannot be split into sets of ' + v.ways + ' ways';
    if (v.tlb > 0 && v.ways > v.tlb) return 'TLB: ' + v.ways + ' ways need at least ' + v.ways + ' entries';
    let regions;
    try { regions = ML.regions(v, cfg); } catch (e) { return e.message; }
    if (!regions.length) return 'Regions: map at least one region';
    const top = 1n << B(cfg.vpnBits);
    let total = 0;
    const spans = [];
    for (const r of regions) {
      if (v.space === 'typed') {
        const s = ML.parseHex((v.regions.find((x) => x.name === r.name) || {}).start);
        if (s === null) return 'Regions: ' + r.name + ' needs a start address in hex, like 0x40_0000';
        if (s % B(cfg.pageBytes)) return 'Regions: ' + r.name + ' starts at ' + ML.hx(s) + ', not on a ' + M().bytes(cfg.pageBytes) + ' page boundary';
      }
      if (r.start + B(r.pages) > top) return 'Regions: ' + r.name + ' runs past the top of the ' + cfg.vaBits + '-bit space';
      spans.push([r.start, r.start + B(r.pages), r.name]);
      total += r.pages;
    }
    spans.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) return 'Regions: ' + spans[i - 1][2] + ' and ' + spans[i][2] + ' overlap';
    if (total > ML.MAX_PAGES) return 'Regions: ' + total + ' pages in all; at most ' + ML.MAX_PAGES + ' here';
    // physical memory must hold the tables and the pages
    const est = M().usage(M().build(cfg, spans.flatMap(([a, b]) => { const out = []; for (let p = a; p < b; p++) out.push([p, 0n]); return out; }).map((m, i) => [m[0], B(i)]), { tableFrame: 1 })).frames;
    const phys = 2 ** Math.min(52, v.pa - cfg.offBits);
    if (1 + est + total > phys) return 'Physical memory has ' + phys + ' frames of ' + M().bytes(cfg.pageBytes) + ': too few for ' + total + ' pages and ' + est + ' frames of tables';
    if (v.frames > phys) return 'Inverted table: ' + v.frames + ' frames, but ' + v.pa + ' physical address bits give only ' + phys;
    for (const t of v.addrs || []) {
      const a = ML.parseAddr(t);
      if (a.error) return 'Addresses: ' + a.error;
      if (a.va >> B(cfg.vaBits)) return 'Addresses: ' + t + ' does not fit ' + cfg.vaBits + ' bits';
    }
    return null;
  };
})(globalThis.Proses = globalThis.Proses || {});
