// Parts 1 to 3 (what an OS does, processes, IPC and signals): the families, and the helpers their topics share.
// Words and numbers for sentences, small stage items, and the picture of a real C program running on the simulated
// kernel (S.Kern): the listing with each process's line marked, the process tree coloured by state, the terminal
// with the process that wrote each line, and the stdout buffers still in memory. Every value a topic quotes comes
// from an engine's trace or snapshot; frames carry those values in meta for the claims check.
(function (S) {
  'use strict';
  const fam = (part, id, order, title, blurb) => S.family({ id, part, order, title, blurb });
  fam('intro', 'p01-roles', 10, 'What the OS gives a program', 'One CPU and one memory shared out so that every program seems to have its own, and a disk that keeps what they write.');
  fam('intro', 'p01-modes', 20, 'User mode and kernel mode', 'The mode bit, the instructions only the kernel may run, and what happens when a program tries one.');
  fam('intro', 'p01-traps', 30, 'Traps, exceptions and interrupts', 'The one path every interrupt, fault and system call takes into the kernel and back out.');
  fam('intro', 'p01-syscall', 40, 'The system-call path', 'From a library call to the kernel\'s dispatch table and back, with the result or an error number.');
  fam('intro', 'p01-lde', 50, 'Limited direct execution', 'Programs run straight on the CPU; the timer interrupt is how the kernel gets it back.');
  fam('intro', 'p01-boot', 60, 'Booting', 'From the firmware at power-on to the boot loader, the kernel and the first user process.');
  fam('intro', 'p01-structure', 70, 'How a kernel is built', 'Monolithic, layered, microkernel, modules and hybrid kernels, and the price each pays for one request.');

  const H = (S.PX = S.PX || {});
  // ---- words and numbers ----
  H.f = (v, d) => {
    if (!Number.isFinite(v)) return '?';
    const s = (+v).toFixed(d === undefined ? 2 : d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return (s === '-0' ? '0' : s).replace(/^-/, '−');
  };
  H.plural = (k, word, many) => k + ' ' + (Number(k) === 1 ? word : many || word + 's');
  H.list = (xs) => { xs = xs.map(String); return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  H.an = (w) => (/^[aeiou]/i.test(String(w)) && !/^(one|use|uni|eu)/i.test(String(w)) ? 'an ' : 'a ') + w;
  H.cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  H.hex = (n, d) => '0x' + (n >>> 0).toString(16).padStart(d || 4, '0');
  /** an engine's sentence for the narration: the backticks that mark values in a scene are dropped here */
  H.say = (s) => String(s || '')
    // a value with spaces at its ends, a newline or dots in it is quoted, so its spaces and dots read as text
    .replace(/`([^`]*)`/g, (m, v) => (/^\s|\s$|↵|\.\./.test(v) ? '"' + v + '"' : v))
    .replace(/↵/g, '\\n')
    // the engines' "A invalid opcode exception" and their ranges written with two dots
    .replace(/(^|[.:] )A (?=[aeiou])/g, '$1An ').replace(/(\d)\.\.(−|-)?(\d)/g, '$1 to $2$3');
  H.r1 = (v) => Math.round(v * 10) / 10;
  H.tw = (t, size, o) => S.textWidth(String(t), size || 13, o);
  // ---- stage items ----
  H.text = (key, x, y, text, cls, size, anchor) => { const it = { key, kind: 'text', x: H.r1(x), y: H.r1(y), text: String(text), cls: cls === undefined ? 'strong' : cls }; if (size) it.size = size; if (anchor) it.anchor = anchor; return it; };
  H.title = (key, x, y, text) => ({ key, kind: 'text', x, y, text, cls: 'title' });
  H.cell = (key, x, y, w, h, text, cls, o) => Object.assign({ key, kind: 'cell', x: H.r1(x), y: H.r1(y), w: H.r1(w), h: H.r1(h), text: text === undefined ? '' : String(text), cls: cls || '' }, o || {});
  H.box = (x, y, w, h) => ({ x, y, w, h });
  H.wrap = (text, width, size) => S.Kit.proc.wrap(text, width, size);
  /** a small table: cols [{w, label}], rows [[cell | {text, cls}]], at (x, y); -> {items, w, h} */
  H.table = function (o) {
    const P = o.prefix || 'tb', items = [], rh = o.rowH || 28, size = o.size || 13;
    let x = o.x;
    const W = o.cols.reduce((a, c) => a + c.w, 0);
    if (o.title) items.push(H.title(P + ':ti', o.x, o.y - 10, o.title));
    o.cols.forEach((c, j) => { items.push(H.cell(P + ':h' + j, x, o.y, c.w, rh, c.label, 'head', { size: Math.min(size, 13) })); x += c.w; });
    o.rows.forEach((r, i) => {
      let cx = o.x;
      r.forEach((c, j) => {
        const v = c && typeof c === 'object' ? c : { text: c };
        items.push(H.cell(P + ':c' + i + '_' + j, cx, o.y + rh * (i + 1), o.cols[j].w, rh, v.text, (v.cls || '') + (o.mono && o.mono.includes(j) ? ' mono' : ''), { size }));
        cx += o.cols[j].w;
      });
    });
    return { items, w: W, h: rh * (o.rows.length + 1) };
  };
  /** a column of sentences wrapped to a width: -> {items, h} */
  H.para = function (key, x, y, text, width, size, cls, lh) {
    const lines = H.wrap(text, width, size || 14), items = [], step = lh || Math.round((size || 14) * 1.45);
    lines.forEach((l, i) => items.push(H.text(key + i, x, y + i * step, l, cls === undefined ? '' : cls, size || 14)));
    return { items, h: lines.length * step };
  };

  // ---- a C program on the simulated kernel ----
  const cache = new Map();
  /** run a program to the end with a snapshot at every event (cached by its source and options) */
  H.kern = function (src, opts) {
    const o = Object.assign({ policy: 'fifo', snap: true, cow: false }, opts || {});
    const key = src + '\u0000' + JSON.stringify(o, (k, v) => (typeof v === 'function' ? String(v) : v));
    if (!cache.has(key)) { if (cache.size > 60) cache.delete(cache.keys().next().value); cache.set(key, S.Kern.run(src, o)); }
    return cache.get(key);
  };
  /** the trace without the snapshots, for a test or a meta */
  H.bare = (e) => { const o = {}; for (const k of Object.keys(e)) if (k !== 'snap' && k !== 'ks') o[k] = e[k]; return o; };
  /**
   * the beats of a run: one per thing worth a picture. An exit and its zombie are one; a wait and its reap are one;
   * re-parentings at one moment are one. o.skip: more kinds to leave out; o.keep: kinds to keep that are left out
   * by default (step, sleep, flush, cow-share, wake).
   */
  H.beats = function (sys, o) {
    o = o || {};
    const skip = new Set(['step', 'sleep', 'flush', 'cow-share', 'wake'].filter((k) => !(o.keep || []).includes(k)).concat(o.skip || []));
    const out = [], lastLine = {};
    for (let e of sys.trace) {
      if (e.kind === 'step' && e.line) lastLine[e.pid] = e.line;
      // the kernel names main's first line for a return from main; the line the process last ran is the one
      if ((e.kind === 'exit' || e.kind === 'zombie') && lastLine[e.pid] && e.line !== lastLine[e.pid] && /from main|calls exit/.test(e.say || '')) {
        const at = lastLine[e.pid];
        e = Object.assign({}, e, { line: at, kernelLine: e.line, say: String(e.say).replace(/at line `?\d+`?/, 'at line `' + at + '`') });
      }
      // the flush that exit does is drawn at the line the process last ran too
      if (e.kind === 'print' && /exit flushes/.test(e.say || '') && lastLine[e.pid] && e.line !== lastLine[e.pid]) e = Object.assign({}, e, { line: lastLine[e.pid], kernelLine: e.line });
      if (skip.has(e.kind)) continue;
      const last = out[out.length - 1];
      if (e.kind === 'zombie' && last && last.kind === 'exit' && last.pid === e.pid) { last.evs.push(e); last.snap = e.snap; last.ks = e.ks; last.nterm = e.nterm; last.say = e.say; continue; }
      if (e.kind === 'reap' && last && last.kind === 'wait' && last.evs[0].ret === e.pid) { last.evs.push(e); last.snap = e.snap; last.ks = e.ks; last.say = last.say.replace(/\.$/, '') + ', so ' + H.say(e.who) + ' is reaped: its entry leaves the process table.'; continue; }
      if (e.kind === 'reparent' && last && last.kind === 'reparent' && last.t === e.t) { last.evs.push(e); last.snap = e.snap; last.ks = e.ks; last.say = 'Their parent has exited: processes ' + H.list(last.evs.map((x) => x.pid)) + ' are re-parented to init (pid 1), which will reap them.'; continue; }
      if (e.kind === 'wait' && e.ret === -1 && !o.keepFailedWait) continue;
      out.push({ kind: e.kind, pid: e.pid, t: e.t, evs: [e], snap: e.snap, ks: e.ks, nterm: e.nterm, say: e.say });
    }
    for (const b of out) b.say = H.say(b.say);
    return out;
  };
  /** the terminal's lines after the first n writes: [{text, pids, at}] */
  H.termRows = function (term, n) {
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
  };
  H.STATE = { ready: 'ready', running: 'running', blocked: 'blocked', stopped: 'blocked', zombie: 'zombie', reaped: 'done' };
  H.label = (p) => (p.role === 'init' ? 'init · 1' : p.role === 'shell' ? 'sh · 2' : p.pid + (p.name ? ' · ' + p.name : ''));
  /** what a process is doing, in two or three words, for its box */
  H.doing = function (p, short) {
    const kern = p.role !== 'prog';
    if (p.state === 'reaped') return 'reaped';
    if (p.state === 'zombie') return (short ? 'zombie ' : 'zombie · exit ') + (p.status !== null && p.status !== undefined && p.exitCode === null ? 'sig' : p.exitCode);
    if (kern && p.state === 'blocked') return p.role === 'init' ? 'reaps orphans' : p.why === 'idle' ? 'prompt' : 'in waitpid';
    if (p.state === 'stopped') return 'stopped';
    if (p.state === 'blocked') return p.why === 'sleep' ? 'asleep' : p.why ? 'in ' + p.why : 'blocked';
    return p.state + (short ? '' : ' · line ' + p.line);
  };
  /** the depth of the deepest process in any snapshot of a run */
  H.depth = function (sys) {
    let best = 0;
    for (const e of sys.trace) {
      if (!e.snap) continue;
      const by = new Map(e.snap.map((p) => [p.pid, p]));
      for (const p of e.snap) { let d = 0, q = p; while (q && q.ppid && by.get(q.ppid)) { d++; q = by.get(q.ppid); } best = Math.max(best, d); }
    }
    return best;
  };
  /**
   * The code panel with every live process's place: o {prefix, x, y, w, src (text), file, snap, act (pid that moves),
   * line (its line this step), lineH, size, only: [pids] (mark only these)} -> {items, h, rowY}
   */
  H.code = function (o) {
    const src = o.src.split('\n'), marks = {};
    const live = o.snap.filter((p) => p.role === 'prog' && p.state !== 'zombie' && p.state !== 'reaped' && (!o.only || o.only.includes(p.pid)));
    for (const p of live) (marks[p.line] = marks[p.line] || []).push({ pid: p.pid, cls: 's-' + H.STATE[p.state], act: p.pid === o.act });
    const c = S.Kit.proc.code({ prefix: o.prefix || 'cd', x: o.x, y: o.y, w: o.w, src, lineH: o.lineH || 21, title: o.file, act: o.line || 0, marks, size: o.size || 13, indent: o.indent || 0.75, tagSize: o.tagSize || 13 });
    return { items: c.items, h: c.h, rowY: c.rowY };
  };
  /** the process tree of a snapshot: o {prefix, x, y, w, snap, act, kind, child, adopted: Set, boxW, boxH, levelH, hide: roles} */
  H.tree = function (o) {
    const hide = new Set(o.hide || []);
    const nodes = o.snap.filter((p) => !hide.has(p.role) && !(o.hideReaped && p.state === 'reaped')).sort((x, y) => x.pid - y.pid).map((p) => {
      const kern = p.role !== 'prog';
      const edgeCls = o.adopted && o.adopted.has(p.pid) ? (o.kind === 'reparent' ? 'adopt' : 'adopted') : o.kind === 'fork' && o.child === p.pid ? 'new' : '';
      return { id: p.pid, parent: hide.has((o.snap.find((q) => q.pid === p.ppid) || {}).role) ? null : p.ppid, lines: [o.labelOf ? o.labelOf(p) : H.label(p), o.doingOf ? o.doingOf(p) : H.doing(p, o.short)], cls: (kern ? 'kern ' : '') + 's-' + H.STATE[p.state] + (p.pid === o.act ? ' act' : ''), dim: p.state === 'reaped', edgeCls };
    });
    return S.Kit.proc.tree({ prefix: o.prefix || 'tr', x: o.x, y: o.y, w: o.w, nodes, boxW: o.boxW || 116, boxH: o.boxH || 44, levelH: o.levelH || 64, gap: o.gap === undefined ? 10 : o.gap, size: o.size || 13 });
  };
  /** the terminal after n writes, with the buffers still in memory: o {prefix, x, y, w, sys, n, snap, rowsShown, fresh, buffers: false} */
  H.term = function (o) {
    const rows = H.termRows(o.sys.term, o.n).map((r) => ({ tags: r.pids.map((pid) => ({ pid })), text: r.text, cls: o.fresh && r.at === o.n - 1 ? 'new' : '' }));
    const P = o.prefix || 'tm';
    const t = S.Kit.proc.term({ prefix: P, x: o.x, y: o.y, w: o.w, rows, rowsShown: o.rowsShown || 4, title: o.title || 'terminal', buffers: null, tagSize: o.tagSize || 13 });
    if (o.buffers === false) return t;
    // the stdout buffers still in memory, drawn here at 13px (the kit's own title is smaller than a topic allows)
    const bufs = o.snap.filter((p) => p.buf && p.state !== 'reaped');
    const by = o.y + t.h + 22, items = t.items.slice();
    items.push(H.title(P + ':btitle', o.x, by, 'stdout buffers in memory'));
    if (!bufs.length) items.push(H.text(P + ':bnone', o.x + Math.ceil(H.tw('stdout buffers in memory', 13, { caps: true, spacing: 0.07, bold: true })) + 16, by, 'all empty', 'muted', 13));
    let x = o.x, y = by + 10;
    for (const b of bufs) {
      const txt = '"' + b.buf.replace(/\n/g, '\\n') + '"', tg = Math.round(H.tw(b.pid, 13, { bold: true }) + 12), ww = Math.min(o.w, tg + H.tw(txt, 13, { mono: true }) + 22);
      if (x > o.x && x + ww > o.x + o.w) { x = o.x; y += 30; }
      items.push(H.cell(P + ':bb' + b.pid, x, y, ww, 26, '', 'bufbox', { audit: 'group' }));
      items.push(H.cell(P + ':bt' + b.pid, x + 4, y + 3, tg, 20, String(b.pid), 'ptag', { size: 13, rx: 10 }));
      items.push(H.text(P + ':bx' + b.pid, x + tg + 12, y + 18, txt, 'termtext mono buf', 13));
      x += ww + 8;
    }
    return { items, w: o.w, h: y + 26 - o.y };
  };
  /** the state legend used beside every process tree */
  H.legend = (prefix, x, y, w, extra) => S.Kit.proc.legend({ prefix, x, y, w, entries: [{ cls: 's-ready', text: 'ready' }, { cls: 's-running', text: 'running' }, { cls: 's-blocked', text: 'blocked' }, { cls: 's-zombie', text: 'zombie' }, { cls: 's-done', text: 'reaped' }].concat(extra || []), size: 13, gap: 16 }).items;
  /**
   * The whole picture of one beat of a C run: the listing on the left, the legend, tree and terminal on the right.
   * o {sys, beat, src, file, adopted (Set kept across beats), W (880), codeW (390), rowsShown, extraRight: (y) ->
   *   {items, h}, treeOpts, buffers}. -> {items, h}
   */
  H.scene = function (o) {
    const b = o.beat, snap = b.snap, W = o.W || 880, cw = o.codeW || 390, rx = cw + 26, rw = W - rx;
    const items = [];
    if (o.adopted && b.kind === 'reparent') b.evs.forEach((e) => o.adopted.add(e.pid));
    const actP = snap.find((p) => p.pid === b.pid);
    const line = actP && actP.role === 'prog' && actP.state !== 'reaped' ? (b.evs[0].line || actP.line) : 0;
    const code = H.code({ x: 0, y: 0, w: cw, src: o.src, file: o.file, snap, act: b.pid, line, lineH: o.lineH, size: o.codeSize });
    items.push(...code.items);
    items.push(...H.legend('lg', rx, 10, rw));
    const depth = o.depth === undefined ? H.depth(o.sys) : o.depth;
    const to = Object.assign({ x: rx, y: 34, w: rw, snap, act: b.pid, kind: b.kind, child: b.evs[0].child, adopted: o.adopted }, o.treeOpts || {});
    const tree = H.tree(to);
    items.push(...tree.items);
    let y = 34 + depth * (to.levelH || 64) + (to.boxH || 44) + 26;
    if (o.extraRight) { const ex = o.extraRight(y, rx, rw); items.push(...ex.items); y += ex.h + 20; }
    if (o.term !== false) {
      const tm = H.term({ x: rx, y, w: rw, sys: o.sys, n: b.nterm, snap, rowsShown: o.rowsShown || 4, fresh: b.kind === 'print', buffers: o.buffers, title: o.termTitle });
      items.push(...tm.items);
      y += tm.h;
    }
    return { items, h: Math.max(code.h, y), codeH: code.h, rowY: code.rowY };
  };
  /** the numbers of a beat for the claims check: its events without snapshots, and its live processes */
  H.metaOf = (b, extra) => Object.assign({ phase: b.kind, evs: b.evs.map(H.bare), procs: b.snap.map((p) => ({ pid: p.pid, ppid: p.ppid, state: p.state, line: p.line, exitCode: p.exitCode, status: p.status })) }, extra || {});
})(globalThis.Proses = globalThis.Proses || {});
