// Part 2, exec: the process stays, the program changes. The listing switches to the new program when exec
// succeeds, and a table compares the process before exec with now: the pid, the parent and the open descriptors
// stay; the memory, the stdout buffer and the caught signals' handlers are replaced (ignored signals stay ignored).
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const SHOW = `#include <stdio.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    printf("%d %s\\n", getpid(), argv[1]);
    write(3, "fd 3 still open\\n", 16);
    return 0;
}`;
  const PROGS = {
    keeps: {
      label: 'what exec keeps and what it replaces', file: 'keep.c', focus: 100,
      src: `#include <stdio.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>

void on_int(int s) { }

int main(void) {
    int fd = open("log.txt",
                  O_WRONLY | O_CREAT, 0644);
    signal(SIGINT, on_int);
    signal(SIGQUIT, SIG_IGN);
    printf("%d %d\\n", getpid(), fd);
    printf("never shown");
    execl("./show", "show", "hi", NULL);
    printf("exec failed\\n");
    return 1;
}`,
    },
    forkexec: {
      label: 'fork, then execvp in the child', file: 'run.c', focus: 101,
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t k = fork();
    if (k == 0) {
        char *av[] = {"echo", "ok", NULL};
        execvp("echo", av);
        return 127;
    }
    int st;
    waitpid(k, &st, 0);
    printf("%d is done\\n", k);
    return 0;
}`,
    },
    fails: {
      label: 'exec fails and returns', file: 'typo.c', focus: 101,
      src: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t k = fork();
    if (k == 0) {
        execl("./shwo", "shwo", NULL);
        perror("execl");
        exit(127);
    }
    int st;
    waitpid(k, &st, 0);
    printf("gave %d\\n", WEXITSTATUS(st));
    return 0;
}`,
    },
  };
  P.PROGS_EXEC = PROGS;
  P.SHOW = SHOW;
  const OPTS = { cow: true, programs: { show: SHOW } };

  /** the facts that compare a process at two moments: [[label, value]] */
  function facts(p, ks, image) {
    if (!p) return null;
    const files = ks.files || { dir: {} };
    const nameOf = (o) => (!o ? '?' : o.kind === 'tty' ? 'terminal' : o.kind === 'file' ? Object.keys(files.dir).find((n) => files.dir[n] === o.ino) || 'a file' : o.kind);
    const out = [['pid', String(p.pid)], ['parent', String(p.ppid)], ['program', image]];
    const fds = p.fds.map((id, i) => (id === null || id === undefined ? null : [i, nameOf(ks.ofiles[id])])).filter(Boolean);
    for (let i = 0; i < fds.length;) {
      let j = i; while (j + 1 < fds.length && fds[j + 1][1] === fds[i][1] && fds[j + 1][0] === fds[j][0] + 1) j++;
      out.push([i === j ? 'fd ' + fds[i][0] : 'fd ' + fds[i][0] + '–' + fds[j][0], fds[i][1]]);
      i = j + 1;
    }
    out.push(['stdout buffer', p.buf ? '"' + p.buf + '"' : 'empty']);
    out.push(['memory', p.pages.length ? 'frames ' + Math.min(...p.pages) + '–' + Math.max(...p.pages) : p.image === 'builtin' ? 'the built-in\'s' : 'none']);
    for (const k of Object.keys(p.handlers)) out.push([P.SIGNAME[k] || 'signal ' + k, p.handlers[k] === 'ign' ? 'ignored' : 'caught']);
    return out;
  }

  S.topic({
    id: 'p02-exec', family: 'p02-api', order: 30, title: 'exec: a new program in the same process',
    blurb: 'exec loads a new program into the calling process and starts it at its main. Nothing new is created: the pid, the parent and the open descriptors stay, which is how a shell hands a program its redirected files. Everything that belonged to the old program goes: its memory and variables, its unflushed stdout buffer, and its signal handlers (their code is gone), though ignored signals stay ignored. exec returns only if it fails.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'keeps', options: P.options(PROGS) },
    ],
    presets: [
      { label: 'What exec keeps and replaces', values: { prog: 'keeps' } },
      { label: 'fork, then execvp echo', values: { prog: 'forkexec' } },
      { label: 'A typo: exec fails', values: { prog: 'fails' } },
    ],
    counters: [{ id: 'execs', label: 'successful execs' }],
    run(inp) {
      const pr = PROGS[inp.prog], sys = P.run(pr.src, OPTS);
      const bs = P.beats(sys, { skip: ['cow', 'wake'] }), F = new S.Frames(['execs']);
      const focus = pr.focus;
      let image = pr.file, before = null, prevSnap = null, prevKs = null, execs = 0, srcNow = pr.src, fileNow = pr.file;
      bs.forEach((b) => {
        const fp = b.snap.find((p) => p.pid === focus);
        if (b.kind === 'exec' && b.pid === focus) {
          const old = prevSnap && prevSnap.find((p) => p.pid === focus);
          before = facts(old, prevKs, image);
          const e = b.evs[0];
          image = e.image === 'builtin' ? e.argv[0] + ' (built in)' : e.path.replace(/^\.\//, '') + '.c';
          if (e.image !== 'builtin') { srcNow = SHOW; fileNow = 'show.c'; }
          execs++;
        }
        F.set('execs', execs);
        const now = fp && fp.state !== 'reaped' ? facts(fp, b.ks, image) : null;
        const sc = P.scene({ sys, beat: b, src: srcNow, file: fileNow, rowsShown: 2,
          extra: (y, rx, rw) => {
            const kw = 116, cw = Math.floor((rw - kw) / 2);
            const labels = [];
            for (const f of (before || []).concat(now || [])) if (!labels.includes(f[0])) labels.push(f[0]);
            // signals the program set before exec stay listed after it, at their default
            const get = (fs, l) => { if (!fs) return ''; const f = fs.find((x) => x[0] === l); return f ? f[1] : /^SIG/.test(l) ? 'default' : '—'; };
            const rows = labels.map((l) => [{ text: l, cls: 'pcbk' }, { text: before ? get(before, l) : '', cls: 'pcbv' }, now ? { text: get(now, l), cls: 'pcbv' + (before && get(before, l) !== get(now, l) ? ' changed' : '') } : { text: fp && fp.state === 'zombie' ? 'exited' : '', cls: 'pcbv' }]);
            const t = H.table({ prefix: 'cmp', x: rx, y: y + 18, cols: [{ w: kw, label: '' }, { w: cw, label: 'before exec' }, { w: cw, label: 'now' }], rows, rowH: 24, size: 13, title: '' });
            return { items: [H.text('cmpt', rx, y + 8, 'process ' + focus + ', before exec and now', 'title', 13)].concat(t.items), h: t.h + 18 };
          } });
        F.add({ items: sc.items, say: b.say, meta: H.metaOf(b, { focus, before, now, execs, fd: 3, n16: 16 }), title: b.kind });
        prevSnap = b.snap; prevKs = b.ks;
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'exec', text: ['execl(path, arg0, arg1, ..., NULL)', 'execlp: looks the name up in PATH', 'execv, execvp: the arguments', '  as an array', 'kept: pid, parent, descriptors,', '  ignored signals, the mask', 'replaced: memory, stdout buffer,', '  caught signals go to default', 'returns only on failure: −1'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'exec', once: true, pick: 'option', ask: 'The next step is the exec. What pid will the new program have?', options: (fr, i) => { const p = fr[i + 1].meta.evs[0].pid; return [String(p), String(p + 1), '1', 'a new pid from the kernel']; }, answer: (fr, i) => String(fr[i + 1].meta.evs[0].pid), explain: 'exec makes no new process: the same process runs a different program, so its pid stays.' },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'fail', once: true, pick: 'option', ask: 'exec is about to be called with a misspelt name. What happens next?', options: ['exec returns −1 and the next line runs', 'the process is killed', 'the old program restarts at main', 'nothing: it waits'], answer: 'exec returns −1 and the next line runs', explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'After a successful execl, what runs the line after the execl call?', options: ['nothing: that code is gone, replaced by the new program', 'the new program', 'the parent', 'the old program, after the new one ends'], answer: 0, why: 'exec returns only when it fails.' },
      { q: 'Which survives exec?', options: ['the open file descriptors', 'the heap', 'the stdout buffer', 'a caught signal\'s handler'], answer: 0, why: 'Descriptors belong to the process, not to the program; that is how redirection works.' },
      { q: 'printf("hi") without a newline, then exec. Is "hi" printed?', options: ['no: the buffer was in the old program\'s memory', 'yes, by the new program', 'yes, by the kernel', 'only on a pipe'], answer: 0, why: 'Call fflush(stdout) before exec to keep it.' },
      { q: 'A process ignores SIGINT and then execs. What does the new program do with SIGINT?', options: ['still ignores it', 'catches it', 'gets the default action', 'cannot receive it'], answer: 0, why: 'Ignoring needs no code, so it carries over; a handler\'s code does not.' },
      { q: 'Why do shells fork and then exec, instead of exec alone?', options: ['so the shell itself survives and can wait for the command', 'exec cannot run without fork', 'fork is faster than exec', 'to get a new pid for the shell'], answer: 0, why: 'exec alone would replace the shell with the command.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
