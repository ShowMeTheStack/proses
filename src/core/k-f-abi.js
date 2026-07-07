// The simulated kernel, part six: the boundary between the C subset and the kernel (the ABI). The numbers and the
// declarations live in one table the compiler and the kernel share (S.CLang.CONSTS, HEADERS: c-h-consts.js);
// this file gives the kernel its views of it and the calls it makes into the machine.
//   S.Kern.SYSCALLS      name: [return, fewest arguments, most (-1: any)]: the calls the kernel provides; the
//                        compiler takes from here any call the headers do not declare
//   S.Kern.SIG, ERR, O, CONST (= S.CLang.CONSTS), SIGNAME, ERRNAME, STRERROR   read from the shared table
//   S.Kern.LOCAL, STDIO  calls that touch only the caller's own state, and the stdio calls (for footprints)
//   S.Kern.compile(src) -> prog (cached)          S.Kern.image(prog, argv) -> the main thread's context
//   S.Kern.fnName(prog, addr) -> the name of the program's function at that address (FN_BASE + its index), or null
//   S.Kern.pushCall(prog, ctx, fn, args, ret)     call fn now, as if the code had, returning to code index ret
// A handler returns into prog.kt.sig, which traps with __sigreturn; a thread's start routine into prog.kt.thr
// (__thread_exit, its value as the argument).
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});

  // the shared table, seen the kernel's way (computed when first asked: c-h-consts.js may load later)
  let views = null;
  function view() {
    if (views) return views;
    const C = S.CLang.CONSTS, pick = (re, skip) => Object.fromEntries(Object.entries(C).filter(([k, v]) => re.test(k) && typeof v === 'number' && !(skip && skip.test(k))));
    const SIG = pick(/^SIG[A-Z]+[0-9]*$/, /^SIG(RTMIN|RTMAX|STKSZ|IOT|POLL|CLD|UNUSED|SYS)$/), ERR = pick(/^E[A-Z0-9]+$/, /^(EOF|EXIT_.*)$/), O = pick(/^O_[A-Z]+$/);
    const first = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (!(v in r)) r[v] = k; return r; };
    views = { SIG, ERR, O, CONST: C, SIGNAME: first(SIG), ERRNAME: first(ERR), STRERROR: Object.assign({ 0: 'Success' }, S.CLang.STRERROR) };
    return views;
  }
  for (const k of ['SIG', 'ERR', 'O', 'CONST', 'SIGNAME', 'ERRNAME', 'STRERROR']) Object.defineProperty(K, k, { get: () => view()[k], enumerable: true });

  K.SYSCALLS = {
    fork: ['int', 0, 0], exit: ['void', 1, 1], _exit: ['void', 1, 1], wait: ['int', 1, 1], waitpid: ['int', 3, 3], getpid: ['int', 0, 0], getppid: ['int', 0, 0],
    sleep: ['uint', 1, 1], printf: ['int', 1, -1], fprintf: ['int', 2, -1], dprintf: ['int', 2, -1], putchar: ['int', 1, 1], puts: ['int', 1, 1], fputs: ['int', 2, 2], fflush: ['int', 1, 1],
    getchar: ['int', 0, 0], fgets: ['long', 3, 3], perror: ['void', 1, 1], setvbuf: ['int', 4, 4], setbuf: ['void', 2, 2], isatty: ['int', 1, 1], freopen: ['long', 3, 3], creat: ['int', 2, 2],
    execl: ['int', 1, -1], execlp: ['int', 1, -1], execv: ['int', 2, 2], execvp: ['int', 2, 2],
    open: ['int', 2, 3], close: ['int', 1, 1], read: ['long', 3, 3], write: ['long', 3, 3], lseek: ['long', 3, 3], unlink: ['int', 1, 1], dup: ['int', 1, 1], dup2: ['int', 2, 2], pipe: ['int', 1, 1],
    kill: ['int', 2, 2], signal: ['long', 2, 2], sigaction: ['int', 3, 3], sigprocmask: ['int', 3, 3], sigemptyset: ['int', 1, 1], sigfillset: ['int', 1, 1], sigaddset: ['int', 2, 2], sigdelset: ['int', 2, 2], sigismember: ['int', 2, 2],
    sigpending: ['int', 1, 1], sigsuspend: ['int', 1, 1], pause: ['int', 0, 0], alarm: ['uint', 1, 1], raise: ['int', 1, 1], abort: ['void', 0, 0],
    setpgid: ['int', 2, 2], getpgid: ['int', 1, 1], getpgrp: ['int', 0, 0], tcsetpgrp: ['int', 2, 2], tcgetpgrp: ['int', 1, 1],
    pthread_create: ['int', 4, 4], pthread_join: ['int', 2, 2], pthread_exit: ['void', 1, 1], pthread_self: ['long', 0, 0],
    pthread_mutex_init: ['int', 2, 2], pthread_mutex_lock: ['int', 1, 1], pthread_mutex_trylock: ['int', 1, 1], pthread_mutex_unlock: ['int', 1, 1], pthread_mutex_destroy: ['int', 1, 1],
    pthread_cond_init: ['int', 2, 2], pthread_cond_wait: ['int', 2, 2], pthread_cond_signal: ['int', 1, 1], pthread_cond_broadcast: ['int', 1, 1], pthread_cond_destroy: ['int', 1, 1],
    sem_init: ['int', 3, 3], sem_wait: ['int', 1, 1], sem_trywait: ['int', 1, 1], sem_post: ['int', 1, 1], sem_getvalue: ['int', 2, 2], sem_destroy: ['int', 1, 1],
    sched_yield: ['int', 0, 0],
  };
  // calls that touch nothing but the caller's own state: a model checker need not branch on them
  K.LOCAL = new Set(['getpid', 'sleep', 'sigemptyset', 'sigfillset', 'sigaddset', 'sigdelset', 'sigismember', 'isatty', 'setvbuf', 'pthread_self', 'getpgrp', 'sched_yield']);
  // stdio calls name what they touch themselves (their own buffer, or a descriptor when they write)
  K.STDIO = new Set(['printf', 'fprintf', 'dprintf', 'putchar', 'puts', 'fputs', 'fflush', 'getchar', 'fgets', 'perror', 'setbuf']);

  const cache = new Map();
  K.compile = function (src) {
    if (cache.has(src)) return cache.get(src);
    const prog = S.CLang.compile(src);
    if (cache.size > 200) cache.clear();
    cache.set(src, prog);
    return prog;
  };
  K.fnName = (prog, v) => { const f = S.CLang.funcAt(prog, v); return f && f.body ? f.name : null; };
  K.fnAddr = (prog, name) => S.CLang.funcAddr(prog, name);
  K.pushCall = (prog, ctx, fn, args, ret) => S.CLang.pushCall(prog, ctx, fn, args, ret, { discard: true });
  K.image = (prog, argv) => S.CLang.state(prog, { argv: argv && argv.length ? argv : ['a.out'] });
})(globalThis.Proses = globalThis.Proses || {});
