// Part 3, inter-process communication and signals: the challenges, the guided tour, the course, and the pages the
// diagram checker looks at. Both challenges are of the shell kind: the reader's shell runs on the simulated kernel,
// hidden tests type lines into it under several seeded random schedules, and each test checks the output, that a
// foreground line is waited for before the next is read, and that the shell reaps every child itself.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('ipc-ch-pipes')) return;

  const STARTER = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>

#define MAXW 24

int main(void) {
    char line[128];
    while (fgets(line, sizeof line, stdin)) {
        char *w[MAXW];
        int n = 0;
        char *t = strtok(line, " \\t\\n");
        while (t && n < MAXW - 1) {
            w[n++] = t;
            t = strtok(NULL, " \\t\\n");
        }
        w[n] = NULL;
        if (n == 0)
            continue;
        /* for now: one command, run in a child and waited for */
        pid_t k = fork();
        if (k == 0) {
            execvp(w[0], w);
            fprintf(stderr, "%s: no such command\\n", w[0]);
            _exit(127);
        }
        waitpid(k, NULL, 0);
    }
    return 0;
}
`;
  const SH1 = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/wait.h>

#define MAXW 24

/* one stage of a pipeline, in a child: read from in, write to out, close the spare pipe end, run it */
void stage(char **w, int in, int out, int spare) {
    if (fork() == 0) {
        if (in != 0) {
            dup2(in, 0);
            close(in);
        }
        if (out != 1) {
            dup2(out, 1);
            close(out);
        }
        if (spare >= 0)
            close(spare);
        execvp(w[0], w);
        fprintf(stderr, "%s: no such command\\n", w[0]);
        _exit(127);
    }
}

int main(void) {
    char line[128];
    while (fgets(line, sizeof line, stdin)) {
        char *w[MAXW];
        char *from = NULL, *to = NULL;
        int n = 0;
        char *t = strtok(line, " \\t\\n");
        while (t && n < MAXW - 1) {
            if (strcmp(t, "<") == 0)
                from = strtok(NULL, " \\t\\n");
            else if (strcmp(t, ">") == 0)
                to = strtok(NULL, " \\t\\n");
            else
                w[n++] = t;
            t = strtok(NULL, " \\t\\n");
        }
        w[n] = NULL;
        if (n == 0)
            continue;
        int in = from ? open(from, O_RDONLY) : 0;
        int start = 0, kids = 0;
        for (int i = 0; i <= n; i++) {
            if (i < n && strcmp(w[i], "|") != 0)
                continue;
            int p[2];
            int out = 1, spare = -1;
            w[i] = NULL;
            if (i < n) {
                pipe(p);
                out = p[1];
                spare = p[0];
            } else if (to) {
                out = open(to, O_WRONLY | O_CREAT | O_TRUNC, 0644);
            }
            stage(w + start, in, out, spare);
            kids++;
            if (in != 0)
                close(in);
            if (out != 1)
                close(out);
            in = spare >= 0 ? spare : 0;
            start = i + 1;
        }
        while (kids > 0) {
            wait(NULL);
            kids--;
        }
    }
    return 0;
}
`;
  const SH2 = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>

#define MAXW 24

/* SIGCHLD: reap every child that has finished, without waiting for any */
void reap(int sig) {
    while (waitpid(-1, NULL, WNOHANG) > 0)
        ;
}

/* one stage of a pipeline, in a child: read from in, write to out, close the spare pipe end, run it */
pid_t stage(char **w, int in, int out, int spare) {
    pid_t k = fork();
    if (k == 0) {
        if (in != 0) {
            dup2(in, 0);
            close(in);
        }
        if (out != 1) {
            dup2(out, 1);
            close(out);
        }
        if (spare >= 0)
            close(spare);
        execvp(w[0], w);
        fprintf(stderr, "%s: no such command\\n", w[0]);
        _exit(127);
    }
    return k;
}

