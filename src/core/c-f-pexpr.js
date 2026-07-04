// The C subset, stage three (continued): expressions, and the value of constant expressions (array lengths, enum
// values, case labels, #if is separate). Mixed into the parser (S.CLang.Parser) when it is first used.
// Expressions {e, line, col, ...}: num (v, long, unsigned, base), fnum (v, float), chr (v), str (v), id (name),
//   bin (op, a, b), asg (op, a, b), un (op: - + ! ~ * &, a), pre / post (op: ++ --, a), call (f, args), idx (a, i),
//   mem (a, name, arrow), cond (c, a, b), comma (a, b), sizeof (type | a), alignof (type), cast (type, a),
//   offsetof (type, path), list (items: [{desig, init}]) in initializers only.
//   S.CLang.constValue(e, typeOf?) -> a number (or BigInt), or null when e is not constant
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const ASG = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
  const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

  C.ParserExpr = {
    expr() {
      let a = this.assign();
      while (this.is(',')) { const t = this.next(); a = { e: 'comma', a, b: this.assign(), line: t.line, col: t.col }; }
      return a;
    },
    assign() {
      const a = this.cond();
      const t = this.peek();
      if (t.t === 'op' && ASG.has(t.v)) { this.next(); return { e: 'asg', op: t.v, a, b: this.assign(), line: t.line, col: t.col }; }
      if (t.t === 'op' && t.v === '=' ) return a;
      return a;
    },
    cond() {
      const c = this.binary(0);
      if (!this.is('?')) return c;
      const t = this.next(), a = this.expr();
      this.want(':', "':' in the ?: operator");
      const b = this.cond();
      return { e: 'cond', c, a, b, line: t.line, col: t.col };
    },
    binary(lv) {
      if (lv === LEVELS.length) return this.unary();
      let a = this.binary(lv + 1);
      for (;;) {
        const t = this.peek();
        if (t.t !== 'op' || !LEVELS[lv].includes(t.v)) return a;
        this.next();
        a = { e: 'bin', op: t.v, a, b: this.binary(lv + 1), line: t.line, col: t.col };
      }
    },
    unary() {
      const t = this.peek(), line = t.line, col = t.col;
      if (t.t === 'op') {
        if (t.v === '++' || t.v === '--') { this.next(); return { e: 'pre', op: t.v, a: this.unary(), line, col }; }
        if (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~' || t.v === '*' || t.v === '&') { this.next(); return { e: 'un', op: t.v, a: this.unary(), line, col }; }
        if (t.v === '(' && this.startsType(1)) {
          this.next(); const type = this.typeName(); this.want(')', "')' to close the cast");
          if (this.is('{')) throw this.err('compound literals ((type){...}) are not in the subset', t, 'declare a variable with that initializer instead');
          return { e: 'cast', type, a: this.unary(), line, col };
        }
      }
      if (t.t === 'kw' && t.v === 'sizeof') {
        this.next();
        if (this.is('(') && this.startsType(1)) { this.next(); const type = this.typeName(); this.want(')', "')' to close sizeof"); return { e: 'sizeof', type, line, col }; }
        return { e: 'sizeof', a: this.unary(), line, col };
      }
      if (t.t === 'kw' && t.v === '_Alignof') { this.next(); this.want('('); const type = this.typeName(); this.want(')'); return { e: 'alignof', type, line, col }; }
      return this.postfix();
    },
    postfix() {
      let a = this.primary();
      for (;;) {
        const t = this.peek();
        if (this.is('(')) {
          this.next(); const args = [];
          while (!this.is(')')) {
            if (this.peek().t === 'eof') throw this.err("expected ')' to close the call");
            args.push(this.assign());
            if (!this.is(')')) { if (!this.is(',')) throw this.errAfter("expected ',' or ')' in the call" + (a.e === 'id' ? ' of ' + a.name : '')); this.next(); }
          }
          this.next();
          a = { e: 'call', f: a, args, line: a.line, col: a.col };
        } else if (this.is('[')) { this.next(); const i = this.expr(); this.want(']', "']' to close the index"); a = { e: 'idx', a, i, line: t.line, col: t.col }; }
        else if (this.is('++') || this.is('--')) { this.next(); a = { e: 'post', op: t.v, a, line: t.line, col: t.col }; }
        else if (this.is('.') || this.is('->')) {
          this.next();
          const n = this.next();
          if (n.t !== 'id') throw this.err('expected a member name after ' + t.v, n);
          a = { e: 'mem', a, name: n.v, arrow: t.v === '->', line: t.line, col: t.col, ncol: n.col };
        } else return a;
      }
    },
    primary() {
      const t = this.next(), line = t.line, col = t.col;
      switch (t.t) {
        case 'num': return { e: 'num', v: t.v, long: t.long, unsigned: t.unsigned, base: t.base, line, col };
        case 'fnum': return { e: 'fnum', v: t.v, float: t.float, line, col };
        case 'chr': return { e: 'chr', v: t.v, line, col };
        case 'str': { let v = t.v; while (this.peek().t === 'str') v += this.next().v; return { e: 'str', v, line, col }; }
        case 'id': {
          if (t.v === '__builtin_offsetof') {
            this.want('('); const type = this.typeName(); this.want(','); const path = [];
            for (;;) {
              const n = this.next(); if (n.t !== 'id') throw this.err('expected a member name in offsetof', n);
              path.push(n.v);
              while (this.is('[')) { this.next(); const v = this.constValue(this.expr()); this.want(']'); path.push(Number(v)); }
              if (this.is('.')) { this.next(); continue; }
              break;
            }
            this.want(')');
            return { e: 'offsetof', type, path, line, col };
          }
          const ent = this.find(t.v);
          if (ent && ent.kind === 'enum') return { e: 'num', v: ent.v, enumName: t.v, line, col };
          if (ent && ent.kind === 'typedef') throw this.err(t.v + ' is a type, not a value', t, 'a type can be used in a declaration, a cast (' + t.v + ') x or sizeof(' + t.v + ')');
          return { e: 'id', name: t.v, line, col };
        }
        case 'op':
          if (t.v === '(') {
            const e = this.expr();
            if (!this.is(')')) throw this.errAfter("expected ')' to match the '(' at line " + line + ', column ' + col);
            this.next();
            e.paren = true;
            return e;
          }
          break;
        case 'kw':
          if (t.v === 'sizeof') { this.p--; return this.unary(); }
          this.p--;
          throw this.err('expected an expression', t, t.v === 'int' || t.v === 'char' ? 'a type cannot appear here; did you mean a cast, (' + t.v + ') x?' : undefined);
      }
      this.p--;
      throw this.err('expected an expression');
    },
    /** a constant expression's value, using what the parser knows of the variables in scope (for sizeof) */
    constValue(e) {
      return C.constValue(e, (x) => this.ptype(x));
    },
    /** the type of a simple expression, for sizeof in a constant (null when it cannot tell) */
    ptype(e) {
      const T = C.T;
      switch (e.e) {
        case 'id': { const v = this.find(e.name); return v && (v.kind === 'var' || v.kind === 'fn') ? v.type : null; }
        case 'str': return T.arr(T.CHAR, e.v.length + 1);
        case 'num': return e.long || e.v > 2147483647 || e.v < -2147483648 ? T.LONG : T.INT;
        case 'chr': return T.INT;
        case 'fnum': return e.float ? T.FLOAT : T.DOUBLE;
        case 'idx': { const a = this.ptype(e.a); return a && (a.k === 'arr' ? a.of : a.k === 'ptr' ? a.to : null); }
        case 'un': { const a = this.ptype(e.a); if (!a) return null; if (e.op === '*') return a.k === 'arr' ? a.of : a.k === 'ptr' ? a.to : null; if (e.op === '&') return T.ptr(a); return T.promote(a); }
        case 'mem': { let a = this.ptype(e.a); if (!a) return null; if (e.arrow) a = a.k === 'ptr' ? a.to : null; const f = a && T.field(a, e.name); return f ? f.type : null; }
        case 'cast': return e.type;
        case 'sizeof': return T.ULONG;
      }
      return null;
    },
  };

  /** the value of a constant integer expression, or null when it is not one */
  C.constValue = function (e, typeOf) {
    const v = (x) => C.constValue(x, typeOf);
    const T = C.T;
    switch (e.e) {
      case 'num': case 'chr': return e.v;
      case 'fnum': return null;
      case 'sizeof': {
        const t = e.type || (typeOf ? typeOf(e.a) : null);
        if (!t || (t.k === 'arr' && t.n !== null && t.n < 0)) return null;
        return T.size(t);
      }
      case 'alignof': return T.align(e.type);
      case 'offsetof': return C.offsetOf(e.type, e.path, e);
      case 'un': {
        const a = v(e.a); if (a === null) return null;
        const big = typeof a === 'bigint';
        switch (e.op) { case '-': return C.I64.norm(big ? -a : -a); case '+': return a; case '!': return a == 0 ? 1 : 0; case '~': return big ? C.I64.norm(~a) : ~a; } // eslint-disable-line eqeqeq
        return null;
      }
      case 'bin': {
        if (e.op === '&&') { const a = v(e.a); if (a === null) return null; if (a == 0) return 0; const b = v(e.b); return b === null ? null : b != 0 ? 1 : 0; } // eslint-disable-line eqeqeq
        if (e.op === '||') { const a = v(e.a); if (a === null) return null; if (a != 0) return 1; const b = v(e.b); return b === null ? null : b != 0 ? 1 : 0; } // eslint-disable-line eqeqeq
        const a = v(e.a), b = v(e.b); if (a === null || b === null) return null;
        if (typeof a === 'bigint' || typeof b === 'bigint' || Math.abs(a) > 2147483647 || Math.abs(b) > 2147483647) {
          const x = BigInt(a), y = BigInt(b);
          switch (e.op) {
            case '+': return C.I64.norm(x + y); case '-': return C.I64.norm(x - y); case '*': return C.I64.norm(x * y);
            case '/': return y ? C.I64.norm(x / y) : null; case '%': return y ? C.I64.norm(x % y) : null;
            case '<<': return C.I64.norm(BigInt.asIntN(64, x << y)); case '>>': return C.I64.norm(x >> y);
            case '&': return C.I64.norm(x & y); case '|': return C.I64.norm(x | y); case '^': return C.I64.norm(x ^ y);
            case '==': return +(x === y); case '!=': return +(x !== y); case '<': return +(x < y); case '>': return +(x > y); case '<=': return +(x <= y); case '>=': return +(x >= y);
          }
          return null;
        }
        switch (e.op) {
          case '+': return a + b; case '-': return a - b; case '*': return C.I64.norm(BigInt(a) * BigInt(b));
          case '/': return b ? Math.trunc(a / b) : null; case '%': return b ? a % b : null;
          case '<<': return C.I64.norm(BigInt(a) << BigInt(b)); case '>>': return a >> b; case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
          case '==': return +(a === b); case '!=': return +(a !== b); case '<': return +(a < b); case '>': return +(a > b);
          case '<=': return +(a <= b); case '>=': return +(a >= b);
        }
        return null;
      }
      case 'cond': { const c = v(e.c); return c === null ? null : c != 0 ? v(e.a) : v(e.b); } // eslint-disable-line eqeqeq
      case 'cast': {
        if (!T.isInt(e.type)) return null;
        const a = v(e.a); if (a === null) return null;
        return C.I64.wrap(a, T.kind(e.type));
      }
      case 'comma': return null;
    }
    return null;
  };
  /** offsetof(type, a.b[2].c) */
  C.offsetOf = function (type, path, at) {
    const T = C.T;
    let t = type, off = 0;
    for (const p of path) {
      if (typeof p === 'number') { if (t.k !== 'arr') throw new C.CError(at.line, 'offsetof: [' + p + '] needs an array member', at.col); off += p * T.size(t.of); t = t.of; continue; }
      if (!T.isAgg(t)) throw new C.CError(at.line, 'offsetof needs a struct or union type', at.col);
      const f = T.field(t, p);
      if (!f) throw new C.CError(at.line, C.T.name(t) + ' has no member named ' + p, at.col);
      off += f.off; t = f.type;
    }
    return off;
  };
})(globalThis.Proses = globalThis.Proses || {});
