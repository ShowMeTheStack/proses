// Part 14, the file-system interface: the challenges, the guided tour, the course, and the pages the diagram checker
// looks at. Both challenges are of the shell kind: the reader grows a small shell in the C subset, and hidden tests
// type command lines into it on the simulated kernel, under several random schedules, and compare what it prints.
// Here the tests are about descriptors: redirection opens a file and moves it onto descriptor 0, 1 or 2 with dup2,
// with the right open flags, and in the right order. Every expected output was also produced by the reference shells
// compiled with the system compiler and run on real files.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.challenges.has('fa-ch-redirect')) return;
  const ST1 = "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <sys/wait.h>\n\nint main(void) {\n    char line[128];\n    while (fgets(line, sizeof line, stdin)) {\n        char *argv[16];\n        int argc = 0;\n        char *w = strtok(line, \" \\t\\n\");\n        while (w && argc < 15) {\n            argv[argc] = w;\n            argc++;\n            w = strtok(NULL, \" \\t\\n\");\n        }\n        argv[argc] = NULL;\n        if (argc == 0)\n            continue;\n        pid_t k = fork();\n        if (k == 0) {\n            execvp(argv[0], argv);\n            perror(argv[0]);\n            exit(127);\n        }\n        waitpid(k, NULL, 0);\n    }\n    return 0;\n}\n";
  const SOL1 = "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <sys/wait.h>\n\nint main(void) {\n    char line[128];\n    while (fgets(line, sizeof line, stdin)) {\n        char *argv[16];\n        int argc = 0;\n        char *in = NULL;\n        char *out = NULL;\n        int append = 0;\n        char *w = strtok(line, \" \\t\\n\");\n        while (w && argc < 15) {\n            if (strcmp(w, \"<\") == 0) {\n                in = strtok(NULL, \" \\t\\n\");\n            } else if (strcmp(w, \">\") == 0) {\n                out = strtok(NULL, \" \\t\\n\");\n                append = 0;\n            } else if (strcmp(w, \">>\") == 0) {\n                out = strtok(NULL, \" \\t\\n\");\n                append = 1;\n            } else {\n                argv[argc] = w;\n                argc++;\n            }\n            w = strtok(NULL, \" \\t\\n\");\n        }\n        argv[argc] = NULL;\n        if (argc == 0)\n            continue;\n        pid_t k = fork();\n        if (k == 0) {\n            if (in) {\n                int f = open(in, O_RDONLY);\n                if (f < 0) {\n                    perror(in);\n                    exit(1);\n                }\n                dup2(f, 0);\n                close(f);\n            }\n            if (out) {\n                int flags = O_WRONLY | O_CREAT;\n                if (append)\n                    flags = flags | O_APPEND;\n                else\n                    flags = flags | O_TRUNC;\n                int f = open(out, flags, 0644);\n                dup2(f, 1);\n                close(f);\n            }\n            execvp(argv[0], argv);\n            perror(argv[0]);\n            exit(127);\n        }\n        waitpid(k, NULL, 0);\n    }\n    return 0;\n}\n";
  const SOL2 = "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <sys/wait.h>\n\n/* one redirection: which descriptor, and where it goes */\nstruct redir {\n    int fd;\n    int kind;\n    char *file;\n};\n\nint main(void) {\n    char line[128];\n    while (fgets(line, sizeof line, stdin)) {\n        char *argv[16];\n        struct redir r[8];\n        int argc = 0;\n        int nr = 0;\n        char *w = strtok(line, \" \\t\\n\");\n        while (w && argc < 15 && nr < 8) {\n            if (strcmp(w, \"<\") == 0) {\n                r[nr].fd = 0; r[nr].kind = 0; r[nr].file = strtok(NULL, \" \\t\\n\"); nr++;\n            } else if (strcmp(w, \">\") == 0) {\n                r[nr].fd = 1; r[nr].kind = 1; r[nr].file = strtok(NULL, \" \\t\\n\"); nr++;\n            } else if (strcmp(w, \">>\") == 0) {\n                r[nr].fd = 1; r[nr].kind = 2; r[nr].file = strtok(NULL, \" \\t\\n\"); nr++;\n            } else if (strcmp(w, \"2>\") == 0) {\n                r[nr].fd = 2; r[nr].kind = 1; r[nr].file = strtok(NULL, \" \\t\\n\"); nr++;\n            } else if (strcmp(w, \"2>&1\") == 0) {\n                r[nr].fd = 2; r[nr].kind = 3; r[nr].file = NULL; nr++;\n            } else {\n                argv[argc] = w;\n                argc++;\n            }\n            w = strtok(NULL, \" \\t\\n\");\n        }\n        argv[argc] = NULL;\n        if (argc == 0)\n            continue;\n        pid_t k = fork();\n        if (k == 0) {\n            for (int i = 0; i < nr; i++) {\n                if (r[i].kind == 3) {\n                    dup2(1, 2);\n                    continue;\n                }\n                int f;\n                if (r[i].kind == 0)\n                    f = open(r[i].file, O_RDONLY);\n                else if (r[i].kind == 1)\n                    f = open(r[i].file, O_WRONLY | O_CREAT | O_TRUNC, 0644);\n                else\n                    f = open(r[i].file, O_WRONLY | O_CREAT | O_APPEND, 0644);\n                if (f < 0) {\n                    perror(r[i].file);\n                    exit(1);\n                }\n                dup2(f, r[i].fd);\n                close(f);\n            }\n            execvp(argv[0], argv);\n            perror(argv[0]);\n            exit(127);\n        }\n        waitpid(k, NULL, 0);\n    }\n    return 0;\n}\n";
  const NOFILE = 'cat: nothere: No such file or directory\n';

  // ---- 1. redirection: <, > and >> -------------------------------------------------------------------------------
  C.challenge({ id: 'fa-ch-redirect', n: 141, title: 'A shell that keeps the logbook', level: 2, kind: 'shell',
    story: 'The harbour office runs its tide-gauge scripts through a tiny shell. It runs one program a line and nothing more, so every reading scrolls off the screen and is gone. The harbour master wants the readings kept in files: a fresh file for each day, a logbook that only ever grows, and programs that can read their input from a file.\n\nTeach the shell redirection.',
    task: 'Add `< file` (standard input from the file), `> file` (standard output to the file, emptied first) and `>> file` (standard output added to the end of the file). Do it in the child, between fork and execvp, with open and dup2.',
    metricName: 'tests passed', target: 8, marks: { gold: 8 },
    limits: { forbid: ['system', 'popen', 'freopen'], maxLines: 80 },
    starter: ST1,
    tests: [
      { name: 'one command', input: 'echo high water at six\n', expect: 'high water at six\n', foreground: true, reaped: true },
      { name: 'output to a file', input: 'echo calm > today.txt\ncat today.txt\n', expect: 'calm\n', foreground: true, reaped: true, visible: true },
      { name: '> empties the file first', input: 'echo a long reading here > today.txt\necho short > today.txt\ncat today.txt\n', expect: 'short\n', foreground: true, reaped: true },
      { name: '>> adds to the end', input: 'echo six >> log\necho seven >> log\ncat log\n', expect: 'six\nseven\n', foreground: true, reaped: true },
      { name: '>> keeps what was there', input: 'echo fog >> log\ncat log\n', files: { log: 'rain\nwind\n' }, expect: 'rain\nwind\nfog\n', foreground: true, reaped: true },
      { name: 'input from a file', input: 'wc < tides.txt\n', files: { 'tides.txt': 'high 0610\nlow 1225\nhigh 1840\n' }, expect: '       3       6      29\n', foreground: true, reaped: true },
      { name: 'both at once', input: 'sort < tides.txt > sorted.txt\ncat sorted.txt\n', files: { 'tides.txt': 'low 1225\nhigh 1840\nhigh 0610\n' }, expect: 'high 0610\nhigh 1840\nlow 1225\n', foreground: true, reaped: true },
      { name: 'a missing input file', input: 'cat < nothere\necho still running\n', expectEnd: 'still running\n', foreground: true, reaped: true },
    ],
    hints: ['While splitting the line into words, treat `<`, `>` and `>>` as signs, not arguments: the word after each is a file name. Leave them out of argv.', 'In the child, before execvp: for `<` open the file read-only and `dup2(f, 0)`; for `>` open it with `O_WRONLY | O_CREAT | O_TRUNC` and `dup2(f, 1)`; for `>>` use `O_APPEND` in place of `O_TRUNC`. Close f after the dup2, and if the open fails, print why and exit the child.', 'Only the child changes its descriptors, so the shell\'s own 0 and 1 stay on the terminal. The flags are the whole difference between > and >>: O_TRUNC empties the file at open, O_APPEND moves every write to the end.'],
    solution: { src: SOL1 },
    wrong: [{ src: ST1 }, { src: SOL1.replace('flags = flags | O_APPEND;', 'flags = flags | O_TRUNC;') }] });

  // ---- 2. standard error: 2> and 2>&1, in order -----------------------------------------------------------------
  const LATE = SOL2.replace('                if (r[i].kind == 3) {\n                    dup2(1, 2);\n                    continue;\n                }\n', '                if (r[i].kind == 3)\n                    continue;\n')
    .replace('            execvp(argv[0], argv);', '            for (int i = 0; i < nr; i++)\n                if (r[i].kind == 3)\n                    dup2(1, 2);\n            execvp(argv[0], argv);');
  C.challenge({ id: 'fa-ch-stderr', n: 142, title: 'Where the errors go', level: 3, kind: 'shell',
    story: 'The night watch leaves the harbour scripts running and reads the files in the morning. But the error messages still go to a screen nobody is looking at, so a missing tide table goes unnoticed for days. The scripts need their errors saved: sometimes in a file of their own, sometimes mixed in with the normal output, in the order they happened.\n\nThe shell already handles <, > and >>. Teach it about descriptor 2.',
    task: 'Add `2> file` (standard error to the file) and `2>&1` (standard error to wherever standard output goes at that moment). Redirections are applied from left to right, so `> f 2>&1` sends both to f, while `2>&1 > f` sends errors to the terminal and output to f.',
    metricName: 'tests passed', target: 6, marks: { gold: 6 },
    limits: { forbid: ['system', 'popen', 'freopen'], maxLines: 90 },
    starter: SOL1,
    tests: [
      { name: 'errors to a file', input: 'cat nothere 2> err.txt\necho morning\ncat err.txt\n', expect: 'morning\n' + NOFILE, foreground: true, reaped: true },
      { name: 'output is not touched by 2>', input: 'echo all quiet 2> err.txt\ncat err.txt\n', expect: 'all quiet\n', foreground: true, reaped: true },
      { name: 'both into one file, in order', input: 'cat tides.txt nothere > all.txt 2>&1\ncat all.txt\n', files: { 'tides.txt': 'high 0610\n' }, expect: 'high 0610\n' + NOFILE, foreground: true, reaped: true, visible: true },
      { name: 'order matters', input: 'cat nothere 2>&1 > out.txt\necho next\n', expect: NOFILE + 'next\n', foreground: true, reaped: true },
      { name: 'appending both', input: 'cat nothere >> log 2>&1\ncat log\n', files: { log: 'day one\n' }, expect: 'day one\n' + NOFILE, foreground: true, reaped: true },
      { name: 'input and errors', input: 'wc < tides.txt 2> err.txt\ncat err.txt\n', files: { 'tides.txt': 'low 1225\nhigh 1840\n' }, expect: '       2       4      19\n', foreground: true, reaped: true },
    ],
    hints: ['Keep the redirections in a list in the order they appear on the line, and apply them in that order in the child. `2>` is like `>` but onto descriptor 2.', '`2>&1` opens nothing: it is `dup2(1, 2)`, making descriptor 2 point to the open-file entry that descriptor 1 points to at that moment. Applied after `> f`, that entry is f\'s; applied before, it is still the terminal\'s.', 'Do not open the file a second time for 2>&1: two opens make two open-file entries with two offsets, and the error would be written over the output. One entry, shared through dup2, keeps one offset, so both streams follow one another.'],
    solution: { src: SOL2 },
    wrong: [{ src: SOL1 }, { src: LATE }] });

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'fa-tour', title: 'Tour: the file-system interface', blurb: 'A file\'s three places, the open-file tables, fork\'s shared offset, paths, links, mounting and permission bits, in nine steps.',
    steps: [
      { route: 'part=fsapi', target: '#main', text: 'Part 14 of the catalogue: files as a program sees them, through names, descriptors and permission bits.' },
      { route: 'topic=fs-file-ops', target: '#stageWrap', text: 'A file is a directory entry, an inode and some data blocks. Each command lights up the parts it touches: stat only the inode, rename only directories.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=fs-open-tables', target: '#stageWrap', text: 'Descriptors point to open-file entries, which hold the offsets, and the entries point to inodes. Watch dup share an offset and a second open get its own.' },
      { route: 'topic=fs-fork-offset', target: '#inputs', text: 'Open before fork and the writes follow one another; open after fork and they overwrite. Switch between the two here.' },
      { route: 'topic=fs-symlinks', target: '#stageWrap', text: 'Hard links name an inode and keep it alive; symbolic links name a path and can dangle.' },
      { route: 'topic=fs-permissions', target: '#inputs', text: 'Nine bits, three sets, and exactly one set applies. Change the uid and the mode and see who is let in.' },
      { route: 'labs/fs', target: '#labView', text: 'The File-system lab: its Tables workbench runs your own open, read, write, dup and fork calls, and its Disk workbench shows every block a command changes.' },
      { route: 'learn', target: '[data-chapter="fa-files"]', text: 'The lessons and exercises of this part start here, with two shell challenges about redirection at the end.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'fa-course', title: 'The file-system interface', blurb: 'All twelve topics of part 14, from a file\'s inode to permission bits, with lessons and exercises on the way.',
    steps: [
      { lesson: 'fa-file', note: 'Name, inode and blocks.' },
      { topic: 'fs-file-ops', note: 'Each operation and what it touches.' },
      { exercise: 'fa-x-touch-inode', note: 'Which calls change the inode.' },
      { topic: 'fs-access-methods', note: 'In order, or by lseek.' },
      { exercise: 'fa-x-linked-reads', note: 'Direct access on a chain.' },
      { lesson: 'fa-tables', note: 'Three tables.' },
      { topic: 'fs-open-tables', note: 'Descriptors, entries, inodes.' },
      { exercise: 'fa-x-offsets-table', note: 'Follow the offsets.' },
      { topic: 'fs-fork-offset', note: 'fork shares the entry.' },
      { topic: 'fs-fork-c', note: 'The same in C.' },
      { exercise: 'fa-x-fork-outputs', note: 'Every output.' },
      { lesson: 'fa-dirs', note: 'Directory structures.' },
      { topic: 'fs-dir-structures', note: 'Flat, two-level, tree, graph.' },
      { topic: 'fs-path-lookup', note: 'A name at a time.' },
      { exercise: 'fa-x-path-reads', note: 'Count the reads.' },
      { topic: 'fs-hard-links', note: 'The link count.' },
      { exercise: 'fa-x-nlink-table', note: 'Count the names.' },
      { topic: 'fs-symlinks', note: 'Links that hold a path.' },
      { exercise: 'fa-x-sym-which', note: 'Which names still reach it.' },
      { topic: 'fs-unlink-open', note: 'A file with no name.' },
      { exercise: 'fa-x-unlink-outputs', note: 'Read after unlink.' },
      { lesson: 'fa-mount', note: 'Mounting.' },
      { topic: 'fs-mount', note: 'A second file system.' },
      { exercise: 'fa-x-exdev', note: 'What cannot cross.' },
      { topic: 'fs-permissions', note: 'Who may do what.' },
      { exercise: 'fa-x-perm-table', note: 'Work it out for four users.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p14 lesson fa-file')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'fsapi').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p14 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['fa-x-size-table', 'fa-x-offsets-table', 'fa-x-fork-outputs', 'fa-x-code-append', 'fa-x-nlink-table', 'fa-x-sym-which', 'fa-x-perm-table', 'fa-x-access-which'])
      S.Checks.push({ group: 'learn', name: 'p14 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p14 course fa-course', hash: 'course=fa-course', ready: "document.querySelector('#courseView')", sel: '#main' });
    for (const id of ['fa-ch-redirect', 'fa-ch-stderr']) S.Checks.push({ group: 'learn', name: 'p14 challenge ' + id, hash: 'challenge/' + id, ready: "document.querySelector('#challengeView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
