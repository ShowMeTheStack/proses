// The File-system lab, part one: what its workbenches share (S.FsLab, FL). Drawing helpers, the command language
// the student types (or clicks) and its parser, and the bench: a run of commands on a real disk image through the
// open-file layer of the engines (S.FS.Sys), with every operation's transaction and commit kept, so the picture can
// show exactly which blocks each command changed, what the journal holds, and where the power was cut.
//   FL.parse(text) -> {cmds: [{line, text, op, args}], error: {line, col, msg, hint} | null}
//   FL.bench(v, cmds, {cutAt}) -> {devs, recs: [rec..], cut, final}   (lab-fs-b.js draws the records)
// The bench uses S.FS.Sys as it is, with one adapter: Sys.run (prepare and commit one operation) is replaced on the
// instance by the same steps that also keep the transaction, the image before it, and the commit's writes, and that
// can cut the power after any write of the commit (opts.crashAfter of S.FS.commit).
(function (S) {
  'use strict';
  const FL = (S.FsLab = S.FsLab || {});
  const F = () => S.FS;
  const R = Math.round;
  const r1 = (v) => Math.round(v * 10) / 10;

  // ---- small words and drawing helpers --------------------------------------------------------------------------
  FL.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  FL.list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  FL.grp = (n) => String(R(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  FL.bytes = (n) => { const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? +n.toPrecision(3) : n) + ' ' + u[i]; };
  FL.range = (a, b) => (a === b ? String(a) : a + '–' + b);
  FL.runs = function (list) {
    const s = [...new Set(list)].sort((a, b) => a - b), out = [];
    for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(FL.range(s[i], s[j])); i = j + 1; }
    return out.join(', ');
  };
  FL.tw = (t, size, o) => S.textWidth(String(t), size || 14, o);
  FL.fit = function (text, w, size, o) {
    let t = String(text);
    if (FL.tw(t, size, o) <= w) return t;
    while (t.length > 1 && FL.tw(t + '…', size, o) > w) t = t.slice(0, -1);
    return t + '…';
  };
  FL.text = (key, x, y, text, cls, size, anchor) => ({ key, kind: 'text', x: r1(x), y: r1(y), text: String(text), size: size || 14, cls: cls || '', anchor: anchor || 'start' });
  FL.head = (key, x, y, text) => FL.text(key, x, y, text, 'strong', 14);
  FL.cell = (key, x, y, w, h, text, cls, size, extra) => Object.assign({ key, kind: 'cell', x: r1(x), y: r1(y), w: r1(w), h: r1(h), rx: 4, size: size || 13, cls: cls || '' }, Array.isArray(text) ? { lines: text.map(String) } : { text: text === undefined || text === null ? '' : String(text) }, extra || {});
  FL.panel = (key, x, y, w, h, cls) => ({ key, kind: 'region', x: r1(x), y: r1(y), w: r1(w), h: r1(h), rx: 8, cls: 'panel ' + (cls || ''), audit: 'group' });
  FL.para = (prefix, x, y, text, maxW, size, cls) => S.Kit.disk.para({ prefix, x, y, text, maxW, size: size || 14, cls: cls || '' });
  FL.legend = (prefix, x, y, entries, maxW) => S.Kit.disk.legend({ prefix, x, y, entries, maxW, size: 13 });
  FL.box = (x, y, w, h) => ({ x, y, w, h });
  FL.clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  /** printable text of some bytes: control bytes and zeros as dots */
  FL.show = (u, n) => { let s = ''; for (let i = 0; i < Math.min(u.length, n || u.length); i++) { const c = u[i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : '·'; } return s; };

  // ---- the command language ------------------------------------------------------------------------------------
  // one command a line; # starts a comment. A size in square brackets, [300 bytes], stands for that many bytes of text.
  const FILL = 'The tide turns at six; the lamp is lit at dusk and the boats come in. ';
  FL.filler = (n, k) => { let s = ''; while (s.length < n) s += FILL; return s.slice((k || 0) % FILL.length).concat(s).slice(0, n); };
  FL.HELP = [
    ['mkfs', 'a fresh, empty file system'],
    ['mkdir PATH [MODE]', 'a directory (MODE in octal, like 755)'],
    ['create PATH [MODE]', 'an empty file'],
    ['write PATH OFFSET TEXT', 'or [N bytes] instead of the text'],
    ['append PATH TEXT', 'or [N bytes]'],
    ['read PATH [OFFSET [LENGTH]]', 'open, read, close'],
    ['link EXISTING NEW', 'a second name (a hard link)'],
    ['symlink TARGET PATH', 'a symbolic link holding TARGET'],
    ['unlink PATH', 'remove a name'], ['rmdir PATH', 'remove an empty directory'],
    ['rename FROM TO', 'move a name'], ['truncate PATH SIZE', 'cut or extend a file'],
    ['chmod PATH MODE', 'permission bits, in octal'], ['chown PATH UID [GID]', 'as root only'],
    ['mount PATH', 'a second, empty file system on a directory'], ['umount PATH', ''],
    ['sync', 'write every dirty block home'], ['compact', 'contiguous allocation: slide files down'],
    ['user UID [GID]', 'run the commands after it as this user (0 is root)'],
  ];
  const ARGS = { mkfs: [0, 0], mkdir: [1, 2], create: [1, 2], write: [2, 2], append: [1, 1], read: [1, 3], link: [2, 2], symlink: [2, 2], unlink: [1, 1], rmdir: [1, 1], rename: [2, 2], truncate: [2, 2], chmod: [2, 2], chown: [2, 3], mount: [1, 1], umount: [1, 1], sync: [0, 0], compact: [0, 0], user: [1, 2] };
  FL.OPS = Object.keys(ARGS);
  FL.WRITES = new Set(['mkdir', 'create', 'write', 'append', 'link', 'symlink', 'unlink', 'rmdir', 'rename', 'truncate', 'chmod', 'chown', 'compact']);
  const isPath = (s) => /^\/[^\s]*$/.test(s);

  FL.parse = function (text) {
    const cmds = [], src = String(text || '').split('\n');
    const bad = (line, col, msg, hint) => ({ cmds, error: { line, col: col || 1, msg, hint: hint || '' } });
    for (let i = 0; i < src.length; i++) {
      const raw = src[i].replace(/#.*$/, ''), t = raw.trim();
      if (!t) continue;
      const line = i + 1, col = raw.indexOf(t) + 1;
      const m = t.match(/^(\S+)\s*(.*)$/), op = m[1], rest = m[2];
      if (!ARGS[op]) return bad(line, col, `unknown command "${op}"`, 'the commands are ' + FL.OPS.join(', '));
      let words = rest ? rest.split(/\s+/) : [];
      // the text of write and append runs to the end of the line
      let data = null;
      if (op === 'write' || op === 'append') {
        const k = op === 'write' ? 2 : 1;
        if (words.length < k + 1) return bad(line, col, `${op} needs ${op === 'write' ? 'a path, an offset and' : 'a path and'} some text`, 'text, or a size like [300 bytes]');
        const tail = rest.replace(op === 'write' ? /^\S+\s+\S+\s?/ : /^\S+\s?/, '');
        const sz = tail.trim().match(/^\[\s*(\d+)\s*(bytes?|b)?\s*\]$/i);
        if (sz) { const n = +sz[1]; if (n < 1 || n > 1048576) return bad(line, col, 'a size of 1 to 1048576 bytes'); data = { size: n }; } else data = { text: tail };
        words = words.slice(0, k);
      }
      const [lo, hi] = ARGS[op];
      if (words.length < lo || words.length > hi) return bad(line, col, `${op} takes ${lo === hi ? lo : lo + ' to ' + hi} argument${hi === 1 ? '' : 's'}`, (FL.HELP.find((h) => h[0].split(' ')[0] === op) || [''])[0]);
      const num = (w, what, max) => { if (!/^\d+$/.test(w)) return { err: what + ' must be a whole number' }; const n = +w; return n > max ? { err: what + ' must be at most ' + max } : { n }; };
      const oct = (w) => (/^[0-7]{1,4}$/.test(w) ? { n: parseInt(w, 8) } : { err: 'a mode is 3 octal digits, like 644' });
      const args = [];
      for (const [k, w] of words.entries()) {
        const want = op === 'symlink' && k === 0 ? 'target' : ['write', 'read', 'truncate'].includes(op) && k >= 1 ? 'num' : ['mkdir', 'create', 'chmod'].includes(op) && k === (op === 'chmod' ? 1 : 1) ? 'mode' : op === 'chown' && k >= 1 ? 'id' : op === 'user' ? 'id' : 'path';
        if (want === 'path' && !isPath(w)) return bad(line, col, `"${w}" is not an absolute path`, 'paths start with /, like /notes/todo');
        if (want === 'path' && w.split('/').some((p) => p.length > F().NAME_MAX)) return bad(line, col, `a name in "${w}" is longer than ${F().NAME_MAX} characters`);
        if (want === 'target') { if (w.length > 120) return bad(line, col, 'a symlink target of at most 120 characters'); args.push(w); continue; }
        if (want === 'num') { const r = num(w, k === 1 ? 'the offset' : 'the length', 1 << 30); if (r.err) return bad(line, col, r.err); args.push(r.n); continue; }
        if (want === 'mode') { const r = oct(w); if (r.err) return bad(line, col, r.err); args.push(r.n); continue; }
        if (want === 'id') { const r = num(w, 'an id', 255); if (r.err) return bad(line, col, r.err); args.push(r.n); continue; }
        args.push(w);
      }
      if (op === 'truncate' && args.length < 2) return bad(line, col, 'truncate needs a path and a size');
      if (data) args.push(data);
      cmds.push({ line, text: t.replace(/\s+/g, ' '), op, args });
    }
    if (!cmds.length) return bad(1, 1, 'type at least one command', 'for example: create /notes');
    if (cmds.length > 24) return bad(cmds[24].line, 1, 'at most 24 commands, so every step can be shown');
    return { cmds, error: null };
  };
  /** a script written as text, as the rows of a table field, and back: kind 'calls' {p, call, a, b}, 'cmd' {op, name, arg} */
  FL.toRows = (text, kind) => String(text).split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).map((l) => {
    const w = l.split(/\s+/);
    if (kind === 'calls') return { p: +w[0], call: w[1], a: w[2] || '', b: l.replace(/^\S+\s+\S+\s*\S*\s?/, '') };
    return { op: w[0], name: w[1] || '', arg: l.replace(/^\S+\s*\S*\s?/, '') };
  });
  FL.fromRows = (rows, kind) => (rows || []).map((r) => (kind === 'calls' ? [r.p, r.call, r.a, r.b] : [r.op, r.name, r.arg]).filter((x) => x !== '' && x !== undefined && x !== null).join(' ')).join('\n');
  /** the bytes of a write's data argument, as text */
  FL.dataOf = (d, k) => (d.text !== undefined ? d.text : FL.filler(d.size, k));

  // ---- the bench ---------------------------------------------------------------------------------------------------
  /** the geometry the setup asks for */
  FL.geo = (v) => ({ bs: v.bs, nblocks: v.nblocks, ninodes: v.ninodes, isz: v.isz || undefined, ndirect: v.ndirect, levels: v.levels, ps: v.ps, alloc: v.alloc, jblocks: v.journal === 'none' ? 0 : v.jblocks, groups: v.groups || 1 });
  FL.STALE = 'OLD BYTES OF A DELETED FILE. ';
  FL.sysOpts = (v) => ({ mode: v.journal === 'none' ? 'none' : v.journal, checkpoint: v.cache === 'write-back' ? 'lazy' : 'eager', cache: v.cache === 'none' ? { capacity: 0 } : { capacity: v.cacheBlocks, policy: v.cache } });

  function newSys(v, img) {
    const sys = new (F().Sys)(img, FL.sysOpts(v)), bench = { caps: [], cut: null };
    sys.run = function (d, cred, op, args, steps, dataSet) {
      const before = F().cloneLive(d.img);
      const tx = F().prepareAs(d.img, { cred, read: this.reader(d, dataSet) }, op, args);
      steps.push(...tx.trace);
      const mode = d.img.g.jblocks ? this.mode : 'none', writes = tx.writes();
      const opts = { mode, checkpoint: this.checkpointMode, defer: this.deferred };
      if (bench.cut !== null) opts.crashAfter = bench.cut;
      const c = F().commit(d.img, tx, opts);
      if (this.deferred) for (const b of c.deferred) this.cache.write(d.dev + ':' + b, dataSet && dataSet.has(b) ? 'data' : 'meta');
      else { this.io.writes += c.applied; for (const w of c.writes.slice(0, c.applied)) { this.disk.push(w.block); if (this.cache.capacity && (w.phase === 'home' || w.phase === 'data' || w.phase === 'checkpoint')) this.cache.insert(d.dev + ':' + w.block, 'meta'); } }
      bench.caps.push({ dev: d.dev, op, args, cred, before, writes, trace: tx.trace, commit: c, mode, checkpoint: this.checkpointMode, deferred: !!this.deferred });
      return tx.result;
    };
    return { sys, bench };
  }

  /** a copy of what a device holds now: the disk, the blocks dirty in memory, the journal */
  FL.snap = (img) => ({ g: img.g, bytes: img.bytes.slice(), mem: img.overlay ? new Map([...img.overlay].map(([b, u]) => [b, u.slice()])) : new Map(), open: img.open ? new Map(img.open) : new Map() });
  /** the file system as mounted from a snapshot (overlay first), as an image the engines can read */
  FL.live = (sn) => { const im = F().image(sn.g, sn.bytes.slice()); im.overlay = new Map([...sn.mem].map(([b, u]) => [b, u.slice()])); return im; };
  FL.disk = (sn) => F().image(sn.g, sn.bytes.slice());

  /**
   * run the commands: opts.cutAt (null: no crash) cuts the power after that many writes of the last command that
   * changes blocks. Each record: {i, cmd, ok, err, caps, io, steps, devs: [snap], reads, lost, pid}
   */
  FL.bench = function (v, cmds, opts) {
    opts = opts || {};
    const geo = FL.geo(v);
    let img = F().mkfs(geo, FL.STALE), S0 = newSys(v, img), sys = S0.sys, bench = S0.bench, pid = 1, mounts = 0;
    const users = new Map([[0, 1]]);
    const recs = [], lastW = cmds.map((c) => FL.WRITES.has(c.op)).lastIndexOf(true);
    const devSnaps = () => sys.devs.map((d) => Object.assign(FL.snap(d.img), { at: d.at, dev: d.dev }));
    const first = { i: -1, devs: devSnaps(), io: { reads: 0, writes: 0, hits: 0 } };
    cmds.forEach((cmd, i) => {
      const rec = { i, cmd, ok: true, err: null, caps: [], io: { reads: 0, writes: 0, hits: 0 }, steps: [], reads: [], pid, uid: sys.P(pid).cred.uid };
      const d0 = sys.disk.length;
      bench.caps = [];
      bench.cut = i === lastW && opts.cutAt !== null && opts.cutAt !== undefined ? opts.cutAt : null;
      const k = i * 7;
      const res = (r) => { if (r) { rec.steps.push(...r.steps); rec.io.reads += r.io.reads; rec.io.writes += r.io.writes; rec.io.hits += r.io.hits; } return r; };
      try {
        const a = cmd.args;
        switch (cmd.op) {
          case 'mkfs': img = F().mkfs(geo, FL.STALE); ({ sys, bench } = newSys(v, img)); pid = 1; users.clear(); users.set(0, 1); rec.steps.push({ kind: 'mkfs', say: `mkfs writes a fresh file system: an empty root directory, inode ${F().ROOT}, and every other inode and data block free.` }); break;
          case 'user': {
            const uid = a[0], gid = a[1] === undefined ? a[0] : a[1];
            if (!users.has(uid)) { const p2 = 100 + users.size; sys.proc(p2, { uid, gid }); users.set(uid, p2); }
            pid = users.get(uid); sys.P(pid).cred.gid = gid;
            rec.steps.push({ kind: 'user', say: uid === 0 ? 'The commands after this run as root (uid 0), who may do anything.' : `The commands after this run as uid ${uid}, gid ${gid}: the permission bits decide what they may do.` });
            break;
          }
          case 'write': res(sys.op(pid, 'write', a[0], a[1], FL.dataOf(a[2], k))); break;
          case 'append': res(sys.op(pid, 'append', a[0], FL.dataOf(a[1], k))); break;
          case 'read': {
            const o = res(sys.open(pid, a[0], 'r')), fd = o.result;
            const st = sys.stat(pid, a[0]).result, off = a[1] || 0, len = a[2] === undefined ? Math.max(0, st.size - off) : a[2];
            if (off) res(sys.lseek(pid, fd, off, 'set'));
            const r = res(sys.read(pid, fd, len));
            res(sys.close(pid, fd));
            rec.got = r.result;
            rec.readDev = sys.where(a[0]).d.dev;
            break;
          }
          case 'mount': { const im2 = F().mkfs(Object.assign({}, geo), FL.STALE); res(sys.mount(a[0], im2)); mounts++; break; }
          case 'umount': res(sys.umount(a[0])); break;
          case 'sync': res(sys.sync()); break;
          case 'compact': res(sys.op(pid, 'compact')); break;
          case 'mkdir': case 'create': res(sys.op(pid, cmd.op, a[0], a[1] === undefined ? undefined : a[1])); break;
          default: res(sys.op(pid, cmd.op, ...a));
        }
      } catch (e) {
        rec.ok = false; rec.err = { code: e.code || 'ERROR', message: e.message };
      }
      rec.caps = bench.caps.slice();
      rec.reads = sys.disk.slice(d0);
      rec.cut = bench.cut;
      if (bench.cut !== null && rec.caps.length) {
        // the power fails: memory is lost (dirty cache blocks, open files, the journal's memory)
        const cap = rec.caps[rec.caps.length - 1];
        rec.cutInfo = { n: cap.commit.writes.length, k: Math.min(bench.cut, cap.commit.writes.length), deferred: cap.deferred };
        rec.lost = sys.crash().lost;
        rec.devsCut = devSnaps();
        const rc = sys.recover();
        rec.recovery = rc.steps;
        rec.fsck = rc.fsck.map((x) => ({ ok: x.ok, problems: x.problems.map((p) => Object.assign({}, p)) }));
        rec.devsRec = devSnaps();
        rec.repairs = sys.devs.map((d, j) => (rc.fsck[j].ok ? [] : F().repair(d.img)));
        rec.after = sys.devs.map((d) => F().fsck(d.img, { disk: true }).ok);
      }
      bench.cut = null;
      rec.devs = devSnaps();
      rec.io.total = Object.assign({}, sys.io);
      rec.cacheStats = Object.assign({}, sys.cache.stats);
      rec.cacheSnap = sys.cache.capacity ? sys.cache.snapshot() : [];
      rec.dirty = [...sys.cache.dirty];
      recs.push(rec);
    });
    return { sys, first, recs, lastW, mounts, final: devSnaps() };
  };

  /** which device and path inside it a path names, for a snapshot list */
  FL.where = function (devs, path) {
    let best = devs[0], rest = path;
    for (const d of devs) if (d.at && d.at !== '/' && (path === d.at || path.startsWith(d.at + '/')) && d.at.length >= (best.at === '/' ? 0 : best.at.length)) { best = d; rest = path.slice(d.at.length) || '/'; }
    return { d: best, path: rest };
  };

  /** the namespace of a set of devices, depth first: [{path, name, ino, dev, type, size, nlink, depth, target, mount}] */
  FL.tree = function (devs, max) {
    const out = [];
    const walk = (sn, img, path, shown, depth) => {
      let ents;
      try { ents = F().list(img, path); } catch (e) { return; }
      for (const e of ents) {
        if (e.name === '.' || e.name === '..') continue;
        if (out.length >= (max || 200)) return;
        const p = (path === '/' ? '' : path) + '/' + e.name, full = (shown === '/' ? '' : shown) + '/' + e.name;
        let st;
        try { st = F().stat(img, p, { nofollow: true }); } catch (err) { continue; }
        const m = devs.find((d) => d.at === full && d.dev);
        const row = { path: full, name: e.name, ino: e.ino, dev: sn.dev, type: st.type, size: st.size, nlink: st.nlink, mode: st.mode, uid: st.uid, depth };
        if (st.type === 'symlink') { try { row.target = F().readlink(img, p); } catch (err) { row.target = '?'; } }
        if (m) row.mount = m.dev;
        out.push(row);
        if (m) walk(m, FL.live(m), '/', full, depth + 1);
        else if (st.type === 'directory') walk(sn, img, p, full, depth + 1);
      }
    };
    walk(devs[0], FL.live(devs[0]), '/', '/', 0);
    return out;
  };
})(globalThis.Proses = globalThis.Proses || {});
