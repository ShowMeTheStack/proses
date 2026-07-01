// The C subset, stage one: the lexer. Source text becomes tokens {t, v, s, line, col, ll, bol, sp}:
//   t 'num' (v a number, or a BigInt past 2^53; long: 0 | 1 | 2 for l / ll, unsigned, base 10 | 16 | 8 | 2),
//     'fnum' (v a number; float: true for an f suffix), 'chr' (v its value as an int), 'str' (v the bytes as a
//     string), 'id', 'kw', 'op' (including # and ## for the preprocessor), 'eof';
//   s the spelling, line and col where it starts (1-based), ll the logical line (backslash-newline joins lines),
//   bol: first token of its logical line, sp: whitespace before it.
//   S.CLang.lex(text) -> [tokens]          S.CLang.KEYWORDS
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const KW = new Set(['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto',
    'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
    'unsigned', 'void', 'volatile', 'while', '_Bool', '_Alignof', '_Noreturn', '_Static_assert', '__restrict', '__inline', '__attribute__', '__extension__']);
  C.KEYWORDS = KW;
  // longest first, so that >>= is read before >> and >
  const OPS = ['%:%:', '>>=', '<<=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##',
    '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#'];
  const ESC = { n: 10, t: 9, r: 13, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63, e: 27 };

  C.lex = function (text) {
    text = String(text).replace(/\r\n?/g, '\n');
    const toks = [], n = text.length;
    let i = 0, line = 1, lineStart = 0, ll = 1, bol = true, sp = false;
    const err = (msg, at, extra) => new C.CError(line, msg, (at === undefined ? i : at) - lineStart + 1, extra);
    /** one escape at text[j] (just after the backslash): [code, length] */
    const escape = (j) => {
      const c = text[j];
      if (c === 'x') { const m = /^[0-9a-fA-F]+/.exec(text.slice(j + 1, j + 9)); if (!m) throw err('a \\x escape needs hex digits after it', j - 1); return [parseInt(m[0], 16) & 255, 1 + m[0].length]; }
      if (/[0-7]/.test(c)) { const m = /^[0-7]{1,3}/.exec(text.slice(j, j + 3)); return [parseInt(m[0], 8) & 255, m[0].length]; }
      if (c in ESC) return [ESC[c], 1];
      throw err('the escape \\' + c + ' is not a C escape', j - 1, { hint: 'the escapes are \\n \\t \\r \\0 \\\\ \\\' \\" \\a \\b \\f \\v \\? \\xHH and \\ooo (octal)' });
    };
    const push = (tok, start) => { tok.line = line; tok.col = start - lineStart + 1; tok.ll = ll; tok.bol = bol; tok.sp = sp; tok.s = text.slice(start, i); toks.push(tok); bol = false; sp = false; };
    while (i < n) {
      const c = text[i];
      if (c === '\n') { line++; ll++; i++; lineStart = i; bol = true; sp = true; continue; }
      if (c === '\\' && text[i + 1] === '\n') { i += 2; line++; lineStart = i; sp = true; continue; }
      if (c === ' ' || c === '\t' || c === '\f' || c === '\v') { i++; sp = true; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') { if (text[i] === '\\' && text[i + 1] === '\n') { line++; i++; lineStart = i + 1; } i++; } sp = true; continue; }
      if (c === '/' && text[i + 1] === '*') {
        const at = i; i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') { line++; i++; lineStart = i; continue; } i++; }
        if (i >= n) { throw new C.CError(toks.length ? toks[toks.length - 1].line : 1, 'a /* comment is never closed with */', 0, { hint: 'everything after the /* is a comment until a */' }); }
        i += 2; sp = true; void at; continue;
      }
      const start = i;
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
        const rest = text.slice(i, i + 80);
        const fm = /^(?:[0-9]*\.[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+\.(?:[eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+)([fFlL]?)/.exec(rest);
        if (fm && !/^0[xX]/.test(rest)) {
          i += fm[0].length;
          if (/[A-Za-z0-9_.]/.test(text[i] || '')) throw err('a malformed number: ' + text.slice(start, i + 1), start);
          push({ t: 'fnum', v: parseFloat(fm[0]), float: /f/i.test(fm[1]) }, start); continue;
        }
        const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uUlL]*)/.exec(rest);
        i += m[0].length;
        if (/[A-Za-z0-9_.]/.test(text[i] || '') || !/^(u?(l|ll|L|LL)?|(l|ll|L|LL)u?)$/i.test(m[2])) throw err('a malformed number: ' + text.slice(start, i + 1).trim(), start, { hint: 'integers are decimal (42), octal (052), hex (0x2a) or binary (0b101010), with an optional u, l or ul suffix' });
        const d = m[1], base = /^0[xX]/.test(d) ? 16 : /^0[bB]/.test(d) ? 2 : /^0[0-9]/.test(d) ? 8 : 10;
        if (base === 8 && /[89]/.test(d)) throw err('the octal number ' + d + ' has a digit 8 or 9', start, { hint: 'a number that starts with 0 is octal; drop the leading 0' });
        let big = base === 16 ? BigInt(d) : base === 2 ? BigInt(d) : base === 8 ? BigInt('0o' + d.slice(1)) : BigInt(d);
        if (big > 18446744073709551615n) throw err('the number ' + d + ' is too large for 64 bits', start);
        const suf = m[2].toLowerCase();
        push({ t: 'num', v: C.I64.norm(big), long: suf.includes('ll') ? 2 : suf.includes('l') ? 1 : 0, unsigned: suf.includes('u'), base }, start);
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
        const w = text.slice(i, j);
        if ((w === 'L' || w === 'u' || w === 'U' || w === 'u8') && (text[j] === '"' || text[j] === "'")) throw err('wide and Unicode literals are not in the subset', start, { hint: 'use a plain "string" or \'c\'' });
        i = j;
        push({ t: KW.has(w) ? 'kw' : 'id', v: w }, start); continue;
      }
      if (c === "'") {
        let j = i + 1, code = null, count = 0;
        while (j < n && text[j] !== "'" && text[j] !== '\n') {
          let v;
          if (text[j] === '\\') { const [x, len] = escape(j + 1); v = x; j += 1 + len; } else { v = text.charCodeAt(j) & 255; j++; }
          code = code === null ? v : ((code << 8) | v); count++;
        }
        if (text[j] !== "'") throw err("a character constant is missing its closing '", start, { hint: "a character is written between single quotes, as in 'a' or '\\n'" });
        if (count === 0) throw err("an empty character constant ''", start);
        i = j + 1;
        push({ t: 'chr', v: count === 1 ? (code << 24) >> 24 : code | 0 }, start); continue;
      }
      if (c === '"') {
        let j = i + 1, s = '';
        while (j < n && text[j] !== '"') {
          if (text[j] === '\n') break;
          if (text[j] === '\\' && text[j + 1] === '\n') { j += 2; line++; lineStart = j; continue; }
          if (text[j] === '\\') { const [v, len] = escape(j + 1); s += String.fromCharCode(v); j += 1 + len; } else { s += String.fromCharCode(text.charCodeAt(j) & 255); j++; }
        }
        if (text[j] !== '"') throw err('a string is missing its closing "', start, { hint: 'a string ends on the line it starts; to continue it, close it and open another: "abc" "def"' });
        i = j + 1;
        push({ t: 'str', v: s }, start); continue;
      }
      const op = OPS.find((o) => text.startsWith(o, i));
      if (!op) throw err('unexpected character ' + JSON.stringify(c), start);
      i += op.length;
      push({ t: 'op', v: op === '%:%:' ? '##' : op }, start);
    }
    const last = toks[toks.length - 1];
    toks.push({ t: 'eof', v: '', s: '', line, col: i - lineStart + 1, ll: ll + 1, bol: true, sp: true, end: last ? { line: last.line, col: last.col + last.s.length } : null });
    return toks;
  };
  /** where a token ends: {line, col} just after its last character */
  C.tokEnd = (t) => { const nl = t.s.lastIndexOf('\n'); return nl < 0 ? { line: t.line, col: t.col + t.s.length } : { line: t.line + (t.s.match(/\n/g) || []).length, col: t.s.length - nl }; };
})(globalThis.Proses = globalThis.Proses || {});
