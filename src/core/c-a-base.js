// The C subset, the shared base: errors with a place and a hint, and the arithmetic of 64-bit integers.
//   new S.CLang.CError(line, message, col, extra)   extra: {hint, kind: 'compile' | 'ub' | 'runtime' | 'abort',
//       ub: 'oob' | 'uaf' | 'double-free' | 'bad-free' | 'uninit' | 'null' | 'div0' | 'dead-stack' | 'ro-write' |
//       'noret' | 'bad-call' | 'stack-overflow' | 'assert' | 'limit', signal: 11 | 8 | 6, stderr: text}
//     err.line, err.col, err.msg (the sentence), err.hint, err.kind, err.ub, err.signal
//   S.CLang.explain(err, src) -> text      "line 3, column 12: ..." then the line, a caret under the column, the hint
//   S.CLang.suggest(name, names) -> a close name or null (for "did you mean ...?")
// 64-bit values: a long or an unsigned long (and a pointer) is a JS number while it is a safe integer, and a BigInt
// beyond that; every operation keeps that rule, so equal values always look the same.
//   S.CLang.I64: norm(x), wrap(x, kind) for kinds c uc s us i u l ul p b f d, add/sub/mul/div/rem/shl/shr/and/or/xor
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});

  class CError extends Error {
    constructor(line, message, col, extra) {
      super((line ? 'line ' + line + (col ? ', column ' + col : '') + ': ' : '') + message);
      this.line = line || 0; this.col = col || 0; this.msg = message;
      this.kind = 'compile';
      if (extra) Object.assign(this, extra);
    }
  }
  C.CError = CError;

  C.explain = function (err, src) {
    if (!(err instanceof CError)) return String(err && err.message || err);
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    let out = (err.line ? 'line ' + err.line + (err.col ? ', column ' + err.col : '') + ': ' : '') + err.msg;
    const l = lines[err.line - 1];
    if (l !== undefined && err.line) {
      const shown = l.replace(/\t/g, '    ');
      const col = err.col ? l.slice(0, err.col - 1).replace(/\t/g, '    ').length : 0;
      out += '\n    ' + shown + (err.col ? '\n    ' + ' '.repeat(col) + '^' : '');
    }
    if (err.hint) out += '\nhint: ' + err.hint;
    return out;
  };

  function dist(a, b) {
    const m = a.length, n = b.length, d = [];
    for (let i = 0; i <= m; i++) { d[i] = [i]; }
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  C.suggest = function (name, names) {
    let best = null, bd = name.length <= 3 ? 1 : 2;
    for (const n of names) { if (n === name || n.startsWith('__')) continue; const d = dist(name, n); if (d <= bd && (!best || d < bd)) { best = n; bd = d; } }
    return best;
  };

  // ---- 64-bit integers: numbers while safe, BigInt beyond ------------------------------------------------------
  const TWO32 = 4294967296, SAFE = Number.MAX_SAFE_INTEGER;
  const norm = (x) => (typeof x === 'bigint' ? (x >= -9007199254740991n && x <= 9007199254740991n ? Number(x) : x) : x);
  const big = (x) => (typeof x === 'bigint' ? x : BigInt(Math.trunc(x)));
  /** a value made to fit a kind (the conversion C does on assignment or a cast) */
  function wrap(v, k) {
    switch (k) {
      case 'd': return Number(v);
      case 'f': return Math.fround(Number(v));
      case 'b': return v != 0 ? 1 : 0; // eslint-disable-line eqeqeq
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) v = 0;
      else if (!Number.isInteger(v)) v = Math.trunc(v);
      switch (k) {
        case 'c': return (v << 24) >> 24; case 'uc': return v & 255; case 's': return (v << 16) >> 16; case 'us': return v & 65535;
        case 'i': return v | 0; case 'u': return v >>> 0;
        case 'l': if (v >= -SAFE && v <= SAFE) return v; break;
        default: if (v >= 0 && v <= SAFE) return v; // ul, p
      }
      if (k === 'i' || k === 'u' || k === 'c' || k === 'uc' || k === 's' || k === 'us') return wrap(BigInt(v), k);
      v = BigInt(v);
    }
    switch (k) {
      case 'c': return Number(BigInt.asIntN(8, v)); case 'uc': return Number(BigInt.asUintN(8, v));
      case 's': return Number(BigInt.asIntN(16, v)); case 'us': return Number(BigInt.asUintN(16, v));
      case 'i': return Number(BigInt.asIntN(32, v)); case 'u': return Number(BigInt.asUintN(32, v));
      case 'l': return norm(BigInt.asIntN(64, v));
      default: return norm(BigInt.asUintN(64, v));
    }
  }
  const W = (k) => (k === 'l' ? BigInt.asIntN : BigInt.asUintN);
  /** exact results for 64-bit kinds (l signed, ul/p unsigned): [value, overflowed] for the signed checks */
  const I64 = (C.I64 = {
    norm, big, wrap, TWO32,
    add(a, b, k) { if (typeof a === 'number' && typeof b === 'number') { const r = a + b; if (Number.isSafeInteger(r)) return k === 'l' || r >= 0 ? r : wrap(r, k); } return norm(W(k)(64, big(a) + big(b))); },
    sub(a, b, k) { if (typeof a === 'number' && typeof b === 'number') { const r = a - b; if (Number.isSafeInteger(r)) return k === 'l' || r >= 0 ? r : wrap(r, k); } return norm(W(k)(64, big(a) - big(b))); },
    mul(a, b, k) { if (typeof a === 'number' && typeof b === 'number') { const r = a * b; if (Number.isSafeInteger(r)) return k === 'l' || r >= 0 ? r : wrap(r, k); } return norm(W(k)(64, big(a) * big(b))); },
    div(a, b, k) { if (typeof a === 'number' && typeof b === 'number' && Math.abs(a) < 4503599627370496) return Math.trunc(a / b) || 0; return norm(W(k)(64, big(a) / big(b))); },
    rem(a, b, k) { if (typeof a === 'number' && typeof b === 'number') return (a % b) || 0; return norm(W(k)(64, big(a) % big(b))); },
    shl(a, n, k) { if (typeof a === 'number') { const r = a * Math.pow(2, n); if (Number.isSafeInteger(r)) return r; } return norm(W(k)(64, big(a) << BigInt(n))); },
    shr(a, n, k) { if (typeof a === 'number') return Math.floor(a / Math.pow(2, n)); return norm(W(k)(64, big(a) >> BigInt(n))); },
    bit(op, a, b, k) {
      if (typeof a === 'number' && typeof b === 'number' && a >= -2147483648 && a < 2147483648 && b >= -2147483648 && b < 2147483648) {
        const r = op === '&' ? a & b : op === '|' ? a | b : a ^ b;
        return k === 'l' ? r : wrap(r, k);
      }
      const x = big(a), y = big(b);
      return norm(W(k)(64, op === '&' ? x & y : op === '|' ? x | y : x ^ y));
    },
    not(a, k) { if (typeof a === 'number' && a >= -2147483648 && a < 2147483648) return k === 'l' ? ~a : wrap(~a, k); return norm(W(k)(64, ~big(a))); },
    /** does the exact result of a op b leave the signed 64-bit range? */
    overflows(op, a, b) {
      const x = big(a), y = big(b), r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : 0n;
      return r < -9223372036854775808n || r > 9223372036854775807n;
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
