// Part 3, inter-process communication and signals: the families, and the helpers its topics share. C programs run
// on the simulated kernel (S.Kern) and are drawn with part 1's listing (S.PX.code) beside the kernel's own tables:
// each process's descriptors pointing into the open-file table, and every pipe's bytes (S.Kit.fd); or, for the
// signal topics, each process's handlers, pending signals and mask. The terminal shows what the user typed too.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'ipc', order, title, blurb });
  fam('p03-pipes', 10, 'Pipes and descriptors', 'A pipe between two processes, the descriptor tables fork copies, dup2 and redirection, and pipes with a name.');
  fam('p03-models', 20, 'Shared memory and messages', 'Two ways to talk: write into memory both can see, or hand messages to the kernel; naming, blocking and buffering.');
  fam('p03-signals', 30, 'Signals', 'Asynchronous notices to a process: who sends them, when they are delivered, handlers, masks, SIGCHLD, kill, pause and alarm.');
  fam('p03-net', 40, 'Clients, servers and remote calls', 'Sockets between a client and a server, and remote procedure calls with their stubs, bytes and retries.');
  fam('p03-shell', 50, 'Building a shell', 'A small shell in C, step by step: run a command, connect two with a pipe, redirect, and run jobs in the background.');

  const H = S.PX, X = (S.P03 = S.P03 || {});
  const cache = new Map();
  /**
   * Run a program with a script of things the user does at the terminal, each done when nothing else can run:
   * script [{key: 'C' | 'Z' | '\\'}, {type: 'text'}, {eof: true}] (atEnd: only once nothing at all can run).
   */
  X.drive = function (src, opts, script) {
    const o = Object.assign({ policy: 'fifo', snap: true, cow: false }, opts || {});
    const key = src + '\u0000' + JSON.stringify(o) + '\u0000' + JSON.stringify(script || []);
    if (cache.has(key)) return cache.get(key);
    const sys = new S.Kern.System(src, o), todo = (script || []).slice();
    for (let n = 0; n < 200000; n++) {
      // the user types while every process waits (asleep, paused or reading): before the clock jumps ahead
      if (todo.length && !todo[0].atEnd && !sys.choices().length && sys.procs.some((p) => p.role === 'prog' && p.state !== 'zombie' && p.state !== 'reaped')) {
        const a = todo.shift();
        if (a.key) sys.press(a.key); else if (a.type !== undefined) sys.type(a.type); else if (a.eof) sys.endInput();
        continue;
      }
      if (!sys.advance()) {
        const a = todo.shift();
        if (!a) { sys.done(); break; }
        if (a.key) sys.press(a.key); else if (a.type !== undefined) sys.type(a.type); else if (a.eof) sys.endInput();
        continue;
      }
      sys.step(sys.pick());
    }
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    cache.set(key, sys);
    return sys;
  };
  X.sig = (n) => S.Kern.SIGNAME[n] || 'signal ' + n;
  X.short = (n) => X.sig(n).replace(/^SIG/, '');
  /** the signals in a bit set (bit n − 1 for signal n) */
  X.bits = (m) => { const out = []; for (let s = 1; s <= 31; s++) if (m & (1 << (s - 1))) out.push(s); return out; };
  /** an open-file entry in words */
  X.ofText = function (of, ks) {
    if (!of) return '';
    if (of.kind === 'tty') return 'the terminal';
    if (of.kind === 'sink') return 'a pipe to the outside';
    if (of.kind === 'pipe') return 'pipe ' + of.pipe + ', ' + (of.end === 'r' ? 'read end' : 'write end');
    if (of.kind === 'file') { const nm = X.fileName(of.ino, ks); return 'file ' + nm + ', offset ' + of.offset; }
    return of.kind;
  };
  X.fileName = (ino, ks) => { const d = (ks && ks.files && ks.files.dir) || {}; return Object.keys(d).find((k) => d[k] === ino) || 'inode ' + ino; };
  /** part 1's listing (S.PX.code) with the process tags at 13 px, so they stay readable on a full stage */
  X.code = function (o) {
    const src = o.src.split('\n'), marks = {};
    const live = o.snap.filter((p) => p.role === 'prog' && p.state !== 'zombie' && p.state !== 'reaped');
    for (const p of live) (marks[p.line] = marks[p.line] || []).push({ pid: p.pid, cls: 's-' + H.STATE[p.state], act: p.pid === o.act });
    return S.Kit.pcode.code({ prefix: o.prefix || 'cd', x: o.x, y: o.y, w: o.w, src, lineH: o.lineH || 19, title: o.file, act: o.line || 0, marks, size: 13, tagSize: 13, indent: 0.5 });
  };
  /** the processes worth a row: the program's, not yet reaped */
  X.live = (snap) => snap.filter((p) => p.role === 'prog' && p.state !== 'reaped');
  /** the rows to draw: every live process, then the most recently reaped ones (dimmed) while there is room */
  X.rows = function (snap, max) {
    const live = X.live(snap), gone = snap.filter((p) => p.role === 'prog' && p.state === 'reaped').sort((a, b) => b.pid - a.pid);
    return live.concat(gone.slice(0, Math.max(0, (max || 4) - live.length))).sort((a, b) => a.pid - b.pid);
  };
  X.lines = (p) => [H.label(p), H.doing(p, true)];
  X.cls = (p, act) => 's-' + H.STATE[p.state] + (p.pid === act ? ' act' : '');

  /** the terminal rows up to trace index k: what processes wrote, and the lines the user typed (tag "you") */
  X.termRows = function (sys, k) {
    const writes = [];
    let nw = 0;
    sys.trace.forEach((e, i) => {
      if (i > k) return;
      if (e.kind === 'input' && e.text !== undefined) writes.push({ pid: 'you', text: e.text, t: e.t, i });
      if (e.nterm !== undefined && e.nterm > nw) { for (let j = nw; j < e.nterm; j++) writes.push(Object.assign({ i }, sys.term[j])); nw = e.nterm; }
    });
    return H.termRows(writes, writes.length).map((r) => ({ tags: r.pids.map((pid) => ({ pid, cls: pid === 'you' ? 'you' : '' })), text: r.text, at: r.at }));
  };

  /**
   * One beat of a C run: the listing on the left; on the right the legend, a row a live process (its descriptors,
   * or with panel 'sig' its signal state), the open-file table and the pipes (panel 'fd'), and the terminal.
   * o {sys, beat, src, file, panel: 'fd' | 'sig' | 'none', W (880), codeW (380), rowsShown (3), maxRows (4),
   *    hlFds: {pid: [fd]}} -> {items, h}
   */
  X.scene = function (o) {
    const b = o.beat, snap = b.snap, ks = b.ks || {}, W = o.W || 820, cw = o.codeW || 384, rx = cw + 16, rw = W - rx;
    const items = [];
    const actP = snap.find((p) => p.pid === b.pid);
    const line = actP && actP.role === 'prog' && actP.state !== 'reaped' && actP.image === 'c' ? (b.evs[0].line || actP.line) : 0;
    const code = X.code({ x: 0, y: 0, w: cw, src: o.src, file: o.file, snap: snap.filter((p) => p.image === 'c'), act: b.pid, line, lineH: o.lineH || Math.max(18, Math.min(19, Math.floor(456 / o.src.split('\n').length))) });
    items.push(...code.items);
    items.push(...H.legend('lg', rx, 10, rw));
    let y = 36;
    const live = X.rows(snap, o.maxRows || 4);
    const panel = o.panel || 'fd';
    if (panel !== 'none') { items.push(H.title('pt', rx, y + 10, panel === 'fd' ? 'descriptor tables' : 'signal state')); y += 20; }
    if (panel === 'fd') {
      const linesOf = o.linesOf || X.lines;
      const procs = live.map((p) => ({ pid: p.pid, lines: linesOf(p), cls: X.cls(p, b.pid) + (p.state === 'reaped' ? ' dim' : ''), fds: p.state === 'zombie' || p.state === 'reaped' ? [] : p.fds, hl: (o.hlFds && o.hlFds[p.pid]) || (p.pid === b.pid && b.evs[0].fd !== undefined ? [b.evs[0].fd] : []) }));
      const t = S.Kit.fd.procs({ prefix: 'fd', x: rx, y, procs, ofiles: ks.ofiles || {}, labelW: 100, cellW: 46, rowH: 40, gap: 6, maxFds: 6 });
      items.push(...t.items);
      y += t.h + 30;
      const used = new Set();
      for (const p of live) if (p.state !== 'zombie' && p.state !== 'reaped') for (const f of p.fds) if (f !== null && f !== undefined) used.add(f);
      const rows = [...used].sort((a, c) => a - c).map((id) => { const of = ks.ofiles[id]; return { id, kind: S.Kit.fd.kindOf(of), text: X.ofText(of, ks), refs: of ? of.refs : 0, cls: b.evs[0].of === id || (b.evs[0].fd !== undefined && actP && actP.fds && actP.fds[b.evs[0].fd] === id) ? 'act' : '' }; });
      items.push(H.title('oft', rx, y - 10, 'open-file table'));
      const ft = S.Kit.fd.files({ prefix: 'of', x: rx, y, w: rw, rows, rowH: 24 });
      items.push(...ft.items);
      y += ft.h + 12;
      for (const pp of Object.values(ks.pipes || {})) {
        const of = ks.ofiles || {}, readers = of[pp.r] ? of[pp.r].refs : 0, writers = of[pp.w] ? of[pp.w].refs : 0;
        const pi = S.Kit.fd.pipe({ prefix: 'pp' + pp.id, x: rx, y, w: rw, name: 'pipe ' + pp.id, buf: pp.buf, cap: pp.cap, readers, writers, cls: b.evs[0].pipe === pp.id ? 'act' : '' });
        items.push(...pi.items);
        y += pi.h + 8;
      }
      for (const name of o.files || []) {
        const ino = ks.files && ks.files.dir ? ks.files.dir[name] : undefined, node = ino !== undefined ? ks.files.inodes[ino] : null;
        if (!node) continue;
        const fi = S.Kit.fd.pipe({ prefix: 'fl' + name.replace(/\W/g, ''), x: rx, y, w: rw, name, buf: node.data, cap: 0, info: H.plural(node.data.length, 'byte') + ' on disk', cls: 'file' });
        items.push(...fi.items);
        y += fi.h + 8;
      }
      y += 16;
    } else if (panel === 'sig') {
      live.forEach((p, i) => {
        const yy = y + i * 46, mask = p.threads && p.threads[0] ? p.threads[0].mask : 0;
        items.push(H.cell('sl' + p.pid, rx, yy, 100, 40, '', 'fdproc ' + X.cls(p, b.pid) + (p.state === 'reaped' ? ' dim' : ''), { lines: (o.linesOf || X.lines)(p), rx: 8 }));
        const hs = Object.keys(p.handlers || {}).map(Number).sort((a, c) => a - c).map((s) => X.short(s) + (p.handlers[s] === 'ign' ? ': ignore' : ': ' + (p.handlers[s].fn || 'handler')));
        const gone = p.state === 'zombie' || p.state === 'reaped';
        const cells = gone ? [['handlers', '—', 'sigh'], ['pending', '—', 'sigp'], ['blocked', '—', 'sigm']] : [['handlers', hs.length ? hs.join(', ') : 'all default', 'sigh'], ['pending', X.bits(p.pending).map(X.short).join(' ') || 'none', p.pending ? 'sigp on' : 'sigp'], ['blocked', X.bits(mask).map(X.short).join(' ') || 'none', mask ? 'sigm on' : 'sigm']];
        const ws = [rw - 106 - 2 * 92 - 8, 92, 92];
        let x = rx + 106;
        cells.forEach((c, k) => { items.push(H.cell('sc' + p.pid + '_' + k, x, yy, ws[k], 40, '', 'sigcell ' + c[2], { lines: [c[0], c[1]], rx: 6 })); x += ws[k] + 4; });
      });
      y += live.length * 46 + 20;
    }
    const last = b.evs[b.evs.length - 1], k = last._i !== undefined ? last._i : o.sys.trace.indexOf(last);
    const rows = X.termRows(o.sys, k >= 0 ? k : o.sys.trace.length).map((r, i, a) => Object.assign(r, { cls: b.kind === 'print' && i === a.length - 1 ? 'new' : '' }));
    const buffers = snap.filter((p) => p.buf && p.state !== 'reaped').map((p) => ({ pid: p.pid, text: p.buf }));
    const tm = S.Kit.proc.term({ prefix: 'tm', x: rx, y, w: rw, rows, rowsShown: o.rowsShown || 3, tagSize: 13, title: 'terminal', buffers: null });
    items.push(...tm.items);
    y += tm.h;
    if (o.buffers) {
      // the stdout buffers still in user memory, at 13 px (the kit's own title is smaller)
      y += 12;
      items.push(H.title('bft', rx, y + 13, 'stdout buffers'));
      let bx = rx + 142;
      if (!buffers.length) items.push(H.text('bfn', bx, y + 13, 'all empty', 'muted', 13));
      for (const bu of buffers) {
        const txt = '"' + bu.text.replace(/\n/g, '\\n') + '"', tagW = Math.round(H.tw(bu.pid, 13, { bold: true }) + 12), ww = Math.round(tagW + H.tw(txt, 13, { mono: true }) + 22);
        items.push(H.cell('bfb' + bu.pid, bx, y - 2, ww, 24, '', 'bufbox', { rx: 6, audit: 'group' }));
        items.push(H.cell('bfp' + bu.pid, bx + 4, y + 1, tagW, 18, bu.pid, 'ptag', { rx: 9, size: 13 }));
        items.push(H.text('bfx' + bu.pid, bx + tagW + 12, y + 14, txt, 'termtext mono buf', 13));
        bx += ww + 8;
      }
      y += 24;
    }
    return { items, h: Math.max(code.h, y) };
  };
  /** the numbers of a beat for the claims check: its events, its live processes and their descriptors */
  X.meta = (b, extra) => Object.assign(H.metaOf(b), { fds: X.live(b.snap).map((p) => ({ pid: p.pid, fds: p.fds })), pipes: Object.values((b.ks && b.ks.pipes) || {}).map((p) => ({ id: p.id, n: p.buf.length, cap: p.cap })), ofiles: Object.values((b.ks && b.ks.ofiles) || {}).map((f) => ({ id: f.id, refs: f.refs, offset: f.offset })) }, extra || {});
  /** frames for a whole C run: one a beat. o: as X.scene, plus beatsOpts, view; -> F (S.Frames) with frames added */
  /** an engine sentence with its marked values kept apart: text values in quotes, numbers plain */
  X.quote = (s) => String(s || '').replace(/`([^`]*)`/g, (m, v) => (/^[-−]?[\d.]+$/.test(v) || /^\d+( \(\w+\))?$/.test(v) ? v : '"' + v + '"'));
  /** H.beats over the trace with quoted values; each beat's evs keep their place in the trace (e._i) */
  X.beats = function (sys, opts) {
    const tr = sys.trace.map((e, i) => Object.assign({}, e, { say: X.quote(e.say), who: e.who, _i: i }));
    return H.beats({ trace: tr }, opts);
  };
  X.cframes = function (o) {
    const bs = X.beats(o.sys, o.beatsOpts), F = new S.Frames(o.counters || []);
    const anyBuf = bs.some((b) => b.snap.some((p) => p.buf && p.state !== 'reaped'));
    const progs = {};
    const named = (p) => [H.label(p) + (progs[p.pid] && !p.name ? ' · ' + progs[p.pid] : ''), H.doing(p, true)];
    bs.forEach((b, i) => {
      for (const e of b.evs) if (e.kind === 'exec') progs[e.pid] = e.path;
      const sc = X.scene(Object.assign({ linesOf: named }, o, { beat: b, buffers: o.buffers !== undefined ? o.buffers : anyBuf }));
      if (o.count) o.count(F, b);
      F.add({ items: sc.items, say: b.say, meta: X.meta(b, o.extra ? o.extra(b, i, bs) : null), title: b.kind });
    });
    return { F, bs };
  };
})(globalThis.Proses = globalThis.Proses || {});
