// Part 3, pipes: a real C program makes a pipe, forks, and the two ends are passed between the processes'
// descriptor tables. The picture: the listing with each process's line, each process's descriptors pointing into
// the open-file table, the pipe's bytes, and the terminal. A read blocks while the pipe is empty and a writer has
// it open, and returns 0 (end of file) once no writer has; a write blocks while the pipe is full.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const PROGS = {
    basic: { file: 'pipe.c', label: 'parent reads what the child writes', src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    int p[2], n;
    char b[16];
    pipe(p);
    if (fork() == 0) {
        close(p[0]);
        write(p[1], "ping pong", 9);
        close(p[1]);
        return 0;
    }
    close(p[1]);
    while ((n = read(p[0], b, 6)) > 0)
        printf("[%.*s]\\n", n, b);
    printf("read gave %d\\n", n);
    wait(NULL);
    return 0;
}` },
    hang: { file: 'hang.c', label: 'the parent forgets to close its write end', src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    int p[2], n;
    char b[16];
    pipe(p);
    if (fork() == 0) {
        close(p[0]);
        write(p[1], "ping pong", 9);
        close(p[1]);
        return 0;
    }
    /* p[1] is never closed here */
    while ((n = read(p[0], b, 6)) > 0)
        printf("[%.*s]\\n", n, b);
    printf("read gave %d\\n", n);
    wait(NULL);
    return 0;
}` },
    two: { file: 'two.c', label: 'two writers, one reader', src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    int p[2], n, total = 0;
    char b[32];
    char *say[] = {"ant\\n", "bee\\n"};
    pipe(p);
    for (int i = 0; i < 2; i++)
        if (fork() == 0) {
            write(p[1], say[i], 4);
            return 0;
        }
    close(p[1]);
    while ((n = read(p[0], b, 9)) > 0)
        total += n;
    printf("%d bytes\\n", total);
    while (wait(NULL) > 0) ;
    return 0;
}` },
  };
  X.PIPE_PROGS = PROGS;

  S.topic({
    id: 'p03-pipe', family: 'p03-pipes', order: 10, title: 'A pipe between parent and child',
    blurb: 'pipe() gives a process two descriptors for one kernel buffer: bytes written to the second come out of the first, in order. After fork both processes hold both ends, so each closes the end it will not use. A read waits while the pipe is empty and some process could still write; once every write end is closed, read returns 0, end of file. Forget one close and the reader waits for ever.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'basic', options: Object.keys(PROGS).map((k) => ({ value: k, label: PROGS[k].label })) },
      { id: 'cap', kind: 'choice', label: 'Pipe capacity (bytes)', def: '4096', options: ['4', '8', '16', '4096'].map((v) => ({ value: v, label: v })) },
      { id: 'sched', kind: 'choice', label: 'Who runs next', def: 'fifo', options: [{ value: 'fifo', label: 'the running process keeps the CPU' }, { value: 'rr', label: 'round robin, a statement each' }] },
    ],
    presets: [
      { label: 'Parent reads, child writes', values: { prog: 'basic', cap: '4096', sched: 'fifo' } },
      { label: 'A small pipe: the writer waits', values: { prog: 'basic', cap: '4', sched: 'fifo' } },
      { label: 'Taking turns', values: { prog: 'basic', cap: '8', sched: 'rr' } },
      { label: 'The missing close: the reader hangs', values: { prog: 'hang', cap: '4096', sched: 'fifo' } },
      { label: 'Two writers share one pipe', values: { prog: 'two', cap: '4096', sched: 'rr' } },
    ],
    counters: [{ id: 'bytes', label: 'bytes through the pipe' }, { id: 'blocks', label: 'times a process waited' }],
    run(inp) {
      const pr = PROGS[inp.prog];
      const sys = X.drive(pr.src, { pipeCap: +inp.cap, policy: inp.sched }, []);
      let bytes = 0, blocks = 0;
      const { F, bs } = X.cframes({ sys, src: pr.src, file: pr.file, panel: 'fd', counters: ['bytes', 'blocks'], count: (F, b) => { for (const e of b.evs) { if (e.kind === 'read') bytes += e.n || 0; if (e.kind === 'block') blocks++; } F.set('bytes', bytes).set('blocks', blocks); }, extra: (b) => ({ cap: +inp.cap, status: sys.status() }) });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The rules of a pipe', text: ['pipe(p): p[0] reads, p[1] writes', 'read, pipe empty:', '  a write end still open: wait', '  no write end open: return 0', 'write, pipe full: wait for room', 'write, no read end open: SIGPIPE', 'after fork: close the end', '  each process does not use'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), status: sys.status(), beats: bs.length } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'read' && f.meta.phase !== 'read', pick: 'option', ask: 'The next step is a read of the pipe. What will it return?', options: ['some bytes', '0: end of file'], answer: (fr, i) => (fr[i + 1].meta.evs[0].n > 0 ? 'some bytes' : '0: end of file'), explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => f.meta.phase === 'block' && f.meta.evs[0].why === 'read' && fr[fr.length - 1].meta.status === 'deadlock' && fr.slice(i + 1).every((g) => g.meta.phase !== 'read'), once: true, pick: 'option', ask: 'The reader is waiting on an empty pipe. Will it ever get end of file?', options: ['yes, once the child closes its end', 'no: the parent itself still holds a write end'], answer: 'no: the parent itself still holds a write end', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'After pipe(fd) and fork(), how many descriptors refer to the pipe\'s write end?', options: ['2: one in each process', '1', '0', '4'], answer: 0, why: 'fork copies the descriptor table, so both processes hold fd[1]; both share one open-file entry with 2 references.' },
      { q: 'When does read on a pipe return 0?', options: ['when the pipe is empty and no write end is open anywhere', 'whenever the pipe is empty', 'after every write', 'never'], answer: 0, why: 'An empty pipe with a writer still open might get more bytes, so read waits instead.' },
      { q: 'The parent reads until end of file but never closes its own fd[1]. What happens?', options: ['the last read waits for ever', 'it gets end of file anyway', 'the child gets SIGPIPE', 'the kernel closes it'], answer: 0, why: 'The parent itself could still write, so the kernel cannot report end of file.' },
      { q: 'A pipe holds 4 bytes and the writer writes 9. What happens?', options: ['the writer waits until the reader makes room, then carries on', 'the 5 extra bytes are lost', 'write fails at once', 'the pipe grows'], answer: 0, why: 'A blocking write waits while the pipe is full.' },
      { q: 'Two children each write one short line to the same pipe. Can their lines interleave mid-line?', options: ['not for writes this small: each write up to the pipe\'s atomic size goes in whole', 'yes, always', 'only on one core', 'only if the reader is slow'], answer: 0, why: 'Small writes to a pipe are atomic; only the order of the whole lines depends on the schedule.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
