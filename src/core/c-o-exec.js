// Running a C program without the process kernel (one process, one thread: a lesson on structs, pointers or the
// heap), and the hooks the simulated kernel uses for threads, signal handlers and the model checker.
//   S.CLang.runProgram(src | prog, {argv, stdin, mode, max, snap}) -> {out, err, status, signal, error, warnings,
//       steps, trace}
//     out / err: what reached stdout / stderr; status: the exit code (or 128 + signal); error: the CError that
//     stopped it, if any; warnings: the compiler's and the run's; trace: [{kind: 'step' | 'warn' | 'error' |
//     'exit', line, col, say, snap?, step?}] (snap: true puts a snapshot in every step; mode 'machine' splits
//     statements into loads, operations and stores)
//   Hooks for the kernel (see the file headers of c-j-vm.js for run, complete and the sys trap):
//   S.CLang.spawn(prog, st, fnAddr, arg, {stack}) -> ctx   a new thread of st's process: its own stack (a block
//       of the heap), the same memory; it starts in the function and, when that returns, traps with
//       sys('pthread_exit', [value]) (the code at prog.threadExitPc)
//   S.CLang.pushCall(prog, st, fn, args, ret, {discard})  call fn (a name, an address or a function) now, as if the
//       code called it, returning to code index ret (prog.sigretPc traps with sys('__sigreturn') for a handler)
//   S.CLang.cloneProcess(ctxs) -> ctxs                    copies of a process's threads sharing one new memory
//   S.CLang.hash(prog, ctxs) -> string                    a key for the whole state (memory in use, registers)
//   S.CLang.funcAt(prog, addr), S.CLang.funcAddr(prog, name), S.CLang.libAt(prog, addr)
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});

  C.spawn = function (prog, st, fnAddr, arg, opts) {
    const size = (opts && opts.stack) || 16384;
    const f = C.funcAt(prog, fnAddr);
    if (!f || !f.body) throw new C.CError(st.line, 'the thread\'s start routine is not a function of the program', 0, { kind: 'ub', ub: 'bad-call', signal: 11 });
    const base = C.malloc(st, size, 2);
    if (!base) throw new C.CError(st.line, 'no room in the heap for another thread\'s stack (' + size + ' bytes)', 0, { kind: 'runtime' });
    const t = C.newCtx(st.M);
    t.tid = st.M.nextTid++;
    t.stackLo = base; t.stackHi = base + size; t.sp = t.fp = base + size;
    t.pc = prog.threadExitPc; t.line = f.line; t.col = f.col;
    C.pushCall(prog, t, f, [arg], prog.threadExitPc);
    t.frames[0].thread = true;
    return t;
  };
  C.cloneProcess = function (ctxs) { const M = C.cloneMem(ctxs[0].M); return ctxs.map((c) => C.cloneCtx(c, M)); };

  function fnv(h, m, a, b) { for (let i = a; i < b; i++) h = Math.imul(h ^ m[i], 16777619); return h; }
  C.hash = function (prog, ctxs) {
    if (!Array.isArray(ctxs)) ctxs = [ctxs];
    const M = ctxs[0].M, m = M.mem;
    let h = fnv(2166136261, m, prog.dataBase, prog.dataEnd);
    for (const b of C.heapBlocks(ctxs[0], prog)) { h = fnv(h, m, b.h, b.h + 16); if (!b.free && b.kind !== 'stack') h = fnv(h, m, b.addr, b.addr + b.req); }
    const regs = [];
    for (const c of ctxs) {
      h = fnv(h, m, c.sp, c.stackHi);
      regs.push(c.tid + ':' + c.pc + ':' + c.sp + ':' + c.fp + ':' + c.ops.join(',') + ':' + c.frames.map((f) => f.ret + '/' + f.fp).join(',') + ':' + c.halted);
    }
    return (h >>> 0).toString(36) + '|' + regs.join(';');
  };

  /** a small stand-in for the kernel: one process, its output kept as text */
  C.runProgram = function (src, opts) {
    opts = opts || {};
    const res = { out: '', err: '', status: null, signal: 0, error: null, warnings: [], steps: 0, trace: [] };
    let prog;
    try { prog = typeof src === 'string' ? C.compile(src, opts) : src; } catch (e) {
      if (!(e instanceof C.CError)) throw e;
      res.error = e; res.status = null; res.trace.push({ kind: 'error', line: e.line, col: e.col, say: 'The program does not compile: ' + e.msg + '.' });
      return res;
    }
    res.prog = prog;
    res.warnings.push(...prog.warnings);
    const st = C.state(prog, { argv: opts.argv });
    let stdin = opts.stdin || '';
    const atexit = [];
    let exitCode = null;
    const write = (fd, text) => { if (fd === 2) res.err += text; else res.out += text; return text.length; };
    const stream = (v) => (v === 2 ? 2 : 1);
    const sys = (name, args, s, info) => {
      const str = (a) => C.readStr(s, a);
      switch (name) {
        case 'printf': return { v: write(1, info.text) };
        case 'fprintf': return { v: write(stream(args[0]), info.text) };
        case 'dprintf': return { v: write(args[0] === 2 ? 2 : 1, info.text) };
        case 'puts': return { v: write(1, str(args[0]) + '\n') };
        case 'fputs': return { v: write(stream(args[1]), str(args[0])) };
        case 'putchar': write(1, String.fromCharCode(args[0] & 255)); return { v: args[0] & 255 };
        case 'fputc': case 'putc': write(stream(args[1]), String.fromCharCode(args[0] & 255)); return { v: args[0] & 255 };
        case 'perror': { const e = C.ld(s, prog.errnoAt, 'i'); const p = args[0] ? str(args[0]) : ''; write(2, (p ? p + ': ' : '') + (C.STRERROR[e] || 'Unknown error ' + e) + '\n'); return { v: 0 }; }
        case 'write': { if (args[0] !== 1 && args[0] !== 2) return { v: -1 }; const b = C.readBytes(s, args[1], Number(args[2])); write(args[0], String.fromCharCode(...b)); return { v: b.length }; }
        case 'getchar': case 'fgetc': case 'getc': { if (!stdin.length) return { v: -1 }; const c = stdin.charCodeAt(0) & 255; stdin = stdin.slice(1); return { v: c }; }
        case 'fgets': {
          const n = args[1]; if (!stdin.length || n <= 0) return { v: 0 };
          let i = stdin.indexOf('\n'); i = i < 0 ? stdin.length : i + 1; i = Math.min(i, n - 1);
          C.writeStr(s, args[0], stdin.slice(0, i)); stdin = stdin.slice(i); return { v: args[0] };
        }
        case 'read': { if (args[0] !== 0) return { v: -1 }; const n = Math.min(Number(args[2]), stdin.length); C.writeBytes(s, args[1], Uint8Array.from(stdin.slice(0, n), (c) => c.charCodeAt(0) & 255)); stdin = stdin.slice(n); return { v: n }; }
        case 'fflush': case 'setvbuf': case 'setbuf': case 'sleep': case 'usleep': case 'sched_yield': return { v: 0 };
        case 'isatty': return { v: 1 };
        case 'time': return { v: 0 };
        case 'getpid': return { v: 100 };
        case 'getppid': return { v: 1 };
        case 'atexit': atexit.push(args[0]); return { v: 0 };
        case 'exit': case '_exit': case '_Exit':
          exitCode = args[0] & 255;
          if (name === 'exit') { while (atexit.length) C.callFn(prog, s, sys, atexit.pop(), []); }
          return { exit: exitCode };
        case 'abort': throw new C.CError(0, 'abort() ends the program with signal 6 (SIGABRT)', 0, { kind: 'abort', signal: 6 });
        case 'raise': throw new C.CError(0, 'raise(' + args[0] + ') ends the program (no handler here)', 0, { kind: 'abort', signal: args[0] });
      }
      throw new C.CError(0, name + ' is a system call that needs the process kernel: run this program in the Process lab', 0, { kind: 'runtime' });
    };
    const max = opts.max || 200000;
    const step = (kind, extra) => {
      const e = Object.assign({ kind, line: st.line, col: st.col }, extra || {});
      if (opts.snap) e.snap = C.snapshot(prog, st);
      res.trace.push(e);
    };
    try {
      for (let n = 0; n < max; n++) {
        const pos = C.posOf(prog, st);
        const r = C.run(prog, st, sys, { mode: opts.mode });
        res.steps++;
        if (opts.trace !== false) step(r.why === 'mstep' ? 'mstep' : 'step', { line: pos.line, col: pos.col, step: r.step, say: r.why === 'mstep' ? stepSay(prog, st, r.step) : 'Line ' + pos.line + ' runs.' });
        if (r.warn) for (const w of r.warn) { if (res.warnings.some((x) => x.line === w.line && x.kind === w.kind)) continue; res.warnings.push(w); res.trace.push({ kind: 'warn', line: w.line, col: w.col, say: 'Line ' + w.line + ': ' + w.msg + '.' }); }
        if (r.why === 'exit') { res.status = exitCode; break; }
        if (r.why === 'block') throw new C.CError(st.line, r.name + ' would wait forever here: nothing else runs', 0, { kind: 'runtime' });
      }
      if (res.status === null && !res.error) { res.error = new C.CError(st.line, 'the program runs for more than ' + max + ' steps', 0, { kind: 'runtime', ub: 'limit' }); res.status = null; }
    } catch (e) {
      if (!(e instanceof C.CError)) throw e;
      res.error = e;
      if (e.stderr) res.err += e.stderr;
      res.signal = e.signal || 0;
      res.status = e.signal ? 128 + e.signal : 1;
      res.trace.push({ kind: 'error', line: e.line, col: e.col, say: 'Line ' + e.line + ': ' + e.msg + '.' });
    }
    if (res.status !== null && !res.error) res.trace.push({ kind: 'exit', line: st.line, col: st.col, say: 'The program exits with code ' + res.status + '.' });
    res.state = st;
    return res;
  };
  /** one machine step in words */
  function stepSay(prog, st, s) {
    const nm = s.addr !== undefined ? C.nameAddr(prog, st, s.addr) : null, name = nm ? nm.name : '0x' + Number(s.addr).toString(16);
    if (s.what === 'load') return 'Load ' + name + ' (' + String(s.value) + ') into register r' + s.reg + '.';
    if (s.what === 'store') return 'Store r' + s.reg + ' (' + String(s.value) + ') into ' + name + '.';
    if (s.what === 'copy') return 'Copy ' + s.n + ' bytes into ' + name + '.';
    return 'Compute r' + s.reg + ' = ' + (s.b === undefined ? s.op + String(s.a) : String(s.a) + ' ' + s.op + ' ' + String(s.b)) + ' = ' + String(s.value) + '.';
  }
  C.stepSay = stepSay;
  (S.engines = S.engines || []).push({ name: 'C language engine (preprocessor, parser, types, machine, C library)' });
})(globalThis.Proses = globalThis.Proses || {});
