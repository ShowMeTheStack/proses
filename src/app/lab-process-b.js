// The Process lab, part two: its pictures, drawn from the beats of a run (lab-process-a.js). Shared with the Shell lab
// through S.ProcDraw. Each piece returns {items, h} in stage units and prefixes its keys:
//   PD.context(res, src) -> C       what stays the same over a run: the processes in order, their colours, who forked
//                                   whom, the names exec gave them, each lane of the timeline, the largest layout
//   PD.tree(b, C, x, y, w, o)       the fork tree: init, then every process, coloured by state, with its line or status;
//                                   an adopted orphan's edge to init dashed; o.pick: pids that can be clicked
//   PD.timeline(C, i, x, y, w)      one lane a process (a thread, with threads), one cell a beat, coloured by state
//   PD.term(b, C, x, y, w, o)       the terminal with each line's writers, and the stdout buffers not yet written
//   PD.panel(kind, b, C, x, y, w)   procs | buffers | fds | pages | signals | threads: the detail beside the tree
//   PD.chooser(C, res, i, x, y, w)  by hand: the choices at this beat, the one taken, or the ones to click
(function (S) {
  'use strict';
  const PD = (S.ProcDraw = S.ProcDraw || {});
  const tw = (t, size, o) => S.textWidth(String(t), size || 13, o);
  const STATE = { ready: 'ready', running: 'running', blocked: 'blocked', stopped: 'blocked', zombie: 'zombie', reaped: 'done', done: 'done' };
  PD.stateCls = (st) => 's-' + (STATE[st] || 'ready');
  const text = (key, x, y, t, cls, size, anchor) => ({ key, kind: 'text', x, y, text: t, cls: cls || '', size: size || 13, anchor: anchor || 'start' });
  const cell = (key, x, y, w, h, t, cls, extra) => Object.assign({ key, kind: 'cell', x, y, w, h, rx: 6, text: Array.isArray(t) ? undefined : t, lines: Array.isArray(t) ? t : undefined, size: 13, cls }, extra || {});
  PD.text = text; PD.cell = cell;
  const title = (key, x, y, t) => ({ key, kind: 'text', x, y, text: t, cls: 'title' });
  const sig = (n) => (S.Kern.SIGNAME[n] || 'signal ' + n);
  const bits = (m) => { const out = []; for (let s = 1; s <= 31; s++) if (m & (1 << (s - 1))) out.push(s); return out; };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  PD.context = function (res, src) {
    const C = { progs: [], parent0: {}, names: [], lanes: {}, laneIds: [], threaded: /pthread_create/.test(src || ''), maxLeaves: 1, maxLevels: 1, files: new Set(), sigs: new Set(), src };
    const name = {};
    let prog = null;
    try { prog = S.Kern.compile(src); } catch (e) { prog = null; }
    C.prog = prog;
    res.beats.forEach((b, i) => {
      for (const e of b.evs) {
        if (e.kind === 'fork' && e.child) C.parent0[e.child] = e.pid;
        if (e.kind === 'exec') name[e.pid] = String(e.path || '').split('/').pop();
        if (e.kind === 'open' && e.path) C.files.add(e.path);
        if (e.kind === 'signal' && e.sig) C.sigs.add(e.sig);
      }
      C.names.push(Object.assign({}, name));
      for (const p of b.snap) {
        if (p.role !== 'prog') continue;
        if (!C.progs.includes(p.pid)) C.progs.push(p.pid);
        for (const s of Object.keys(p.handlers || {})) C.sigs.add(+s);
        for (const s of bits(p.pending)) C.sigs.add(s);
        for (const t of p.threads || []) for (const s of bits(t.mask)) C.sigs.add(s);
        // the timeline's lanes: a process, or each of its threads
        const lanes = C.threaded ? (p.threads || []).map((t) => ({ id: t.tid, st: p.state === 'zombie' ? 'zombie' : p.state === 'reaped' ? 'done' : t.state, label: t.main ? String(p.pid) : 't' + t.tid })) : [{ id: p.pid, st: p.state, label: String(p.pid) }];
        for (const l of lanes) {
          if (!C.lanes[l.id]) { C.lanes[l.id] = { label: l.label, cells: new Array(res.beats.length).fill(null) }; C.laneIds.push(l.id); }
          C.lanes[l.id].cells[i] = STATE[l.st] || 'ready';
        }
      }
      const shown = PD.treeNodes(b, C, i);
      const kids = {};
      for (const n of shown) if (n.parent !== null) (kids[n.parent] = kids[n.parent] || []).push(n.id);
      const depth = (id, d) => Math.max(d, ...(kids[id] || []).map((k) => depth(k, d + 1)));
      C.maxLeaves = Math.max(C.maxLeaves, shown.filter((n) => !kids[n.id]).length);
      C.maxLevels = Math.max(C.maxLevels, depth(1, 1));
    });
    // each thread's register: the last value it loaded or computed (machine granularity)
    const reg = {};
    C.regs = res.beats.map((b) => { for (const e of b.evs) if (e.mstep && e.tid) reg[e.tid] = e.mstep.value; return Object.assign({}, reg); });
    C.objName = (addr) => { if (!prog) return null; for (const [nm, g] of prog.globals) if (g.addr === addr) return g.short || nm; return null; };
    // a lane once reaped stays empty
    for (const id of C.laneIds) { const c = C.lanes[id].cells; let gone = false; for (let k = 0; k < c.length; k++) { if (gone) c[k] = null; else if (c[k] === 'done') gone = true; } }
    C.cls = (pid) => 'p' + (Math.max(0, C.progs.indexOf(pid)) % 6);
    C.label = (pid, i) => { const nm = C.names[i] && C.names[i][pid]; return pid === 1 ? 'init' : pid === 2 ? 'sh' : (nm ? nm + ' ' : 'pid ') + pid; };
    return C;
  };

  /** the processes the tree shows at beat i: init, then the program's (long-reaped ones dropped when there are many) */
  PD.treeNodes = function (b, C, i) {
    let ps = b.snap.filter((p) => p.role === 'init' || p.role === 'shell' || p.role === 'prog');
    if (ps.filter((p) => p.role === 'prog').length > 9) ps = ps.filter((p) => p.role !== 'prog' || p.state !== 'reaped');
    const ids = new Set(ps.map((p) => p.pid));
    return ps.map((p) => ({ id: p.pid, parent: ids.has(p.ppid) ? p.ppid : null, p }));
  };
  function status(p, b) {
    if (p.role === 'init' || p.role === 'shell') return ['pid ' + p.pid];
    if (p.state === 'zombie') return ['zombie', 'exit ' + (p.exitCode === null || p.exitCode === undefined ? '?' : p.exitCode)];
    if (p.state === 'reaped') return ['reaped', p.reapedBy ? 'by ' + p.reapedBy : ''];
    const w = p.why && p.why !== 'idle' ? p.why : '';
    if (p.image !== 'c') return [p.state === 'stopped' ? 'stopped' : p.state, w || 'built-in'];
    return [p.state === 'stopped' ? 'stopped' : p.state, p.state === 'blocked' && w ? w : 'line ' + p.line];
  }
  PD.tree = function (b, C, i, x, y, w, o) {
    o = o || {};
    const gap = 12, bw = Math.max(76, Math.min(124, Math.floor((w - (C.maxLeaves - 1) * gap) / C.maxLeaves))), bh = 52;
    const act = b.main && b.main.pid, pick = new Set(o.pick || []);
    const nodes = PD.treeNodes(b, C, i).map((n) => {
      const p = n.p, kern = p.role !== 'prog';
      const lines = [C.label(p.pid, i)].concat(status(p, b)).filter((s) => s !== '');
      const adopted = !kern && C.parent0[p.pid] && C.parent0[p.pid] !== p.ppid;
      return { id: p.pid, parent: n.parent, lines, cls: (kern ? 'kern ' : '') + PD.stateCls(kern ? 'blocked' : p.state) + (p.pid === act ? ' act' : '') + (pick.has(p.pid) ? ' pick' : ''), dim: p.state === 'reaped', edgeCls: adopted ? 'adopt' : '' };
    });
    const t = S.Kit.proc.tree({ prefix: 'tr', x, y, w, nodes, boxW: bw, boxH: bh, levelH: bh + 20, gap, size: 13 });
    return { items: t.items, h: C.maxLevels * (bh + 20) - 20, pos: t.pos, bw, bh };
  };

  PD.timeline = function (C, i, x, y, w, o) {
    o = o || {};
    const ids = C.laneIds.filter((id) => C.lanes[id].cells.some(Boolean)).slice(0, o.maxRows || 10);
    const rows = ids.map((id) => ({ id, label: C.lanes[id].label, cells: C.lanes[id].cells.slice(0, i + 1).map((c) => c || null) }));
    const n = C.lanes[ids[0]] ? C.lanes[ids[0]].cells.length : 1;
    const items = [title('tl:title', x, y + 13, C.threaded ? 'timeline · a lane per thread' : 'timeline · a lane per process')];
    const t = S.Kit.proc.timeline({ prefix: 'tl', x, y: y + 24, w, rows, n, now: i, rowH: 20, labelW: 52, size: 13 });
    items.push(...t.items);
    return { items, h: 24 + ids.length * 20 };
  };

  PD.term = function (b, C, x, y, w, o) {
    o = o || {};
    const rows = S.ProcLab.termRows(o.sys, b.nterm, o.typed).map((r) => ({ tags: r.tags.map((t) => ({ pid: t.pid, cls: t.pid === 'you' ? 'you' : C.cls(t.pid) })), text: r.text }));
    const last = b.main && (b.main.kind === 'print' || b.main.kind === 'write');
    if (last && rows.length) rows[rows.length - 1].cls = 'new';
    const t = S.Kit.proc.term({ prefix: 'tm', x, y, w, rows, rowsShown: o.rowsShown || 4, title: o.title || 'terminal', buffers: null, tagSize: 13 });
    const items = t.items;
    let h = t.h;
    if (o.buffers !== false) {
      // the stdout buffers still in user memory: text printed but not yet written
      const bufs = b.snap.filter((p) => p.buf && p.state !== 'reaped'), by = y + h + 12, lh = 24;
      items.push(title('tm:bt', x, by + 13, 'stdout buffers'));
      let bx = x + Math.ceil(tw('stdout buffers', 13, { bold: true, caps: true, spacing: 0.07 })) + 14, yy = by;
      if (!bufs.length) items.push(text('tm:bn', bx, by + 14, 'all empty', 'legtext muted'));
      for (const p of bufs) {
        const tag = String(p.pid), tagW = Math.round(tw(tag, 13, { bold: true }) + 12), txt = '"' + p.buf.replace(/\n/g, '\\n') + '"', ww = Math.round(tagW + tw(txt, 13, { mono: true }) + 22);
        if (bx + ww > x + w && bx > x) { bx = x; yy += lh + 6; }
        items.push(cell('tm:bb' + p.pid, bx, yy - 3, ww, lh, '', 'bufbox', { audit: 'group' }));
        items.push(cell('tm:bp' + p.pid, bx + 4, yy, tagW, lh - 6, tag, 'ptag ' + C.cls(p.pid), { rx: 9 }));
        items.push(text('tm:bx' + p.pid, bx + tagW + 12, yy + 13, txt, 'termtext mono buf'));
        bx += ww + 8;
      }
      h = yy + lh - y;
    }
    return { items, h };
  };

  // ---- the detail panels -------------------------------------------------------------------------------------------
  const live = (b) => b.snap.filter((p) => p.role === 'prog' && p.state !== 'reaped');
  PD.panel = function (kind, b, C, i, x, y, w, o) {
    const f = PANELS[kind] || PANELS.procs;
    return f(b, C, i, x, y, w, o || {});
  };
  const PANELS = {
    procs(b, C, i, x, y, w) {
      const ps = b.snap.filter((p) => p.role === 'prog').slice(-9), act = b.main && b.main.pid;
      const cols = [{ w: 82, label: 'process' }, { w: 96, label: 'parent' }, { w: 80, label: 'state' }, { w: 46, label: 'line' }, { w: w - 304, label: 'exit, reaped by' }];
      const rows = ps.map((p) => ({ key: p.pid, cls: p.pid === act ? 'act' : '', cells: [C.label(p.pid, i), String(p.ppid) + (C.parent0[p.pid] && C.parent0[p.pid] !== p.ppid ? ', was ' + C.parent0[p.pid] : ''), { text: p.state, cls: PD.stateCls(p.state) }, p.image === 'c' && p.state !== 'zombie' && p.state !== 'reaped' ? String(p.line) : '–', p.state === 'reaped' ? 'exit ' + p.exitCode + ', by ' + (p.reapedBy || '?') : p.state === 'zombie' ? 'exit ' + p.exitCode + ', waiting' : '–'] }));
      const items = [title('pc:title', x, y + 13, 'process table')];
      const t = S.Kit.gantt.table({ prefix: 'pc', x, y: y + 24, cols, rows, rowH: 26, size: 13 });
      items.push(...t.items);
      return { items, h: 24 + t.h };
    },
    buffers(b, C, i, x, y, w) {
      const items = [title('bf:title', x, y + 13, 'each process’s stdout buffer')];
      let yy = y + 26;
      const act = b.main && b.main.pid;
      for (const p of live(b).slice(-5)) {
        const mode = b.modes && b.modes[p.pid], of = p.fds && p.fds[1] !== null && p.fds[1] !== undefined && b.ks.ofiles[p.fds[1]];
        const dest = !of ? 'closed' : of.kind === 'tty' ? 'terminal' : of.kind === 'sink' ? 'pipe' : of.kind === 'pipe' ? 'pipe ' + of.pipe : 'file';
        const info = (mode === 'line' ? 'line-buffered' : mode === 'full' ? 'fully buffered' : mode === 'none' ? 'unbuffered' : 'unused') + ' → ' + dest;
        const pp = S.Kit.fd.pipe({ prefix: 'bf' + p.pid, x, y: yy, w, name: C.label(p.pid, i), buf: p.state === 'zombie' ? '' : p.buf || '', cap: 0, info, cls: p.pid === act ? 'act' : '' });
        items.push(...pp.items);
        yy += pp.h + 8;
      }
      const why = b.evs.find((e) => e.kind === 'buffer' || e.kind === 'flush' || e.kind === 'print');
      if (!live(b).length) items.push(text('bf:none', x, yy + 14, 'no process is left', 'muted'));
      return { items, h: yy - y + (why ? 0 : 0) };
    },
    fds: drawFds,
    pages: (b, C, i, x, y, w, o) => drawPages(b, C, i, x, y, w, o),
    signals: (b, C, i, x, y, w, o) => drawSignals(b, C, i, x, y, w, o),
    threads: drawThreads,
  };

  function ofText(of, ks) {
    if (!of) return '';
    if (of.kind === 'tty') return 'terminal';
    if (of.kind === 'sink') return 'pipe to the outside';
    if (of.kind === 'null') return '/dev/null';
    if (of.kind === 'pipe') return 'pipe ' + of.pipe + (of.end === 'r' ? ', read end' : ', write end');
    const d = (ks.files && ks.files.dir) || {}, nm = Object.keys(d).find((k) => d[k] === of.ino) || 'inode ' + of.ino;
    return nm + ' @ ' + of.offset;
  }
  PD.ofText = ofText;
  /** descriptor tables beside the open-file table, an arrow from each descriptor to its entry; the pipes under them */
  function drawFds(b, C, i, x, y, w, o) {
    const items = [], ks = b.ks || {}, act = b.main && b.main.pid, evFd = b.main && b.main.fd;
    const ps = live(b).filter((p) => p.state !== 'zombie' && p.fds && p.fds.some((f) => f !== null && f !== undefined));
    let show = ps.slice(o.narrow ? -2 : -4);
    if (act && !show.some((p) => p.pid === act) && ps.some((p) => p.pid === act)) show = show.slice(1).concat(ps.filter((p) => p.pid === act));
    const used = [];
    for (const p of show) for (const f of p.fds) if (f !== null && f !== undefined && !used.includes(f) && ks.ofiles[f]) used.push(f);
    used.sort((a, c) => a - c);
    const cw = 34, ch = 22, cg = 3, armW = o.narrow ? 30 : 48, tx = x + cw + 6 + armW, tw2 = w - 2 * (cw + 6 + armW), rh = 24;
    items.push(title('fd:t1', x, y + 13, 'descriptor tables → open-file table'));
    const top = y + 24, rowY = (k) => top + 18 + k * (rh + 6);
    const rows = used.map((id) => { const of = ks.ofiles[id]; return { id, kind: S.Kit.fd.kindOf(of), text: ofText(of, ks), refs: of.refs, cls: show.some((p) => p.pid === act && evFd !== undefined && p.fds[evFd] === id) ? 'act' : '' }; });
    rows.forEach((r, k) => items.push(...S.Kit.fd.files({ prefix: 'of' + r.id, x: tx, y: rowY(k), w: tw2, rows: [r], rowH: rh }).items));
    const colH = [0, 0];
    show.forEach((p, k) => {
      const side = k % 2, cx = side ? x + w - cw : x, n = Math.min(8, Math.max(3, p.fds.length));
      const yy = top + colH[side];
      items.push(text('fd:h' + p.pid, side ? x + w : x, yy + 12, C.label(p.pid, i), 'fdhead ' + C.cls(p.pid) + (p.pid === act ? ' act' : ''), 13, side ? 'end' : 'start'));
      if (k < 2 && !rows.length) items.push(text('fd:none', tx, rowY(0) + 16, 'no open files', 'muted'));
      for (let fd = 0; fd < n; fd++) {
        const id = p.fds[fd], of = id === null || id === undefined ? null : ks.ofiles[id], cy = yy + 18 + fd * (ch + cg);
        const lit = p.pid === act && fd === evFd;
        items.push(cell('fd:c' + p.pid + '_' + fd, cx, cy, cw, ch, String(fd), 'fdcell ' + (of ? 'of-' + S.Kit.fd.kindOf(of) : 'closed') + (lit ? ' act' : ''), { rx: 4 }));
        if (!of) continue;
        const r = used.indexOf(id), ey = rowY(r) + rh / 2;
        items.push({ key: 'fd:a' + p.pid + '_' + fd, kind: 'edge', from: { x: side ? cx - 2 : cx + cw + 2, y: cy + ch / 2 }, to: { x: side ? tx + tw2 + 2 : tx - 2, y: ey }, cls: 'fdarrow' + (lit ? ' act' : ''), audit: 'edge-x', head: true });
      }
      colH[side] += 18 + n * (ch + cg) + 10;
    });
    let yy = Math.max(top + colH[0], top + colH[1], rowY(rows.length)) + 4;
    if (ps.length > show.length) { items.push(text('fd:more', x, yy + 12, '+' + plural(ps.length - show.length, 'more process') + ' not shown', 'muted')); yy += 22; }
    const pipes = Object.values(ks.pipes || {});
    if (pipes.length || C.files.size) { items.push(title('fd:t3', x, yy + 13, pipes.length ? 'pipes · bytes in order, oldest first' : 'files')); yy += 22; }
    for (const pp of pipes) {
      const of = ks.ofiles, rd = of[pp.r] ? of[pp.r].refs : 0, wr = of[pp.w] ? of[pp.w].refs : 0;
      const info = o.narrow ? pp.buf.length + '/' + pp.cap + ' B · r ' + rd + ', w ' + wr : pp.buf.length + '/' + pp.cap + ' B · ' + plural(rd, 'reader') + ', ' + plural(wr, 'writer');
      const t = S.Kit.fd.pipe({ prefix: 'pp' + pp.id, x, y: yy, w, name: 'pipe ' + pp.id, buf: pp.buf, cap: pp.cap, info, cls: b.main && b.main.pipe === pp.id ? 'act' : '', cellW: 18 });
      items.push(...t.items); yy += t.h + 6;
    }
    for (const name of C.files) {
      const ino = ks.files && ks.files.dir ? ks.files.dir[name] : undefined, node = ino !== undefined ? ks.files.inodes[ino] : null;
      if (!node) continue;
      const t = S.Kit.fd.pipe({ prefix: 'fl' + name.replace(/\W/g, ''), x, y: yy, w, name, buf: node.data, cap: 0, info: plural(node.data.length, 'byte'), cls: 'file', cellW: 18 });
      items.push(...t.items); yy += t.h + 6;
    }
    return { items, h: yy - y };
  }

  /** each process's pages: the frame each one maps to, shared (read-only, copy-on-write) or its own */
  function drawPages(b, C, i, x, y, w, o) {
    const items = [], prog = C.prog, ks = b.ks || {}, fr = ks.frames || {}, act = b.main && b.main.pid;
    const ps = live(b).filter((p) => p.state !== 'zombie' && p.pages && p.pages.length).slice(-4);
    items.push(title('pg:title', x, y + 13, 'pages → frames'));
    if (!prog || !ps.length) { items.push(text('pg:none', x, y + 40, ps.length ? '' : 'no process has memory now', 'muted')); return { items, h: 52 }; }
    const ps0 = 4096, n = Math.ceil(prog.memSize / ps0), dataN = Math.max(1, Math.ceil(prog.dataEnd / ps0)), heapA = Math.floor(prog.heapBase / ps0), heapB = Math.ceil(prog.heapEnd / ps0);
    if (!C.pageIdx) {
      const want = new Set();
      for (let k = 0; k < Math.min(dataN, 3); k++) want.add(k);
      if (heapB > heapA) want.add(heapA);
      want.add(n - 2); want.add(n - 1);
      C.pageIdx = [...want].filter((k) => k >= 0 && k < n).sort((a, c) => a - c);
    }
    const idx = C.pageIdx, labelW = 82, cw = Math.max(40, Math.min(58, Math.floor((w - labelW - 8) / (idx.length + 1)))), ch = 26;
    const colX = []; let cx = x + labelW + 6;
    idx.forEach((k, j) => { if (j && k > idx[j - 1] + 1) cx += cw * 0.5; colX.push(cx); cx += cw + 4; });
    const region = (k) => (k < dataN ? 'data' : k >= heapA && k < heapB ? 'heap' : 'stack');
    let yy = y + 26;
    idx.forEach((k, j) => items.push(text('pg:n' + k, colX[j] + cw / 2, yy + 13, 'p' + k, 'pgnum', 13, 'middle')));
    // region names over their columns
    let start = 0;
    for (let j = 1; j <= idx.length; j++) if (j === idx.length || region(idx[j]) !== region(idx[start])) { items.push(text('pg:r' + idx[start], (colX[start] + colX[j - 1] + cw) / 2, yy + 31, region(idx[start]), 'pgreg', 12, 'middle')); start = j; }
    yy += 40;
    const cows = new Set(b.evs.filter((e) => e.kind === 'cow').map((e) => e.pid + ':' + e.page));
    for (const p of ps) {
      items.push(cell('pg:l' + p.pid, x, yy, labelW, ch, C.label(p.pid, i), 'fdproc ' + PD.stateCls(p.state) + (p.pid === act ? ' act' : '')));
      idx.forEach((k, j) => {
        const f = p.pages[k], shared = f && fr[f] && fr[f].refs > 1;
        items.push(cell('pg:c' + p.pid + '_' + k, colX[j], yy, cw, ch, 'f' + f, 'pgcell ' + (shared ? 'shared' : 'own') + (cows.has(p.pid + ':' + k) ? ' act' : ''), { rx: 4 }));
      });
      yy += ch + 8;
    }
    const total = Object.keys(fr).length, sh = Object.values(fr).filter((f) => f.refs > 1).length;
    items.push(cell('pg:k1', x, yy + 4, 18, 18, '', 'pgcell shared', { rx: 4 }), text('pg:k1t', x + 24, yy + 18, 'shared, read-only', 'legtext'));
    items.push(cell('pg:k2', x + 170, yy + 4, 18, 18, '', 'pgcell own', { rx: 4 }), text('pg:k2t', x + 194, yy + 18, 'its own copy', 'legtext'));
    const nar = o && o.narrow;
    items.push(text('pg:sum', nar ? x : x + w, nar ? yy + 44 : yy + 18, total + ' frames, ' + sh + ' shared', 'muted', 13, nar ? 'start' : 'end'));
    if (nar) yy += 26;
    const hidden = n - idx.length;
    items.push(text('pg:more', x, yy + 44, o && o.narrow ? hidden + ' more pages, shared until written' : hidden + ' more pages (gaps above) behave the same: shared until written', 'muted'));
    return { items, h: yy + 52 - y };
  }

  /** each process's disposition of the signals the program uses, with the pending and blocked ones lit */
  function drawSignals(b, C, i, x, y, w, o) {
    const items = [], act = b.main && b.main.pid;
    let sigs = [...C.sigs].filter((s) => s > 0 && s < 32).sort((a, c) => a - c);
    if (sigs.length < 2) sigs = [...new Set(sigs.concat([2, 17]))].sort((a, c) => a - c);
    sigs = sigs.slice(0, 4);
    const ps = live(b).filter((p) => p.state !== 'reaped').slice(-4), labelW = 82, cw = Math.min(150, Math.floor((w - labelW - 6) / sigs.length) - 4), ch = 44;
    items.push(title('sg:title', x, y + 13, 'signals · disposition, pending, blocked'));
    let yy = y + 26;
    sigs.forEach((s, j) => items.push(text('sg:h' + s, x + labelW + 6 + j * (cw + 4) + cw / 2, yy + 13, sig(s), 'sighead', 13, 'middle')));
    yy += 22;
    const handling = new Set(b.evs.filter((e) => e.kind === 'handler').map((e) => e.pid + ':' + e.sig));
    for (const p of ps) {
      const mask = p.threads && p.threads[0] ? p.threads[0].mask : 0;
      items.push(cell('sg:l' + p.pid, x, yy, labelW, ch, [C.label(p.pid, i), p.state], 'fdproc ' + PD.stateCls(p.state) + (p.pid === act ? ' act' : '')));
      sigs.forEach((s, j) => {
        const h = (p.handlers || {})[s], disp = h === 'ign' ? 'ignore' : h && h.fn ? h.fn + '()' : 'default';
        const pend = p.pending & (1 << (s - 1)), blk = mask & (1 << (s - 1));
        const st = pend && blk ? 'pending, blocked' : pend ? 'pending' : blk ? 'blocked' : 'none waiting';
        items.push(cell('sg:c' + p.pid + '_' + s, x + labelW + 6 + j * (cw + 4), yy, cw, ch, [disp, st], 'sigcell' + (pend ? ' sigp on' : blk ? ' sigm on' : '') + (handling.has(p.pid + ':' + s) ? ' act' : '')));
      });
      yy += ch + 6;
    }
    const run = b.snap.filter((p) => p.threads && p.threads.some((t) => t.why === 'pause' || t.why === 'sigsuspend'));
    const nar = o && o.narrow, note = b.evs.find((e) => e.kind === 'handler') ? (nar ? 'a handler is running' : 'a handler is running: the process’s place is saved until it returns') : run.length ? plural(run.length, 'process') + (nar ? ' asleep in pause' : ' asleep in pause, waiting for a signal') : '';
    if (note) items.push(text('sg:note', x, yy + 16, note, 'muted'));
    return { items, h: yy + 24 - y };
  }

  /** the threads of a process, its mutexes with owner and queue, and its shared variables */
  function drawThreads(b, C, i, x, y, w, o) {
    const items = [], Y = S.Kit.sync7, p = live(b).find((q) => q.threads && q.threads.length > 1) || live(b).find((q) => q.image === 'c');
    items.push(title('th:title', x, y + 13, 'threads'));
    if (!p) { items.push(text('th:none', x, y + 40, 'no process is left', 'muted')); return { items, h: 52 }; }
    const regs = C.regs ? C.regs[i] : {};
    const ths = p.threads.map((t) => ({ id: t.tid, name: t.main ? 'main ' + t.tid : 'T' + t.tid, state: t.state === 'stopped' ? 'blocked' : t.state, act: b.main && (b.main.tid === t.tid || (!b.main.tid && t.main && b.main.pid === p.pid)), sub: (t.state === 'done' ? 'done' : 'line ' + t.line) + (regs && regs[t.tid] !== undefined ? ' · reg ' + regs[t.tid] : '') }));
    const tw0 = Math.min(118, Math.floor((w - 12 * 3) / Math.max(3, ths.length)));
    const t = Y.threads({ prefix: 'th', x, y: y + 24, threads: ths, w: tw0, h: 36, gap: 12, size: 14, perRow: 4 });
    items.push(...t.items);
    let yy = y + 24 + t.h + 18;
    const g = (b.globals && b.globals[p.pid]) || [];
    const nameOf = (addr) => { const v = g.find((x2) => x2.addr === addr); return v ? v.name : String(addr); };
    for (const o of Object.values((b.ks && b.ks.objs) || {})) {
      if (o.kind !== 'mutex' || o.pid !== p.pid) continue;
      const nm = (C.objName && C.objName(o.addr, p)) || 'mutex';
      const m = Y.mutex({ prefix: 'mx' + o.addr, x, y: yy + 12, name: nm, owner: o.owner ? 'T' + o.owner : null, queue: o.q.map((q) => 'T' + q), nameW: Math.max(56, Math.ceil(tw(nm, 16, { bold: true })) + 14), ownerW: 62, qw: 54 });
      items.push(...m.items); yy += 56;
    }
    // the shared variables and this step's loads, adds and stores: under the timeline when there is room (o.left)
    const L = o.left || { x, y: yy, w };
    let ly = L.y;
    const steps = b.evs.filter((e) => e.mstep);
    if (g.length) {
      const v = Y.vars({ prefix: 'gv', x: L.x, y: ly, title: 'shared variables', rows: g.slice(0, 4).map((r) => ({ name: r.name, value: r.value, act: steps.some((e) => e.mstep.addr === r.addr && e.mstep.what === 'store'), hot: steps.some((e) => e.mstep.addr === r.addr && e.mstep.what === 'load') })), nameW: 92, valW: 64, rowH: 32, size: 15 });
      items.push(...v.items); ly += v.h + 6;
    }
    if (C.machine) {
      items.push(title('th:mt', L.x, ly + 13, 'this step, machine by machine'));
      ly += 22;
      if (!steps.length) items.push(text('th:m0', L.x, ly + 14, 'no load or store in this step', 'muted'));
      steps.slice(-3).forEach((e, k) => {
        const m = e.mstep, who = 'T' + e.tid, what = m.what === 'load' ? who + ' loads ' + nameOf(m.addr) + ' = ' + m.value + ' into its register' : m.what === 'store' ? who + ' stores ' + m.value + ' into ' + nameOf(m.addr) : m.what === 'op' ? who + ' computes ' + m.value + ' in its register' : who + ' copies memory';
        items.push(text('th:ms' + k, L.x, ly + 14, what, 'msay ' + (m.what === 'store' ? 'good' : '')));
        ly += 22;
      });
      ly += 4;
    }
    if (!o.left) yy = ly;
    return { items, h: yy - y, leftH: o.left ? ly - o.left.y : 0 };
  }

  /** by hand: the row of choices; at the last beat they can be clicked */
  PD.chooser = function (C, res, i, x, y, w) {
    const b = res.beats[i], last = i === res.beats.length - 1, items = [];
    const nameOf = (c) => (typeof c === 'string' ? 'alarm ' + c.slice(1) : C.threaded ? (PD.pidOf(res, c) === c ? 'main ' + c : 'T' + c) : String(c));
    if (last && res.waiting) {
      items.push(text('ch:lab', x, y + 19, 'your turn · run next:', 'chlab strong', 14));
      let cx = x + Math.ceil(tw('your turn · run next:', 14, { bold: true })) + 12;
      for (const c of res.waiting) { const t = nameOf(c), cw = Math.ceil(tw(t, 14, { bold: true })) + 26; items.push(cell('pick:' + c, cx, y + 2, cw, 26, t, 'pickchip ' + (typeof c === 'number' ? C.cls(S.ProcDraw.pidOf(res, c)) : 'alarm'), { rx: 13, size: 14 })); cx += cw + 8; }
      if (res.decisions.length) { const t = '↶ undo'; items.push(cell('pick:undo', cx + 8, y + 2, Math.ceil(tw(t, 13)) + 22, 26, t, 'pickchip undo', { rx: 13 })); }
    } else if (b.choice !== null && b.choice !== undefined) {
      const forced = !res.decisions.includes(b.choice) || false;
      items.push(text('ch:lab', x, y + 19, (last ? 'finished · ' : '') + 'this step: ' + nameOf(b.choice) + ' ran' + (forced && typeof b.choice === 'number' && b.choice <= 2 ? ' (init reaps on its own)' : ''), 'chlab', 14));
    } else items.push(text('ch:lab', x, y + 19, last ? 'every process has finished' : 'the start: only ' + (C.progs[0] || 100) + ' can run', 'chlab', 14));
    return { items, h: 32 };
  };
  PD.pidOf = (res, tid) => { const t = res.sys.thread(tid); return t ? t.pid : tid; };
})(globalThis.Proses = globalThis.Proses || {});
