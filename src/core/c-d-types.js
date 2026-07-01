// The C subset's types, laid out as on a 64-bit Linux (LP64): char 1, short 2, int 4, long and pointers 8, float 4,
// double 8, long double 16; a struct's members at offsets rounded up to their alignment, and its size rounded up to
// the largest alignment inside it; a union as big as its biggest member.
// A type is plain data:
//   {k: 'void'} | {k: 'bool'} | {k: 'char'|'short'|'int'|'long', u: unsigned?, ll: long long?, sc: 'signed char'?}
//   {k: 'float'} | {k: 'double', ld?} | {k: 'enum', tag} | {k: 'ptr', to} | {k: 'arr', of, n (null: unknown, -1: VLA)}
//   {k: 'fn', ret, params: [{name, type}], variadic, proto} | {k: 'struct' | 'union', tag, fields, size, align, complete}
//   and c: true on a const-qualified type.
//   S.CLang.T: INT UINT LONG ULONG CHAR UCHAR VOID DOUBLE FLOAT BOOL, ptr(t), arr(t, n), size(t), align(t), layout(t)
//     isInt isFloat isArith isPtr isScalar isAgg decay promote arith(a, b) kind(t) cv(t) name(t) same(a, b) field(t, name)
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const T = (C.T = {});
  T.INT = { k: 'int' }; T.UINT = { k: 'int', u: true }; T.LONG = { k: 'long' }; T.ULONG = { k: 'long', u: true };
  T.CHAR = { k: 'char' }; T.UCHAR = { k: 'char', u: true }; T.SHORT = { k: 'short' }; T.VOID = { k: 'void' };
  T.DOUBLE = { k: 'double' }; T.FLOAT = { k: 'float' }; T.BOOL = { k: 'bool' };
  T.ptr = (to) => ({ k: 'ptr', to });
  T.arr = (of, n) => ({ k: 'arr', of, n });
  const SIZE = { bool: 1, char: 1, short: 2, int: 4, long: 8, ptr: 8, float: 4, double: 8, enum: 4 };

  T.size = function (t) {
    switch (t.k) {
      case 'arr': return t.n === null || t.n < 0 ? 0 : t.n * T.size(t.of);
      case 'void': return 1;
      case 'fn': return 1;
      case 'struct': case 'union': return t.size || 0;
      case 'double': return t.ld ? 16 : 8;
    }
    return SIZE[t.k];
  };
  T.align = function (t) {
    if (t.k === 'arr') return T.align(t.of);
    if (t.k === 'struct' || t.k === 'union') return t.align || 1;
    if (t.k === 'double' && t.ld) return 16;
    return Math.min(16, T.size(t) || 1);
  };
  /** lay out a struct or union's fields (each {name, type}); anonymous members keep name null */
  T.layout = function (t) {
    let off = 0, size = 0, align = 1;
    for (const f of t.fields) {
      const a = T.align(f.type), s = T.size(f.type);
      align = Math.max(align, a);
      if (t.k === 'union') { f.off = 0; size = Math.max(size, s); continue; }
      off = Math.ceil(off / a) * a; f.off = off; off += s; size = off;
    }
    t.align = align; t.size = Math.ceil(size / align) * align; t.complete = true;
    return t;
  };
  /** a member by name, looking into anonymous members: {type, off} or null */
  T.field = function (t, name) {
    for (const f of t.fields || []) {
      if (f.name === name) return { type: f.type, off: f.off };
      if (f.name === null && (f.type.k === 'struct' || f.type.k === 'union')) { const g = T.field(f.type, name); if (g) return { type: g.type, off: f.off + g.off }; }
    }
    return null;
  };
  T.isInt = (t) => t.k === 'char' || t.k === 'short' || t.k === 'int' || t.k === 'long' || t.k === 'bool' || t.k === 'enum';
  T.isFloat = (t) => t.k === 'float' || t.k === 'double';
  T.isArith = (t) => T.isInt(t) || T.isFloat(t);
  T.isPtr = (t) => t.k === 'ptr';
  T.isScalar = (t) => T.isArith(t) || t.k === 'ptr';
  T.isAgg = (t) => t.k === 'struct' || t.k === 'union';
  T.isFnPtr = (t) => t.k === 'ptr' && t.to.k === 'fn';
  /** an array used as a value is a pointer to its first element; a function, a pointer to it */
  T.decay = (t) => (t.k === 'arr' ? { k: 'ptr', to: t.of } : t.k === 'fn' ? { k: 'ptr', to: t } : t);
  /** integer promotion: what char, short, bool and enum become in arithmetic */
  T.promote = (t) => (t.k === 'char' || t.k === 'short' || t.k === 'bool' ? T.INT : t.k === 'enum' ? T.INT : t);
  /** the usual arithmetic conversions: the type both operands become */
  T.arith = function (a, b) {
    if (a.k === 'double' || b.k === 'double') return T.DOUBLE;
    if (a.k === 'float' || b.k === 'float') return T.FLOAT;
    a = T.promote(a); b = T.promote(b);
    if (a.k === 'long' || b.k === 'long') return (a.k === 'long' && a.u) || (b.k === 'long' && b.u) ? T.ULONG : T.LONG;
    return a.u || b.u ? T.UINT : T.INT;
  };
  /** how the machine holds a value of this type: c uc s us i u l ul p f d b */
  T.kind = function (t) {
    t = T.decay(t);
    switch (t.k) {
      case 'ptr': return 'p';
      case 'long': return t.u ? 'ul' : 'l';
      case 'int': return t.u ? 'u' : 'i';
      case 'enum': return 'i';
      case 'char': return t.u ? 'uc' : 'c';
      case 'short': return t.u ? 'us' : 's';
      case 'bool': return 'b';
      case 'float': return 'f';
      case 'double': return 'd';
    }
    return 'i';
  };
  /** the kind arithmetic is done in (after promotion): i u l ul f d p */
  T.opKind = (t) => { const k = T.kind(T.promote(t)); return k; };
  T.unq = (t) => (t.c ? Object.assign({}, t, { c: false }) : t);
  T.qual = (t, c) => (c && !t.c ? Object.assign({}, t, { c: true }) : t);

  T.name = function (t) {
    if (!t) return '?';
    const q = t.c ? 'const ' : '';
    switch (t.k) {
      case 'ptr':
        if (t.to.k === 'fn') return T.name(t.to.ret) + ' (*)(' + paramNames(t.to) + ')';
        if (t.to.k === 'arr') return T.name(t.to.of) + ' (*)[' + (t.to.n === null ? '' : t.to.n) + ']';
        return T.name(t.to) + ' *' + (t.c ? 'const' : '');
      case 'arr': { let dims = '', x = t; while (x.k === 'arr') { dims += '[' + (x.n === null || x.n < 0 ? '' : x.n) + ']'; x = x.of; } return T.name(x) + ' ' + dims; }
      case 'fn': return T.name(t.ret) + ' (' + paramNames(t) + ')';
      case 'struct': case 'union': return q + t.k + ' ' + (t.tag && !t.tag.startsWith('__anon') ? t.tag : '{...}');
      case 'enum': return q + 'enum ' + (t.tag || '{...}');
      case 'bool': return q + '_Bool';
      case 'double': return q + (t.ld ? 'long double' : 'double');
      case 'char': return q + (t.sc ? 'signed char' : t.u ? 'unsigned char' : 'char');
      case 'long': return q + (t.u ? 'unsigned ' : '') + (t.ll ? 'long long' : 'long');
      case 'int': case 'short': return q + (t.u ? 'unsigned ' : '') + t.k;
      default: return q + t.k;
    }
  };
  const paramNames = (f) => (f.params.length ? f.params.map((p) => T.name(p.type)).join(', ') + (f.variadic ? ', ...' : '') : f.proto === false ? '' : 'void');
  /** the same type (ignoring top-level qualifiers and the names of parameters) */
  T.same = function (a, b) {
    if (a === b) return true;
    if (a.k !== b.k) return false;
    switch (a.k) {
      case 'ptr': return T.same(a.to, b.to);
      case 'arr': return (a.n === b.n || a.n === null || b.n === null) && T.same(a.of, b.of);
      case 'struct': case 'union': return a === b || (a.tag === b.tag && a.size === b.size && a.fields === b.fields);
      case 'enum': return true;
      case 'fn': return T.same(a.ret, b.ret) && (a.proto === false || b.proto === false || (a.params.length === b.params.length && a.params.every((p, i) => T.same(T.unq(p.type), T.unq(b.params[i].type)))));
      default: return !!a.u === !!b.u && !!a.ld === !!b.ld;
    }
  };
  /** may a pointer to `from` be used where a pointer to `to` is wanted without a cast? */
  T.ptrCompatible = (to, from) => to.k === 'void' || from.k === 'void' || T.same(T.unq(to), T.unq(from)) || (T.isInt(to) && T.isInt(from) && T.size(to) === T.size(from) && to.k === from.k);
})(globalThis.Proses = globalThis.Proses || {});
