// Part 2, processes: the families, and the helpers its topics share. Most topics run a real C program on the
// simulated kernel (S.Kern) and draw it with part 1's helpers (S.PX: the listing with each process's line, the
// tree, the terminal). Here: a run that also records every live process's variables at each event (read from its
// machine state with S.CLang.snapshot), a status word decoded as the wait macros decode it, and small pieces.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'processes', order, title, blurb });
  fam('p02-image', 10, 'A running program', 'The address space a program runs in, and the control block the kernel keeps for it.');
  fam('p02-states', 20, 'States and switches', 'The states a process moves through, and how the CPU passes from one process to another.');
  fam('p02-api', 30, 'fork, exec, wait and exit', 'Creating processes, replacing their programs, and collecting their exit statuses.');
  fam('p02-family', 40, 'Zombies and orphans', 'What is left of a process after it exits, and who reaps it when its parent is gone.');
  fam('p02-copy', 50, 'What fork copies', 'Memory shared copy-on-write, stdio buffers that are copied too, and every order a small program can print in.');

  const H = S.PX, P = (S.P02 = S.P02 || {});
  const cache = new Map();
  /**
   * Run a program to the end like S.Kern.run, with a snapshot at every event, and on every event the variables of
   * every live process: e.vars = {pid: {fn, locals: [[name, text]], globals: [[name, text]]}}, and every
   * process's state after the step that made the event: e.states = {pid: {state, line}}.
   */
  P.run = function (src, opts) {
    const o = Object.assign({ policy: 'fifo', snap: true, cow: false }, opts || {});
    const key = src + '\u0000' + JSON.stringify(o);
    if (cache.has(key)) return cache.get(key);
    const sys = new S.Kern.System(src, o);
    const look = () => {
      const out = {};
      for (const p of sys.procs) {
        if (p.role !== 'prog' || p.state === 'zombie' || p.state === 'reaped' || p.image !== 'c') continue;
        const t = sys.threads.find((x) => x.pid === p.pid && x.main && x.vm);
        if (!t) continue;
        try {
          const sn = S.CLang.snapshot(p.prog, t.vm), f = sn.frames[sn.frames.length - 1] || sn.frames[0];
          const main = sn.frames.find((x) => x.fn === 'main') || f;
          out[p.pid] = { fn: f ? f.fn : '', locals: main ? main.locals.map((v) => [v.name, v.text]) : [], globals: sn.globals.map((v) => [v.name, v.text]) };
        } catch (e) { /* a process between images has no frame to read */ }
      }
      return out;
    };
    let seen = 0;
    const tag = () => { const v = look(), st = {}; for (const p of sys.procs) st[p.pid] = { state: p.state, line: (sys.threads.find((t) => t.pid === p.pid && t.main) || {}).line || 0 }; for (; seen < sys.trace.length; seen++) { sys.trace[seen].vars = v; sys.trace[seen].states = st; } };
    tag();
    for (let n = 0; n < 200000; n++) {
      if (!sys.advance()) { sys.done(); break; }
      sys.step(sys.pick());
      tag();
    }
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    cache.set(key, sys);
    return sys;
  };
  /** the beats of a run (S.PX.beats), each with the variables at its last event */
  P.beats = function (sys, o) {
    const bs = H.beats(sys, o);
    for (const b of bs) b.vars = b.evs[b.evs.length - 1].vars || {};
    return bs;
  };
  /** a status word as wait stores it, decoded the way the W* macros do */
  P.decode = function (st) {
    const sig = st & 0x7f, code = (st >> 8) & 0xff;
    if (sig === 0) return { exited: true, code, signaled: false, sig: 0, stopped: false };
    if (sig === 0x7f) return { exited: false, signaled: false, stopped: true, sig: code, code: 0 };
    return { exited: false, signaled: true, sig, code: 0, core: !!(st & 0x80), stopped: false };
  };
  P.SIGNAME = { 1: 'SIGHUP', 2: 'SIGINT', 3: 'SIGQUIT', 6: 'SIGABRT', 8: 'SIGFPE', 9: 'SIGKILL', 10: 'SIGUSR1', 11: 'SIGSEGV', 12: 'SIGUSR2', 13: 'SIGPIPE', 14: 'SIGALRM', 15: 'SIGTERM', 17: 'SIGCHLD', 19: 'SIGSTOP', 20: 'SIGTSTP' };
  /** a choice input of programs: [{value, label}] from {key: {label}} */
  P.options = (progs) => Object.keys(progs).map((k) => ({ value: k, label: progs[k].label }));
  /** a table of variables per process: rows [{pid, vals: [text]}], names: [var names] -> {items, h} */
  P.vars = function (o) {
    const cols = [{ w: o.pidW || 70, label: 'process' }].concat(o.names.map((n) => ({ w: o.colW || 70, label: n })));
    const rows = o.rows.map((r) => [{ text: String(r.pid), cls: r.act ? 'act' : '' }].concat(r.vals.map((v, j) => ({ text: v, cls: 'mono' + (r.changed && r.changed[j] ? ' changed' : '') }))));
    const t = H.table({ prefix: o.prefix || 'vt', x: o.x, y: o.y + 18, cols, rows, rowH: o.rowH || 26, size: 13, title: o.title });
    return { items: t.items, h: t.h + 18 };
  };

  // ---- the picture of a C run, sized for the topic stage (every text at least 13px) ----
  /** the listing with each live process's place: as S.PX.code, with 13px tags */
  P.code = function (o) {
    const src = o.src.split('\n'), marks = {};
    const live = o.snap.filter((p) => p.role === 'prog' && p.state !== 'zombie' && p.state !== 'reaped' && p.image !== 'builtin' && (!o.only || o.only.includes(p.pid)));
    for (const p of live) (marks[p.line] = marks[p.line] || []).push({ pid: p.pid, cls: 's-' + H.STATE[p.state], act: p.pid === o.act });
    return S.Kit.pcode.code({ prefix: o.prefix || 'cd', x: o.x, y: o.y, w: o.w, src, lineH: o.lineH || 19, title: o.file, act: o.line || 0, marks, size: 13, tagSize: 13, indent: 0.75 });
  };
  /** the terminal after n writes (13px tags), and, with o.buffers, each stdout buffer still in memory */
  P.term = function (o) {
    const rows = H.termRows(o.sys.term, o.n).map((r) => ({ tags: r.pids.map((pid) => ({ pid })), text: r.text, cls: o.fresh && r.at === o.n - 1 ? 'new' : '' }));
    const t = S.Kit.proc.term({ prefix: o.prefix || 'tm', x: o.x, y: o.y, w: o.w, rows, rowsShown: o.rowsShown || 3, title: o.title || 'terminal', tagSize: 13, lineH: 24 });
    const items = t.items;
    let h = t.h;
    if (o.buffers) {
      const bufs = o.snap.filter((p) => p.role === 'prog' && p.state !== 'reaped' && p.state !== 'zombie');
      const y = o.y + h + 12;
      items.push(H.text('bfh', o.x, y + 14, 'stdout buffers in memory', 'title', 13));
      bufs.forEach((p, i) => {
        const yy = y + 24 + i * 28, tag = String(p.pid), tw = Math.round(H.tw(tag, 13, { bold: true }) + 12);
        items.push(H.cell('bft' + p.pid, o.x, yy + 3, tw, 20, tag, 'ptag ' + (p.buf ? 'act' : ''), { rx: 10, size: 13 }));
        items.push(H.cell('bfb' + p.pid, o.x + tw + 6, yy, o.w - tw - 6, 26, p.buf ? '"' + p.buf.replace(/\n/g, '\\n') + '"' : 'empty', 'bufline' + (p.buf ? ' full' : ''), { size: 13, align: 'left' }));
      });
      h += 12 + 24 + bufs.length * 28;
    }
    return { items, h };
  };
  /** what a process is doing, for its box: as S.PX.doing, with init and the shell named by their work when they run */
  P.doing = (p) => (p.role !== 'prog' && (p.state === 'running' || p.state === 'ready') ? 'reaping' : p.image === 'builtin' && (p.state === 'running' || p.state === 'ready') ? p.state + ' · ' + (p.name || 'program') : H.doing(p));
  /** the process tree (as S.PX.tree), each box with one line (its pid) when o.oneLine */
  P.tree = function (o) {
    const hide = new Set(o.hide || []), by = new Map(o.snap.map((p) => [p.pid, p]));
    const nodes = o.snap.filter((p) => !hide.has(p.role)).sort((x, y) => x.pid - y.pid).map((p) => {
      const kern = p.role !== 'prog', par = by.get(p.ppid);
      const edgeCls = o.adopted && o.adopted.has(p.pid) ? (o.kind === 'reparent' ? 'adopt' : 'adopted') : o.kind === 'fork' && o.child === p.pid ? 'new' : '';
      const lines = o.oneLine ? [H.label(p)] : [H.label(p), o.doingOf ? o.doingOf(p) : P.doing(p)];
      return { id: p.pid, parent: par && !hide.has(par.role) ? p.ppid : null, lines, cls: (kern ? 'kern ' : '') + 's-' + H.STATE[p.state] + (p.pid === o.act ? ' act' : ''), dim: p.state === 'reaped', edgeCls };
    });
    return S.Kit.proc.tree({ prefix: o.prefix || 'tr', x: o.x, y: o.y, w: o.w, nodes, boxW: o.boxW, boxH: o.boxH, levelH: o.levelH, gap: o.gap, size: 13 });
  };
  /**
   * One beat of a C run: the listing on the left; the legend, the tree (init and the shell hidden unless
   * o.kernel), o.extra(y, x, w) -> {items, h}, and the terminal on the right. o: {sys, beat, src, file, adopted,
   * W (870), codeW (400), kernel, rowsShown, buffers, boxW, levelH, depth}
   */
  P.scene = function (o) {
    const b = o.beat, snap = b.snap, W = o.W || 870, cw = o.codeW || 420, rx = cw + 24, rw = W - rx;
    const items = [];
    if (o.adopted && b.kind === 'reparent') b.evs.forEach((e) => o.adopted.add(e.pid));
    const actP = snap.find((p) => p.pid === b.pid);
    const line = actP && actP.role === 'prog' && actP.state !== 'reaped' && actP.image !== 'builtin' ? (b.evs[0].line || actP.line) : 0;
    const code = P.code({ x: 0, y: 0, w: cw, src: o.src, file: o.file, snap, act: b.pid, line, lineH: o.lineH });
    items.push(...code.items);
    if (!o.noTree) items.push(...S.Kit.proc.legend({ prefix: 'lg', x: rx, y: 10, w: rw, entries: [{ cls: 's-ready', text: 'ready' }, { cls: 's-running', text: 'running' }, { cls: 's-blocked', text: 'blocked' }, { cls: 's-zombie', text: 'zombie' }].concat(o.noReaped ? [] : [{ cls: 's-done', text: 'reaped' }]), size: 13, gap: 12 }).items);
    const levelH = o.levelH || 60, boxH = o.boxH || 42;
    const depth = o.depth === undefined ? Math.max(0, H.depth(o.sys) - (o.kernel ? 0 : 2)) : o.depth;
    const tree = o.noTree ? { items: [] } : P.tree({ x: rx, y: 34, w: rw, snap, act: b.pid, kind: b.kind, child: b.evs[0].child, adopted: o.adopted, hide: o.kernel ? [] : ['init', 'shell'], boxW: o.boxW || 112, boxH, levelH, gap: o.gap || 8, oneLine: o.oneLine, doingOf: o.doingOf });
    items.push(...tree.items);
    let y = o.noTree ? 0 : 34 + depth * levelH + boxH + 22;
    if (o.extra) { const ex = o.extra(y, rx, rw); items.push(...ex.items); y += ex.h + 16; }
    if (o.term !== false) {
      const tm = P.term({ x: rx, y, w: rw, sys: o.sys, n: b.nterm, snap, rowsShown: o.rowsShown || 3, fresh: b.kind === 'print', buffers: o.buffers, title: o.termTitle });
      items.push(...tm.items);
      y += tm.h;
    }
    return { items, h: Math.max(code.h, y), codeH: code.h, rowY: code.rowY };
  };
  /** the pids of a frame's program processes still alive (not zombies, not reaped) */
  P.livePids = (f) => f.meta.procs.filter((p) => p.pid >= 100 && p.state !== 'reaped' && p.state !== 'zombie').map((p) => p.pid);
  /** look a variable up in a vars record */
  P.val = (rec, name) => { if (!rec) return '—'; const l = rec.locals.find((v) => v[0] === name) || rec.globals.find((v) => v[0] === name); return l ? l[1] : '—'; };
})(globalThis.Proses = globalThis.Proses || {});
