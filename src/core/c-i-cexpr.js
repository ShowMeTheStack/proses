// The C subset, stage four (continued): expressions. Mixed into the compiler (S.CLang.Compiler) when it is first
// used. rv(e) leaves e's value on the machine's operand stack and returns its type (an array becomes a pointer to
// its first element, a function a pointer to it; a struct or union leaves its address); lv(e) leaves the address
// of the object e names and returns its type. Arithmetic is done in the kind of the usual conversions (i u l ul f d);
// address arithmetic uses 'abin', so a machine step never stops on it.
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const CMP = new Set(['==', '!=', '<', '>', '<=', '>=']);
  C.FMTARG = { printf: 0, fprintf: 1, dprintf: 1, sprintf: 1, snprintf: 2, sscanf: 1 };

  C.CompileExpr = {
    kind(t) { return C.T.kind(t); },
    load(t) {
      const T = C.T;
      if (t.k === 'fn' || t.k === 'void') throw this.err('a value of type ' + T.name(t) + ' cannot be read');
      this.emit('ld', T.kind(t));
    },
    store(t) { if (t.k === 'ptr') this.emit('st', 'p', t.to); else this.emit('st', C.T.kind(t)); },
    /** convert the value on top from type `from` to `to` */
    convert(from, to) {
      const T = C.T;
      from = T.decay(from);
      if (to.k === 'void') return;
      const a = T.kind(from), b = T.kind(to);
      if (a !== b && !(a === 'p' && b === 'ul') && !(a === 'ul' && b === 'p')) this.emit('cvt', b);
    },
    isNull(e) { const v = e.e === 'cast' ? (C.T.isInt(e.type) || (e.type.k === 'ptr' && e.type.to.k === 'void') ? this.isNull(e.a) : false) : e.e === 'num' || e.e === 'chr' ? e.v === 0 : C.constValue(e) === 0; return v; },
    /** the checks C makes when a value of type from is assigned (or passed, or returned) as type to */
    assignConvert(from, to, node, what, loose) {
      const T = C.T;
      from = T.decay(from);
      if (from.k === 'void') throw this.err('a void value cannot be used to ' + what, node, 'a function returning void has no result');
      if (T.isAgg(to) || T.isAgg(from)) { if (!T.isAgg(to) || !T.isAgg(from) || !T.same(T.unq(to), T.unq(from))) throw this.err('cannot ' + what + ' ' + T.name(to) + ' from ' + T.name(from), node); return; }
      if (to.k === 'ptr') {
        if (from.k === 'ptr') {
          if (!T.ptrCompatible(to.to, from.to) && !loose) this.warn('ptr-type', 'a ' + T.name(from) + ' is used as a ' + T.name(to) + ' without a cast', node, 'the two pointer types differ; cast if this is really meant');
        } else if (T.isInt(from)) {
          if (!this.isNull(node) && !loose) throw this.err('using the integer as the pointer ' + T.name(to) + ' needs a cast', node, 'did you mean to take its address with &, or to cast it: (' + T.name(to) + ')');
        } else throw this.err('cannot ' + what + ' a ' + T.name(to) + ' from a ' + T.name(from), node);
      } else if (T.isInt(to) && from.k === 'ptr' && to.k !== 'bool') {
        if (!loose) throw this.err('using the pointer as an integer (' + T.name(to) + ') needs a cast', node, 'did you mean to dereference it with *?');
      }
      this.convert(from, to);
    },
    /** e, compiled for a branch: its value (zero is false) */
    test(e) {
      const t = C.T.decay(this.rv(e));
      if (!C.T.isScalar(t)) throw this.err('a condition must be a number or a pointer, not ' + C.T.name(t), e);
      return t;
    },
    /** the type of e without code (its code is compiled and thrown away) */
    typeOf(e) {
      const n = this.code.length, w = this.warnings.length, fr = this.F && this.F.frame, objs = this.F && this.F.objs.length;
      let t;
      try { t = this.rvRaw(e); } finally {
        this.code.length = n; this.lines.length = n; this.cols.length = n; this.warnings.length = w;
        if (this.F) { this.F.frame = fr; this.F.objs.length = objs; }
      }
      return t;
    },
    /** like rv, but an array keeps its array type (for sizeof and &) */
    rvRaw(e) {
      if (e.e === 'str') { this.emit('k', 0); return C.T.arr(C.T.CHAR, e.v.length + 1); }
      if (e.e === 'id' || e.e === 'idx' || e.e === 'mem' || (e.e === 'un' && e.op === '*')) {
        if (e.e === 'id') { const v = this.lookup(e.name); if (!v || v.kind === 'fn') return this.rv(e); }
        return this.lv(e);
      }
      return this.rv(e);
    },

    // ---- addresses ------------------------------------------------------------------------------------------
    lv(e) {
      const T = C.T;
      this.at(e);
      switch (e.e) {
        case 'id': {
          let v = this.lookup(e.name);
          if (!v) { const u = this.undeclared(e); if (!u.retry) throw u; v = this.lookup(e.name); }
          if (v.kind === 'local') { this.emit('lea', v.off); return v.type; }
          if (v.kind === 'global') { this.emit('k', v.addr); return v.type; }
          if (v.kind === 'vla') { this.emit('lea', v.off); this.emit('ld', 'p'); return v.type; }
          throw this.err(e.name + ' is a function, not a variable', e);
        }
        case 'un': {
          if (e.op !== '*') break;
          const t = C.T.decay(this.rv(e.a));
          this.at(e);
          if (t.k !== 'ptr') throw this.err('only a pointer can be dereferenced with *, not ' + T.name(t), e, T.isInt(t) ? 'did you mean to declare it as a pointer, ' + T.name(t) + ' *?' : undefined);
          if (t.to.k === 'void') throw this.err('a void * must be cast to a real pointer type before it is dereferenced', e, 'for example *(int *)p');
          if (t.to.k === 'fn') return t.to;
          if (T.isAgg(t.to) && !t.to.complete) throw this.err(T.name(t.to) + ' is incomplete here, so *' + ' cannot reach into it', e);
          return t.to;
        }
        case 'idx': {
          let ta = C.T.decay(this.rv(e.a)); let ti = C.T.decay(this.rv(e.i));
          this.at(e);
          if (T.isInt(ta) && ti.k === 'ptr') { this.emit('swap'); const x = ta; ta = ti; ti = x; }
          if (ta.k !== 'ptr') throw this.err('[ ] needs an array or a pointer on its left, not ' + T.name(ta), e);
          if (!T.isInt(ti)) throw this.err('an array index must be an integer, not ' + T.name(ti), e.i);
          if (ta.to.k === 'void') throw this.err('a void * cannot be indexed; cast it to a real pointer type first', e);
          this.boundsWarn(e);
          this.convert(ti, T.LONG); this.emit('k', T.size(ta.to)); this.emit('abin', '*'); this.emit('abin', '+');
          return ta.to;
        }
        case 'mem': {
          let t;
          if (e.arrow) {
            t = C.T.decay(this.rv(e.a));
            if (t.k !== 'ptr' || !T.isAgg(t.to)) throw this.err('-> needs a pointer to a struct or union, not ' + T.name(t), e, T.isAgg(t) ? 'it is a struct itself: use . instead of ->' : undefined);
            t = t.to;
          } else {
            t = this.rvRawAgg(e.a);
            if (!T.isAgg(t)) throw this.err('. needs a struct or union, not ' + T.name(t), e, t.k === 'ptr' && T.isAgg(t.to) ? 'it is a pointer to a struct: use -> instead of .' : undefined);
          }
          if (!t.complete) throw this.err(T.name(t) + ' is incomplete here, so its member ' + e.name + ' cannot be used', e);
          const f = T.field(t, e.name);
          if (!f) { const near = C.suggest(e.name, t.fields.map((x) => x.name).filter(Boolean)); throw this.err(T.name(t) + ' has no member named ' + e.name, { line: e.line, col: e.ncol || e.col }, near ? 'did you mean ' + near + '?' : 'its members are ' + t.fields.map((x) => x.name).filter(Boolean).join(', ')); }
          this.at(e);
          if (f.off) { this.emit('k', f.off); this.emit('abin', '+'); }
          return T.qual(f.type, t.c);
        }
        case 'str': this.emit('k', this.intern(e.v)); return T.arr(T.CHAR, e.v.length + 1);
        case 'call': case 'cond': case 'comma': case 'asg': {
          const t = this.rv(e);
          if (T.isAgg(t)) return t;
          break;
        }
      }
      throw this.err('this expression has no address, so it cannot be assigned to or used with &', e, e.e === 'num' ? 'a number is not a variable' : undefined);
    },
    rvRawAgg(e) { const t = this.rvRaw(e); return t; },
    boundsWarn(e) {
      const v = C.constValue(e.i);
      if (v === null || e.a.e !== 'id') return;
      const s = this.lookup(e.a.name);
      if (s && s.type && s.type.k === 'arr' && s.type.n !== null && s.type.n >= 0 && (v < 0 || v >= s.type.n)) this.warn('bounds', 'the index ' + v + ' is outside ' + e.a.name + ', which has ' + s.type.n + ' elements (0 to ' + (s.type.n - 1) + ')', e.i);
    },
    undeclared(e) {
      const name = e.name;
      const later = this.aheadVars && this.aheadVars.get(name);
      if (later && !this.lookup(name)) {
        if (!name.startsWith('__')) this.warn('implicit', name + ' is used before it is declared', e, 'move its declaration above the first use');
        this.globalVar(later);
        return { retry: true };
      }
      const h = C.headerOf(name);
      if (h.length) return this.err(name + ' is not declared', e, name + ' comes from <' + h[0] + '>: add #include <' + h[0] + '>');
      const near = C.suggest(name, this.visibleNames());
      return this.err(name + ' is not declared', e, near ? 'did you mean ' + near + '?' : 'declare it before it is used');
    },

    // ---- values ---------------------------------------------------------------------------------------------
    rv(e, used) {
      const T = C.T;
      this.at(e);
      switch (e.e) {
        case 'num': {
          const t = this.numType(e);
          this.emit('k', C.I64.wrap(e.v, T.kind(t))); return t;
        }
        case 'fnum': this.emit('k', e.float ? Math.fround(e.v) : e.v); return e.float ? T.FLOAT : T.DOUBLE;
        case 'chr': this.emit('k', e.v); return T.INT;
        case 'str': this.emit('k', this.intern(e.v)); return T.ptr(T.CHAR);
        case 'id': {
          if (e.name === '__func__' && !this.lookup('__func__')) { this.emit('k', this.intern(this.F ? this.F.name : '')); return T.ptr(T.CHAR); }
          const v = this.lookup(e.name);
          if (!v) {
            const lib = this.libFn(e.name);
            if (lib && lib.index >= 0) { this.libRefs = true; this.emit('k', C.FN_BASE + C.LIB_FN + lib.index); return T.ptr(lib.type); }
            if (this.ahead.has(e.name)) { const F = this.implicit(e); this.useFn(F); this.emit('k', F.addr); return T.ptr(F.type); }
            const u = this.undeclared(e);
            if (!u.retry) throw u;
            return this.valueAt(this.lv(e));
          }
          if (v.kind === 'fn') { this.useFn(v.F); this.emit('k', v.F.addr); return T.ptr(v.F.type); }
          const t = this.lv(e);
          return this.valueAt(t);
        }
        case 'idx': case 'mem': return this.valueAt(this.lv(e));
        case 'un': return this.unary(e);
        case 'bin': return this.binary(e);
        case 'asg': return this.assign(e);
        case 'pre': case 'post': return this.incdec(e);
        case 'cond': return this.ternary(e);
        case 'comma': this.rv(e.a, false); this.emit('pop'); return this.rv(e.b, used);
        case 'sizeof': {
          if (e.type) { if (e.type.k === 'arr' && e.type.n < 0) throw this.err('sizeof a variable-length array type is not in the subset', e); this.emit('k', T.size(e.type)); return T.ULONG; }
          if (e.a.e === 'id') { const v = this.lookup(e.a.name); if (v && v.kind === 'vla') { this.emit('lea', v.soff); this.emit('ld', 'ul'); return T.ULONG; } }
          const t = this.typeOf(e.a);
          if (t.k === 'fn') throw this.err('sizeof cannot measure a function', e);
          if (T.isAgg(t) && !t.complete) throw this.err('sizeof cannot measure ' + T.name(t) + ': its members are not known here', e);
          this.emit('k', T.size(t)); return T.ULONG;
        }
        case 'alignof': this.emit('k', T.align(e.type)); return T.ULONG;
        case 'offsetof': this.emit('k', C.offsetOf(e.type, e.path, e)); return T.ULONG;
        case 'cast': {
          const t = this.rv(e.a, e.type.k === 'void' ? false : undefined);
          this.at(e);
          if (e.type.k === 'void') { this.emit('pop'); this.emit('k', 0); return T.VOID; }
          if (T.isAgg(e.type) || e.type.k === 'arr') throw this.err('cannot cast to ' + T.name(e.type) + '; only to a number or a pointer type', e);
          const from = T.decay(t);
          if (!T.isScalar(from)) throw this.err('cannot cast a ' + T.name(from) + ' to ' + T.name(e.type), e);
          if (T.isFloat(from) && e.type.k === 'ptr') throw this.err('a floating-point value cannot be cast to a pointer', e);
          this.convert(from, e.type); return T.unq(e.type);
        }
        case 'call': return this.call(e, used !== false);
        case 'list': throw this.err('a { } list can only initialise a variable', e);
      }
      throw this.err('this expression is not in the subset', e);
    },
    /** the type a constant gets: int, then long (or unsigned for hex), by its value and suffix */
    numType(e) {
      const T = C.T, v = e.v, hex = e.base !== 10;
      const fitsI = v >= -2147483648 && v <= 2147483647, fitsU = v >= 0 && v <= 4294967295, fitsL = typeof v === 'number' || (v >= -9223372036854775808n && v <= 9223372036854775807n);
      if (e.unsigned) return !e.long && fitsU ? T.UINT : T.ULONG;
      if (e.long) return fitsL ? T.LONG : T.ULONG;
      if (fitsI) return T.INT;
      if (hex && fitsU) return T.UINT;
      if (fitsL) return T.LONG;
      return T.ULONG;
    },
    /** the value of the object whose address is on top (arrays decay, structs stay as their address) */
    valueAt(t) {
      const T = C.T;
      if (t.k === 'arr') return T.decay(t);
      if (t.k === 'fn') return T.ptr(t);
      if (T.isAgg(t)) return t;
      this.load(t);
      return T.unq(t);
    },
    useFn(F) { if (!F.body) (this.fnRefs = this.fnRefs || []).push(F); },
    unary(e) {
      const T = C.T;
      if (e.op === '*') return this.valueAt(this.lv(e));
      if (e.op === '&') {
        if (e.a.e === 'un' && e.a.op === '*') { const t = T.decay(this.rv(e.a.a)); if (t.k !== 'ptr') throw this.err('only a pointer can be dereferenced with *', e.a); return t; }
        if (e.a.e === 'id') { const v = this.lookup(e.a.name); if (v && v.kind === 'fn') return this.rv(e.a); if (!v && (this.libFn(e.a.name) || this.ahead.has(e.a.name))) return this.rv(e.a); }
        const t = this.lv(e.a);
        if (t.k === 'fn') return T.ptr(t);
        return T.ptr(t);
      }
      const t = T.decay(this.rv(e.a));
      this.at(e);
      if (e.op === '!') { if (!T.isScalar(t)) throw this.err('! needs a number or a pointer, not ' + T.name(t), e); this.emit('un', '!', T.kind(t)); return T.INT; }
      if (e.op === '~' && !T.isInt(t)) throw this.err('~ needs an integer, not ' + T.name(t), e);
      if (!T.isArith(t)) throw this.err(e.op + ' needs a number, not ' + T.name(t), e);
      const pt = T.promote(t);
      this.convert(t, pt);
      if (e.op === '-' || e.op === '~') this.emit('un', e.op, T.kind(pt));
      return pt;
    },
    binary(e) {
      const T = C.T, op = e.op;
      if (op === '&&' || op === '||') {
        this.test(e.a); const j1 = this.emit(op === '&&' ? 'jz' : 'jnz', 0);
        this.test(e.b); this.at(e); const j2 = this.emit(op === '&&' ? 'jz' : 'jnz', 0);
        this.emit('k', op === '&&' ? 1 : 0); const j3 = this.emit('jmp', 0);
        this.patch(j1, this.here()); this.patch(j2, this.here()); this.emit('k', op === '&&' ? 0 : 1); this.patch(j3, this.here());
        return T.INT;
      }
      const ta = T.decay(this.rv(e.a)), tb = T.decay(this.rv(e.b));
      this.at(e);
      return this.arith(op, ta, tb, e);
    },
    /** both operands are on the stack (a below b); emit op and return the result type */
    arith(op, ta, tb, e) {
      const T = C.T;
      const pa = ta.k === 'ptr', pb = tb.k === 'ptr';
      const convA = (k) => { this.emit('swap'); this.emit('cvt', k); this.emit('swap'); };
      if (!T.isScalar(ta) || !T.isScalar(tb)) throw this.err('the operator ' + op + ' needs numbers' + (op === '==' || op === '!=' ? ' or pointers' : '') + ', not ' + T.name(T.isScalar(ta) ? tb : ta), e, T.isAgg(ta) || T.isAgg(tb) ? 'structs cannot be compared or added; work member by member' : undefined);
      if ((op === '+' || op === '-') && (pa || pb)) {
        if (pa && pb) {
          if (op === '+') throw this.err('two pointers cannot be added', e);
          if (!T.same(T.unq(ta.to), T.unq(tb.to))) throw this.err('pointers to different types cannot be subtracted: ' + T.name(ta) + ' and ' + T.name(tb), e);
          this.emit('abin', '-'); this.emit('k', Math.max(1, T.size(ta.to))); this.emit('abin', '/'); return T.LONG;
        }
        const tp = pa ? ta : tb, ti = pa ? tb : ta;
        if (!T.isInt(ti)) throw this.err(op + ' needs a pointer and an integer, not ' + T.name(ti), e);
        if (op === '-' && pb) throw this.err('an integer minus a pointer is not defined', e);
        if (tp.to.k === 'fn') throw this.err('arithmetic on a function pointer is not allowed', e);
        if (pb) this.emit('swap');
        this.convert(ti, T.LONG); this.emit('k', Math.max(1, T.size(tp.to))); this.emit('abin', '*');
        this.emit('abin', op); return tp;
      }
      if (CMP.has(op)) {
        if (pa || pb) {
          if (pa && pb) { if (!T.ptrCompatible(ta.to, tb.to)) this.warn('ptr-cmp', 'comparing ' + T.name(ta) + ' with ' + T.name(tb), e); }
          else if (T.isFloat(pa ? tb : ta)) throw this.err('a pointer cannot be compared with a floating-point number', e);
          else if (!this.isNull(pa ? e.b : e.a)) this.warn('ptr-int', 'comparing a pointer with an integer', e, 'compare with NULL, or cast');
          if (!pa) convA('p'); if (!pb) this.emit('cvt', 'p');
          this.emit('bin', op, 'ul'); return T.INT;
        }
        const t = T.arith(ta, tb), k = T.kind(t);
        if (T.kind(tb) !== k) this.emit('cvt', k);
        if (T.kind(ta) !== k) convA(k);
        if (t.u && ((T.isInt(ta) && !ta.u && T.size(T.promote(ta)) >= T.size(t) && !(e.a.e === 'num')) || (T.isInt(tb) && !tb.u && T.size(T.promote(tb)) >= T.size(t) && !(e.b.e === 'num')))) this.warn('sign-cmp', 'comparing a signed and an unsigned value: the signed one is converted to unsigned', e, 'a negative number becomes a huge unsigned one here');
        this.emit('bin', op, k); return T.INT;
      }
      if (pa || pb) throw this.err('the operator ' + op + ' does not take a pointer', e);
      if (op === '<<' || op === '>>') {
        if (!T.isInt(ta) || !T.isInt(tb)) throw this.err(op + ' needs integers', e);
        const t = T.promote(ta), k = T.kind(t);
        if (T.kind(tb) !== 'i') this.emit('cvt', 'i');
        if (T.kind(ta) !== k) convA(k);
        this.emit('bin', op, k); return t;
      }
      if ((op === '%' || op === '&' || op === '|' || op === '^') && (!T.isInt(ta) || !T.isInt(tb))) throw this.err('the operator ' + op + ' needs integers, not ' + T.name(T.isInt(ta) ? tb : ta), e, op === '%' ? 'for floating-point numbers use fmod from <math.h>' : undefined);
      const t = T.arith(ta, tb), k = T.kind(t);
      if (T.kind(tb) !== k) this.emit('cvt', k);
      if (T.kind(ta) !== k) convA(k);
      this.emit('bin', op, k); return t;
    },
    assign(e) {
      const T = C.T;
      const t = this.lv(e.a);
      this.at(e);
      if (t.k === 'arr') throw this.err('an array cannot be assigned to', e, 'copy it element by element, or with memcpy or strcpy');
      if (t.k === 'fn') throw this.err('a function cannot be assigned to', e);
      if (t.c) throw this.err((e.a.e === 'id' ? e.a.name : 'this') + ' is const, so it cannot be assigned to', e);
      if (T.isAgg(t)) {
        if (e.op !== '=') throw this.err('the operator ' + e.op + ' does not take a struct', e);
        const tb = this.rv(e.b); this.at(e);
        if (!T.isAgg(tb) || !T.same(T.unq(tb), T.unq(t))) throw this.err('cannot assign ' + T.name(tb) + ' to ' + T.name(t), e);
        this.emit('copy', T.size(t)); return t;
      }
      if (e.op === '=') {
        const tb = this.rv(e.b); this.at(e);
        this.assignConvert(tb, t, e.b, 'assign');
        this.store(t); return T.unq(t);
      }
      const op = e.op.slice(0, -1);
      this.emit('dup'); this.load(t);
      const tb = T.decay(this.rv(e.b)); this.at(e);
      const rt = this.arith(op, T.unq(t), tb, e);
      this.convert(rt, t);
      this.store(t); return T.unq(t);
    },
    incdec(e) {
      const T = C.T;
      const t = this.lv(e.a);
      this.at(e);
      if (!T.isScalar(t)) throw this.err(e.op + ' needs a number or a pointer, not ' + T.name(t), e);
      if (t.c) throw this.err((e.a.e === 'id' ? e.a.name : 'this') + ' is const, so it cannot be changed with ' + e.op, e);
      this.emit('dup'); this.load(t);
      if (e.e === 'post') this.emit('tuck');
      const op = e.op === '++' ? '+' : '-';
      if (t.k === 'ptr') { if (t.to.k === 'void' || t.to.k === 'fn') throw this.err(e.op + ' on a ' + T.name(t) + ' is not allowed', e); this.emit('k', T.size(t.to)); this.emit('abin', op); }
      else { const pt = T.isFloat(t) ? t : T.promote(t); this.convert(t, pt); this.emit('k', 1); this.emit('bin', op, T.kind(pt)); this.convert(pt, t); }
      this.store(t);
      if (e.e === 'post') this.emit('pop');
      return T.unq(t);
    },
    ternary(e) {
      const T = C.T;
      this.test(e.c); const jz = this.emit('jz', 0);
      const ta = T.decay(this.rv(e.a));
      const tb0 = T.decay(this.typeOf(e.b));
      let t;
      if (T.isArith(ta) && T.isArith(tb0)) t = T.arith(ta, tb0);
      else if (ta.k === 'ptr' && tb0.k === 'ptr') t = ta.to.k === 'void' ? tb0 : ta;
      else if (ta.k === 'ptr') t = ta; else if (tb0.k === 'ptr') t = tb0;
      else if (T.isAgg(ta) && T.isAgg(tb0) && T.same(T.unq(ta), T.unq(tb0))) t = ta;
      else if (ta.k === 'void' && tb0.k === 'void') t = T.VOID;
      else throw this.err('the two sides of ?: have types that do not go together: ' + T.name(ta) + ' and ' + T.name(tb0), e);
      if (T.isScalar(t)) this.convert(ta, t);
      const j = this.emit('jmp', 0);
      this.patch(jz, this.here());
      const tb = T.decay(this.rv(e.b));
      if (T.isScalar(t)) this.convert(tb, t);
      this.patch(j, this.here());
      return t;
    },
    /** a function, library function or a pointer to one */
    callee(e) {
      if (e.f.e !== 'id') return null;
      const name = e.f.name, v = this.lookup(name);
      if (v && v.kind === 'fn') return { F: v.F };
      if (v) return null;
      const lib = this.libFn(name);
      if (lib) return { lib };
      if (this.ahead.has(name)) return { F: this.implicit(e.f) };
      const near = C.suggest(name, this.visibleNames().concat(Object.keys(C.BUILTINS)));
      throw this.err('there is no function named ' + name, e.f, near ? 'did you mean ' + near + '?' : 'declare or define it before calling it');
    },
    implicit(at) {
      const d = this.ahead.get(at.name).decl;
      this.warn('implicit', at.name + ' is used before it is declared', at, 'put its definition, or a prototype such as ' + C.T.name(d.type.ret) + ' ' + at.name + '(...);, above the first use');
      return this.fnDecl(Object.assign({}, d, { kind: 'proto' }));
    },
    call(e, used) {
      const T = C.T;
      const ce = this.callee(e);
      let ft, how;
      if (ce && ce.F) { ft = ce.F.type; how = 'call'; this.useFn(ce.F); }
      else if (ce && ce.lib) { ft = ce.lib.type; how = ce.lib.kind; }
      else {
        let t = T.decay(this.rv(e.f));
        if (t.k === 'ptr' && t.to.k === 'fn') ft = t.to;
        else throw this.err((e.f.e === 'id' ? e.f.name : 'this') + ' is a ' + T.name(t) + ', not a function', e, t.k === 'ptr' ? 'only a function or a function pointer can be called' : undefined);
        how = 'calli';
      }
      const name = e.f.e === 'id' ? e.f.name : 'the function';
      this.at(e);
      const ps = ft.params, n = e.args.length;
      if (ft.lo !== undefined) {
        if (n < ft.lo || (ft.hi >= 0 && n > ft.hi)) throw this.err(name + ' takes ' + (ft.lo === ft.hi ? ft.lo : 'at least ' + ft.lo) + ' argument' + (ft.lo === 1 ? '' : 's') + ', not ' + n, e);
      } else if (ft.proto !== false && (n < ps.length || (n > ps.length && !ft.variadic))) {
        throw this.err(name + ' takes ' + (ft.variadic ? 'at least ' : '') + ps.length + ' argument' + (ps.length === 1 ? '' : 's') + ', not ' + n, e, 'its declaration is ' + T.name(ft.ret) + ' ' + name + '(' + (ps.map((p) => T.name(p.type) + (p.name ? ' ' + p.name : '')).join(', ') || 'void') + (ft.variadic ? ', ...' : '') + ')');
      }
      let hidden = 0;
      if (T.isAgg(ft.ret)) { const off = this.frameSlot(ft.ret, null); this.emit('lea', off); hidden = 1; }
      const kinds = [];
      e.args.forEach((a, i) => {
        const t = this.rv(a);
        this.at(a);
        if (ps[i] && ft.proto !== false) { this.assignConvert(t, ps[i].type, a, 'pass as argument ' + (i + 1) + ' of ' + name + ',', how === 'sys' || how === 'lib'); kinds.push(T.isAgg(ps[i].type) ? 'a' : T.kind(ps[i].type)); return; }
        const d = T.decay(t);
        if (d.k === 'void') throw this.err('a void value cannot be passed to ' + name, a);
        const pt = d.k === 'float' ? T.DOUBLE : T.isInt(d) ? T.promote(d) : d;
        this.convert(d, pt); kinds.push(T.isAgg(pt) ? 'a' : T.kind(pt));
      });
      this.at(e);
      if (how in { lib: 1, sys: 1 } && e.f.name in C.FMTARG) this.formatCheck(e, kinds);
      if (how === 'lib' && e.f.name === 'strerror' && !this.errTexts) { this.errTexts = {}; for (const [k, v] of Object.entries(C.STRERROR)) this.errTexts[k] = this.intern(v); }
      if (how === 'call') this.emit('call', ce.F, n + hidden, used ? 1 : 0);
      else if (how === 'calli') this.emit('calli', n + hidden, used ? 1 : 0, kinds, ft);
      else this.emit(how, e.f.name, n, kinds);
      // the kernel answers with plain numbers: make the result the declared type (signal's -1 is SIG_ERR)
      if ((how === 'sys' || how === 'calli') && T.isScalar(ft.ret)) this.emit('cvt', T.kind(ft.ret));
      return T.unq(ft.ret);
    },
    /** printf-style calls with a literal format: its conversions against the arguments' types */
    formatCheck(e, kinds) {
      const at = C.FMTARG[e.f.name], f = e.args[at];
      if (!f || f.e !== 'str' || !C.formatSpecs) return;
      const probs = C.formatSpecs(f.v, kinds.slice(at + 1), e.f.name === 'sscanf');
      for (const p of probs) this.warn('format', e.f.name + ': ' + p.msg, e.args[at + 1 + (p.arg || 0)] || f, 'the conversions in the format must match the values passed after it');
    },
  };
})(globalThis.Proses = globalThis.Proses || {});
