// Part 2, stdio buffering across fork: printf writes into a buffer in the process's own memory, and fork copies
// that memory, buffer and all. Under the terminal (or the pipe) the stdout buffer of every live process is drawn,
// so the copy can be watched leaving twice.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const INC = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const PROGS = {
    twice: {
      label: 'printf without a newline, then fork', file: 'hello.c', word: 'hello',
      src: INC + `int main(void) {
    printf("hello ");
    pid_t k = fork();
    if (k == 0) {
        printf("from the child\\n");
        return 0;
    }
    wait(NULL);
    printf("from the parent\\n");
    return 0;
}`,
    },
    line: {
      label: 'a whole line, then fork', file: 'start.c', word: 'start',
      src: INC + `int main(void) {
    printf("start\\n");
    if (fork() == 0) {
        printf("child\\n");
        return 0;
    }
    wait(NULL);
    printf("parent\\n");
    return 0;
}`,
    },
    flush: {
      label: 'fflush before fork', file: 'flush.c', word: 'ready',
      src: INC + `int main(void) {
    printf("ready ");
    fflush(stdout);
    if (fork() == 0) {
        printf("child\\n");
        return 0;
    }
    wait(NULL);
    printf("parent\\n");
    return 0;
}`,
    },
    quick: {
      label: '_exit throws the buffer away', file: 'quick.c', word: 'child',
      src: INC.replace('#include <unistd.h>', '#include <stdlib.h>\n#include <unistd.h>') + `int main(void) {
    if (fork() == 0) {
        printf("child says hi\\n");
        _exit(0);
    }
    wait(NULL);
    printf("parent\\n");
    exit(0);
}`,
    },
  };
  P.PROGS_STDIO = PROGS;

  S.topic({
    id: 'p02-stdio', family: 'p02-copy', order: 20, title: 'Why a printf can print twice',
    blurb: 'printf does not write at once: it copies the text into a buffer in the process\'s own memory, and the C library writes the buffer out later. To a terminal it writes at each newline; to a pipe or a file only when the buffer fills, on fflush, or at exit. fork copies the whole memory, so text still waiting in the buffer is now waiting in two processes, and both write it. fflush before fork empties the buffer first; _exit leaves without writing it at all.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'twice', options: P.options(PROGS) },
      { id: 'out', kind: 'choice', label: 'stdout goes to', def: 'tty', options: [{ value: 'tty', label: 'the terminal (line-buffered)' }, { value: 'pipe', label: 'a pipe, as in ./a.out | cat (fully buffered)' }] },
    ],
    presets: [
      { label: 'No newline before fork: twice', values: { prog: 'twice', out: 'tty' } },
      { label: 'A whole line on the terminal: once', values: { prog: 'line', out: 'tty' } },
      { label: 'The same line into a pipe: twice', values: { prog: 'line', out: 'pipe' } },
      { label: 'fflush before fork: once', values: { prog: 'flush', out: 'pipe' } },
      { label: '_exit into a pipe: the child\'s line is lost', values: { prog: 'quick', out: 'pipe' } },
      { label: '_exit on the terminal: nothing lost', values: { prog: 'quick', out: 'tty' } },
    ],
    counters: [{ id: 'writes', label: 'writes to stdout' }, { id: 'lost', label: 'bytes thrown away' }],
    run(inp) {
      const pr = PROGS[inp.prog], tty = inp.out === 'tty', sys = P.run(pr.src, { cow: false, tty, policy: 'fifo' });
      const bs = P.beats(sys, { skip: ['wake', 'cow'] }), F = new S.Frames(['writes', 'lost']);
      const final = sys.term.map((w) => w.text).join(''), times = final.split(pr.word).length - 1;
      let lost = 0;
      bs.forEach((b) => {
        if (b.kind === 'lost') lost += b.evs[0].text.length;
        F.set('writes', b.nterm).set('lost', lost);
        const sc = P.scene({ sys, beat: b, src: pr.src, file: pr.file, rowsShown: 3, buffers: true, termTitle: tty ? 'terminal' : 'the pipe: what the reader gets', noReaped: true });
        F.add({ items: sc.items, say: b.say, meta: H.metaOf(b, { writes: b.nterm, lost, times, word: pr.word }), title: b.kind });
      });
      F.add({ items: F.last().items, say: '"' + pr.word + '" appears ' + (times === 1 ? 'once' : times === 2 ? 'twice' : times + ' times') + ' in the output' + (tty ? ', written to a terminal.' : ', written into a pipe.'), meta: { phase: 'total', times, word: pr.word, final } });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'stdout\'s buffer', text: ['to a terminal: line-buffered,', '  written at each newline', 'to a pipe or file: fully buffered,', '  written when full, on fflush', '  or at exit', 'stderr: unbuffered', 'fork copies the buffer with', '  the rest of memory', '_exit and exec: never written'].join('\n') }] }, result: { final, times } };
    },
    predict: [
      { at: (f, i) => i === 0, once: true, pick: 'option', ask: (fr, i, inp) => 'How many times will "' + PROGS[inp.prog].word + '" appear in the output?', options: ['0', '1', '2'], answer: (fr) => String(fr[fr.length - 1].meta.times), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'printf("x"); fork(); with stdout a terminal. How many x?', options: ['2', '1', '0', 'it depends on the scheduler'], answer: 0, why: 'No newline, so "x" is still in the buffer when fork copies it.' },
      { q: 'printf("x\\n"); fork(); with stdout a terminal. How many x?', options: ['1', '2', '0', '3'], answer: 0, why: 'On a terminal the newline flushes the buffer before fork.' },
      { q: 'The same program run as ./a.out > out.txt. How many x?', options: ['2', '1', '0', '4'], answer: 0, why: 'To a file stdout is fully buffered, so the newline does not flush it.' },
      { q: 'What stops the duplicate?', options: ['fflush(stdout) before fork', 'calling fork twice', 'printing to a pipe', 'calling _exit in the parent'], answer: 0, why: 'An empty buffer has nothing to copy.' },
      { q: 'Why do children often end with _exit rather than exit?', options: ['so they do not write out (again) the stdio buffers they inherited', 'because exit is slower', 'to avoid becoming a zombie', 'so the parent need not wait'], answer: 0, why: '_exit skips the C library\'s cleanup, buffer flushing included.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
