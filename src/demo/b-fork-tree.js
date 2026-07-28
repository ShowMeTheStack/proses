// A fork tree, grown by a real C program run on the simulated kernel (src/core/c-*.js, k-*.js). The program sits in
// an editor-like panel with each process's place in it; beside it the fork tree, coloured by state, and the
// terminal, each line tagged with the process that wrote it; under the code, a timeline of every process's state.
// The first program tells the whole story: a child exits before its parent waits and is a zombie until the
// parent reaps it; the parent then exits, so its other child is re-parented to init, which reaps it in the end.
// A step is one thing the kernel does (a fork, a write, an exit, a re-parenting, a reap), taken from the trace.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const PRESETS = [
    {
      name: 'zombie, then orphan', file: 'family.c',
      heading: 'A zombie, then an orphan reaped by init',
      sub: 'A exits before P waits: a zombie until P reaps it. P exits before B, so B is re-parented to init, which reaps it.', names: { 100: 'P', 101: 'A', 102: 'B' },
      src: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t a = fork();
    if (a == 0) {
        printf("A: done early\\n");
        exit(3);
    }
    pid_t b = fork();
    if (b == 0) {
        sleep(2);
        printf("B: ppid %d\\n", getppid());
        exit(0);
    }
    sleep(1);
    int st;
    waitpid(a, &st, 0);
    int code = WEXITSTATUS(st);
    printf("P: A gave %d\\n", code);
    return 0;
}`,
    },
    {
      name: 'fork three times', file: 'three.c',
      heading: 'Three forks make eight processes',
      sub: 'Every process alive at a fork runs it, so each fork doubles the count: 1, 2, 4, then 8 processes, each printing once and reaping its own children.', names: {},
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    fork();
    fork();
    fork();
    printf("I am %d\\n", getpid());
    while (wait(NULL) > 0)
        ;
    return 0;
}`,
    },
    {
      name: 'printf before fork', file: 'hello.c',
      heading: 'printf before fork prints twice',
      sub: '"hello " has no newline, so it waits in the stdout buffer, and fork copies the buffer too. Through a pipe even a line ending in a newline waits there, since stdout on a pipe is fully buffered.', names: { 100: 'P', 101: 'C' },
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    printf("hello ");
    pid_t k = fork();
    if (k == 0) {
        printf("from the child\\n");
        return 0;
    }
    wait(NULL);
    printf("from the parent\\n");
    return 0;
}`,
    },
  ];
  const TITLE = { start: 'start', fork: 'fork', buffer: 'printf, buffered', print: 'write', exit: 'exit: a zombie', zombie: 'exit: a zombie', reparent: 're-parent to init', wait: 'wait returns', reap: 'reap', block: 'block', wake: 'wake up', error: 'crash', done: 'done', lost: '_exit' };
  const STATE = { ready: 'ready', running: 'running', blocked: 'blocked', zombie: 'zombie', reaped: 'done' };

  /** the run: the kernel's trace with a snapshot at every event */
  function system(pi, seed) {
    return D.once('fork-tree:' + pi + ':' + seed, () => {
      const pr = PRESETS[pi];
      return S.Kern.run(pr.src, { policy: 'random', seed, names: pr.names, snap: true, cow: false });
    });
  }
  /** the beats: one per thing worth a picture; an exit and its zombie are one, a wait and its reap are one */
  function beats(sys) {
    const out = [];
    for (const e of sys.trace) {
      if (e.kind === 'step' || e.kind === 'sleep' || e.kind === 'flush') continue;
      const last = out[out.length - 1];
      if (e.kind === 'zombie' && last && last.kind === 'exit' && last.pid === e.pid) { last.evs.push(e); last.snap = e.snap; last.nterm = e.nterm; last.say = e.say; continue; }
      if (e.kind === 'reap' && last && last.kind === 'wait' && last.evs[0].ret === e.pid) { last.evs.push(e); last.snap = e.snap; last.say = last.say.replace(/\.$/, '') + ', so ' + e.who + ' is reaped: its entry leaves the process table.'; continue; }
      if (e.kind === 'reparent' && last && last.kind === 'reparent' && last.t === e.t) { last.evs.push(e); last.snap = e.snap; last.say = 'Their parent has exited: ' + last.evs.map((x) => '`' + x.pid + '`').join(' and ') + ' are re-parented to init (pid 1), which will reap them.'; continue; }
      // a wait that finds no child at all adds nothing to the picture, and a parent woken by its child's exit is
      // told in the exit's own sentence
      if ((e.kind === 'wait' && e.ret === -1) || (e.kind === 'wake' && e.why === 'child')) continue;
      out.push({ kind: e.kind, pid: e.pid, t: e.t, evs: [e], snap: e.snap, nterm: e.nterm, say: e.say });
    }
    return out;
  }
  /** the terminal's lines after the first n writes: [{text, pids, at}] (at: the write that ended it) */
  function termRows(term, n) {
    const rows = [];
    let cur = null;
    term.slice(0, n).forEach((w, k) => {
      const parts = w.text.split('\n');
      parts.forEach((part, i) => {
        if (!cur) { if (part === '' && i === parts.length - 1) return; cur = { text: '', pids: [], at: k }; }
        cur.text += part; if (!cur.pids.includes(w.pid)) cur.pids.push(w.pid); cur.at = k;
        if (i < parts.length - 1) { rows.push(cur); cur = null; }
      });
    });
    if (cur) rows.push(cur);
    return rows;
  }

  function layout(narrow, pr, sys) {
    const src = pr.src.split('\n'), maxD = depth(sys);
    if (narrow) {
      const W = 380, lineH = 17, codeH = 34 + src.length * lineH + 10;
      const L = { W, narrow, lineH, codeSize: 12, indent: 0.5, legend: [0, 10], code: [0, 36, W], tree: [0, 36 + codeH + 26, W], boxW: 86, boxH: 40, levelH: 54, gap: 8, rowsShown: Math.max(3, Math.min(4, termRows(sys.term, sys.term.length).length)) };
      L.term = [0, L.tree[1] + maxD * L.levelH + L.boxH + 26, W];
      L.H = L.term[1] + 32 + L.rowsShown * 24 + 8 + 16 + 34 + 4;
      L.view = box(-10, -4, W + 20, L.H + 8);
      return L;
    }
    const W = 1220, lineH = 22, codeH = 34 + src.length * lineH + 10, cw = 470, rx = cw + 40, rw = W - rx;
    const L = { W, narrow, lineH, code: [0, 0, cw], legend: [rx, 10], tree: [rx, 44, rw], boxW: 136, boxH: 46, levelH: maxD > 4 ? 66 : 74, gap: 14, rowsShown: Math.max(4, Math.min(8, termRows(sys.term, sys.term.length).length)) };
    L.time = [0, codeH + 46, cw];
    L.term = [rx, L.tree[1] + maxD * L.levelH + L.boxH + 30, rw];
    const nrows = sys.procs.length;
    L.H = Math.max(L.time[1] + nrows * 20, L.term[1] + 32 + L.rowsShown * 24 + 8 + 16 + 34);
    L.view = box(-14, -12, W + 28, L.H + 26);
    return L;
  }
  /** the deepest the tree gets in any snapshot */
  function depth(sys) {
    let best = 0;
    for (const e of sys.trace) {
      if (!e.snap) continue;
      const by = new Map(e.snap.map((p) => [p.pid, p]));
      for (const p of e.snap) { let d = 0, q = p; while (q && q.ppid && by.get(q.ppid)) { d++; q = by.get(q.ppid); } best = Math.max(best, d); }
    }
    return best;
  }

  function frames(narrow, knobs) {
    const pi = Math.max(0, Math.min(PRESETS.length - 1, Math.round(knobs.p || 0))), seed = Math.round(knobs.seed || 1);
    const pr = PRESETS[pi], sys = system(pi, seed), bs = beats(sys), Kp = S.Kit.proc;
    const L = layout(narrow, pr, sys), src = pr.src.split('\n');
    const label = (p) => (p.role === 'init' ? 'init · 1' : p.role === 'shell' ? 'sh · 2' : p.pid + (p.name ? ' · ' + p.name : ''));
    const adopted = new Set();
    // the timeline: each process's state at every beat
    const hist = new Map(sys.procs.map((p) => [p.pid, bs.map(() => null)]));
    bs.forEach((b, i) => { for (const p of b.snap) hist.get(p.pid)[i] = STATE[p.state] === 'done' ? null : STATE[p.state]; });

    return bs.map((b, bi) => {
      const items = [], snap = b.snap, act = b.pid;
      const live = snap.filter((p) => p.role === 'prog' && p.state !== 'zombie' && p.state !== 'reaped');
      const actP = snap.find((p) => p.pid === act);
      if (b.kind === 'reparent') b.evs.forEach((e) => adopted.add(e.pid));
      // the code panel, with every live process's place
      const marks = {};
      for (const p of live) (marks[p.line] = marks[p.line] || []).push({ pid: p.pid, cls: 's-' + STATE[p.state], act: p.pid === act });
      const actLine = actP && actP.role === 'prog' && actP.state !== 'reaped' ? (b.evs[0].line || actP.line) : 0;
      const code = Kp.code({ prefix: 'cd', x: L.code[0], y: L.code[1], w: L.code[2], src, lineH: L.lineH, title: pr.file, act: actLine, marks, size: L.codeSize, indent: L.indent });
      items.push(...code.items);
      // the legend and the tree
      items.push(...Kp.legend({ prefix: 'lg', x: L.legend[0], y: L.legend[1], w: narrow ? L.W : 0, entries: [{ cls: 's-ready', text: 'ready' }, { cls: 's-running', text: 'running' }, { cls: 's-blocked', text: 'blocked' }, { cls: 's-zombie', text: 'zombie' }, { cls: 's-done', text: 'reaped' }], size: 13, gap: narrow ? 12 : 18 }).items);
      const nodes = snap.slice().sort((x, y) => x.pid - y.pid).map((p) => {
        const kern = p.role !== 'prog';
        let st = p.state === 'reaped' ? 'reaped' : p.state === 'zombie' ? (narrow ? 'zombie: ' : 'zombie · exit ') + p.exitCode : p.state === 'blocked' ? (p.why === 'sleep' ? 'asleep' : p.why ? 'in ' + p.why : 'blocked') : p.state;
        if (kern && p.state === 'blocked') st = p.role === 'init' ? (narrow ? 'reaper' : 'reaps orphans') : p.why === 'idle' ? 'prompt' : 'in waitpid';
        if (!narrow && !kern && (p.state === 'running' || p.state === 'ready')) st += ' · line ' + p.line;
        const edgeCls = b.kind === 'reparent' && adopted.has(p.pid) && b.evs.some((e) => e.pid === p.pid) ? 'adopt' : adopted.has(p.pid) ? 'adopted' : b.kind === 'fork' && b.evs[0].child === p.pid ? 'new' : '';
        return { id: p.pid, parent: p.ppid, lines: [label(p), st], cls: (kern ? 'kern ' : '') + 's-' + STATE[p.state] + (p.pid === act ? ' act' : ''), dim: p.state === 'reaped', edgeCls };
      });
      const tree = Kp.tree({ prefix: 'tr', x: L.tree[0], y: L.tree[1], w: L.tree[2], nodes, boxW: L.boxW, boxH: L.boxH, levelH: L.levelH, gap: L.gap, size: narrow ? 12 : 13 });
      items.push(...tree.items);
      // the terminal and the buffers still in memory
      const rows = termRows(sys.term, b.nterm).map((r) => ({ tags: r.pids.map((pid) => ({ pid })), text: r.text, cls: b.kind === 'print' && r.at === b.nterm - 1 ? 'new' : '' }));
      const buffers = snap.filter((p) => p.buf && p.state !== 'reaped').map((p) => ({ pid: p.pid, text: p.buf }));
      items.push(...Kp.term({ prefix: 'tm', x: L.term[0], y: L.term[1], w: L.term[2], rows, rowsShown: L.rowsShown, title: 'terminal', buffers }).items);
      // the timeline, on a wide stage
      if (L.time) {
        const trows = sys.procs.map((p) => ({ id: p.pid, label: p.role === 'init' ? 'init' : p.role === 'shell' ? 'sh' : String(p.pid), cells: hist.get(p.pid).slice(0, bi + 1).concat(bs.slice(bi + 1).map(() => null)) }));
        items.push(...Kp.timeline({ prefix: 'tl', x: L.time[0], y: L.time[1], w: L.time[2], rows: trows, n: bs.length, now: bi, rowH: 20, labelW: 48, title: 'state at each step' }).items);
      }
      const title = b.kind === 'wait' && b.evs.length > 1 ? 'wait returns: reap' : TITLE[b.kind] || b.kind;
      // the program's own heading and what it shows, above everything
      const ss = narrow ? 13 : 14, sl = narrow ? 18 : 20, lines = Kp.wrap(pr.sub, L.W, ss);
      const headH = 30 + lines.length * sl + 12;
      for (const it of items) for (const k of ['y', 'y1', 'y2']) if (typeof it[k] === 'number') it[k] += headH;
      items.unshift({ key: 'hd:t', kind: 'text', x: 0, y: 14, text: pr.heading, size: narrow ? 17 : 18, cls: 'proghead' });
      lines.forEach((l, i) => items.splice(1 + i, 0, { key: 'hd:s' + i, kind: 'text', x: 0, y: 40 + i * sl, text: l, size: ss, cls: 'progsub' }));
      const view = box(L.view.x, L.view.y, L.view.w, L.view.h + headH);
      return { items, say: b.say, view, title, hold: ['exit', 'reparent', 'wait', 'fork'].includes(b.kind) ? 3200 : 2400 };
    });
  }

  D.add({
    id: 'fork-tree', order: 20, tag: 'Processes · fork', short: 'Fork tree', title: 'A fork tree, grown by a real C program',
    blurb: 'Pick a program: it runs on the simulated kernel, and each step is one thing the kernel does (a fork, a write, an exit, a re-parenting, a reap). The heading on the stage says what the program shows.',
    knobs: [
      { id: 'p', label: 'Program', type: 'select', value: 0, options: PRESETS.map((p, i) => ({ value: i, label: p.name })) },
      { id: 'seed', label: 'Schedule seed', min: 1, max: 12, step: 1, value: 1, fmt: (v) => String(Math.round(v)) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, knobs || {}); },
    trace: (knobs) => system(Math.round((knobs && knobs.p) || 0), Math.round((knobs && knobs.seed) || 1)).trace,
    presets: PRESETS,
  });
})(globalThis.Proses = globalThis.Proses || {});
