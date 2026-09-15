// Part 14, real C programs that open files, run by the simulated kernel (S.Kern): fork sharing an offset, and a
// file unlinked while it is still open. The picture: the program with the line each process is on, the files the
// kernel holds (each name, its inode, links and bytes), the terminal, and the three tables from the kernel's own
// snapshot (sys.fsSnapshot(), the shape S.FS.Sys gives too).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const KINDS = new Set(['open', 'write', 'read', 'lseek', 'unlink', 'fork', 'close', 'dup', 'dup2', 'exit', 'done']);
  const HEAD = '#include <stdio.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <sys/wait.h>\n';

  const lineOf = (e) => e.line || (/line `(\d+)`/.exec(e.say || '') || [])[1] | 0;
  /** run a program and keep the events worth a frame, each with the kernel's tables at that moment */
  function runProg(src, files) {
    const sys = new S.Kern.System(src, { policy: 'fifo', snap: true, files: files || {} });
    sys.run(4000);
    const evs = [], exited = new Set();
    for (const e of sys.trace) {
      if (!KINDS.has(e.kind) || !e.ks) continue;
      if (e.kind === 'exit') { if (exited.has(e.pid)) continue; exited.add(e.pid); }
      evs.push(e);
    }
    return { sys, evs, status: sys.status(), out: sys.out };
  }

  /** the frames of a run: the code, the files, the terminal and the tables after each event */
  function progFrames(src, files, o) {
    const t = T(), R = Math.round;
    const run = runProg(src, files);
    const lines = src.split('\n'), F = new S.Frames(['events', 'entries', 'links']);
    let inc = 0; while (/^#include/.test(lines[inc] || '')) inc++;
    const CW = Math.max(440, R(64 + Math.max(...lines.slice(inc).map((l) => l.replace(/\s+$/, '').length)) * 7.95)), RX = CW + 22, FW = Math.max(250, 780 - RX);
    const code = (act, pid) => S.Kit.fsTables.code({ prefix: 'kc:code', x: 0, y: 0, w: CW, src: lines, lineH: 19, size: 13, title: o.title || 'files.c', act, tag: pid ? String(pid) : null });
    const draw = (e) => {
      const items = [], ln = e ? lineOf(e) : 0, snap = e ? e.ks.table : { procs: [], files: [], inodes: [] }, fs = e ? e.ks.files : { dir: {}, inodes: {} };
      const c = code(ln, e && e.pid);
      items.push(...c.items);
      // the files the kernel holds: every inode, the names that point to it, its link count and its bytes
      items.push(t.title('kc:ft', RX, 18, 'the files'));
      const inodes = Object.values(fs.inodes);
      let y = 34;
      if (!inodes.length) { items.push(t.text('kc:fe', RX, y + 18, 'none yet', 'tick', 13)); y += 30; }
      for (const nd of inodes) {
        const names = Object.entries(fs.dir).filter(([, v]) => v === nd.ino).map(([k]) => k);
        const orphan = !names.length;
        items.push({ key: 'kc:fi' + nd.ino, kind: 'cell', x: RX, y: R(y), w: FW, h: 52, rx: 6, lines: [(orphan ? 'no name' : names.join(', ')) + ' → inode ' + nd.ino + ' · links ' + nd.nlink, '“' + (nd.data.length > 24 ? nd.data.slice(0, 23) + '…' : nd.data).replace(/\n/g, '↵') + '” · ' + nd.data.length + ' B'], size: 13, cls: 'ft-ino' + (orphan ? ' orphan' : '') });
        y += 62;
      }
      // the terminal: what the program printed so far
      const term = e ? run.sys.term.slice(0, e.nterm).map((x) => x.text).join('') : '';
      items.push(t.title('kc:tt', RX, y + 14, 'terminal'));
      const tl = term.split('\n').filter((x, i, a) => x || i < a.length - 1).slice(-2);
      (tl.length ? tl : ['']).forEach((l, i) => items.push(t.text('kc:tl' + i, RX, y + 38 + i * 20, l || (tl.length ? '' : '(nothing yet)'), l ? 'mono' : 'tick', 13)));
      const ty = Math.max(c.h, y + 38 + 2 * 20) + 18;
      const tb = S.Kit.fsTables.draw({ prefix: 'kc:t', x: 0, y: ty, snap, others: true, group: true, rowH: 30, cellH: 44, label: (pid) => 'process ' + pid, name: (dev, ino) => Object.entries(fs.dir).filter(([, v]) => v === ino).map(([k]) => k).join(', ') || 'no name', act: e && e.pid ? actOf(e, snap) : {} });
      items.push(...tb.items);
      return items;
    };
    F.add({ items: draw(null), title: 'start', say: o.intro, meta: Object.assign({ phase: 'start', pid: 100, fds: [0, 1, 2, 3] }, o.introMeta || {}) });
    run.evs.forEach((e, i) => {
      const snap = e.ks.table;
      F.set('events', i + 1).set('entries', snap.files.length + (snap.others || []).length).set('links', Object.values(e.ks.files.inodes).reduce((n, x) => n + x.nlink, 0));
      const ev = Object.assign({}, e); delete ev.snap; delete ev.ks;
      F.add({ items: draw(e), title: e.kind, say: e.say, meta: { phase: e.kind, i, ev, line: lineOf(e), table: snap, files: e.ks.files, nterm: e.nterm } });
    });
    const last = F.last();
    if (last && run.status === 'done') {
      const fsx = run.sys.fs, txt = Object.entries(fsx.dir).map(([k, v]) => 'the file ' + k + ' holds “' + fsx.inodes[v].data.replace(/\n/g, '↵') + '”');
      last.say += ' ' + (txt.length ? t.cap(t.list(txt)) + '.' : 'No file is left.');
      last.meta.final = { dir: fsx.dir, sizes: Object.values(fsx.inodes).map((x) => x.data.length) };
    }
    return { frames: F.list, run };
  }
  S.T14.progFrames = progFrames;
  function actOf(e, snap) {
    const p = snap.procs.find((x) => x.pid === e.pid);
    const m = /descriptor `?(\d+)`?/.exec(e.say || '');
    const fd = m ? +m[1] : null;
    const d = p && fd !== null ? p.fds.find((x) => x.fd === fd) : null;
    const f = d ? snap.files.find((x) => x.id === d.file) : null;
    return { pid: e.pid, fd: d ? fd : undefined, file: f ? f.id : undefined, ino: f ? f.ino : undefined };
  }
  const compiles = (src) => { try { S.Kern.compile(src); return null; } catch (e) { return 'the program does not compile: ' + e.message; } };

  // =================================================================================================================
  const FORKS = {
    before: HEAD + 'int main(void) {\n  int fd = open("log",\n                O_WRONLY | O_CREAT | O_TRUNC, 0644);\n  if (fork() == 0) {\n    write(fd, "child ", 6);\n    return 0;\n  }\n  wait(NULL);\n  write(fd, "parent", 6);\n  close(fd);\n  return 0;\n}',
    after: HEAD + 'int main(void) {\n  if (fork() == 0) {\n    int fd = open("log",\n                  O_WRONLY | O_CREAT, 0644);\n    write(fd, "child ", 6);\n    return 0;\n  }\n  wait(NULL);\n  int fd = open("log", O_WRONLY);\n  write(fd, "parent", 6);\n  close(fd);\n  return 0;\n}',
    append: HEAD + 'int main(void) {\n  if (fork() == 0) {\n    int fd = open("log",\n                  O_WRONLY | O_CREAT | O_APPEND, 0644);\n    write(fd, "child ", 6);\n    return 0;\n  }\n  wait(NULL);\n  int fd = open("log", O_WRONLY | O_APPEND);\n  write(fd, "parent", 6);\n  close(fd);\n  return 0;\n}',
    dup: HEAD + 'int main(void) {\n  int a = open("log",\n                O_RDWR | O_CREAT | O_TRUNC, 0644);\n  int b = dup(a);\n  int c = open("log", O_RDWR);\n  write(a, "one ", 4);\n  write(b, "two ", 4);\n  write(c, "3", 1);\n  close(a);\n  close(b);\n  close(c);\n  return 0;\n}',
  };
  S.topic({
    id: 'fs-fork-c', family: 'p14-open', order: 30, title: 'A C program: parent and child write one file',
    blurb: 'The same idea in a real C program, run by the simulated kernel. When the file is opened before fork, the child’s descriptor is a copy pointing to the same open-file entry, so its write moves the offset the parent then uses. Opened separately after fork, each process starts at offset 0 and the parent’s write lands on the child’s.',
    inputs: [{ id: 'src', kind: 'program', label: 'the C program', def: FORKS.before, check: compiles }],
    presets: [
      { label: 'open, then fork', values: { src: FORKS.before } },
      { label: 'fork, then each opens', values: { src: FORKS.after } },
      { label: 'fork, then each opens to append', values: { src: FORKS.append } },
      { label: 'dup against a second open', values: { src: FORKS.dup } },
    ],
    counters: [{ id: 'events', label: 'calls' }, { id: 'entries', label: 'open-file entries' }],
    run(inp) {
      const r = progFrames(inp.src, {}, { title: 'log.c', intro: 'The program starts as process 100 with descriptors 0, 1 and 2 on the terminal (one open-file entry, three references). Watch which open-file entry each write goes through, and its offset.' });
      return { frames: r.frames, def: { sections: [{ id: 'k', kind: 'math', title: 'What fork copies', text: ['the descriptor table: copied', 'the open-file entries: shared (refs + 1)', 'so the offset: shared', 'open after fork: a new entry, offset 0', 'O_APPEND: every write goes to the end'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'write' && f.meta.phase !== 'start' && fr.slice(0, i + 1).some((x) => x.meta.phase === 'write'), once: true, pick: 'option', ask: 'The next write: will it land after the bytes already in the file, or on top of them?', options: ['after them', 'on top of them'], answer: (fr, i) => { const m = fr[i + 1].meta, snapBefore = fr[i].meta.files, ino = Object.values(m.table.files).length ? null : null; void ino; const sizes = Object.values(snapBefore.inodes).map((x) => x.data.length), after = Object.values(m.files.inodes).map((x) => x.data.length); return after.reduce((a, b) => a + b, 0) > sizes.reduce((a, b) => a + b, 0) ? 'after them' : 'on top of them'; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'In the program that opens before fork, the file ends up holding…', options: ['“child parent”', '“parent”', '“parentchild ”', 'nothing'], answer: 0, why: 'One entry, one offset: the child writes at 0 and moves it to 6; the parent writes at 6.' },
      { q: 'In the program where each process opens after fork, the file holds…', options: ['“parent”: the parent wrote over the child at offset 0', '“child parent”', '“child ”', 'two files called log'], answer: 0, why: 'The parent’s own entry starts at offset 0, so its 6 bytes cover the child’s 6.' },
      { q: 'Which call would make the separate opens safe for writers that run in any order?', options: ['open with O_APPEND', 'lseek(fd, 0, SEEK_SET) before each write', 'dup', 'close the file twice'], answer: 0, why: 'With O_APPEND the kernel moves the offset to the end before every write.' },
      { q: 'Why does the terminal entry show three references at the start?', options: ['descriptors 0, 1 and 2 all point to it', 'three processes are running', 'the terminal was opened three times', 'stdout is buffered three times'], answer: 0, why: 'The shell gave the program one terminal entry behind stdin, stdout and stderr.' },
    ],
  });

  // =================================================================================================================
  const UNLINKS = {
    open: HEAD + 'int main(void) {\n  char buf[16];\n  int fd = open("scratch",\n                O_RDWR | O_CREAT, 0600);\n  write(fd, "temporary", 9);\n  unlink("scratch");\n  lseek(fd, 0, SEEK_SET);\n  int n = read(fd, buf, 9);\n  buf[n] = 0;\n  printf("read back: %s\\n", buf);\n  close(fd);\n  return 0;\n}',
    closed: HEAD + 'int main(void) {\n  int fd = open("scratch",\n                O_RDWR | O_CREAT, 0600);\n  write(fd, "temporary", 9);\n  close(fd);\n  unlink("scratch");\n  fd = open("scratch", O_RDONLY);\n  printf("open again gives %d\\n", fd);\n  return 0;\n}',
    child: HEAD + 'int main(void) {\n  char buf[8];\n  int fd = open("shared",\n                O_RDWR | O_CREAT, 0600);\n  write(fd, "kept", 4);\n  if (fork() == 0) {\n    unlink("shared");\n    close(fd);\n    return 0;\n  }\n  wait(NULL);\n  lseek(fd, 0, SEEK_SET);\n  buf[read(fd, buf, 4)] = 0;\n  printf("parent reads %s\\n", buf);\n  close(fd);\n  return 0;\n}',
  };
  S.topic({
    id: 'fs-unlink-open', family: 'p14-links', order: 30, title: 'Unlinking a file that is still open',
    blurb: 'unlink removes a name, not a file. When the last name goes but a descriptor still has the file open, the inode stays, with no links, and the program can go on reading and writing it. Only the last close frees it. Programs use this for temporary files that vanish on their own, even if the program crashes.',
    inputs: [{ id: 'src', kind: 'program', label: 'the C program', def: UNLINKS.open, check: compiles }],
    presets: [
      { label: 'unlink, then read it back', values: { src: UNLINKS.open } },
      { label: 'close first, then unlink', values: { src: UNLINKS.closed } },
      { label: 'the child unlinks, the parent still reads', values: { src: UNLINKS.child } },
    ],
    counters: [{ id: 'events', label: 'calls' }, { id: 'links', label: 'links' }],
    run(inp) {
      const r = progFrames(inp.src, {}, { title: 'scratch.c', intro: 'The program makes a file, writes to it and unlinks it. Watch the inode’s link count and its open count in the inode table: a file is freed only when both reach 0.' });
      return { frames: r.frames, def: { sections: [{ id: 'u', kind: 'math', title: 'When is a file freed?', text: ['unlink: removes a name, links − 1', 'close: the open count − 1 (at the last close of its entry)', 'freed when links = 0 and open = 0', 'links 0, still open: an orphan, reachable only by descriptor'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'unlink', once: true, pick: 'option', ask: 'The program unlinks the file. What happens to its inode?', options: ['it stays, with no links, while a descriptor is open', 'it is freed at once', 'the unlink fails because the file is open', 'its data is copied to a new file'], answer: (fr, i) => { const m = fr[i + 1].meta, ino = Object.values(fr[i].meta.files.inodes); return m.table.inodes.some((x) => x.nlink === 0) ? 'it stays, with no links, while a descriptor is open' : (ino.length && !Object.values(m.files.inodes).length ? 'it is freed at once' : 'it stays, with no links, while a descriptor is open'); }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A file has one name and is open in one process. After unlink, a read through the descriptor…', options: ['still works', 'fails with ENOENT', 'returns end of file', 'blocks'], answer: 0, why: 'The descriptor reaches the inode through the open-file entry, not through the name.' },
      { q: 'When are the blocks of an unlinked, open file freed?', options: ['at the last close', 'at the unlink', 'when the process forks', 'never'], answer: 0, why: 'The inode is kept while its open count is above 0, then freed with its blocks.' },
      { q: 'After unlink, can another process open the file by its old name?', options: ['no: the name is gone', 'yes, until the last close', 'only the owner can', 'only as root'], answer: 0, why: 'Names are directory entries; that entry was removed.' },
      { q: 'Why might a program unlink a temporary file right after creating it?', options: ['so the file disappears by itself when the program ends or crashes', 'to make writes faster', 'to share it with other users', 'to lock it'], answer: 0, why: 'The last close, done by the kernel at exit, frees it, with no clean-up code needed.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
