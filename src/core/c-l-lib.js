// The C library calls the machine computes itself (the pure ones): strings and memory, ctype, conversions, rand
// (the same generator as glibc's, so a seed gives the numbers a Linux machine gives), qsort and bsearch (calling the
// program's own comparison), math, and the heap (malloc, calloc, realloc, free on the first-fit allocator of
// c-k-mem.js). The printf family's formatting is in c-m-fmt.js.
//   S.CLang.LIB[name]({prog, st, sys, kinds}, args) -> value
//   S.CLang.srandInit(st, seed)
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const LIB = (C.LIB = C.LIB || {});
  const str = (st, a) => C.readStr(st, a);
  const at = (x) => ({ line: x.prog.lines[x.st.pc] || x.st.line, col: x.prog.cols[x.st.pc] || 0 });
  const u = (n) => Number(n);

  // ---- strings ----------------------------------------------------------------------------------------------
  LIB.strlen = (x, [s]) => str(x.st, s).length;
  LIB.strcpy = (x, [d, s]) => { C.writeStr(x.st, d, str(x.st, s)); return d; };
  LIB.strncpy = (x, [d, s, n]) => {
    n = u(n); const src = str(x.st, s).slice(0, n);
    const b = new Uint8Array(n); for (let i = 0; i < src.length; i++) b[i] = src.charCodeAt(i);
    C.writeBytes(x.st, d, b); return d;
  };
  LIB.strcat = (x, [d, s]) => { const add = str(x.st, s); C.writeStr(x.st, d + str(x.st, d).length, add); return d; };
  LIB.strncat = (x, [d, s, n]) => { const add = C.readStr(x.st, s, u(n)); C.writeStr(x.st, d + str(x.st, d).length, add); return d; };
  const cmp = (a, b, n) => {
    for (let i = 0; i < n; i++) {
      const ca = i < a.length ? a.charCodeAt(i) : 0, cb = i < b.length ? b.charCodeAt(i) : 0;
      if (ca !== cb) return ca - cb;
      if (!ca) return 0;
    }
    return 0;
  };
  LIB.strcmp = (x, [a, b]) => cmp(str(x.st, a), str(x.st, b), Infinity);
  LIB.strncmp = (x, [a, b, n]) => cmp(C.readStr(x.st, a, u(n)), C.readStr(x.st, b, u(n)), u(n));
  const low = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  LIB.strcasecmp = (x, [a, b]) => cmp(low(str(x.st, a)), low(str(x.st, b)), Infinity);
  LIB.strncasecmp = (x, [a, b, n]) => cmp(low(C.readStr(x.st, a, u(n))), low(C.readStr(x.st, b, u(n))), u(n));
  LIB.strchr = (x, [s, c]) => { const t = str(x.st, s), ch = String.fromCharCode(c & 255); if ((c & 255) === 0) return s + t.length; const i = t.indexOf(ch); return i < 0 ? 0 : s + i; };
  LIB.strrchr = (x, [s, c]) => { const t = str(x.st, s), ch = String.fromCharCode(c & 255); if ((c & 255) === 0) return s + t.length; const i = t.lastIndexOf(ch); return i < 0 ? 0 : s + i; };
  LIB.strstr = (x, [h, n]) => { const i = str(x.st, h).indexOf(str(x.st, n)); return i < 0 ? 0 : h + i; };
  LIB.strspn = (x, [s, a]) => { const t = str(x.st, s), set = str(x.st, a); let i = 0; while (i < t.length && set.includes(t[i])) i++; return i; };
  LIB.strcspn = (x, [s, a]) => { const t = str(x.st, s), set = str(x.st, a); let i = 0; while (i < t.length && !set.includes(t[i])) i++; return i; };
  LIB.strpbrk = (x, [s, a]) => { const t = str(x.st, s), set = str(x.st, a); for (let i = 0; i < t.length; i++) if (set.includes(t[i])) return s + i; return 0; };
  LIB.strtok = (x, [s, d]) => {
    const st = x.st, save = C.LIBC.strtok;
    let p = s || C.ld(st, save, 'p');
    if (!p) return 0;
    const delim = str(st, d), t = str(st, p);
    let i = 0; while (i < t.length && delim.includes(t[i])) i++;
    if (i === t.length) { C.st_(st, save, 'p', p + i); return 0; }
    let j = i; while (j < t.length && !delim.includes(t[j])) j++;
    if (j < t.length) { C.st_(st, p + j, 'c', 0); C.st_(st, save, 'p', p + j + 1); } else C.st_(st, save, 'p', p + j);
    return p + i;
  };
  LIB.strdup = (x, [s]) => { const t = str(x.st, s), p = alloc(x, t.length + 1, 'strdup'); if (p) C.writeStr(x.st, p, t); return p; };
  LIB.strndup = (x, [s, n]) => { const t = C.readStr(x.st, s, u(n)), p = alloc(x, t.length + 1, 'strndup'); if (p) C.writeStr(x.st, p, t); return p; };
  LIB.strerror = (x, [e]) => {
    if (x.prog.errTexts && x.prog.errTexts[e]) return x.prog.errTexts[e];
    const msg = C.STRERROR[e] || 'Unknown error ' + e;
    C.writeStr(x.st, C.LIBC.errbuf, msg.slice(0, 63)); return C.LIBC.errbuf;
  };

  // ---- memory -----------------------------------------------------------------------------------------------
  LIB.memcpy = (x, [d, s, n]) => {
    n = u(n);
    if (n > 0 && d < s + n && s < d + n && d !== s) C.warnAt(x.prog, x.st, 'overlap', 'memcpy between overlapping regions: the result is undefined', 'use memmove when the source and the destination overlap');
    C.copyMem(x.st, d, s, n); return d;
  };
  LIB.memmove = (x, [d, s, n]) => { C.copyMem(x.st, d, s, u(n)); return d; };
  LIB.memset = (x, [d, c, n]) => { C.fill(x.st, d, u(n), c); return d; };
  LIB.memcmp = (x, [a, b, n]) => {
    n = u(n); const A = C.readBytes(x.st, a, n), B = C.readBytes(x.st, b, n);
    for (let i = 0; i < n; i++) if (A[i] !== B[i]) return A[i] - B[i];
    return 0;
  };
  LIB.memchr = (x, [s, c, n]) => { const A = C.readBytes(x.st, s, u(n)); const i = A.indexOf(c & 255); return i < 0 ? 0 : s + i; };

  // ---- the heap ------------------------------------------------------------------------------------------------
  function alloc(x, n, fn) {
    const p = C.malloc(x.st, n);
    const where = at(x);
    if (!p) { C.warnAt(x.prog, x.st, 'oom', fn + '(' + n + ') returns NULL: the simulated heap (' + ((x.prog.heapEnd - x.prog.heapBase) >> 10) + ' KiB) has no free block that large', 'check what malloc returns before using it'); return 0; }
    x.st.M.meta.set(p, { line: where.line, col: where.col, fn, size: Number(n), type: null, freed: null });
    return p;
  }
  LIB.malloc = (x, [n]) => alloc(x, u(n), 'malloc');
  LIB.calloc = (x, [n, size]) => {
    const total = u(n) * u(size);
    if (total > 1 << 30) return 0;
    const p = alloc(x, total, 'calloc');
    if (p) C.fill(x.st, p, total, 0);
    return p;
  };
  LIB.realloc = (x, [p, n]) => {
    const where = at(x), q = C.realloc(x.st, x.prog, p, u(n), where);
    if (q && q !== p) { const m = x.st.M.meta.get(q); if (!m || m.freed) x.st.M.meta.set(q, { line: where.line, col: where.col, fn: 'realloc', size: u(n), type: m ? m.type : null, freed: null }); }
    if (q) { const m = x.st.M.meta.get(q); if (m) m.size = u(n); }
    return q;
  };
  LIB.free = (x, [p]) => { C.free(x.st, x.prog, p, at(x)); return 0; };

  // ---- conversions ------------------------------------------------------------------------------------------
  /** strtol and its family: [value, end index, overflowed] */
  function parseInt64(s, base, unsigned) {
    let i = 0;
    while (i < s.length && /[ \t\n\v\f\r]/.test(s[i])) i++;
    let neg = false;
    if (s[i] === '+' || s[i] === '-') { neg = s[i] === '-'; i++; }
    if ((base === 0 || base === 16) && s[i] === '0' && /[xX]/.test(s[i + 1] || '') && /[0-9a-fA-F]/.test(s[i + 2] || '')) { i += 2; base = 16; }
    else if (base === 0) base = s[i] === '0' ? 8 : 10;
    const start = i;
    let v = 0n;
    for (; i < s.length; i++) { const d = parseInt(s[i], 36); if (Number.isNaN(d) || d >= base) break; v = v * BigInt(base) + BigInt(d); }
    if (i === start) return [0, 0, false];
    let over = false;
    if (unsigned) { if (v > 18446744073709551615n) { v = 18446744073709551615n; over = true; } else if (neg) v = BigInt.asUintN(64, -v); }
    else { if (neg) v = -v; if (v > 9223372036854775807n) { v = 9223372036854775807n; over = true; } if (v < -9223372036854775808n) { v = -9223372036854775808n; over = true; } }
    return [C.I64.norm(v), i, over];
  }
  function strtoX(x, [s, end, base], unsigned) {
    const t = str(x.st, s), [v, i, over] = parseInt64(t, Number(base), unsigned);
    if (end) C.st_(x.st, end, 'p', s + i);
    if (over) C.st_(x.st, x.prog.errnoAt, 'i', C.CONSTS.ERANGE);
    return v;
  }
  LIB.strtol = (x, a) => strtoX(x, a, false); LIB.strtoll = LIB.strtol;
  LIB.strtoul = (x, a) => strtoX(x, a, true); LIB.strtoull = LIB.strtoul;
  LIB.atoi = (x, [s]) => C.I64.wrap(parseInt64(str(x.st, s), 10, false)[0], 'i');
  LIB.atol = (x, [s]) => parseInt64(str(x.st, s), 10, false)[0]; LIB.atoll = LIB.atol;
  LIB.abs = (x, [a]) => { if (a === -2147483648) { C.warnAt(x.prog, x.st, 'overflow', 'abs(INT_MIN) does not fit in an int'); return a; } return Math.abs(a); };
  LIB.labs = (x, [a]) => (typeof a === 'bigint' ? C.I64.norm(a < 0n ? BigInt.asIntN(64, -a) : a) : Math.abs(a)); LIB.llabs = LIB.labs;
  LIB.getenv = () => 0;
  C.parseInt64 = parseInt64;

  // ---- rand: glibc's additive generator (TYPE_3: 31 words, separation 3) -------------------------------------
  C.srandInit = function (st, seed) {
    const L = C.LIBC;
    let word = (seed >>> 0) || 1;
    const r = [word | 0];
    for (let i = 1; i < 31; i++) {
      const hi = Math.trunc(word / 127773), lo = word % 127773;
      word = 16807 * lo - 2836 * hi;
      if (word < 0) word += 2147483647;
      r.push(word | 0);
    }
    for (let i = 0; i < 31; i++) C.st_(st, L.randT + 4 * i, 'i', r[i]);
    C.st_(st, L.randF, 'i', 3); C.st_(st, L.randR, 'i', 0);
    for (let i = 0; i < 310; i++) next(st);
  };
  function next(st) {
    const L = C.LIBC;
    let f = C.ld(st, L.randF, 'i'), r = C.ld(st, L.randR, 'i');
    const val = (C.ld(st, L.randT + 4 * f, 'u') + C.ld(st, L.randT + 4 * r, 'u')) >>> 0;
    C.st_(st, L.randT + 4 * f, 'u', val);
    f++; r++;
    if (f >= 31) f = 0; else if (r >= 31) r = 0;
    C.st_(st, L.randF, 'i', f); C.st_(st, L.randR, 'i', r);
    return val >>> 1;
  }
  LIB.rand = (x) => next(x.st);
  LIB.srand = (x, [seed]) => { C.srandInit(x.st, seed); return 0; };

  // ---- qsort and bsearch: the program's comparison, called by the machine -------------------------------------
  LIB.qsort = (x, [base, n, size, fn]) => {
    n = u(n); size = u(size);
    if (n < 2 || size === 0) return 0;
    const st = x.st, order = Array.from({ length: n }, (_, i) => i);
    const cmpAt = (i, j) => C.I64.wrap(C.callFn(x.prog, st, x.sys, fn, [base + i * size, base + j * size]), 'i');
    // a stable merge sort over the positions, comparing the elements where they lie; then the bytes move once
    const tmp = new Array(n);
    const sort = (lo, hi) => {
      if (hi - lo < 2) return;
      const mid = (lo + hi) >> 1;
      sort(lo, mid); sort(mid, hi);
      let a = lo, b = mid, k = lo;
      while (a < mid && b < hi) tmp[k++] = cmpAt(order[a], order[b]) <= 0 ? order[a++] : order[b++];
      while (a < mid) tmp[k++] = order[a++];
      while (b < hi) tmp[k++] = order[b++];
      for (let i = lo; i < hi; i++) order[i] = tmp[i];
    };
    sort(0, n);
    const M = st.M, bytes = M.mem.slice(base, base + n * size), shadow = M.sh.slice(base, base + n * size);
    C.rangeOk(st, base, n * size, true);
    order.forEach((from, to) => { M.mem.set(bytes.subarray(from * size, from * size + size), base + to * size); M.sh.set(shadow.subarray(from * size, from * size + size), base + to * size); });
    return 0;
  };
  LIB.bsearch = (x, [key, base, n, size, fn]) => {
    let lo = 0, hi = u(n); size = u(size);
    while (lo < hi) {
      const mid = (lo + hi) >> 1, p = base + mid * size;
      const c = C.I64.wrap(C.callFn(x.prog, x.st, x.sys, fn, [key, p]), 'i');
      if (c === 0) return p;
      if (c < 0) hi = mid; else lo = mid + 1;
    }
    return 0;
  };

  // ---- ctype (glibc's answers: a class's bit, not just 1) ------------------------------------------------------
  const CT = { isupper: [256, /[A-Z]/], islower: [512, /[a-z]/], isalpha: [1024, /[A-Za-z]/], isdigit: [2048, /[0-9]/], isxdigit: [4096, /[0-9A-Fa-f]/],
    isspace: [8192, /[ \t\n\v\f\r]/], isprint: [16384, /[\x20-\x7e]/], isgraph: [32768, /[\x21-\x7e]/], iscntrl: [2, /[\x00-\x1f\x7f]/], ispunct: [4, /[!-/:-@[-`{-~]/], isalnum: [8, /[A-Za-z0-9]/] };
  for (const [name, [bit, re]] of Object.entries(CT)) LIB[name] = (x, [c]) => (c >= 0 && c < 128 && re.test(String.fromCharCode(c)) ? bit : 0);
  LIB.toupper = (x, [c]) => (c >= 97 && c <= 122 ? c - 32 : c);
  LIB.tolower = (x, [c]) => (c >= 65 && c <= 90 ? c + 32 : c);

  // ---- math ----------------------------------------------------------------------------------------------------
  const M1 = { sqrt: Math.sqrt, fabs: Math.abs, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, exp: Math.exp, log: Math.log, log10: Math.log10, log2: Math.log2, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan,
    round: (v) => (v < 0 ? -Math.round(-v) : Math.round(v)) };
  for (const [k, f] of Object.entries(M1)) LIB[k] = (x, [v]) => f(Number(v));
  LIB.pow = (x, [a, b]) => Math.pow(a, b);
  LIB.fmod = (x, [a, b]) => a % b;
  LIB.atan2 = (x, [a, b]) => Math.atan2(a, b);
  LIB.fmin = (x, [a, b]) => Math.min(a, b);
  LIB.fmax = (x, [a, b]) => Math.max(a, b);

  // ---- assert and what is not in the subset ---------------------------------------------------------------------
  LIB.__assert_fail = (x, [e, file, line, fn]) => {
    const text = 'a.out: ' + str(x.st, file) + ':' + line + ': ' + str(x.st, fn) + ': Assertion `' + str(x.st, e) + "' failed.";
    throw new C.CError(0, 'the assertion ' + str(x.st, e) + ' is false, so assert stops the program', 0, { kind: 'abort', ub: 'assert', signal: 6, stderr: text + '\n', hint: 'assert(e) checks that e holds; abort (signal 6) ends the program when it does not' });
  };
  LIB.__va_unsupported = () => { throw new C.CError(0, 'variadic functions of your own (va_list, va_start) are not in the subset', 0, { kind: 'runtime' }); };
})(globalThis.Proses = globalThis.Proses || {});
