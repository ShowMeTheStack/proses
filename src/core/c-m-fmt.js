// printf's formatting, as glibc does it: %d %i %u %o %x %X %c %s %p %n %% and %f %F %e %E %g %G, with the flags
// - + space # 0, a width, a precision, * for either, and the lengths hh h l ll z j t L. Floating-point numbers are
// rounded exactly (the decimal expansion of the double, ties to even), so %.2f of 2.675 gives 2.67 as on Linux.
//   S.CLang.format(st, fmtAddr, args, kinds) -> {text, warn: [sentences]}   (kinds: each argument's machine kind)
//   S.CLang.formatText(st, fmt, args, kinds) -> the same, from the format as a string
//   S.CLang.formatSpecs(fmt, kinds, scanf) -> [{msg, arg}]   the compiler's check of a literal format
//   S.CLang.fixed(x, prec), S.CLang.expo(x, prec, upper), S.CLang.general(x, prec, upper, alt)
// sprintf, snprintf and sscanf are computed here too (LIB).
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const LIB = (C.LIB = C.LIB || {});
  const SPEC = /%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|L|q|j|z|t)?([diouxXeEfFgGaAcspn%])/y;

  // ---- exact decimal expansions ------------------------------------------------------------------------------
  /** x (finite, >= 0) as m * 2^e with m an integer */
  function parts(x) {
    const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x);
    const hi = b.getUint32(0), lo = b.getUint32(4), ex = (hi >>> 20) & 2047;
    let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (ex) m |= 1n << 52n;
    return [m, (ex || 1) - 1075];
  }
  const P10 = (n) => 10n ** BigInt(n);
  /** round(num / den) with ties to even */
  function rdiv(num, den) { const q = num / den, r = num % den; return 2n * r > den || (2n * r === den && (q & 1n)) ? q + 1n : q; }
  /** x * 10^k rounded to an integer, exactly */
  function scaled(x, k) {
    const [m, e] = parts(x);
    let num = m, den = 1n;
    if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
    if (k >= 0) num *= P10(k); else den *= P10(-k);
    return rdiv(num, den);
  }
  C.fixed = function (x, prec) {
    const q = scaled(x, prec).toString().padStart(prec + 1, '0');
    return prec ? q.slice(0, q.length - prec) + '.' + q.slice(q.length - prec) : q;
  };
  /** [digits (prec + 1 of them), exponent] */
  function expDigits(x, prec) {
    if (x === 0) return ['0'.repeat(prec + 1), 0];
    let k = Math.floor(Math.log10(x));
    for (let tries = 0; tries < 4; tries++) {
      const q = scaled(x, prec - k), s = q.toString();
      if (s.length > prec + 1) { k++; continue; }
      if (s.length < prec + 1) { k--; continue; }
      return [s, k];
    }
    const q = scaled(x, prec - k).toString();
    return [q.slice(0, prec + 1), k];
  }
  C.expo = function (x, prec, upper, alt) {
    const [d, k] = expDigits(x, prec);
    const mant = d[0] + (prec || alt ? '.' : '') + d.slice(1);
    return mant + (upper ? 'E' : 'e') + (k < 0 ? '-' : '+') + String(Math.abs(k)).padStart(2, '0');
  };
  C.general = function (x, prec, upper, alt) {
    const P = prec === 0 ? 1 : prec;
    const k = x === 0 ? 0 : expDigits(x, P - 1)[1];
    let s = P > k && k >= -4 ? C.fixed(x, P - 1 - k) : C.expo(x, P - 1, upper, alt);
    if (alt && !/[.eE]/.test(s)) s += '.';
    if (!alt) {
      const ei = s.search(/[eE]/), m = ei < 0 ? s : s.slice(0, ei), ex = ei < 0 ? '' : s.slice(ei);
      s = (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m) + ex;
    }
    return s;
  };

  // ---- conversions ---------------------------------------------------------------------------------------------
  const WANT = { d: 'int', i: 'int', o: 'uint', u: 'uint', x: 'uint', X: 'uint', c: 'int', s: 'str', p: 'ptr', n: 'ptr', e: 'dbl', E: 'dbl', f: 'dbl', F: 'dbl', g: 'dbl', G: 'dbl', a: 'dbl', A: 'dbl' };
  const wide = (len) => len === 'l' || len === 'll' || len === 'q' || len === 'j' || len === 'z' || len === 't';
  const kindName = { i: 'an int', u: 'an unsigned int', l: 'a long', ul: 'an unsigned long', p: 'a pointer', d: 'a double', f: 'a double', a: 'a struct', c: 'an int', uc: 'an int', s: 'an int', us: 'an int', b: 'an int' };
  /** does a value of kind k suit the conversion? a sentence when it does not */
  function mismatch(conv, len, k) {
    const want = WANT[conv];
    if (!want || conv === '%') return null;
    const intK = k === 'i' || k === 'u' || k === 'c' || k === 'uc' || k === 's' || k === 'us' || k === 'b';
    const longK = k === 'l' || k === 'ul';
    if (want === 'int' || want === 'uint') {
      if (conv === 'c') return intK ? null : '%c expects a character (an int), but gets ' + kindName[k];
      if (wide(len)) return longK ? null : '%' + len + conv + ' expects a long, but gets ' + kindName[k] + (intK ? '; use %' + conv : '');
      return intK ? null : '%' + (len || '') + conv + ' expects an int, but gets ' + kindName[k] + (longK ? '; use %l' + conv : k === 'd' ? '; use %f for a double' : k === 'p' ? '; use %p for a pointer, or %s for a string' : '');
    }
    if (want === 'dbl') return k === 'd' || k === 'f' ? null : '%' + conv + ' expects a double, but gets ' + kindName[k] + (intK || longK ? '; use %d (or %ld), or cast to double' : '');
    if (want === 'str' || want === 'ptr') return k === 'p' ? null : '%' + conv + ' expects ' + (want === 'str' ? 'a string (char *)' : 'a pointer') + ', but gets ' + kindName[k] + (intK ? '; use %d for a number' : '');
    return null;
  }
  C.formatSpecs = function (fmt, kinds, scanf) {
    const out = [];
    let ai = 0, i = 0;
    while ((i = fmt.indexOf('%', i)) >= 0) {
      if (scanf) { const m = /^%(\*?)(\d*)(hh|h|ll|l|L|j|z|t)?([diouxXeEfFgGaAcspn%]|\[\^?\]?[^\]]*\])/.exec(fmt.slice(i)); if (!m) { out.push({ msg: 'the format has a bad conversion at ' + JSON.stringify(fmt.slice(i, i + 4)), arg: ai }); break; } i += m[0].length; if (m[4] === '%' || m[1]) continue; if (ai >= kinds.length) out.push({ msg: 'the format has more conversions than there are pointers after it', arg: ai }); else if (kinds[ai] !== 'p') out.push({ msg: '%' + m[4] + ' needs a pointer (did you forget the &?)', arg: ai }); ai++; continue; }
      SPEC.lastIndex = i;
      const m = SPEC.exec(fmt);
      if (!m) { out.push({ msg: 'the format has a bad conversion at ' + JSON.stringify(fmt.slice(i, i + 4)), arg: ai }); i++; continue; }
      i += m[0].length;
      if (m[5] === '%') continue;
      for (const star of [m[2], m[3]]) if (star === '*') { if (ai < kinds.length && !/^(i|u|c|uc|s|us)$/.test(kinds[ai])) out.push({ msg: '* expects an int for the width or precision', arg: ai }); ai++; }
      if (ai >= kinds.length) { out.push({ msg: 'the format has more conversions than values: %' + (m[4] || '') + m[5] + ' has none', arg: Math.max(0, kinds.length - 1) }); ai++; continue; }
      const bad = mismatch(m[5], m[4], kinds[ai]);
      if (bad) out.push({ msg: bad, arg: ai });
      ai++;
    }
    if (ai < kinds.length && !scanf) out.push({ msg: 'there are more values (' + kinds.length + ') than conversions in the format (' + ai + ')', arg: ai });
    return out;
  };

  function intText(v, k, conv, len) {
    const signed = conv === 'd' || conv === 'i';
    let kk;
    if (len === 'hh') kk = signed ? 'c' : 'uc';
    else if (len === 'h') kk = signed ? 's' : 'us';
    else if (wide(len)) kk = signed ? 'l' : 'ul';
    else kk = signed ? 'i' : 'u';
    if (typeof v === 'number' && !Number.isInteger(v)) v = Math.trunc(v);
    v = C.I64.wrap(v, kk);
    const neg = v < 0, mag = neg ? -C.I64.big(v) : C.I64.big(v);
    const base = conv === 'o' ? 8 : conv === 'x' || conv === 'X' ? 16 : 10;
    let s = mag.toString(base);
    if (conv === 'X') s = s.toUpperCase();
    return [s, neg];
  }
  C.formatText = function (st, fmt, args, kinds) {
    let out = '', ai = 0, i = 0;
    const warn = [];
    const next = (conv) => {
      if (ai >= args.length) { if (!warn.missing) { warn.push('the format asks for more values than are given; the missing ones print as garbage on a real machine (here as 0)'); warn.missing = true; } ai++; return [0, 'i']; }
      const k = kinds && kinds[ai] ? kinds[ai] : 'i';
      return [args[ai++], k];
    };
    while (i < fmt.length) {
      const c = fmt[i];
      if (c !== '%') { const j = fmt.indexOf('%', i); const e = j < 0 ? fmt.length : j; out += fmt.slice(i, e); i = e; continue; }
      SPEC.lastIndex = i;
      const m = SPEC.exec(fmt);
      if (!m) { out += '%'; i++; continue; }
      i += m[0].length;
      const flags = m[1], conv = m[5], len = m[4] || '';
      if (conv === '%') { out += '%'; continue; }
      let width = 0, prec = null, left = flags.includes('-');
      if (m[2] === '*') { width = Number(next()[0]) | 0; if (width < 0) { left = true; width = -width; } } else if (m[2]) width = +m[2];
      if (m[3] !== undefined) { if (m[3] === '*') { const p = Number(next()[0]) | 0; prec = p < 0 ? null : p; } else prec = +(m[3] || 0); }
      const [v, k] = next(conv);
      const bad = mismatch(conv, len, k);
      if (bad) warn.push(bad);
      let s, zeroOk = false;
      switch (conv) {
        case 'c': s = String.fromCharCode(Number(C.I64.wrap(v, 'uc'))); break;
        case 's': { if (v === 0) s = prec === null || prec >= 6 ? '(null)' : ''; else { s = C.readStr(st, Number(v), prec === null ? undefined : prec); } break; }
        case 'p': s = v === 0 ? '(nil)' : '0x' + C.I64.big(C.I64.wrap(v, 'ul')).toString(16); break;
        case 'n': if (v) C.st_(st, Number(v), len === 'l' ? 'l' : 'i', out.length); s = ''; break;
        case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': case 'a': case 'A': {
          const x = typeof v === 'bigint' ? Number(v) : v;
          const neg = x < 0 || Object.is(x, -0), ax = Math.abs(x), up = conv === 'E' || conv === 'F' || conv === 'G' || conv === 'A';
          let body;
          if (!Number.isFinite(ax)) body = Number.isNaN(ax) ? 'nan' : 'inf';
          else {
            const p = prec === null ? 6 : prec, alt = flags.includes('#');
            if (conv === 'f' || conv === 'F') body = C.fixed(ax, p) + (alt && p === 0 ? '.' : '');
            else if (conv === 'e' || conv === 'E') body = C.expo(ax, p, up, alt);
            else if (conv === 'g' || conv === 'G') body = C.general(ax, p, up, alt);
            else body = C.expo(ax, p, up, alt);
            zeroOk = true;
          }
          if (up) body = body.toUpperCase();
          const sign = neg && !Number.isNaN(ax) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
          if (zeroOk && flags.includes('0') && !left && sign.length + body.length < width) body = body.padStart(width - sign.length, '0');
          s = sign + body;
          break;
        }
        default: {
          let [digits, neg] = intText(v, k, conv, len);
          if (prec !== null) digits = prec === 0 && digits === '0' ? '' : digits.padStart(prec, '0');
          let pre = neg ? '-' : (conv === 'd' || conv === 'i') && flags.includes('+') ? '+' : (conv === 'd' || conv === 'i') && flags.includes(' ') ? ' ' : '';
          if (flags.includes('#')) { if ((conv === 'x' || conv === 'X') && digits && digits !== '0' && !/^0+$/.test(digits)) pre += conv === 'x' ? '0x' : '0X'; if (conv === 'o' && digits[0] !== '0') digits = '0' + digits; }
          if (flags.includes('0') && !left && prec === null && pre.length + digits.length < width) digits = digits.padStart(width - pre.length, '0');
          s = pre + digits;
        }
      }
      if (s.length < width) s = left ? s.padEnd(width) : s.padStart(width);
      out += s;
    }
    if (ai < args.length) warn.push('there are more values (' + args.length + ') than conversions in the format (' + ai + '); the extra ones are ignored');
    return { text: out, warn: warn.slice() };
  };
  C.format = (st, fmtAddr, args, kinds) => C.formatText(st, C.readStr(st, Number(fmtAddr)), args, kinds);

  // ---- sprintf, snprintf ------------------------------------------------------------------------------------
  const fmtWarn = (x, name, w, fmt) => { if (x.st.M.sh[fmt] === 5) return; for (const s of w) C.warnAt(x.prog, x.st, 'format', name + ': ' + s); };
  LIB.sprintf = (x, args) => {
    const r = C.format(x.st, args[1], args.slice(2), (x.kinds || []).slice(2));
    fmtWarn(x, 'sprintf', r.warn, args[1]);
    C.writeStr(x.st, args[0], r.text);
    return r.text.length;
  };
  LIB.snprintf = (x, args) => {
    const r = C.format(x.st, args[2], args.slice(3), (x.kinds || []).slice(3));
    fmtWarn(x, 'snprintf', r.warn, args[2]);
    const n = Number(args[1]);
    if (n > 0) C.writeStr(x.st, args[0], r.text.slice(0, n - 1));
    return r.text.length;
  };

  // ---- sscanf: %d %i %u %o %x %ld %lu %f %lf %e %g %s %c %[set] %n %%, widths and * -------------------------
  LIB.sscanf = (x, args) => {
    const st = x.st, s = C.readStr(st, args[0]), fmt = C.readStr(st, args[1]);
    let si = 0, fi = 0, ai = 2, count = 0;
    const ws = () => { while (si < s.length && /\s/.test(s[si])) si++; };
    while (fi < fmt.length) {
      const c = fmt[fi];
      if (/\s/.test(c)) { ws(); fi++; continue; }
      if (c !== '%') { if (s[si] !== c) break; si++; fi++; continue; }
      const m = /^%(\*?)(\d*)(hh|h|ll|l|L|j|z|t)?([diouxXeEfFgGaAcspn%]|\[\^?\]?[^\]]*\])/.exec(fmt.slice(fi));
      if (!m) break;
      fi += m[0].length;
      const skip = !!m[1], width = m[2] ? +m[2] : Infinity, len = m[3] || '', conv = m[4];
      if (conv === '%') { ws(); if (s[si] !== '%') break; si++; continue; }
      if (conv === 'n') { if (!skip) C.st_(st, args[ai++], 'i', si); continue; }
      if (conv !== 'c' && conv[0] !== '[') ws();
      if (si >= s.length) { if (count === 0) count = -1; break; }
      const take = (re) => { const mm = re.exec(s.slice(si, si + (width === Infinity ? s.length : width))); return mm ? mm[0] : ''; };
      let val, kind;
      if ('diouxX'.includes(conv)) {
        const base = conv === 'd' || conv === 'u' ? 10 : conv === 'o' ? 8 : conv === 'x' || conv === 'X' ? 16 : 0;
        const tok = take(base === 16 ? /^[+-]?(0[xX])?[0-9a-fA-F]+/ : base === 8 ? /^[+-]?[0-7]+/ : base === 10 ? /^[+-]?[0-9]+/ : /^[+-]?(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/);
        if (!tok) break;
        si += tok.length; val = C.parseInt64(tok, base, conv !== 'd' && conv !== 'i')[0];
        kind = len === 'hh' ? 'c' : len === 'h' ? 's' : len === 'l' || len === 'll' || len === 'j' || len === 'z' || len === 't' ? 'l' : 'i';
      } else if ('eEfFgGaA'.includes(conv)) {
        const tok = take(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
        if (!tok) break;
        si += tok.length; val = parseFloat(tok); kind = len === 'l' || len === 'L' ? 'd' : 'f';
      } else if (conv === 's') {
        const tok = take(/^\S+/); if (!tok) break; si += tok.length;
        if (!skip) { C.writeStr(st, args[ai++], tok); count++; } continue;
      } else if (conv === 'c') {
        const n = width === Infinity ? 1 : width; if (si + n > s.length) break;
        const tok = s.slice(si, si + n); si += n;
        if (!skip) { C.writeBytes(st, args[ai++], Uint8Array.from(tok, (ch) => ch.charCodeAt(0))); count++; } continue;
      } else {
        const neg = conv[1] === '^', body = conv.slice(neg ? 2 : 1, -1);
        let j = si; while (j < s.length && j - si < width && body.includes(s[j]) !== neg) j++;
        if (j === si) break;
        if (!skip) { C.writeStr(st, args[ai++], s.slice(si, j)); count++; }
        si = j; continue;
      }
      if (!skip) { C.st_(st, args[ai++], kind, val); count++; }
    }
    return count;
  };
})(globalThis.Proses = globalThis.Proses || {});
