// Part 3, descriptors: what fork copies (the descriptor table, so both processes share each open-file entry and
// its offset) against two opens of one file (two entries, two offsets); and dup and dup2, which make a second
// descriptor for the same entry: the way a shell sends a program's output into a file. Real C programs on the
// simulated kernel, drawn with the descriptor tables, the open-file table and the file's bytes.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const SHARE = {
    shared: { file: 'shared.c', label: 'open, then fork: one entry', src: `#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    int fd = open("log",
        O_WRONLY | O_CREAT, 0644);
    if (fork() == 0) {
        write(fd, "child\\n", 6);
        return 0;
    }
    wait(NULL);
    write(fd, "parent\\n", 7);
    close(fd);
    execlp("cat", "cat", "log", NULL);
    return 1;
}` },
    separate: { file: 'separate.c', label: 'fork, then open: two entries', src: `#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    pid_t k = fork();
    int fd = open("log",
        O_WRONLY | O_CREAT, 0644);
    if (k == 0) {
        write(fd, "child\\n", 6);
        return 0;
    }
    wait(NULL);
    write(fd, "parent\\n", 7);
    close(fd);
    execlp("cat", "cat", "log", NULL);
    return 1;
}` },
  };
  X.SHARE_PROGS = SHARE;

  S.topic({
    id: 'p03-fdtables', family: 'p03-pipes', order: 20, title: 'Descriptor tables after fork',
    blurb: 'The kernel keeps three tables: each process\'s descriptor table, a system-wide table of open files (each with its offset), and the files. fork copies the descriptor table, so parent and child point at the same open-file entries and share their offsets: what one writes, the other writes after. Two separate opens make two entries with two offsets, and the writes land on top of each other.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'shared', options: Object.keys(SHARE).map((k) => ({ value: k, label: SHARE[k].label })) }],
    presets: [{ label: 'Open, then fork: a shared offset', values: { prog: 'shared' } }, { label: 'Fork, then open: the parent overwrites', values: { prog: 'separate' } }],
    counters: [{ id: 'entries', label: 'open-file entries for log' }],
    run(inp) {
      const pr = SHARE[inp.prog];
      const sys = X.drive(pr.src, {}, []);
      const { F } = X.cframes({ sys, src: pr.src, file: pr.file, files: ['log'], counters: ['entries'], count: (F, b) => F.set('entries', Object.values(b.ks.ofiles).filter((f) => f.kind === 'file').length), extra: (b) => { const ino = b.ks.files.dir['log'], d = ino !== undefined ? b.ks.files.inodes[ino].data : ''; return { file: d, size: d.length }; } });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Three tables', text: ['descriptor table: per process,', '  fd -> open-file entry', 'open-file table: system-wide,', '  offset, flags, references', 'inode: the file itself', 'fork: copies descriptors,', '  shares the entries (refs + 1)', 'open: always a new entry'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join('') } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'write' && fr[i + 1].meta.evs[0].text === 'parent\n', pick: 'option', ask: 'The parent now writes "parent\\n" (7 bytes). At which offset of log does it land?', options: ['0', '6'], answer: (fr, i) => (fr[i].meta.size === 6 && fr[i].meta.ofiles.some((o) => o.offset === 6 && o.refs >= 1) && fr.find((g) => g.meta.phase === 'write' && g.meta.evs[0].text === 'parent\n').meta.size === 13 ? '6' : '0'), explain: (fr, i) => fr[i + 1].say + ' The file now holds ' + fr[i + 1].meta.size + ' bytes.' },
    ],
    quiz: [
      { q: 'A parent opens a file, then forks. Both write. How many open-file entries are there for the file?', options: ['1, with 2 references', '2', '0', 'one per write'], answer: 0, why: 'fork copies descriptors, not entries; both descriptors point at the one entry.' },
      { q: 'Why do the parent\'s bytes follow the child\'s in the shared case?', options: ['they share one offset, which the child\'s write moved', 'the kernel appends always', 'the parent waits', 'files grow only at the end'], answer: 0, why: 'The offset lives in the open-file entry, which both use.' },
      { q: 'Each process opens the file itself, after fork. What happens to the child\'s 6 bytes when the parent writes 7 at offset 0?', options: ['they are overwritten', 'they move to the end', 'the write fails', 'they are kept and the file is 13 bytes'], answer: 0, why: 'The parent\'s entry has its own offset, still 0.' },
      { q: 'What does an open-file entry hold that a descriptor does not?', options: ['the offset and the access mode', 'the file\'s bytes', 'the process id', 'the file name only'], answer: 0, why: 'A descriptor is just a small number naming an entry.' },
    ],
  });

  const DUP = {
    lost: { file: 'tee.c', label: 'dup2 there and back (one line is lost)', src: `#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
int main(void) {
    int fd = open("out",
        O_WRONLY | O_CREAT, 0644);
    int saved = dup(1);
    dup2(fd, 1);
    printf("into the file\\n");
    fflush(stdout);
    dup2(saved, 1);
    close(saved);
    printf("back on screen\\n");
    execlp("cat", "cat", "out", NULL);
    return 1;
}` },
    fixed: { file: 'tee2.c', label: 'dup2 there and back, flushed', src: `#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
int main(void) {
    int fd = open("out",
        O_WRONLY | O_CREAT, 0644);
    int saved = dup(1);
    dup2(fd, 1);
    printf("into the file\\n");
    fflush(stdout);
    dup2(saved, 1);
    close(saved);
    printf("back on screen\\n");
    fflush(stdout);
    execlp("cat", "cat", "out", NULL);
    return 1;
}` },
    redirect: { file: 'redir.c', label: 'ls > out, as a shell does it', src: `#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    pid_t k = fork();
    if (k == 0) {
        int fd = open("out",
            O_WRONLY | O_CREAT, 0644);
        dup2(fd, 1);
        close(fd);
        execlp("ls", "ls", NULL);
        return 1;
    }
    waitpid(k, NULL, 0);
    execlp("wc", "wc", "out", NULL);
    return 1;
}` },
  };
  X.DUP_PROGS = DUP;
  const FILES = { 'notes.txt': 'milk\neggs\n', 'plan.txt': 'week one\n' };
  X.DUP_FILES = FILES;
  S.topic({
    id: 'p03-dup', family: 'p03-pipes', order: 30, title: 'dup, dup2 and redirection',
    blurb: 'dup(fd) gives a second, lowest free descriptor for the same open-file entry; dup2(fd, 1) makes descriptor 1 name it, closing whatever 1 named before. A program writes to descriptor 1 without knowing what it is, so a shell redirects ls > out by opening the file in the child, moving it onto 1 with dup2, and then running ls. exec keeps the descriptors, so ls writes into the file.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'redirect', options: Object.keys(DUP).map((k) => ({ value: k, label: DUP[k].label })) }],
    presets: [{ label: 'ls > out', values: { prog: 'redirect' } }, { label: 'Save, redirect, restore: a lost line', values: { prog: 'lost' } }, { label: 'The same, flushed in time', values: { prog: 'fixed' } }],
    counters: [{ id: 'dups', label: 'dup and dup2 calls' }],
    run(inp) {
      const pr = DUP[inp.prog], name = 'out';
      const sys = X.drive(pr.src, { files: FILES }, []);
      let dups = 0;
      const { F } = X.cframes({ sys, src: pr.src, file: pr.file, files: [name], counters: ['dups'], count: (F, b) => { dups += b.evs.filter((e) => e.kind === 'dup').length; F.set('dups', dups); }, extra: (b) => { const ino = b.ks.files.dir[name]; return { file: ino !== undefined ? b.ks.files.inodes[ino].data : '' }; } });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Moving descriptors', text: ['dup(fd): lowest free fd,', '  same open-file entry', 'dup2(fd, n): close n,', '  then n names fd\'s entry', 'cmd > file, in the child:', '  fd = open(file)', '  dup2(fd, 1); close(fd)', '  exec(cmd): fds survive'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join('') } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'exec' && fr.some((g) => g.meta.phase === 'exec'), once: true, pick: 'option', ask: 'exec is next. Do the descriptors the program set up survive it?', options: ['yes: exec keeps the descriptor table', 'no: exec resets 0, 1 and 2 to the terminal'], answer: 'yes: exec keeps the descriptor table', explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'After dup2(fd, 1), what does printf write to?', options: ['whatever fd names, such as a file', 'the terminal, always', 'nothing: 1 is closed', 'both'], answer: 0, why: 'Descriptor 1 now names fd\'s open-file entry.' },
      { q: 'Why does the shell call dup2 in the child, not in itself?', options: ['so only the command\'s output goes to the file, not the shell\'s', 'the parent cannot call dup2', 'exec needs it', 'for speed'], answer: 0, why: 'The shell keeps its own descriptor 1 on the terminal.' },
      { q: 'dup(1) returns 4 when 0 to 3 are open. Which entry does 4 name?', options: ['the same entry as 1', 'a new entry for the terminal', 'nothing yet', 'entry 4'], answer: 0, why: 'dup shares the entry; only open makes a new one.' },
      { q: 'In the lost-line program, why does "back on screen" never appear?', options: ['stdout was fully buffered (it first wrote to a file) and exec threw the buffer away', 'dup2 failed', 'cat deleted it', 'the terminal was closed'], answer: 0, why: 'The C library chose the buffering at the first output, when 1 was a file; nothing flushed before exec.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
