// Part 1, what the OS gives a program: a CPU of its own and a memory of its own, both illusions. The CPU is
// shared out in turns (S.Os.lde), yet each program sees only its own ticks, one after another. Memory: two
// processes print the same address and find different values there, because each address is translated through
// the process's own page table to a different frame (a real C program on the simulated kernel, S.Kern).
(function (S) {
  'use strict';
  const H = S.PX;
  const G = () => S.Kit.gantt;

  // ---------------------------------------------------------------------------------------------------------------
  // The illusion of a private CPU
  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'p01-cpu-share', family: 'p01-roles', order: 10, title: 'One CPU, and every program thinks it has its own',
    blurb: 'Three programs, one CPU. The kernel runs them in turns, a slice each, and switches so often that each seems to run on its own. Below the real timeline, each program\'s own view: its ticks, one after another, with no gaps, because a program cannot see the time it spent waiting. Only the clock on the wall shows that it took longer.',
    inputs: [
      { id: 'procs', kind: 'text', label: 'Programs (name and ticks of work)', def: 'A 4, B 3, C 5', check: (v) => { const r = H.ldeParse(v); if (typeof r === 'string') return r; return r.some((p) => p.loop || (p.syscalls && p.syscalls.length)) ? 'Programs: here each needs a number of ticks only' : null; } },
      { id: 'quantum', kind: 'slider', label: 'Slice (ticks)', def: 2, min: 1, max: 5, step: 1 },
    ],
    presets: [
      { label: 'Three programs, slices of 2', values: { procs: 'A 4, B 3, C 5', quantum: 2 } },
      { label: 'Slices of 1: fine-grained sharing', values: { procs: 'A 4, B 3, C 5', quantum: 1 } },
      { label: 'One program alone: no illusion needed', values: { procs: 'A 6', quantum: 2 } },
      { label: 'Five programs', values: { procs: 'A 3, B 3, C 3, D 3, E 3', quantum: 2 } },
    ],
    counters: [{ id: 'wall', label: 'wall-clock ticks' }],
    run(inp) {
      const procs = H.ldeParse(inp.procs), names = procs.map((p) => p.name);
      const r = S.Os.lde({ procs, quantum: inp.quantum, timer: true, switchCost: 0, maxTicks: 80 });
      const end = r.end, x0 = 110, x1 = 820, T = G().time({ x0, x1, t1: end });
      const F = new S.Frames(['wall']);
      const own = Object.fromEntries(procs.map((p) => [p.name, p.work]));
      const laneY = (i) => 44 + i * 36, vy = laneY(names.length) + 60;
      const ownY = (i) => vy + 22 + i * 36;
      const per = (x1 - x0 - 160) / Math.max(...procs.map((p) => p.work));
      const done = Object.fromEntries(names.map((n) => [n, 0]));
      r.steps.forEach((s) => {
        if (s.kind !== 'run' && s.kind !== 'start' && s.kind !== 'end') return;
        if (s.kind === 'run') done[s.run] += s.to - s.from;
        const upTo = s.t;
        const items = [H.title('t1', 0, 4, 'the real CPU, on the wall clock'), ...G().axis({ prefix: 'ax', X: T.X, t1: end, y: 30, step: end > 24 ? 2 : 1, size: 13 })];
        names.forEach((n, i) => {
          items.push(H.text('ln' + i, x0 - 12, laneY(i) + 20, n, 'strong', 14, 'end'));
          items.push(...G().track({ prefix: 'tk' + i, x: x0, y: laneY(i), w: x1 - x0, h: 28 }));
        });
        r.segs.forEach((g, k) => {
          if (g.start >= upTo || g.mode !== 'user') return;
          const e = Math.min(g.end, upTo), li = names.indexOf(g.who);
          items.push(H.cell('sg' + k, T.X(g.start), laneY(li) + 2, T.X(e) - T.X(g.start), 24, '', 'gseg p' + (li % 6) + (s.run === g.who && e === upTo && s.kind === 'run' ? ' now' : '')));
        });
        items.push(H.title('t2', 0, vy, 'what each program sees: its own ticks'));
        names.forEach((n, i) => {
          items.push(H.text('on' + i, x0 - 12, ownY(i) + 20, n, 'strong', 14, 'end'));
          for (let k = 0; k < own[n]; k++) items.push(H.cell('ot' + i + '_' + k, x0 + k * per + 1, ownY(i) + 2, per - 2, 24, String(k + 1), k < done[n] ? 'gseg p' + (i % 6) : 'gslot', { size: 13 }));
          const fin = r.finish[n] !== undefined && r.finish[n] <= upTo;
          items.push(H.text('ow' + i, x0 + own[n] * per + 10, ownY(i) + 20, fin ? 'done at wall t = ' + r.finish[n] : '', 'muted', 13));
        });
        F.set('wall', upTo);
        const say = s.kind === 'run' ? s.say + ' In its own view it has now run ' + (done[s.run] === own[s.run] ? 'all ' + H.plural(own[s.run], 'tick') + ' of its work' : done[s.run] + ' of its ' + own[s.run] + ' ticks') + ', without a gap.' : s.kind === 'end' ? 'Every program has finished by t = ' + end + '. Each one did exactly its own work (' + H.list(names.map((n) => n + ' ' + own[n])) + ' ticks), but on the wall clock ' + H.list(names.map((n) => n + ' took ' + r.finish[n])) + ': the price of sharing, which no program can see from inside.' : 'Each program is written as if it had the CPU to itself. The kernel gives it slices of ' + H.plural(inp.quantum, 'tick') + ' and the timer takes the CPU back after each.';
        F.add({ items, say, meta: { phase: s.kind, t: s.t, from: s.from, to: s.to, run: s.run, done: Object.assign({}, done), own, finish: r.finish, end, quantum: inp.quantum } });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Virtualising the CPU', text: ['one CPU, many programs in turns', 'each program sees its own work', '  as one unbroken run', 'the timer and the context switch', '  make the turns'].join('\n') }] }, result: r };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'start' && fr.length > 3, pick: 'option', ask: 'Which program will finish first on the wall clock?', options: (fr) => Object.keys(fr[0].meta.own), answer: (fr) => { const fin = fr[0].meta.finish; return Object.keys(fin).sort((a, b) => fin[a] - fin[b])[0]; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A program counts its own instructions while it runs. Can it tell it shared the CPU?', options: ['no: its instructions run one after another as if alone; only the wall clock shows the waiting', 'yes: the count skips numbers', 'yes: its variables change', 'only if it crashes'], answer: 0, why: 'The context switch saves and restores everything the program can see.' },
      { q: 'Smaller slices make the sharing…', options: ['finer, so each program seems to run more smoothly, at the cost of more switches', 'unfair', 'impossible', 'slower for every program'], answer: 0, why: 'Each program gets the CPU more often but for less time each turn.' },
      { q: 'What lets the kernel take the CPU back at the end of a slice?', options: ['the timer interrupt', 'the program\'s own goodwill', 'the disk', 'the compiler'], answer: 0, why: 'See [[p01-lde]].' },
      { q: 'With one program and no others, what does sharing cost it?', options: ['almost nothing: it runs whenever it is ready', 'half its time', 'a slice for every tick', 'it cannot run'], answer: 0, why: 'There is no one to take turns with.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The illusion of a private memory
  // ---------------------------------------------------------------------------------------------------------------
  const MEM = [
    {
      name: 'same address, two values', file: 'balance.c', names: { 100: 'P', 101: 'C' },
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int balance = 100;
int main(void) {
    pid_t k = fork();
    if (k == 0) {
        balance = 250;
        void *at = &balance;
        printf("C: %p %d\\n", at, balance);
        return 0;
    }
    wait(NULL);
    void *at = &balance;
    printf("P: %p %d\\n", at, balance);
    return 0;
}`,
    },
    {
      name: 'an array on the stack', file: 'marks.c', names: { 100: 'P', 101: 'C' },
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    int marks[3] = {7, 8, 9};
    if (fork() == 0) {
        marks[0] = 0;
        printf("C: %p %d\\n", marks, *marks);
        return 0;
    }
    wait(NULL);
    printf("P: %p %d\\n", marks, *marks);
    return 0;
}`,
    },
  ];
  H.MEM = MEM;
  /** each live process's pages and the frames behind them: o {prefix, x, y, snap, ks, pages: [indexes], act: {pid, page}} */
  H.pageMap = function (o) {
    const items = [], cw = o.cw || 34, procs = o.snap.filter((p) => p.role === 'prog' && p.pages && p.pages.length);
    const frames = (o.ks && o.ks.frames) || {};
    items.push(H.title(o.prefix + ':t', o.x, o.y, 'page → frame, per process'));
    o.pages.forEach((pg, k) => items.push(H.text(o.prefix + ':h' + k, o.x + 52 + k * (cw + 3) + cw / 2, o.y + 22, String(pg), 'muted', 13, 'middle')));
    procs.forEach((p, i) => {
      const y = o.y + 30 + i * 34;
      items.push(H.text(o.prefix + ':p' + p.pid, o.x + 44, y + 19, String(p.pid), 'strong', 14, 'end'));
      o.pages.forEach((pg, k) => {
        const f = p.pages[pg - 1], fr = frames[f], shared = fr && fr.refs > 1;
        const lit = o.act && o.act.page === pg && (o.act.pid === p.pid || o.act.other === p.pid);
        items.push(H.cell(o.prefix + ':c' + p.pid + '_' + k, o.x + 52 + k * (cw + 3), y, cw, 28, f === undefined ? '' : String(f), (shared ? 'pg shared' : 'pg private') + (lit ? ' act' : ''), { size: 13 }));
      });
    });
    const ly = o.y + 30 + procs.length * 34 + 14;
    items.push(H.cell(o.prefix + ':l1', o.x, ly - 12, 18, 16, '', 'pg shared'), H.text(o.prefix + ':l1t', o.x + 24, ly + 1, 'shared, read-only', '', 13));
    items.push(H.cell(o.prefix + ':l2', o.x + 170, ly - 12, 18, 16, '', 'pg private'), H.text(o.prefix + ':l2t', o.x + 194, ly + 1, 'its own copy', '', 13));
    return { items, h: ly + 8 - o.y };
  };

  S.topic({
    id: 'p01-memory-private', family: 'p01-roles', order: 20, title: 'The same address in two processes',
    blurb: 'After fork, parent and child run the same code with the same addresses. The child changes a variable and prints its address; the parent prints the same address and finds its old value. An address in a program is not a place in the memory chips: each process\'s page table maps it to a frame, and here the kernel gave the child its own frame the moment it wrote (copy-on-write).',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: '0', options: MEM.map((m, i) => ({ value: String(i), label: m.name })) }],
    presets: MEM.map((m, i) => ({ label: m.name, values: { prog: String(i) } })),
    counters: [{ id: 'copies', label: 'frames copied' }],
    run(inp) {
      const pr = MEM[Number(inp.prog)], sys = H.kern(pr.src, { names: pr.names, cow: true });
      const bs = H.beats(sys, { keep: ['cow-share'] });
      const F = new S.Frames(['copies']);
      let copies = 0;
      const pages = [1, 2, 8, 9, 10];
      bs.forEach((b) => {
        if (b.kind === 'cow') copies++;
        const act = b.kind === 'cow' ? { pid: b.pid, page: b.evs[0].page } : null;
        const sc = H.scene({ sys, beat: b, src: pr.src, file: pr.file, depth: 1, codeW: 420, lineH: 19, treeOpts: { hide: ['init', 'shell'], boxW: 112 }, rowsShown: 3, buffers: false,
          extraRight: (y, x) => H.pageMap({ prefix: 'pm', x, y: y + 10, snap: b.snap, ks: b.ks, pages, act }) });
        F.set('copies', copies);
        F.add({ items: sc.items, say: b.say, meta: H.metaOf(b, { copies }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Virtualising memory', text: ['an address names a page and', '  an offset within it', 'each process has its own page table:', '  page → frame', 'after fork the frames are shared,', '  read-only, until one side writes'].join('\n') }] }, result: { out: sys.out } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'print' && fr[i + 1].meta.evs[0].pid === 100, pick: 'option', ask: 'The parent prints the variable the child changed. Which value will it see?', options: (fr, i) => { const c = fr.find((f) => f.meta.phase === 'print' && f.meta.evs[0].pid !== 100), p = fr[i + 1]; const num = (t) => (/(-?\d+)\s*$/.exec(t.trim()) || [])[1]; return [...new Set([num(p.meta.evs[0].text), num(c.meta.evs[0].text)])]; }, answer: (fr, i) => (/(-?\d+)\s*$/.exec(fr[i + 1].meta.evs[0].text.trim()) || [])[1], explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Parent and child print the same address for a variable. Do they share it?', options: ['no: the same virtual address maps to different frames in their two page tables', 'yes, always', 'only if it is a global', 'only until the parent exits'], answer: 0, why: 'Addresses are per process; the page table decides the frame.' },
      { q: 'Right after fork, how much memory has the kernel copied?', options: ['none: the frames are shared read-only until someone writes', 'all of it', 'only the stack', 'only the globals'], answer: 0, why: 'Copy-on-write delays the copy to the first write, page by page.' },
      { q: 'The child writes one int. How much is copied?', options: ['the one page that holds it', 'the whole address space', 'four bytes', 'nothing'], answer: 0, why: 'The unit of mapping, and so of copying, is the page.' },
      { q: 'Why can one process never read another\'s variables by address?', options: ['its addresses go through its own page table, which maps only its own frames', 'the compiler forbids it', 'addresses are random', 'it can'], answer: 0, why: 'The kernel decides which frames appear in each page table.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
