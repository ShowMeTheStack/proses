// The File-system lab, part six: the Tables workbench. System calls from several processes run on the open-file
// layer of the engines (S.FS.Sys): after each call the calls with the current one lit, every file's bytes with the
// open-file entries' offsets pointing into them, and the three tables (S.Kit.fsTables): each process's descriptors,
// the system-wide open-file entries with their offsets and reference counts, the in-memory inodes.
//   FL.parseCalls(text) -> {calls: [{line, text, call: [name, ...args]}], error}     FL.tablesRun(v, ctx)
(function (S) {
  'use strict';
  const FL = S.FsLab, F = () => S.FS;
  const R = Math.round;

  FL.CALLS_HELP = 'one call a line, the process first: 1 open /notes rwc · 1 read 3 10 · 1 write 3 text · 1 lseek 3 0 set · 1 dup 3 · 1 fork 2 · 1 close 3 · 1 unlink /notes · 2 user 7 (process 2 runs as uid 7)';
  FL.parseCalls = function (text) {
    const calls = [], src = String(text || '').split('\n');
    const bad = (line, msg) => ({ calls, error: { line, col: 1, msg, hint: FL.CALLS_HELP } });
    for (let i = 0; i < src.length; i++) {
      const t = src[i].replace(/#.*$/, '').trim();
      if (!t) continue;
      const line = i + 1, w = t.split(/\s+/), pid = +w[0], name = w[1];
      if (!Number.isInteger(pid) || pid < 1 || pid > 9) return bad(line, 'a call starts with the process number, 1 to 9');
      const n = (k) => (/^\d+$/.test(w[k] || '') ? +w[k] : NaN);
      let call;
      switch (name) {
        case 'open': if (!/^\//.test(w[2] || '')) return bad(line, 'open needs an absolute path'); if (!/^(r|w|rw|a)c?t?$/.test(w[3] || 'r')) return bad(line, 'flags: r, w, rw or a, then c (create) and t (truncate)'); call = ['open', pid, w[2], w[3] || 'r']; break;
        case 'read': if (isNaN(n(2)) || isNaN(n(3))) return bad(line, 'read FD COUNT'); call = ['read', pid, n(2), n(3)]; break;
        case 'write': if (isNaN(n(2)) || w.length < 4) return bad(line, 'write FD TEXT'); call = ['write', pid, n(2), t.replace(/^\S+\s+\S+\s+\S+\s/, '')]; break;
        case 'lseek': if (isNaN(n(2)) || !/^-?\d+$/.test(w[3] || '')) return bad(line, 'lseek FD OFFSET [set|cur|end]'); if (w[4] && !/^(set|cur|end)$/.test(w[4])) return bad(line, 'whence is set, cur or end'); call = ['lseek', pid, n(2), +w[3], w[4] || 'set']; break;
        case 'dup': if (isNaN(n(2))) return bad(line, 'dup FD'); call = ['dup', pid, n(2)]; break;
        case 'fork': if (isNaN(n(2)) || n(2) < 1 || n(2) > 9) return bad(line, 'fork CHILD (a process number, 1 to 9)'); call = ['fork', pid, n(2)]; break;
        case 'close': if (isNaN(n(2))) return bad(line, 'close FD'); call = ['close', pid, n(2)]; break;
        case 'unlink': if (!/^\//.test(w[2] || '')) return bad(line, 'unlink PATH'); call = ['op', pid, 'unlink', w[2]]; break;
        case 'user': if (isNaN(n(2))) return bad(line, 'user UID [GID]'); call = ['proc', pid, n(2), isNaN(n(3)) ? n(2) : n(3)]; break;
        default: return bad(line, `unknown call "${name || ''}"`);
      }
      calls.push({ line, text: t.replace(/\s+/g, ' '), call });
    }
    if (!calls.length) return bad(1, 'type at least one call');
    if (calls.length > 16) return bad(calls[16].line, 'at most 16 calls, so every step can be shown');
    return { calls, error: null };
  };
  const callC = (c) => {
    const [name, pid, ...a] = c, FLG = { r: 'O_RDONLY', w: 'O_WRONLY', rw: 'O_RDWR', a: 'O_WRONLY|O_APPEND' };
    switch (name) {
      case 'open': { const f = a[1].replace(/[ct]/g, ''); return `P${pid}: open("${a[0]}", ${FLG[f]}${/c/.test(a[1]) ? '|O_CREAT' : ''}${/t/.test(a[1]) ? '|O_TRUNC' : ''})`; }
      case 'read': return `P${pid}: read(${a[0]}, buf, ${a[1]})`;
      case 'write': return `P${pid}: write(${a[0]}, "${FL.clip(a[1], 14)}", ${a[1].length})`;
      case 'lseek': return `P${pid}: lseek(${a[0]}, ${a[1]}, SEEK_${a[2].toUpperCase()})`;
      case 'dup': return `P${pid}: dup(${a[0]})`;
      case 'fork': return `P${pid}: fork() → P${a[0]}`;
      case 'close': return `P${pid}: close(${a[0]})`;
      case 'op': return `P${pid}: ${a[0]}("${a[1]}")`;
      case 'proc': return `P${pid} runs as uid ${a[0]}`;
      default: return name;
    }
  };

  FL.tablesRun = function (v, ctx) {
    const narrow = ctx.narrow, P = FL.parseCalls(FL.fromRows(v.tcalls, 'calls'));
    if (P.error) return { error: P.error, frames: [] };
    const img = F().mkfs({ bs: 256, nblocks: 64, ninodes: 16 }), sys = new (F().Sys)(img, {});
    const paths = [];
    for (const f of v.tfiles) {
      try { F().apply(img, 'create', [f.path, parseInt(f.mode, 8)]); if (f.text) F().apply(img, 'write', [f.path, 0, f.text]); paths.push(f.path); } catch (e) { return { frames: [], error: { msg: 'Files, ' + f.path + ': ' + e.message } }; }
    }
    for (const c of P.calls) if (c.call[0] === 'open' && !paths.includes(c.call[2])) paths.push(c.call[2]);
    const shownPaths = paths.slice(0, 3);
    const look = () => { const m = { text: {}, ino: {} }; for (const p of shownPaths) { try { m.ino[p] = F().lookup(img, p).ino; m.text[p] = m.ino[p] ? F().text(F().read(img, p)) : null; } catch (e) { m.ino[p] = 0; m.text[p] = null; } } return m; };
    const frames = [], trace = [];
    const lines = P.calls.map((c) => callC(c.call));
    const SX = narrow ? 0 : Math.max(300, R(Math.max(...lines.map((l) => FL.tw(l, 13, { mono: true }))) + 30));
    const BW = narrow ? 370 : Math.max(330, 990 - SX);
    const pids = new Set([1]);
    let reads = 0, writes = 0;
    const draw = (i, snap, m, act) => {
      const items = [];
      // the calls
      if (!narrow) {
        items.push(FL.head('tb:ch', 0, 14, 'the calls'));
        lines.forEach((l, k) => items.push(FL.text('tb:c' + k, 0, 40 + k * 22, FL.fit(l, SX - 20, 13, { mono: true }), 'mono' + (k === i ? ' act strong' : k > i ? ' fl-note' : ''), 13)));
      } else items.push(FL.text('tb:c', 0, 14, FL.fit(i >= 0 ? lines[i] : 'before the first call', BW, 13, { mono: true }), 'mono strong', 13));
      // the files' bytes, with the open-file entries' offsets
      let y = narrow ? 64 : 58;
      shownPaths.forEach((p, pi) => {
        const s = m.text[p], ino = m.ino[p];
        items.push(FL.head('tb:fh' + pi, SX, y - 30, FL.fit(p + (s === null ? ' (no such file)' : ' · inode ' + ino + ' · ' + s.length + ' bytes'), BW, 14, { bold: true })));
        if (s === null) { y += 34; return; }
        const n = Math.max(1, Math.min(s.length + 1, 40)), cw = Math.max(9, Math.min(22, R(BW / n)));
        const offs = snap.files.filter((f) => f.ino === ino && f.dev === 0);
        const groups = new Map();
        for (const f of offs) { const at = Math.min(f.offset, n - 1); if (!groups.has(at)) groups.set(at, []); groups.get(at).push(f.id); }
        const tags = [], levels = [];
        [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([at, ids]) => {
          const t = (ids.length > 1 ? 'entries ' : 'entry ') + ids.join(', '), w = FL.tw(t, 13, { bold: true }) + 16, cx = SX + at * cw + cw / 2;
          let lv = 0; while (levels[lv] !== undefined && levels[lv] > cx - w / 2 - 6) lv++;
          levels[lv] = cx + w / 2; tags.push({ at, ids, t, cx, lv });
        });
        const sy = y + Math.max(0, ...tags.map((g) => g.lv + 1)) * 34;
        for (let k = 0; k < n; k++) {
          const ch = k < s.length ? (s[k] === ' ' ? '␣' : s[k]) : '';
          items.push({ key: 'tb:b' + pi + '.' + k, kind: 'cell', x: R(SX + k * cw), y: R(sy), w: cw, h: 28, rx: 0, text: cw >= 13 ? ch : '', size: 13, cls: 'dk byte mono' + (k >= s.length ? ' ft-eof' : '') + (act.hot && act.hot.path === p && k >= act.hot.from && k < act.hot.to ? ' act' : '') });
        }
        for (let k = 0; k < n; k += n > 12 ? 5 : 1) items.push(FL.text('tb:x' + pi + '.' + k, SX + k * cw + cw / 2, sy + 44, String(k), 'tick', 12, 'middle'));
        for (const g of tags) items.push({ key: 'tb:h' + pi + '.' + g.ids.join('-'), kind: 'head', x: R(g.cx), y: R(sy - 2 - g.lv * 34), text: g.t, side: 'above', cls: g.ids.includes(act.file) ? '' : 'ft-off' });
        y = sy + 98;
      });
      const ty = Math.max(narrow ? 0 : 40 + lines.length * 22, y - 20) + 14;
      const tb = S.Kit.fsTables.draw({ prefix: 'tb:t', x: 0, y: ty, snap, act, widths: narrow ? [92, 118, 156] : [150, 214, 214], gap: narrow ? 24 : 86, size: narrow ? 12 : 13, name: (dev, ino) => { for (const p of paths) if (m.ino[p] === ino) return p.split('/').pop(); return ''; } });
      items.push(...tb.items);
      return items;
    };
    const tablesOf = (snap) => [
      { title: 'Descriptor tables', cols: ['process', 'fd', 'open-file entry'], rows: snap.procs.flatMap((p) => p.fds.map((d) => ['P' + p.pid + (p.uid ? ' (uid ' + p.uid + ')' : ''), String(d.fd), String(d.file)])) },
      { title: 'Open-file table', cols: ['entry', 'inode', 'mode', 'offset', 'refs'], rows: snap.files.map((f) => [String(f.id), String(f.ino), f.flags, String(f.offset), String(f.refs)]) },
      { title: 'Inode table (in memory)', cols: ['inode', 'open', 'links', 'size', 'orphan'], rows: snap.inodes.map((n) => [String(n.ino), String(n.refs), String(n.nlink), String(n.size), n.orphan ? { text: 'yes', cls: 'bad' } : 'no']) },
    ];
    let m = look(), snap = sys.snapshot();
    trace.push({ kind: 'start', say: 'The files exist; no process has opened anything.' });
    frames.push({ items: draw(-1, snap, m, {}), title: 'before', at: 0, marks: [], say: `Before the first call: ${shownPaths.length ? FL.list(shownPaths.map((p) => p + (m.text[p] === null ? ' (not there yet)' : ' (' + m.text[p].length + ' bytes)'))) : 'no files'}; process 1 runs as root with no open files. ${FL.plural(P.calls.length, 'call')} to run.`, tables: tablesOf(snap), metrics: [{ label: 'Calls', value: '0 of ' + P.calls.length }] });
    P.calls.forEach((c, i) => {
      const [name, pid, ...a] = c.call;
      let r = null, err = null;
      if (!pids.has(pid) && name !== 'proc') { err = { code: 'ESRCH', message: `there is no process ${pid}: fork it first, or give it a user line` }; }
      else {
        try {
          if (name === 'proc') { sys.proc(pid, { uid: a[0], gid: a[1] }); pids.add(pid); r = { steps: [{ kind: 'proc', say: `Process ${pid} runs as uid ${a[0]}, gid ${a[1]}, with no open files.` }], io: { reads: 0, writes: 0, hits: 0 } }; }
          else { r = sys[name](pid, ...a); if (name === 'fork') pids.add(a[0]); }
        } catch (e) { err = { code: e.code || 'ERROR', message: e.message }; }
      }
      if (r && r.io) { reads += r.io.reads; writes += r.io.writes; }
      const before = m;
      m = look(); snap = sys.snapshot();
      const act = { pid };
      if (r && name === 'open') { act.fd = r.result; const p = sys.P(pid); act.file = p.fds[r.result] && p.fds[r.result].id; }
      if (['read', 'write', 'lseek', 'dup', 'close'].includes(name)) { act.fd = name === 'dup' && r ? r.result : a[0]; const f = snap.files.find((x) => { const p = snap.procs.find((q) => q.pid === pid); const d = p && p.fds.find((z) => z.fd === act.fd); return d && d.file === x.id; }); if (f) { act.file = f.id; act.ino = f.ino; } }
      if (r && (name === 'read' || name === 'write')) {
        const st = r.steps.find((s) => s.kind === (name === 'read' ? 'read' : 'write-fd'));
        const f = snap.files.find((x) => x.id === act.file), p = f && shownPaths.find((q) => m.ino[q] === f.ino);
        if (st && p) act.hot = { path: p, from: st.from, to: st.from + (name === 'read' ? st.got : st.len) };
      }
      void before;
      const key = r ? r.steps.find((s) => s.kind === (name === 'write' ? 'write-fd' : name)) || r.steps[r.steps.length - 1] : null;
      const say = err ? `${callC(c.call)}: ${err.code}, ${err.message}. Nothing changes.` : `${callC(c.call)}: ${key ? key.say : 'done.'}${name === 'read' && r ? ' It returns "' + FL.clip(r.result, 40) + '".' : ''}`;
      trace.push({ kind: err ? 'error' : name, say });
      frames.push({
        items: draw(i, snap, m, act), title: name === 'op' ? a[0] : name === 'proc' ? 'user' : name, at: trace.length - 1, marks: [{ line: c.line, tag: 'P' + pid, cls: 'p' + ((pid - 1) % 6), act: true }],
        say, tables: tablesOf(snap),
        metrics: [{ label: 'Calls', value: (i + 1) + ' of ' + P.calls.length }, { label: 'Open-file entries', value: snap.files.length }, { label: 'Inodes in memory', value: snap.inodes.length }, { label: 'Disk reads, writes so far', value: reads + ', ' + writes }, { label: 'Orphans (unlinked, still open)', value: snap.inodes.filter((n) => n.orphan).length, cls: snap.inodes.some((n) => n.orphan) ? 'bad' : '' }],
      });
    });
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics };
  };
})(globalThis.Proses = globalThis.Proses || {});
