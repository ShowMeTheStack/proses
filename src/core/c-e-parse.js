// The C subset, stage three: the parser (declarations and statements; expressions are in c-f-pexpr.js). Tokens
// become a syntax tree, and types are built while the declarations are read: typedef names, struct, union and
// enum tags and enum constants live in block scopes, so a name can be told apart as a type or a variable.
//   S.CLang.parse(tokens, {base}) -> {decls, scope, warnings}
//     decls: {kind: 'var', name, type, init, storage, line, col} | {kind: 'func', name, type, body, storage, line, col}
//            | {kind: 'proto', name, type, storage, line, col}
//     base: an outer scope to start from (the headers' declarations, parsed once)
// Statements {s, line, col, ...}: block (body), decl (vars), expr (e), if (c, a, b), while (c, body), do (body, c),
//   for (init, c, step, body), switch (c, body), case (v, line), default, label (name, body), goto (name),
//   ret (e), break, continue, empty.
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const STORAGE = new Set(['typedef', 'extern', 'static', 'auto', 'register']);
  const QUAL = new Set(['const', 'volatile', 'restrict', '__restrict', 'inline', '__inline', '_Noreturn', '__extension__']);
  const BASEW = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool']);
  let anon = 0;

  class Parser {
    constructor(toks, base) {
      if (!Parser.mixed) { Object.assign(Parser.prototype, C.ParserExpr); Parser.mixed = true; }
      this.toks = toks; this.p = 0; this.warnings = [];
      this.scopes = [base || { names: new Map(), tags: new Map() }, { names: new Map(), tags: new Map() }];
    }
    peek(k) { return this.toks[Math.min(this.p + (k || 0), this.toks.length - 1)]; }
    next() { return this.toks[this.p++]; }
    is(v, k) { const t = this.peek(k); return (t.t === 'op' || t.t === 'kw') && t.v === v; }
    prev() { return this.toks[this.p - 1]; }
    /** an error at a token (the current one by default), naming what was found */
    err(msg, t, hint) {
      t = t || this.peek();
      const found = t.t === 'eof' ? ' at the end of the program' : ', not ' + (t.t === 'str' ? 'a string' : "'" + t.s + "'");
      return new C.CError(t.line, msg + found, t.col, hint ? { hint } : undefined);
    }
    /** an error just after the previous token (where a missing ';' or ')' belongs) */
    errAfter(msg, hint) {
      const pt = this.prev();
      if (!pt) return this.err(msg, undefined, hint);
      const e = C.tokEnd(pt);
      return new C.CError(e.line, msg, e.col, hint ? { hint } : undefined);
    }
    want(v, what, hint) {
      if (this.is(v)) return this.next();
      if (v === ';' || v === ')' || v === ']') throw this.errAfter('expected ' + (what || "'" + v + "'") + ' here', hint || (v === ';' ? "every declaration and statement ends with ';'" : undefined));
      throw this.err('expected ' + (what || "'" + v + "'"), undefined, hint);
    }
    // ---- scopes -----------------------------------------------------------------------------------------
    push() { this.scopes.push({ names: new Map(), tags: new Map() }); }
    pop() { this.scopes.pop(); }
    find(name) { for (let i = this.scopes.length - 1; i >= 0; i--) { const v = this.scopes[i].names.get(name); if (v) return v; } return null; }
    findTag(tag) { for (let i = this.scopes.length - 1; i >= 0; i--) { const v = this.scopes[i].tags.get(tag); if (v) return v; } return null; }
    declare(name, entry) { this.scopes[this.scopes.length - 1].names.set(name, entry); }
    isTypedef(t) { if (t.t !== 'id') return false; const e = this.find(t.v); return !!e && e.kind === 'typedef'; }
    /** does a declaration start at token k? */
    startsDecl(k) {
      const t = this.peek(k);
      if (t.t === 'kw') return STORAGE.has(t.v) || QUAL.has(t.v) || BASEW.has(t.v) || t.v === 'struct' || t.v === 'union' || t.v === 'enum' || t.v === '__attribute__' || t.v === '_Static_assert';
      return this.isTypedef(t);
    }
    /** does a type name start at token k (for casts and sizeof)? */
    startsType(k) { const t = this.peek(k); return t.t === 'kw' ? (QUAL.has(t.v) || BASEW.has(t.v) || t.v === 'struct' || t.v === 'union' || t.v === 'enum') : this.isTypedef(t); }
    skipAttr() { while (this.is('__attribute__')) { this.next(); this.want('('); let d = 1; while (d > 0 && this.peek().t !== 'eof') { const t = this.next(); if (t.v === '(') d++; else if (t.v === ')') d--; } } }

    // ---- declaration specifiers ---------------------------------------------------------------------------
    specifiers(allowStorage) {
      const start = this.peek();
      let storage = null, c = false, longs = 0, sign = null, word = null, type = null, defTok = null;
      for (;;) {
        const t = this.peek();
        if (t.t === 'kw' && t.v === '__attribute__') { this.skipAttr(); continue; }
        if (t.t === 'kw' && STORAGE.has(t.v)) {
          if (!allowStorage) throw this.err('a storage class (' + t.v + ') is not allowed here', t);
          if (storage) throw this.err('two storage classes in one declaration', t);
          storage = t.v; this.next(); continue;
        }
        if (t.t === 'kw' && QUAL.has(t.v)) { if (t.v === 'const') c = true; this.next(); continue; }
        if (t.t === 'kw' && (t.v === 'signed' || t.v === 'unsigned')) { if (sign) throw this.err('signed and unsigned twice', t); sign = t.v; this.next(); continue; }
        if (t.t === 'kw' && t.v === 'long') { if (++longs > 2) throw this.err('too many longs', t); this.next(); continue; }
        if (t.t === 'kw' && (BASEW.has(t.v) || t.v === 'struct' || t.v === 'union' || t.v === 'enum') && type && defTok && this.lastClose === this.prev()) {
          throw this.errAfter("expected ';' after the closing brace of the " + defTok.v + ' definition', defTok.v + "s are supported; did you forget a ';' after the closing brace?");
        }
        if (t.t === 'kw' && BASEW.has(t.v)) {
          if (word || type) throw this.err('two types in one declaration: ' + (word || C.T.name(type)) + ' and ' + t.v, t, 'did you forget a \';\' at the end of the line before?');
          word = t.v; this.next(); continue;
        }
        if (t.t === 'kw' && (t.v === 'struct' || t.v === 'union' || t.v === 'enum')) {
          if (word || type) throw this.err('two types in one declaration', t, 'did you forget a \';\' after a closing brace?');
          defTok = t; type = t.v === 'enum' ? this.enumSpec() : this.structSpec(); continue;
        }
        if (t.t === 'id' && !word && !type && !sign && !longs && this.isTypedef(t)) { type = this.find(t.v).type; this.next(); continue; }
        break;
      }
      if (!storage && !c && !longs && !sign && !word && !type) return null;
      if (!type) {
        if (word === 'void') type = { k: 'void' };
        else if (word === '_Bool') type = { k: 'bool' };
        else if (word === 'float') type = { k: 'float' };
        else if (word === 'double') type = longs ? { k: 'double', ld: true } : { k: 'double' };
        else if (word === 'char') type = sign === 'unsigned' ? { k: 'char', u: true } : sign === 'signed' ? { k: 'char', sc: true } : { k: 'char' };
        else if (word === 'short') type = sign === 'unsigned' ? { k: 'short', u: true } : { k: 'short' };
        else if (longs) type = Object.assign({ k: 'long' }, sign === 'unsigned' ? { u: true } : {}, longs === 2 ? { ll: true } : {});
        else if (word === 'int' || sign) type = sign === 'unsigned' ? { k: 'int', u: true } : { k: 'int' };
        else throw this.err('a declaration needs a type', this.peek(), 'write the type first, as in int x; or unsigned long n;');
        if ((longs && word && word !== 'int' && word !== 'double') || (sign && word && !/^(char|short|int)$/.test(word))) throw this.err('the type words do not go together', start);
      } else if (longs || sign) throw this.err('the type words do not go together', start);
      return { type: C.T.qual(type, c), storage, line: start.line, col: start.col, defTok };
    }
    structSpec() {
      const kw = this.next(), kind = kw.v;
      this.skipAttr();
      let tag = null;
      if (this.peek().t === 'id') tag = this.next().v;
      if (!this.is('{')) {
        if (!tag) throw this.err('expected a tag name or { after ' + kind);
        const here = this.scopes[this.scopes.length - 1].tags;
        if (this.is(';') && !here.has(tag)) { const t = { k: kind, tag, fields: [], complete: false }; here.set(tag, t); return t; }
        let t = this.findTag(tag);
        if (t && t.k !== kind) throw this.err(tag + ' is a ' + t.k + ', not a ' + kind, kw);
        if (!t) { t = { k: kind, tag, fields: [], complete: false }; this.scopes[this.scopes.length - 1].tags.set(tag, t); }
        return t;
      }
      const here = this.scopes[this.scopes.length - 1].tags;
      let t = tag ? here.get(tag) : null;
      if (t && t.complete) throw this.err(kind + ' ' + tag + ' is defined twice', kw);
      if (!t) { t = { k: kind, tag: tag || '__anon' + (++anon), fields: [], complete: false }; if (tag) here.set(tag, t); }
      if (t.k !== kind) throw this.err(tag + ' is a ' + t.k + ', not a ' + kind, kw);
      this.next();
      const fields = [];
      while (!this.is('}')) {
        if (this.peek().t === 'eof') throw this.err("expected '}' to close " + kind + ' ' + (tag || ''));
        if (this.is('_Static_assert')) { this.staticAssert(); continue; }
        const sp = this.specifiers(false);
        if (!sp) throw this.err('expected a member declaration in ' + kind + ' ' + (tag || ''), undefined, 'a member is declared like a variable: int count;');
        if (this.is(';') && (sp.type.k === 'struct' || sp.type.k === 'union')) { this.next(); fields.push({ name: null, type: sp.type }); continue; }
        for (;;) {
          const d = this.declarator(sp.type, 'named');
          if (this.is(':')) throw this.err('bit-fields are not in the subset', this.peek(), 'use a whole int (or unsigned char) and the & | ~ operators instead');
          if (d.type.k === 'fn') throw this.err('a ' + kind + ' cannot hold a function; use a function pointer: ' + C.T.name(d.type.ret) + ' (*' + d.name + ')(...)', d.tok);
          if (d.type.k === 'arr' && d.type.n !== null && d.type.n < 0) throw this.err('a member array needs a constant length', d.tok);
          if (fields.some((f) => f.name === d.name)) throw this.err('the member ' + d.name + ' is declared twice', d.tok);
          if ((d.type.k === 'struct' || d.type.k === 'union') && !d.type.complete) throw this.err(C.T.name(d.type) + ' is not complete here, so ' + d.name + ' cannot hold one', d.tok, 'a struct can hold a pointer to its own kind: struct node *next;');
          fields.push({ name: d.name, type: d.type, line: d.tok.line });
          if (this.is(',')) { this.next(); continue; }
          if (!this.is(';')) throw this.errAfter("expected ';' after the member " + d.name, "each member declaration ends with ';', even the last one");
          this.next(); break;
        }
      }
      this.next();
      this.skipAttr();
      t.fields = fields;
      C.T.layout(t);
      this.lastClose = this.prev();
      return t;
    }
    enumSpec() {
      const kw = this.next();
      let tag = null;
      if (this.peek().t === 'id') tag = this.next().v;
      const t = { k: 'enum', tag };
      if (tag && !this.is('{')) { const e = this.findTag(tag); return e || t; }
      if (tag) this.scopes[this.scopes.length - 1].tags.set(tag, t);
      this.want('{', '{ after enum');
      let v = 0;
      while (!this.is('}')) {
        const nt = this.next();
        if (nt.t !== 'id') throw this.err('expected the name of an enum constant', nt);
        if (this.is('=')) { this.next(); const e = this.cond(); const x = this.constValue(e); if (x === null) throw this.err('an enum value must be a constant', nt); v = Number(x); }
        this.declare(nt.v, { kind: 'enum', v, type: { k: 'int' }, line: nt.line });
        v++;
        if (!this.is('}')) this.want(',', "',' or '}'");
      }
      this.next();
      this.lastClose = this.prev();
      void kw;
      return t;
    }
    staticAssert() {
      const kw = this.next(); this.want('(');
      const e = this.cond(); let msg = '';
      if (this.is(',')) { this.next(); msg = this.next().v; }
      this.want(')'); this.want(';');
      const v = this.constValue(e);
      if (v === null) throw this.err('_Static_assert needs a constant', kw);
      if (!v) throw new C.CError(kw.line, 'static assertion failed' + (msg ? ': ' + msg : ''), kw.col);
    }

    // ---- declarators -----------------------------------------------------------------------------------------
    /** a declarator on top of base: mode 'named', 'abstract' (a type name) or 'either' (a parameter) */
    declarator(base, mode) {
      let t = base;
      while (this.is('*')) {
        this.next(); let c = false;
        while (this.peek().t === 'kw' && (QUAL.has(this.peek().v) || this.peek().v === '__attribute__')) { if (this.peek().v === '__attribute__') { this.skipAttr(); continue; } if (this.next().v === 'const') c = true; }
        t = C.T.qual(C.T.ptr(t), c);
      }
      let name = null, tok = this.peek(), inner = -1;
      if (this.peek().t === 'id' && mode !== 'abstract' && !(mode === 'either' && this.isTypedef(this.peek()))) { tok = this.next(); name = tok.v; }
      else if (this.is('(') && this.nestedStart()) {
        inner = this.p + 1;
        let d = 0;
        do { const x = this.next(); if (x.v === '(' && x.t === 'op') d++; else if (x.v === ')' && x.t === 'op') d--; if (x.t === 'eof') throw this.err("expected ')'"); } while (d > 0);
      } else if (mode === 'named') {
        const h = this.peek().t === 'kw' ? ' (' + this.peek().v + ' is a keyword)' : '';
        throw this.err('expected a name' + h, undefined, this.peek().t === 'num' ? 'a name starts with a letter or _' : undefined);
      }
      this.skipAttr();
      t = this.suffixes(t, name);
      if (inner >= 0) {
        const save = this.p; this.p = inner;
        const d = this.declarator(t, mode);
        if (!this.is(')')) throw this.err("expected ')'");
        this.p = save;
        return d;
      }
      return { name, type: t, tok, params: t.k === 'fn' ? t.params : null };
    }
    nestedStart() {
      const t = this.peek(1);
      if (t.t === 'op') return t.v === '*' || t.v === '(' || t.v === '[' || t.v === '^';
      if (t.t === 'id') return !this.isTypedef(t);
      return false;
    }
    suffixes(t, name) {
      const sfx = [];
      for (;;) {
        if (this.is('[')) {
          const open = this.next();
          while (this.is('static') || this.is('const') || this.is('restrict') || this.is('volatile')) this.next();
          if (this.is(']')) { this.next(); sfx.push({ arr: null }); continue; }
          if (this.is('*') && this.is(']', 1)) { this.next(); this.next(); sfx.push({ arr: null }); continue; }
          const e = this.assign();
          this.want(']');
          const v = this.constValue(e);
          if (v !== null && v < 0) throw this.err('an array cannot have a negative length', open);
          if (v !== null && Number(v) === 0 && false) sfx.push({ arr: 0 });
          sfx.push(v === null ? { arr: -1, vla: e } : { arr: Number(v) });
          continue;
        }
        if (this.is('(')) { sfx.push({ fn: this.params(name) }); continue; }
        break;
      }
      for (let i = sfx.length - 1; i >= 0; i--) {
        const s = sfx[i];
        if (s.fn) {
          if (t.k === 'arr') throw this.err('a function cannot return an array; return a pointer instead');
          if (t.k === 'fn') throw this.err('a function cannot return a function; return a function pointer instead');
          t = Object.assign({ k: 'fn', ret: t }, s.fn);
        } else {
          if (t.k === 'fn') throw this.err('an array of functions is not allowed; use an array of function pointers: (*name[n])(...)');
          if (t.k === 'void') throw this.err('an array of void is not allowed');
          t = s.vla ? { k: 'arr', of: t, n: -1, vla: s.vla } : { k: 'arr', of: t, n: s.arr };
        }
      }
      return t;
    }
    params() {
      this.want('(');
      const params = []; let variadic = false;
      if (this.is(')')) { this.next(); return { params, variadic, proto: false }; }
      if (this.is('void') && this.is(')', 1)) { this.next(); this.next(); return { params, variadic, proto: true }; }
      for (;;) {
        if (this.is('...')) { this.next(); variadic = true; break; }
        const sp = this.specifiers(true);
        if (!sp) {
          const t = this.peek();
          if (t.t === 'id' && (this.is(',', 1) || this.is(')', 1))) throw this.err('the parameter ' + t.v + ' needs a type', t, 'write its type first, as in int ' + t.v);
          throw this.err('expected a parameter type', t, this.unknownTypeHint(t));
        }
        const d = this.declarator(sp.type, 'either');
        let pt = d.type;
        if (pt.k === 'arr') pt = C.T.qual(C.T.ptr(pt.of), false);
        else if (pt.k === 'fn') pt = C.T.ptr(pt);
        if (pt.k === 'void') { if (d.name || params.length) throw this.err('a parameter cannot have type void', d.tok); break; }
        params.push({ name: d.name, type: pt, line: d.tok.line, col: d.tok.col });
        if (this.is(',')) { this.next(); continue; }
        break;
      }
      this.want(')', "',' or ')' in the parameter list");
      return { params, variadic, proto: true };
    }
    typeName() {
      const sp = this.specifiers(false);
      if (!sp) throw this.err('expected a type name');
      return this.declarator(sp.type, 'abstract').type;
    }
    unknownTypeHint(t) {
      if (!t || t.t !== 'id') return undefined;
      const h = C.headerOf ? C.headerOf(t.v) : [];
      if (h.length) return t.v + ' comes from <' + h[0] + '>: add #include <' + h[0] + '>';
      const names = []; for (const s of this.scopes) for (const [k, v] of s.names) if (v.kind === 'typedef') names.push(k);
      const near = C.suggest(t.v, names.concat(['int', 'char', 'long', 'short', 'double', 'float', 'unsigned', 'void']));
      return near ? 'did you mean ' + near + '?' : 'is ' + t.v + ' a type? declare it with typedef or struct first';
    }

    // ---- the program -----------------------------------------------------------------------------------------
    program() {
      const decls = [];
      while (this.peek().t !== 'eof') {
        if (this.is(';')) { this.next(); continue; }
        if (this.is('_Static_assert')) { this.staticAssert(); continue; }
        this.declaration(decls, true);
      }
      return decls;
    }
    /** one declaration (top level or in a block); pushes onto out; returns the vars for a block */
    declaration(out, top) {
      const first = this.peek();
      const sp = this.specifiers(true);
      if (!sp) {
        if (top && first.t === 'id' && this.is('(', 1)) throw this.err('a function needs a return type', first, 'write int ' + first.v + '(...) or void ' + first.v + '(...)');
        if (first.t === 'id' && this.peek(1).t === 'id') throw new C.CError(first.line, 'unknown type name ' + first.v, first.col, { hint: this.unknownTypeHint(first) });
        throw this.err(top ? 'expected a declaration or a function' : 'expected a declaration');
      }
      if (this.is(';')) { this.next(); return []; }
      if (sp.defTok && this.lastClose && this.prev() === this.lastClose && !this.is('*') && !this.is('(') && this.peek().t !== 'id') {
        throw this.errAfter("expected ';' after the closing brace of the " + sp.defTok.v + ' definition', sp.defTok.v + "s are supported; did you forget a ';' after the closing brace?");
      }
      if (sp.defTok && this.lastClose && this.prev() === this.lastClose && this.isTypedef(this.peek()) && (this.peek(1).t === 'id' || this.is('*', 1))) {
        throw this.errAfter("expected ';' after the closing brace of the " + sp.defTok.v + ' definition', sp.defTok.v + "s are supported; did you forget a ';' after the closing brace?");
      }
      const vars = [];
      for (;;) {
        const d = this.declarator(sp.type, 'named');
        this.skipAttr();
        const at = { line: d.tok.line, col: d.tok.col };
        if (sp.storage === 'typedef') {
          const old = this.scopes[this.scopes.length - 1].names.get(d.name);
          if (old && old.kind !== 'typedef') throw this.err(d.name + ' is already declared as a ' + (old.kind === 'var' ? 'variable' : 'name'), d.tok);
          this.declare(d.name, { kind: 'typedef', type: d.type, line: d.tok.line });
        } else if (d.type.k === 'fn') {
          this.declare(d.name, { kind: 'fn', type: d.type, line: d.tok.line });
          if (this.is('{')) {
            if (!top) throw this.err('a function cannot be defined inside another function', d.tok);
            if (vars.length) throw this.err('a function body must follow its own declaration', d.tok);
            this.push();
            for (const p of d.type.params) { if (!p.name) throw new C.CError(p.line, 'every parameter of ' + d.name + ' needs a name in its definition', p.col); this.declare(p.name, { kind: 'var', type: p.type }); }
            this.fnName = d.name;
            const body = this.block(true);
            this.pop();
            out.push({ kind: 'func', name: d.name, type: d.type, body, storage: sp.storage, line: at.line, col: at.col, end: { line: this.prev().line, col: this.prev().col } });
            return vars;
          }
          out.push({ kind: 'proto', name: d.name, type: d.type, storage: sp.storage, line: at.line, col: at.col });
        } else {
          if (d.type.k === 'void') throw new C.CError(at.line, 'a variable cannot have type void', at.col, { hint: 'did you mean void * (a pointer to anything)?' });
          this.declare(d.name, { kind: 'var', type: d.type });
          let init = null;
          if (this.is('=')) { this.next(); init = this.initializer(); }
          const v = { kind: 'var', name: d.name, type: d.type, init, storage: sp.storage, line: at.line, col: at.col };
          if (init && d.type.k === 'arr' && d.type.n === null) v.type = this.fixLength(d.type, init);
          const ent = this.find(d.name); if (ent) ent.type = v.type;
          out.push(v); vars.push(v);
        }
        if (this.is(',')) { this.next(); continue; }
        if (this.is('{') && d.type.k !== 'fn') throw this.err("a variable's initial value follows an =");
        this.want(';', "';' after the declaration of " + d.name);
        return vars;
      }
    }
    /** int a[] = {...} or char s[] = "...": the length from the initializer */
    fixLength(t, init) {
      if (init.e === 'str') return { k: 'arr', of: t.of, n: init.v.length + 1 };
      if (init.e === 'list') {
        let n = 0, i = 0;
        for (const it of init.items) { if (it.desig && it.desig[0].index !== undefined) i = it.desig[0].index; i++; n = Math.max(n, i); }
        if (init.items.length === 1 && init.items[0].init.e === 'str' && t.of.k === 'char') return { k: 'arr', of: t.of, n: init.items[0].init.v.length + 1 };
        return { k: 'arr', of: t.of, n };
      }
      return t;
    }
    initializer() {
      if (!this.is('{')) return this.assign();
      const open = this.next(), items = [];
      while (!this.is('}')) {
        let desig = null;
        while (this.is('.') || this.is('[')) {
          desig = desig || [];
          if (this.next().v === '.') { const n = this.next(); if (n.t !== 'id') throw this.err('expected a member name after .', n); desig.push({ field: n.v, tok: n }); }
          else { const e = this.cond(); const v = this.constValue(e); if (v === null) throw this.err('a designator [i] needs a constant index'); this.want(']'); desig.push({ index: Number(v) }); }
        }
        if (desig) this.want('=', "'=' after the designator");
        items.push({ desig, init: this.initializer() });
        if (!this.is('}')) this.want(',', "',' or '}' in the initializer list");
      }
      this.next();
      return { e: 'list', items, line: open.line, col: open.col };
    }

    // ---- statements ------------------------------------------------------------------------------------------
    block(fnBody) {
      const open = this.want('{'), body = [];
      if (!fnBody) this.push();
      while (!this.is('}')) {
        if (this.peek().t === 'eof') throw new C.CError(open.line, "this { is never closed with a matching '}'", open.col, { hint: 'count the braces: every { needs its }' });
        body.push(this.stmt());
      }
      const close = this.next();
      if (!fnBody) this.pop();
      return { s: 'block', body, line: open.line, col: open.col, end: { line: close.line, col: close.col } };
    }
    stmt() {
      const t = this.peek(), line = t.line, col = t.col;
      if (this.is('{')) return this.block();
      if (this.is('_Static_assert')) { this.staticAssert(); return { s: 'empty', line, col }; }
      if (this.startsDecl()) { const vars = this.declaration([], false); return { s: 'decl', vars, line, col }; }
      if (this.is(';')) { this.next(); return { s: 'empty', line, col }; }
      if (t.t === 'id' && this.is(':', 1)) { this.next(); this.next(); return { s: 'label', name: t.v, body: this.is('}') ? { s: 'empty', line, col } : this.stmt(), line, col }; }
      if (t.t === 'id' && this.peek(1).t === 'id' && !this.find(t.v)) throw new C.CError(line, 'unknown type name ' + t.v, col, { hint: this.unknownTypeHint(t) });
      if (t.t === 'kw') {
        const paren = (what) => { this.want('(', "'(' after " + what); const c = this.expr(); this.want(')', "')' to close the condition of " + what); this.condWarn(c); return c; };
        switch (t.v) {
          case 'if': { this.next(); const c = paren('if'); const a = this.stmt(); let b = null; if (this.is('else')) { this.next(); b = this.stmt(); } return { s: 'if', c, a, b, line, col }; }
          case 'while': { this.next(); const c = paren('while'); return { s: 'while', c, body: this.stmt(), line, col }; }
          case 'do': {
            this.next(); const body = this.stmt();
            if (!this.is('while')) throw this.err("expected 'while' after the body of do");
            const wt = this.next(); const c = paren('do ... while'); this.want(';', "';' after do ... while (...)");
            return { s: 'do', body, c, line, col, cline: wt.line, ccol: wt.col };
          }
          case 'for': {
            this.next(); this.want('(', "'(' after for"); this.push();
            let init = null;
            if (this.startsDecl()) init = { s: 'decl', vars: this.declaration([], false), line: this.peek().line, col: this.peek().col };
            else if (this.is(';')) this.next();
            else { const it = this.peek(); init = { s: 'expr', e: this.expr(), line: it.line, col: it.col }; this.want(';', "';' after the first part of for (...)"); }
            const ct = this.peek();
            const c = this.is(';') ? null : this.expr(); this.want(';', "';' after the condition of for (...)");
            const st = this.peek();
            const step = this.is(')') ? null : this.expr(); this.want(')', "')' to close for (...)");
            const body = this.stmt(); this.pop();
            return { s: 'for', init, c, step, body, line, col, cpos: { line: ct.line, col: ct.col }, spos: { line: st.line, col: st.col } };
          }
          case 'switch': { this.next(); const c = paren('switch'); return { s: 'switch', c, body: this.stmt(), line, col }; }
          case 'case': {
            this.next(); const e = this.cond(); const v = this.constValue(e);
            if (v === null) throw new C.CError(line, 'a case label must be a constant', col, { hint: 'use a number, a character, an enum constant or a #define' });
            this.want(':', "':' after the case value");
            return { s: 'case', v, line, col };
          }
          case 'default': this.next(); this.want(':', "':' after default"); return { s: 'default', line, col };
          case 'return': { this.next(); const e = this.is(';') ? null : this.expr(); this.want(';', "';' after return"); return { s: 'ret', e, line, col }; }
          case 'break': this.next(); this.want(';'); return { s: 'break', line, col };
          case 'continue': this.next(); this.want(';'); return { s: 'continue', line, col };
          case 'goto': { this.next(); const n = this.next(); if (n.t !== 'id') throw this.err('expected a label after goto', n); this.want(';'); return { s: 'goto', name: n.v, line, col }; }
          case 'else': throw this.err("an 'else' without its 'if'", t, "an else follows the statement of an if; check for a stray ';' after the if's condition or a missing {");
        }
      }
      const e = this.expr();
      this.want(';', "';' after the statement");
      return { s: 'expr', e, line, col };
    }
    /** a = b used as a condition is legal but nearly always meant to be a == b */
    condWarn(c) {
      if (c && c.e === 'asg' && c.op === '=' && !c.paren) this.warnings.push({ line: c.line, col: c.col, kind: 'assign-cond', msg: 'an assignment is used as a condition', hint: 'did you mean == ? (if the assignment is meant, put it in an extra pair of brackets)' });
    }
  }
  C.Parser = Parser;

  C.parse = function (toks, opts) {
    const P = new Parser(toks, opts && opts.base);
    const decls = P.program();
    return { decls, scope: P.scopes[1], warnings: P.warnings };
  };
})(globalThis.Proses = globalThis.Proses || {});
