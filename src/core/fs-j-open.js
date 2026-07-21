// A block-level file system, part 10: the open-file layer, as the kernel sees it, with mounts and I/O costs.
//   const sys = new F.Sys(img, {mode, checkpoint, cache: {capacity, policy, sync, unified}})
//   sys.proc(pid, {uid, gid}) a process with an empty descriptor table (pid 1 exists, as root)
//   Every call below returns {result, steps, io: {reads, writes, hits}} and appends its steps to sys.trace:
//     sys.open(pid, path, flags)   flags: 'r' | 'w' | 'rw' | 'a' (append), plus 'c' create, 't' truncate, 'x'
//                                  exclusive; permission is checked here, once (rwx bits, the process's uid, gid)
//     sys.read(pid, fd, n)  sys.write(pid, fd, text)  sys.lseek(pid, fd, off, 'set'|'cur'|'end')  sys.close(pid, fd)
//     sys.dup(pid, fd)  sys.fork(pid, child)  (the child's descriptors share the parent's open-file entries, and so
//                                  the offset)
//     sys.op(pid, name, ...args)   a namespace operation (mkdir, create, unlink, rmdir, rename, link, symlink,
//                                  truncate, chmod, chown) on the right mounted file system; EXDEV across them
//     sys.stat(pid, path)  sys.mount(path, img2)  sys.umount(path)  sys.tick(dt)  sys.sync()
//     sys.crash() -> {lost}   memory is lost: dirty cached blocks, open files, uncheckpointed journal state
//     sys.recover() -> {steps, fsck}   journal replay and orphan cleanup on every file system, then fsck
//   sys.snapshot() -> {procs: [{pid, uid, gid, fds: [{fd, file}]}], files: [{id, dev, ino, offset, flags, refs}],
//                      inodes: [{dev, ino, refs, nlink, size, type, orphan}], cache: [..], dirty: [..]}
//   A 'write-fd' step has {pid, fd, file, from, len, buffered: ['dev:block'..]}: the blocks the write-back cache holds
//   dirty after it (empty without one).
//   sys.io: running totals; sys.disk: every block the disk served, in order (for F.seekDistance and F.diskTime)
//   F.costs(geometry, {cache, mode}) -> rows [{op, reads, writes, hits, say}] for create, open, write, read, close,
//     delete of one file, done in a fresh system: the cost of each with or without a buffer cache.
// Paths are made absolute and '.' and '..' resolved by name before a mount point is chosen; a symbolic link is
// followed inside its own file system.
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});
  const norm = (p) => { const out = []; for (const c of String(p).split('/')) { if (!c || c === '.') continue; if (c === '..') out.pop(); else out.push(c); } return '/' + out.join('/'); };
  F.normPath = norm;

  class Sys {
    constructor(img, o) {
      o = o || {};
      this.mode = o.mode || 'none'; this.checkpointMode = o.checkpoint || 'eager';
      this.devs = [{ dev: 0, img, at: '/' }];
      const c = o.cache || { capacity: 0 };
      this.cache = new F.Cache(Object.assign({}, c, { onWrite: (key) => this.writeHome(key) }));
      this.deferred = this.mode === 'none' && this.cache.capacity > 0 && this.cache.policy === 'write-back';
      this.procs = new Map(); this.files = []; this.itable = new Map(); this.trace = []; this.disk = [];
      this.io = { reads: 0, writes: 0, hits: 0 }; this.nextFile = 1; this.time = 0;
      this.proc(1, { uid: 0, gid: 0 });
    }
    proc(pid, cred) { const p = { pid, cred: cred || { uid: 0, gid: 0 }, fds: [] }; this.procs.set(pid, p); return p; }
    P(pid) { const p = this.procs.get(pid); if (!p) throw F.err('ESRCH', 'no process ' + pid); return p; }
    /** which file system a path is on, and the path inside it */
    where(path) {
      const p = norm(path);
      let best = this.devs[0], rest = p;
      for (const d of this.devs) if (d.at && d.at !== '/' && (p === d.at || p.startsWith(d.at + '/')) && d.at.length >= (best.at === '/' ? 0 : best.at.length)) { best = d; rest = p.slice(d.at.length) || '/'; }
      return { d: best, path: rest };
    }
    writeHome(key) {
      const [dev, b] = String(key).split(':').map(Number), img = this.devs[dev].img;
      if (img.overlay && img.overlay.has(b)) { F.block(img, b).set(img.overlay.get(b)); img.overlay.delete(b); if (img.dirty) img.dirty.delete(b); }
      this.disk.push(b);
    }
    reader(d, dataSet) {
      return (b) => {
        const r = this.cache.read(d.dev + ':' + b, dataSet && dataSet.has(b) ? 'data' : 'meta');
        if (r.hit) this.io.hits++; else { this.io.reads++; this.disk.push(b); }
        return F.readBlock(d.img, b);
      };
    }
    /** run fn, recording the steps and the I/O it causes */
    call(kind, fn) {
      const io0 = Object.assign({}, this.io), w0 = this.cache.stats.writes, steps = [];
      const result = fn(steps);
      this.io.writes += this.cache.stats.writes - w0;
      const io = { reads: this.io.reads - io0.reads, writes: this.io.writes - io0.writes, hits: this.io.hits - io0.hits };
      for (const s of steps) this.trace.push(Object.assign({ call: kind }, s));
      return { result, steps, io };
    }
    /** prepare and write an operation on file system d */
    run(d, cred, op, args, steps, dataSet) {
      const tx = F.prepareAs(d.img, { cred, read: this.reader(d, dataSet) }, op, args);
      steps.push(...tx.trace);
      const c = F.commit(d.img, tx, { mode: d.img.g.jblocks ? this.mode : 'none', checkpoint: this.checkpointMode, defer: this.deferred });
      if (this.deferred) for (const b of c.deferred) this.cache.write(d.dev + ':' + b, dataSet && dataSet.has(b) ? 'data' : 'meta');
      else { this.io.writes += c.applied; for (const w of c.writes) { this.disk.push(w.block); if (this.cache.capacity && (w.phase === 'home' || w.phase === 'data' || w.phase === 'checkpoint')) this.cache.insert(d.dev + ':' + w.block, 'meta'); } }
      return tx.result;
    }
    open(pid, path, flags) {
      return this.call('open', (steps) => {
        const p = this.P(pid), fl = String(flags || 'r'), { d, path: rel } = this.where(path);
        const rd = /r/.test(fl) || fl === 'rw', wr = /[wa]/.test(fl), append = /a/.test(fl);
        const tx = new F.Tx(d.img, { cred: p.cred, read: this.reader(d) });
        let ino = F.namei(tx, rel);
        steps.push(...tx.trace);
        if (ino && /x/.test(fl) && /c/.test(fl)) throw F.err('EEXIST', path + ' exists');
        let created = false;
        if (!ino) { if (!/c/.test(fl)) throw F.err('ENOENT', path + ': no such file'); ino = this.run(d, p.cred, 'create', [rel], steps); created = true; }
        const t2 = !created ? tx : new F.Tx(d.img, { cred: p.cred, read: this.reader(d) }), n = t2.inode(ino), mark = t2.trace.length;
        if (n.type === F.T_DIR && wr) throw F.err('EISDIR', path + ' is a directory');
        if (rd) F.access(t2, ino, 4, path);
        if (wr) F.access(t2, ino, 2, path);
        steps.push(...t2.trace.slice(t2 === tx ? mark : 0));
        if (/t/.test(fl) && wr && n.size) this.run(d, p.cred, 'truncate', [ino, 0], steps);
        const f = { id: this.nextFile++, dev: d.dev, ino, offset: 0, flags: (rd ? 'r' : '') + (wr ? 'w' : '') + (append ? 'a' : ''), refs: 1 };
        this.files.push(f);
        const key = d.dev + ':' + ino, it = this.itable.get(key) || { dev: d.dev, ino, refs: 0 };
        it.refs++; this.itable.set(key, it);
        if (!d.img.open) d.img.open = new Map();
        d.img.open.set(ino, (d.img.open.get(ino) || 0) + 1);
        let fd = 0; while (p.fds[fd]) fd++;
        p.fds[fd] = f;
        steps.push({ kind: 'open', pid, fd, file: f.id, ino, say: `Process ${pid} opens ${path} (inode ${ino}) for ${f.flags.includes('r') && f.flags.includes('w') ? 'reading and writing' : f.flags.includes('w') ? 'writing' : 'reading'}: open-file entry ${f.id} (offset 0) is made, inode ${ino} has ${it.refs} open reference${it.refs === 1 ? '' : 's'}, and the lowest free descriptor, ${fd}, points to it.` });
        return fd;
      });
    }
    fd(pid, fd) { const f = this.P(pid).fds[fd]; if (!f) throw F.err('EBADF', `process ${pid} has no descriptor ${fd}`); return f; }
    dataSet(f) { const img = this.devs[f.dev].img; return new Set(F.ownedBlocks(img, F.readInode(img, f.ino)).filter((x) => x.kind === 'data').map((x) => x.block)); }
    read(pid, fd, n) {
      return this.call('read', (steps) => {
        const f = this.fd(pid, fd);
        if (!f.flags.includes('r')) throw F.err('EBADF', `descriptor ${fd} is not open for reading`);
        const d = this.devs[f.dev], ds = this.dataSet(f), u = F.read(d.img, f.ino, f.offset, n, { read: this.reader(d, ds) }), at = f.offset;
        f.offset += u.length;
        steps.push({ kind: 'read', pid, fd, file: f.id, from: at, got: u.length, say: `Process ${pid} reads ${u.length} byte${u.length === 1 ? '' : 's'} through descriptor ${fd} from offset ${at}; open-file entry ${f.id}'s offset is now ${f.offset}.` });
        return F.text(u);
      });
    }
    write(pid, fd, text) {
      return this.call('write', (steps) => {
        const f = this.fd(pid, fd), d = this.devs[f.dev];
        if (!f.flags.includes('w')) throw F.err('EBADF', `descriptor ${fd} is not open for writing`);
        if (f.flags.includes('a')) f.offset = F.readInode(d.img, f.ino).size;
        const at = f.offset;
        this.run(d, F.ROOT_CRED, 'write', [f.ino, at, text], steps, this.dataSet(f));
        f.offset += text.length;
        steps.push({ kind: 'write-fd', pid, fd, file: f.id, from: at, len: text.length, buffered: [...this.cache.dirty].sort(), say: `Process ${pid} writes ${F.count(text.length, 'byte')} through descriptor ${fd} at offset ${at}${f.flags.includes('a') ? ' (append: the offset moved to the end first)' : ''}; the offset is now ${f.offset}.` });
        return text.length;
      });
    }
    lseek(pid, fd, off, whence) {
      return this.call('lseek', (steps) => {
        const f = this.fd(pid, fd), size = F.readInode(this.devs[f.dev].img, f.ino).size;
        f.offset = whence === 'end' ? size + off : whence === 'cur' ? f.offset + off : off;
        if (f.offset < 0) throw F.err('EINVAL', 'a negative offset');
        steps.push({ kind: 'lseek', pid, fd, file: f.id, offset: f.offset, say: `Descriptor ${fd} of process ${pid}: open-file entry ${f.id}'s offset is set to ${f.offset}; nothing is read from the disk.` });
        return f.offset;
      });
    }
    dup(pid, fd) {
      return this.call('dup', (steps) => {
        const p = this.P(pid), f = this.fd(pid, fd);
        let nfd = 0; while (p.fds[nfd]) nfd++;
        p.fds[nfd] = f; f.refs++;
        steps.push({ kind: 'dup', pid, fd: nfd, file: f.id, say: `Descriptor ${nfd} of process ${pid} now points to the same open-file entry ${f.id} as ${fd}: they share one offset (${f.offset}).` });
        return nfd;
      });
    }
    fork(pid, child) {
      return this.call('fork', (steps) => {
        const p = this.P(pid), c = this.proc(child, Object.assign({}, p.cred));
        c.fds = p.fds.slice();
        for (const f of new Set(c.fds.filter(Boolean))) f.refs += c.fds.filter((x) => x === f).length;
        steps.push({ kind: 'fork', pid, child, say: `Process ${child} is forked from ${pid}: its descriptor table is a copy, so ${c.fds.filter(Boolean).length === 1 ? 'its one descriptor points' : c.fds.filter(Boolean).length ? 'each of its ' + c.fds.filter(Boolean).length + ' descriptors points' : 'it has no open descriptors, but any it inherits would point'} to the same open-file entry as the parent's, sharing the offset.` });
        return child;
      });
    }
    close(pid, fd) {
      return this.call('close', (steps) => {
        const p = this.P(pid), f = this.fd(pid, fd), d = this.devs[f.dev];
        p.fds[fd] = undefined; f.refs--;
        let say = `Process ${pid} closes descriptor ${fd}; open-file entry ${f.id} has ${f.refs} reference${f.refs === 1 ? '' : 's'} left.`;
        if (!f.refs) {
          this.files = this.files.filter((x) => x !== f);
          const key = f.dev + ':' + f.ino, it = this.itable.get(key);
          it.refs--; d.img.open.set(f.ino, d.img.open.get(f.ino) - 1);
          say = `Process ${pid} closes descriptor ${fd}: open-file entry ${f.id} is gone, and inode ${f.ino} has ${it.refs} open reference${it.refs === 1 ? '' : 's'} left.`;
          if (!it.refs) { this.itable.delete(key); d.img.open.delete(f.ino); if (F.orphans(d.img).includes(f.ino)) this.run(d, F.ROOT_CRED, 'release', [f.ino], steps); }
        }
        steps.unshift({ kind: 'close', pid, fd, file: f.id, say });
        return 0;
      });
    }
    op(pid, name, ...args) {
      return this.call(name, (steps) => {
        const p = this.P(pid), PATHS = { rename: [0, 1], link: [0, 1], symlink: [1] }, idx = PATHS[name] || [0], devs = new Set(), a = args.slice();
        let d = null;
        for (const i of idx) { const w = this.where(a[i]); devs.add(w.d.dev); d = w.d; a[i] = w.path; }
        if (devs.size > 1) throw F.err('EXDEV', `${name} cannot cross from one file system to another`);
        if ((name === 'rmdir' || name === 'unlink') && this.devs.some((x) => x.at === norm(args[0]))) throw F.err('EBUSY', args[0] + ' is a mount point');
        return this.run(d, p.cred, name, a, steps);
      });
    }
    stat(pid, path) { return this.call('stat', () => { const { d, path: rel } = this.where(path); return Object.assign({ dev: d.dev }, F.stat(d.img, rel)); }); }
    mount(path, img2) {
      return this.call('mount', (steps) => {
        const at = norm(path), { d, path: rel } = this.where(at), ino = F.lookup(d.img, rel).ino;
        if (!ino || F.readInode(d.img, ino).type !== F.T_DIR) throw F.err('ENOTDIR', path + ' is not a directory');
        const dev = this.devs.length;
        this.devs.push({ dev, img: img2, at });
        steps.push({ kind: 'mount', dev, at, say: `A second file system (device ${dev}) is mounted on ${at}: lookups that reach ${at} continue at its root, inode ${F.ROOT}, hiding what the directory held.` });
        return dev;
      });
    }
    umount(path) {
      return this.call('umount', (steps) => {
        const at = norm(path), i = this.devs.findIndex((x) => x.at === at);
        if (i <= 0) throw F.err('EINVAL', at + ' is not a mount point');
        if (this.files.some((f) => f.dev === this.devs[i].dev)) throw F.err('EBUSY', at + ' has open files');
        this.devs[i].at = null;
        steps.push({ kind: 'umount', at, say: `${at} is unmounted: its directory shows its own contents again.` });
        return 0;
      });
    }
    tick(dt) { return this.call('tick', (steps) => { this.time += dt || 1; const w = this.cache.tick(dt || 1); if (w.length) steps.push({ kind: 'sync', blocks: w, say: `The sync interval has passed: ${w.length} dirty block${w.length === 1 ? ' is' : 's are'} written home.` }); return w.length; }); }
    sync() {
      return this.call('sync', (steps) => {
        const w = this.cache.flush();
        for (const d of this.devs) { const c = F.flush(d.img); this.io.writes += c.applied; c.writes.forEach((x) => this.disk.push(x.block)); }
        steps.push({ kind: 'sync', blocks: w, say: `sync: every dirty block (${w.length} in the cache) is written home${this.checkpointMode === 'lazy' ? ', and the journal is checkpointed' : ''}.` });
        return w.length;
      });
    }
    crash() {
      const lost = this.cache.drop();
      for (const d of this.devs) F.crash(d.img);
      this.files = []; this.itable.clear(); for (const p of this.procs.values()) p.fds = [];
      this.trace.push({ kind: 'crash', lost, say: `The power fails: ${lost.length} dirty block${lost.length === 1 ? '' : 's'} in the cache never reach the disk, and every open file is forgotten.` });
      return { lost };
    }
    recover() {
      const steps = [];
      for (const d of this.devs) if (d.img.g.jblocks) steps.push(...F.recover(d.img).steps);
      const fsck = this.devs.map((d) => F.fsck(d.img, { disk: true }));
      return { steps, fsck };
    }
    snapshot() {
      return {
        procs: [...this.procs.values()].map((p) => ({ pid: p.pid, uid: p.cred.uid, gid: p.cred.gid, fds: p.fds.map((f, fd) => (f ? { fd, file: f.id } : null)).filter(Boolean) })),
        files: this.files.map((f) => ({ id: f.id, dev: f.dev, ino: f.ino, offset: f.offset, flags: f.flags, refs: f.refs })),
        inodes: [...this.itable.values()].map((it) => { const img = this.devs[it.dev].img, n = F.readInode(img, it.ino); return { dev: it.dev, ino: it.ino, refs: it.refs, nlink: n.nlink, size: n.size, type: F.TYPE_NAME[n.type], orphan: F.orphans(img).includes(it.ino) }; }),
        cache: this.cache.snapshot(), dirty: [...this.cache.dirty],
      };
    }
  }
  F.Sys = Sys;

  F.costs = function (geo, o) {
    o = o || {};
    const img = F.mkfs(geo), sys = new Sys(img, { mode: o.mode || 'none', cache: o.cache || { capacity: 0 } }), rows = [];
    sys.op(1, 'mkdir', '/docs');
    sys.sync();
    const text = o.text || 'x'.repeat(F.payload(img.g) * 2 + 10);
    const row = (op, r) => rows.push({ op, reads: r.io.reads, writes: r.io.writes, hits: r.io.hits, say: `${op}: ${r.io.reads} disk read${r.io.reads === 1 ? '' : 's'}, ${r.io.writes} disk write${r.io.writes === 1 ? '' : 's'}${sys.cache.capacity ? ', ' + r.io.hits + ' cache hit' + (r.io.hits === 1 ? '' : 's') : ''}.` });
    row('create', sys.op(1, 'create', '/docs/report'));
    const op = sys.open(1, '/docs/report', 'rw'); row('open', op);
    row('write', sys.write(1, op.result, text));
    sys.lseek(1, op.result, 0, 'set');
    row('read', sys.read(1, op.result, text.length));
    row('close', sys.close(1, op.result));
    row('delete', sys.op(1, 'unlink', '/docs/report'));
    row('sync', sys.sync());
    return rows;
  };
})(globalThis.Proses = globalThis.Proses || {});
