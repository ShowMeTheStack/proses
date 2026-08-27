// Part 3, building a shell, continued: redirection of a command's input and output (open, dup2 onto 0 and 1, then
// exec), background jobs reaped by a SIGCHLD handler so that none is left a zombie, and job control: a job in its
// own process group that owns the terminal, so ^C reaches the job and not the shell.
(function (S) {
  'use strict';
  const H = S.PX, X = S.P03;
  const argv = (cmd) => '{' + cmd.trim().split(/\s+/).map((w) => '"' + w + '"').concat(['NULL']).join(', ') + '}';

  const redirSrc = (cmd, inF, outF) => `#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    char *a[] = ${argv(cmd)};
    pid_t k = fork();
    if (k == 0) {
${inF ? `        int in = open("${inF}", O_RDONLY);
        dup2(in, 0);
        close(in);
` : ''}${outF ? `        int out = open("${outF}",
            O_WRONLY | O_CREAT, 0644);
        dup2(out, 1);
        close(out);
` : ''}        execvp(a[0], a);
        _exit(127);
    }
    waitpid(k, NULL, 0);
    printf("[done]\\n");
    return 0;
}`;
  X.redirSrc = redirSrc;
  const REDIR = {
    both: { label: 'sort < notes > sorted', cmd: 'sort', inF: 'notes', outF: 'sorted' },
    input: { label: 'wc < todo', cmd: 'wc', inF: 'todo', outF: null },
    output: { label: 'echo ok > memo', cmd: 'echo ok', inF: null, outF: 'memo' },
  };
  X.REDIR = REDIR;
  S.topic({
    id: 'p03-shell-redir', family: 'p03-shell', order: 30, title: 'A shell redirects input and output',
    blurb: 'For cmd < in > out the shell forks, and the child, before exec, opens the input file and moves it onto descriptor 0 with dup2, opens (or creates) the output file and moves it onto 1, and closes the originals. The command then reads 0 and writes 1 as always; the shell\'s own descriptors are untouched, so its next prompt still goes to the terminal.',
    inputs: [{ id: 'cmd', kind: 'choice', label: 'Command line', def: 'both', options: Object.keys(REDIR).map((k) => ({ value: k, label: REDIR[k].label })) }],
    presets: Object.keys(REDIR).map((k) => ({ label: REDIR[k].label, values: { cmd: k } })),
    counters: [{ id: 'opens', label: 'files opened' }],
    run(inp) {
      const R = REDIR[inp.cmd], src = redirSrc(R.cmd, R.inF, R.outF);
      const sys = X.drive(src, { files: X.SHELL_FILES }, []);
      let opens = 0;
      const files = [R.inF, R.outF].filter(Boolean);
      const { F } = X.cframes({ sys, src, file: 'redirect.c', panel: 'fd', files, counters: ['opens'], count: (F, b) => { opens += b.evs.filter((e) => e.kind === 'open').length; F.set('opens', opens); }, extra: (b) => ({ sizes: files.map((n) => { const ino = b.ks.files.dir[n]; return ino !== undefined ? b.ks.files.inodes[ino].data.length : 0; }) }) });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'cmd < in > out', text: ['fork; in the child:', '  i = open(in, O_RDONLY)', '  dup2(i, 0); close(i)', '  o = open(out, O_WRONLY|O_CREAT)', '  dup2(o, 1); close(o)', '  exec(cmd)', 'the shell: wait'].join('\n') }] };
      const ino = R.outF ? sys.fs.dir[R.outF] : undefined;
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), out: ino !== undefined ? sys.fs.inodes[ino].data : null, src } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'exec', once: true, pick: 'option', ask: 'The command is about to run. Where will its output go?', options: ['into the file', 'to the terminal'], answer: (fr, i) => (fr[i].meta.fds.some((p) => p.pid === fr[i].meta.evs[0].pid && fr[i].meta.ofiles.some((o) => o.id === p.fds[1] && o.offset !== undefined && p.fds[1] !== 1)) ? 'into the file' : 'to the terminal'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Why does the shell open the files in the child, not before fork?', options: ['so the shell\'s own descriptors 0 and 1 stay on the terminal', 'exec cannot open files', 'files must be opened after fork', 'for speed'], answer: 0, why: 'Only the child, about to become the command, should be redirected.' },
      { q: 'After dup2(in, 0), why close(in)?', options: ['descriptor 0 already names the file; the extra one would only leak', 'dup2 needs it', 'to rewind the file', 'to flush it'], answer: 0, why: 'The command would otherwise inherit a descriptor it never uses.' },
      { q: 'What does the command see of the redirection?', options: ['nothing: it reads 0 and writes 1 as usual', 'the file names in argv', 'a flag', 'an environment variable'], answer: 0, why: 'The < and > never reach the program.' },
      { q: 'With O_CREAT and no O_TRUNC, the output file already holds a longer text. What is left after a short write?', options: ['the new bytes, then the rest of the old text', 'only the new bytes', 'the old text', 'an error'], answer: 0, why: 'Without O_TRUNC the file is not emptied first; shells pass O_TRUNC for >.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Background jobs
  // ---------------------------------------------------------------------------------------------------------------
  const bgSrc = (handler) => `#include <stdio.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>
void reap(int s) {
    for (;;) {
        int k = waitpid(-1, 0, WNOHANG);
        if (k <= 0) break;
        printf("[%d] done\\n", k);
    }
}
int main(void) {
    char *a[] = {"sleep", "1", NULL};
    char *b[] = {"sleep", "2", NULL};
${handler ? '    signal(SIGCHLD, reap);' : '    /* no SIGCHLD handler */'}
    if (fork() == 0) {
        execvp(a[0], a);
        _exit(127);
    }
    if (fork() == 0) {
        execvp(b[0], b);
        _exit(127);
    }
    for (int i = 0; i < 3; i++) {
        sleep(1);
        printf("$ still here\\n");
    }
}`;
  X.bgSrc = bgSrc;
  S.topic({
    id: 'p03-shell-bg', family: 'p03-shell', order: 40, title: 'Background jobs, reaped by SIGCHLD',
    blurb: 'For cmd & the shell forks and execs as usual but does not wait: it prompts again at once. Its job is not over, though: when a background child exits, it stays a zombie until the shell collects its status. A SIGCHLD handler that loops over waitpid with WNOHANG reaps each finished job as soon as it ends, and the shell can announce it. Without one, the zombies pile up for as long as the shell runs.',
    inputs: [{ id: 'handler', kind: 'choice', label: 'SIGCHLD handler', def: 'yes', options: [{ value: 'yes', label: 'installed: jobs are reaped as they end' }, { value: 'no', label: 'none: finished jobs stay zombies' }] }],
    presets: [{ label: 'sleep 1 & sleep 2 &, reaped', values: { handler: 'yes' } }, { label: 'No handler: zombies', values: { handler: 'no' } }],
    counters: [{ id: 'zombies', label: 'zombies now' }, { id: 'reaped', label: 'jobs reaped' }],
    run(inp) {
      const src = bgSrc(inp.handler === 'yes');
      const sys = X.drive(src, {}, []);
      let reaped = 0;
      const { F } = X.cframes({ sys, src, file: 'jobs.c', panel: 'sig', counters: ['zombies', 'reaped'], count: (F, b) => { reaped += b.evs.filter((e) => e.kind === 'reap' && e.by === 100).length; F.set('zombies', b.snap.filter((p) => p.role === 'prog' && p.state === 'zombie' && p.pid !== 100).length).set('reaped', reaped); }, extra: (b) => ({ zombies: b.snap.filter((p) => p.role === 'prog' && p.state === 'zombie').map((p) => p.pid) }) });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'cmd &', text: ['fork, exec, do not wait', 'the job ends: a zombie,', '  and SIGCHLD to the shell', 'handler: while waitpid(-1,', '  &st, WNOHANG) > 0: report', 'no handler: zombies stay', '  until the shell exits,', '  then init reaps them'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), src } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'exit' && fr[i + 1].meta.evs[0].pid > 100, pick: 'option', ask: 'A background job is about to exit. How long will it stay a zombie?', options: ['only until the SIGCHLD handler runs', 'until the shell itself exits'], answer: (fr) => (fr.some((g) => g.meta.phase === 'handler') ? 'only until the SIGCHLD handler runs' : 'until the shell itself exits'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'What does a shell do differently for cmd & ?', options: ['it does not wait for the child', 'it does not fork', 'it uses a thread', 'it closes the terminal'], answer: 0, why: 'Everything else, fork and exec, is the same.' },
      { q: 'A background job ends while the shell waits for input. Who collects its status?', options: ['the shell, in its SIGCHLD handler (or at its next prompt)', 'init, at once', 'nobody: it is freed', 'the terminal'], answer: 0, why: 'The parent is still alive, so it must reap; init only adopts orphans.' },
      { q: 'Why WNOHANG in the handler?', options: ['so it returns 0 instead of waiting for a job that is still running', 'to reap faster', 'to ignore errors', 'to stop the job'], answer: 0, why: 'Other jobs may still be running; the handler must not block.' },
      { q: 'The shell has no handler and exits. What becomes of its zombie children?', options: ['they are re-parented to init, which reaps them', 'they stay for ever', 'they run again', 'the terminal reaps them'], answer: 0, why: 'init waits for every orphan.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Job control
  // ---------------------------------------------------------------------------------------------------------------
  const jobSrc = (groups) => `#include <stdio.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    char *a[] = {"sleep", "5", NULL};
${groups ? '    signal(SIGINT, SIG_IGN);' : '    /* the shell keeps SIGINT */'}
    pid_t k = fork();
    if (k == 0) {
${groups ? '        setpgid(0, 0);\n        signal(SIGINT, SIG_DFL);' : '        /* same group as the shell */'}
        execvp(a[0], a);
        _exit(127);
    }
${groups ? '    setpgid(k, k);\n    tcsetpgrp(0, k);' : '    /* no new group */'}
    int st;
    waitpid(k, &st, 0);
${groups ? '    tcsetpgrp(0, getpgrp());' : ''}
    int sig = WTERMSIG(st);
    if (WIFSIGNALED(st))
        printf("job: signal %d\\n", sig);
    printf("$ the shell lives on\\n");
    return 0;
}`;
  X.jobSrc = jobSrc;
  const intWord = (p) => { const h = (p.handlers || {})[2]; return h === 'ign' ? 'SIGINT: ignored' : h ? 'SIGINT: handler' : 'SIGINT: default, ends'; };
  /**
   * the job-control picture: the listing; every process of the program as a box inside a box for its process
   * group; the terminal below with an arrow to the group it gives ^C to; and, at a ^C, SIGINT to each member
   */
  function jobScene(b, sys, src, progs, key) {
    const snap = b.snap, ks = b.ks, items = [];
    const actP = snap.find((p) => p.pid === b.pid);
    const line = actP && actP.role === 'prog' && actP.state !== 'reaped' && actP.image === 'c' ? (b.evs[0].line || actP.line) : 0;
    items.push(...X.code({ x: 0, y: 0, w: 384, src, file: 'fg.c', snap: snap.filter((p) => p.image === 'c'), act: b.pid, line, lineH: 19 }).items);
    const rx = 410, rw = 410;
    items.push(...H.legend('lg', rx, 10, rw));
    const procs = snap.filter((p) => p.role === 'prog').sort((a, c) => a.pid - c.pid);
    const groups = [...new Set(procs.map((p) => p.pgid))].sort((a, c) => a - c);
    const nodeW = 150, nodeH = 58, pad = 12, gy = 52;
    let gx = rx;
    const pos = {};
    items.push(H.title('gt', rx, 40, 'process groups'));
    groups.forEach((g) => {
      const mem = procs.filter((p) => p.pgid === g), gw = mem.length * (nodeW + pad) + pad;
      const fg = ks.tty.fg === g;
      items.push({ key: 'grp' + g, kind: 'region', x: gx, y: gy, w: gw, h: nodeH + 40, rx: 10, cls: fg ? 'act' : '', layer: 'back', audit: 'group' });
      items.push(H.text('grt' + g, gx + 12, gy + 19, 'pg ' + g + (fg ? ' · foreground' : ''), fg ? 'act' : 'strong', 13));
      mem.forEach((p, k) => {
        const x = gx + pad + k * (nodeW + pad), y = gy + 28;
        pos[p.pid] = { x: x + nodeW / 2, y: y + nodeH };
        const gone = p.state === 'reaped' || p.state === 'zombie';
        items.push(H.cell('nd' + p.pid, x, y, nodeW, nodeH, '', 'fdproc s-' + H.STATE[p.state] + (p.pid === b.pid ? ' act' : '') + (p.state === 'reaped' ? ' dim' : ''), { lines: [p.pid + (progs[p.pid] ? ' · ' + progs[p.pid] : p.pid === 100 ? ' · shell' : ''), H.doing(p, true), gone ? (p.state === 'zombie' ? 'ended' : 'reaped') : intWord(p)], rx: 8 }));
      });
      gx += gw + 16;
    });
    // the terminal, and the group it sends ^C to
    const ty = gy + nodeH + 40 + 70, tw = 200, tx = rx + (rw - tw) / 2;
    items.push(H.cell('tty', tx, ty, tw, 46, '', 'kern' + (b.kind === 'foreground' || key ? ' act' : ''), { lines: ['terminal', 'foreground: pg ' + ks.tty.fg], rx: 8 }));
    const fgMembers = procs.filter((p) => p.pgid === ks.tty.fg && p.state !== 'reaped' && p.state !== 'zombie');
    const sigTargets = key ? fgMembers.map((p) => p.pid) : b.kind === 'signal' && b.evs[0].sig === 2 ? [b.pid] : [];
    if (sigTargets.length) sigTargets.forEach((pid, k) => { if (pos[pid]) items.push({ key: 'sig' + pid, kind: 'edge', from: { x: tx + tw / 2 + (k - (sigTargets.length - 1) / 2) * 40, y: ty }, to: { x: pos[pid].x, y: pos[pid].y + 2 }, label: k === 0 ? 'SIGINT' : '', lx: tx + tw / 2 + 70, ly: ty - 22, size: 13, cls: 'hot' }); });
    else if (groups.includes(ks.tty.fg)) items.push({ key: 'fgarrow', kind: 'edge', from: { x: tx + tw / 2, y: ty }, to: { x: tx + tw / 2, y: gy + nodeH + 42 }, cls: b.kind === 'foreground' ? 'act' : '' });
    const tm = S.Kit.proc.term({ prefix: 'tm', x: rx, y: ty + 64, w: rw, rows: X.termRows(sys, b.evs[b.evs.length - 1]._i), rowsShown: 3, tagSize: 13, title: 'output' });
    items.push(...tm.items);
    return items;
  }
  S.topic({
    id: 'p03-shell-jobs', family: 'p03-shell', order: 50, title: 'Job control: process groups and ^C',
    blurb: '^C sends SIGINT to the terminal\'s foreground process group, not to one process. So a shell puts each job in a group of its own with setpgid and hands the terminal to that group with tcsetpgrp while the job runs; the shell itself ignores SIGINT. Then ^C ends the job and the shell lives on, takes the terminal back and prompts again. Without the groups, ^C reaches the shell too.',
    inputs: [{ id: 'groups', kind: 'choice', label: 'The job runs', def: 'yes', options: [{ value: 'yes', label: 'in its own group, owning the terminal' }, { value: 'no', label: 'in the shell\'s group' }] }],
    presets: [{ label: 'Its own group: ^C ends only the job', values: { groups: 'yes' } }, { label: 'The shell\'s group: ^C ends both', values: { groups: 'no' } }],
    counters: [{ id: 'sent', label: 'SIGINT sent' }],
    run(inp) {
      const src = jobSrc(inp.groups === 'yes').replace(/\n\n/g, '\n');
      const sys = X.drive(src, {}, [{ key: 'C' }]);
      const F = new S.Frames(['sent']);
      const bs = X.beats(sys), progs = {};
      let sent = 0, sigTo = [];
      bs.forEach((b) => {
        for (const e of b.evs) { if (e.kind === 'exec') progs[e.pid] = e.path; if (e.kind === 'signal' && e.sig === 2) sent++; }
        F.set('sent', sent);
        const sc = jobScene(b, sys, src, progs, b.kind === 'key' ? b.evs[0] : null);
        F.add({ items: sc, say: b.say, meta: X.meta(b, { pgids: b.snap.map((p) => p.pgid), fg: b.ks.tty.fg }), title: b.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'A job in the foreground', text: ['child: setpgid(0, 0)', 'shell: setpgid(k, k)', '  (both, so neither races)', 'tcsetpgrp(0, k): the job', '  gets ^C and ^Z', 'waitpid(k), then', '  tcsetpgrp(0, own group)'].join('\n') }] };
      return { frames: F.list, def, result: { term: sys.term.map((w) => w.text).join(''), src } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'key', once: true, pick: 'option', ask: 'The user typed ^C. Which processes get SIGINT?', options: ['only the job', 'the job and the shell'], answer: (fr, i) => (fr.slice(i + 1).filter((g) => g.meta.phase === 'signal').length > 1 ? 'the job and the shell' : 'only the job'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Who receives SIGINT when the user types ^C?', options: ['every process in the terminal\'s foreground process group', 'only the shell', 'the newest process', 'init'], answer: 0, why: 'The terminal knows a group, not a process.' },
      { q: 'Why does both the shell and the child call setpgid?', options: ['whichever runs first sets it, so exec never runs in the wrong group', 'one call is not allowed', 'for the parent\'s pid', 'to ignore ^C'], answer: 0, why: 'After fork either may run first.' },
      { q: 'What does tcsetpgrp(0, k) do?', options: ['makes group k the terminal\'s foreground group', 'kills group k', 'reads from the terminal', 'creates a group'], answer: 0, why: '^C and ^Z then go to group k.' },
      { q: 'A job in the background group reads the terminal. What stops it from stealing the shell\'s input?', options: ['the terminal sends it SIGTTIN, which stops it', 'nothing', 'the shell closes stdin', 'read returns 0'], answer: 0, why: 'Only the foreground group may read the terminal.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
