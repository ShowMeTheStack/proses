// Part 18, virtualising the CPU (virt-a-trap.js): which instructions are sensitive and which trap (the
// trap-and-emulate condition), a guest program run by trap-and-emulate, by binary translation and with hardware
// support, and the cycles each costs.
(function (S) {
  'use strict';
  const H = S.P09, P18 = S.P18, V = () => S.Virt;
  const KIND = { native: ['runs natively', 'good'], trap: ['trap, emulated', 'act'], wrong: ['no trap: wrong', 'hot'], call: ['translated call', 'act'], exit: ['VM exit', 'act'], translate: ['', ''], cache: ['', ''] };

  S.topic({
    id: 'virt-popek-goldberg', family: 'p18-cpu', order: 10, title: 'Which instructions break trap-and-emulate',
    blurb: 'A virtual machine monitor runs the guest kernel in user mode. An ordinary instruction runs directly. A sensitive instruction, one that reads or changes the machine\'s privileged state, must reach the monitor instead, and it does if it is privileged: run in user mode it traps. So trap-and-emulate works exactly when every sensitive instruction is privileged. On some real processors a few sensitive instructions are not privileged: in user mode they silently do something else, and no trap tells the monitor.',
    inputs: [{ id: 'arch', kind: 'choice', label: 'Processor', def: 'x86', options: [{ value: 'classic', label: 'a classically virtualisable machine' }, { value: 'x86', label: '32-bit x86 before hardware support' }] }],
    presets: [{ label: 'Old x86', values: { arch: 'x86' } }, { label: 'A classically virtualisable machine', values: { arch: 'classic' } }],
    counters: [{ id: 'sens', label: 'sensitive' }, { id: 'bad', label: 'sensitive, not privileged' }],
    run(inp) {
      const R = V().popekGoldberg(inp.arch), F = new S.Frames(['sens', 'bad']), names = Object.keys(V().INSTR);
      const table = (upto) => S.Kit.gantt.table({ prefix: 'pg', x: 0, y: 30, rowH: 30, size: 14, cols: [{ w: 110, label: 'instruction' }, { w: 120, label: 'sensitive?' }, { w: 210, label: 'traps in user mode?' }, { w: 180, label: 'trap-and-emulate' }], rows: names.map((n, k) => {
        const sen = V().INSTR[n].sensitive, priv = R.privileged.includes(n), shown = k < upto;
        return { cls: k === upto - 1 ? 'act' : '', cells: [n, shown ? { text: sen ? 'yes' : 'no', cls: sen ? 'strong' : '' } : '', shown ? (priv ? 'yes: privileged' : 'no') : '', shown ? (!sen ? { text: 'runs directly', cls: 'good' } : priv ? { text: 'traps, emulated', cls: 'good' } : { text: 'goes wrong', cls: 'hot' }) : ''] };
      }) }).items;
      F.add({ items: [H.title('tt', 0, 6, V().ARCH[inp.arch].name), ...table(0)], say: `${names.length} instructions of a guest kernel. For each: is it sensitive (does it touch privileged state), and does it trap when run in user mode?`, meta: { phase: 'start', n: names.length } });
      names.forEach((n, k) => {
        const d = V().INSTR[n], priv = R.privileged.includes(n);
        if (d.sensitive) F.count('sens');
        if (d.sensitive && !priv) F.count('bad');
        F.add({ items: [H.title('tt', 0, 6, V().ARCH[inp.arch].name), ...table(k + 1)], say: `${n} ${d.what}. ` + (!d.sensitive ? 'It is not sensitive, so the guest may run it directly.' : priv ? 'It is sensitive and privileged: in user mode it traps, and the monitor can emulate it on the virtual CPU.' : 'It is sensitive but not privileged: in user mode it does not trap, so the monitor never sees it.'), meta: { phase: 'ins', k, sensitive: d.sensitive, priv }, title: n });
      });
      F.add({ items: [H.title('tt', 0, 6, V().ARCH[inp.arch].name), ...table(names.length), H.text('vd', 0, 30 + 30 * (names.length + 1) + 30, R.virtualisable ? 'virtualisable by trap-and-emulate' : 'not virtualisable by trap-and-emulate alone', 'verdict2 ' + (R.virtualisable ? 'good' : 'hot'), 16)], say: R.say, meta: { phase: 'end', ok: R.virtualisable, violators: R.violators.length, sensitive: R.sensitive.length }, title: 'verdict', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The condition', text: ['sensitive: reads or changes privileged state', 'privileged: traps when run in user mode', 'trap-and-emulate works if', '  every sensitive instruction is privileged', 'otherwise: binary translation, paravirtualisation,', '  or hardware support'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Can this processor be virtualised by trap-and-emulate alone?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.ok ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'An instruction is sensitive when it…', options: ['reads or changes privileged machine state', 'is slow', 'uses memory', 'is rarely used'], answer: 0, why: 'The interrupt flag, the page-table base, devices: the state the monitor must own.' },
      { q: 'Trap-and-emulate works when…', options: ['every sensitive instruction is privileged', 'every instruction is privileged', 'no instruction traps', 'the guest knows it is virtual'], answer: 0, why: 'Then every sensitive instruction, run in user mode, traps to the monitor.' },
      { q: 'popf run in user mode on old x86 silently ignores the interrupt flag. For a guest kernel this means…', options: ['it believes interrupts are off while they are not, and the monitor is not told', 'it traps', 'the machine halts', 'nothing at all'], answer: 0, why: 'A sensitive instruction that is not privileged.' },
      { q: 'Where does the guest kernel run under trap-and-emulate?', options: ['in user mode, deprivileged', 'in kernel mode', 'in the monitor', 'in another machine'], answer: 0, why: 'Only the monitor runs in kernel mode.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  /** the run as a picture: the program, each instruction's fate in this pass, the virtual and the real CPU */
  const runPic = (prog, pass, st, o) => {
    const items = [H.title('pl', 0, 6, o.title)];
    prog.forEach((ins, j) => {
      const s = pass[j], cur = s && j === pass.length - 1 && st.op;
      items.push({ key: 'in' + j, kind: 'cell', x: 0, y: 24 + j * 34, w: 140, h: 28, rx: 4, text: P18.insText(ins), size: 14, align: 'left', cls: 'implrow mono' + (cur ? ' act' : '') });
      if (s) items.push({ key: 'ik' + j, kind: 'cell', x: 150, y: 26 + j * 34, w: 150, h: 24, rx: 10, text: KIND[s.kind][0], size: 13, cls: 'tag ' + KIND[s.kind][1] });
    });
    const sx = 360, v = st.vcpu, r = st.real;
    items.push(H.title('vt', sx, 6, 'virtual CPU (what the guest believes)'));
    [['mode', v.mode], ['interrupts', v.IF ? 'on (IF = 1)' : 'off (IF = 0)'], ['page-table base', '0x' + v.cr3.toString(16)]].forEach(([a, b], j) => items.push({ key: 'vs' + j, kind: 'cell', x: sx, y: 24 + j * 34, w: 400, h: 28, rx: 4, text: a + ': ' + b, size: 14, align: 'left', cls: 'implrow mono' }));
    items.push(H.title('rt', sx, 140, 'real CPU'));
    [['mode', r.mode], ['interrupts', r.IF ? 'on' : 'off']].forEach(([a, b], j) => items.push({ key: 'rs' + j, kind: 'cell', x: sx, y: 158 + j * 34, w: 400, h: 28, rx: 4, text: a + ': ' + b, size: 14, align: 'left', cls: 'implrow mono' }));
    if (o.verdict) items.push(H.text('vd', sx, 260, o.verdict, 'verdict2 ' + o.vcls, 16));
    return items;
  };
  const runFrames = (F, R, prog, title, extra) => {
    let cyc = 0;
    const n = prog.length, ops = [];
    R.steps.forEach((st, k) => {
      cyc += st.kind === 'native' || st.kind === 'wrong' ? V().COST.native : st.kind === 'trap' ? V().COST.trap : st.kind === 'exit' ? V().COST.exit : st.kind === 'call' ? V().COST.call : st.kind === 'translate' ? V().COST.translate * n : 0;
      if (st.kind === 'trap' || st.kind === 'exit') F.count('traps');
      if (st.kind === 'wrong') F.count('wrong');
      F.set('cycles', cyc);
      if (st.op) ops.push(st);
      // the listing shows the pass under way (the next one starts clean)
      const pass = ops.length ? Math.floor((ops.length - 1) / n) : 0, passes = Math.ceil(R.steps.filter((x) => x.op).length / n);
      const cur = st.op || st.kind === 'end' ? ops.slice(pass * n) : [];
      const last = k === R.steps.length - 1;
      F.add({ items: runPic(prog, cur, st, Object.assign({ title: title + (passes > 1 ? ' (pass ' + (st.kind === 'cache' || st.kind === 'translate' ? pass + (ops.length ? 2 : 1) : pass + 1) + ')' : '') }, last ? { verdict: R.wrong.length ? H.plural(R.wrong.length, 'instruction') + ' wrong, no trap' : 'correct', vcls: R.wrong.length ? 'hot' : 'good' } : {})), say: st.say, meta: Object.assign({ phase: st.kind, k, cycles: cyc, total: R.cycles, traps: R.traps, exits: R.exits, translated: R.translated, cost: V().COST, n, wrong: R.wrong.length, passNo: Array.from({ length: Math.max(1, Math.ceil(R.steps.filter((x) => x.op).length / n)) }, (_, i) => i + 1) }, extra || {}), title: st.op || st.kind });
    });
    F.last().hold = 2500;
  };

  S.topic({
    id: 'virt-trap-emulate', family: 'p18-cpu', order: 20, title: 'Trap-and-emulate, instruction by instruction',
    blurb: 'The monitor keeps a virtual CPU for the guest: the mode it thinks it is in, its interrupt flag, its page-table base. Ordinary instructions run directly on the real CPU at full speed. A privileged one traps; the monitor applies it to the virtual CPU and resumes the guest. A trap costs hundreds of cycles, so a kernel that runs many of them runs slowly. And on a processor with sensitive instructions that do not trap, the guest silently goes wrong.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Guest code', def: 'entry', options: P18.progOptions() },
      { id: 'arch', kind: 'choice', label: 'Processor', def: 'x86', options: [{ value: 'x86', label: '32-bit x86 before hardware support' }, { value: 'classic', label: 'a classically virtualisable machine' }] },
    ],
    presets: [
      { label: 'Kernel entry on old x86', values: { prog: 'entry', arch: 'x86' } },
      { label: 'Kernel entry, virtualisable machine', values: { prog: 'entry', arch: 'classic' } },
      { label: 'A context switch on old x86', values: { prog: 'sched', arch: 'x86' } },
      { label: 'An interrupt handler', values: { prog: 'irq', arch: 'classic' } },
      { label: 'Arithmetic only', values: { prog: 'plain', arch: 'x86' } },
    ],
    counters: [{ id: 'traps', label: 'traps' }, { id: 'wrong', label: 'went wrong' }, { id: 'cycles', label: 'cycles' }],
    run(inp) {
      const prog = P18.PROGS[inp.prog].program, R = V().run({ program: prog, technique: 'trap-emulate', arch: inp.arch }), F = new S.Frames(['traps', 'wrong', 'cycles']);
      runFrames(F, R, prog, 'guest kernel code, run in user mode');
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Trap and emulate', text: ['guest kernel runs in user mode', 'ordinary instruction: runs directly (1 cycle here)', 'privileged: traps to the monitor (500 here)', '  the monitor updates the virtual CPU', 'sensitive, not privileged: goes wrong silently'].join('\n') }] } };
    },
    predict: [{ at: (f, i, fr) => fr[i + 1] && ['trap', 'wrong', 'native'].includes(fr[i + 1].meta.phase) && fr[i + 1].title !== 'add' && i > 0, once: true, pick: 'option', ask: 'What will happen to the next instruction?', options: ['runs natively', 'traps to the monitor', 'runs without a trap and goes wrong'], answer: (fr, i) => ({ native: 'runs natively', trap: 'traps to the monitor', wrong: 'runs without a trap and goes wrong' }[fr[i + 1].meta.phase]), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'Under trap-and-emulate, an add instruction in the guest kernel…', options: ['runs directly on the real CPU', 'traps', 'is translated', 'causes a VM exit'], answer: 0, why: 'It is not sensitive.' },
      { q: 'After a privileged instruction traps, the monitor…', options: ['applies its effect to the virtual CPU and resumes the guest', 'kills the guest', 'runs it on the real CPU in kernel mode for the guest', 'ignores it'], answer: 0, why: 'The guest must see the effect it asked for, on its own virtual state.' },
      { q: 'Why can trap-and-emulate be slow?', options: ['each trap costs hundreds of cycles, and kernels use many privileged instructions', 'every instruction traps', 'the guest runs in a simulator', 'memory is copied'], answer: 0, why: 'The direct execution of ordinary code is fast; the traps are not.' },
      { q: 'The guest executes pushf and sees the real interrupt flag rather than its own. This is…', options: ['a sensitive instruction that does not trap', 'a correct emulation', 'a page fault', 'a VM exit'], answer: 0, why: 'It reveals real state to the guest.' },
    ],
  });

  S.topic({
    id: 'virt-bt-hw', family: 'p18-cpu', order: 30, title: 'Binary translation and hardware support',
    blurb: 'Two ways round the instructions that do not trap. Binary translation: before guest kernel code first runs, the monitor rewrites each block, replacing every sensitive instruction with a call into itself, and keeps the rewritten block in a cache, so later runs cost nothing extra. Hardware support: the processor gets a guest mode with its own privilege levels; the guest kernel runs at its own kernel level and the CPU leaves guest mode (a VM exit) only on the events the monitor asked for.',
    inputs: [
      { id: 'tech', kind: 'choice', label: 'Technique', def: 'binary-translation', options: [{ value: 'binary-translation', label: 'binary translation' }, { value: 'hardware', label: 'hardware support' }] },
      { id: 'prog', kind: 'choice', label: 'Guest code', def: 'entry', options: P18.progOptions() },
      { id: 'repeat', kind: 'number', label: 'Times the code runs', def: 2, min: 1, max: 3 },
      { id: 'ept', kind: 'choice', label: 'Nested paging', def: 'yes', options: [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no: loading the page-table base exits' }] },
    ],
    presets: [
      { label: 'Binary translation, run twice', values: { tech: 'binary-translation', prog: 'entry', repeat: 2, ept: 'yes' } },
      { label: 'Hardware support', values: { tech: 'hardware', prog: 'entry', repeat: 1, ept: 'yes' } },
      { label: 'Hardware, no nested paging', values: { tech: 'hardware', prog: 'sched', repeat: 1, ept: 'no' } },
      { label: 'Binary translation, an interrupt handler', values: { tech: 'binary-translation', prog: 'irq', repeat: 3, ept: 'yes' } },
    ],
    counters: [{ id: 'traps', label: 'exits' }, { id: 'wrong', label: 'went wrong' }, { id: 'cycles', label: 'cycles' }],
    run(inp) {
      const prog = P18.PROGS[inp.prog].program, R = V().run({ program: prog, technique: inp.tech, arch: 'x86', repeat: inp.repeat, ept: inp.ept === 'yes' }), F = new S.Frames(['traps', 'wrong', 'cycles']);
      runFrames(F, R, prog, inp.tech === 'hardware' ? 'guest kernel code in guest mode' : 'guest kernel code, translated', { repeat: inp.repeat });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Two fixes', text: ['binary translation:', '  rewrite sensitive instructions as calls', '  translate once (50 a instruction here), cache', 'hardware support:', '  a guest mode with its own kernel level', '  VM exits only on chosen events (300 here)'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Will any instruction go wrong?', options: ['yes', 'no'], answer: 'no', explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Binary translation rewrites…', options: ['sensitive instructions in guest kernel code into calls to the monitor', 'every instruction of every program', 'user programs only', 'the hardware'], answer: 0, why: 'Ordinary instructions are copied unchanged.' },
      { q: 'Why does binary translation keep a cache?', options: ['so a block is translated once and then reused', 'to store guest files', 'to save power', 'to share code between guests'], answer: 0, why: 'Translation is costly; kernel code runs again and again.' },
      { q: 'With hardware support, the guest kernel runs…', options: ['in a guest mode, at its own kernel privilege level', 'in user mode', 'inside the monitor', 'translated'], answer: 0, why: 'The processor itself keeps guest and host state apart.' },
      { q: 'A VM exit happens…', options: ['when the guest does something the monitor asked to see', 'at every instruction', 'never', 'only at boot'], answer: 0, why: 'I/O, halting, and with old designs page-table switches.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'virt-cpu-cost', family: 'p18-cpu', order: 40, title: 'What each technique costs',
    blurb: 'The same guest code, run again and again, under each technique, with the model\'s costs: 1 cycle for an instruction run directly, 500 for a trap, 300 for a VM exit, 20 for a translated call and 50 an instruction to translate a block once. Trap-and-emulate pays at every sensitive instruction (and is wrong on old x86); binary translation pays once up front and a little each time; hardware support pays only for its exits.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Guest code', def: 'entry', options: P18.progOptions() }, { id: 'runs', kind: 'number', label: 'Up to this many runs', def: 8, min: 2, max: 20 }],
    presets: [{ label: 'Kernel entry, 8 runs', values: { prog: 'entry', runs: 8 } }, { label: 'A context switch, 20 runs', values: { prog: 'sched', runs: 20 } }, { label: 'Arithmetic only', values: { prog: 'plain', runs: 8 } }],
    counters: [],
    run(inp) {
      const prog = P18.PROGS[inp.prog].program, techs = [['trap-emulate', 'trap-and-emulate', 'c0'], ['binary-translation', 'binary translation', 'c2'], ['hardware', 'hardware support', 'c1']];
      const data = techs.map(([t]) => Array.from({ length: inp.runs }, (_, k) => V().run({ program: prog, technique: t, arch: 'classic', repeat: k + 1 }).cycles));
      const wrong = V().run({ program: prog, technique: 'trap-emulate', arch: 'x86' }).wrong.length;
      const maxY = Math.max(...data.flat());
      const ax = S.Kit.curve.axes({ prefix: 'ax', x: 60, y: 30, w: 520, h: 320, xr: [1, inp.runs], yr: [0, maxY * 1.05], xname: 'times the code has run', yname: 'cycles in all', tickSize: 13, fmtY: (v) => (v >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(Math.round(v))), xticks: inp.runs > 10 ? 2 : 1 });
      const F = new S.Frames([]);
      const lines = (upto) => techs.slice(0, upto).map(([t, name, c], k) => S.Kit.curve.line(ax, 'ln' + k, data[k].map((v, j) => [j + 1, v]), 'series ' + c));
      const leg = S.Kit.curve.legend('lg', 620, 60, techs.map(([, name, c]) => ({ text: name, cls: c })), { dir: 'col' });
      F.add({ items: [...ax.items, ...leg.items ? leg.items : leg], say: `${prog.length} instructions of guest code, run 1 to ${inp.runs} times under each technique, on a machine where trap-and-emulate is correct.`, meta: { phase: 'start', n: prog.length } });
      techs.forEach(([t, name], k) => {
        F.add({ items: [...ax.items, ...(leg.items || leg), ...lines(k + 1)], say: `${name}: ${data[k][0]} cycles for one run, ${data[k][inp.runs - 1]} for ${inp.runs}.` + (t === 'binary-translation' ? ' The first run pays for the translation; the rest only for the calls.' : t === 'trap-emulate' ? ` On old x86 this would also be wrong at ${H.plural(wrong, 'instruction')}.` : ''), meta: { phase: 'tech', t, first: data[k][0], last: data[k][inp.runs - 1], wrong }, title: name });
      });
      const end = data.map((d) => d[inp.runs - 1]), best = techs[end.indexOf(Math.min(...end))][1];
      F.add({ items: [...ax.items, ...(leg.items || leg), ...lines(3)], say: `After ${inp.runs} runs the cheapest here is ${best} (${Math.min(...end)} cycles). Real numbers differ with the hardware; the shapes are the point: a steep line pays at every run, a high start pays once.`, meta: { phase: 'end', min: Math.min(...end), end }, title: 'compare', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The model\'s costs', text: ['direct instruction: 1', 'trap: 500', 'VM exit: 300', 'translated call: 20', 'translating: 50 an instruction, once'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which technique will be cheapest after all the runs?', options: ['trap-and-emulate', 'binary translation', 'hardware support'], answer: (fr) => fr.filter((f) => f.meta.phase === 'tech').reduce((a, f) => (f.meta.last < a.v ? { v: f.meta.last, t: f.title } : a), { v: Infinity, t: null }).t, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Binary translation\'s cost curve starts high because…', options: ['the first run translates the block', 'every run traps', 'the cache is cold for ever', 'it emulates every instruction'], answer: 0, why: 'Later runs reuse the cached translation.' },
      { q: 'Code with no sensitive instructions costs about the same under every technique because…', options: ['it runs directly in all of them', 'it is translated in all of them', 'it always traps', 'it is never run'], answer: 0, why: 'Only sensitive instructions are handled specially.' },
      { q: 'Why did hardware support win over time in practice?', options: ['exits became cheap and it needs no rewriting of guest code', 'it emulates every instruction', 'it needs no memory', 'it removes the monitor'], answer: 0, why: 'Simpler monitors, unmodified guests, and steadily cheaper exits.' },
      { q: 'A guest that switches page tables very often is costly under…', options: ['designs where loading the page-table base exits or traps', 'nested paging', 'native execution', 'none of them'], answer: 0, why: 'Each switch then needs the monitor; nested paging lets the guest do it alone.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