int main(void) {
    char line[128];
    signal(SIGCHLD, reap);
    while (fgets(line, sizeof line, stdin)) {
        char *w[MAXW];
        char *from = NULL, *to = NULL;
        int n = 0;
        char *t = strtok(line, " \\t\\n");
        while (t && n < MAXW - 1) {
            if (strcmp(t, "<") == 0)
                from = strtok(NULL, " \\t\\n");
            else if (strcmp(t, ">") == 0)
                to = strtok(NULL, " \\t\\n");
            else
                w[n++] = t;
            t = strtok(NULL, " \\t\\n");
        }
        w[n] = NULL;
        int bg = n > 0 && strcmp(w[n - 1], "&") == 0;
        if (bg)
            w[--n] = NULL;
        if (n == 0)
            continue;
        int in = from ? open(from, O_RDONLY) : 0;
        pid_t kids[8];
        int start = 0, nk = 0;
        for (int i = 0; i <= n; i++) {
            if (i < n && strcmp(w[i], "|") != 0)
                continue;
            int p[2];
            int out = 1, spare = -1;
            w[i] = NULL;
            if (i < n) {
                pipe(p);
                out = p[1];
                spare = p[0];
            } else if (to) {
                out = open(to, O_WRONLY | O_CREAT | O_TRUNC, 0644);
            }
            kids[nk++] = stage(w + start, in, out, spare);
            if (in != 0)
                close(in);
            if (out != 1)
                close(out);
            in = spare >= 0 ? spare : 0;
            start = i + 1;
        }
        if (!bg)
            for (int j = 0; j < nk; j++)
                waitpid(kids[j], NULL, 0);
    }
    while (wait(NULL) > 0)
        ;
    return 0;
}
`;
  const STOCK = { 'stock.txt': 'tea\ncocoa\nmilk\nbread\n' };

  // ---- 1. pipelines and redirection ------------------------------------------------------------------------------
  C.challenge({ id: 'ipc-ch-pipes', n: 31, title: 'The night-shift shell', level: 2, kind: 'shell',
    story: 'A corner shop runs its stock-taking at night on an old terminal, and the shell on it can only run one command at a time. The night clerk wants to type things like `cat stock.txt | sort | head -n 2` and `sort < stock.txt > shelf.txt`.\n\nExtend the shell. A line may join commands with `|` (two or three of them), and may end with `< file` and `> file` (the first command reads the input file, the last writes the output file, created or emptied). Each command runs in its own child; the shell waits for every child of a line before it reads the next one, and reaps every child itself. Every pipe end a process does not use must be closed, or a reader never sees end of file.',
    task: 'Complete the shell so that pipelines and < and > redirection work, with every child waited for and reaped by the shell.',
    metricName: 'tests passed', target: 7, marks: { gold: 7 },
    limits: { forbid: ['system', 'popen'], maxLines: 110 },
    starter: STARTER,
    tests: [
      { name: 'one command', input: 'echo good evening\n', expect: 'good evening\n', foreground: true, reaped: true, visible: true },
      { name: 'two lines in order', input: 'echo first\necho second\n', expect: 'first\nsecond\n', foreground: true, reaped: true },
      { name: 'a pipe', input: 'cat stock.txt | sort\n', files: STOCK, expect: 'bread\ncocoa\nmilk\ntea\n', foreground: true, reaped: true },
      { name: 'three stages', input: 'cat stock.txt | sort | head -n 2\n', files: STOCK, expect: 'bread\ncocoa\n', foreground: true, reaped: true },
      { name: 'in and out', input: 'sort < stock.txt > shelf.txt\ncat shelf.txt\n', files: STOCK, expect: 'bread\ncocoa\nmilk\ntea\n', foreground: true, reaped: true },
      { name: 'count the words', input: 'echo late night stock take | wc\n', expect: '       1       4      22\n', foreground: true, reaped: true },
      { name: 'a pipe, then a line', input: 'echo b a | wc\necho after\n', expect: '       1       2       4\nafter\n', foreground: true, reaped: true },
    ],
    hints: ['Take < and > out of the words first, remembering the file names; then split what is left at each |.', 'For each command but the last, make a pipe: the command writes into it, and the next reads from it. In the child, dup2 its input onto 0 and its output onto 1 and close the originals, and the read end of a pipe it does not use. In the shell, close each end once the child that needs it has been forked.', 'Keep `in` (0, the input file, or the read end of the previous pipe); for each command fork a child that dup2s `in` onto 0 and its `out` (a new pipe\'s write end, the output file, or 1) onto 1; in the shell, close `in` and `out` after the fork and carry the new pipe\'s read end on as the next `in`. At the end, wait once for each child.'],
    solution: { src: SH1 },
    wrong: [{ src: SH1.replace('            if (out != 1)\n                close(out);\n', '') }, { src: SH1.replace('        while (kids > 0) {\n            wait(NULL);\n            kids--;\n        }\n', '') }, { src: STARTER }] });

  // ---- 2. background jobs, reaped -------------------------------------------------------------------------------------
  C.challenge({ id: 'ipc-ch-jobs', n: 32, title: 'No zombies in the bakery', level: 3, kind: 'shell',
    story: 'A bakery\'s ovens are watched by small timer programs that the night baker starts from a shell, in the background, while she goes on typing other commands. Last week the shell left dozens of finished timers as zombies, and the process table filled up.\n\nExtend the pipeline shell: a line ending in `&` runs in the background, so the shell does not wait for it and reads the next line at once. Foreground lines are still waited for. Every child, foreground or background, must be reaped by the shell itself: as background jobs end (a SIGCHLD handler that reaps with WNOHANG is the usual way), and, when the input ends, by waiting for any job still running before the shell exits. The night baker\'s rule: a job that has finished must be gone by the time the shell reads the next line, and the handler must never sit blocked in a wait while another timer is still running.',
    task: 'Add background jobs with `&` to the pipeline shell, waiting for foreground lines only and reaping every child itself.',
    metricName: 'tests passed', target: 7, marks: { gold: 7 },
    limits: { forbid: ['system', 'popen'], maxLines: 120 },
    starter: SH1,
    tests: [
      { name: 'a job in the background', input: 'sleep 1 &\necho started\n', expect: 'started\n', reaped: true, noZombies: true, visible: true },
      { name: 'two jobs', input: 'sleep 2 &\nsleep 1 &\necho two jobs\n', expect: 'two jobs\n', reaped: true, noZombies: true },
      { name: 'a job, then the foreground', input: 'sleep 1 &\ncat stock.txt | sort\necho end\n', files: STOCK, expect: 'bread\ncocoa\nmilk\ntea\nend\n', foreground: true, reaped: true, noZombies: true },
      { name: 'a job outlives a foreground line', input: 'sleep 3 &\nsleep 1\necho done\n', expect: 'done\n', foreground: true, reaped: true, noZombies: true },
      { name: 'a pipeline in the background', input: 'echo b a | wc &\nsleep 1\n', expect: '       1       2       4\n', reaped: true, noZombies: true },
      { name: 'a quick job, gone by the next line', input: 'true &\necho a\necho b\n', expect: 'a\nb\n', reaped: true, noZombies: true },
      { name: 'jobs end together', input: 'sleep 1 &\nsleep 1 &\nsleep 1 &\nsleep 2\necho over\n', expect: 'over\n', foreground: true, reaped: true, noZombies: true },
    ],
    hints: ['Look at the last word: if it is "&", remove it and remember that this line is not to be waited for. Keep the pids of a foreground line\'s children and wait for those with waitpid(pid, ...).', 'Install a SIGCHLD handler that loops on waitpid(-1, NULL, WNOHANG) > 0: several jobs can end before it runs. A foreground child it happens to reap first is no harm: your waitpid for it simply returns -1.', 'void reap(int s) { while (waitpid(-1, NULL, WNOHANG) > 0) ; } with signal(SIGCHLD, reap) at the start of main; skip the waits when the line ended in &; after the loop, while (wait(NULL) > 0) ; so no job is left to init.'],
    solution: { src: SH2 },
    wrong: [{ src: SH1 }, { src: SH2.replace('    signal(SIGCHLD, reap);\n', '') }, { src: SH2.replace('    while (waitpid(-1, NULL, WNOHANG) > 0)\n        ;', '    while (wait(NULL) > 0)\n        ;') }, { src: SH2.replace('    while (waitpid(-1, NULL, WNOHANG) > 0)\n        ;', '    waitpid(-1, NULL, WNOHANG);').replace('    while (wait(NULL) > 0)\n        ;\n    return 0;', '    return 0;') }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'ipc-tour', title: 'Tour: IPC and signals', blurb: 'Pipes and descriptor tables, dup2, shared memory against messages, signals and SIGCHLD, and a small shell, in eight steps.',
    steps: [
      { route: 'part=ipc', target: '#main', text: 'Part 3 of the catalogue: how processes talk to each other, and how the kernel taps them on the shoulder.' },
      { route: 'topic=p03-pipe', target: '#stageWrap', text: 'A real C program makes a pipe and forks. Beside the code: each process\'s descriptors, the open-file entries and the bytes in the pipe.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=p03-dup', target: '#inputs', text: 'dup2 moves a descriptor: this is how a shell sends a program\'s output into a file, without the program knowing.' },
      { route: 'topic=p03-msg', target: '#inputs', text: 'Message passing with its three choices: naming, the size of the queue, and whether send and receive wait.' },
      { route: 'topic=p03-sigchld', target: '#stageWrap', text: 'SIGCHLD and a handler that reaps in a loop: two exits can arrive as one signal.' },
      { route: 'topic=p03-shell-pipe', target: '#stageWrap', text: 'A shell runs ls | wc: one pipe, two children, dup2 in each, and every unused end closed.' },
      { route: 'learn', target: '[data-chapter="ipc-pipes"]', text: 'The lessons and exercises of this part start here: outputs to predict, process trees, and C to write and check, up to a shell of your own.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'ipc-course', title: 'IPC and signals', blurb: 'All eighteen topics of part 3, from a pipe between parent and child to a shell with background jobs, with lessons and exercises on the way.',
    steps: [
      { lesson: 'ipc-pipe', note: 'Why a pipe, and how end of file works.' },
      { topic: 'p03-pipe', note: 'Try the small pipe and the missing close.' },
      { exercise: 'ipc-x-pipe-orders', note: 'Every output of a pipe program.' },
      { exercise: 'ipc-x-hang', note: 'Find the close that is missing.' },
      { topic: 'p03-fdtables', note: 'One open-file entry or two.' },
      { exercise: 'ipc-x-shared-offset', note: 'A shared offset, line after line.' },
      { topic: 'p03-dup', note: 'Moving a descriptor onto 0 or 1.' },
      { exercise: 'ipc-x-code-dup2', note: 'Write it: stdout into a file.' },
      { topic: 'p03-fifo', note: 'A pipe any process can open by name.' },
      { exercise: 'ipc-x-fifo-epipe', note: 'Writing with no reader: SIGPIPE.' },
      { lesson: 'ipc-shm', note: 'Memory both can see.' },
      { topic: 'p03-shm', note: 'A ring buffer in shared memory.' },
      { exercise: 'ipc-x-ring-slots', note: 'Why one slot stays empty.' },
      { topic: 'p03-msg', note: 'Naming, blocking, buffering.' },
      { exercise: 'ipc-x-msg-waits', note: 'Which sends block on a queue of one.' },
      { topic: 'p03-sockets', note: 'Clients and servers.' },
      { topic: 'p03-rpc', note: 'A remote call, byte by byte.' },
      { exercise: 'ipc-x-rpc-bytes', note: 'Count the marshalled bytes.' },
      { topic: 'p03-rpc-retry', note: 'At least once, at most once.' },
      { exercise: 'ipc-x-retry-table', note: 'One network, two server rules.' },
      { lesson: 'ipc-signals', note: 'Handlers and the mask.' },
      { topic: 'p03-signal', note: '^C and what a process makes of it.' },
      { topic: 'p03-mask', note: 'Pending and blocked.' },
      { exercise: 'ipc-x-mask-count', note: 'Signals do not queue.' },
      { topic: 'p03-sigchld', note: 'Reaping without waiting.' },
      { exercise: 'ipc-x-code-sigchld', note: 'Write it: reap with WNOHANG in a loop.' },
      { topic: 'p03-kill', note: 'kill, SIGKILL and alarm.' },
      { exercise: 'ipc-x-term-race', note: 'sleep orders nothing.' },
      { lesson: 'ipc-shell', note: 'Run, pipe, redirect.' },
      { topic: 'p03-shell-run', note: 'Read, fork, exec, wait.' },
      { topic: 'p03-shell-pipe', note: 'A shell runs a pipeline.' },
      { exercise: 'ipc-x-code-pipeline', note: 'Write it: a two-command pipeline.' },
      { topic: 'p03-shell-redir', note: 'Redirection in the child.' },
      { exercise: 'ipc-x-code-redir-in', note: 'Write it: input from a file.' },
      { topic: 'p03-shell-bg', note: 'Background jobs and SIGCHLD.' },
      { exercise: 'ipc-x-bg-tree', note: 'Name the zombie and the orphans.' },
      { topic: 'p03-shell-jobs', note: 'Process groups and ^C.' },
      { exercise: 'ipc-x-ctrlc-group', note: 'Why each job needs its own group.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'lesson ipc-pipe')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'ipc').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['ipc-x-pipe-orders', 'ipc-x-code-pipe', 'ipc-x-msg-waits', 'ipc-x-retry-table', 'ipc-x-mask-count', 'ipc-x-once-tree', 'ipc-x-code-sigchld', 'ipc-x-bg-tree', 'ipc-x-idempotent', 'ipc-x-rpc-bytes'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course ipc-course', hash: 'course=ipc-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['ipc-ch-pipes', 'ipc-ch-jobs']) S.Checks.push({ group: 'learn', name: 'ipc challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
