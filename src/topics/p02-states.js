// Part 2, the process state diagram, driven by a real C program on the simulated kernel: every change of state of
// every process becomes a transition on the diagram (new, ready, running, blocked, zombie, reaped), each process a
// tag beside the state it is in, with the listing on the left and a timeline of every process's states underneath.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const INC = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const PROGS = {
    sleepy: {
      label: 'a child that sleeps, a parent that waits', file: 'nap.c',
      src: INC + `int main(void) {
    pid_t k = fork();
    if (k == 0) {
        int s = 0;
        for (int i = 0; i < 3; i++)
            s += i;
        sleep(1);
        return s;
    }
    int n = 0;
    for (int i = 0; i < 4; i++)
        n += i;
    waitpid(k, NULL, 0);
    printf("done %d\\n", n);
    return 0;
}`,
    },
    two: {
      label: 'two children working', file: 'work.c',
      src: INC + `int main(void) {
    for (int c = 0; c < 2; c++)
        if (fork() == 0) {
            int s = 0;
            for (int i = 0; i < 3; i++)
                s += i;
            return s;
        }
    while (wait(NULL) > 0)
        ;
    return 0;
}`,
    },
  };
  P.PROGS_STATES = PROGS;
  const POS = { new: [500, 70], reaped: [650, 70], zombie: [800, 70], ready: [530, 215], running: [790, 215], blocked: [660, 345] };
  // where the process tags sit: beside each state, away from its arrows
  const TAG = { new: 'up', reaped: 'up', zombie: 'up', ready: 'left', running: 'right', blocked: 'right' };
  const NAME = { new: 'new', ready: 'ready', running: 'running', blocked: 'blocked', zombie: 'zombie', reaped: 'reaped' };
  const ARCS = [
    ['new', 'ready', 'admitted', [556, 140]], ['ready', 'running', 'dispatch', [660, 170], -26], ['running', 'ready', 'preempted', [660, 262], -26],
    ['running', 'blocked', 'waits', [762, 300]], ['blocked', 'ready', 'woken', [562, 300]], ['running', 'zombie', 'exit', [826, 142]], ['zombie', 'reaped', 'reaped', [725, 54]],
  ];
  const CAUSE = { 'ready>running': 'is dispatched', 'running>ready': 'is preempted, its time slice used up', 'running>blocked': 'blocks', 'blocked>ready': 'is woken, what it waited for done', 'running>zombie': 'exits', 'zombie>reaped': 'is reaped by its parent', 'new>ready': 'is created and joins the ready queue' };

  /** the transitions of a run: [{t, moves: [{pid, from, to}], ev}] split so that each follows an arc */
  function transitions(sys) {
    const out = [], last = {};
    for (const e of sys.trace) {
      if (!e.states) continue;
      const moves = [];
      for (const pid of Object.keys(e.states).map(Number).filter((p) => p >= 100)) {
        let to = e.states[pid].state, from = last[pid] || 'new';
        if (to === 'stopped') to = 'blocked';
        if (from === to) continue;
        last[pid] = to;
        const path = from === 'blocked' && to === 'running' ? ['blocked', 'ready', 'running'] : from === 'ready' && (to === 'blocked' || to === 'zombie') ? ['ready', 'running', to] : from === 'new' && to === 'running' ? ['new', 'ready', 'running'] : from === 'blocked' && to === 'zombie' ? ['blocked', 'ready', 'running', 'zombie'] : [from, to];
        for (let i = 0; i + 1 < path.length; i++) moves.push({ pid, from: path[i], to: path[i + 1], k: i, line: e.states[pid].line });
      }
      if (!moves.length) continue;
      const stages = Math.max(...moves.map((m) => m.k)) + 1;
      for (let k = 0; k < stages; k++) out.push({ t: e.t, ev: e, moves: moves.filter((m) => m.k === k) });
    }
    return out;
  }

  S.topic({
    id: 'p02-states', family: 'p02-states', order: 10, title: 'The state diagram, live',
    blurb: 'A process is created (new), waits its turn (ready), runs on the CPU (running), waits for something such as a sleep or a child (blocked), and finally exits, a zombie until its parent reaps it. Only the scheduler moves a process from ready to running; a timer interrupt or a call that blocks moves it out again. Here a real C program runs and every change of state of every process is an arrow on the diagram.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'sleepy', options: P.options(PROGS) },
      { id: 'pol', kind: 'choice', label: 'Scheduler', def: 'rr', options: [{ value: 'rr', label: 'round robin, a time slice of q steps' }, { value: 'fifo', label: 'run until it blocks or ends' }] },
      { id: 'q', kind: 'slider', label: 'Time slice q (steps)', def: 2, min: 1, max: 4, step: 1 },
    ],
    presets: [
      { label: 'Round robin, slice 2', values: { prog: 'sleepy', pol: 'rr', q: 2 } },
      { label: 'Run until blocked', values: { prog: 'sleepy', pol: 'fifo' } },
      { label: 'Two children, slice 1', values: { prog: 'two', pol: 'rr', q: 1 } },
      { label: 'Two children, slice 3', values: { prog: 'two', pol: 'rr', q: 3 } },
    ],
    counters: [{ id: 'moves', label: 'transitions' }, { id: 'switches', label: 'times dispatched' }],
    run(inp) {
      const pr = PROGS[inp.prog], sys = P.run(pr.src, inp.pol === 'rr' ? { policy: 'rr', quantum: inp.q, cow: false } : { policy: 'fifo', cow: false });
      const TR = transitions(sys), F = new S.Frames(['moves', 'switches']);
      const pids = [...new Set(TR.flatMap((x) => x.moves.map((m) => m.pid)))].sort();
      const where = {}, hist = Object.fromEntries(pids.map((p) => [p, []]));
      let moves = 0, disp = 0;
      const lineOf = {};
      TR.forEach((tr, i) => {
        for (const m of tr.moves) { where[m.pid] = m.to; lineOf[m.pid] = m.line; moves++; if (m.to === 'running') disp++; }
        for (const p of pids) hist[p].push(where[p] ? (where[p] === 'reaped' ? null : where[p] === 'new' ? null : where[p]) : null);
        F.set('moves', moves).set('switches', disp);
        const items = [];
        // the listing, each live process at its line
        const marks = {};
        for (const p of pids) if (where[p] && where[p] !== 'zombie' && where[p] !== 'reaped') (marks[lineOf[p]] = marks[lineOf[p]] || []).push({ pid: p, cls: 's-' + where[p], act: tr.moves.some((m) => m.pid === p) });
        items.push(...S.Kit.pcode.code({ prefix: 'cd', x: 0, y: 0, w: 420, src: pr.src.split('\n'), lineH: 19, title: pr.file, marks, size: 13, tagSize: 13, indent: 0.75 }).items);
        // the diagram
        for (const k of Object.keys(POS)) {
          const [x, y] = POS[k], lit = tr.moves.some((m) => m.to === k);
          items.push({ key: 's:' + k, kind: 'state', x, y, r: 36, text: NAME[k], size: 13, cls: 's-' + (k === 'reaped' ? 'done' : k) + (lit ? ' act' : '') });
        }
        for (const [a, b, name, at, bend] of ARCS) {
          const lit = tr.moves.some((m) => m.from === a && m.to === b);
          const it = { key: 'e:' + a + b, kind: 'edge', from: 's:' + a, to: 's:' + b, label: name, size: 13, cls: lit ? 'act' : '', bend: bend || 0 };
          it.lx = at[0]; it.ly = at[1];
          items.push(it);
        }
        // the processes beside their states
        const at = {};
        for (const p of pids) {
          const s = where[p]; if (!s) continue;
          const n = (at[s] = (at[s] || 0) + 1) - 1, [x, y] = POS[s], side = TAG[s];
          const tx = side === 'up' ? x - 54 + n * 37 : side === 'left' ? x - 76 : x + 42, ty = side === 'up' ? y - 64 : y - 34 + n * 24;
          items.push(H.cell('tk' + p, tx, ty, 34, 20, String(p), 'ptag s-' + (s === 'reaped' ? 'done' : s) + (tr.moves.some((m) => m.pid === p) ? ' act' : ''), { rx: 10, size: 13 }));
        }
        // the timeline
        const rows = pids.map((p) => ({ id: p, label: String(p), cells: hist[p].concat(new Array(TR.length - hist[p].length).fill(null)) }));
        items.push(...S.Kit.proc.timeline({ prefix: 'tl', x: 444, y: 420, w: 426, rows, n: TR.length, now: i, rowH: 20, labelW: 44, size: 13, title: 'state at each step' }).items);
        const what = tr.moves.map((m) => m.pid + ' ' + (CAUSE[m.from + '>' + m.to] || 'moves') + ' (' + m.from + ' → ' + m.to + ')');
        const evSay = tr.ev.kind !== 'step' && !/^The clock/.test(tr.ev.say || '') ? ' ' + H.say(tr.ev.say) : '';
        F.add({ items, say: 'Step ' + tr.t + ': ' + what.join('; ') + '.' + (tr.moves.length === 1 ? evSay : ''), meta: { phase: 'move', t: tr.t, moves: tr.moves, moves_n: moves, disp, ev: H.bare(tr.ev), q: inp.q }, title: tr.moves.map((m) => m.from + ' → ' + m.to).join(', ') });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The arrows', text: ['new → ready: created, admitted', 'ready → running: the scheduler', '  dispatches it', 'running → ready: preempted', '  (its time slice is used up)', 'running → blocked: sleep, wait,', '  a read with nothing to read', 'blocked → ready: the event came', 'running → zombie: exit', 'zombie → reaped: the parent waits'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => { const m = f.meta.moves.find((x) => x.to === 'running'); return !!m && fr.slice(i + 1).some((g) => g.meta.moves.some((x) => x.pid === m.pid)); }, once: true, pick: 'option', ask: (fr, i) => 'Process ' + fr[i].meta.moves.find((x) => x.to === 'running').pid + ' is running. Which state does it go to next?', options: ['ready', 'blocked', 'zombie'], answer: (fr, i) => { const pid = fr[i].meta.moves.find((x) => x.to === 'running').pid; return fr.slice(i + 1).find((g) => g.meta.moves.some((x) => x.pid === pid)).meta.moves.find((x) => x.pid === pid).to; }, explain: (fr, i) => { const pid = fr[i].meta.moves.find((x) => x.to === 'running').pid; return fr.slice(i + 1).find((g) => g.meta.moves.some((x) => x.pid === pid)).say; } },
    ],
    quiz: [
      { q: 'Which transition does only the scheduler make?', options: ['ready → running', 'running → blocked', 'blocked → ready', 'running → zombie'], answer: 0, why: 'A process asks to block or to exit; it is put on the CPU only by the scheduler.' },
      { q: 'A blocked process\'s event happens (its sleep ends). Where does it go?', options: ['ready: it must wait for the CPU again', 'straight to running', 'zombie', 'new'], answer: 0, why: 'Being woken makes it eligible to run, not running.' },
      { q: 'With one CPU, how many processes can be running at once?', options: ['one', 'as many as are ready', 'two', 'none'], answer: 0, why: 'The others are ready, blocked or finished.' },
      { q: 'A shorter time slice means…', options: ['more running → ready transitions (more switches)', 'fewer switches', 'processes block more', 'processes exit sooner'], answer: 0, why: 'Each slice that ends early sends the process back to the ready queue.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
