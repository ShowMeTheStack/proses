// The C subset, stage five: the machine that runs compiled code. A process's state is plain data: its memory M
// (bytes, shadow, heap notes) and, per thread, a context (pc, sp, fp, the operand stack and the call frames). fork is
// a copy; threads share M; a model checker can hash it all.
//   S.CLang.state(prog, {argv, envp}) -> st     a fresh process image (the main thread), about to call main
//   S.CLang.clone(st) -> st                     a copy with its own memory (fork)
//   S.CLang.run(prog, st, sys, {mode}) -> r     runs one step:
//       mode 'stmt' (the default): up to the next statement; mode 'machine': also stops after each load from or
//       store to shared memory (globals and the heap: anything outside this thread's own stack) and after each
//       arithmetic step on a value loaded from it, so count++ is three steps (load, add, store).
//       r.why: 'stmt' | 'mstep' (r.step: {what: 'load' | 'op' | 'store' | 'copy', addr, value, reg, op, a, b, kind})
//              | 'sys' (a kernel call finished; r.name) | 'block' (the call must wait) | 'exit' | 'halt'
//       r.warn: the diagnostics raised in this step that do not stop the program (signed overflow, a bad shift,
//       a format that does not match its arguments, a returned address of a local)
//   sys(name, args, st, info) -> {v} | {v, block: true} | {block: true} | {exit: code}      the kernel's trap;
//       info: {kinds (each argument's kind), line, col, text (for printf, fprintf and dprintf: the formatted output)}
//   S.CLang.complete(st, nargs, v)   finish a kernel call by hand (the child's side of fork, a woken waiter)
//   S.CLang.lineOf(prog, st), S.CLang.posOf(prog, st) -> {line, col}
// A fault (out of bounds, use after free, NULL, uninitialised, division by zero...) throws a CError with kind 'ub',
// the line and column, a sentence naming the object, a hint and the signal a real machine would send.
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  const LIMIT = 200000;
  const INT_MIN = -2147483648, INT_MAX = 2147483647;

  // Each memory array has one record (its shadow, the heap's notes); every thread holding the array shares it. A
  // kernel may give a context another array (vm.mem = copy, after fork or when it grows the memory for a thread's
  // stack): the record is found by the array, or made from the context's previous one (new bytes are usable).
  const MEMS = new WeakMap();
  C.memRecord = (a) => MEMS.get(a) || null;
  function adopt(a, from) {
    let M = MEMS.get(a);
    if (M) return M;
    M = { mem: a, sh: new Uint8Array(a.length), dv: null, meta: new Map(), warned: new Set(), nextTid: 1 };
    if (from && from.sh.length) {
      M.sh.set(from.sh.subarray(0, Math.min(from.sh.length, a.length)));
      if (a.length > from.sh.length) M.sh.fill(2, from.sh.length);
      for (const [k, v] of from.meta) M.meta.set(k, Object.assign({}, v));
      M.warned = new Set(from.warned); M.nextTid = from.nextTid;
    } else M.sh.fill(2);
    MEMS.set(a, M);
    return M;
  }
  class Ctx {
    get mem() { return this.M.mem; }
    set mem(a) {
      if (this.M && this.M.mem === a) return;
      if (this.M && this.M.mem.length) this.srcM = this.M;
      this.M = adopt(a, this.M && this.M.mem.length ? this.M : this.srcM);
    }
  }
  C.Ctx = Ctx;
  function newCtx(M) {
    const st = new Ctx();
    Object.assign(st, { M, pc: 0, sp: 0, fp: 0, ops: [], frames: [], line: 0, col: 0, halted: false, tid: 0, stackLo: 0, stackHi: 0, warn: [], hot: false });
    return st;
  }
  C.newCtx = newCtx;

  /** a process image of prog, with the data segment as compiled and an empty heap and stack */
  function blank(prog) {
    const mem = new Uint8Array(prog.memSize), sh = new Uint8Array(prog.memSize);
    mem.set(prog.data, prog.dataBase); sh.set(prog.dataSh, prog.dataBase);
    const M = { mem, sh, dv: null, meta: new Map(), warned: new Set(), nextTid: 1 };
    MEMS.set(mem, M);
    C.heapInit(M, prog);
    sh.fill(2, prog.stackBase, prog.memSize);
    const st = newCtx(M);
    st.sp = st.fp = prog.memSize; st.stackLo = prog.stackBase; st.stackHi = prog.memSize;
    return st;
  }
  /** run the code that gives globals their first values, once, and keep the data segment it leaves */
  C.buildImage = function (prog) {
    const st = blank(prog);
    C.srandInit(st, 1);
    st.pc = prog.initPc;
    exec(prog, st, () => { throw new C.CError(0, 'a global cannot be initialised with a call'); }, false, -1);
    prog.data = st.M.mem.slice(prog.dataBase, prog.dataEnd);
    prog.dataSh = st.M.sh.slice(prog.dataBase, prog.dataEnd);
  };

  C.state = function (prog, opts) {
    opts = opts || {};
    const st = blank(prog);
    const main = prog.funcs.get('main');
    const argv = opts.argv && opts.argv.length ? opts.argv : ['a.out'], envp = opts.envp || [];
    // the strings, then envp and argv, at the top of the stack
    let top = prog.memSize;
    const put = (s) => { top -= s.length + 1; C.writeStr(st, top, s); return top; };
    const ap = argv.map(put), ep = envp.map(put);
    top = Math.floor(top / 8) * 8 - 8 * (ep.length + 1);
    const envAt = top; ep.forEach((p, i) => C.st_(st, envAt + 8 * i, 'p', p)); C.st_(st, envAt + 8 * ep.length, 'p', 0);
    top -= 8 * (ap.length + 1);
    const argvAt = top; ap.forEach((p, i) => C.st_(st, argvAt + 8 * i, 'p', p)); C.st_(st, argvAt + 8 * ap.length, 'p', 0);
    st.sp = st.fp = Math.floor(top / 16) * 16;
    st.ops = [argv.length, argvAt, envAt].slice(0, main.type.params.length);
    st.line = main.line; st.col = main.col;
    return st;
  };
  C.cloneMem = function (M) {
    const meta = new Map(); for (const [k, v] of M.meta) meta.set(k, Object.assign({}, v));
    const c = { mem: M.mem.slice(), sh: M.sh.slice(), dv: null, meta, warned: new Set(M.warned), nextTid: M.nextTid };
    if (c.mem.length) MEMS.set(c.mem, c);
    return c;
  };
  C.cloneCtx = function (st, M) {
    const c = newCtx(M);
    for (const k of Object.keys(st)) if (k !== 'M' && k !== 'key') c[k] = st[k];
    c.ops = st.ops.slice(); c.frames = st.frames.map((f) => Object.assign({}, f, f.vla ? { vla: f.vla.slice() } : {})); c.warn = st.warn.slice();
    return c;
  };
  C.clone = (st) => C.cloneCtx(st, C.cloneMem(st.M));

  C.complete = function (st, nargs, v) { st.ops.length -= nargs; st.ops.push(v === undefined ? 0 : v); st.pc++; };
  C.lineOf = (prog, st) => { const ins = prog.code[st.pc]; return ins && ins[0] === 'stmt' ? ins[1] : st.line; };
  C.posOf = (prog, st) => { const ins = prog.code[st.pc]; return ins && ins[0] === 'stmt' ? { line: ins[1], col: ins[2] } : { line: st.line, col: st.col }; };

  /** a diagnostic that does not stop the program; the first at each place only */
  function warn(prog, st, kind, msg, hint, pc) {
    pc = pc === undefined ? st.pc : pc;
    const key = pc + ':' + kind;
    if (st.M.warned.has(key)) return;
    st.M.warned.add(key);
    const w = { kind, line: prog.lines[pc] || st.line, col: prog.cols[pc] || 0, msg, hint };
    st.warn.push(w);
  }
  C.warnAt = warn;

  function overflow(prog, st, a, op, b, k, r) {
    warn(prog, st, 'overflow', 'signed overflow: ' + String(a) + ' ' + op + ' ' + String(b) + ' does not fit in ' + (k === 'i' ? 'an int' : 'a long') + ' (it wraps to ' + String(r) + ' here, but C promises nothing)', 'use a wider type (long) or unsigned arithmetic');
  }
  /** a binary operation on two values of kind k */
  function bin(prog, st, op, a, b, k) {
    if (k === 'i') {
      switch (op) {
        case '+': { const r = a + b; if (r > INT_MAX || r < INT_MIN) { const w = r | 0; overflow(prog, st, a, op, b, k, w); return w; } return r; }
        case '-': { const r = a - b; if (r > INT_MAX || r < INT_MIN) { const w = r | 0; overflow(prog, st, a, op, b, k, w); return w; } return r; }
        case '*': { const r = a * b, w = Math.imul(a, b); if (r !== w) overflow(prog, st, a, op, b, k, w); return w; }
        case '/': case '%':
          if (b === 0) throw C.fault('div0', 0, 0, false, { op });
          if (a === INT_MIN && b === -1) { overflow(prog, st, a, op, b, k, op === '/' ? INT_MIN : 0); return op === '/' ? INT_MIN : 0; }
          return op === '/' ? (a / b) | 0 : (a % b) | 0;
        case '<<': if (b < 0 || b > 31) warn(prog, st, 'shift', 'shifting by ' + b + ' bits: an int has 32, so the result is undefined'); return a << (b & 31);
        case '>>': if (b < 0 || b > 31) warn(prog, st, 'shift', 'shifting by ' + b + ' bits: an int has 32, so the result is undefined'); return a >> (b & 31);
        case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
      }
    } else if (k === 'u') {
      switch (op) {
        case '+': return (a + b) >>> 0; case '-': return (a - b) >>> 0; case '*': return Math.imul(a, b) >>> 0;
        case '/': case '%': if (b === 0) throw C.fault('div0', 0, 0, false, { op }); return op === '/' ? Math.floor(a / b) >>> 0 : (a % b) >>> 0;
        case '<<': if (b < 0 || b > 31) warn(prog, st, 'shift', 'shifting by ' + b + ' bits: an unsigned int has 32'); return (a << (b & 31)) >>> 0;
        case '>>': if (b < 0 || b > 31) warn(prog, st, 'shift', 'shifting by ' + b + ' bits: an unsigned int has 32'); return a >>> (b & 31);
        case '&': return (a & b) >>> 0; case '|': return (a | b) >>> 0; case '^': return (a ^ b) >>> 0;
      }
    } else if (k === 'd' || k === 'f') {
      let r;
      switch (op) { case '+': r = a + b; break; case '-': r = a - b; break; case '*': r = a * b; break; case '/': r = a / b; break; default: r = NaN; }
      if (op in CMPS) return CMPS[op](a, b);
      return k === 'f' ? Math.fround(r) : r;
    } else {
      const I = C.I64, kk = k === 'p' ? 'ul' : k;
      switch (op) {
        case '+': case '-': case '*': {
          const r = op === '+' ? I.add(a, b, kk) : op === '-' ? I.sub(a, b, kk) : I.mul(a, b, kk);
          if (kk === 'l' && (typeof r === 'bigint' || typeof a === 'bigint' || typeof b === 'bigint' || !Number.isSafeInteger(op === '*' ? a * b : op === '+' ? a + b : a - b)) && I.overflows(op, a, b)) overflow(prog, st, a, op, b, kk, r);
          return r;
        }
        case '/': case '%':
          if (b === 0) throw C.fault('div0', 0, 0, false, { op });
          if (kk === 'l' && b === -1 && op === '/' && I.overflows('/', a, b)) { const r = I.div(a, b, kk); overflow(prog, st, a, op, b, kk, r); return r; }
          return op === '/' ? I.div(a, b, kk) : I.rem(a, b, kk);
        case '<<': if (b < 0 || b > 63) warn(prog, st, 'shift', 'shifting by ' + b + ' bits: a long has 64'); return I.shl(a, b & 63, kk);
        case '>>': if (b < 0 || b > 63) warn(prog, st, 'shift', 'shifting by ' + b + ' bits: a long has 64'); return I.shr(a, b & 63, kk);
        case '&': case '|': case '^': return I.bit(op, a, b, kk);
      }
    }
    if (op in CMPS) return CMPS[op](a, b);
    throw new C.CError(0, 'the operator ' + op + ' is not in the subset');
  }
  const CMPS = { '==': (a, b) => +(a == b), '!=': (a, b) => +(a != b), '<': (a, b) => +(a < b), '>': (a, b) => +(a > b), '<=': (a, b) => +(a <= b), '>=': (a, b) => +(a >= b) }; // eslint-disable-line eqeqeq
  function abin(op, a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      const r = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : Math.trunc(a / b);
      if (Number.isSafeInteger(r)) return r;
    }
    const x = C.I64.big(a), y = C.I64.big(b);
    return C.I64.norm(BigInt.asIntN(64, op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : x / y));
  }
  function un(prog, st, op, a, k) {
    if (op === '!') return a == 0 ? 1 : 0; // eslint-disable-line eqeqeq
    if (k === 'd' || k === 'f') return -a;
    if (op === '-') {
      if (k === 'i') { if (a === INT_MIN) { overflow(prog, st, 0, '-', a, k, a); return a; } return -a | 0; }
      if (k === 'u') return (-a) >>> 0;
      if (k === 'l' && C.I64.overflows('-', 0, a)) { overflow(prog, st, 0, '-', a, k, a); return a; }
      return C.I64.sub(0, a, k === 'p' ? 'ul' : k);
    }
    if (k === 'i') return ~a; if (k === 'u') return (~a) >>> 0;
    return C.I64.not(a, k === 'p' ? 'ul' : k);
  }

  /** enter function f with args (a frame is pushed); ret is the code index to return to */
  function enter(prog, st, f, args, flags, ret) {
    const fr = { ret, fp: st.fp, sp: st.sp, fn: f.name, f, line: st.line, col: st.col, used: flags & 1, callPc: st.pc };
    if (flags & 2) fr.discard = true;
    st.frames.push(fr);
    if (st.frames.length > 5000) throw new C.CError(0, 'the call stack is too deep: ' + f.name + ' has been called ' + st.frames.length + ' times without returning', 0, { kind: 'ub', ub: 'stack-overflow', signal: 11, hint: 'a recursive function needs a case that stops the recursion' });
    st.sp -= f.frame; st.fp = st.sp;
    if (st.sp < st.stackLo) throw new C.CError(0, 'stack overflow: ' + f.name + ' needs ' + f.frame + ' bytes of stack and too few are left', 0, { kind: 'ub', ub: 'stack-overflow', signal: 11, hint: 'deep recursion or very large local arrays use up the stack; use malloc for big arrays' });
    const M = st.M;
    M.mem.fill(C.POISON, st.sp, st.sp + f.frame); M.sh.set(f.shadow, st.sp);
    let i = 0;
    if (f.sret !== undefined) C.st_(st, st.fp + f.sret, 'p', args[i++]);
    for (const s of f.slots) {
      const v = args[i++];
      if (C.T.isAgg(s.type)) C.copyMem(st, st.fp + s.off, v, C.T.size(s.type));
      else C.st_(st, st.fp + s.off, C.T.kind(s.type), v === undefined ? 0 : v);
    }
    st.pc = f.entry; st.line = f.line; st.col = f.col;
  }
  function leave(prog, st, v) {
    const fr = st.frames.pop(), f = fr.f, M = st.M;
    if (f && f.type.ret.k === 'ptr' && typeof v === 'number' && v >= st.fp && v < st.fp + f.frame) warn(prog, st, 'ret-local', f.name + ' returns the address of its own local variable; that memory is gone once ' + f.name + ' returns', 'return a value, or use static or malloc for memory that must outlive the call');
    if (fr.vla) for (const p of fr.vla) C.free(st, prog, p);
    if (f) M.sh.fill(4, st.fp, st.fp + f.frame);
    st.fp = fr.fp; st.sp = fr.sp; st.pc = fr.ret; st.line = fr.line; st.col = fr.col;
    if (!fr.discard) st.ops.push(v);
    return fr;
  }
  C.pushCall = function (prog, st, fn, args, ret, opts) {
    const f = typeof fn === 'string' ? prog.funcs.get(fn) : typeof fn === 'number' ? C.funcAt(prog, fn) : fn;
    if (!f || !f.body) throw new C.CError(st.line, 'there is no function ' + fn + ' to call');
    enter(prog, st, f, args || [], opts && opts.discard ? 2 : 0, ret === undefined ? st.pc : ret);
  };
  /** the user function at a function address, or null */
  C.funcAt = (prog, a) => { const i = Number(a) - C.FN_BASE; return i >= 0 && i < prog.fnList.length ? prog.fnList[i] : null; };
  C.libAt = (prog, a) => { const i = Number(a) - C.FN_BASE - C.LIB_FN; return i >= 0 && i < prog.protos.length ? prog.protos[i] : null; };
  C.funcAddr = (prog, name) => { const f = prog.funcs.get(name); if (f && f.body) return f.addr; const l = prog.protos.find((x) => x.name === name); return l ? C.FN_BASE + C.LIB_FN + l.index : 0; };

  /** a library call computed in place */
  function lib(prog, st, sys, name, args, kinds) {
    const fn = C.LIB[name];
    if (!fn) throw new C.CError(0, name + ' is not available in this machine', 0, { kind: 'runtime' });
    const v = fn({ prog, st, sys, kinds, name }, args);
    return v === undefined ? 0 : v;
  }
  /** a kernel call: the printf family is formatted here and handed over as text */
  function trap(prog, st, sys, name, args, kinds) {
    const info = { kinds, line: st.line, col: st.col };
    const fa = C.FMTARG[name];
    if (fa !== undefined && name !== 'sprintf' && name !== 'snprintf' && name !== 'sscanf') {
      const r = C.format(st, args[fa], args.slice(fa + 1), kinds.slice(fa + 1));
      info.text = r.text;
      // a literal format was checked when the program compiled
      if (st.M.sh[args[fa]] !== 5) for (const w of r.warn) warn(prog, st, 'format', name + ': ' + w);
    }
    return sys(name, args, st, info);
  }

  /** run from st.pc. nested >= 0: a call made by the library (qsort's comparison), run until frame depth nested */
  function exec(prog, st, sys, mode, nested) {
    const code = prog.code, ops = st.ops;
    let n = 0;
    for (;;) {
      const ins = code[st.pc];
      if (!ins) throw new C.CError(st.line, 'the program ran off the end of its code');
      if (++n > LIMIT) throw new C.CError(0, nested >= 0 ? 'a function called by the library runs too long' : 'this statement runs for more than ' + LIMIT + ' machine steps without finishing', 0, { kind: 'runtime', ub: 'limit', hint: 'is there a loop without a statement in its body, or an endless recursion?' });
      let step = null;
      switch (ins[0]) {
        case 'stmt':
          if (n > 1 && nested < 0) return { why: 'stmt' };
          st.line = ins[1]; st.col = ins[2]; st.hot = false; st.pc++; continue;
        case 'k': ops.push(ins[1]); break;
        case 'lea': ops.push(st.fp + ins[1]); break;
        case 'ld': {
          const a = ops.pop(), v = C.ld(st, a, ins[1]);
          ops.push(v);
          if (mode && !(a >= st.stackLo && a < st.stackHi)) { step = { what: 'load', addr: a, value: v, kind: ins[1], reg: ops.length - 1 }; st.hot = true; }
          break;
        }
        case 'st': {
          const v = ops.pop(), a = ops.pop(), r = C.st_(st, a, ins[1], v);
          ops.push(r);
          if (ins[2] && typeof r === 'number' && r >= prog.heapBase && r < prog.heapEnd) { const m = st.M.meta.get(r); if (m && !m.type && !m.freed) m.type = ins[2]; }
          if (mode && !(a >= st.stackLo && a < st.stackHi)) { step = { what: 'store', addr: a, value: r, kind: ins[1], reg: ops.length - 1 }; st.hot = false; }
          break;
        }
        case 'copy': { const src = ops.pop(), dst = ops.pop(); C.copyMem(st, dst, src, ins[1]); ops.push(dst); if (mode && !(dst >= st.stackLo && dst < st.stackHi && src >= st.stackLo && src < st.stackHi)) step = { what: 'copy', addr: dst, from: src, n: ins[1], reg: ops.length - 1 }; break; }
        case 'zero': { const a = ops.pop(); C.fill(st, a, ins[1], 0); break; }
        case 'pop': ops.pop(); break;
        case 'dup': ops.push(ops[ops.length - 1]); break;
        case 'swap': { const b = ops.pop(), a = ops.pop(); ops.push(b, a); break; }
        case 'tuck': { const b = ops.pop(), a = ops.pop(); ops.push(b, a, b); break; }
        case 'cvt': ops.push(C.I64.wrap(ops.pop(), ins[1])); break;
        case 'bin': {
          const b = ops.pop(), a = ops.pop(), r = bin(prog, st, ins[1], a, b, ins[2]);
          ops.push(r);
          if (mode && st.hot) step = { what: 'op', op: ins[1], a, b, value: r, kind: ins[2], reg: ops.length - 1 };
          break;
        }
        case 'abin': { const b = ops.pop(), a = ops.pop(); ops.push(abin(ins[1], a, b)); break; }
        case 'un': { const a = ops.pop(), r = un(prog, st, ins[1], a, ins[2]); ops.push(r); if (mode && st.hot) step = { what: 'op', op: ins[1], a, value: r, kind: ins[2], reg: ops.length - 1 }; break; }
        case 'jmp': st.pc = ins[1]; continue;
        case 'jz': if (ops.pop() == 0) { st.pc = ins[1]; continue; } break; // eslint-disable-line eqeqeq
        case 'jnz': if (ops.pop() != 0) { st.pc = ins[1]; continue; } break; // eslint-disable-line eqeqeq
        case 'switch': { const v = ops.pop(), to = ins[1].get(v); st.pc = to === undefined ? ins[2] : to; continue; }
        case 'call': { const k = ins[2], args = ops.splice(ops.length - k, k); enter(prog, st, ins[1], args, ins[3], st.pc + 1); continue; }
        case 'calli': {
          const k = ins[1], args = ops.splice(ops.length - k, k), a = ops.pop();
          const f = C.funcAt(prog, a);
          if (f && f.body) { enter(prog, st, f, args, ins[2], st.pc + 1); continue; }
          const l = C.libAt(prog, a);
          if (!l) throw new C.CError(0, a === 0 ? 'a call through a NULL function pointer' : 'a call through a pointer that does not point to a function (it holds ' + (typeof a === 'number' ? '0x' + a.toString(16) : String(a)) + ')', 0, { kind: 'ub', ub: a === 0 ? 'null-call' : 'bad-call', signal: 11, hint: 'give the function pointer a function before calling it' });
          if (l.kind === 'lib') { ops.push(lib(prog, st, sys, l.name, args, ins[3])); break; }
          ops.push(...args);
          const r = trap(prog, st, sys, l.name, args, ins[3]);
          return finishSys(st, r, k, l.name, nested);
        }
        case 'ret': { const fr = leave(prog, st, ops.pop()); if (nested >= 0 && st.frames.length === nested) return { why: 'done', v: fr.discard ? undefined : ops.pop() }; continue; }
        case 'noret': {
          const fr0 = st.frames[st.frames.length - 1];
          if (fr0 && fr0.used) {
            const pc = fr0.callPc;
            throw new C.CError(prog.lines[pc], fr0.fn + ' reached its closing } without a return, but its result is used at line ' + prog.lines[pc], prog.cols[pc], { kind: 'ub', ub: 'noret', signal: 0, fnLine: st.line, hint: 'every path through ' + fr0.fn + ' must end with return and a value' });
          }
          const fr = leave(prog, st, 0); if (nested >= 0 && st.frames.length === nested) return { why: 'done', v: fr.discard ? undefined : ops.pop() }; continue;
        }
        case 'lib': { const k = ins[2], args = ops.splice(ops.length - k, k); ops.push(lib(prog, st, sys, ins[1], args, ins[3])); break; }
        case 'sys': {
          const k = ins[2], args = ops.slice(ops.length - k);
          const r = trap(prog, st, sys, ins[1], args, ins[3] || []);
          return finishSys(st, r, k, ins[1], nested);
        }
        case 'vla': {
          const size = ops.pop(), fr = st.frames[st.frames.length - 1];
          if (!(size > 0)) throw new C.CError(0, 'the variable-length array ' + ins[1] + ' gets length ' + String(size) + '; it needs at least one element', 0, { kind: 'ub', ub: 'oob', signal: 11 });
          const p = C.malloc(st, size, 4);
          if (!p) throw new C.CError(0, 'the variable-length array ' + ins[1] + ' (' + size + ' bytes) does not fit in memory', 0, { kind: 'ub', ub: 'stack-overflow', signal: 11 });
          (fr.vla = fr.vla || []).push(p);
          ops.push(p); break;
        }
        case 'halt': return { why: 'halt' };
        default: throw new C.CError(st.line, 'unknown instruction ' + ins[0]);
      }
      st.pc++;
      if (step) return { why: 'mstep', step };
    }
  }
  function finishSys(st, r, k, name, nested) {
    if (nested >= 0 && (r.block || r.exit !== undefined)) throw new C.CError(0, name + ' cannot wait or exit inside a function the library calls (such as qsort\'s comparison)');
    if (r.exit !== undefined) { st.halted = true; return { why: 'exit', name }; }
    if (r.block && r.v === undefined) return { why: 'block', name };
    C.complete(st, k, r.v === undefined ? 0 : r.v);
    if (nested >= 0) return null;
    return { why: r.block ? 'block' : 'sys', name };
  }
  C.exec = exec;

  /** one step; faults come back as CError with the line, column and a sentence about the object */
  C.RUN_UNITS = { stmt: true, machine: true, mem: true };
  C.run = function (prog, st, sys, opts) {
    const mode = !!(opts && (opts.mode === 'machine' || opts.unit === 'mem' || opts.unit === 'machine'));
    const w0 = st.warn.length;
    let r;
    try {
      do { r = exec(prog, st, sys, mode, -1); } while (r === null);
    } catch (e) {
      throw C.located(prog, st, e);
    }
    if (st.warn.length > w0) r.warn = st.warn.slice(w0);
    return r;
  };
  /** give an error its place (the instruction that failed) and, for a fault, its explanation */
  C.located = function (prog, st, e) {
    if (!(e instanceof C.CError)) return e;
    if (!e.line) { e.line = prog.lines[st.pc] || st.line; e.col = prog.cols[st.pc] || 0; }
    if (e.kind === 'ub' && C.explainFault && !e.explained) C.explainFault(prog, st, e);
    e.message = 'line ' + e.line + (e.col ? ', column ' + e.col : '') + ': ' + e.msg;
    st.halted = true;
    return e;
  };
  /** call a function of the program from the library (qsort's comparison): runs it to its return, returns its value */
  C.callFn = function (prog, st, sys, fnAddr, args) {
    const f = C.funcAt(prog, fnAddr);
    if (!f || !f.body) { const l = C.libAt(prog, fnAddr); if (l && l.kind === 'lib') return lib(prog, st, sys, l.name, args, []); throw new C.CError(0, fnAddr === 0 ? 'a NULL function pointer is called' : 'a call through a pointer that does not point to a function', 0, { kind: 'ub', ub: fnAddr === 0 ? 'null-call' : 'bad-call', signal: 11 }); }
    const depth = st.frames.length, pc = st.pc, line = st.line, col = st.col, hot = st.hot;
    enter(prog, st, f, args, 1, -1);
    let r;
    do { r = exec(prog, st, sys, false, depth); } while (r === null);
    st.pc = pc; st.line = line; st.col = col; st.hot = hot;
    return r.v;
  };
})(globalThis.Proses = globalThis.Proses || {});
