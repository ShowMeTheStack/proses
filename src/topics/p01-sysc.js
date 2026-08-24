// Part 1, system calls in a real C program: which lines of a program trap into the kernel, and which stay in user
// mode. printf is a library function: it formats into the process's stdout buffer, and only a flush makes the
// write system call. On a terminal the buffer is flushed at every newline; on a pipe only when it fills, on
// fflush or at exit, so the same program makes far fewer system calls. From S.Kern's trace.
(function (S) {
  'use strict';
  const H = S.PX;
  const PROGS = [
    {
      name: 'three lines, then one without a newline', file: 'lines.c',
      src: `#include <stdio.h>
#include <unistd.h>
int main(void) {
    for (int i = 1; i <= 3; i++)
        printf("line %d\\n", i);
    printf("no newline");
    write(1, "!\\n", 2);
    return 0;
}`,
    },
    {
      name: 'a row of numbers', file: 'row.c',
      src: `#include <stdio.h>
int main(void) {
    for (int i = 1; i <= 6; i++)
        printf("%d ", i * i);
    printf("\\n");
    printf("done\\n");
    return 0;
}`,
    },
    {
      name: 'fflush before a long wait', file: 'wait.c',
      src: `#include <stdio.h>
#include <unistd.h>
int main(void) {
    printf("working...");
    fflush(stdout);
    sleep(1);
    printf(" done\\n");
    return 0;
}`,
    },
    {
      name: 'a file read and written', file: 'copy.c',
      src: `#include <fcntl.h>
#include <unistd.h>
int main(void) {
    char buf[16];
    int fd = open("in.txt", O_RDONLY);
    int n = read(fd, buf, sizeof buf);
    close(fd);
    write(1, buf, n);
    return 0;
}`,
      files: { 'in.txt': 'pears, plums\n' },
    },
  ];
  (H.SRC = H.SRC || {}).sysc = PROGS.map((p) => p.src);
  // the trace events that are system calls the program made (a write for every flush)
  const CALL = { print: 'write', write: 'write', read: 'read', open: 'open', close: 'close', fork: 'fork', exit: 'exit', sleep: 'sleep', block: null };

  S.topic({
    id: 'p01-sysc', family: 'p01-syscall', order: 20, title: 'Which lines of a C program call the kernel',
    blurb: 'Not every library function is a system call. printf formats text into a buffer in the program\'s own memory; nothing crosses into the kernel until the buffer is flushed with one write. Where stdout is a terminal, every newline flushes; where it is a pipe or a file, the buffer waits until it is full, fflush is called or the program exits. Step through and count the traps.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: '0', options: PROGS.map((p, i) => ({ value: String(i), label: p.name })) },
      { id: 'tty', kind: 'choice', label: 'stdout goes to', def: 'tty', options: [{ value: 'tty', label: 'the terminal (line-buffered)' }, { value: 'pipe', label: 'a pipe (fully buffered)' }] },
    ],
    presets: [
      { label: 'Three lines to the terminal', values: { prog: '0', tty: 'tty' } },
      { label: 'The same lines into a pipe', values: { prog: '0', tty: 'pipe' } },
      { label: 'A row of numbers', values: { prog: '1', tty: 'tty' } },
      { label: 'fflush before a long wait', values: { prog: '2', tty: 'tty' } },
      { label: 'open, read, close, write', values: { prog: '3', tty: 'tty' } },
    ],
    counters: [{ id: 'calls', label: 'system calls' }, { id: 'writes', label: 'write calls' }],
    run(inp) {
      const pr = PROGS[Number(inp.prog)], tty = inp.tty === 'tty';
      const sys = H.kern(pr.src, { tty, files: pr.files || {}, names: { 100: 'P' } });
      const bs = H.beats(sys, { skip: ['wait', 'reap', 'done', 'zombie'] }).filter((b) => b.pid === 100 || b.kind === 'start');
      const F = new S.Frames(['calls', 'writes']);
      const log = [];
      let calls = 0, writes = 0;
      bs.forEach((b) => {
        const call = CALL[b.kind];
        if (call) { calls++; if (call === 'write') writes++; log.push({ call, line: b.evs[0].line, text: b.evs[0].text }); }
        const sc = H.scene({ sys, beat: b, src: pr.src, file: pr.file, depth: 0, codeW: 420, lineH: 20, treeOpts: { hide: ['init', 'shell'], boxW: 132 }, rowsShown: 3, termTitle: tty ? 'terminal' : 'the pipe out of the program',
          extraRight: (y, x, w) => {
            const items = [H.title('sl:t', x, y + 10, 'system calls so far: ' + calls)];
            if (!log.length) items.push(H.text('sl:n', x, y + 34, 'none yet', '', 13));
            log.slice(-4).forEach((c, k) => {
              const i = log.length - Math.min(4, log.length) + k, last = i === log.length - 1 && !!call;
              items.push(H.cell('sl:c' + i, x, y + 22 + k * 30, w, 26, c.call + (c.line ? ' (line ' + c.line + ')' : '') + (c.text !== undefined ? ': "' + String(c.text).replace(/\n/g, '\\n').slice(0, 22) + (String(c.text).length > 22 ? '…' : '') + '"' : ''), 'vec mono' + (last ? ' act' : ''), { size: 13, align: 'left' }));
            });
            if (b.kind === 'buffer') items.push(H.text('sl:b', x, y + 22 + Math.min(4, Math.max(1, log.length)) * 30 + 18, 'this printf made no system call', 'good', 13));
            return { items, h: 22 + Math.min(4, Math.max(1, log.length)) * 30 + (b.kind === 'buffer' ? 26 : 0) };
          } });
        F.set('calls', calls).set('writes', writes);
        F.add({ items: sc.items, say: b.say + (b.kind === 'buffer' ? ' No system call: the text stays in user memory.' : call ? ' That is system call number ' + calls + ' of this run.' : ''), meta: H.metaOf(b, { calls, writes, log: log.slice() }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'stdio and the kernel', text: ['printf, puts, putchar: library code', '  into the stdout buffer', 'the buffer reaches the kernel', '  as one write(1, ...)', 'terminal: flushed at each newline', 'pipe or file: when full, on', '  fflush, or at exit', '_exit: no flush; text is lost'].join('\n') }] }, result: { calls, writes, out: sys.out } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && (fr[i + 1].meta.phase === 'buffer' || (fr[i + 1].meta.phase === 'print' && /printf/.test(fr[i + 1].say))), pick: 'option', ask: 'The program is about to call printf. Will this printf make a system call?', options: ['yes, a write', 'no, the text waits in the buffer'], answer: (fr, i) => (fr[i + 1].meta.phase === 'print' ? 'yes, a write' : 'no, the text waits in the buffer'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A program prints 1000 short lines into a pipe. About how many write system calls does stdio make?', options: ['a few: one each time the 4096-byte buffer fills, and one at exit', '1000', '2000', 'none'], answer: 0, why: 'Fully buffered output collects many lines into one write.' },
      { q: 'Why does output to a terminal flush at every newline?', options: ['so a person sees each line as soon as it is complete', 'terminals cannot buffer', 'it is faster', 'the kernel requires it'], answer: 0, why: 'Line buffering trades a few more system calls for prompt output.' },
      { q: 'Is printf a system call?', options: ['no: it is a library function that may call write', 'yes, always', 'only with a newline', 'only on Linux'], answer: 0, why: 'The trap happens only in write, when the buffer is flushed.' },
      { q: 'A program prints "saving..." with no newline, then works for a minute. What does fflush(stdout) change?', options: ['the text appears now instead of after the minute', 'nothing', 'the text is lost', 'the work runs faster'], answer: 0, why: 'Without it the text would wait in the buffer.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
