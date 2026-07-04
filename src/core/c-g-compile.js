// The C subset, stage four: the compiler (the program, its globals, functions and statements; expressions are in
// c-i-cexpr.js). It checks the types and turns the syntax tree into code for the stack machine (c-j-vm.js).
// Every statement starts with a ['stmt', line, col] mark: the kernel steps a process one statement at a time, and
// the mark it stops at is the line the process is about to run.
//   S.CLang.compile(src, {heap, stack, file}) -> prog     throws CError (with line, col and a hint)
//   prog: {code, lines, cols, funcs: Map name -> fn, fnList, globals: Map name -> {addr, type, line}, data,
//          dataBase, dataEnd, heapBase, heapEnd, stackSize, memSize, srcLines, warnings, errnoAt, libc}
//   fn:   {name, type, entry, frame, slots (parameters: {name, off, type}), locals (for the views: {name, type,
//          off, from, to}), index, addr, line, col}
// Memory: [0, 3840) is never mapped, so NULL faults; the C library's own words in [3840, 4096); the program's
// globals and string literals from 4096; the heap after it; the stack at the top, growing down. Objects have red zones between them, so a step
// past the end of one is caught.
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const DATA = 3840, RZ = 16, LRZ = 8;
  // the C library's own state, at the start of the data segment
  const LIBC = (C.LIBC = { heap: 3840, strtok: 3848, errno: 3856, randF: 3860, randR: 3864, randT: 3868, errbuf: 3992, end: 4096 });
  // name: [return type, fewest arguments, most (-1: any number), kind]: calls known without a prototype; the
  // kernel may add its own (kind 'sys'). Prototyped calls come from the headers (c-h-consts.js).
  C.BUILTINS = C.BUILTINS || {};

  let prelude = null;
  /** the headers' declarations, parsed once: {scope, protos: Map name -> {type, kind, index}, list} */
  C.prelude = function () {
    if (prelude) return prelude;
    const order = ['stddef.h', 'stdint.h', 'sys/types.h', 'stdbool.h', 'stdarg.h'];
    const names = order.concat(Object.keys(C.HEADERS).filter((h) => !order.includes(h)));
    const src = names.map((h) => C.HEADERS[h]).join('\n');
    const pre = C.preprocess(src, { file: '<headers>' });
    const P = new C.Parser(pre.tokens);
    const decls = P.program();
    const protos = new Map(), list = [];
    for (const d of decls) if (d.kind === 'proto') { const e = { name: d.name, type: d.type, kind: C.LIBFNS.has(d.name) ? 'lib' : 'sys', index: list.length }; protos.set(d.name, e); list.push(e); }
    prelude = { scope: P.scopes[1], protos, list };
    for (const e of list) if (!C.BUILTINS[e.name]) C.BUILTINS[e.name] = [retName(e.type.ret), e.type.params.length, e.type.variadic ? -1 : e.type.params.length, e.kind];
    return prelude;
  };
  const retName = (t) => (t.k === 'void' ? 'void' : t.k === 'ptr' ? 'long' : t.k === 'long' ? (t.u ? 'ulong' : 'long') : t.u ? 'uint' : t.k === 'double' ? 'double' : 'int');

  class Compiler {
    constructor(src, opts) {
      if (!Compiler.mixed) { Object.assign(Compiler.prototype, C.CompileExpr); Compiler.mixed = true; }
      this.src = String(src).replace(/\r\n?/g, '\n'); this.o = opts || {};
      this.code = []; this.lines = []; this.cols = []; this.warnings = [];
      this.data = []; this.dsh = []; this.globals = new Map(); this.funcs = new Map(); this.fnList = []; this.strings = new Map();
      this.line = 0; this.col = 0; this.F = null; this.scopes = []; this.loops = [];
      this.alloc(LIBC.end - DATA, 8, 2);
      this.globals.set('errno', { addr: LIBC.errno, type: C.T.INT, line: 0, lib: true, defined: true });
      this.T = C.T;
    }
    err(msg, at, hint, extra) { at = at || { line: this.line, col: this.col }; return new C.CError(at.line, msg, at.col, Object.assign(hint ? { hint } : {}, extra || {})); }
    warn(kind, msg, at, hint) { at = at || { line: this.line, col: this.col }; if (!this.warnings.some((w) => w.line === at.line && w.col === at.col && w.kind === kind)) this.warnings.push({ line: at.line, col: at.col, kind, msg, hint }); }
    at(n) { if (n && n.line) { this.line = n.line; this.col = n.col || 0; } }
    emit(op, a, b, c, d) {
      const ins = [op]; if (a !== undefined) ins.push(a); if (b !== undefined) ins.push(b); if (c !== undefined) ins.push(c); if (d !== undefined) ins.push(d);
      this.code.push(ins); this.lines.push(this.line); this.cols.push(this.col);
      return this.code.length - 1;
    }
    here() { return this.code.length; }
    patch(at, to) { this.code[at][1] = to; }
    /** room in the data segment; sh is the shadow state of its bytes (2 initialised, 5 read-only) */
    alloc(size, align, sh) {
      while (this.data.length % align) { this.data.push(0); this.dsh.push(0); }
      const a = DATA + this.data.length;
      for (let i = 0; i < size; i++) { this.data.push(0); this.dsh.push(sh); }
      return a;
    }
    global(size, align) {
      if (this.data.length > LIBC.end - DATA) for (let i = 0; i < RZ; i++) { this.data.push(0); this.dsh.push(0); }
      const a = this.alloc(Math.max(1, size), Math.max(align, 8), 2);
      for (let i = 0; i < RZ; i++) { this.data.push(0); this.dsh.push(0); }
      return a;
    }
    intern(s) {
      if (!this.strings.has(s)) {
        const a = this.alloc(s.length + 1, 1, 5);
        for (let i = 0; i < s.length; i++) this.data[a - DATA + i] = s.charCodeAt(i) & 255;
        this.strings.set(s, a);
      }
      return this.strings.get(s);
    }

    // ---- names ----------------------------------------------------------------------------------------------
    lookup(name) {
      for (let i = this.scopes.length - 1; i >= 0; i--) { const v = this.scopes[i].get(name); if (v) return v; }
      if (this.globals.has(name)) return Object.assign({ kind: 'global' }, this.globals.get(name));
      if (this.funcs.has(name)) return { kind: 'fn', F: this.funcs.get(name) };
      return null;
    }
    /** a call or a value naming a library function: {name, type, kind} or null */
    libFn(name) {
      const p = this.pre.protos.get(name);
      if (p) return p;
      const K = S.Kern, kb = K && K.SYSCALLS && K.SYSCALLS[name];
      const b = C.BUILTINS[name] || (kb ? [kb[0], kb[1], kb[2], 'sys'] : null);
      if (b) {
        const ret = { void: C.T.VOID, uint: C.T.UINT, long: C.T.LONG, ulong: C.T.ULONG, double: C.T.DOUBLE }[b[0]] || C.T.INT;
        return { name, kind: b[3] === 'lib' ? 'lib' : 'sys', type: { k: 'fn', ret, params: [], variadic: true, proto: false, lo: b[1], hi: b[2] }, index: -1, loose: true };
      }
      return null;
    }
    visibleNames() {
      const out = new Set();
      for (const s of this.scopes) for (const k of s.keys()) out.add(k);
      for (const k of this.globals.keys()) if (!k.includes('.')) out.add(k);
      for (const k of this.funcs.keys()) out.add(k);
      for (const k of this.pre.protos.keys()) out.add(k);
      return [...out];
    }
    /** a local object in the current frame: its offset (red zones between objects) */
    frameSlot(type, name, line) {
      const T = C.T, al = Math.max(1, T.align(type)), size = Math.max(1, T.size(type));
      const F = this.F;
      F.frame += LRZ;
      F.frame = Math.ceil(F.frame / al) * al;
      const off = F.frame;
      F.frame += size;
      F.objs.push([off, size]);
      if (name) F.locals.push({ name, type, off, from: this.here(), to: null, line, scope: this.scopes[this.scopes.length - 1] });
      return off;
    }
    declareLocal(v) {
      const T = C.T, top = this.scopes[this.scopes.length - 1];
      if (top.has(v.name)) throw this.err(v.name + ' is declared twice in the same block', v);
      if (v.type.k === 'arr' && v.type.n === null) throw this.err('the array ' + v.name + ' needs a length', v, 'give it one, int a[10];, or an initializer, int a[] = {1, 2, 3};');
      if (T.isAgg(v.type) && !v.type.complete) throw this.err(T.name(v.type) + ' is declared but its members are never given, so ' + v.name + ' cannot be made', v);
      if (v.type.k === 'arr' && v.type.n < 0) {
        if (v.type.of.k === 'arr' && v.type.of.n < 0) throw this.err('only the first length of a variable-length array may vary', v);
        if (v.init) throw this.err('a variable-length array cannot have an initializer', v);
        const sym = { kind: 'vla', off: this.frameSlot(T.ULONG, null), soff: this.frameSlot(T.ULONG, null), type: v.type, name: v.name };
        top.set(v.name, sym);
        this.F.locals.push({ name: v.name, type: v.type, off: sym.off, vla: true, soff: sym.soff, from: this.here(), to: null, line: v.line, scope: top });
        return sym;
      }
      const sym = { kind: 'local', off: this.frameSlot(v.type, v.name, v.line), type: v.type, name: v.name };
      top.set(v.name, sym);
      return sym;
    }
    pushScope() { this.scopes.push(new Map()); }
    popScope() { const s = this.scopes.pop(); for (const l of this.F.locals) if (l.scope === s && l.to === null) l.to = this.here(); }

    // ---- initializers ---------------------------------------------------------------------------------------
    /** store init into the object of type t at base + off; addr(off) emits that address */
    initObject(addr, off, t, init, top) {
      const T = C.T;
      if (top && (t.k === 'arr' || T.isAgg(t)) && (init.e === 'list' || (init.e === 'str' && t.k === 'arr'))) { addr(off); this.emit('zero', T.size(t)); }
      if (t.k === 'arr' && init.e === 'str') {
        if (!T.isInt(t.of) || T.size(t.of) !== 1) throw this.err('only a char array can be initialised from a string', init);
        if (init.v.length > t.n) throw this.err('the string "' + init.v.slice(0, 20) + '" has ' + init.v.length + ' characters, too many for ' + T.name(t), init, 'the array also needs room for the closing \\0');
        const n = Math.min(init.v.length + 1, t.n);
        addr(off); this.emit('k', this.intern(init.v)); this.emit('copy', n); this.emit('pop');
        return;
      }
      if ((t.k === 'arr' || T.isAgg(t)) && init.e === 'list') { this.initList(addr, off, t, init.items, { i: 0 }, true); return; }
      if (t.k === 'arr') throw this.err('an array is initialised with a { } list', init);
      if (init.e === 'list') {
        if (init.items.length !== 1) throw this.err('a scalar is initialised with one value', init);
        return this.initObject(addr, off, t, init.items[0].init, false);
      }
      this.at(init);
      if (T.isAgg(t)) {
        addr(off); const it = this.rv(init);
        if (!T.same(T.unq(it), T.unq(t))) throw this.err('cannot initialise ' + T.name(t) + ' from ' + T.name(it), init);
        this.emit('copy', T.size(t)); this.emit('pop'); return;
      }
      addr(off);
      const vt = this.rv(init);
      this.assignConvert(vt, t, init, 'initialise');
      this.store(t); this.emit('pop');
    }
    /** a { } list (or the part of one that fills a sub-object without its own braces) */
    initList(addr, off, t, items, pos, braced) {
      const T = C.T;
      if (t.k === 'arr') {
        let i = 0; const es = T.size(t.of);
        while (pos.i < items.length) {
          const it = items[pos.i];
          if (it.desig && braced) { const d = it.desig[0]; if (d.index === undefined) throw this.err('a .member designator in an array initializer', it.init); i = d.index; if (it.desig.length > 1) { pos.i++; this.initDesig(addr, off + i * es, t.of, it.desig.slice(1), it.init); i++; continue; } }
          else if (it.desig) return;
          if (t.n !== null && t.n >= 0 && i >= t.n) { if (!braced) return; throw this.err('too many values for ' + T.name(t), it.init); }
          this.initElem(addr, off + i * es, t.of, items, pos);
          i++;
        }
        return;
      }
      const fields = t.fields.filter((f) => f.name !== null || true);
      let fi = 0;
      while (pos.i < items.length) {
        const it = items[pos.i];
        if (it.desig && braced) {
          const d = it.desig[0];
          if (d.field === undefined) throw this.err('an [index] designator in a struct initializer', it.init);
          const idx = fields.findIndex((f) => f.name === d.field);
          if (idx < 0) { const f = T.field(t, d.field); if (!f) throw this.err(T.name(t) + ' has no member named ' + d.field, d.tok || it.init); pos.i++; this.initDesig(addr, off + f.off, f.type, it.desig.slice(1), it.init); continue; }
          fi = idx;
          if (it.desig.length > 1) { pos.i++; this.initDesig(addr, off + fields[fi].off, fields[fi].type, it.desig.slice(1), it.init); fi++; continue; }
        } else if (it.desig) return;
        if (fi >= fields.length) { if (!braced) return; throw this.err('too many values for ' + T.name(t), it.init); }
        this.initElem(addr, off + fields[fi].off, fields[fi].type, items, pos);
        fi++;
        if (t.k === 'union') { if (braced && pos.i < items.length && !items[pos.i].desig) throw this.err('a union is initialised with one value', items[pos.i].init); if (!braced) return; }
      }
    }
    initElem(addr, off, t, items, pos) {
      const T = C.T, it = items[pos.i];
      const sub = t.k === 'arr' || T.isAgg(t);
      if (sub && it.init.e === 'list') { pos.i++; this.initList(addr, off, t, it.init.items, { i: 0 }, true); return; }
      if (sub && it.init.e === 'str' && t.k === 'arr') { pos.i++; this.initObject(addr, off, t, it.init, false); return; }
      if (sub && !(T.isAgg(t) && it.init.e !== 'list' && this.isAggValue(it.init, t))) { this.initList(addr, off, t, items, pos, false); return; }
      pos.i++;
      this.initObject(addr, off, t, it.init, false);
    }
    initDesig(addr, off, t, desig, init) {
      const T = C.T;
      for (const d of desig) {
        if (d.field !== undefined) { const f = T.isAgg(t) && T.field(t, d.field); if (!f) throw this.err(T.name(t) + ' has no member named ' + d.field, init); off += f.off; t = f.type; }
        else { if (t.k !== 'arr') throw this.err('[' + d.index + '] needs an array', init); off += d.index * T.size(t.of); t = t.of; }
      }
      if (init.e === 'list' && (t.k === 'arr' || T.isAgg(t))) this.initList(addr, off, t, init.items, { i: 0 }, true);
      else this.initObject(addr, off, t, init, false);
    }
    isAggValue(e, t) { const at = this.typeOf(e); return C.T.isAgg(at) && C.T.same(C.T.unq(at), C.T.unq(t)); }

    // ---- statements -----------------------------------------------------------------------------------------
    stmt(s) {
      const T = C.T;
      this.at(s);
      switch (s.s) {
        case 'block': this.pushScope(); s.body.forEach((x) => this.stmt(x)); this.popScope(); return;
        case 'decl': {
          let marked = false;
          for (const v of s.vars) {
            if (v.storage === 'extern') { this.scopes[this.scopes.length - 1].set(v.name, Object.assign({ kind: 'global' }, this.globalVar(v))); continue; }
            if (v.storage === 'static') { this.staticLocal(v); continue; }
            const needs = v.init || (v.type.k === 'arr' && v.type.n < 0);
            if (needs && !marked) { this.at(v); this.emit('stmt', s.line, s.col); marked = true; }
            const sym = this.declareLocal(v);
            this.at(v);
            if (sym.kind === 'vla') {
              this.at(v.type.vla); const dt = this.rv(v.type.vla);
              if (!T.isInt(dt)) throw this.err('the length of ' + v.name + ' must be an integer', v.type.vla);
              this.convert(dt, T.LONG);
              this.emit('lea', sym.soff); this.emit('swap'); this.emit('k', T.size(v.type.of)); this.emit('abin', '*'); this.emit('st', 'ul'); // size slot
              this.emit('lea', sym.off); this.emit('swap'); this.emit('vla', v.name); this.emit('st', 'p'); this.emit('pop');
              continue;
            }
            if (v.init) this.initObject((o) => this.emit('lea', o), sym.off, v.type, v.init, true);
          }
          return;
        }
        case 'expr': this.emit('stmt', s.line, s.col); this.rv(s.e, false); this.emit('pop'); return;
        case 'empty': return;
        case 'if': {
          this.emit('stmt', s.line, s.col); this.test(s.c); const jz = this.emit('jz', 0);
          this.stmt(s.a);
          if (s.b) { const j = this.emit('jmp', 0); this.patch(jz, this.here()); this.stmt(s.b); this.patch(j, this.here()); } else this.patch(jz, this.here());
          return;
        }
        case 'while': {
          const top = this.here(); this.at(s); this.emit('stmt', s.line, s.col); this.test(s.c); const jz = this.emit('jz', 0);
          this.loops.push({ brk: [], cont: [] }); this.stmt(s.body); const L = this.loops.pop();
          this.at(s); this.emit('jmp', top); this.patch(jz, this.here()); L.brk.forEach((j) => this.patch(j, this.here())); L.cont.forEach((j) => this.patch(j, top));
          return;
        }
        case 'do': {
          const top = this.here(); this.loops.push({ brk: [], cont: [] }); this.stmt(s.body); const L = this.loops.pop();
          const ct = this.here(); this.at({ line: s.cline, col: s.ccol }); this.emit('stmt', s.cline, s.ccol); this.test(s.c); this.emit('jnz', top);
          L.brk.forEach((j) => this.patch(j, this.here())); L.cont.forEach((j) => this.patch(j, ct));
          return;
        }
        case 'for': {
          this.pushScope();
          if (s.init) { if (s.init.s === 'decl') this.stmt(s.init); else { this.at(s.init); this.emit('stmt', s.line, s.col); this.rv(s.init.e, false); this.emit('pop'); } }
          const top = this.here(); let jz = -1;
          this.at(s.cpos || s); this.emit('stmt', s.line, s.col);
          if (s.c) { this.test(s.c); jz = this.emit('jz', 0); }
          this.loops.push({ brk: [], cont: [] }); this.stmt(s.body); const L = this.loops.pop();
          const ct = this.here();
          if (s.step) { this.at(s.spos || s); this.emit('stmt', s.line, s.col); this.rv(s.step, false); this.emit('pop'); }
          this.emit('jmp', top);
          if (jz >= 0) this.patch(jz, this.here());
          L.brk.forEach((j) => this.patch(j, this.here())); L.cont.forEach((j) => this.patch(j, ct));
          this.popScope();
          return;
        }
        case 'switch': {
          this.emit('stmt', s.line, s.col);
          const ct = this.rv(s.c);
          if (!T.isInt(ct)) throw this.err('switch needs an integer, not ' + T.name(ct), s.c);
          const pt = T.promote(ct); this.convert(ct, pt);
          const sw = this.emit('switch', null, -1);
          const ctx = { brk: [], cont: null, sw: true, cases: new Map(), def: -1, kind: T.kind(pt) };
          this.loops.push(ctx); this.stmt(s.body); this.loops.pop();
          const end = this.here();
          this.code[sw][1] = ctx.cases; this.code[sw][2] = ctx.def >= 0 ? ctx.def : end;
          ctx.brk.forEach((j) => this.patch(j, end));
          return;
        }
        case 'case': case 'default': {
          const sw = [...this.loops].reverse().find((l) => l.sw);
          if (!sw) throw this.err(s.s + ' is only allowed inside a switch', s);
          if (s.s === 'default') { if (sw.def >= 0) throw this.err('a second default in the same switch', s); sw.def = this.here(); return; }
          const v = C.I64.wrap(s.v, sw.kind);
          if (sw.cases.has(v)) throw this.err('the case ' + String(s.v) + ' appears twice in the same switch', s);
          sw.cases.set(v, this.here());
          return;
        }
        case 'label': {
          if (this.labels.has(s.name)) throw this.err('the label ' + s.name + ' is defined twice', s);
          this.labels.set(s.name, this.here()); this.stmt(s.body); return;
        }
        case 'goto': this.gotos.push({ at: this.emit('jmp', 0), name: s.name, line: s.line, col: s.col }); return;
        case 'ret': return this.ret(s);
        case 'break': {
          if (!this.loops.length) throw this.err('break is only allowed inside a loop or a switch', s);
          this.loops[this.loops.length - 1].brk.push(this.emit('jmp', 0)); return;
        }
        case 'continue': {
          const l = [...this.loops].reverse().find((x) => x.cont);
          if (!l) throw this.err('continue is only allowed inside a loop', s);
          l.cont.push(this.emit('jmp', 0)); return;
        }
      }
      throw this.err('this statement is not in the subset', s);
    }
    ret(s) {
      const T = C.T, F = this.F, rt = F.type.ret;
      this.emit('stmt', s.line, s.col);
      if (!s.e) {
        if (rt.k !== 'void') { this.warn('noret', F.name + ' should return ' + T.name(rt) + ', but this return gives no value', s); this.emit('noret'); return; }
        this.emit('k', 0); this.emit('ret'); return;
      }
      if (rt.k === 'void') {
        const et = this.typeOf(s.e);
        if (et.k !== 'void') throw this.err(F.name + ' returns void, so its return takes no value', s, 'change ' + F.name + "'s return type, or drop the value");
        this.rv(s.e, false); this.emit('pop'); this.emit('k', 0); this.emit('ret'); return;
      }
      if (T.isAgg(rt)) {
        this.emit('lea', F.sret); this.emit('ld', 'p');
        const et = this.rv(s.e);
        if (!T.same(T.unq(et), T.unq(rt))) throw this.err(F.name + ' returns ' + T.name(rt) + ', not ' + T.name(et), s.e);
        this.emit('copy', T.size(rt)); this.emit('ret'); return;
      }
      const loc = this.localAddr(s.e);
      if (loc) this.warn('ret-local', F.name + ' returns the address of its local ' + loc + ', which is gone once ' + F.name + ' returns', s.e, 'return a value, use static, or allocate it with malloc');
      const et = this.rv(s.e);
      this.at(s.e);
      this.assignConvert(et, rt, s.e, 'return');
      this.emit('ret');
    }
    /** is e the address of one of this function's own locals? its name, or null */
    localAddr(e) {
      const isLocal = (n) => { const v = n.e === 'id' && this.lookup(n.name); return v && (v.kind === 'local' || v.kind === 'vla') ? n.name : null; };
      if (e.e === 'un' && e.op === '&') { let x = e.a; while (x.e === 'idx' || (x.e === 'mem' && !x.arrow)) x = x.a; return isLocal(x); }
      if (e.e === 'id') { const v = this.lookup(e.name); if (v && (v.kind === 'local' || v.kind === 'vla') && v.type.k === 'arr') return e.name; }
      if (e.e === 'cast') return this.localAddr(e.a);
      return null;
    }
    staticLocal(v) {
      const T = C.T;
      let t = v.type;
      if (t.k === 'arr' && t.n !== null && t.n < 0) throw this.err('a static array needs a constant length', v);
      const addr = this.global(T.size(t), T.align(t));
      const name = this.F.name + '.' + v.name;
      this.globals.set(name, { addr, type: t, line: v.line, fn: this.F.name, short: v.name });
      this.scopes[this.scopes.length - 1].set(v.name, { kind: 'global', addr, type: t, name: v.name });
      if (v.init) this.inits.push({ addr, type: t, init: v.init, F: this.F, scopes: this.scopes.slice() });
    }
    /** a file-scope (or extern) variable: its symbol */
    globalVar(d) {
      const T = C.T;
      const old = this.globals.get(d.name);
      let t = d.type;
      if (old) {
        if (!T.same(T.unq(old.type), T.unq(t)) && !(old.type.k === 'arr' && t.k === 'arr')) throw this.err(d.name + ' is declared twice with different types: ' + T.name(old.type) + ' and ' + T.name(t), d);
        if (d.init && old.defined) throw this.err(d.name + ' is defined twice', d);
        if (d.init) { old.defined = true; this.inits.push({ addr: old.addr, type: old.type, init: d.init }); }
        return old;
      }
      if (t.k === 'arr' && t.n !== null && t.n < 0) throw this.err('a global array needs a constant length', d);
      if (t.k === 'arr' && t.n === null && d.storage !== 'extern') t = { k: 'arr', of: t.of, n: 1 };
      if (T.isAgg(t) && !t.complete) throw this.err(T.name(t) + ' is declared but its members are never given, so ' + d.name + ' cannot be made', d);
      const g = { addr: this.global(T.size(t), T.align(t)), type: t, line: d.line, defined: !!d.init || d.storage !== 'extern', extern: d.storage === 'extern' };
      this.globals.set(d.name, g);
      if (d.init) this.inits.push({ addr: g.addr, type: t, init: d.init });
      return g;
    }

    // ---- functions and the program -----------------------------------------------------------------------------
    fnDecl(d) {
      const T = C.T;
      let F = this.funcs.get(d.name);
      if (F && !T.same(F.type, d.type)) throw this.err(d.name + ' is declared twice with different types: ' + T.name(F.type) + ' and ' + T.name(d.type), d);
      if (F && d.kind === 'func' && F.body) throw this.err(d.name + ' is defined twice', d);
      if (!F) { F = { name: d.name, type: d.type, line: d.line, col: d.col, body: null, index: -1, addr: 0 }; this.funcs.set(d.name, F); }
      if (d.kind === 'func') { F.type = d.type; F.body = d.body; F.line = d.line; F.col = d.col; F.end = d.end; }
      const pre = this.ahead.get(d.name);
      if (pre) { F.index = pre.index; F.addr = C.FN_BASE + pre.index; }
      return F;
    }
    fnBody(F) {
      const T = C.T;
      this.F = F; F.entry = this.here(); F.frame = 0; F.objs = []; F.locals = [];
      this.labels = new Map(); this.gotos = []; this.loops = [];
      this.scopes = [new Map()];
      this.at(F);
      if (T.isAgg(F.type.ret)) F.sret = this.frameSlot(T.ULONG, null);
      F.slots = F.type.params.map((p) => {
        if (T.isAgg(p.type) && !p.type.complete) throw this.err('the parameter ' + p.name + ' has an incomplete type', p);
        const sym = this.declareLocal({ name: p.name, type: p.type, line: p.line, col: p.col });
        return { name: p.name, off: sym.off, type: p.type };
      });
      this.stmt(F.body);
      this.at(F.end || F);
      if (F.name === 'main' || F.type.ret.k === 'void') { this.emit('k', 0); this.emit('ret'); } else this.emit('noret');
      for (const l of F.locals) if (l.to === null) l.to = this.here();
      for (const g of this.gotos) { if (!this.labels.has(g.name)) throw this.err('goto names the label ' + g.name + ', which is not in ' + F.name, g); this.patch(g.at, this.labels.get(g.name)); }
      F.frame = Math.ceil((F.frame + LRZ) / 16) * 16;
      F.shadow = new Uint8Array(F.frame);
      for (const [o, n] of F.objs) F.shadow.fill(1, o, o + n);
      this.F = null; this.scopes = [];
    }
    program() {
      const pre = (this.pre = C.prelude());
      const pp = C.preprocess(this.src, { file: this.o.file });
      this.includes = pp.includes; this.warnings.push(...pp.warnings);
      const parsed = C.parse(pp.tokens, { base: pre.scope });
      this.warnings.push(...parsed.warnings);
      const decls = parsed.decls;
      this.ahead = new Map();
      for (const d of decls) if (d.kind === 'func' && !this.ahead.has(d.name)) this.ahead.set(d.name, { index: this.ahead.size, decl: d });
      this.aheadVars = new Map();
      for (const d of decls) if (d.kind === 'var' && !this.aheadVars.has(d.name)) this.aheadVars.set(d.name, d);
      this.inits = [];
      // the start: main is called with argc, argv and envp (the machine puts them on the stack), then exit
      const startCall = this.emit('call', null, 0, 1); this.emit('sys', 'exit', 1, ['i']);
      // where a thread's start routine returns to, and where a signal handler returns to
      this.threadExitPc = this.emit('sys', '__thread_exit', 1, ['p']); this.sigretPc = this.emit('sys', '__sigreturn', 0, []);
      const bodies = [];
      for (const d of decls) {
        if (d.kind === 'var') this.globalVar(d);
        else { const F = this.fnDecl(d); if (d.kind === 'func') { if (!this.fnList.includes(F)) this.fnList[F.index] = F; this.fnBody(F); bodies.push(F); } }
      }
      const main = this.funcs.get('main');
      if (!main || !main.body) throw new C.CError(1, 'the program needs a main function', 1, { hint: 'every C program starts at int main(void) { ... }' });
      if (main.type.ret.k !== 'int') this.warn('main', 'main should return int', main);
      if (main.type.params.length > 3) throw this.err('main takes at most three parameters (argc, argv, envp)', main);
      this.code[startCall][1] = main; this.code[startCall][2] = main.type.params.length;
      this.lines[startCall] = main.line; this.cols[startCall] = main.col;
      // the initial values of globals and static locals: code the compiler runs once to build the data image
      const initPc = this.here();
      for (const g of this.inits) {
        this.F = g.F || { name: '(globals)', frame: 0, objs: [], locals: [] }; this.scopes = g.scopes || [];
        this.at(g.init); this.constCheck(g.init);
        this.initObject((o) => this.emit('k', g.addr + o), 0, g.type, g.init, true);
      }
      this.F = null; this.scopes = [];
      this.emit('halt');
      for (const ins of this.code) if (ins[0] === 'call' && ins[1] && !ins[1].body) throw new C.CError(ins[1].line, 'the function ' + ins[1].name + ' is declared but never defined', ins[1].col, { hint: 'write its body, or check the spelling of its name' });
      for (const F of this.funcs.values()) if (F.body && F.index < 0) F.index = this.fnList.length;
      return { initPc };
    }
    /** a global's initializer must be computable before the program starts */
    constCheck(e) {
      const bad = (n) => { throw this.err('a global is initialised with a constant (a number, a string, or the address of a global)', n, 'set it at the start of main instead'); };
      const walk = (n, addr) => {
        if (!n || typeof n !== 'object') return;
        switch (n.e) {
          case 'call': case 'asg': case 'pre': case 'post': bad(n); return;
          case 'id': { const v = this.lookup(n.name); if (v && v.kind !== 'fn' && !addr && v.type.k !== 'arr') bad(n); return; }
          case 'un': walk(n.a, n.op === '&'); return;
          case 'idx': case 'mem': walk(n.a, addr); if (n.i) walk(n.i, false); return;
          case 'list': n.items.forEach((it) => walk(it.init, false)); return;
          case 'sizeof': return;
        }
        for (const k of ['a', 'b', 'c']) if (n[k]) walk(n[k], false);
      };
      walk(e, false);
    }
  }
  C.Compiler = Compiler;

  C.compile = function (src, opts) {
    opts = opts || {};
    const X = new Compiler(src, opts);
    const { initPc } = X.program();
    const dataEnd = DATA + Math.ceil(X.data.length / 16) * 16 + 16;
    // a heap only for a program that uses one (memory is copied on every fork, so a small image is a fast one)
    const usesHeap = X.code.some((i) => (i[0] === 'lib' && /^(malloc|calloc|realloc|strdup|strndup)$/.test(i[1])) || i[0] === 'vla' || i[0] === 'calli' || (i[0] === 'sys' && i[1] === 'pthread_create')) || X.libRefs;
    const heapBase = Math.ceil(dataEnd / 4096) * 4096, heapSize = opts.heap !== undefined ? opts.heap : usesHeap ? 65536 : 0;
    const heapEnd = heapBase + heapSize, stackSize = opts.stack || 32768;
    const data = new Uint8Array(dataEnd - DATA), dataSh = new Uint8Array(dataEnd - DATA);
    data.set(X.data); dataSh.set(X.dsh);
    const fnList = X.fnList.filter(Boolean);
    const g = X.globals.get('errno');
    const prog = {
      code: X.code, lines: X.lines, cols: X.cols, funcs: X.funcs, fnList, globals: X.globals, data, dataSh, dataBase: DATA, dataEnd,
      heapBase, heapEnd, stackBase: heapEnd, stackSize, memSize: heapEnd + stackSize, initPc, libc: LIBC, errnoAt: g ? g.addr : LIBC.errno,
      threadExitPc: X.threadExitPc, kt: { sig: X.sigretPc, thr: X.threadExitPc }, errTexts: X.errTexts || null, sigretPc: X.sigretPc, srcLines: X.src.split('\n'), warnings: X.warnings, includes: X.includes, protos: X.pre.list, strings: X.strings,
    };
    C.buildImage(prog);
    return prog;
  };
  /** compatibility: how a load or a store of a type reads memory: [bytes, signed] */
  C.T.access = (t) => (t.k === 'ptr' ? [8, 0] : [C.T.size(t), t.u || t.k === 'bool' ? 0 : 1]);
})(globalThis.Proses = globalThis.Proses || {});
