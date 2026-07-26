// Virtual machines, part 1: trap-and-emulate, the instructions that break it, binary translation and hardware
// support, as models. The guest kernel thinks it runs in kernel mode; the virtual machine monitor (VMM) keeps a
// virtual CPU (its mode, interrupt flag, page-table base) and makes every sensitive instruction act on that.
//   S.Virt.INSTR                name -> {priv, sensitive, what}; S.Virt.ARCH: {classic, x86}: which instructions
//                               each architecture makes privileged (trap in user mode)
//   S.Virt.popekGoldberg(arch) -> {sensitive, privileged, violators, virtualisable, say}: trap-and-emulate works
//                               when every sensitive instruction is privileged.
//   S.Virt.run({program: [{op, arg}], technique: 'trap-emulate' | 'binary-translation' | 'hardware',
//               arch: 'classic' | 'x86', repeat: 1, ept: true})
//       -> {steps: [{kind, op, say, vcpu: {mode, IF, cr3}, real: {mode, IF}}], traps, exits, emulated, native,
//           translated, wrong: [{op, why}], cycles}
//       trap-emulate: the guest kernel runs in user mode; privileged ones trap and the VMM emulates them; a
//         sensitive but unprivileged one runs natively and does the wrong thing (popf drops the IF change, pushf
//         and smsw read the real flags and the real machine status word (CR0's low bits) instead of the guest's
//         virtual ones, sgdt the host's table). These are four of the sensitive but unprivileged instructions,
//         among some seventeen on real 32-bit x86.
//       binary-translation: before a block of guest kernel code first runs, the VMM rewrites every sensitive
//         instruction into a call to its emulation; the rewritten block is cached for later runs.
//       hardware: the guest runs in a guest mode with its own privilege levels; the CPU exits to the VMM only on
//         the instructions the VMM asked to see (I/O, hlt, and the page-table base unless nested paging, ept).
//   S.Virt.COST: the cycle costs the model charges (native 1, trap 500, exit 300, translated call 20, translate
//         50 per instruction)
(function (S) {
  'use strict';
  const V = (S.Virt = S.Virt || {});
  const H = (n) => '0x' + n.toString(16);
  V.plural = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');

  V.INSTR = {
    add: { sensitive: false, what: 'adds two registers' },
    load: { sensitive: false, what: 'reads memory' },
    store: { sensitive: false, what: 'writes memory' },
    cli: { sensitive: true, what: 'turns interrupts off' },
    sti: { sensitive: true, what: 'turns interrupts on' },
    popf: { sensitive: true, what: 'loads the flags register, including the interrupt flag, from the stack' },
    pushf: { sensitive: true, what: 'stores the flags register, including the interrupt flag, on the stack' },
    smsw: { sensitive: true, what: 'reads the machine status word, the low bits of control register CR0' },
    sgdt: { sensitive: true, what: 'reads the address of the descriptor table' },
    lcr3: { sensitive: true, what: 'loads the page-table base register' },
    out: { sensitive: true, what: 'writes a device register' },
    in: { sensitive: true, what: 'reads a device register' },
    hlt: { sensitive: true, what: 'halts until the next interrupt' },
  };
  V.ARCH = {
    classic: { name: 'a classically virtualisable machine', privileged: ['cli', 'sti', 'popf', 'pushf', 'smsw', 'sgdt', 'lcr3', 'out', 'in', 'hlt'] },
    x86: { name: '32-bit x86 before hardware support', privileged: ['cli', 'sti', 'lcr3', 'out', 'in', 'hlt'] },
  };
  V.COST = { native: 1, trap: 500, exit: 300, call: 20, translate: 50 };

  V.popekGoldberg = function (arch) {
    const A = V.ARCH[arch || 'classic'];
    const sensitive = Object.keys(V.INSTR).filter((k) => V.INSTR[k].sensitive);
    const violators = sensitive.filter((k) => !A.privileged.includes(k));
    const ok = !violators.length;
    return { sensitive, privileged: A.privileged.slice(), violators, virtualisable: ok, say: ok ? 'On ' + A.name + ' every sensitive instruction (' + sensitive.join(', ') + ') is privileged, so each one traps when the guest runs it in user mode: trap-and-emulate works.' : 'On ' + A.name + ' ' + violators.join(', ') + ' ' + (violators.length > 1 ? 'are' : 'is') + ' sensitive but not privileged' + (arch === 'x86' ? ' (four of them, among some seventeen on real 32-bit x86)' : '') + ': in user mode ' + (violators.length > 1 ? 'they run' : 'it runs') + ' without a trap and ' + (violators.length > 1 ? 'act' : 'acts') + ' on the real machine, so trap-and-emulate alone cannot work.' };
  };

  // what the VMM does to the virtual CPU when it emulates op
  const emulate = (op, arg, v) => {
    switch (op) {
      case 'cli': v.IF = false; return 'sets the virtual interrupt flag to 0';
      case 'sti': v.IF = true; return 'sets the virtual interrupt flag to 1';
      case 'popf': v.IF = !!arg; return 'loads the virtual flags, so the virtual interrupt flag becomes ' + (arg ? 1 : 0);
      case 'pushf': return 'pushes the virtual flags, with the virtual interrupt flag ' + (v.IF ? 1 : 0);
      case 'smsw': return 'returns the guest\'s virtual machine status word, the CR0 bits the guest itself set';
      case 'sgdt': return 'returns the guest\'s own descriptor-table address ' + H(v.gdt);
      case 'lcr3': v.cr3 = arg || 0x2000; return 'records the guest page-table base ' + H(v.cr3) + ' and switches the real one to the matching table it manages';
      case 'out': return 'passes the write to its model of the device';
      case 'in': return 'returns a value from its model of the device';
      case 'hlt': return 'runs another virtual machine until this one has an interrupt';
    }
    return 'does nothing';
  };

  V.run = function (o) {
    o = o || {};
    const tech = o.technique || 'trap-emulate', arch = V.ARCH[o.arch || 'x86'], repeat = Math.max(1, o.repeat || 1);
    const program = o.program || [{ op: 'add' }, { op: 'cli' }, { op: 'store' }, { op: 'popf', arg: 1 }, { op: 'pushf' }, { op: 'sgdt' }, { op: 'lcr3', arg: 0x3000 }, { op: 'out' }];
    const v = { mode: 'kernel', IF: true, cr3: 0x1000, gdt: 0x8000 };
    const real = { mode: tech === 'hardware' ? 'guest kernel' : 'user', IF: true };
    const steps = [], wrong = [];
    let traps = 0, exits = 0, emulated = 0, native = 0, translated = 0, cycles = 0;
    const add = (kind, op, say) => steps.push({ kind, op, say, vcpu: { mode: v.mode, IF: v.IF, cr3: v.cr3 }, real: Object.assign({}, real) });
    add('start', null, tech === 'trap-emulate' ? 'The VMM runs the guest kernel in user mode (deprivileged) on ' + arch.name + '; the guest believes it is in kernel mode, and the VMM keeps that virtual state.'
      : tech === 'binary-translation' ? 'The VMM will not run guest kernel code as it is: it translates each block first, replacing sensitive instructions with calls into itself.'
        : 'Hardware support: the guest kernel runs in guest mode at its own kernel level; the CPU exits to the VMM only on the events the VMM chose.');
    for (let pass = 0; pass < repeat; pass++) {
      if (tech === 'binary-translation') {
        if (pass === 0) {
          const n = program.filter((x) => V.INSTR[x.op] && V.INSTR[x.op].sensitive).length;
          translated = n; cycles += V.COST.translate * program.length;
          add('translate', null, 'First run of this block: the VMM translates its ' + V.plural(program.length, 'instruction') + ', rewriting ' + n + ' sensitive one' + (n === 1 ? '' : 's') + ' (' + program.filter((x) => V.INSTR[x.op] && V.INSTR[x.op].sensitive).map((x) => x.op).join(', ') + ') into calls, and caches the result.');
        } else add('cache', null, 'Pass ' + (pass + 1) + ': the translated block is in the cache, so it runs at once.');
      }
      for (const ins of program) {
        const d = V.INSTR[ins.op] || { sensitive: false, what: 'is not one this model knows, so it is treated as ordinary' };
        if (!d.sensitive) { native++; cycles += V.COST.native; add('native', ins.op, ins.op + ' ' + d.what + ': not sensitive, so it runs directly on the CPU at full speed.'); continue; }
        if (tech === 'trap-emulate') {
          if (arch.privileged.includes(ins.op)) {
            traps++; emulated++; cycles += V.COST.trap;
            const did = emulate(ins.op, ins.arg, v);
            add('trap', ins.op, ins.op + ' is privileged, and the CPU is really in user mode, so it traps to the VMM, which ' + did + ', then resumes the guest.');
          } else {
            native++; cycles += V.COST.native;
            let why;
            if (ins.op === 'popf') why = 'in user mode the CPU silently ignores the change to the interrupt flag: the guest wanted IF = ' + (ins.arg ? 1 : 0) + ', the virtual IF stays ' + (v.IF ? 1 : 0) + ', and no trap tells the VMM';
            else if (ins.op === 'pushf') why = 'it pushes the real flags, so the guest sees the real interrupt flag (' + (real.IF ? 1 : 0) + ') rather than its virtual one (' + (v.IF ? 1 : 0) + ')';
            else if (ins.op === 'smsw') why = 'it reads the low bits of the real CR0, the host\'s machine status word, not the guest\'s virtual one, so the guest sees control bits the VMM set rather than its own';
            else if (ins.op === 'sgdt') why = 'it returns the host\'s table address, not the guest\'s ' + H(v.gdt);
            else why = 'it acts on the real machine';
            wrong.push({ op: ins.op, why });
            add('wrong', ins.op, ins.op + ' is sensitive but not privileged, so it runs without a trap: ' + why + '.');
          }
        } else if (tech === 'binary-translation') {
          emulated++; cycles += V.COST.call;
          add('call', ins.op, ins.op + ' was rewritten into a call to the VMM, which ' + emulate(ins.op, ins.arg, v) + ': no trap, and correct.');
        } else {
          const exitsOn = ['out', 'in', 'hlt'].concat(o.ept === false ? ['lcr3'] : []);
          if (exitsOn.includes(ins.op)) {
            exits++; emulated++; cycles += V.COST.exit;
            add('exit', ins.op, ins.op + ' causes a VM exit: the CPU saves the guest state, the VMM ' + emulate(ins.op, ins.arg, v) + ', and a VM entry resumes the guest.');
          } else {
            native++; cycles += V.COST.native;
            let did = emulate(ins.op, ins.arg, v).replace(/the virtual /g, 'the guest\'s ');
            if (ins.op === 'lcr3') did = 'loads the guest page-table base ' + H(v.cr3) + ' itself (nested paging translates through it in hardware)';
            add('native', ins.op, ins.op + ' runs in guest mode on the guest\'s own state: it ' + did + ', with no exit.');
          }
        }
      }
    }
    const say = tech === 'trap-emulate' ? (wrong.length ? wrong.length + ' instruction' + (wrong.length > 1 ? 's' : '') + ' (' + Array.from(new Set(wrong.map((w) => w.op))).join(', ') + ') went wrong without a trap: this guest is not virtualised correctly.' : 'Every sensitive instruction trapped and was emulated: correct, at ' + V.plural(traps, 'trap') + '.')
      : tech === 'binary-translation' ? 'Correct: ' + translated + ' sensitive instruction' + (translated === 1 ? '' : 's') + ' translated into calls, no traps.' : 'Correct: ' + exits + ' VM exit' + (exits === 1 ? '' : 's') + ', every other instruction in guest mode.';
    add('end', null, say + ' Estimated cost: ' + V.plural(cycles, 'cycle') + '.');
    return { steps, traps, exits, emulated, native, translated, wrong, cycles, technique: tech };
  };
})(globalThis.Proses = globalThis.Proses || {});
