// The hardware boundary (os-*.js): traps worked by hand (the kernel-stack arithmetic, where each kind resumes),
// privileged instructions in user mode, the system-call path with its errno against an independent model of the
// descriptor table, limited direct execution against an independent round-robin replay, the context switch,
// the boot order, and OS structures against an independent crossing count on random structures.
import { load, harness, rng } from './load.mjs';

const t = harness('os');
const S = load(['core']);
const O = S.Os;
const clean = (steps, what) => { for (const s of steps) if (typeof s.say !== 'string' || !s.say || /undefined|NaN/.test(s.say)) { t.ok(false, what + ': bad say ' + JSON.stringify(s.say)); return; } t.ok(true, what); };

// ---- one trap by hand ----
{
  const r = O.trap({ cause: 'syscall', cpu: { pc: 0x1000, sp: 0x7ff0, regs: { r0: 39, r1: 5 } }, result: 4242, kstack: 0x9000 });
  t.eq(r.steps.map((s) => s.kind), ['raise', 'mode', 'stack', 'save', 'save', 'dispatch', 'handle', 'restore', 'return'], 'the trap sequence');
  t.eq(r.steps[3].sp, 0x9000 - 12, 'hardware pushes sp, flags and pc: 12 bytes');
  t.eq(r.steps[4].sp, 0x9000 - 20, 'then the two general registers');
  t.eq(r.steps[4].kstack.map((x) => x.name), ['user sp', 'flags', 'pc', 'r0', 'r1'], 'the trap frame, bottom up');
  t.eq(r.steps[3].kstack[2].value, 0x1001, 'a trap saves the next pc');
  t.eq([r.cpu.mode, r.cpu.pc, r.cpu.sp, r.cpu.regs.r0, r.cpu.regs.r1], ['user', 0x1001, 0x7ff0, 4242, 5], 'back in user mode with the result in r0');
  t.eq(r.steps[5].handler, 'syscall_entry', 'vector 128 dispatches to the system-call entry');
  t.ok(r.steps.slice(1, -1).every((s) => s.mode === 'kernel'), 'kernel mode from the mode switch until the return');
  clean(r.steps, 'trap narration');
}
{
  const i = O.trap({ cause: 'interrupt', vector: 33, cpu: { pc: 0x2000 } });
  t.eq([i.outcome, i.resumePc, i.steps[1].IF, i.cpu.IF], ['resume', 0x2001, false, true], 'an interrupt turns IF off in the kernel and resumes after the instruction');
  const pf = O.trap({ cause: 'exception', vector: 14, cpu: { pc: 0x3000 } });
  t.eq([pf.outcome, pf.resumePc], ['retry', 0x3000], 'a page fault re-runs the same instruction');
  const gp = O.trap({ cause: 'exception', vector: 13, cpu: { pc: 0x3000 } });
  t.eq([gp.outcome, gp.resumePc, gp.steps[gp.steps.length - 1].kind], ['kill', null, 'kill'], 'a protection fault kills the process');
  const none = O.trap({ cause: 'interrupt', vector: 77 });
  t.eq(none.outcome, 'kill', 'an empty trap-table entry is fatal');
  const k = O.trap({ cause: 'interrupt', cpu: { mode: 'kernel', sp: 0x8800 } });
  t.eq([k.steps.some((s) => s.kind === 'stack'), k.cpu.mode, k.cpu.sp], [false, 'kernel', 0x8800], 'in kernel mode there is no stack switch');
  const tb = O.table([{ vector: 13, outcome: 'resume', handler: 'emulate' }, { vector: 200, name: 'custom', handler: 'h' }]);
  t.eq([tb.find((e) => e.vector === 13).handler, tb[tb.length - 1].vector], ['emulate', 200], 'a custom trap table');
}
// ---- running programs ----
{
  const r = O.run([{ op: 'load', args: ['r0', 5] }, { op: 'add' }, { op: 'cli' }, { op: 'add' }]);
  t.eq([r.killed && r.killed.op, r.killed && r.killed.vector, r.executed], ['cli', 13, 3], 'cli in user mode raises vector 13 and the process dies');
  const k = O.run([{ op: 'cli' }, { op: 'lcr3' }, { op: 'sti' }, { op: 'hlt' }], { mode: 'kernel' });
  t.eq([k.killed, k.traps.length, k.cpu.IF], [null, 0, true], 'kernel mode may run privileged instructions');
  const d = O.run([{ op: 'load', args: ['r0', 6] }, { op: 'div' }]);
  t.eq(d.killed && d.killed.vector, 0, 'division by zero raises vector 0');
  const s = O.run([{ op: 'syscall', result: 7 }, { op: 'add' }], { regs: { r0: 1, r1: 2 } });
  t.eq([s.traps.map((x) => x.cause), s.cpu.regs.r0], [['syscall'], 9], 'a system call returns 7 in r0, then add gives 9');
  const it = O.run([{ op: 'add' }, { op: 'add' }, { op: 'add' }], { interrupts: [{ at: 1, vector: 32 }, { at: 2, vector: 33 }] });
  t.eq(it.traps.map((x) => [x.at, x.vector]), [[1, 32], [2, 33]], 'interrupts arrive between instructions');
  const off = O.run([{ op: 'cli' }, { op: 'add' }, { op: 'sti' }, { op: 'add' }], { mode: 'kernel', interrupts: [{ at: 1, vector: 32 }] });
  t.eq(off.traps.map((x) => x.at), [3], 'with interrupts off the timer waits until sti');
  clean(off.steps, 'run narration');
  const bad = O.run([{ op: 'frobnicate' }]);
  t.eq(bad.killed && bad.killed.vector, 6, 'an unknown opcode raises vector 6');
}
// ---- the system-call path ----
{
  const r = O.syscall('read', [7, '', 10]);
  t.eq([r.ret, r.errno, r.raw, r.nr], [-1, 9, -9, 0], 'read on a closed descriptor: -1 and EBADF');
  t.eq(r.steps.map((s) => s.kind), ['wrapper', 'regs', 'trap', 'dispatch', 'check', 'handle', 'result', 'return', 'errno'], 'the path');
  t.eq([r.steps[1].regs.rax, r.steps[1].regs.rdi, r.steps[1].regs.rdx], [0, 7, 10], 'number in rax, arguments in rdi, rsi, rdx');
  t.eq(r.steps.map((s) => s.mode), ['user', 'user', 'kernel', 'kernel', 'kernel', 'kernel', 'kernel', 'user', 'user'], 'modes along the path');
  clean(r.steps, 'syscall narration');
  const k0 = O.kernelState();
  const o = O.syscall('open', ['/home/ana/notes.txt', 0], { kernel: k0 });
  t.eq(o.ret, 3, 'open returns the lowest free descriptor');
  t.eq(Object.keys(k0.fds).length, 3, 'the caller\'s kernel state is not changed');
  const rd = O.syscall('read', [3, '', 4], { kernel: o.kernel });
  t.eq([rd.ret, rd.data, rd.kernel.fds[3].offset], [4, 'buy ', 4], 'read copies 4 bytes and moves the offset');
  t.eq(O.syscall('open', ['/nope', 0]).errno, 2, 'ENOENT');
  t.eq(O.syscall('open', ['/etc/motd', 1]).errno, 13, 'EACCES on a read-only file');
  t.eq(O.syscall('open', ['/tmp/new', 64 | 1]).ret, 3, 'O_CREAT makes the file');
  t.eq(O.syscall(999, []).errno, 38, 'an unknown number gives ENOSYS');
  t.eq(O.syscall('getpid', []).ret, 4242, 'getpid');
  const w = O.syscall('write', [1, 'hi\n', 3]);
  t.eq([w.ret, w.kernel.tty], [3, 'hi\n'], 'write to the terminal');
  t.eq(O.syscall('write', [0, 'x', 1]).errno, 9, 'stdin is read-only: EBADF');
  t.eq(O.syscall('lseek', [3, -1, 0], { kernel: o.kernel }).errno, 22, 'a negative offset is EINVAL');
}
// ---- random call sequences against an independent descriptor model ----
{
  const r = rng(11);
  for (let trial = 0; trial < 40; trial++) {
    let k = O.kernelState({ maxFds: 6 });
    const fds = { 0: 'r', 1: 'w', 2: 'w' }, tty = new Set([0, 1, 2]), files = { '/etc/motd': 'welcome to the lab\n', '/home/ana/notes.txt': 'buy milk\n' }, off = {};
    let same = true;
    for (let i = 0; i < 25; i++) {
      const c = r();
      if (c < 0.35) {
        const path = ['/home/ana/notes.txt', '/etc/motd', '/x/missing'][Math.floor(r() * 3)];
        const res = O.syscall('open', [path, 0], { kernel: k }); k = res.kernel;
        let want;
        if (!(path in files)) want = -2; else { let f = 0; while (fds[f]) f++; if (f >= 6) want = -24; else { fds[f] = 'r'; tty.delete(f); off[f] = 0; want = f; } }
        if (res.raw !== want) same = false;
      } else if (c < 0.6) {
        const fd = Math.floor(r() * 7), res = O.syscall('close', [fd], { kernel: k }); k = res.kernel;
        const want = fds[fd] ? 0 : -9; delete fds[fd];
        if (res.raw !== want) same = false;
      } else {
        const fd = Math.floor(r() * 7), n = 1 + Math.floor(r() * 6), res = O.syscall('read', [fd, '', n], { kernel: k }); k = res.kernel;
        let want;
        if (!fds[fd]) want = -9; else if (fds[fd] === 'w') want = -9; else if (tty.has(fd)) want = 0;
        else { const path = k.fds[fd].path, text = files[path]; const got = Math.max(0, Math.min(n, text.length - off[fd])); off[fd] += got; want = got; }
        if (res.raw !== want) same = false;
        if (res.raw < 0 && (res.ret !== -1 || res.errno !== -res.raw)) same = false;
      }
    }
    t.ok(same, 'random system calls match an independent descriptor model, trial ' + trial);
  }
}
// ---- limited direct execution ----
{
  const r = O.lde({ procs: [{ name: 'A', work: 5 }, { name: 'B', work: 4, syscalls: [2] }], quantum: 3 });
  t.eq(r.segs.map((s) => [s.who, s.start, s.end]), [['A', 0, 3], ['B', 3, 6], ['A', 6, 8], ['B', 8, 9]], 'hand-worked: the timer every 3 ticks, B\'s system call does not stop it');
  t.eq([r.finish, r.switches, r.timerInterrupts, r.syscalls], [{ A: 8, B: 9 }, 3, 2, 3], 'finish times and counts');
  clean(r.steps, 'lde narration');
  const same = O.lde({ procs: [{ name: 'A', work: 3 }, { name: 'B', work: 4 }, { name: 'C', work: 4 }], quantum: 3 });
  t.eq(same.segs.map((s) => [s.who, s.start, s.end]), [['A', 0, 3], ['B', 3, 6], ['C', 6, 9], ['B', 9, 10], ['C', 10, 11]], 'a timer tick due as A exits is used up, so B is cut at 6, not 4');
  t.eq(same.steps.filter((s) => s.kind === 'timer').map((s) => s.t), [6, 9], 'timer interrupts at 6 and 9 only');
  const coop = O.lde({ timer: false, procs: [{ name: 'A', work: 4, syscalls: [1] }, { name: 'B', work: 2 }] });
  t.eq(coop.segs.map((s) => [s.who, s.start, s.end]), [['A', 0, 1], ['B', 1, 3], ['A', 3, 6]], 'cooperative: A yields at its system call');
  const stuck = O.lde({ timer: false, procs: [{ name: 'L', loop: true }, { name: 'B', work: 2 }], maxTicks: 12 });
  t.eq([stuck.stuck, stuck.segs.length, stuck.finish.B], ['L', 1, undefined], 'with no timer a looping process keeps the CPU for ever');
  const fixed = O.lde({ timer: true, procs: [{ name: 'L', loop: true }, { name: 'B', work: 2 }], quantum: 2, maxTicks: 12 });
  t.eq([fixed.stuck, fixed.finish.B], [null, 4], 'the timer takes the CPU back and B finishes');
  const cost = O.lde({ procs: [{ name: 'A', work: 3 }, { name: 'B', work: 3 }], quantum: 2, switchCost: 1 });
  t.ok(cost.segs.filter((s) => s.who === 'OS').length === cost.switches, 'one kernel segment per switch when switches cost time');
}
// an independent replay of round robin with a wall-clock timer and no switch cost
{
  const r = rng(5);
  for (let trial = 0; trial < 60; trial++) {
    const n = 1 + Math.floor(r() * 4), q = 1 + Math.floor(r() * 4);
    const procs = Array.from({ length: n }, (_, i) => ({ name: 'P' + i, work: 1 + Math.floor(r() * 7) }));
    const got = O.lde({ procs, quantum: q, maxTicks: 200 });
    // replay
    const left = Object.fromEntries(procs.map((p) => [p.name, p.work])), queue = procs.map((p) => p.name), fin = {};
    let tt = 0, cur = queue.shift(), next = q;
    while (cur) {
      tt++; left[cur]--;
      if (!left[cur]) { fin[cur] = tt; while (next <= tt) next += q; cur = queue.shift(); continue; }
      if (tt >= next) { while (next <= tt) next += q; queue.push(cur); cur = queue.shift(); }
    }
    t.eq(got.finish, fin, 'round robin under the timer matches a replay, trial ' + trial);
    t.ok(got.steps.filter((s) => s.kind === 'timer').every((s) => s.t % q === 0), 'every preemption lands on a multiple of the quantum ' + q + ', trial ' + trial);
    const user = got.segs.filter((s) => s.mode === 'user').reduce((a, s) => a + s.end - s.start, 0);
    t.eq(user, procs.reduce((a, p) => a + p.work, 0), 'every tick of work runs in user mode, trial ' + trial);
  }
}
// ---- the context switch ----
{
  const r = O.contextSwitch({});
  const last = r.steps[r.steps.length - 2];
  t.eq([last.cpu.mode, last.cpu.pc, last.cpu.sp, last.cpu.regs.a0, last.cpu.regs.a1], ['user', 0x2210, 0x6fc0, 3, 99], 'B\'s user registers are restored');
  const save = r.steps.find((s) => s.kind === 'save');
  t.eq(save.procs.A.context.sp, 0x9000 - 16, 'A\'s kernel SP is saved below its 4-register trap frame');
  t.eq(save.procs.A.kstack.map((x) => x.value), [0x1040, 0x7f80, 7, 42], 'A\'s trap frame holds its user registers');
  t.eq(r.cost, { saved: 8, restored: 8, pageTable: true, tlbFlush: true }, 'cost of a process switch');
  t.eq(O.contextSwitch({ sameSpace: true }).cost.pageTable, false, 'threads of one process keep the page table');
  t.eq(O.contextSwitch({ asid: true }).cost.tlbFlush, false, 'tagged TLB entries survive the switch');
  t.eq(r.steps.filter((s) => s.cpu.mode === 'user').map((s) => s.kind), ['user', 'return', 'cost'], 'user mode only at the start and from the return on');
  clean(r.steps, 'context-switch narration');
}
// ---- boot ----
{
  const b = O.boot({});
  const stages = b.steps.map((s) => s.stage);
  t.eq(Array.from(new Set(stages)), ['firmware', 'loader', 'kernel', 'init'], 'stages in order');
  const firstUser = b.steps.findIndex((s) => s.mode === 'user');
  t.ok(b.steps[firstUser - 1].kind === 'init', 'the first user-mode step comes right after pid 1 is made');
  t.ok(b.steps.findIndex((s) => s.kind === 'traps') < b.steps.findIndex((s) => s.kind === 'timer'), 'the trap table is set before the timer starts');
  const last = b.steps[b.steps.length - 1];
  t.eq(last.pids.find((p) => p.pid === 1), { pid: 1, name: 'init', ppid: 0 }, 'init is pid 1');
  t.ok(last.pids.filter((p) => p.ppid === 1).length === 4, 'init starts every service');
  t.ok(b.steps.some((s) => s.memory.some((m) => m.at === '0x7C00')), 'BIOS loads the boot sector at 0x7C00');
  t.eq(O.boot({ bootOrder: ['usb', 'net'], devices: ['disk'] }).ok, false, 'no bootable device');
  clean(O.boot({ firmware: 'uefi', ramdisk: false }).steps, 'boot narration');
}
// ---- OS structures ----
{
  const c = Object.fromEntries(O.compareStructures().map((r) => [r.id, [r.modeSwitches, r.messages, r.spaceSwitches]]));
  t.eq(c, { monolithic: [2, 0, 0], layered: [2, 0, 0], microkernel: [8, 4, 4], modules: [2, 0, 0], hybrid: [4, 2, 2] }, 'hand-worked counts for one read');
  t.eq(O.request('layered').calls, 10, 'layered: five layer calls down and five up');
  t.eq(O.request('modules').hops.filter((h) => h.how === 'indirect call').length, 6, 'modules: every call into or out of a module goes through its table');
  clean(O.request('microkernel').steps, 'structure narration');
  const r = rng(9);
  for (let trial = 0; trial < 80; trial++) {
    const n = 2 + Math.floor(r() * 5);
    const parts = [{ name: 'app', space: 'user' }].concat(Array.from({ length: n - 1 }, (_, i) => ({ name: 'c' + i, space: r() < 0.5 ? 'user' : 'kernel' })));
    const got = O.request({ name: 'random', blurb: 'x', parts });
    let ms = 0, msg = 0;
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i].space, b = parts[i + 1].space;
      if (a === 'user' && b === 'user') { ms += 4; msg += 2; } else if (a !== b) { ms += 2; if (a === 'kernel') msg += 2; }
    }
    t.eq([got.modeSwitches, got.messages], [ms, msg], 'crossings match an independent count, trial ' + trial);
  }
}
// ---- narration slips: every say string from seeded runs of every function ----
const sayLint = (() => {
  const SING = ['item', 'message', 'byte', 'operation', 'slot', 'spin', 'tick', 'call', 'entry', 'request', 'exit', 'copy', 'trap', 'read', 'failure', 'guess', 'instruction', 'register', 'page', 'run', 'notification', 'interrupt', 'domain', 'right', 'finding', 'level', 'miss', 'fault', 'thing', 'unit', 'cycle', 'digit', 'character', 'reply', 'try', 'process', 'switch', 'triple', 'list', 'key', 'lock', 'capability', 'service', 'client', 'second', 'write', 'transition', 'event', 'round', 'attempt'];
  const plural = (w) => (/(ss|sh|ch|x)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
  const PL = new Map(SING.map((w) => [plural(w), w]));
  const vowelOk = /^(use|usa|uni|uin|one|once|eu|ur)/i, consOk = /^(hour|honest|honou)/i;
  // words that follow a name such as process A, not the article a
  const FN = new Set(['is', 'as', 'at', 'in', 'on', 'of', 'or', 'and', 'are', 'also', 'again', 'until', 'up', 'if', 'its', 'it', 'opens', 'owns', 'ends', 'exits', 'enters', 'uses', 'accepts', 'asks', 'unlinks', 'ran', 'eats', 'issues', 'even', 'once', 'only']);
  const collect = (x, out, seen) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return out;
    seen.add(x);
    if (typeof x.say === 'string') out.push(x.say);
    else if ('say' in x && x.say !== undefined) out.push('[say is ' + typeof x.say + ']');
    for (const v of Object.values(x)) if (v && typeof v === 'object') collect(v, out, seen);
    return out;
  };
  const slips = (s) => {
    const bad = [];
    if (/undefined|NaN|\bnull\b|\[object|Infinity/.test(s)) bad.push('undefined/NaN/null');
    if (!s.trim()) bad.push('empty');
    for (const m of s.matchAll(/(?<![\w.−-])1 ([a-z]+)\b/g)) if (PL.has(m[1])) bad.push('"1 ' + m[1] + '"');
    for (const m of s.matchAll(/(?<![\w.])(\d+|zero|two|three|four) ([a-z]+)(?=[.,;:)]|$| (?:of|and|in|for|so|to|but|with|from|after|before|each|per)\b)/g)) if (m[1] !== '1' && SING.includes(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/(?<![\w/'])(a|A) ([A-Za-z]\w*)/g)) if (!FN.has(m[2]) && /^[aeiou]/i.test(m[2]) && !vowelOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) ([A-Za-z]\w*)/g)) if (!/^[aeiou]/i.test(m[2]) && !consOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2]) && !/^[A-Z]$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(a|A) (8|11|18|80\d*|8\d)\b/g)) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) (\d+)/g)) if (!/^(8|11|18|8\d*)$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b([A-Za-z]+) \1\b/gi)) if (!/^[0-9a-f]{2}$/i.test(m[1])) bad.push('doubled "' + m[0] + '"');
    return bad;
  };
  return (t, results, what) => {
    const says = [];
    for (const r of results) collect(r, says, new Set());
    const found = [];
    for (const s of new Set(says)) for (const b of slips(s)) found.push(b + ' in: ' + s);
    t.ok(says.length > 0, what + ': some narration to scan');
    t.ok(!found.length, what + ': ' + found.length + ' slips, e.g.\n  ' + Array.from(new Set(found.map((f) => f.split(' in: ')[0]))).slice(0, 40).map((k) => found.find((f) => f.startsWith(k))).join('\n  '));
    return found;
  };
})();
{
  const r = rng(101), out = [];
  for (let seed = 1; seed <= 40; seed++) {
    for (const cause of ['interrupt', 'exception', 'syscall']) for (const v of [0, 6, 13, 14, 32, 33, 46, 128, 99]) out.push(O.trap({ cause, vector: v, cpu: { mode: r() < 0.2 ? 'kernel' : 'user', pc: Math.floor(r() * 4096), regs: { r0: seed, r1: 2 } }, result: seed - 20 }));
    const ops = Object.keys(O.INSTR).concat(['bogus']);
    out.push(O.run(Array.from({ length: 2 + Math.floor(r() * 8) }, () => ({ op: ops[Math.floor(r() * ops.length)], args: ['r0', 'r1'], result: seed })), { mode: r() < 0.5 ? 'user' : 'kernel', regs: { r1: Math.floor(r() * 2) }, interrupts: [{ at: Math.floor(r() * 4), vector: 32 }] }));
    for (const c of ['read', 'write', 'open', 'close', 'lseek', 'getpid', 999, 70]) out.push(O.syscall(c, [Math.floor(r() * 5), r() < 0.5 ? '/etc/motd' : 'x', Math.floor(r() * 9), 0]));
    out.push(O.syscall('open', ['/home/ana/notes.txt', 0]), O.syscall('read', [3, '', 1], { kernel: O.syscall('open', ['/home/ana/notes.txt', 0]).kernel }));
    const procs = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => ({ name: 'P' + i, work: 1 + Math.floor(r() * 6), syscalls: [1 + Math.floor(r() * 3)], loop: r() < 0.1 }));
    out.push(O.lde({ procs, quantum: 1 + Math.floor(r() * 4), timer: r() < 0.7, switchCost: Math.floor(r() * 2), maxTicks: 30 }));
    out.push(O.contextSwitch({ sameSpace: r() < 0.3, asid: r() < 0.3 }));
    out.push(O.boot({ firmware: r() < 0.5 ? 'bios' : 'uefi', ramdisk: r() < 0.5, bootOrder: r() < 0.2 ? ['net'] : ['usb', 'disk'], services: ['a', 'b'].slice(0, Math.floor(r() * 3)) }));
    for (const k of Object.keys(O.STRUCTURES)) out.push(O.request(k, { op: 'write' }));
  }
  sayLint(t, out, 'os narration slips');
}
t.done();
