// The C subset, stage two: the preprocessor. It works on tokens, so every token the parser sees still knows the
// line and column it came from; a macro's expansion takes the place of the name that invoked it.
//   #include <...>         the standard headers are known (their declarations are always available; the
//                          include is recorded so the compiler can hint at a missing one); "local.h" is refused
//   #define NAME body       object-like; #define NAME(a, b) body, function-like, with # (stringify) and ## (paste)
//   #undef  #if #ifdef #ifndef #elif #else #endif   #if takes integer arithmetic with defined(NAME)
//   #error #warning #pragma #line                   #error stops with its message; the others are noted or ignored
// Predefined: the header macros of c-h-consts.js (NULL, EOF, EXIT_SUCCESS, the O_* flags, the SIG* numbers, SEEK_*,
// the W* wait macros, assert, offsetof, INT_MAX...), __LINE__, __FILE__, __STDC__, __STDC_VERSION__, __linux__,
// __unix__, __LP64__, __x86_64__. A program's own #define replaces any of them.
//   S.CLang.preprocess(src, {file}) -> {tokens, text, macros, includes: [{name, line}], warnings}
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const KNOWN_DIRS = new Set(['include', 'define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif', 'error', 'warning', 'pragma', 'line', '']);

  let predef = null;
  function predefined() {
    if (predef) return predef;
    predef = {};
    const toks = (body) => C.lex(body).filter((t) => t.t !== 'eof');
    for (const [k, v] of Object.entries(C.CONSTS)) predef[k] = { body: toks(v < 0 ? '(' + v + ')' : String(v)), pre: true };
    for (const [k, m] of Object.entries(C.MACRO_TEXT)) predef[k] = { params: m.params, body: toks(m.body), pre: true };
    for (const [k, v] of Object.entries({ __STDC__: '1', __STDC_VERSION__: '201112L', __STDC_HOSTED__: '1', __linux__: '1', __linux: '1', linux: '1', __unix__: '1', __unix: '1', unix: '1', __LP64__: '1', _LP64: '1', __x86_64__: '1', __CHAR_BIT__: '8', __SIZEOF_INT__: '4', __SIZEOF_LONG__: '8', __SIZEOF_POINTER__: '8' })) predef[k] = { body: toks(v), pre: true };
    return predef;
  }

  C.preprocess = function (src, opts) {
    opts = opts || {};
    const file = opts.file || 'prog.c';
    const all = C.lex(src);
    const eof = all[all.length - 1];
    const macros = Object.assign(Object.create(null), predefined());
    const out = [], includes = [], warnings = [];
    const err = (t, msg, hint) => new C.CError(t.line, msg, t.col, hint ? { hint } : undefined);
    const clone = (t, at, hide) => Object.assign({}, t, { line: at.line, col: at.col, ll: at.ll, bol: false, hide, from: at.from || at.v });

    /** expand the macros in a list of tokens (rescanning each expansion with its name hidden) */
    function expand(input) {
      const res = [];
      const q = input.slice();
      let i = 0;
      while (i < q.length) {
        const t = q[i];
        if (t.t !== 'id' || (t.hide && t.hide.has(t.v))) { res.push(t); i++; continue; }
        if (t.v === '__LINE__') { res.push(Object.assign({}, t, { t: 'num', v: t.line, long: 0, unsigned: false, base: 10, s: String(t.line) })); i++; continue; }
        if (t.v === '__FILE__') { res.push(Object.assign({}, t, { t: 'str', v: file, s: JSON.stringify(file) })); i++; continue; }
        const m = macros[t.v];
        if (!m) { res.push(t); i++; continue; }
        const hide = new Set(t.hide || []); hide.add(t.v);
        if (!m.params) {
          const body = m.body.map((b) => clone(b, t, hide));
          q.splice(i, 1, ...body); continue;
        }
        if (!(q[i + 1] && q[i + 1].t === 'op' && q[i + 1].v === '(')) { res.push(t); i++; continue; }
        // collect the arguments, minding nested brackets
        const args = [[]]; let depth = 0, k = i + 2;
        for (; k < q.length; k++) {
          const a = q[k];
          if (a.t === 'op' && a.v === '(') depth++;
          else if (a.t === 'op' && a.v === ')') { if (depth === 0) break; depth--; }
          else if (a.t === 'op' && a.v === ',' && depth === 0 && !(m.variadic && args.length > m.params.length - 1)) { args.push([]); continue; }
          args[args.length - 1].push(a);
        }
        if (k >= q.length) throw err(t, 'the macro ' + t.v + ' is called without its closing )');
        if (args.length === 1 && !args[0].length && m.params.length === 0) args.length = 0;
        const want = m.params.length;
        if (args.length !== want && !(m.variadic && args.length >= want - 1)) throw err(t, 'the macro ' + t.v + ' takes ' + want + ' argument' + (want === 1 ? '' : 's') + ', not ' + args.length);
        const body = substitute(m, args, t, hide);
        q.splice(i, k - i + 1, ...body);
      }
      return res;
    }
    function substitute(m, args, at, hide) {
      const pIndex = (tok) => (tok && tok.t === 'id' ? m.params.indexOf(tok.v) : -1);
      const argOf = (p) => args[p] || [];
      const body = m.body, outT = [];
      for (let j = 0; j < body.length; j++) {
        const b = body[j];
        if (b.t === 'op' && b.v === '#' && pIndex(body[j + 1]) >= 0) {
          const a = argOf(pIndex(body[j + 1]));
          const text = a.map((x, n) => (n && x.sp ? ' ' : '') + x.s).join('');
          outT.push(clone({ t: 'str', v: text, s: JSON.stringify(text) }, at, hide)); j++; continue;
        }
        const p = pIndex(b);
        const pasteNext = body[j + 1] && body[j + 1].t === 'op' && body[j + 1].v === '##';
        const pastePrev = j > 0 && body[j - 1].t === 'op' && body[j - 1].v === '##';
        if (b.t === 'op' && b.v === '##') continue;
        let piece = p >= 0 ? (pasteNext || pastePrev ? argOf(p) : expand(argOf(p))) : [b];
        piece = piece.map((x, n) => clone(x, at, n === 0 && p < 0 ? hide : new Set([...(x.hide || []), ...hide])));
        if (n0(piece) && pastePrev && outT.length) {
          const left = outT.pop(), right = piece.shift();
          const glued = C.lex(left.s + right.s).filter((x) => x.t !== 'eof');
          if (glued.length !== 1) throw err(at, '## glues ' + left.s + ' and ' + right.s + ' into something that is not one token');
          outT.push(clone(glued[0], at, hide));
        }
        outT.push(...piece);
      }
      return outT.map((x) => { x.hide = new Set([...(x.hide || []), ...hide]); return x; });
    }
    const n0 = (a) => a.length > 0;

    /** the value of an #if line */
    function ifValue(toks, at) {
      const pre = [];
      for (let j = 0; j < toks.length; j++) {
        const t = toks[j];
        if (t.t === 'id' && t.v === 'defined') {
          let name = toks[j + 1], close = 0;
          if (name && name.t === 'op' && name.v === '(') { name = toks[j + 2]; close = 1; }
          if (!name || (name.t !== 'id' && name.t !== 'kw')) throw err(t, 'defined needs a macro name');
          pre.push(Object.assign({}, t, { t: 'num', v: macros[name.v] ? 1 : 0 }));
          j += close ? 3 : 1; continue;
        }
        pre.push(t);
      }
      const e = expand(pre).map((t) => (t.t === 'id' || t.t === 'kw' ? Object.assign({}, t, { t: 'num', v: 0 }) : t));
      let i = 0;
      const bad = (t) => { throw err(t || at, '#if needs a constant integer expression', 'only numbers, macros, defined(NAME) and the integer operators can appear in an #if'); };
      const peekOp = (v) => e[i] && e[i].t === 'op' && e[i].v === v;
      const prim = () => {
        const t = e[i++];
        if (!t) return bad();
        if (t.t === 'num' || t.t === 'chr') return Number(t.v);
        if (t.t === 'op') {
          if (t.v === '(') { const v = cond(); if (!peekOp(')')) bad(t); i++; return v; }
          if (t.v === '!') return prim() ? 0 : 1;
          if (t.v === '-') return -prim();
          if (t.v === '+') return prim();
          if (t.v === '~') return ~prim();
        }
        return bad(t);
      };
      const LV = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
      const bin = (lv) => {
        if (lv === LV.length) return prim();
        let a = bin(lv + 1);
        while (e[i] && e[i].t === 'op' && LV[lv].includes(e[i].v)) {
          const o = e[i++].v, b = bin(lv + 1);
          if ((o === '/' || o === '%') && b === 0) throw err(at, 'division by zero in #if');
          a = o === '||' ? +(a || b) : o === '&&' ? +(a && b) : o === '|' ? a | b : o === '^' ? a ^ b : o === '&' ? a & b : o === '==' ? +(a === b) : o === '!=' ? +(a !== b)
            : o === '<' ? +(a < b) : o === '>' ? +(a > b) : o === '<=' ? +(a <= b) : o === '>=' ? +(a >= b) : o === '<<' ? a * Math.pow(2, b) : o === '>>' ? Math.floor(a / Math.pow(2, b))
              : o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : o === '/' ? Math.trunc(a / b) : a % b;
        }
        return a;
      };
      const cond = () => { const c = bin(0); if (peekOp('?')) { i++; const a = cond(); if (!peekOp(':')) bad(); i++; const b = cond(); return c ? a : b; } return c; };
      if (!e.length) bad();
      const v = cond();
      if (i !== e.length) bad(e[i]);
      return v;
    }

    // walk the logical lines: a directive is a line whose first token is #
    const conds = []; // {on, taken, else, at}
    const live = () => conds.every((c) => c.on);
    let i = 0, run = [];
    const flush = () => { if (run.length) { out.push(...expand(run)); run = []; } };
    while (i < all.length - 1) {
      const t = all[i];
      if (!(t.bol && t.t === 'op' && t.v === '#')) {
        if (live()) run.push(t);
        i++; continue;
      }
      flush();
      let j = i + 1; const line = [];
      while (j < all.length - 1 && all[j].ll === t.ll) line.push(all[j++]);
      i = j;
      const d = line[0], dir = d ? d.v : '', rest = line.slice(1);
      if (d && d.t !== 'id' && d.t !== 'kw') { if (live()) throw err(d, 'a # line needs a directive such as #include or #define'); continue; }
      if (!KNOWN_DIRS.has(dir)) { if (live()) throw err(d, 'the directive #' + dir + ' is not in the subset', 'the directives are #include, #define, #undef, #if, #ifdef, #ifndef, #elif, #else, #endif, #error and #pragma'); continue; }
      if (dir === 'ifdef' || dir === 'ifndef') {
        if (!rest[0]) throw err(d, '#' + dir + ' needs a macro name');
        const has = !!macros[rest[0].v], on = dir === 'ifdef' ? has : !has;
        conds.push({ on, taken: on, at: d }); continue;
      }
      if (dir === 'if') { const on = live() ? !!ifValue(rest, d) : false; conds.push({ on, taken: on, at: d }); continue; }
      if (dir === 'elif') {
        const c = conds[conds.length - 1];
        if (!c) throw err(d, '#elif without #if');
        if (c.else) throw err(d, '#elif after #else');
        const outer = conds.slice(0, -1).every((x) => x.on);
        if (c.taken || !outer) c.on = false; else { c.on = !!ifValue(rest, d); c.taken = c.on; }
        continue;
      }
      if (dir === 'else') { const c = conds[conds.length - 1]; if (!c) throw err(d, '#else without #if'); if (c.else) throw err(d, 'a second #else for the same #if'); c.on = !c.taken; c.taken = true; c.else = true; continue; }
      if (dir === 'endif') { if (!conds.pop()) throw err(d, '#endif without #if'); continue; }
      if (!live()) continue;
      if (dir === '' || dir === 'pragma' || dir === 'line') continue;
      if (dir === 'error') throw err(d, '#error ' + rest.map((x) => x.s).join(' '));
      if (dir === 'warning') { warnings.push({ line: d.line, col: d.col, kind: 'pp', msg: '#warning ' + rest.map((x) => x.s).join(' ') }); continue; }
      if (dir === 'include') {
        const first = rest[0];
        if (first && first.t === 'str') throw err(first, 'only the standard headers can be included here: ' + first.s + ' is a file of your own', 'paste the declarations it holds into the program instead');
        if (!first || first.v !== '<') throw err(d, '#include needs a header name such as <stdio.h>');
        const name = rest.slice(1, rest.findIndex((x) => x.v === '>')).map((x) => x.s).join('');
        if (!(name in C.HEADERS)) warnings.push({ line: d.line, col: d.col, kind: 'include', msg: 'the simulated system has no <' + name + '>; only the standard headers are known' });
        includes.push({ name, line: d.line });
        continue;
      }
      if (dir === 'define') {
        const nm = rest[0];
        if (!nm || (nm.t !== 'id' && nm.t !== 'kw')) throw err(d, '#define needs a name');
        const fnLike = rest[1] && rest[1].t === 'op' && rest[1].v === '(' && !rest[1].sp;
        if (!fnLike) { macros[nm.v] = { body: rest.slice(1), line: d.line }; continue; }
        const params = []; let k = 2, variadic = false;
        while (k < rest.length && !(rest[k].t === 'op' && rest[k].v === ')')) {
          const p = rest[k];
          if (p.t === 'op' && p.v === '...') { variadic = true; params.push('__VA_ARGS__'); k++; continue; }
          if (p.t !== 'id') throw err(p, 'the parameters of macro ' + nm.v + ' must be names');
          params.push(p.v); k++;
          if (rest[k] && rest[k].t === 'op' && rest[k].v === ',') k++;
        }
        if (k >= rest.length) throw err(nm, 'the parameter list of macro ' + nm.v + ' is missing its )');
        macros[nm.v] = { params, variadic, body: rest.slice(k + 1), line: d.line };
        continue;
      }
      if (dir === 'undef') { if (rest[0]) delete macros[rest[0].v]; continue; }
    }
    flush();
    if (conds.length) { const c = conds[conds.length - 1].at; throw err(c, 'this #' + c.v + ' is missing its #endif'); }
    out.push(eof);
    return { tokens: out, text: textOf(out), macros, includes, warnings };
  };

  /** the tokens as text, each on its own source line (for tests and for showing an expansion) */
  function textOf(toks) {
    const lines = [];
    for (const t of toks) {
      if (t.t === 'eof') break;
      const l = t.line - 1;
      while (lines.length <= l) lines.push('');
      lines[l] += (lines[l] && (t.sp || t.from) ? ' ' : '') + t.s;
    }
    return lines.join('\n');
  }
})(globalThis.Proses = globalThis.Proses || {});
