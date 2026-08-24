// Part 1, limited direct execution: programs run straight on the CPU in user mode, and the kernel gets the CPU
// back only through a trap: a system call, an exit, or the timer interrupt it programmed at boot. The picture is
// a timeline with a lane per process and one for the kernel, the trap marks on it, the mode bit and the ready
// queue. Every value comes from S.Os.lde.
(function (S) {
  'use strict';
  const H = S.PX;
  const G = () => S.Kit.gantt;

  /** "A 5, B 4 sys 2, C loop" -> [{name, work, syscalls, loop}] or an error sentence */
  function parse(text) {
    const out = [];
    const parts = String(text).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return 'Processes: give at least one, like "A 5"';
    for (const p of parts) {
      const w = p.split(/\s+/);
      if (!/^[A-Za-z]\w{0,3}$/.test(w[0])) return 'Processes: "' + w[0] + '" is not a short name (a letter, then up to 3 letters or digits)';
      const q = { name: w[0] };
      if (w[1] === 'loop') q.loop = true;
      else { q.work = Number(w[1]); if (!Number.isInteger(q.work) || q.work < 1 || q.work > 12) return 'Processes: ' + w[0] + ' needs a number of ticks from 1 to 12, or "loop"'; }
      if (w[2] !== undefined) {
        if (w[2] !== 'sys') return 'Processes: after the ticks, write "sys" and the ticks after which ' + w[0] + ' makes system calls';
        q.syscalls = w.slice(3).map(Number);
        if (!q.syscalls.length || q.syscalls.some((n) => !Number.isInteger(n) || n < 1 || (!q.loop && n >= q.work))) return 'Processes: ' + w[0] + '\'s system calls must come after ticks 1 to ' + (q.loop ? 'any' : q.work - 1);
      }
      if (out.some((x) => x.name === q.name)) return 'Processes: the name ' + q.name + ' is used twice';
      out.push(q);
    }
    if (out.length > 5) return 'Processes: at most 5, so the lanes stay readable';
    return out;
  }
  H.ldeParse = parse;
  const KIND = { timer: 'T', syscall: 'S', exit: 'E' };

  S.topic({
    id: 'p01-lde', family: 'p01-lde', order: 10, title: 'Limited direct execution and the timer',
    blurb: 'A program runs straight on the CPU, as fast as the hardware goes, with the mode bit set to user. The kernel is not running then: it gets the CPU back only when something traps into it. A system call or an exit is a trap the program chooses; the timer interrupt, programmed at boot, is one it cannot avoid. Turn the timer off and a program that loops without system calls keeps the CPU for ever.',
    inputs: [
      { id: 'procs', kind: 'text', label: 'Processes (name, ticks or loop, then sys and the ticks after which it calls the kernel)', def: 'A 5, B 4 sys 2, C 3', check: (v) => { const r = parse(v); return typeof r === 'string' ? r : null; } },
      { id: 'quantum', kind: 'slider', label: 'Timer period (ticks)', def: 3, min: 1, max: 6, step: 1 },
      { id: 'timer', kind: 'choice', label: 'Timer interrupt', def: 'on', options: [{ value: 'on', label: 'on: the kernel takes the CPU back' }, { value: 'off', label: 'off: cooperative, only traps the program makes' }] },
      { id: 'cost', kind: 'slider', label: 'Kernel ticks per switch', def: 0, min: 0, max: 2, step: 1 },
    ],
    presets: [
      { label: 'Three programs, timer on', values: { procs: 'A 5, B 4 sys 2, C 3', quantum: 3, timer: 'on', cost: 0 } },
      { label: 'A loop with the timer: still shared', values: { procs: 'A 4, L loop, B 3', quantum: 2, timer: 'on', cost: 0 } },
      { label: 'A loop with no timer: stuck', values: { procs: 'A 3, L loop, B 2', quantum: 3, timer: 'off', cost: 0 } },
      { label: 'Cooperative: system calls are the only switches', values: { procs: 'A 6 sys 2 4, B 5 sys 1 3, C 2', quantum: 3, timer: 'off', cost: 0 } },
      { label: 'Switches cost kernel time', values: { procs: 'A 4, B 4, C 4', quantum: 1, timer: 'on', cost: 1 } },
      { label: 'A long quantum', values: { procs: 'A 4, B 4, C 4', quantum: 6, timer: 'on', cost: 1 } },
    ],
    counters: [{ id: 'switches', label: 'context switches' }, { id: 'timer', label: 'timer interrupts' }, { id: 'sys', label: 'system calls' }],
    run(inp) {
      const procs = parse(inp.procs), loops = procs.some((p) => p.loop);
      const r = S.Os.lde({ procs, quantum: inp.quantum, timer: inp.timer === 'on', switchCost: inp.cost, maxTicks: loops ? (inp.timer === 'on' ? 24 : 18) : 60 });
      const names = procs.map((p) => p.name), end = Math.max(1, r.end);
      const lanes = names.concat(['kernel']);
      const x0 = 100, x1 = 840, laneH = 32, gap = 10, top = 58;
      const T = G().time({ x0, x1, t1: end });
      const step = end <= 20 ? 1 : end <= 40 ? 2 : 5;
      const laneY = (i) => top + i * (laneH + gap);
      const kY = laneY(names.length);
      const F = new S.Frames(['switches', 'timer', 'sys']);
      const base = [H.title('ti', 0, 14, 'the CPU, tick by tick'), ...G().axis({ prefix: 'ax', X: T.X, t1: end, y: 34, step, size: 13 })];
      lanes.forEach((n, i) => {
        base.push(H.text('ln' + i, x0 - 14, laneY(i) + laneH / 2 + 5, i === names.length ? 'kernel' : n + ' · user', i === names.length ? 'act' : 'strong', 14, 'end'));
        base.push(...G().track({ prefix: 'tk' + i, x: x0, y: laneY(i), w: x1 - x0, h: laneH }));
      });
      const statY = kY + laneH + (inp.cost ? 56 : 30);
      const marks = [];
      let switches = 0, timers = 0, sys = 0;
      r.steps.forEach((s, i) => {
        const upTo = s.t;
        if (s.kind === 'switch') switches++;
        if (s.kind === 'timer') timers++;
        if (s.kind === 'syscall' || s.kind === 'exit') sys++;
        if (KIND[s.kind]) marks.push({ kind: s.kind, t: s.t, who: s.run, i });
        F.set('switches', switches).set('timer', timers).set('sys', sys);
        const items = base.slice();
        r.segs.forEach((g, k) => {
          if (g.start >= upTo) return;
          const e = Math.min(g.end, upTo), li = g.mode === 'kernel' ? names.length : names.indexOf(g.who);
          const live = e === upTo && s.mode === (g.mode === 'kernel' ? 'kernel' : 'user') && s.run === g.who;
          items.push(H.cell('sg' + k, T.X(g.start), laneY(li) + 3, T.X(e) - T.X(g.start), laneH - 6, '', g.mode === 'kernel' ? 'kseg' : 'gseg p' + (li % 6) + (live ? ' now' : '')));
        });
        // trap marks on the kernel lane, one per trap so far
        marks.forEach((m, k) => {
          const x = T.X(m.t), w = Math.min(22, Math.floor(T.per * 0.9));
          // with no switching cost the kernel lane is free for the marks; otherwise they go under it
          const my = inp.cost ? kY + laneH + 6 : kY + 5;
          items.push(H.cell('mk' + k, x - w / 2, my, w, 22, w >= 14 ? KIND[m.kind] : '', 'trapmark ' + m.kind + (m.i === i ? ' act' : ''), { size: 13 }));
          items.push({ key: 'ml' + k, kind: 'line', x1: x, y1: laneY(Math.max(0, names.indexOf(m.who))) + laneH, x2: x, y2: my, cls: 'trapline' + (m.i === i ? ' act' : ''), audit: 'ignore', layer: 'back' });
        });
        // the mode bit, who is on the CPU and the ready queue
        const kmode = s.mode === 'kernel';
        items.push(H.text('mbl', 0, statY + 19, 'mode bit', 'title'));
        items.push(H.cell('mb', 92, statY, 96, 30, kmode ? 'kernel' : 'user', 'modebit ' + (kmode ? 'kern' : 'user'), { size: 14 }));
        items.push(H.text('cpl', 220, statY + 19, 'on the CPU', 'title'));
        items.push(H.cell('cpu', 330, statY, 86, 30, kmode ? 'kernel' : s.run || '—', kmode ? 'modebit kern' : s.run ? 'gjob p' + (names.indexOf(s.run) % 6) : 'soft', { size: 14 }));
        const q = s.ready.filter((n) => n !== s.run || kmode);
        items.push(...G().queue({ prefix: 'rq', x: 452, y: statY, ids: q.length ? q : [], jobs: names, w: 40, h: 30, label: 'ready', labelW: 58, keyOf: (id) => 'rq' + id }).items);
        if (!q.length) items.push(H.text('rqe', 510, statY + 20, 'empty', '', 13));
        const legY = statY + 58;
        items.push(H.cell('lg1', 0, legY - 12, 20, 20, 'T', 'trapmark timer', { size: 13 }), H.text('lg1t', 26, legY + 2, 'timer interrupt', '', 13));
        items.push(H.cell('lg2', 160, legY - 12, 20, 20, 'S', 'trapmark syscall', { size: 13 }), H.text('lg2t', 186, legY + 2, 'system call', '', 13));
        items.push(H.cell('lg3', 300, legY - 12, 20, 20, 'E', 'trapmark exit', { size: 13 }), H.text('lg3t', 326, legY + 2, 'exit', '', 13));
        items.push(H.cell('lg4', 390, legY - 12, 28, 18, '', 'kseg'), H.text('lg4t', 424, legY + 2, 'kernel time (switching)', '', 13));
        if (r.stuck && s.kind === 'limit') items.push(H.text('stuck', x1, statY + 20, r.stuck + ' never traps: only a reboot ends it', 'bad', 14, 'end'));
        F.add({ items, say: H.say(s.say.replace('every 1 ticks', 'every tick')), meta: { phase: s.kind, kind: s.kind, t: s.t, from: s.from, to: s.to, run: s.run, ready: s.ready, quantum: inp.quantum, cost: inp.cost, switches, timers, sys, end: r.end, stuck: r.stuck }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Who has the CPU', text: ['user mode: the program runs', '  directly on the CPU', 'the kernel runs only after a trap:', '  a system call or an exit', '  the timer interrupt', 'no timer: a loop that makes', '  no system call never yields', 'a switch: save one process\'s', '  registers, load another\'s,', '  return-from-trap'].join('\n') }] };
      return { frames: F.list, def, result: { switches: r.switches, timerInterrupts: r.timerInterrupts, syscalls: r.syscalls, stuck: r.stuck, end: r.end, finish: r.finish } };
    },
    predict: [
      { at: (f, i, fr) => (f.meta.kind === 'timer' || f.meta.kind === 'exit' || (f.meta.kind === 'syscall' && fr[i + 1] && fr[i + 1].meta.kind === 'switch')) && fr[i + 1] && (fr[i + 1].meta.kind === 'switch' || fr[i + 1].meta.kind === 'resume'), pick: 'option', ask: 'The kernel has the CPU. Which process will it run next?', options: (fr, i) => [...new Set([fr[i].meta.run].concat(fr[i].meta.ready))].filter(Boolean), answer: (fr, i) => fr[i + 1].meta.run, explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => f.meta.kind === 'switch' && fr[fr.length - 1].meta.stuck === f.meta.run, once: true, pick: 'option', ask: 'This process loops and never makes a system call. Will the kernel ever run again?', options: ['yes, at the next timer tick', 'no: nothing traps into the kernel'], answer: 'no: nothing traps into the kernel', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'While a user program runs directly on the CPU, where is the kernel?', options: ['not running: it waits for the next trap', 'running beside it on the same CPU', 'checking each instruction', 'in a separate process that polls'], answer: 0, why: 'Direct execution means the CPU runs the program\'s own instructions; the kernel runs again only on a trap or an interrupt.' },
      { q: 'Why must the kernel program the timer before it runs any user program?', options: ['so that it gets the CPU back even from a program that never makes a system call', 'to measure how fast the CPU is', 'so the program can read the time', 'it does not need to'], answer: 0, why: 'The timer interrupt is the one trap the program cannot avoid or switch off (that instruction is privileged).' },
      { q: 'In a cooperative system (no timer), when can the kernel switch processes?', options: ['only when the running process makes a system call or exits', 'every tick', 'whenever a key is pressed', 'never'], answer: 0, why: 'Those are the only moments the kernel has the CPU.' },
      { q: 'A context switch costs 1 tick of kernel time and the timer fires every tick. What happens?', options: ['half the CPU goes to switching', 'nothing changes', 'programs run faster', 'the kernel never runs'], answer: 0, why: 'One tick of work, one tick of switching: a short quantum buys response at the price of overhead.' },
      { q: 'Could a program turn the timer off itself?', options: ['no: programming the timer is a privileged instruction, refused in user mode', 'yes, with an ordinary store', 'yes, by looping', 'only if it is the first program'], answer: 0, why: 'Otherwise any program could keep the CPU for ever.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
