// Part 1, the system-call path: a C library call puts the call's number and arguments in registers and runs the
// syscall instruction; the kernel checks the number against its dispatch table, runs the handler on its own state,
// and leaves the result in rax; the wrapper turns a negative result into -1 with errno set. The layers are drawn
// top to bottom (user above the line, kernel below), with a marker following the call down and back up, the
// registers, the dispatch table and the process's descriptor table. Every value comes from S.Os.syscall.
(function (S) {
  'use strict';
  const H = S.PX;
  const O = () => S.Os;
  const FL = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64 };

  /** 'read(3, buf, 4)' -> {call, args} or an error sentence */
  function parse(text) {
    if (String(text).trim().length > 40) return 'The call: at most 40 characters, so it fits on its layer';
    const m = /^\s*([a-z_]\w*|\d+)\s*\((.*)\)\s*;?\s*$/i.exec(String(text));
    if (!m) return 'The call: write it as name(arguments), like read(3, buf, 4)';
    const call = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1];
    if (typeof call === 'number' && call > 9999) return 'The call: a number up to 9999';
    const args = [];
    const re = /\s*("([^"]*)"|[^,]+)\s*(,|$)/g;
    const body = m[2].trim();
    if (body) {
      let k;
      while ((k = re.exec(body)) && k[0]) {
        const a = k[1].trim();
        if (k[2] !== undefined) args.push(k[2].replace(/\\n/g, '\n'));
        else if (/^-?\d+$/.test(a)) args.push(Number(a));
        else if (/^O_\w+(\s*\|\s*O_\w+)*$/.test(a)) { let v = 0; for (const f of a.split('|').map((x) => x.trim())) { if (!(f in FL)) return 'The call: ' + f + ' is not one of ' + Object.keys(FL).join(', '); v |= FL[f]; } args.push(v); }
        else if (a === 'buf') args.push('buf');
        else return 'The call: "' + a + '" is not a number, a "string", buf or an O_ flag';
        if (args.length > 6) return 'The call: at most 6 arguments (six registers carry them)';
      }
    }
    return { call, args };
  }
  const startKernel = () => O().kernelState({ fds: { 0: { path: '/dev/tty', offset: 0, flags: 0 }, 1: { path: '/dev/tty', offset: 0, flags: 1 }, 2: { path: '/dev/tty', offset: 0, flags: 1 }, 3: { path: '/home/ana/notes.txt', offset: 0, flags: 0 } } });
  // where each step happens: the layer the marker sits on
  const AT = { wrapper: 0, regs: 1, trap: 2, dispatch: 3, check: 4, handle: 4, result: 2, return: 1, errno: 0 };
  const flagName = (f) => ['read', 'write', 'read/write'][f & 3] || String(f);

  S.topic({
    id: 'p01-syscall', family: 'p01-syscall', order: 10, title: 'The system-call path',
    blurb: 'read, write and open look like ordinary functions, and the part in the C library is one. It puts the call\'s number in rax and the arguments in the next registers, then runs the syscall instruction. Now the kernel runs: it looks the number up in its table, checks every argument, does the work, and leaves the result in rax. Back in user mode, the wrapper turns a negative result into −1 and puts the error\'s number in errno.',
    inputs: [
      { id: 'call', kind: 'text', label: 'The call (fd 3 is open on /home/ana/notes.txt)', def: 'read(3, buf, 4)', check: (v) => { const r = parse(v); return typeof r === 'string' ? r : null; } },
    ],
    presets: [
      { label: 'read 4 bytes from fd 3', values: { call: 'read(3, buf, 4)' } },
      { label: 'getpid: no arguments', values: { call: 'getpid()' } },
      { label: 'write to the terminal', values: { call: 'write(1, "hi there\\n", 9)' } },
      { label: 'open a file for reading', values: { call: 'open("/etc/motd", O_RDONLY)' } },
      { label: 'open a file that is not there: ENOENT', values: { call: 'open("/home/ana/todo.txt", O_RDONLY)' } },
      { label: 'read from a closed descriptor: EBADF', values: { call: 'read(7, buf, 4)' } },
      { label: 'write to a read-only file: EACCES', values: { call: 'open("/etc/motd", O_WRONLY)' } },
      { label: 'a call number with no handler: ENOSYS', values: { call: '200()' } },
      { label: 'seek past the end, then where?', values: { call: 'lseek(3, 2, 2)' } },
    ],
    counters: [{ id: 'switches', label: 'mode switches' }],
    run(inp) {
      const p = parse(inp.call), k0 = startKernel();
      const r = O().syscall(p.call, p.args, { kernel: k0 });
      const F = new S.Frames(['switches']);
      const name = typeof p.call === 'string' ? p.call : 'syscall';
      const entry = O().SYSCALLS.find((e) => e.nr === r.nr);
      const layers = [
        { t: 'main(): ' + (typeof p.call === 'string' ? inp.call.trim().replace(/;$/, '') : 'syscall(' + p.call + ')'), cls: 'user' },
        { t: 'C library: the ' + name + '() wrapper', cls: 'user' },
        { t: 'kernel: the system-call entry', cls: 'kern' },
        { t: 'sys_call_table[' + r.nr + ']', cls: 'kern' },
        { t: entry ? entry.handler + '()' : 'no handler: ENOSYS', cls: 'kern' },
      ];
      const LX = 190, LW = 380, ly = (i) => 66 + i * 64 + (i >= 2 ? 34 : 0);
      const base = [H.title('lt', 0, 14, 'the path of one call')];
      base.push({ key: 'ur', kind: 'region', x: 0, y: 24, w: 480, h: ly(1) + 34 - 24, rx: 10, text: '', cls: 'uspace', audit: 'group', layer: 'back' });
      base.push({ key: 'kr', kind: 'region', x: 0, y: ly(2) - 44, w: 480, h: ly(4) + 34 - ly(2) + 44, rx: 10, text: '', cls: 'kspace', audit: 'group', layer: 'back' });
      base.push(H.text('ul', 12, 42, 'user mode', 'userlbl', 13), H.text('kl', 12, ly(2) - 26, 'kernel mode', 'boundary', 13));
      base.push({ key: 'bd', kind: 'line', x1: 0, y1: ly(2) - 50, x2: 480, y2: ly(2) - 50, cls: 'boundary', audit: 'ignore' });
      const RX = 520;
      let switches = 0, prevRegs = {}, kNow = k0;
      r.steps.forEach((s, i) => {
        if (s.kind === 'trap' || s.kind === 'return') switches++;
        F.set('switches', switches);
        if (s.kind === 'handle') kNow = r.kernel;
        const items = base.slice(), at = AT[s.kind] === undefined ? 0 : AT[s.kind];
        layers.forEach((L, k) => items.push({ key: 'ly' + k, kind: 'state', x: 240, y: ly(k), w: LW, h: 40, rx: 8, text: L.t, cls: 'layer ' + L.cls + (k === at ? ' act' : ''), size: 14 }));
        for (let k = 0; k + 1 < layers.length; k++) {
          const down = ['wrapper', 'regs', 'trap', 'dispatch', 'check'].includes(s.kind) || (s.kind === 'handle' && false);
          const lit = down ? k < at : k >= at && ['handle', 'result', 'return', 'errno'].includes(s.kind);
          items.push({ key: 'ar' + k, kind: 'line', x1: 240, y1: ly(k) + 20, x2: 240, y2: ly(k + 1) - 20, cls: lit ? 'act' : 'faint', audit: 'ignore', layer: 'back' });
        }
        items.push({ key: 'tok', kind: 'token', x: 466, y: ly(at), r: 10, text: '', cls: 'proc' });
        // the registers
        items.push(H.title('rt', RX, 14, 'registers'));
        const regNames = ['rax'].concat(O().REGS.slice(0, Math.max(3, p.args.length)));
        regNames.forEach((g, k) => {
          const v = s.regs[g], y = 30 + k * 34;
          const txt = v === undefined ? '—' : typeof p.args[k - 1] === 'string' && g !== 'rax' ? H.hex(v, 8) : String(v);
          items.push(H.cell('rn' + g, RX, y, 54, 30, g, 'regname', { size: 13 }), H.cell('rv' + g, RX + 58, y, 120, 30, txt, 'reg' + (v !== prevRegs[g] && i > 0 ? ' changed' : '') + (g === 'rax' && (s.kind === 'result' || s.kind === 'errno') ? ' act' : ''), { size: 13 }));
        });
        const ey = 30 + regNames.length * 34 + 8;
        const errTxt = s.kind === 'errno' ? (r.errno ? 'errno = ' + r.errno + ' (' + O().errnoName(r.errno) + ')' : 'errno unchanged') : 'errno';
        items.push(H.cell('err', RX, ey, 178, 30, errTxt, s.kind === 'errno' ? (r.errno ? 'vec bad' : 'vec good') : 'vec', { size: 13 }));
        // the dispatch table, around the number looked up
        const ty = ey + 58;
        items.push(H.title('dt', RX, ty, 'sys_call_table'));
        O().SYSCALLS.forEach((e, k) => {
          const y = ty + 12 + k * 30, lit = s.kind !== 'wrapper' && s.kind !== 'regs' && s.kind !== 'trap' && e.nr === r.nr;
          items.push(H.cell('tn' + k, RX, y, 44, 26, e.nr, 'vec mono' + (lit ? ' act' : ''), { size: 13 }), H.cell('th' + k, RX + 48, y, 130, 26, e.handler, 'vec mono' + (lit ? ' act' : ''), { size: 13 }));
        });
        // the descriptor table this process has (it changes when the handler runs)
        const fy = ly(4) + 62;
        items.push(H.title('ft', 0, fy, 'this process\'s descriptors'));
        const fds = Object.keys(kNow.fds).map(Number).sort((a, b) => a - b);
        fds.forEach((fd, k) => {
          const d = kNow.fds[fd], was = k0.fds[fd], changed = !was || was.offset !== d.offset;
          items.push(H.cell('fd' + fd, (k % 2) * 238, fy + 12 + Math.floor(k / 2) * 32, 230, 28, fd + ' → ' + d.path.split('/').pop() + ', at ' + d.offset + ', ' + flagName(d.flags), 'vec mono' + (changed ? ' act' : ''), { size: 13, align: 'left' }));
        });
        prevRegs = Object.assign({}, s.regs);
        F.add({ items, say: H.say(s.say), meta: { phase: s.kind, kind: s.kind, nr: r.nr, regs: s.regs, ret: r.ret, errno: r.errno, raw: r.raw, args: p.args, tableSize: O().TABLE_SIZE, fds: fds.map((f) => [f, kNow.fds[f].offset]), errRange: [-4095, -1] }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The calling convention', text: ['rax: the call\'s number', 'rdi, rsi, rdx, r10, r8, r9:', '  the arguments, in order', 'after the call, rax holds', '  a result (≥ 0)', '  or −errno (−4095 to −1)', 'the wrapper returns −1', '  and sets errno'].join('\n') }] };
      return { frames: F.list, def, result: { ret: r.ret, errno: r.errno, raw: r.raw, nr: r.nr, kernel: r.kernel } };
    },
    predict: [
      { at: (f) => f.meta.kind === 'check' || (f.meta.kind === 'dispatch' && !S.Os.SYSCALLS.some((e) => e.nr === f.meta.nr)), pick: 'option', ask: 'What will the C caller get back?', options: (fr) => { const m = fr[0].meta; const right = m.ret === -1 ? '−1, with errno set' : String(m.ret); return [...new Set([right, '−1, with errno set', '0'])]; }, answer: (fr) => (fr[0].meta.ret === -1 ? '−1, with errno set' : String(fr[0].meta.ret)), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'How does the kernel know which system call a program wants?', options: ['by the number in rax, looked up in its dispatch table', 'by the function\'s name', 'by reading the program\'s source', 'by the address of the wrapper'], answer: 0, why: 'Names live in the C library; the kernel only sees a number and registers.' },
      { q: 'Why does the handler check every argument before using it?', options: ['the program can put anything in the registers, including a bad descriptor or an address it does not own', 'to make the call slower', 'the compiler requires it', 'it does not need to'], answer: 0, why: 'The kernel must never trust user input; a bad pointer must give EFAULT, not crash the kernel.' },
      { q: 'open fails with ENOENT. What does the C caller see?', options: ['open returns −1 and errno is 2 (ENOENT)', 'open returns −2', 'the program is ended', 'open returns 0'], answer: 0, why: 'The kernel returns −2 in rax; the wrapper turns it into −1 and errno = 2.' },
      { q: 'How many mode switches does one system call cost?', options: ['two: into the kernel and back out', 'none', 'one', 'one per argument'], answer: 0, why: 'The syscall instruction enters kernel mode; return-from-trap leaves it.' },
      { q: 'A call number beyond the end of the table, such as 200, gives…', options: ['−1 with errno ENOSYS', 'a crash of the kernel', 'the last entry\'s handler', 'nothing at all'], answer: 0, why: 'The kernel checks the number against its table before indexing it.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
