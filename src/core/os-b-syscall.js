// The hardware boundary, part 2: the system-call path. A C library wrapper puts the call's number and arguments in
// registers and runs the syscall instruction; the kernel checks the number against its dispatch table, runs the
// handler on a small kernel state, and puts the result (or a negative error code) back in the result register;
// the wrapper turns a negative result into -1 with errno set.
//   S.Os.SYSCALLS                   [{nr, name, args: [names], handler}] the dispatch table (x86-64 Linux numbers)
//   S.Os.ERRNO                      {name: {code, text}}  and  S.Os.errnoName(code) -> 'EBADF'
//   S.Os.REGS                       the argument registers, in order: rdi, rsi, rdx, r10, r8, r9 (number in rax)
//   S.Os.kernelState(o?)            a toy kernel {pid, files: {path: text}, fds: {fd: {path, offset, flags}}}
//   S.Os.syscall(call, args, {kernel, nr?})
//       call: a name ('read', 'write', 'open', 'close', 'getpid', 'lseek') or a number; args: the C arguments
//       (a string stands for a buffer's contents or a path).
//       -> {ret (what the C caller sees), errno (0 when it worked), raw (rax after the kernel), nr, steps,
//           kernel (the state after; the input is not changed)}
//       steps: wrapper, regs, trap, dispatch, check, handle, result, return, errno: each {kind, say, regs, mode}
(function (S) {
  'use strict';
  const O = (S.Os = S.Os || {});

  O.REGS = ['rdi', 'rsi', 'rdx', 'r10', 'r8', 'r9'];
  O.ERRNO = {
    EPERM: { code: 1, text: 'operation not permitted' },
    ENOENT: { code: 2, text: 'no such file or directory' },
    ESRCH: { code: 3, text: 'no such process' },
    EBADF: { code: 9, text: 'bad file descriptor' },
    EACCES: { code: 13, text: 'permission denied' },
    EFAULT: { code: 14, text: 'bad address' },
    EEXIST: { code: 17, text: 'file exists' },
    EINVAL: { code: 22, text: 'invalid argument' },
    EMFILE: { code: 24, text: 'too many open files' },
    ENOSYS: { code: 38, text: 'function not implemented' },
  };
  O.errnoName = (code) => Object.keys(O.ERRNO).find((k) => O.ERRNO[k].code === code) || 'E' + code;

  const O_RDONLY = 0, O_WRONLY = 1, O_RDWR = 2, O_CREAT = 64;
  O.O_FLAGS = { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT };
  const err = (name) => -O.ERRNO[name].code;

  O.kernelState = (o) => Object.assign({
    pid: 4242, maxFds: 8,
    files: { '/etc/motd': 'welcome to the lab\n', '/home/ana/notes.txt': 'buy milk\n' },
    fds: { 0: { path: '/dev/tty', offset: 0, flags: O_RDONLY }, 1: { path: '/dev/tty', offset: 0, flags: O_WRONLY }, 2: { path: '/dev/tty', offset: 0, flags: O_WRONLY } },
    readonly: ['/etc/motd'], tty: '',
  }, o || {});
  const copyK = (k) => ({ pid: k.pid, maxFds: k.maxFds, files: Object.assign({}, k.files), fds: Object.fromEntries(Object.entries(k.fds).map(([f, d]) => [f, Object.assign({}, d)])), readonly: (k.readonly || []).slice(), tty: k.tty || '' });

  // handlers get (kernel, a0..a5) and return {v, why}: v >= 0 is a result, a negative v an error code
  const H = {
    read(k, fd, _buf, n) {
      const d = k.fds[fd];
      if (!d) return { v: err('EBADF'), why: 'descriptor ' + fd + ' is not open' };
      if (d.flags === O_WRONLY) return { v: err('EBADF'), why: 'descriptor ' + fd + ' was opened for writing only' };
      const text = d.path === '/dev/tty' ? '' : k.files[d.path] || '';
      const got = text.slice(d.offset, d.offset + n);
      d.offset += got.length;
      return { v: got.length, data: got, why: 'copied ' + got.length + ' byte' + (got.length === 1 ? '' : 's') + ' from ' + d.path + ' into the caller\'s buffer; the offset is now ' + d.offset };
    },
    write(k, fd, buf, n) {
      const d = k.fds[fd];
      if (!d) return { v: err('EBADF'), why: 'descriptor ' + fd + ' is not open' };
      if (d.flags === O_RDONLY) return { v: err('EBADF'), why: 'descriptor ' + fd + ' was opened for reading only' };
      const text = String(buf).slice(0, n === undefined ? undefined : n);
      if (d.path === '/dev/tty') k.tty += text;
      else { const f = k.files[d.path] || ''; k.files[d.path] = f.slice(0, d.offset) + text + f.slice(d.offset + text.length); }
      d.offset += text.length;
      return { v: text.length, why: 'copied ' + text.length + ' byte' + (text.length === 1 ? '' : 's') + ' from the caller\'s buffer to ' + d.path };
    },
    open(k, path, flags) {
      flags = flags || 0;
      if (typeof path !== 'string' || !path.startsWith('/')) return { v: err('EFAULT'), why: 'the path is not a valid address in the caller\'s memory' };
      const exists = Object.prototype.hasOwnProperty.call(k.files, path);
      if (!exists && !(flags & O_CREAT)) return { v: err('ENOENT'), why: path + ' does not exist and O_CREAT was not given' };
      const acc = flags & 3;
      if (acc !== O_RDONLY && k.readonly.includes(path)) return { v: err('EACCES'), why: path + ' may not be opened for writing by this user' };
      let fd = 0;
      while (k.fds[fd]) fd++;
      if (fd >= k.maxFds) return { v: err('EMFILE'), why: 'all ' + k.maxFds + ' descriptors are in use' };
      if (!exists) k.files[path] = '';
      k.fds[fd] = { path, offset: 0, flags: acc };
      return { v: fd, why: (exists ? '' : 'created ' + path + ', ') + 'found the lowest free descriptor, ' + fd + ', and pointed it at ' + path };
    },
    close(k, fd) {
      if (!k.fds[fd]) return { v: err('EBADF'), why: 'descriptor ' + fd + ' is not open' };
      delete k.fds[fd];
      return { v: 0, why: 'freed descriptor ' + fd };
    },
    lseek(k, fd, off, whence) {
      const d = k.fds[fd];
      if (!d) return { v: err('EBADF'), why: 'descriptor ' + fd + ' is not open' };
      const size = (k.files[d.path] || '').length, base = whence === 2 ? size : whence === 1 ? d.offset : 0, to = base + (off || 0);
      if (to < 0) return { v: err('EINVAL'), why: 'the new offset ' + to + ' would be negative' };
      d.offset = to;
      return { v: to, why: 'set the offset of descriptor ' + fd + ' to ' + to };
    },
    getpid(k) { return { v: k.pid, why: 'read the pid ' + k.pid + ' from the current process\'s control block' }; },
  };
  O.SYSCALLS = [
    { nr: 0, name: 'read', args: ['fd', 'buf', 'count'] },
    { nr: 1, name: 'write', args: ['fd', 'buf', 'count'] },
    { nr: 2, name: 'open', args: ['path', 'flags'] },
    { nr: 3, name: 'close', args: ['fd'] },
    { nr: 8, name: 'lseek', args: ['fd', 'offset', 'whence'] },
    { nr: 39, name: 'getpid', args: [] },
  ].map((e) => Object.assign(e, { handler: 'sys_' + e.name }));
  O.TABLE_SIZE = 64;

  const show = (v) => (typeof v === 'string' ? (v.startsWith('/') ? '"' + v + '"' : 'buffer') : String(v));

  O.syscall = function (call, args, o) {
    o = o || {};
    args = args || [];
    const k = copyK(o.kernel || O.kernelState()), steps = [];
    const known = typeof call === 'number' ? O.SYSCALLS.find((e) => e.nr === call) : O.SYSCALLS.find((e) => e.name === call);
    const nr = typeof call === 'number' ? call : o.nr !== undefined ? o.nr : known ? known.nr : 999;
    const name = known ? known.name : typeof call === 'string' ? call : 'syscall';
    const regs = { rax: nr };
    O.REGS.forEach((r, i) => { if (i < args.length) regs[r] = typeof args[i] === 'string' ? 0x7ffd1000 + i * 0x100 : args[i]; });
    let mode = 'user';
    const add = (kind, say, data) => steps.push(Object.assign({ kind, say, regs: Object.assign({}, regs), mode }, data || {}));
    add('wrapper', 'The program calls the C library\'s ' + name + '(' + args.map(show).join(', ') + '), an ordinary function in user mode.');
    const placed = args.map((a, i) => O.REGS[i] + ' = ' + (typeof a === 'string' ? 'the address of the ' + show(a) : a));
    add('regs', 'The wrapper puts the call number ' + nr + ' in rax' + (placed.length ? ' and the arguments in registers: ' + O.list(placed) : ' (this call has no arguments)') + '.');
    mode = 'kernel';
    add('trap', 'The syscall instruction switches to kernel mode and the kernel stack, saving the user PC and flags: a trap through the system-call entry.');
    const entry = O.SYSCALLS.find((e) => e.nr === nr);
    let res;
    if (nr < 0 || nr >= O.TABLE_SIZE || !entry) {
      add('dispatch', 'The kernel checks rax = ' + nr + ' against its table of ' + O.TABLE_SIZE + ' entries: ' + (nr >= O.TABLE_SIZE || nr < 0 ? 'it is out of range' : 'that slot has no handler') + '.', { nr, handler: null });
      res = { v: err('ENOSYS'), why: 'there is no system call ' + nr };
    } else {
      add('dispatch', 'The kernel checks that rax = ' + nr + ' is below ' + O.TABLE_SIZE + ' and calls sys_call_table[' + nr + '], which is ' + entry.handler + '.', { nr, handler: entry.handler });
      if (entry.args.length) add('check', entry.handler + ' reads its arguments from the saved registers (' + entry.args.map((a, i) => a + ' from ' + O.REGS[i]).join(', ') + ') and checks every one before trusting it.');
      res = H[entry.name].apply(null, [k].concat(args));
    }
    regs.rax = res.v;
    add('handle', res.v < 0 ? 'The handler fails: ' + res.why + ', so it returns −' + O.errnoName(-res.v) + ' (' + res.v + ').' : 'The handler ' + res.why + ', and returns ' + res.v + '.', { result: res.v, data: res.data });
    add('result', 'The kernel stores ' + res.v + ' in the saved rax, the register the wrapper will read.');
    mode = 'user';
    add('return', 'Return-from-trap restores the user registers and drops back to user mode just after the syscall instruction, with rax = ' + res.v + '.');
    let ret = res.v, errno = 0;
    if (res.v < 0 && res.v >= -4095) {
      errno = -res.v; ret = -1;
      add('errno', 'rax = ' + res.v + ' is in the error range −4095..−1, so the wrapper sets errno = ' + errno + ' (' + O.errnoName(errno) + ', "' + (O.ERRNO[O.errnoName(errno)] || { text: '?' }).text + '") and returns −1.', { errno, ret });
    } else add('errno', 'rax = ' + res.v + ' is not an error, so the wrapper returns it unchanged and leaves errno alone.', { errno: 0, ret });
    return { ret, errno, raw: res.v, nr, steps, kernel: k, data: res.data };
  };
})(globalThis.Proses = globalThis.Proses || {});
