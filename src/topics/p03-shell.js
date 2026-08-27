// Part 3, building a shell in C, step by step, each step a real program on the simulated kernel: the read, fork,
// exec, wait loop; two commands joined by a pipe with dup2; redirection of input and output; and background jobs
// reaped by a SIGCHLD handler. The commands are the kernel's built-in programs (ls, echo, cat, wc, sort, sleep...).
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const FILES = { notes: 'pear\napple\nfig\n', todo: 'call home\nfix bike\n' };
  X.SHELL_FILES = FILES;
  const BUILT = ['ls', 'echo', 'cat', 'wc', 'sort', 'head', 'sleep', 'true', 'false'];
  const argv = (cmd) => '{' + cmd.trim().split(/\s+/).map((w) => '"' + w + '"').concat(['NULL']).join(', ') + '}';

  // ---------------------------------------------------------------------------------------------------------------
  // The loop
  // ---------------------------------------------------------------------------------------------------------------
  const LOOP = `#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    char line[64], *av[8];
    for (;;) {
        printf("$ "); fflush(stdout);
        if (!fgets(line, 64, stdin))
            break;
        int n = 0;
        av[0] = strtok(line, " \\n");
        while (av[n] && n < 7)
            av[++n] = strtok(NULL, " \\n");
        if (n == 0) continue;
        pid_t k = fork();
        if (k == 0) {
            execvp(av[0], av);
            perror(av[0]);
            _exit(127);
        }
        int st;
        waitpid(k, &st, 0);
        int code = WEXITSTATUS(st);
        printf("[exit %d]\\n", code);
    }
    return 0;
}`;
  X.SHELL_LOOP = LOOP;
  const checkCmds = (v) => {
    const cmds = String(v).split(';').map((c) => c.trim()).filter(Boolean);
    if (!cmds.length) return 'Commands: type at least one, like "echo hi"';
    if (cmds.length > 3) return 'Commands: at most 3, separated by ;';
    for (const c of cmds) { if (c.length > 30) return 'Commands: "' + c.slice(0, 12) + '…" is too long (30 characters at most)'; if (/^(yes)\b/.test(c)) return 'Commands: yes never stops; try another'; }
    return null;
  };
  S.topic({
    id: 'p03-shell-run', family: 'p03-shell', order: 10, title: 'A shell: read, fork, exec, wait',
    blurb: 'A shell is an ordinary program in a loop: print a prompt, read a line, cut it into words, fork, and in the child exec the program the first word names, with the words as its argv. The parent waits for the child and reads its exit status. If exec fails, the child must not fall back into the shell\'s loop: it reports the error and exits with 127.',
    inputs: [{ id: 'cmds', kind: 'text', label: 'What the user types (commands separated by ;)', def: 'echo hi there; wc notes; frob', check: checkCmds }],
    presets: [
      { label: 'Three commands, one unknown', values: { cmds: 'echo hi there; wc notes; frob' } },
      { label: 'List, then sort a file', values: { cmds: 'ls; sort notes' } },
      { label: 'An exit status', values: { cmds: 'false; true' } },
    ],
    counters: [{ id: 'forks', label: 'commands run' }],
    run(inp) {
      const typed = inp.cmds.split(';').map((c) => c.trim()).filter(Boolean).join('\n') + '\n';
      const sys = X.drive(LOOP, { input: typed, files: FILES }, []);
      let forks = 0;
      const { F } = X.cframes({ sys, src: LOOP, file: 'tiny-sh.c', rowsShown: 5, panel: 'fd', counters: ['forks'], beatsOpts: { skip: ['buffer'] }, count: (F, b) => { forks += b.evs.filter((e) => e.kind === 'fork').length; F.set('forks', forks); } });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'The loop', text: ['prompt; read a line', 'cut it into words: argv', 'fork:', '  child: execvp(argv[0], argv)', '    only returns on failure', '    -> report, _exit(127)', '  parent: waitpid(child)', 'repeat until end of input'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), typed } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'wait' && fr[i + 1].meta.evs[0].pid >= 100, pick: 'option', ask: 'The shell\'s waitpid returns next. What exit status will it print?', options: ['0', '1', '127'], answer: (fr, i) => String(fr[i + 1].meta.evs[0].code), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why does the shell fork before exec, instead of just calling exec?', options: ['exec replaces the caller: without the fork the shell itself would become the command', 'exec needs a new pid', 'fork is faster', 'to read the next line'], answer: 0, why: 'The child becomes the command; the parent stays the shell.' },
      { q: 'execvp returns. What does that mean?', options: ['it failed: on success it never returns', 'the command finished', 'the command printed something', 'nothing'], answer: 0, why: 'A successful exec replaces the program, so there is nothing to return to.' },
      { q: 'Why must the child call _exit after a failed exec?', options: ['otherwise it carries on as a second copy of the shell', 'to free memory', 'to wake the parent', 'it need not'], answer: 0, why: 'Two shells would then read the same terminal.' },
      { q: 'What does exit status 127 mean here?', options: ['the command could not be found or run', 'the command succeeded', 'it was killed', 'it timed out'], answer: 0, why: 'By convention 127 means not found; the shell shows it after the error.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // A pipeline
  // ---------------------------------------------------------------------------------------------------------------
  const pipeSrc = (a, b, closes) => `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    char *a[] = ${argv(a)};
    char *b[] = ${argv(b)};
    int p[2];
    pipe(p);
    if (fork() == 0) {
        dup2(p[1], 1);
        close(p[0]); close(p[1]);
        execvp(a[0], a);
        _exit(127);
    }
    if (fork() == 0) {
        dup2(p[0], 0);
        close(p[0]); close(p[1]);
        execvp(b[0], b);
        _exit(127);
    }
${closes ? '    close(p[0]); close(p[1]);' : '    /* the pipe is left open here */'}
    while (wait(NULL) > 0) ;
    return 0;
}`;
  X.pipeSrc = pipeSrc;
  const PIPES = { lswc: ['ls', 'wc'], sort: ['cat notes', 'sort'], head: ['sort todo', 'head -1'], echo: ['echo b a c', 'wc'] };
  S.topic({
    id: 'p03-shell-pipe', family: 'p03-shell', order: 20, title: 'A shell runs a pipeline',
    blurb: 'For cmd1 | cmd2 the shell makes a pipe, then forks twice. The first child moves the pipe\'s write end onto its descriptor 1 with dup2, the second moves the read end onto 0, and each closes both original descriptors before exec. The programs never know: they write to 1 and read from 0. The shell must close its own copies too, or the reader never sees end of file.',
    inputs: [
      { id: 'pipe', kind: 'choice', label: 'Pipeline', def: 'lswc', options: Object.keys(PIPES).map((k) => ({ value: k, label: PIPES[k].join(' | ') })) },
      { id: 'closes', kind: 'choice', label: 'The shell\'s own pipe descriptors', def: 'yes', options: [{ value: 'yes', label: 'closed after the forks' }, { value: 'no', label: 'left open' }] },
    ],
    presets: [
      { label: 'ls | wc', values: { pipe: 'lswc', closes: 'yes' } },
      { label: 'cat notes | sort', values: { pipe: 'sort', closes: 'yes' } },
      { label: 'sort todo | head -1', values: { pipe: 'head', closes: 'yes' } },
      { label: 'Left open: wc waits for ever', values: { pipe: 'lswc', closes: 'no' } },
    ],
    counters: [{ id: 'bytes', label: 'bytes through the pipe' }],
    run(inp) {
      const [a, b] = PIPES[inp.pipe], src = pipeSrc(a, b, inp.closes === 'yes');
      const sys = X.drive(src, { files: FILES }, []);
      let bytes = 0;
      const { F } = X.cframes({ sys, src, file: 'pipeline.c', panel: 'fd', counters: ['bytes'], count: (F, b2) => { for (const e of b2.evs) if (e.kind === 'read' && e.n) bytes += e.n; F.set('bytes', bytes); }, extra: () => ({ status: sys.status() }) });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'cmd1 | cmd2', text: ['pipe(p)', 'child 1: dup2(p[1], 1),', '  close both, exec cmd1', 'child 2: dup2(p[0], 0),', '  close both, exec cmd2', 'shell: close both, wait', 'an open write end anywhere:', '  cmd2 never reads EOF'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), status: sys.status(), src } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'done', pick: 'option', ask: 'Will the pipeline finish?', options: ['yes, every process exits', 'no, a process waits for ever'], answer: (fr, i) => (fr[i + 1].meta.status === 'done' ? 'yes, every process exits' : 'no, a process waits for ever'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'In cmd1 | cmd2, which descriptor of cmd1 is the pipe\'s write end after dup2?', options: ['1', '0', '3', '4'], answer: 0, why: 'cmd1 writes its output to descriptor 1 as always.' },
      { q: 'Why does each child close both original pipe descriptors after dup2?', options: ['a stray write end would keep the reader from ever seeing end of file', 'to save memory', 'exec requires it', 'to unblock the parent'], answer: 0, why: 'End of file needs every write end closed.' },
      { q: 'The shell forgets to close its copies. What happens to ls | wc?', options: ['wc waits for ever: the shell still holds a write end', 'it works the same', 'ls fails', 'wc prints twice'], answer: 0, why: 'wc never learns that no more input will come.' },
      { q: 'Do ls and wc know they are connected by a pipe?', options: ['no: they just use descriptors 1 and 0', 'yes, from argv', 'yes, from an environment variable', 'only wc'], answer: 0, why: 'The redirection happened before exec, in the shell\'s children.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
