// The C subset's memory: one byte array per process, with a shadow byte for each byte that says what may be done
// with it, and the heap's allocator. Every load and store is checked, so out-of-bounds accesses (into a red zone
// between objects), use after free, a write to a string literal and reads of memory never written are caught.
//   shadow states S.CLang.SH: NOACC 0 (red zone, heap header, unallocated), UNINIT 1, OK 2, FREED 3,
//     DEAD 4 (a returned function's frame), RO 5 (a string literal)
//   S.CLang.load(st, addr, n, signed) / store(st, addr, n, v, signed)     n bytes as an integer (the kernel's view)
//   S.CLang.ld(st, addr, kind) / st_(st, addr, kind, v)                     by kind: c uc s us i u l ul p f d b
//   S.CLang.readStr(st, addr, max), readBytes(st, addr, n), writeBytes(st, addr, bytes), writeStr(st, addr, s)
//   S.CLang.copyMem(st, dst, src, n)  (with the shadow, as memcpy does)    S.CLang.fill(st, addr, n, byte)
//   S.CLang.watch = fn(addr, n, 'r' | 'w', st): when set, called on every access the machine makes (a kernel's
//   footprint of a step, for partial-order reduction)
// The heap (first fit, blocks with 16-byte headers, a free list kept in address order, neighbours coalesced):
//   header at h: [size of the whole block | flags (1 used, 2 a thread's stack, 4 a variable-length array)]
//                [for a free block: the next free block's header (0 ends the list); for a used one: the size asked]
//   the list's head is the C library's word at S.CLang.LIBC.heap. The payload starts at h + 16.
//   S.CLang.malloc(st, n, flags) -> addr | 0     S.CLang.free(st, addr, at)     S.CLang.realloc(st, addr, n, at)
//   S.CLang.heapBlocks(st, prog) -> [{h, addr, size, cap, req, free, kind, meta}]   S.CLang.freeList(st) -> [h...]
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const SH = (C.SH = { NOACC: 0, UNINIT: 1, OK: 2, FREED: 3, DEAD: 4, RO: 5 });
  const POISON = (C.POISON = 0xbe);
  const HDR = 16, MIN = 32;
  const KBY = { 1: ['uc', 'c'], 2: ['us', 's'], 4: ['u', 'i'], 8: ['ul', 'l'] };
  const SIZE = { c: 1, uc: 1, b: 1, s: 2, us: 2, i: 4, u: 4, f: 4, l: 8, ul: 8, p: 8, d: 8 };
  C.KSIZE = SIZE;

  /** a memory fault: the machine adds the place and names the object */
  const fault = (ub, addr, n, write, extra) => new C.CError(0, ub, 0, Object.assign({ kind: 'ub', ub, addr, n, write, signal: ub === 'div0' ? 8 : 11 }, extra || {}));
  C.fault = fault;

  /** check an access of n bytes at a; a write marks them initialised */
  // older consumers wrap S.CLang.load and store to see accesses: they are told too (the official hook is C.watch)
  let inWrap = false;
  const LOAD0 = (st, a, n, sg) => (inWrap ? 0 : C.ld(st, a, KBY[n][sg ? 1 : 0]));
  const STORE0 = (st, a, n, v, sg) => (inWrap ? 0 : C.st_(st, a, KBY[n][sg ? 1 : 0], v));
  function notify(st, a, n, write) {
    if (C.watch) C.watch(a, n, write ? 'w' : 'r', st);
    const f = write ? C.store : C.load;
    if (!inWrap && f !== (write ? STORE0 : LOAD0)) {
      const m = KBY[n] ? n : 1;
      inWrap = true;
      try { if (write) f(st, a, m, 0, 0); else f(st, a, m, 0); } finally { inWrap = false; }
    }
  }
  function check(st, a, n, write) {
    const M = st.M;
    notify(st, a, n, write);
    if (typeof a !== 'number' || a < 3840 || a + n > M.mem.length) throw fault(a === 0 ? 'null' : 'wild', a, n, write);
    const sh = M.sh;
    let s = sh[a];
    if (n === 1 ? s === 2 : (s === 2 && sh[a + n - 1] === 2 && (n <= 2 || (sh[a + 1] === 2 && sh[a + 2] === 2 && (n <= 4 || (sh[a + 3] === 2 && sh[a + 4] === 2 && sh[a + 5] === 2 && sh[a + 6] === 2)))))) return;
    for (let i = 0; i < n; i++) {
      s = sh[a + i];
      if (s === 2) continue;
      if (s === 1) {
        if (write) continue;
        // memory the machine never wrote still holds the poison byte; if something else wrote it, it counts
        let poisoned = false; for (let j = 0; j < n; j++) if (sh[a + j] === 1 && M.mem[a + j] === POISON) poisoned = true;
        if (poisoned) throw fault('uninit', a, n, false);
        for (let j = 0; j < n; j++) if (sh[a + j] === 1) sh[a + j] = 2;
        return;
      }
      if (s === 5) { if (write) throw fault('ro-write', a, n, true); continue; }
      throw fault(s === 3 ? 'uaf' : s === 4 ? 'dead-stack' : 'oob', a + i, n, write, { at: a });
    }
    if (write) sh.fill(2, a, a + n);
  }
  C.check = check;

  C.ld = function (st, a, k) {
    const n = SIZE[k];
    check(st, a, n, false);
    const m = st.M.mem;
    switch (k) {
      case 'c': return (m[a] << 24) >> 24;
      case 'uc': return m[a];
      case 'b': return m[a] ? 1 : 0;
      case 's': return ((m[a] | (m[a + 1] << 8)) << 16) >> 16;
      case 'us': return m[a] | (m[a + 1] << 8);
      case 'i': return m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24);
      case 'u': return (m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) >>> 0;
      case 'f': return dv(st).getFloat32(a, true);
      case 'd': return dv(st).getFloat64(a, true);
    }
    const lo = (m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) >>> 0;
    const hi = m[a + 4] | (m[a + 5] << 8) | (m[a + 6] << 16) | (m[a + 7] << 24);
    if (k === 'l') { if (hi >= -2097152 && hi < 2097152) return hi * 4294967296 + lo; return C.I64.norm((BigInt(hi) << 32n) | BigInt(lo)); }
    const uh = hi >>> 0;
    if (uh < 2097152) return uh * 4294967296 + lo;
    return C.I64.norm((BigInt(uh) << 32n) | BigInt(lo));
  };
  const dv = (st) => { const M = st.M; if (!M.dv || M.dv.buffer !== M.mem.buffer) M.dv = new DataView(M.mem.buffer, M.mem.byteOffset, M.mem.byteLength); return M.dv; };
  /** store v as kind k; returns the value as it reads back */
  C.st_ = function (st, a, k, v) {
    const n = SIZE[k];
    check(st, a, n, true);
    const m = st.M.mem;
    switch (k) {
      case 'f': dv(st).setFloat32(a, Number(v), true); return Math.fround(Number(v));
      case 'd': dv(st).setFloat64(a, Number(v), true); return Number(v);
      case 'b': v = v != 0 ? 1 : 0; m[a] = v; return v; // eslint-disable-line eqeqeq
    }
    v = C.I64.wrap(v, k);
    if (n === 8) {
      let lo, hi;
      if (typeof v === 'number') { lo = ((v % 4294967296) + 4294967296) % 4294967296; hi = Math.floor(v / 4294967296); }
      else { const u = BigInt.asUintN(64, v); lo = Number(u & 0xffffffffn); hi = Number(u >> 32n); }
      for (let i = 0; i < 4; i++) { m[a + i] = (lo >>> (8 * i)) & 255; m[a + 4 + i] = (hi >>> (8 * i)) & 255; }
      return v;
    }
    for (let i = 0; i < n; i++) m[a + i] = (v >>> (8 * i)) & 255;
    return v;
  };
  C.load = LOAD0;
  C.store = STORE0;

  C.readStr = function (st, a, max) {
    let s = '';
    const lim = max === undefined ? 1 << 20 : max;
    for (let i = 0; i < lim; i++) {
      let c;
      try { c = C.ld(st, a + i, 'uc'); } catch (e) { if (e.ub === 'oob' || e.ub === 'uninit') { e.unterminated = i; e.strAt = a; } throw e; }
      if (!c) return s;
      s += String.fromCharCode(c);
    }
    return s;
  };
  C.readBytes = function (st, a, n) { if (n > 0) check(st, a, n, false); return st.M.mem.slice(a, a + n); };
  C.writeBytes = function (st, a, bytes) { const n = bytes.length; if (n > 0) { check(st, a, n, true); st.M.mem.set(bytes, a); } return n; };
  C.writeStr = function (st, a, s) { const b = new Uint8Array(s.length + 1); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return C.writeBytes(st, a, b); };
  C.fill = function (st, a, n, byte) { if (n > 0) { check(st, a, n, true); st.M.mem.fill(byte & 255, a, a + n); } };
  /** memcpy: the bytes and their shadow (copying memory never written is allowed; using it later is not) */
  C.copyMem = function (st, dst, src, n) {
    if (n <= 0) return;
    const M = st.M;
    rangeOk(st, src, n, false); rangeOk(st, dst, n, true);
    M.mem.copyWithin(dst, src, src + n);
    M.sh.copyWithin(dst, src, src + n);
    for (let i = 0; i < n; i++) if (M.sh[dst + i] === 5) M.sh[dst + i] = 2;
  };
  /** every byte of a range may be touched (uninitialised is fine: it is copied as it is) */
  function rangeOk(st, a, n, write) {
    const M = st.M;
    notify(st, a, n, write);
    if (typeof a !== 'number' || a < 3840 || a + n > M.mem.length) throw fault(a === 0 ? 'null' : 'wild', a, n, write);
    for (let i = 0; i < n; i++) {
      const s = M.sh[a + i];
      if (s === 1 || s === 2) continue;
      if (s === 5) { if (write) throw fault('ro-write', a + i, n, true, { at: a }); continue; }
      throw fault(s === 3 ? 'uaf' : s === 4 ? 'dead-stack' : 'oob', a + i, n, write, { at: a });
    }
  }
  C.rangeOk = rangeOk;

  // ---- the heap ---------------------------------------------------------------------------------------------
  const rd = (M, a) => { const m = M.mem; return ((m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) >>> 0) + (m[a + 4] | (m[a + 5] << 8) | (m[a + 6] << 16)) * 4294967296; };
  const wr = (M, a, v) => { const m = M.mem; const lo = v % 4294967296, hi = Math.floor(v / 4294967296); for (let i = 0; i < 4; i++) { m[a + i] = (lo >>> (8 * i)) & 255; m[a + 4 + i] = (hi >>> (8 * i)) & 255; } };
  C.heapWord = rd;
  /** an empty heap: one free block over the whole arena */
  C.heapInit = function (M, prog) {
    const h = prog.heapBase, size = prog.heapEnd - prog.heapBase;
    if (size < 32) { wr(M, C.LIBC.heap, 0); return; }
    M.sh.fill(0, h, prog.heapEnd);
    wr(M, h, size); wr(M, h + 8, 0); wr(M, C.LIBC.heap, h);
  };
  const head = (M) => rd(M, C.LIBC.heap);
  C.freeList = function (st) {
    const M = st.M, out = [];
    for (let h = head(M), n = 0; h && n < 100000; h = rd(M, h + 8), n++) out.push(h);
    return out;
  };
  C.malloc = function (st, n, flags) {
    const M = st.M;
    n = Number(n);
    if (!(n >= 0) || n > 1 << 30) return 0;
    const need = HDR + Math.max(16, Math.ceil(n / 16) * 16);
    let link = C.LIBC.heap;
    for (let h = rd(M, link), guard = 0; h && guard < 100000; link = h + 8, h = rd(M, h + 8), guard++) {
      const size = rd(M, h) & ~15;
      if (size < need) continue;
      const next = rd(M, h + 8);
      if (size - need >= MIN) { const r = h + need; wr(M, r, size - need); wr(M, r + 8, next); wr(M, link, r); M.sh.fill(0, r, r + HDR); wr(M, h, need | 1 | (flags || 0)); }
      else { wr(M, link, next); wr(M, h, size | 1 | (flags || 0)); }
      const cap = (rd(M, h) & ~15) - HDR;
      wr(M, h + 8, n);
      M.sh.fill(0, h, h + HDR);
      const p = h + HDR;
      if (flags & 2) { M.sh.fill(2, p, p + cap); }
      else { M.sh.fill(1, p, p + n); M.mem.fill(POISON, p, p + n); M.sh.fill(0, p + n, p + cap); }
      return p;
    }
    return 0;
  };
  /** the block whose payload starts at p, or what p points into: {h, start: bool} | null */
  C.blockOf = function (st, prog, p) {
    const M = st.M;
    if (typeof p !== 'number' || p < prog.heapBase || p >= prog.heapEnd) return null;
    for (let h = prog.heapBase, guard = 0; h < prog.heapEnd && guard < 200000; guard++) {
      const size = rd(M, h) & ~15;
      if (size <= 0) return null;
      if (p >= h && p < h + size) return { h, start: p === h + HDR, size, used: !!(rd(M, h) & 1), flags: rd(M, h) & 15 };
      h += size;
    }
    return null;
  };
  /** free(p): the block goes back on the free list, merged with free neighbours */
  C.free = function (st, prog, p, at) {
    const M = st.M;
    if (p === 0) return;
    const b = C.blockOf(st, prog, p);
    if (!b) throw fault('bad-free', p, 0, true, { why: 'not-heap' });
    if (!b.start) throw fault('bad-free', p, 0, true, { why: 'middle', off: p - b.h - HDR, block: b.h + HDR });
    if (!b.used) throw fault('double-free', p, 0, true, { meta: M.meta.get(p) });
    if (b.flags & 2) throw fault('bad-free', p, 0, true, { why: 'stack' });
    const h = b.h;
    let size = b.size;
    const meta = M.meta.get(p);
    if (meta) meta.freed = at || true;
    M.sh.fill(3, h + HDR, h + size);
    // insert in address order
    let link = C.LIBC.heap, prev = 0;
    for (let x = rd(M, link); x && x < h; prev = x, link = x + 8, x = rd(M, x + 8));
    const next = rd(M, link);
    wr(M, h, size); wr(M, h + 8, next); wr(M, link, h);
    // merge with the next block, then with the previous one
    if (next && h + size === next) { size += rd(M, next) & ~15; wr(M, h, size); wr(M, h + 8, rd(M, next + 8)); M.sh.fill(3, next, next + HDR); }
    if (prev && prev + (rd(M, prev) & ~15) === h) { const ps = (rd(M, prev) & ~15) + size; wr(M, prev, ps); wr(M, prev + 8, rd(M, h + 8)); M.sh.fill(3, h, h + HDR); }
  };
  C.realloc = function (st, prog, p, n, at) {
    const M = st.M;
    if (p === 0) return C.malloc(st, n);
    const b = C.blockOf(st, prog, p);
    if (!b) throw fault('bad-free', p, 0, true, { why: 'not-heap', fn: 'realloc' });
    if (!b.start) throw fault('bad-free', p, 0, true, { why: 'middle', off: p - b.h - HDR, block: b.h + HDR, fn: 'realloc' });
    if (!b.used) throw fault('uaf', p, 0, true, { meta: M.meta.get(p), fn: 'realloc' });
    if (n === 0) { C.free(st, prog, p, at); return 0; }
    const old = rd(M, b.h + 8), cap = b.size - HDR;
    if (n <= cap) {
      wr(M, b.h + 8, n);
      if (n > old) { M.sh.fill(1, p + old, p + n); M.mem.fill(POISON, p + old, p + n); }
      else M.sh.fill(0, p + n, p + old);
      return p;
    }
    const q = C.malloc(st, n);
    if (!q) return 0;
    C.copyMem(st, q, p, old);
    const meta = M.meta.get(p);
    if (meta) M.meta.set(q, Object.assign({}, meta, { freed: null, line: at && at.line, col: at && at.col, fn: 'realloc' }));
    C.free(st, prog, p, at);
    return q;
  };
  /** every block of the heap in address order, for the views */
  C.heapBlocks = function (st, prog) {
    const M = st.M, out = [], free = new Set(C.freeList(st));
    for (let h = prog.heapBase, guard = 0; h < prog.heapEnd && guard < 200000; guard++) {
      const w = rd(M, h), size = w & ~15;
      if (size <= 0) break;
      const used = !!(w & 1);
      out.push({ h, addr: h + HDR, size, cap: size - HDR, req: used ? rd(M, h + 8) : 0, free: !used, onList: free.has(h), next: used ? 0 : rd(M, h + 8), kind: w & 2 ? 'stack' : w & 4 ? 'vla' : 'heap', meta: M.meta.get(h + HDR) || null, top: h + size === prog.heapEnd && !used });
      h += size;
    }
    return out;
  };
})(globalThis.Proses = globalThis.Proses || {});
