// Part 2, wait and waitpid: a parent collects its children's exit statuses. The status word wait stores is drawn
// bit by bit (the exit code in bits 15 to 8, the killing signal in bits 6 to 0) beside the W* macros that read it.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const INC = '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const PROGS = {
    codes: {
      label: 'three children, three exit codes', file: 'codes.c',
      src: INC + `int main(void) {
    for (int i = 1; i <= 3; i++)
        if (fork() == 0) {
            sleep(4 - i);
            exit(10 * i);
        }
    int st;
    pid_t k;
    while ((k = wait(&st)) > 0) {
        int c = WEXITSTATUS(st);
        printf("%d gave %d\\n", k, c);
    }
    return 0;
}`,
    },
    pick: {
      label: 'waitpid for one child', file: 'pick.c',
      src: INC + `int main(void) {
    pid_t a = fork();
    if (a == 0)
        exit(1);
    pid_t b = fork();
    if (b == 0) {
        sleep(1);
        exit(2);
    }
    int st;
    waitpid(b, &st, 0);
    printf("b: %d\\n", WEXITSTATUS(st));
    waitpid(a, &st, 0);
    printf("a: %d\\n", WEXITSTATUS(st));
    return 0;
}`,
    },
    nohang: {
      label: 'WNOHANG: ask without waiting', file: 'poll.c',
      src: INC + `int main(void) {
    pid_t k = fork();
    if (k == 0) {
        sleep(2);
        return 4;
    }
    int st;
    while (!waitpid(k, &st, WNOHANG)) {
        printf("not yet\\n");
        sleep(1);
    }
    printf("code %d\\n", WEXITSTATUS(st));
    return 0;
}`,
    },
    signal: {
      label: 'a child killed by a signal', file: 'killed.c',
      src: INC.replace('#include <unistd.h>', '#include <signal.h>\n#include <unistd.h>') + `int main(void) {
    pid_t k = fork();
    if (k == 0) {
        kill(getpid(), SIGTERM);
        return 1;
    }
    int st;
    wait(&st);
    if (WIFSIGNALED(st))
        printf("sig %d\\n", WTERMSIG(st));
    exit(300);
}`,
    },
  };
  P.PROGS_WAIT = PROGS;

  /** the status word, 16 bits, and the macros that read it */
  function statusPanel(st, x, y, w, live) {
    const items = [], cw = Math.min(26, Math.floor(w / 16)), d = P.decode(st);
    items.push(H.text('swt', x, y + 13, live ? 'the status word wait stored: ' + st : 'no status collected yet', 'title', 13));
    for (let b = 15; b >= 0; b--) {
      const bit = live ? (st >> b) & 1 : '', k = 15 - b;
      items.push(H.cell('sb' + b, x + k * cw, y + 24, cw, 26, String(bit), 'bitc ' + (b >= 8 ? 'hi' : b === 7 ? 'core' : 'lo'), { size: 13 }));
    }
    items.push(H.text('swh', x + 4 * cw, y + 68, 'exit code, bits 15–8', 'addr', 13, 'middle'));
    items.push(H.text('swl', x + 12.5 * cw, y + 68, 'signal, bits 6–0', 'addr', 13, 'middle'));
    const mac = [['WIFEXITED', live ? (d.exited ? 1 : 0) : ''], ['WEXITSTATUS', live && d.exited ? d.code : '—'], ['WIFSIGNALED', live ? (d.signaled ? 1 : 0) : ''], ['WTERMSIG', live && d.signaled ? d.sig : '—']];
    const mw = Math.floor((16 * cw - 8) / 2);
    mac.forEach((m, i) => {
      const cx = x + (i % 2) * (mw + 8), cy = y + 80 + Math.floor(i / 2) * 30;
      items.push(H.cell('mc' + i, cx, cy, mw, 26, m[0] + '(st) = ' + m[1], 'macro ' + (live && (m[1] === 1 || (i % 2 === 1 && m[1] !== '—')) ? 'yes' : 'no'), { size: 13 }));
    });
    return { items, h: 80 + 60 };
  }

  S.topic({
    id: 'p02-wait', family: 'p02-api', order: 40, title: 'wait, waitpid and the exit status',
    blurb: 'A child\'s exit code does not vanish: the kernel keeps it in the child\'s process entry until the parent asks. wait takes any child that has finished, waitpid one named child, and with WNOHANG it returns 0 at once instead of blocking. The status word packs how the child ended: the exit code in bits 15 to 8 (only its low 8 bits survive), or the number of the signal that killed it in the low 7 bits. The W* macros take it apart.',
    inputs: [
      { id: 'prog', kind: 'choice', label: 'Program', def: 'codes', options: P.options(PROGS) },
      { id: 'pol', kind: 'choice', label: 'Who runs', def: 'fifo', options: P.POLICIES },
      { id: 'seed', kind: 'slider', label: 'Seed (random)', def: 1, min: 1, max: 20, step: 1 },
    ],
    presets: [
      { label: 'Three exit codes, reaped as they finish', values: { prog: 'codes', pol: 'fifo' } },
      { label: 'waitpid takes the named child', values: { prog: 'pick', pol: 'fifo' } },
      { label: 'Polling with WNOHANG', values: { prog: 'nohang', pol: 'fifo' } },
      { label: 'Killed by SIGTERM; exit(300)', values: { prog: 'signal', pol: 'fifo' } },
      { label: 'Three codes, a random schedule', values: { prog: 'codes', pol: 'random', seed: 7 } },
    ],
    counters: [{ id: 'reaped', label: 'children reaped' }, { id: 'polls', label: 'WNOHANG answers of 0' }],
    run(inp) {
      const pr = PROGS[inp.prog], sys = P.run(pr.src, Object.assign({ cow: false }, P.policy(inp.pol, inp.seed)));
      const bs = P.beats(sys, { skip: ['wake'] }), F = new S.Frames(['reaped', 'polls']);
      let st = null, reaped = 0, polls = 0;
      bs.forEach((b) => {
        const w = b.evs[0];
        if (b.kind === 'wait' && w.pid >= 100 && w.ret > 0) { st = w.status; reaped++; }
        if (b.kind === 'wait' && w.ret === 0) polls++;
        F.set('reaped', reaped).set('polls', polls);
        const fresh = b.kind === 'wait' && w.pid >= 100 && w.ret > 0;
        const sc = P.scene({ sys, beat: b, src: pr.src, file: pr.file, rowsShown: 3, extra: (y, rx, rw) => statusPanel(st, rx, y, rw, st !== null) });
        let say = b.say;
        if (fresh) {
          const d = P.decode(st);
          say += d.exited ? ' Bits 15 to 8 hold the exit code: ' + d.code + ' × 256 = ' + st + ', so WIFEXITED is true and WEXITSTATUS gives ' + d.code + '.' : ' The low 7 bits hold the signal ' + d.sig + ' (' + (P.SIGNAME[d.sig] || 'a signal') + '), so WIFSIGNALED is true and WTERMSIG gives ' + d.sig + '.';
        }
        if (b.kind === 'exit' && /exit\(300\)/.test(pr.src) && w.code === 44) say += ' The program asked for exit(300), but only the low 8 bits are kept: 300 − 256 = 44.';
        const d = st === null ? {} : P.decode(st);
        F.add({ items: sc.items, say, meta: H.metaOf(b, { status: st, code: d.code, sig: d.sig, reaped, polls, k256: 256, k300: 300 }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The status word', text: ['wait(&st): any child; blocks', 'waitpid(pid, &st, 0): that child', 'waitpid(pid, &st, WNOHANG):', '  0 at once if it has not ended', 'exit(c): st = (c & 255) << 8', 'killed by signal s: st = s', 'WIFEXITED(st)   (st & 127) == 0', 'WEXITSTATUS(st) (st >> 8) & 255', 'WIFSIGNALED(st) the low 7 bits', '  are a signal number', 'WTERMSIG(st)    st & 127'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => { const n = fr[i + 1]; return n && n.meta.phase === 'wait' && n.meta.evs[0].pid >= 100 && n.meta.evs[0].ret > 0; }, once: true, pick: 'option', ask: 'The parent\'s wait is about to return. What number will it store in st?', options: (fr, i) => { const s = fr[i + 1].meta.status, d = P.decode(s); return [...new Set([s, d.exited ? d.code : s + 128, d.exited ? d.code + 128 : s << 8])].map(String); }, answer: (fr, i) => String(fr[i + 1].meta.status), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A child calls exit(3). What does wait store in st?', options: ['768 (3 × 256)', '3', '0', '−3'], answer: 0, why: 'The exit code sits in bits 15 to 8; WEXITSTATUS shifts it back down.' },
      { q: 'A child calls exit(260). What does WEXITSTATUS give?', options: ['4', '260', '0', '255'], answer: 0, why: 'Only the low 8 bits of the exit code are kept: 260 − 256 = 4.' },
      { q: 'waitpid(k, &st, WNOHANG) returns 0. What does that mean?', options: ['the child k has not ended yet, and the call did not wait', 'the child exited with code 0', 'there is no such child', 'the call failed'], answer: 0, why: 'WNOHANG asks without blocking; 0 means nothing to collect yet.' },
      { q: 'A child is killed by SIGKILL (9). What is WIFEXITED(st)?', options: ['false: the low 7 bits hold 9', 'true', 'it depends on the exit code', '9'], answer: 0, why: 'A child that did not exit normally has a signal number in the low bits.' },
      { q: 'Two children have exited; the parent calls wait once. What happens to the other?', options: ['it stays a zombie until another wait', 'it is reaped too', 'it is killed', 'it is re-parented to init at once'], answer: 0, why: 'Each wait collects one child; a program should wait once per child.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
