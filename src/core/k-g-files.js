// The simulated kernel, part seven: files and descriptors. Three tables, as in a real kernel:
//   sys.fs        the file store: dir {name: ino} and inodes {ino: {ino, data, nlink}} (data a byte string)
//   sys.ofiles    the system-wide open-file table: {id: {id, kind: 'file'|'pipe'|'tty'|'sink'|'null', ino, pipe,
//                 end: 'r'|'w', offset, flags, refs}}; fork and dup share an entry (so they share its offset)
//   p.fds         each process's descriptor table: fd -> open-file id (0, 1, 2 are stdin, stdout, stderr)
// and pipes {id: {id, buf, cap, r: ofile id, w: ofile id}}: a read blocks while the pipe is empty and some writer
// is open, and returns 0 (end of file) once no writer is; a write blocks while the pipe is full, and with no
// reader left it raises SIGPIPE (and fails with EPIPE if that signal does not kill).
// The terminal (tty) holds what will be typed (sys.tty.input); a read takes one line. The sink is the outside end
// of a pipe that stdout goes to when tty is false.
//   sys.fdRead(t, fd, n) -> {data} | {block} | {err}     sys.fdWrite(t, fd, text) -> {n} | {block} | {err}
//   system calls: open creat close read write lseek unlink dup dup2 pipe isatty (sys.sysFile(t, name, args))
//   sys.fdClose(p, fd), sys.closeAll(p), sys.canRead(of), sys.canWrite(of)
//   sys.fsSnapshot() -> the tables in the shape of S.FS.Sys's snapshot (the File-system lab's), so both labs draw
//     the same: {procs: [{pid, uid, gid, fds: [{fd, file}]}], files: [{id, dev, ino, offset, flags: 'r'|'w'|'rw'
//     (+ 'a'), refs}], inodes: [{dev, ino, refs, nlink, size, type, orphan}]}, plus what only the kernel has:
//     others: [{id, kind: 'pipe'|'tty'|'sink'|'null', pipe, end, refs}] and pipes: [{id, buf, cap, readers, writers}]
//   (The kernel keeps its own small file store rather than S.FS.Sys's block file system, so that a whole system
//   can be copied and hashed at every step for the enumerator and the model checker.)
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const proto = K.System.prototype;
  const O = () => K.O;

  proto.fsInit = function (files) {
    this.fs = { dir: {}, inodes: {}, nextIno: 2 };
    for (const [name, data] of Object.entries(files || {})) this.mkfile(name, String(data));
  };
  proto.mkfile = function (name, data) {
    const ino = this.fs.nextIno++;
    this.fs.inodes[ino] = { ino, data: data || '', nlink: 1 };
    this.fs.dir[name] = ino;
    return ino;
  };
  proto.newOfile = function (o) {
    const id = this.nextOf++;
    this.ofiles[id] = Object.assign({ id, kind: 'file', offset: 0, flags: 0, refs: 0 }, o);
    return id;
  };
  /** the lowest free descriptor (from min) gets open file id */
  proto.fdAlloc = function (p, id, min) {
    let fd = min || 0;
    while (p.fds[fd] !== undefined && p.fds[fd] !== null) fd++;
    p.fds[fd] = id; this.ofiles[id].refs++;
    this.touch('of:' + id, 'w');
    return fd;
  };
  proto.ofOf = function (p, fd) { const id = fd >= 0 ? p.fds[fd] : undefined; return id === undefined || id === null ? null : this.ofiles[id] || null; };
  proto.fdClose = function (p, fd) {
    const of = this.ofOf(p, fd);
    if (!of) return false;
    p.fds[fd] = null;
    while (p.fds.length && (p.fds[p.fds.length - 1] === null || p.fds[p.fds.length - 1] === undefined)) p.fds.pop();
    of.refs--;
    this.touch('of:' + of.id, 'w');
    if (of.kind === 'pipe') this.touch('pipe:' + of.pipe, 'w');
    if (of.refs <= 0) {
      delete this.ofiles[of.id];
      if (of.kind === 'pipe') { const pp = this.pipes[of.pipe]; if (pp) { pp[of.end] = null; if (!pp.r && !pp.w) delete this.pipes[of.pipe]; } }
      if (of.kind === 'file') this.dropInode(of.ino);
    }
    return true;
  };
  proto.closeAll = function (p) { for (let fd = p.fds.length - 1; fd >= 0; fd--) this.fdClose(p, fd); p.fds = []; };
  /** an inode with no name and no open file is freed */
  proto.dropInode = function (ino) {
    const nd = this.fs.inodes[ino];
    if (!nd || nd.nlink > 0) return;
    if (Object.values(this.ofiles).some((o) => o.kind === 'file' && o.ino === ino)) return;
    delete this.fs.inodes[ino];
  };
  const readers = (sys, pp) => (pp.r && sys.ofiles[pp.r] ? sys.ofiles[pp.r].refs : 0);
  const writers = (sys, pp) => (pp.w && sys.ofiles[pp.w] ? sys.ofiles[pp.w].refs : 0);
  proto.canRead = function (of) {
    if (of.kind === 'pipe') { const pp = this.pipes[of.pipe]; return pp.buf.length > 0 || writers(this, pp) === 0; }
    if (of.kind === 'tty') return this.tty.input.length > 0 || this.tty.eof;
    return true;
  };
  proto.canWrite = function (of) {
    if (of.kind === 'pipe') { const pp = this.pipes[of.pipe]; return pp.buf.length < pp.cap || readers(this, pp) === 0; }
    return true;
  };

  /** read up to n bytes: {data} (empty at end of file), {block} or {err} */
  proto.fdRead = function (t, fd, n) {
    const p = this.proc(t.pid), of = this.ofOf(p, fd), E = K.ERR;
    if (!of || (of.flags & 3) === O().O_WRONLY || of.kind === 'sink') return { err: E.EBADF };
    this.touch('of:' + of.id, 'w');
    switch (of.kind) {
      case 'null': return { data: '' };
      case 'file': {
        const nd = this.fs.inodes[of.ino]; this.touch('ino:' + of.ino, 'r');
        const data = nd.data.slice(of.offset, of.offset + n); of.offset += data.length; return { data };
      }
      case 'tty': {
        this.touch('tty', 'w');
        if (!this.tty.input.length) return this.tty.eof ? { data: '' } : { block: true };
        const nl = this.tty.input.indexOf('\n'), take = Math.min(n, nl >= 0 ? nl + 1 : this.tty.input.length);
        const data = this.tty.input.slice(0, take); this.tty.input = this.tty.input.slice(take); return { data };
      }
      case 'pipe': {
        const pp = this.pipes[of.pipe]; this.touch('pipe:' + of.pipe, 'w');
        if (!pp.buf.length) return writers(this, pp) ? { block: true } : { data: '' };
        const data = pp.buf.slice(0, n); pp.buf = pp.buf.slice(data.length); return { data };
      }
    }
    return { err: E.EBADF };
  };
  /** write text: {n} (all of it, or what fitted before a block: {n, block}), or {err} (and SIGPIPE) */
  proto.fdWrite = function (t, fd, text) {
    const p = this.proc(t.pid), of = this.ofOf(p, fd), E = K.ERR;
    if (!of || (of.flags & 3) === O().O_RDONLY && of.kind !== 'tty' && of.kind !== 'null') return { err: E.EBADF };
    this.touch('of:' + of.id, 'w');
    switch (of.kind) {
      case 'null': return { n: text.length };
      case 'tty': case 'sink': {
        this.touch('out', 'w');
        this.term.push({ pid: p.pid, fd, text, t: this.t, dev: of.kind });
        // out is what a capture of the program's stdout sees: the terminal (tty mode) or the pipe out (else)
        if (of.kind === 'sink' || this.o.tty) this.out += text;
        return { n: text.length, dev: of.kind };
      }
      case 'file': {
        const nd = this.fs.inodes[of.ino]; this.touch('ino:' + of.ino, 'w');
        if (of.flags & O().O_APPEND) of.offset = nd.data.length;
        const pad = of.offset > nd.data.length ? '\0'.repeat(of.offset - nd.data.length) : '';
        nd.data = nd.data.slice(0, of.offset) + pad + text + nd.data.slice(of.offset + text.length);
        of.offset += text.length;
        return { n: text.length };
      }
      case 'pipe': {
        const pp = this.pipes[of.pipe]; this.touch('pipe:' + of.pipe, 'w');
        if (!readers(this, pp)) { this.post(p, K.SIG.SIGPIPE, p.pid, t); return { err: E.EPIPE, pipe: true }; }
        const room = pp.cap - pp.buf.length;
        if (room <= 0) return { block: true, n: 0 };
        const part = text.slice(0, room); pp.buf += part;
        return part.length < text.length ? { n: part.length, block: true } : { n: part.length };
      }
    }
    return { err: E.EBADF };
  };
  const what = (sys, of) => (!of ? '?' : of.kind === 'tty' ? 'the terminal' : of.kind === 'sink' ? 'the pipe out of the program' : of.kind === 'null' ? '/dev/null' : of.kind === 'pipe' ? 'the ' + (of.end === 'r' ? 'read' : 'write') + ' end of pipe ' + of.pipe : 'file ' + (Object.keys(sys.fs.dir).find((k) => sys.fs.dir[k] === of.ino) || '#' + of.ino));
  proto.ofName = function (of) { return what(this, of); };
  proto.fsSnapshot = function () {
    const fl = (f) => { const a = f & 3; return (a === 0 ? 'r' : a === 1 ? 'w' : 'rw') + (f & O().O_APPEND ? 'a' : ''); };
    const ofs = Object.values(this.ofiles), files = ofs.filter((o) => o.kind === 'file');
    return {
      procs: this.procs.filter((p) => p.role === 'prog' && p.state !== 'zombie' && p.state !== 'reaped').map((p) => ({ pid: p.pid, uid: 0, gid: 0, fds: p.fds.map((id, fd) => (id === null || id === undefined ? null : { fd, file: id })).filter(Boolean) })),
      files: files.map((o) => ({ id: o.id, dev: 0, ino: o.ino, offset: o.offset, flags: fl(o.flags), refs: o.refs })),
      inodes: Object.values(this.fs.inodes).filter((nd) => files.some((o) => o.ino === nd.ino)).map((nd) => ({ dev: 0, ino: nd.ino, refs: files.filter((o) => o.ino === nd.ino).length, nlink: nd.nlink, size: nd.data.length, type: 'file', orphan: nd.nlink === 0 })),
      others: ofs.filter((o) => o.kind !== 'file').map((o) => ({ id: o.id, kind: o.kind, pipe: o.pipe || null, end: o.end || null, refs: o.refs })),
      pipes: Object.values(this.pipes).map((pp) => ({ id: pp.id, buf: pp.buf, cap: pp.cap, readers: readers(this, pp), writers: writers(this, pp) })),
    };
  };
  const bytes = (C, vm, a, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(C.load(vm, a + i, 1, 0)); return s; };
  const put = (C, vm, a, s) => { for (let i = 0; i < s.length; i++) C.store(vm, a + i, 1, s.charCodeAt(i), 0); };
  K.bytes = bytes; K.put = put;

  /** the file system calls of a C program */
  proto.sysFile = function (t, name, a) {
    const C = S.CLang, p = this.proc(t.pid), vm = t.vm, E = K.ERR, who = this.whoT(t), at = ' at line `' + t.line + '`';
    switch (name) {
      case 'open': {
        const path = C.readStr(vm, a[0]), fl = a[1], o = O();
        this.touch('fs', 'w');
        let of;
        if (path === '/dev/tty') of = this.newOfile({ kind: 'tty', flags: fl & 3 });
        else if (path === '/dev/null') of = this.newOfile({ kind: 'null', flags: fl & 3 });
        else {
          let ino = this.fs.dir[path];
          if (ino === undefined) { if (!(fl & o.O_CREAT)) return this.fail(t, E.ENOENT, `${who} calls open("${path}")${at}: there is no such file`); ino = this.mkfile(path, ''); }
          else if ((fl & o.O_CREAT) && (fl & o.O_EXCL)) return this.fail(t, E.EEXIST, `${who} calls open("${path}", O_CREAT | O_EXCL)${at}: the file exists`);
          if ((fl & o.O_TRUNC) && (fl & 3)) this.fs.inodes[ino].data = '';
          of = this.newOfile({ kind: 'file', ino, flags: fl });
        }
        const fd = this.fdAlloc(p, of);
        this.event('open', p, { fd, of, path, tid: t.tid }, `${who} opens "${path}"${at}: a new open-file entry ${of} (offset 0) goes into its lowest free descriptor, \`${fd}\`.`);
        return { v: fd };
      }
      case 'creat': return this.sysFile(t, 'open', [a[0], O().O_CREAT | O().O_WRONLY | O().O_TRUNC, a[1]]);
      case 'close': {
        const of = this.ofOf(p, a[0]);
        if (!of) return this.fail(t, E.EBADF, `${who} calls close(${a[0]})${at}: no such descriptor`);
        const nm = what(this, of), left = of.refs - 1;
        this.fdClose(p, a[0]);
        this.event('close', p, { fd: a[0], of: of.id, refs: left, tid: t.tid }, `${who} closes descriptor \`${a[0]}\`${at}: ${nm} has ${left} reference${left === 1 ? '' : 's'} left${left ? '' : ', so the entry is freed'}.`);
        return { v: 0 };
      }
      case 'read': {
        const of = this.ofOf(p, a[0]), r = this.fdRead(t, a[0], Math.max(0, a[2]));
        if (r.err) return this.fail(t, r.err, `${who} reads descriptor \`${a[0]}\`${at}: it is not open for reading`);
        if (r.block) {
          if (!t.wait) this.event('block', p, { why: 'read', fd: a[0], tid: t.tid, line: t.line }, `${who} reads ${what(this, of)}${at}: there is nothing to read yet, so it blocks.`);
          this.block(t, { kind: 'read', fd: a[0] });
          return { block: true };
        }
        put(C, vm, a[1], r.data);
        this.event('read', p, { fd: a[0], n: r.data.length, data: r.data, tid: t.tid, line: t.line }, r.data.length ? `${who} reads ${K.show(r.data)} from ${what(this, of)}${at}: read returns \`${r.data.length}\`.` : `${who} reads ${what(this, of)}${at}: end of file, so read returns \`0\`.`);
        return { v: r.data.length };
      }
      case 'write': {
        const of = this.ofOf(p, a[0]), all = bytes(C, vm, a[1], Math.max(0, a[2])), done = t.progress && t.progress.kind === 'write' ? t.progress.n : 0;
        const r = this.fdWrite(t, a[0], all.slice(done));
        if (r.err) { t.progress = null; return this.fail(t, r.err, r.pipe ? `${who} writes to a pipe${at} that no process can read: SIGPIPE, and write fails with EPIPE` : `${who} writes descriptor \`${a[0]}\`${at}: it is not open for writing`); }
        const n = done + (r.n || 0);
        if (r.block) {
          t.progress = { kind: 'write', n };
          this.block(t, { kind: 'write', fd: a[0] });
          this.event('block', p, { why: 'write', fd: a[0], tid: t.tid, line: t.line }, `${who} writes to ${what(this, of)}${at}: the pipe is full after ${n} of ${all.length} bytes, so it blocks.`);
          return { block: true };
        }
        t.progress = null;
        this.event(r.dev ? 'print' : 'write', p, { fd: a[0], text: all, n, tid: t.tid, line: t.line }, `${who} writes ${K.show(all)} to ${what(this, of)}${at}${of.kind === 'file' ? ', which moves its offset to ' + of.offset : ''}.`);
        return { v: n };
      }
      case 'lseek': {
        const of = this.ofOf(p, a[0]);
        if (!of) return this.fail(t, E.EBADF, `${who} calls lseek(${a[0]})${at}: no such descriptor`);
        if (of.kind !== 'file') return this.fail(t, E.ESPIPE, `${who} calls lseek on ${what(this, of)}${at}: a pipe or terminal has no offset`);
        const base = a[2] === 0 ? 0 : a[2] === 1 ? of.offset : this.fs.inodes[of.ino].data.length, off = base + a[1];
        if (off < 0) return this.fail(t, E.EINVAL, `${who} calls lseek${at}: the offset would be negative`);
        of.offset = off; this.touch('of:' + of.id, 'w');
        this.event('lseek', p, { fd: a[0], offset: off, tid: t.tid }, `${who} moves the offset of descriptor \`${a[0]}\` to \`${off}\`${at}; every descriptor sharing that open file sees it.`);
        return { v: off };
      }
      case 'unlink': {
        const path = C.readStr(vm, a[0]), ino = this.fs.dir[path];
        this.touch('fs', 'w');
        if (ino === undefined) return this.fail(t, E.ENOENT, `${who} calls unlink("${path}")${at}: there is no such file`);
        delete this.fs.dir[path]; this.fs.inodes[ino].nlink--;
        this.dropInode(ino);
        this.event('unlink', p, { path, ino, tid: t.tid }, `${who} unlinks "${path}"${at}: the name is gone${this.fs.inodes[ino] ? '; the inode stays while it is open' : ', and so is the inode'}.`);
        return { v: 0 };
      }
      case 'dup': {
        const of = this.ofOf(p, a[0]);
        if (!of) return this.fail(t, E.EBADF, `${who} calls dup(${a[0]})${at}: no such descriptor`);
        const fd = this.fdAlloc(p, of.id);
        this.event('dup', p, { from: a[0], fd, of: of.id, tid: t.tid }, `${who} duplicates descriptor \`${a[0]}\` as \`${fd}\`${at}: both name ${what(this, of)}, which now has ${of.refs} references.`);
        return { v: fd };
      }
      case 'dup2': {
        const of = this.ofOf(p, a[0]);
        if (!of) return this.fail(t, E.EBADF, `${who} calls dup2(${a[0]}, ${a[1]})${at}: no such descriptor`);
        if (a[0] === a[1]) return { v: a[1] };
        const old = this.ofOf(p, a[1]);
        if (old) this.fdClose(p, a[1]);
        p.fds[a[1]] = of.id; of.refs++; this.touch('of:' + of.id, 'w');
        this.event('dup', p, { from: a[0], fd: a[1], of: of.id, tid: t.tid }, `${who} calls dup2(${a[0]}, ${a[1]})${at}: descriptor \`${a[1]}\`${old ? ', closed first,' : ''} now names ${what(this, of)} too.`);
        return { v: a[1] };
      }
      case 'pipe': {
        const id = this.nextPipe++;
        const r = this.newOfile({ kind: 'pipe', pipe: id, end: 'r', flags: 0 }), w = this.newOfile({ kind: 'pipe', pipe: id, end: 'w', flags: 1 });
        this.pipes[id] = { id, buf: '', cap: this.o.pipeCap, r, w };
        const fr = this.fdAlloc(p, r), fw = this.fdAlloc(p, w);
        C.store(vm, a[0], 4, fr, 1); C.store(vm, a[0] + 4, 4, fw, 1);
        this.touch('fs', 'w');
        this.event('pipe', p, { pipe: id, r: fr, w: fw, tid: t.tid }, `${who} creates pipe ${id}${at}: descriptor \`${fr}\` reads it and \`${fw}\` writes it; it holds up to ${this.o.pipeCap} bytes.`);
        return { v: 0 };
      }
      case 'isatty': { const of = this.ofOf(p, a[0]); return of && of.kind === 'tty' ? { v: 1 } : this.fail(t, of ? 25 : E.EBADF, null); }
    }
    return null;
  };
})(globalThis.Proses = globalThis.Proses || {});
