// What the views draw, read from a process's state without changing it: the call stack (frames with their locals
// and values), the globals, the heap (blocks, sizes, free or used, the free list) and every pointer (who points
// where), plus the names of addresses ("a[3]", "p->next", "the block from malloc at line 9") used in the
// sentences that explain a fault.
//   S.CLang.snapshot(prog, st, {threads}) -> {line, col, fn, frames, globals, heap: {blocks, free, base, end}, pointers}
//     frame: {fn, line, col, depth, fp, locals: [value]}   value: {name, type, addr, size, text, init, kind, ptr?, target?, items?, fields?}
//     block: {addr, h, size, cap, req, free, kind, line, fn, type, next, pointedBy: [names]}
//     pointer: {from: name, fromAddr, to: addr, target: name | null, block: payload address | null, dangling?}
//   S.CLang.nameAddr(prog, st, addr) -> {name, kind: 'global' | 'local' | 'heap' | 'string' | 'stack' | 'libc', obj, off} | null
//   S.CLang.explainFault(prog, st, err)    rewrites a fault's sentence and hint (called by the machine)
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const hex = (a) => '0x' + Number(a).toString(16);

  /** the frames of a context, innermost last: [{fr, f, fp, pc}] */
  function frames(prog, st) {
    const out = [];
    for (let i = 0; i < st.frames.length; i++) {
      const fr = st.frames[i], f = fr.f;
      const fp = i + 1 < st.frames.length ? st.frames[i + 1].fp : st.fp;
      const pc = i + 1 < st.frames.length ? st.frames[i + 1].callPc : st.pc;
      if (f) out.push({ fr, f, fp, pc, depth: i });
    }
    return out;
  }
  C.frameList = frames;

  /** every named object: [{addr, size, name, type, kind, fn?, line}] */
  function objects(prog, st, opts) {
    const out = [];
    for (const [name, g] of prog.globals) {
      if (name.startsWith('__') || g.addr < C.LIBC.end) continue;
      out.push({ addr: g.addr, size: C.T.size(g.type), name: g.short ? g.fn + '::' + g.short : name, short: g.short || name, type: g.type, kind: 'global', line: g.line, static: !!g.fn });
    }
    for (const [s, a] of prog.strings) out.push({ addr: a, size: s.length + 1, name: '"' + (s.length > 12 ? s.slice(0, 12) + '...' : s) + '"', type: C.T.arr(C.T.CHAR, s.length + 1), kind: 'string' });
    const ctxs = (opts && opts.threads) || [st];
    for (const c of ctxs) for (const fr of frames(prog, c)) {
      for (const l of fr.f.locals) {
        const live = l.from <= fr.pc && fr.pc < l.to;
        if (l.vla) { if (!live) continue; let p = 0; try { p = C.ld(c, fr.fp + l.off, 'p'); } catch (e) { continue; } const n = (() => { try { return Number(C.ld(c, fr.fp + l.soff, 'ul')); } catch (e) { return 0; } })(); out.push({ addr: p, size: n, name: l.name, short: l.name, type: { k: 'arr', of: l.type.of, n: n / C.T.size(l.type.of) }, kind: 'local', fn: fr.f.name, depth: fr.depth, live, tid: c.tid }); continue; }
        out.push({ addr: fr.fp + l.off, size: C.T.size(l.type), name: l.name, short: l.name, type: l.type, kind: 'local', fn: fr.f.name, depth: fr.depth, live, line: l.line, tid: c.tid });
      }
    }
    return out;
  }
  C.objects = objects;

  /** a name for the place at off inside an object of type t: [3], .next, [2].name ... */
  function path(t, off) {
    const T = C.T;
    let s = '';
    for (let guard = 0; guard < 8 && off >= 0; guard++) {
      if (t.k === 'arr') { const es = T.size(t.of) || 1; const i = Math.floor(off / es); s += '[' + i + ']'; off -= i * es; t = t.of; continue; }
      if (T.isAgg(t)) {
        const f = t.fields.find((x) => off >= x.off && off < x.off + T.size(x.type));
        if (!f) break;
        s += f.name ? '.' + f.name : ''; off -= f.off; t = f.type; continue;
      }
      break;
    }
    return off ? s + ' + ' + off : s;
  }
  C.nameAddr = function (prog, st, a, opts) {
    if (typeof a !== 'number') return null;
    if (a >= C.LIBC.heap && a < C.LIBC.end) return { name: 'the C library\'s own data', kind: 'libc', off: 0 };
    for (const o of objects(prog, st, opts)) if (a >= o.addr && a < o.addr + Math.max(1, o.size)) return { name: o.name + path(o.type, a - o.addr), kind: o.kind, obj: o, off: a - o.addr };
    if (a >= prog.heapBase && a < prog.heapEnd) {
      const b = C.blockOf(st, prog, a);
      if (b) {
        const p = b.h + 16, m = st.M.meta.get(p), off = a - p;
        if (b.flags & 2) return { name: 'a thread\'s stack', kind: 'stack', block: p, off, used: b.used, blk: b };
        const tname = m && m.type ? path(C.T.arr(m.type, Math.max(1, Math.floor(b.size / (C.T.size(m.type) || 1)))), off) : off ? ' + ' + off : '';
        const holder = opts && opts.noHolder ? null : pointerTo(prog, st, p);
        const what = 'the block ' + hex(p) + (m ? ' (from ' + m.fn + ' at line ' + m.line + ')' : '');
        const name = holder ? (m && m.type ? holder + tname : (off ? holder + ' + ' + off : '*' + holder)) : tname.startsWith('[') ? 'element ' + tname + ' of ' + what : what + tname;
        return { name, kind: 'heap', block: p, off, used: b.used, meta: m, blk: b, holder };
      }
    }
    if (a >= prog.stackBase && a < prog.memSize) return { name: 'the stack at ' + hex(a), kind: 'stack', off: 0 };
    return null;
  };

  /** the name of a pointer variable (a local in scope or a global) that holds p, or null */
  function pointerTo(prog, st, p) {
    for (const o of objects(prog, st)) {
      if (o.kind === 'string' || (o.kind === 'local' && !o.live)) continue;
      if (o.type.k === 'ptr') { try { if (C.ld(st, o.addr, 'p') === p) return o.short || o.name; } catch (e) { /* not readable */ } }
    }
    return null;
  }
  /** the object nearest to a (for an access that missed every object): {o, off} */
  function nearest(prog, st, a) {
    let best = null, bd = Infinity;
    for (const o of objects(prog, st)) {
      const d = a < o.addr ? o.addr - a : a >= o.addr + o.size ? a - (o.addr + o.size) + 1 : 0;
      if (d < bd && d <= 64) { bd = d; best = o; }
    }
    return best ? { o: best, off: a - best.addr } : null;
  }
  const elems = (t) => (t.k === 'arr' ? t.n + ' element' + (t.n === 1 ? '' : 's') + ' (indices 0 to ' + (t.n - 1) + ')' : C.T.size(t) + ' bytes');

  C.explainFault = function (prog, st, e) {
    e.explained = true;
    const a = e.at !== undefined ? e.at : e.addr, verb = e.write ? 'writing' : 'reading';
    const set = (msg, hint) => { e.msg = msg; if (hint) e.hint = hint; };
    switch (e.ub) {
      case 'null': return set('a NULL pointer is dereferenced: ' + verb + ' ' + e.n + ' bytes at address ' + hex(a), 'check a pointer before using it: if (p != NULL) ...');
      case 'null-call': case 'bad-call': return undefined;
      case 'wild': {
        if (typeof a === 'number' && a > 0 && a < 3840) return set('a NULL pointer is dereferenced: ' + verb + ' at address ' + hex(a) + ', which is ' + a + ' bytes past NULL (a member reached through a NULL pointer?)', 'check a pointer before using it: if (p != NULL) ...');
        return set(verb + ' through a pointer that holds ' + (typeof a === 'number' ? hex(a) : String(a)) + ', which is not an address in this program\'s memory', 'is the pointer uninitialised, or was an integer cast to a pointer?');
      }
      case 'oob': {
        if (e.unterminated !== undefined) {
          const n = nearest(prog, st, e.strAt) || {};
          return set('the string at ' + (n.o ? n.o.name : hex(e.strAt)) + ' has no closing \'\\0\': reading it runs past the end' + (n.o ? ' of ' + n.o.name + ' (' + n.o.size + ' bytes)' : ''), 'a C string ends at its \\0; make room for it and put it there');
        }
        if (a >= prog.heapBase && a < prog.heapEnd) {
          const b = C.blockOf(st, prog, e.addr);
          const info = b && heapNear(prog, st, e.addr, b);
          if (info) return set(verb + ' ' + info, 'malloc(n) gives exactly n bytes: indices 0 to n / sizeof(element) - 1');
          return set(verb + ' heap memory at ' + hex(e.addr) + ' that no allocation owns (a heap block\'s header, or unallocated space)', 'a pointer has walked off the end (or the start) of its block');
        }
        const n = nearest(prog, st, e.addr);
        if (n) {
          const o = n.o, t = o.type;
          if (t.k === 'arr') {
            const es = C.T.size(t.of) || 1, i = Math.floor((e.addr - o.addr) / es);
            return set(o.name + '[' + i + '] is out of bounds: ' + o.name + ' has ' + elems(t) + ', so ' + verb + ' index ' + i + ' misses it', 'the last element of an array of n is [n - 1]');
          }
          return set(verb + ' ' + Math.abs(n.off) + ' bytes ' + (n.off < 0 ? 'before' : 'past the start of') + ' ' + o.name + ', which is only ' + o.size + ' bytes: out of bounds', 'a pointer has walked off the object it points into');
        }
        return set(verb + ' at ' + hex(e.addr) + ', outside every object: out of bounds', 'a pointer has walked off the object it points into');
      }
      case 'uaf': {
        const b = C.blockOf(st, prog, e.addr), m = b && st.M.meta.get(b.h + 16), holder = b && pointerTo(prog, st, b.h + 16);
        return set('use after free: ' + verb + (holder ? ' through ' + holder + ', which still points to' : '') + ' the block ' + (b ? hex(b.h + 16) : hex(e.addr)) + (m ? ', allocated by ' + m.fn + ' at line ' + m.line + (m.freed && m.freed.line ? ' and freed at line ' + m.freed.line : '') : '') + (e.fn ? ' (in ' + e.fn + ')' : ''), 'after free(p), p still holds the old address; set it to NULL and do not use it again');
      }
      case 'dead-stack': return set(verb + ' a local variable of a function that has already returned (address ' + hex(e.addr) + ')', 'a function\'s locals disappear when it returns; return a value, or use static or malloc');
      case 'uninit': {
        const nm = C.nameAddr(prog, st, e.addr);
        return set((nm ? nm.name : 'the memory at ' + hex(e.addr)) + ' is read before anything is stored in it', 'give a variable a value before using it (int x = 0;); malloc\'s memory starts uninitialised too (calloc zeroes it)');
      }
      case 'ro-write': { const nm = C.nameAddr(prog, st, e.addr); return set('writing to the string literal ' + (nm && nm.obj ? nm.obj.name : '') + ': string literals are read-only, so this crashes', 'copy it into an array you own first: char s[] = "...";'); }
      case 'div0': return set(e.op === '%' ? 'the remainder of an integer division by zero (x % 0)' : 'integer division by zero (the divisor is 0)', 'check the divisor before dividing; a real machine stops the program with SIGFPE');
      case 'double-free': { const m = e.meta; return set('double free: the block ' + hex(e.addr) + (m ? ' (from ' + m.fn + ' at line ' + m.line + ')' : '') + ' was already freed' + (m && m.freed && m.freed.line ? ' at line ' + m.freed.line : ''), 'free each block once; setting the pointer to NULL after free makes a second free(p) harmless'); }
      case 'bad-free': {
        const fn = e.fn || 'free';
        if (e.why === 'middle') return set(fn + ' gets a pointer ' + e.off + ' bytes into the block ' + hex(e.block) + ', not the address malloc returned', 'pass ' + fn + ' exactly the pointer malloc gave you');
        if (e.why === 'stack') return set(fn + ' gets a thread\'s stack, which the system owns');
        const nm = C.nameAddr(prog, st, e.addr);
        if (nm && nm.obj && nm.off === 0) nm.name = nm.obj.name;
        return set(fn + ' gets ' + (nm ? 'the address of ' + nm.name + ' (' + (nm.kind === 'local' ? 'a local variable' : nm.kind === 'global' ? 'a global' : nm.kind === 'string' ? 'a string literal' : 'not heap memory') + ')' : hex(e.addr)) + ', which malloc did not allocate', 'free only what malloc, calloc or realloc returned');
      }
    }
    return undefined;
  };
  function heapNear(prog, st, a, b) {
    // the used block just before a (an access past its end) or after it (before its start)
    const blocks = C.heapBlocks(st, prog).filter((x) => !x.free && x.kind !== 'stack');
    let best = null, bd = Infinity;
    for (const x of blocks) { const d = a < x.addr ? x.addr - a : a >= x.addr + x.req ? a - (x.addr + x.req) + 1 : 0; if (d < bd) { bd = d; best = x; } }
    if (!best || bd > 64) return null;
    const m = best.meta, t = m && m.type, es = t ? C.T.size(t) || 1 : 1, off = a - best.addr;
    const holder = pointerTo(prog, st, best.addr);
    const what = 'the ' + best.req + '-byte block ' + (holder ? holder + ' points to' : hex(best.addr)) + (m ? ' (from ' + m.fn + ' at line ' + m.line + ')' : '');
    if (t) { const i = Math.floor(off / es), n = Math.floor(best.req / es); return (holder ? holder + '[' + i + ']' : 'element [' + i + ']') + ', which is out of bounds: ' + what + ' holds ' + n + ' ' + C.T.name(t) + (n === 1 ? '' : 's') + ' (indices 0 to ' + (n - 1) + ')'; }
    return (off < 0 ? Math.abs(off) + ' bytes before' : (off - best.req) + ' bytes past the end of') + ' ' + what + ': out of bounds';
  }

  // ---- values -----------------------------------------------------------------------------------------------
  function value(prog, st, addr, t, name, depth, opts) {
    const T = C.T, v = { name, type: T.name(t), addr, size: T.size(t) };
    if (t.k === 'arr') {
      const n = t.n === null || t.n < 0 ? 0 : t.n, es = T.size(t.of), shown = Math.min(n, (opts && opts.maxItems) || 16);
      v.kind = 'array';
      if (T.isInt(t.of) && es === 1 && n) { v.text = strText(st, addr, n); }
      v.items = depth > 3 ? [] : Array.from({ length: shown }, (_, i) => value(prog, st, addr + i * es, t.of, name + '[' + i + ']', depth + 1, opts));
      v.more = n - shown;
      if (!v.text) v.text = '{' + v.items.map((x) => x.text).join(', ') + (v.more > 0 ? ', ...' : '') + '}';
      v.init = v.items.every((x) => x.init);
      return v;
    }
    if (T.isAgg(t)) {
      v.kind = t.k;
      v.fields = depth > 3 ? [] : t.fields.filter((f) => f.name).map((f) => value(prog, st, addr + f.off, f.type, name + '.' + f.name, depth + 1, opts));
      v.text = '{' + v.fields.map((f) => f.name.split('.').pop() + ' = ' + f.text).join(', ') + '}';
      v.init = v.fields.every((x) => x.init);
      return v;
    }
    const k = T.kind(t), sh = st.M.sh, n = C.KSIZE[k];
    let state = 2;
    for (let i = 0; i < n; i++) { const s = sh[addr + i]; if (s !== 2 && s !== 5) { state = s; break; } }
    if (state === 1 && st.M.mem[addr] !== C.POISON) state = 2;
    v.kind = t.k === 'ptr' ? 'pointer' : 'scalar';
    if (state !== 2) { v.init = false; v.text = state === 1 ? '?' : '✗'; v.state = ['noacc', 'uninit', 'ok', 'freed', 'dead', 'ro'][state]; return v; }
    const x = C.ld(st, addr, k);
    v.init = true; v.raw = typeof x === 'bigint' ? x.toString() : x;
    if (t.k === 'ptr') {
      v.ptr = typeof x === 'number' ? x : 0;
      if (x === 0) { v.text = 'NULL'; v.target = null; }
      else if (t.to.k === 'fn') { const f = C.funcAt(prog, x), l = C.libAt(prog, x); v.text = f ? '&' + f.name : l ? '&' + l.name : hex(x); v.target = f ? f.name : l ? l.name : null; }
      else { v.text = hex(x); const nm = C.nameAddr(prog, st, Number(x), opts); v.target = nm ? nm.name : null; if (nm && nm.kind === 'heap') { v.block = nm.block; if (!nm.used) v.dangling = true; } if (!nm) v.dangling = true; }
      return v;
    }
    if (t.k === 'char') v.text = (x >= 32 && x < 127 ? "'" + String.fromCharCode(x) + "' " : '') + x;
    else if (T.isFloat(t)) v.text = C.general(Math.abs(x), 6, false, false).replace(/^/, x < 0 || Object.is(x, -0) ? '-' : '');
    else if (t.k === 'bool') v.text = x ? 'true' : 'false';
    else v.text = String(x);
    return v;
  }
  function strText(st, a, n) {
    let s = '"';
    for (let i = 0; i < n; i++) {
      const sh = st.M.sh[a + i];
      if (sh !== 2 && sh !== 5) return null;
      const c = st.M.mem[a + i];
      if (!c) return s + '"';
      s += c === 10 ? '\\n' : c === 9 ? '\\t' : c >= 32 && c < 127 ? String.fromCharCode(c) : '\\x' + c.toString(16);
    }
    return null;
  }
  C.valueAt = (prog, st, addr, t, name) => value(prog, st, addr, t, name || hex(addr), 0, {});

  C.snapshot = function (prog, st, opts) {
    opts = opts || {};
    const pos = C.posOf(prog, st);
    const fl = frames(prog, st);
    const frameViews = fl.map((x) => ({
      fn: x.f.name, depth: x.depth, fp: x.fp, line: prog.lines[x.pc] || x.f.line, col: prog.cols[x.pc] || 0,
      locals: x.f.locals.filter((l) => l.from <= x.pc && x.pc < l.to).map((l) => {
        if (l.vla) { let p = 0, n = 0; try { p = C.ld(st, x.fp + l.off, 'p'); n = Number(C.ld(st, x.fp + l.soff, 'ul')); } catch (e) { return { name: l.name, type: C.T.name(l.type), text: '?', init: false }; } return value(prog, st, p, { k: 'arr', of: l.type.of, n: n / (C.T.size(l.type.of) || 1) }, l.name, 0, opts); }
        return value(prog, st, x.fp + l.off, l.type, l.name, 0, opts);
      }),
    }));
    const globals = [];
    for (const [name, g] of prog.globals) if (!name.startsWith('__') && g.addr >= C.LIBC.end) globals.push(Object.assign(value(prog, st, g.addr, g.type, g.short || name, 0, opts), g.fn ? { fn: g.fn, static: true } : {}));
    const blocks = C.heapBlocks(st, prog).map((b) => ({ addr: b.addr, h: b.h, size: b.size, cap: b.cap, req: b.req, free: b.free, top: b.top, kind: b.kind, next: b.next ? b.next + 16 : 0, line: b.meta && b.meta.line, fn: b.meta && b.meta.fn, type: b.meta && b.meta.type ? C.T.name(b.meta.type) : null, freedAt: b.meta && b.meta.freed && b.meta.freed.line, pointedBy: [] }));
    const byAddr = new Map(blocks.map((b) => [b.addr, b]));
    // every pointer, from variables and from typed heap blocks
    const pointers = [];
    const walk = (v) => {
      if (!v) return;
      if (v.kind === 'pointer' && v.init && v.ptr) {
        const nm = v.target;
        const p = { from: v.name, fromAddr: v.addr, to: v.ptr, target: nm, block: v.block || null };
        if (v.dangling) p.dangling = true;
        pointers.push(p);
        if (v.block && byAddr.has(v.block)) byAddr.get(v.block).pointedBy.push(v.name);
      }
      (v.items || []).forEach(walk); (v.fields || []).forEach(walk);
    };
    frameViews.forEach((f) => f.locals.forEach(walk)); globals.forEach(walk);
    const contents = [];
    for (const b of C.heapBlocks(st, prog)) {
      if (b.free || b.kind !== 'heap' || !b.meta || !b.meta.type) continue;
      const t = b.meta.type, es = C.T.size(t) || 1, n = Math.max(1, Math.floor(b.req / es));
      const v = value(prog, st, b.addr, n === 1 ? t : C.T.arr(t, n), 'block ' + hex(b.addr), 1, opts);
      contents.push(v);
      walk(v);
      const bv = byAddr.get(b.addr); if (bv) bv.value = v;
    }
    return { line: pos.line, col: pos.col, fn: fl.length ? fl[fl.length - 1].f.name : null, tid: st.tid, frames: frameViews, globals, heap: { blocks, free: C.freeList(st).map((h) => h + 16), base: prog.heapBase, end: prog.heapEnd }, pointers };
  };
})(globalThis.Proses = globalThis.Proses || {});
