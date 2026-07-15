// Memory engines, part 1: hierarchical page tables of any shape. A configuration names the virtual-address bits,
// the page size, the levels and the bits each level's index takes (or lets them be chosen), and the size of an
// entry. build() lays out the sparse tables a set of mapped pages needs, in frames of their own; translate() walks
// them for one address and returns a trace (the fields, the table base at each level, the entry read, the memory
// accesses); usage() says how much memory the tables take, against one flat table for the same space.
//   S.Mem.config({vaBits, pageBytes, levels, bits?: [top..bottom], pteBytes, paBits}) -> cfg
//   S.Mem.autoSplit(indexBits, levels, perTable) -> [bits, top first]
//   S.Mem.split(cfg, va) -> [{name, level, bits, lo, hi, value}..., offset field]
//   S.Mem.build(cfg, [[vpn, pfn] | {vpn, pfn, level}..], {tableFrame}) -> pt
//     level: the level whose entry is the leaf (default the last); a leaf higher up maps a large page of
//     pageAt(cfg, level) bytes, and its vpn and pfn must be aligned to it (2 MiB and 1 GiB on x86-64 and Sv39/48)
//   S.Mem.translate(pt, va) -> {ok, pa, pfn, offset, pageBytes, large, fields, steps, accesses, fault}
//   S.Mem.usage(pt) -> {tables, perLevel, bytes, frames, flatBytes}
//   S.Mem.pageAt(cfg, level) -> the bytes a leaf entry at that level maps
//   S.Mem.count(n, word, plural), S.Mem.an(word), S.Mem.list(xs), S.Mem.are(xs): small words for the narration
//   S.Mem.PRESETS {x86-64, x86-64-5, sv39, sv48, x86-32}: {name, vaBits, paBits, pageBytes, levels, pteBytes, large}
//   S.Mem.preset(id) -> cfg (with cfg.preset and cfg.large: [{level, bytes, name}])
// Addresses, page numbers and frame numbers are BigInts (a 57-bit address does not fit a double); field values,
// counts and sizes in bytes are numbers.
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});
  const B = (v) => BigInt(v);
  const ONE = 1n;

  /** log2 of a power of two (a number), or −1 when it is not one */
  M.log2 = function (n) { for (let k = 0; k < 64; k++) if (2 ** k === n) return k; return -1; };
  /** a hex address padded to the digits `bits` needs, grouped by four: 0x7ffe_0123_4abc */
  M.hex = function (v, bits, group) {
    const d = Math.max(1, Math.ceil((bits || 0) / 4));
    let s = B(v).toString(16).padStart(d, '0');
    if (group !== false && s.length > 4) { const parts = []; for (let i = s.length; i > 0; i -= 4) parts.unshift(s.slice(Math.max(0, i - 4), i)); s = parts.join('_'); }
    return '0x' + s;
  };
  /** words for narration: count(3, 'page') '3 pages', count(1, 'copy', 'copies'); an('execute') 'an execute';
   *  list([1, 2, 3]) '1, 2 and 3'; are(xs) 'is' or 'are' */
  M.count = (n, word, many) => n + ' ' + (n === 1 ? word : many || word + 's');
  M.an = (word) => (/^[aeio]|^u(?!s|n[iu])|^8|^11\b|^18\b/i.test(String(word)) ? 'an ' : 'a ') + word;
  M.list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  M.are = (xs) => (xs.length === 1 ? 'is' : 'are');
  /** v in binary, `bits` wide */
  M.bin = (v, bits) => B(v).toString(2).padStart(bits, '0');
  /** a size in bytes the way a person says it: 512 B, 4 KiB, 1.5 MiB, 256 TiB */
  M.bytes = function (n) {
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    const s = v >= 100 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : String(+v.toPrecision(3));
    return s + ' ' + u[i];
  };

  /**
   * How the index bits are shared out when the student does not say: every level below the root gets as many
   * bits as a table one page in size has entries for (log2(page / entry)), and the root takes the rest, so every
   * table but the root fills exactly one page (10-10 for a 32-bit space with 4-byte entries, 9-9-9-9 for 48 bits
   * with 8-byte entries). When that leaves the root nothing, the bits are shared evenly and the root takes the
   * remainder.
   */
  M.autoSplit = function (indexBits, levels, perTable) {
    if (levels < 1) throw new Error('at least one level');
    if (perTable > 0 && indexBits - perTable * (levels - 1) >= 1) return [indexBits - perTable * (levels - 1)].concat(Array(levels - 1).fill(perTable));
    const base = Math.floor(indexBits / levels), rem = indexBits - base * levels;
    if (base < 1) throw new Error(indexBits + ' index bits cannot be shared among ' + levels + ' levels');
    return [base + rem].concat(Array(levels - 1).fill(base));
  };

  M.config = function (o) {
    const pageBytes = o.pageBytes || 4096, offBits = M.log2(pageBytes);
    if (offBits < 0) throw new Error('the page size must be a power of two');
    const pteBytes = o.pteBytes || 8;
    if (M.log2(pteBytes) < 0) throw new Error('the entry size must be a power of two');
    let bits = o.bits ? o.bits.slice() : null, vaBits = o.vaBits;
    if (bits) {
      const sum = bits.reduce((a, b) => a + b, 0);
      if (!vaBits) vaBits = offBits + sum;
      if (offBits + sum !== vaBits) throw new Error('the fields (' + bits.join('+') + ' + ' + offBits + ' offset) do not add up to ' + vaBits + ' bits');
    } else {
      if (!vaBits) throw new Error('give vaBits or bits');
      bits = M.autoSplit(vaBits - offBits, o.levels || 1, M.log2(pageBytes / pteBytes));
    }
    if (bits.some((b) => !(b >= 1 && b <= 30))) throw new Error('every level needs 1 to 30 index bits');
    const levels = bits.length;
    // lo: the lowest bit of each level's field (the root's field is the highest)
    const lo = [];
    let at = offBits;
    for (let i = levels - 1; i >= 0; i--) { lo[i] = at; at += bits[i]; }
    return { vaBits, paBits: o.paBits || Math.max(32, Math.min(52, vaBits)), pageBytes, offBits, pteBytes, levels, bits, lo, vpnBits: vaBits - offBits, tableBytes: bits.map((b) => 2 ** b * pteBytes) };
  };

  /** the index a level takes from a virtual address (or a page number, with fromVpn) */
  const indexOf = (cfg, i, va) => Number((B(va) >> B(cfg.lo[i])) & ((ONE << B(cfg.bits[i])) - ONE));

  M.split = function (cfg, va) {
    va = B(va);
    const out = cfg.bits.map((b, i) => ({ name: 'L' + (i + 1), level: i, bits: b, lo: cfg.lo[i], hi: cfg.lo[i] + b - 1, value: indexOf(cfg, i, va) }));
    out.push({ name: 'offset', level: -1, bits: cfg.offBits, lo: 0, hi: cfg.offBits - 1, value: Number(va & ((ONE << B(cfg.offBits)) - ONE)) });
    return out;
  };
  M.vpnOf = (cfg, va) => B(va) >> B(cfg.offBits);
  M.addr = (cfg, vpn, off) => (B(vpn) << B(cfg.offBits)) | B(off || 0);

  /**
   * The sparse tables for the mapped pages [[vpn, pfn]..]: a root, and below it only the tables some mapped page
   * needs. Tables take frames from opts.tableFrame upwards (a table larger than a page takes several, in a row).
   */
  M.build = function (cfg, map, opts) {
    opts = opts || {};
    let nextFrame = B(opts.tableFrame === undefined ? 0x100 : opts.tableFrame);
    const tables = [];
    const newTable = (level, prefix) => {
      const frames = Math.max(1, Math.ceil(cfg.tableBytes[level] / cfg.pageBytes));
      const t = { id: tables.length, level, frame: nextFrame, frames, prefix, entries: new Map() };
      nextFrame += B(frames);
      tables.push(t);
      return t;
    };
    const root = newTable(0, []);
    const seen = new Map();
    for (const m of map) {
      const v = Array.isArray(m) ? m[0] : m.vpn, f = Array.isArray(m) ? m[1] : m.pfn;
      const leafAt = Array.isArray(m) || m.level === undefined ? cfg.levels - 1 : m.level;
      const vpn = B(v), pfn = B(f), span = ONE << B(cfg.lo[leafAt] - cfg.offBits);
      if (leafAt < 0 || leafAt >= cfg.levels) throw new Error('no level ' + leafAt);
      if (vpn >> B(cfg.vpnBits)) throw new Error('page ' + vpn + ' is outside the ' + cfg.vaBits + '-bit space');
      if (vpn % span || pfn % span) throw new Error('a large page must start on a ' + M.bytes(M.pageAt(cfg, leafAt)) + ' boundary');
      if (seen.has(vpn)) throw new Error('page ' + vpn + ' is mapped twice');
      seen.set(vpn, pfn);
      let t = root;
      const va = vpn << B(cfg.offBits);
      for (let i = 0; i <= leafAt; i++) {
        const idx = indexOf(cfg, i, va);
        let e = t.entries.get(idx);
        if (i === leafAt) {
          if (e) throw new Error('page ' + vpn + ' overlaps a mapping made before');
          t.entries.set(idx, { valid: true, pfn, leaf: true, large: leafAt < cfg.levels - 1, pages: Number(span) });
          break;
        }
        if (e && e.leaf) throw new Error('page ' + vpn + ' lies inside a large page');
        if (!e) { const c = newTable(i + 1, t.prefix.concat(idx)); e = { valid: true, pfn: c.frame, child: c.id }; t.entries.set(idx, e); }
        t = tables[e.child];
      }
    }
    return { cfg, root: 0, tables, map: seen };
  };

  /** the physical address of a table's first byte */
  M.tableBase = (pt, t) => t.frame * B(pt.cfg.pageBytes);

  M.translate = function (pt, va) {
    const cfg = pt.cfg, H = (v) => M.hex(v, cfg.paBits);
    va = B(va);
    if (va >> B(cfg.vaBits)) throw new Error('the address does not fit ' + cfg.vaBits + ' bits');
    const fields = M.split(cfg, va), off = fields[fields.length - 1].value;
    const steps = [{ kind: 'split', fields, say: 'The ' + cfg.vaBits + '-bit address ' + M.hex(va, cfg.vaBits) + ' splits into ' + cfg.bits.join('-') + '-' + cfg.offBits + ': indexes ' + fields.slice(0, -1).map((f) => f.name + ' = ' + f.value).join(', ') + ' and offset ' + M.hex(off, cfg.offBits) + '.' }];
    let t = pt.tables[pt.root], accesses = 0;
    for (let i = 0; i < cfg.levels; i++) {
      const idx = fields[i].value, base = M.tableBase(pt, t), at = base + B(idx * cfg.pteBytes), e = t.entries.get(idx);
      accesses++;
      const step = { kind: 'read', level: i, table: t.id, frame: t.frame, base, index: idx, entryAddr: at, valid: !!(e && e.valid), access: accesses };
      if (!step.valid) {
        step.say = 'Level ' + (i + 1) + ': entry ' + idx + ' of the table at ' + H(base) + ' (read at ' + H(at) + ') is not valid, so the walk stops with a page fault after ' + accesses + ' memory access' + (accesses > 1 ? 'es' : '') + '.';
        steps.push(step);
        steps.push({ kind: 'fault', level: i, accesses, say: 'Page fault: no mapping for page ' + M.hex(M.vpnOf(cfg, va), cfg.vpnBits) + '; the kernel must map it or stop the process.' });
        return { ok: false, va, fields, steps, accesses, fault: { level: i, index: idx } };
      }
      step.next = e.pfn;
      step.leaf = !!e.leaf;
      step.child = e.child === undefined ? null : e.child;
      step.say = 'Level ' + (i + 1) + ': the table at ' + H(base) + ' + ' + idx + ' × ' + cfg.pteBytes + ' gives the entry at ' + H(at) + ', which holds frame ' + M.hex(e.pfn, 0, false) + (e.leaf ? ', the page itself.' : ', the next table.');
      steps.push(step);
      if (e.leaf) {
        const lowBits = cfg.lo[i], o2 = va & ((ONE << B(lowBits)) - ONE), pa = (e.pfn << B(cfg.offBits)) | o2, pb = 2 ** lowBits;
        accesses++;
        const big = i < cfg.levels - 1;
        steps.push({ kind: 'frame', pfn: e.pfn, offset: Number(o2), pa, accesses, large: big, pageBytes: pb, say: (big ? 'A large page of ' + M.bytes(pb) + ': the low ' + lowBits + ' bits are all offset. ' : '') + 'Frame ' + M.hex(e.pfn, 0, false) + ' joined to offset ' + M.hex(o2, big ? lowBits : cfg.offBits) + ' gives the physical address ' + H(pa) + ': ' + (i + 1) + ' table read' + (i ? 's' : '') + ' and the data itself, ' + accesses + ' memory accesses.' });
        return { ok: true, va, pa, pfn: e.pfn, offset: Number(o2), pageBytes: pb, large: big, fields, steps, accesses, fault: null };
      }
      t = pt.tables[e.child];
    }
    throw new Error('unreachable');
  };

  M.usage = function (pt) {
    const cfg = pt.cfg, perLevel = cfg.bits.map(() => 0);
    let bytes = 0, frames = 0;
    for (const t of pt.tables) { perLevel[t.level]++; bytes += cfg.tableBytes[t.level]; frames += t.frames; }
    return { tables: pt.tables.length, perLevel, bytes, frames, flatBytes: 2 ** cfg.vpnBits * cfg.pteBytes };
  };

  M.pageAt = (cfg, level) => 2 ** cfg.lo[level];

  M.PRESETS = {
    'x86-64': { name: 'x86-64, four levels', vaBits: 48, paBits: 52, pageBytes: 4096, levels: 4, pteBytes: 8, large: [1, 2] },
    'x86-64-5': { name: 'x86-64, five levels', vaBits: 57, paBits: 52, pageBytes: 4096, levels: 5, pteBytes: 8, large: [2, 3] },
    sv39: { name: 'RISC-V Sv39', vaBits: 39, paBits: 56, pageBytes: 4096, levels: 3, pteBytes: 8, large: [0, 1] },
    sv48: { name: 'RISC-V Sv48', vaBits: 48, paBits: 56, pageBytes: 4096, levels: 4, pteBytes: 8, large: [1, 2] },
    'x86-32': { name: '32-bit, two levels', vaBits: 32, paBits: 32, pageBytes: 4096, levels: 2, pteBytes: 4, large: [0] },
  };
  M.preset = function (id) {
    const p = M.PRESETS[id];
    if (!p) throw new Error('no preset ' + id);
    const cfg = M.config(p);
    cfg.preset = id;
    cfg.large = p.large.map((level) => ({ level, bytes: M.pageAt(cfg, level), name: M.bytes(M.pageAt(cfg, level)) }));
    return cfg;
  };

  (S.engines = S.engines || []).push({ name: 'Page tables' });
})(globalThis.Proses = globalThis.Proses || {});
