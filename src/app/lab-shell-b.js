// The Shell lab, part two: its pictures. The jobs view: the student's shell at the top, a line to each child it
// forked, the children grouped by process group (the foreground group marked, a stopped one too), the pipes between
// the processes of a pipeline drawn as arrows with their bytes, and under it every pipe with who holds its ends (a
// shell that forgets to close one is flagged); beside it the terminal, with what the user typed and who printed each
// line. The descriptor and signal views of the Process lab can be shown instead of the jobs. Through S.ShellLab:
//   SL.frames(run, v, ctx, src) -> frames
(function (S) {
  'use strict';
  const SL = S.ShellLab, PD = S.ProcDraw;
  const SH = 100;
  const tw = (t, size, o) => S.textWidth(String(t), size || 13, o);
  const text = PD.text, cell = PD.cell;

  function statusOf(p, b) {
    if (p.state === 'zombie') return 'zombie';
    if (p.state === 'stopped') return 'stopped';
    if (p.state === 'blocked') {
      const t = p.threads && p.threads[0], w = t && t.why;
      if (w === 'read') { const of = b.ks.ofiles[p.fds[0]]; return of && of.kind === 'tty' && p.pid === SH ? 'reading a line' : 'reading'; }
      if (w === 'sigsuspend' || w === 'pause') return 'waiting for a signal';
      return w ? 'blocked · ' + w : 'blocked';
    }
    return p.state;
  }
  /** the jobs view at beat i */
  SL.jobs = function (b, C, i, x, y, w, narrow) {
    const items = [], ks = b.ks || {}, fg = ks.tty ? ks.tty.fg : 0, act = b.main && b.main.pid;
    const sh = b.snap.find((p) => p.pid === SH);
    const shW = 180, shH = 50, cx = narrow ? x + shW / 2 + 2 : x + w / 2;
    if (sh) {
      items.push({ key: 'sh:box', kind: 'state', x: cx, y: y + shH / 2, w: shW, h: shH, rx: 9, lines: ['your shell · pid ' + SH, statusOf(sh, b)], size: 13, cls: 'pnode ' + PD.stateCls(sh.state) + (act === SH ? ' act' : ''), dim: sh.state === 'reaped' });
      if (fg === sh.pgid && sh.state !== 'reaped') items.push(text('sh:fg', cx + shW / 2 + 12, y + shH / 2 + 5, '← has the terminal', 'joblab fg', 13));
    }
    // the children, by process group, in the order they were made
    const kids = b.snap.filter((p) => p.role === 'prog' && p.pid !== SH && p.state !== 'reaped');
    const groups = [];
    for (const p of kids.sort((a, c) => a.pid - c.pid)) { let g = groups.find((q) => q.pgid === p.pgid); if (!g) groups.push((g = { pgid: p.pgid, ps: [] })); g.ps.push(p); }
    // which pipe joins two processes: writer's fd 1 and reader's fd 0 on the two ends of one pipe
    const pipeOf = (a, c) => { const wo = ks.ofiles[a.fds[1]], ro = ks.ofiles[c.fds[0]]; return wo && ro && wo.kind === 'pipe' && ro.kind === 'pipe' && wo.pipe === ro.pipe && wo.end === 'w' && ro.end === 'r' ? ks.pipes[wo.pipe] : null; };
    const pad = 10, gGap = narrow ? 12 : 18, pGap = narrow ? 46 : 62, bh = 48;
    const labW = (g) => Math.ceil(tw('group ' + g.pgid + ' · background', 13, { bold: true })) + 10;
    const widthOf = (g, bw) => Math.max(labW(g), pad * 2 + g.ps.length * bw + (g.ps.length - 1) * pGap);
    let shown = groups.slice(), bw = 104;
    for (;;) {
      const n = shown.reduce((a, g) => a + g.ps.length, 0), fixed = shown.reduce((a, g) => a + pad * 2 + (g.ps.length - 1) * pGap, 0) + (shown.length - 1) * gGap;
      bw = Math.max(narrow ? 62 : 70, n ? Math.min(118, Math.floor((w - fixed) / n)) : 104);
      const tot = shown.reduce((a, g) => a + widthOf(g, bw), 0) + (shown.length - 1) * gGap;
      if (shown.length <= 1 || (tot <= w && bw >= 80)) break;
      shown = shown.slice(1);
    }
    bw = Math.max(narrow ? 62 : 70, bw);
    const total = shown.reduce((a, g) => a + widthOf(g, bw), 0) + Math.max(0, shown.length - 1) * gGap;
    let gx = x + Math.max(0, (w - total) / 2);
    const gy = y + shH + 54;
    const pos = {};
    for (const g of shown) {
      const gw = widthOf(g, bw), isFg = g.pgid === fg, stopped = g.ps.every((p) => p.state === 'stopped'), zomb = g.ps.every((p) => p.state === 'zombie');
      items.push({ key: 'jg:' + g.pgid, kind: 'region', x: gx, y: gy, w: gw, h: bh + pad * 2, rx: 10, cls: 'jobgroup' + (isFg ? ' fg' : '') + (stopped ? ' stopped' : ''), audit: 'group', layer: 'back' });
      const lab = 'group ' + g.pgid + ' · ' + (stopped ? 'stopped' : isFg ? 'foreground' : zomb ? 'finished' : 'background');
      items.push(text('jl:' + g.pgid, gx + gw / 2, gy + bh + pad * 2 + 17, lab, 'joblab' + (isFg ? ' fg' : '') + (stopped ? ' stopped' : ''), 13, 'middle'));
      g.ps.forEach((p, k) => {
        const inner = g.ps.length * bw + (g.ps.length - 1) * pGap, bx = gx + (gw - inner) / 2 + k * (bw + pGap), by = gy + pad;
        pos[p.pid] = { x: bx, y: by };
        const st = statusOf(p, b);
        items.push({ key: 'jp:' + p.pid, kind: 'cell', x: bx, y: by, w: bw, h: bh, rx: 8, lines: [C.label(p.pid, i), st === 'zombie' ? 'zombie · ' + (p.exitCode === null ? '?' : p.exitCode) : st], size: 13, cls: 'jobproc ' + PD.stateCls(p.state) + (p.pid === act ? ' act' : '') });
        if (sh && p.ppid === SH) items.push({ key: 'je:' + p.pid, kind: 'line', x1: cx, y1: y + shH, x2: bx + bw / 2, y2: by, cls: 'pedge' });
        if (p.ppid !== SH) items.push(text('jo:' + p.pid, bx + bw / 2, by - 6, p.ppid === 1 ? 'adopted by init' : 'parent ' + p.ppid, 'jobnote hot', 12, 'middle'));
        if (k > 0) {
          const pp = pipeOf(g.ps[k - 1], p);
          if (pp) {
            const ax = bx - pGap, ay = by + bh / 2;
            items.push({ key: 'ja:' + p.pid, kind: 'edge', from: { x: ax + 2, y: ay }, to: { x: bx - 2, y: ay }, cls: 'jpipe' + (b.main && b.main.pipe === pp.id ? ' act' : '') });
            items.push(text('jt:' + p.pid, ax + pGap / 2, ay - 9, (narrow ? 'p' : 'pipe ') + pp.id, 'jpipelab', 13, 'middle'));
            items.push(text('jb:' + p.pid, ax + pGap / 2, ay + 20, pp.buf.length + ' B', 'jpipelab muted', 12, 'middle'));
          }
        }
      });
      gx += gw + gGap;
    }
    let yy = gy + bh + pad * 2 + 32;
    if (!groups.length) { items.push(text('jn', narrow ? x : cx, gy + 30, sh && sh.state !== 'zombie' && sh.state !== 'reaped' ? (narrow ? 'no children now' : 'no children: nothing has been forked, or all are reaped') : 'the shell has ended', 'muted', 13, narrow ? 'start' : 'middle')); }
    if (groups.length > shown.length) items.push(text('jm', x, gy - 10, '+' + (groups.length - shown.length) + ' older job' + (groups.length - shown.length === 1 ? '' : 's') + ' not shown', 'muted', 12));
    // every pipe, and who holds its ends
    const pipes = Object.values(ks.pipes || {});
    if (pipes.length) { items.push({ key: 'jpt', kind: 'text', x, y: yy + 13, text: 'pipes · who holds each end', cls: 'title' }); yy += 22; }
    for (const pp of pipes) {
      const hold = (end) => b.snap.filter((p) => p.state !== 'reaped' && p.state !== 'zombie' && (p.fds || []).some((f) => f !== null && f !== undefined && ks.ofiles[f] && ks.ofiles[f].kind === 'pipe' && ks.ofiles[f].pipe === pp.id && ks.ofiles[f].end === end)).map((p) => p.pid);
      const wr = hold('w'), rd = hold('r'), bad = (wr.includes(SH) || rd.includes(SH)) && sh && sh.state === 'blocked';
      const info = narrow ? 'w ' + (wr.join(',') || '–') + ' · r ' + (rd.join(',') || '–') : 'write end: ' + (wr.join(', ') || 'none') + ' · read end: ' + (rd.join(', ') || 'none');
      const t = S.Kit.fd.pipe({ prefix: 'jpp' + pp.id, x, y: yy, w, name: 'pipe ' + pp.id, buf: pp.buf, cap: pp.cap, info, cls: b.main && b.main.pipe === pp.id ? 'act' : '', cellW: 18 });
      items.push(...t.items);
      yy += t.h + 4;
      if (bad) { items.push(text('jpw' + pp.id, x, yy + 14, narrow ? 'the waiting shell holds pipe ' + pp.id + ': close it' : 'the shell waits but still holds an end of pipe ' + pp.id + ': its reader never sees end of file', 'jobwarn', 13)); yy += 22; }
      yy += 4;
    }
    return { items, h: yy - y };
  };

  SL.frames = function (run, v, ctx, src) {
    const res = { beats: run.beats, sys: run.sys, decisions: [], waiting: null };
    const C = PD.context(res, src), narrow = ctx.narrow, show = v.show || 'jobs';
    const W = narrow ? 380 : 930, LW = 548, RX = 576, RW = 354;
    const n = run.beats.length;
    let mainH = 0;
    const mains = run.beats.map((b, i) => { const m = show === 'jobs' ? SL.jobs(b, C, i, 0, 0, narrow ? W : LW, narrow) : PD.panel(show, b, C, i, 0, 0, narrow ? W : LW, { narrow }); mainH = Math.max(mainH, m.h); return m; });
    const frames = [];
    for (let i = 0; i < n; i++) {
      const b = run.beats[i], items = mains[i].items.slice();
      const typed = run.typed.slice(0, b.typed);
      const tm = narrow ? PD.term(b, C, 0, mainH + 14, W, { sys: run.sys, typed, rowsShown: 4, title: 'terminal', buffers: false }) : PD.term(b, C, RX, 0, RW, { sys: run.sys, typed, rowsShown: 11, title: 'terminal' });
      items.push(...tm.items);
      const marks = [];
      for (const p of b.snap) if (p.role === 'prog' && p.image === 'c' && p.state !== 'zombie' && p.state !== 'reaped' && p.line) marks.push({ line: p.line, tag: String(p.pid), cls: C.cls(p.pid), act: b.main && b.main.pid === p.pid, title: 'pid ' + p.pid + ', ' + p.state });
      const says = S.ProcLab.joinSays(b.evs.filter((e) => e.say && (!S.ProcLab.QUIET.has(e.kind) || e.kind === 'buffer') && !(e.kind === 'exit' && b.evs.some((z) => z.kind === 'zombie' && z.pid === e.pid))), C);
      let say = says.slice(0, 3).join(' ') || (b.main && b.main.say ? S.ProcLab.joinSays([b.main], C)[0] : '');
      if (b.runs) say = say + ' (' + b.runs + ' such steps in a row)';
      frames.push({ items, say, title: b.main ? b.main.kind : '', at: b.at, marks, hold: /^(typed|key)$/.test(b.main && b.main.kind) ? 1600 : 1100 });
    }
    return { frames, C };
  };
})(globalThis.Proses = globalThis.Proses || {});
