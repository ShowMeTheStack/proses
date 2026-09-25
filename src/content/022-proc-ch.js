// Part 2, processes: the challenge, the guided tour, the course, and the pages the diagram checker looks at. The
// challenge is scored by the shell kind: each hidden test types some job lines into the reader's runner on the
// simulated kernel, over several seeded random schedules, and checks the output, that every foreground job was
// waited for, and that the runner reaped every child itself.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('proc-ch-runner')) return;

  // ---- the night runner: fork, exec, wait and the exit status ------------------------------------------------------
  const HEAD = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const STARTER = HEAD + 'int main(void) {\n    char line[128];\n    while (fgets(line, sizeof line, stdin)) {\n        char *argv[16];\n        int argc = 0;\n        char *w = strtok(line, " \\t\\n");\n        while (w && argc < 15) {\n            argv[argc] = w;\n            argc++;\n            w = strtok(NULL, " \\t\\n");\n        }\n        argv[argc] = NULL;\n        if (argc == 0)\n            continue;\n        if (fork() == 0) {\n            execvp(argv[0], argv);\n            _exit(127);\n        }\n    }\n    return 0;\n}\n';
  const RUNNER = HEAD + 'int main(void) {\n    char line[128];\n    while (fgets(line, sizeof line, stdin)) {\n        while (waitpid(-1, NULL, WNOHANG) > 0)\n            ;\n        char *argv[16];\n        int argc = 0;\n        char *w = strtok(line, " \\t\\n");\n        while (w && argc < 15) {\n            argv[argc] = w;\n            argc++;\n            w = strtok(NULL, " \\t\\n");\n        }\n        int bg = 0;\n        if (argc > 0 && strcmp(argv[argc - 1], "&") == 0) {\n            bg = 1;\n            argc--;\n        }\n        argv[argc] = NULL;\n        if (argc == 0)\n            continue;\n        pid_t k = fork();\n        if (k == 0) {\n            execvp(argv[0], argv);\n            _exit(127);\n        }\n        if (bg)\n            continue;\n        int st;\n        waitpid(k, &st, 0);\n        if (WIFEXITED(st) && WEXITSTATUS(st) != 0)\n            printf("! %s exited with %d\\n", argv[0], WEXITSTATUS(st));\n    }\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';
  const NOTES = { 'notes.txt': 'pear\napple\n' };
  C.challenge({ id: 'proc-ch-runner', n: 21, title: 'The night runner', level: 2, kind: 'shell',
    story: 'A small weather station runs its maintenance at night from a list of jobs, one command a line: copy the readings, check the sensors, tidy the logs. Nobody watches it. The first runner started every job at once and never waited, so jobs that needed the one before them ran too early, and the process table filled with zombies until fork failed in the small hours.\n\nWrite a runner that runs the jobs one after the other, reports any job that fails, and lets a slow job marked with `&` run in the background without leaving a zombie behind.',
    task: 'Read lines until end of input. Run each job with fork and execvp, and wait for it before reading the next line. If it exits with a code other than 0, print `! NAME exited with N` (a program that cannot be run exits with 127). A line ending in ` &` is not waited for; reap finished background jobs before each new line, and wait for all of them at the end.',
    metricName: 'tests passed', target: 6, marks: { gold: 6 },
    limits: { forbid: ['system', 'popen'], maxLines: 70 },
    starter: STARTER,
    tests: [
      { name: 'one job', input: 'echo all clear\n', expect: 'all clear\n', foreground: true, reaped: true, visible: true },
      { name: 'jobs in order', input: 'cat notes.txt\necho end\n', files: NOTES, expect: 'pear\napple\nend\n', foreground: true, reaped: true },
      { name: 'a job that fails', input: 'false\necho next\n', expect: '! false exited with 1\nnext\n', foreground: true, reaped: true },
      { name: 'a program that is not there', input: 'nosuchprog\necho still here\n', expectEnd: '! nosuchprog exited with 127\nstill here\n', foreground: true, reaped: true },
      { name: 'a file that is not there', input: 'cat gone.txt\ntrue\n', files: NOTES, expectEnd: '! cat exited with 1\n', foreground: true, reaped: true },
      { name: 'a job in the background', input: 'sleep 2 &\necho now\necho later\n', expect: 'now\nlater\n', reaped: true },
    ],
    hints: ['After fork, the parent must wait for that child with waitpid before it reads the next line; then decode the status with WIFEXITED and WEXITSTATUS.', 'If the last word is "&", drop it and do not wait. Before reading each new line, reap finished background jobs with waitpid(-1, NULL, WNOHANG) in a loop, and at end of input wait until wait returns −1.', 'pid_t k = fork(); if (k == 0) { execvp(argv[0], argv); _exit(127); } if (bg) continue; int st; waitpid(k, &st, 0); if (WIFEXITED(st) && WEXITSTATUS(st) != 0) printf("! %s exited with %d\\n", argv[0], WEXITSTATUS(st)); and, after the loop, while (wait(NULL) > 0) ;'],
    solution: { src: RUNNER },
    wrong: [{ src: STARTER }, { src: RUNNER.replace('    while (wait(NULL) > 0)\n        ;\n', '').replace('        while (waitpid(-1, NULL, WNOHANG) > 0)\n            ;\n', '') }, { src: RUNNER.replace('WEXITSTATUS(st) != 0)\n            printf("! %s exited with %d\\n", argv[0], WEXITSTATUS(st));', 'st != 0)\n            printf("! %s exited with %d\\n", argv[0], st);') }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'proc-tour', title: 'Tour: processes', blurb: 'A program running, fork, exec and wait, zombies and orphans, and why a printf can print twice, in eight steps.',
    steps: [
      { route: 'part=processes', target: '#main', text: 'Part 2 of the catalogue: what a process is, how one is made from another, and what is left of it when it ends.' },
      { route: 'topic=p02-layout', target: '#stageWrap', text: 'A process\'s address space as it runs: the stack grows down with each call, the heap grows up with each malloc.' },
      { route: 'topic=p02-states', target: '#stageWrap', text: 'The state diagram, live: watch each process move between ready, running and blocked, and on to zombie.' },
      { route: 'topic=p02-fork', target: '#btnPlay', text: 'fork returns twice. Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=p02-forktree', target: '#inputs', text: 'Choose a program and N: forks in a loop, a fan, a chain, fork() && fork(). The tree grows as the processes run.' },
      { route: 'topic=p02-zombie', target: '#stageWrap', text: 'A zombie waits for its parent\'s wait; an orphan is adopted by init, which reaps it.' },
      { route: 'topic=p02-stdio', target: '#stageWrap', text: 'stdout\'s buffer is copied by fork: switch stdout to a pipe and see a line printed twice.' },
      { route: 'learn', target: '[data-chapter="proc-image"]', text: 'The lessons and exercises of this part start here: outputs of fork programs, process trees, status words, and C to write and check.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'proc-course', title: 'Processes', blurb: 'All twelve topics of part 2, from a program\'s address space to every order its processes can print in, with lessons and exercises on the way.',
    steps: [
      { lesson: 'proc-space', note: 'What a process is, and where its variables live.' },
      { topic: 'p02-layout', note: 'The address space, growing.' },
      { exercise: 'proc-x-where', note: 'Text, data, heap or stack.' },
      { topic: 'p02-pcb', note: 'The process control block, field by field.' },
      { exercise: 'proc-x-pcb-fields', note: 'What the PCB holds.' },
      { lesson: 'proc-states', note: 'Ready, running, blocked.' },
      { topic: 'p02-states', note: 'The state diagram, live.' },
      { exercise: 'proc-x-arrow', note: 'The arrow that is missing.' },
      { topic: 'p02-switch', note: 'The context switch.' },
      { exercise: 'proc-x-switch-table', note: 'What a switch changes.' },
      { lesson: 'proc-fork', note: 'fork returns twice.' },
      { topic: 'p02-fork', note: 'Two copies of every variable.' },
      { exercise: 'proc-x-beans', note: 'Every output of a fork.' },
      { topic: 'p02-forktree', note: 'Counting the processes.' },
      { exercise: 'proc-x-andand', note: 'fork() && fork().' },
      { topic: 'p02-exec', note: 'A new program, the same process.' },
      { exercise: 'proc-x-exec-out', note: 'What runs after exec.' },
      { topic: 'p02-wait', note: 'wait, waitpid and the status word.' },
      { exercise: 'proc-x-status', note: 'The status word by hand.' },
      { exercise: 'proc-x-code-sum', note: 'Add up what the workers report.' },
      { lesson: 'proc-zombie', note: 'Zombies, orphans and init.' },
      { topic: 'p02-zombie', note: 'Who reaps whom.' },
      { exercise: 'proc-x-family', note: 'Zombies and orphans in one family.' },
      { exercise: 'proc-x-code-reap', note: 'Make the parent reap every child.' },
      { topic: 'p02-cow', note: 'Copy-on-write.' },
      { exercise: 'proc-x-cow-count', note: 'How many pages are copied.' },
      { topic: 'p02-stdio', note: 'Why a printf can print twice.' },
      { exercise: 'proc-x-code-flush', note: 'Print the log line once.' },
      { topic: 'p02-orders', note: 'Every order a program can print in.' },
      { exercise: 'proc-x-ord-three', note: 'One line against two.' },
      { exercise: 'proc-x-sleep-tie', note: 'Orders set by the clock.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'lesson proc-space')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'processes').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['proc-x-where', 'proc-x-switch-table', 'proc-x-beans', 'proc-x-fan-orders', 'proc-x-tree-parents', 'proc-x-code-run', 'proc-x-status', 'proc-x-family', 'proc-x-code-detach', 'proc-x-cow-count', 'proc-x-pipe-twice'])
      S.Checks.push({ group: 'learn', name: 'exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'course proc-course', hash: 'course=proc-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'proc challenge proc-ch-runner', hash: 'challenge/proc-ch-runner', ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
