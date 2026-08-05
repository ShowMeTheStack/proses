// Challenge kind 'shell': a small shell in the C subset, run on the simulated kernel against hidden job-control
// tests. The shell reads command lines from stdin with fgets until end of file and prints nothing of its own; each
// test types some lines and checks, over several seeded random schedules:
//   expect: the exact output, or expectEnd: how the output ends (an error message may come first);
//   foreground: the shell waits for every process of a foreground line before it reads the next line;
//   reaped: every child the shell forks is reaped by the shell itself, none is left to init (no zombie behind);
//   noZombies: no child of the shell is still a zombie when the shell exits, nor at a prompt (when the shell reads
//     a line, no child that had already exited before it read the line before may still be unreaped: a & job
//     must be waited for, with WNOHANG, before the next line at the latest).
// Always: a signal handler (SIGCHLD) must never block in wait or waitpid without WNOHANG while another child is
// still running, since the shell would then stop reading lines until that child ends.
// The kernel runs fork, execvp of the built-in programs (echo, cat, wc, sort, head, ls, sleep, true, false, yes),
// pipe, dup2, open, close, wait, waitpid with WNOHANG and fgets, so pipelines, < and > redirection and & jobs work.
//   x: {kind: 'shell', starter: 'C source', tests: [{name, input, files: {name: text}, expect | expectEnd,
//       foreground, reaped, seeds: [..] (1..3), maxSteps (60000), visible}], limits: {forbid, maxLines}}
//   answer: {src}            score: the number of tests passed (target: all of them)
(function (S) {
  'use strict';
  const C = S.Challenges, KIT = () => S.ChallengeKit, SH = 100;
  const show = (s) => JSON.stringify(String(s)).slice(1, -1);

  /** what went wrong in one run: a sentence, or null */
  function judge(t, sys) {
    const st = sys.status();
    if (st !== 'done') return st === 'deadlock' ? 'every process left is blocked: something waits for good (a pipe end left open?)' : 'it did not finish (is it waiting for a process that never ends?)';
    if (t.expect !== undefined && sys.out !== t.expect) return 'the output is "' + show(sys.out) + '", not "' + show(t.expect) + '"';
    if (t.expectEnd !== undefined && !sys.out.endsWith(t.expectEnd)) return 'the output "' + show(sys.out) + '" does not end with "' + show(t.expectEnd) + '"';
    const lines = String(t.input || '').split('\n');
    const kids = [], line = {}, exitAt = {}, reapBy = {}, inputs = [];
    sys.trace.forEach((e, i) => {
      if (e.kind === 'input' && e.pid === SH) inputs.push(i);
      if (e.kind === 'fork' && e.pid === SH) { kids.push(e.child); line[e.child] = inputs.length - 1; }
      if (e.kind === 'exit' && exitAt[e.pid] === undefined) exitAt[e.pid] = i;
      if (e.kind === 'reap') reapBy[e.pid] = e.by;
    });
    if (t.foreground) for (const k of kids) {
      const l = line[k];
      if (/&\s*$/.test(lines[l] || '') || l + 1 >= inputs.length) continue;
      if (!(exitAt[k] < inputs[l + 1])) return 'the shell read "' + show(lines[l + 1]) + '" before the process for "' + show(lines[l]) + '" had finished: a foreground line must be waited for';
    }
    // a handler that blocks in wait while another child still runs
    let depth = 0;
    const alive = new Set();
    for (const e of sys.trace) {
      if (e.kind === 'fork' && e.pid === SH) alive.add(e.child);
      if (e.kind === 'exit' || e.kind === 'error') alive.delete(e.pid);
      if (e.pid !== SH) continue;
      if (e.kind === 'handler') depth++;
      if (e.kind === 'sigreturn') depth = Math.max(0, depth - 1);
      if (e.kind === 'block' && depth > 0 && /wait/.test(String(e.why || e.say)) && alive.size) return 'the shell\'s signal handler blocks in waitpid while process ' + [...alive][0] + ' is still running: in a handler, reap with WNOHANG so it never waits';
    }
    if (t.noZombies) {
      const reapAt = {};
      sys.trace.forEach((e, i) => { if (e.kind === 'reap' && reapAt[e.pid] === undefined) reapAt[e.pid] = i; });
      for (let n = 1; n < inputs.length; n++) for (const k of kids) {
        if (exitAt[k] !== undefined && exitAt[k] < inputs[n - 1] && !(reapAt[k] < inputs[n])) return 'process ' + k + ' (for "' + show(lines[line[k]] || '') + '") had exited before the shell read "' + show(lines[n - 1]) + '", and was still a zombie when it read "' + show(lines[n] || '') + '": reap finished jobs before each new line';
      }
      const shExit = sys.trace.findIndex((e) => e.kind === 'exit' && e.pid === SH);
      for (const k of kids) if (exitAt[k] !== undefined && shExit >= 0 && exitAt[k] < shExit && !(reapAt[k] < shExit) && reapBy[k] !== SH) return 'process ' + k + ' (for "' + show(lines[line[k]] || '') + '") is still a zombie when the shell exits: wait for every job before leaving';
    }
    if (t.reaped) for (const k of kids) {
      if (reapBy[k] !== SH) return 'process ' + k + ' (for "' + show(lines[line[k]] || '') + '") was ' + (reapBy[k] ? 'left to init to reap' : 'never reaped') + ': the shell must reap every child itself';
    }
    return null;
  }
  function runOnce(src, t, seed) {
    return S.Kern.run(src, { input: t.input || '', files: Object.assign({}, t.files || {}), policy: 'random', seed, cow: false, maxSteps: t.maxSteps || 60000 });
  }
  function runTest(src, t) {
    for (const seed of t.seeds || [1, 2, 3]) {
      let sys;
      try { sys = runOnce(src, t, seed); } catch (e) { return { pass: false, why: 'it stopped with an error: ' + (e.msg || e.message) }; }
      const why = judge(t, sys);
      if (why) return { pass: false, why: why + ' (schedule seed ' + seed + ')' };
    }
    return { pass: true };
  }

  const kind = (C.kinds.shell = {
    runTest, judge, remote: true,
    start: (x) => ({ src: x.starter || '' }),
    evaluate(x, a) {
      const src = a && typeof a === 'object' ? a.src : String(a || '');
      const c = KIT().compiles(src);
      if (c.err) return { score: 0, n: x.tests.length, problems: ['your shell does not compile: ' + (c.err.msg || c.err.message)] };
      let pass = 0;
      const details = x.tests.map((t, i) => { const r = runTest(src, t); if (r.pass) pass++; return 'Test ' + (i + 1) + (t.name ? ' (' + t.name + ')' : '') + ': ' + (r.pass ? 'passed.' : 'failed: ' + r.why + '.'); });
      return { score: pass, n: x.tests.length, details };
    },
    async evaluateAsync(x, a) { await new Promise((r) => setTimeout(r, 30)); return kind.evaluate(x, a); },
    limitsProblems: (x, a) => KIT().cLimits(x, a && typeof a === 'object' ? a.src : String(a || '')),
    limitSentences: (x) => KIT().cLimitSentences(x).concat(['The shell prints no prompt. Each hidden test types a few lines and runs under several random schedules.']),
    lint(x) {
      const out = [];
      if (!(x.tests || []).length) out.push('no tests');
      (x.tests || []).forEach((t, i) => { if (!t.input) out.push('test ' + (i + 1) + ' types nothing'); if (t.expect === undefined && t.expectEnd === undefined && !t.foreground && !t.reaped && !t.noZombies) out.push('test ' + (i + 1) + ' checks nothing'); });
      if (x.target !== (x.tests || []).length) out.push('the target should be every test (' + (x.tests || []).length + ')');
      return out;
    },
    workspace(host, x, draft, onChange) {
      const { h } = S.UI;
      const vis = (x.tests || []).find((t) => t.visible) || { input: 'echo hello | wc\n', files: {} };
      const ta = h('textarea.mono.chk-lines', { id: 'chLines', rows: '3', spellcheck: 'false', 'aria-label': 'Lines to type' });
      ta.value = vis.input;
      const files = vis.files && Object.keys(vis.files).length ? 'Files: ' + Object.entries(vis.files).map(([n, v]) => n + ' (' + v.split('\n').filter(Boolean).length + ' lines)').join(', ') + '.' : '';
      return KIT().codeWorkspace(host, x, draft, onChange, {
        sideTitle: 'Type some lines', tryLabel: 'Run them',
        tryInput: { el: h('label.chk-field.wide', h('span.chk-lab', 'Input'), ta, files ? h('span.chk-hint', files) : null) },
        note: 'Programs: `echo`, `cat`, `wc`, `sort`, `head`, `ls`, `sleep`, `true`, `false`. One schedule (seed 1) runs here; the hidden tests run several.',
        tryIt(src) {
          const t = { input: ta.value.replace(/\n?$/, '\n'), files: vis.files, foreground: true, reaped: true };
          let sys;
          try { sys = runOnce(src, t, 1); } catch (e) { return { ok: false, say: 'It stopped with an error: ' + (e.msg || e.message), out: '' }; }
          const why = judge(t, sys);
          return { ok: !why, say: why ? why.replace(/^./, (c) => c.toUpperCase()) + '.' : 'It finished, waited for every foreground line, and reaped every child.', out: sys.out };
        },
      });
    },
    example: () => ({
      id: 'sample-shell-jobs', n: 905, title: 'A shell that cleans up after itself', level: 3, kind: 'shell', sample: true,
      story: 'The lab\'s kiosk runs a tiny shell for visitors. The first version runs one program at a time and nothing else. Visitors want pipelines and files, and to start a slow job in the background, but the kiosk has a small process table: a shell that leaves zombies behind soon cannot fork at all.\n\nGrow the starting shell until it passes every job-control test.',
      task: 'Add pipelines (`a | b | c`), redirection (`< file`, `> file`) and background jobs (`&`). Wait for every foreground process, and reap every background job yourself.',
      metricName: 'tests passed', target: 9, marks: { gold: 9 },
      limits: { forbid: ['system', 'popen'], maxLines: 90 },
      starter: '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n    char line[128];\n    while (fgets(line, sizeof line, stdin)) {\n        char *argv[16];\n        int argc = 0;\n        char *w = strtok(line, " \\t\\n");\n        while (w && argc < 15) {\n            argv[argc] = w;\n            argc++;\n            w = strtok(NULL, " \\t\\n");\n        }\n        argv[argc] = NULL;\n        if (argc == 0)\n            continue;\n        pid_t k = fork();\n        if (k == 0) {\n            execvp(argv[0], argv);\n            perror(argv[0]);\n            exit(127);\n        }\n        waitpid(k, NULL, 0);\n    }\n    return 0;\n}\n',
      tests: [
        { name: 'one command', input: 'echo hello there\n', expect: 'hello there\n', foreground: true, reaped: true },
        { name: 'commands in order', input: 'cat notes.txt\necho end\n', files: { 'notes.txt': 'pear\napple\n' }, expect: 'pear\napple\nend\n', foreground: true, reaped: true },
        { name: 'a pipe', input: 'echo a b c | wc\n', expect: '       1       3       6\n', foreground: true, reaped: true, visible: true },
        { name: 'three in a pipeline', input: 'cat notes.txt | sort | head -n 2\n', files: { 'notes.txt': 'pear\napple\nfig\nbanana\n' }, expect: 'apple\nbanana\n', foreground: true, reaped: true },
        { name: 'input from a file', input: 'wc < notes.txt\n', files: { 'notes.txt': 'pear\napple\nfig\n' }, expect: '       3       3      15\n', foreground: true, reaped: true },
        { name: 'output to a file', input: 'echo saved > out.txt\ncat out.txt\n', expect: 'saved\n', foreground: true, reaped: true },
        { name: 'a background job', input: 'sleep 2 &\necho now\necho later\n', expect: 'now\nlater\n', reaped: true, noZombies: true },
        { name: 'a quick background job', input: 'true &\n\n\necho a\n', expect: 'a\n', reaped: true, noZombies: true },
        { name: 'a missing program', input: 'nosuchprog\necho still here\n', expectEnd: 'still here\n', foreground: true, reaped: true },
      ],
      hints: ['Split the line at | first; each piece is one command. For n commands make n − 1 pipes; child i reads from pipe i − 1 and writes to pipe i, using dup2, and every process closes the pipe ends it does not use, or a reader never sees end of file.', 'Inside each child, before execvp, look for < and > among the words: open the file and dup2 it onto 0 or 1. A line ending in & is not waited for; before reading each new line, reap finished jobs with waitpid(-1, NULL, WNOHANG) in a loop.', 'Wait for every process of a foreground line (one wait per fork), and at end of file wait until wait returns -1, so no background job is left to init.'],
      solution: { src: SOLUTION },
      wrong: [{ src: '' }, { src: SOLUTION.replace('    while (wait(NULL) > 0)\n        ;\n    return 0;', '    return 0;').replace('        while (waitpid(-1, NULL, WNOHANG) > 0)\n            ;\n', '') }, { src: SOLUTION.replace('    if (!bg) {\n        for (int i = 0; i < n; i++) wait(NULL);\n    }\n', '') }],
    }),
  });
  // the reference shell of the example challenge
  const SOLUTION = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <sys/wait.h>\n\n#define MAXARGS 16\n#define MAXCMDS 4\n\nvoid run_line(char *line) {\n    char *cmds[MAXCMDS];\n    int n = 0;\n    int bg = 0;\n    char *amp = strchr(line, \'&\');\n    if (amp) { *amp = 0; bg = 1; }\n    char *part = strtok(line, "|");\n    while (part && n < MAXCMDS) { cmds[n] = part; n++; part = strtok(NULL, "|"); }\n    int prev = -1;\n    for (int i = 0; i < n; i++) {\n        char *argv[MAXARGS];\n        int argc = 0;\n        char *in = NULL;\n        char *out = NULL;\n        char *w = strtok(cmds[i], " \\t\\n");\n        while (w && argc < MAXARGS - 1) {\n            if (strcmp(w, "<") == 0) in = strtok(NULL, " \\t\\n");\n            else if (strcmp(w, ">") == 0) out = strtok(NULL, " \\t\\n");\n            else { argv[argc] = w; argc++; }\n            w = strtok(NULL, " \\t\\n");\n        }\n        argv[argc] = NULL;\n        if (argc == 0) { n = i; break; }\n        int fd[2];\n        if (i < n - 1) pipe(fd);\n        pid_t k = fork();\n        if (k == 0) {\n            if (prev >= 0) { dup2(prev, 0); close(prev); }\n            if (i < n - 1) { dup2(fd[1], 1); close(fd[0]); close(fd[1]); }\n            if (in) { int f = open(in, O_RDONLY); dup2(f, 0); close(f); }\n            if (out) { int f = open(out, O_WRONLY | O_CREAT | O_TRUNC, 0644); dup2(f, 1); close(f); }\n            execvp(argv[0], argv);\n            perror(argv[0]);\n            exit(127);\n        }\n        if (prev >= 0) close(prev);\n        if (i < n - 1) { close(fd[1]); prev = fd[0]; }\n    }\n    if (!bg) {\n        for (int i = 0; i < n; i++) wait(NULL);\n    }\n}\n\nint main(void) {\n    char line[128];\n    while (fgets(line, sizeof line, stdin)) {\n        while (waitpid(-1, NULL, WNOHANG) > 0)\n            ;\n        run_line(line);\n    }\n    while (wait(NULL) > 0)\n        ;\n    return 0;\n}\n';
})(globalThis.Proses = globalThis.Proses || {});
