// Part 1, what the OS gives a program (continued): files that outlive the process that wrote them (persistence),
// and a referee that keeps one program's mistakes, or its greed, from hurting the others (protection). Real C
// programs on the simulated kernel (S.Kern), drawn with their listing, process tree and terminal, plus the
// kernel's file store or each process's share of the CPU.
(function (S) {
  'use strict';
  const H = S.PX;

  const PERSIST = [
    {
      name: 'a child writes, the parent reads', file: 'list.c', names: { 100: 'P', 101: 'W' },
      src: `#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>
#define NEW (O_WRONLY | O_CREAT)
int main(void) {
    if (fork() == 0) {
        int fd = open("f.txt", NEW, 0644);
        write(fd, "milk, eggs\\n", 11);
        close(fd);
        return 0;
    }
    wait(NULL);
    char buf[32];
    int fd = open("f.txt", O_RDONLY);
    int n = read(fd, buf, 31);
    buf[n] = 0;
    printf("P read: %s", buf);
    return 0;
}`,
    },
    {
      name: 'two writers, one after the other', file: 'log.c', names: { 100: 'P', 101: 'A', 102: 'B' },
      src: `#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>
#define ADD (O_WRONLY | O_CREAT | O_APPEND)
void note(const char *s, int n) {
    int fd = open("log.txt", ADD, 0644);
    write(fd, s, n);
    close(fd);
}
int main(void) {
    if (fork() == 0) { note("A ran\\n", 6); return 0; }
    wait(NULL);
    if (fork() == 0) { note("B ran\\n", 6); return 0; }
    wait(NULL);
    return 0;
}`,
    },
  ];
  (H.SRC = H.SRC || {}).persist = PERSIST.map((p) => p.src);
  /** the kernel's file store at a beat: o {prefix, x, y, w, ks, hit: name} */
  function files(o) {
    const items = [], fs = (o.ks && o.ks.files) || { dir: {}, inodes: {} };
    items.push(H.title(o.prefix + ':t', o.x, o.y, 'on the disk (the file store)'));
    const names = Object.keys(fs.dir || {});
    if (!names.length) items.push(H.text(o.prefix + ':n', o.x, o.y + 24, 'no files yet', '', 13));
    names.forEach((nm, k) => {
      const ino = fs.dir[nm], d = (fs.inodes[ino] || {}).data || '', y = o.y + 12 + k * 32, hit = o.hit === nm;
      items.push(H.cell(o.prefix + ':f' + k, o.x, y, 96, 28, nm, 'vec mono' + (hit ? ' act' : ''), { size: 13 }));
      items.push(H.cell(o.prefix + ':d' + k, o.x + 100, y, o.w - 100, 28, '"' + d.replace(/\n/g, '\\n') + '" (' + d.length + ' B)', 'vec mono' + (hit ? ' act' : ''), { size: 13, align: 'left' }));
    });
    return { items, h: 12 + Math.max(1, names.length) * 32 };
  }

  S.topic({
    id: 'p01-persist', family: 'p01-roles', order: 30, title: 'Files outlive the processes that write them',
    blurb: 'A process\'s memory disappears when it exits: its variables, its heap, its stack. What it wrote to a file stays, because the file belongs to the file system, not to the process. A child writes a line and exits; its memory is gone, yet its parent opens the same name and reads the line back. Persistence is the third thing the OS provides, beside a CPU and a memory of one\'s own.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: '0', options: PERSIST.map((m, i) => ({ value: String(i), label: m.name })) }],
    presets: PERSIST.map((m, i) => ({ label: m.name, values: { prog: String(i) } })),
    counters: [{ id: 'bytes', label: 'bytes on the disk' }],
    run(inp) {
      const pr = PERSIST[Number(inp.prog)], sys = H.kern(pr.src, { names: pr.names });
      const bs = H.beats(sys), F = new S.Frames(['bytes']);
      bs.forEach((b) => {
        const fsx = (b.ks && b.ks.files) || { dir: {}, inodes: {} };
        const bytes = Object.values(fsx.inodes || {}).reduce((a, n) => a + (n.data || '').length, 0);
        const hit = b.evs[0].path || (b.kind === 'write' || b.kind === 'read' ? Object.keys(fsx.dir)[0] : null);
        const sc = H.scene({ sys, beat: b, src: pr.src, file: pr.file, depth: 1, codeW: 420, lineH: 19, treeOpts: { hide: ['init', 'shell'], boxW: 124 }, rowsShown: 2, buffers: false, extraRight: (y, x, w) => files({ prefix: 'fs', x, y: y + 10, w, ks: b.ks, hit }) });
        F.set('bytes', bytes);
        F.add({ items: sc.items, say: b.say, meta: H.metaOf(b, { bytes, files: fsx }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Persistence', text: ['memory: freed when the process exits', 'files: kept by the file system', '  until someone removes them', 'a name in a directory', '  → an inode → the data'].join('\n') }] }, result: { out: sys.out } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'exit' && fr.slice(i + 1).some((x) => x.meta.phase === 'read' || x.meta.phase === 'open'), once: true, pick: 'option', ask: 'The writer has exited and its memory is freed. Is what it wrote still there?', options: ['yes, in the file', 'no, it went with the process\'s memory'], answer: 'yes, in the file', explain: (fr) => (fr.find((x) => x.meta.phase === 'read') || fr[fr.length - 1]).say },
    ],
    quiz: [
      { q: 'A process writes to a file and then crashes. What survives?', options: ['what reached the file system', 'its variables', 'its stack', 'nothing'], answer: 0, why: 'The file system keeps file data apart from any process; memory goes with the process.' },
      { q: 'Two processes open the same file name. What do they share?', options: ['the file\'s data, through the same inode', 'their memory', 'their stacks', 'nothing at all'], answer: 0, why: 'The name leads both to one inode.' },
      { q: 'What does exit do to a process\'s open descriptors?', options: ['closes them; the files themselves stay', 'deletes the files', 'leaves them open for ever', 'copies them to the parent'], answer: 0, why: 'Closing drops the process\'s reference; the data stays on the disk.' },
      { q: 'With O_APPEND, where does each write land?', options: ['at the current end of the file', 'at offset 0', 'wherever the last reader stopped', 'in a new file'], answer: 0, why: 'So two writers one after the other each add their own line.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The referee
  // ---------------------------------------------------------------------------------------------------------------
  const REF = [
    {
      name: 'a child writes through NULL', file: 'null.c', names: { 100: 'P', 101: 'C' }, opts: {},
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    pid_t k = fork();
    if (k == 0) {
        int *p = NULL;
        *p = 42;
        return 0;
    }
    int st;
    wait(&st);
    int sig = WTERMSIG(st);
    printf("C died of %d\\n", sig);
    printf("P carries on\\n");
    return 0;
}`,
    },
    {
      name: 'a child divides by zero', file: 'div.c', names: { 100: 'P', 101: 'C' }, opts: {},
      src: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    if (fork() == 0) {
        int zero = 0;
        printf("%d\\n", 10 / zero);
        return 0;
    }
    int st;
    wait(&st);
    int sig = WTERMSIG(st);
    printf("C died of %d\\n", sig);
    return 0;
}`,
    },
    {
      name: 'a child that never yields', file: 'greedy.c', names: { 100: 'P', 101: 'G' }, opts: { policy: 'rr', quantum: 3 },
      src: `#include <stdio.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void) {
    pid_t k = fork();
    if (k == 0) {
        for (;;)
            ;
    }
    sleep(1);
    kill(k, SIGKILL);
    int st;
    waitpid(k, &st, 0);
    int sig = WTERMSIG(st);
    printf("G died of %d\\n", sig);
    return 0;
}`,
    },
  ];
  /** how many steps each program process had run by each event of a run */
  function cpuShares(sys) {
    const by = {}, at = new Map();
    for (const e of sys.trace) { if (e.kind === 'step' && e.pid >= 100) by[e.pid] = (by[e.pid] || 0) + 1; at.set(e, Object.assign({}, by)); }
    return at;
  }

  S.topic({
    id: 'p01-referee', family: 'p01-roles', order: 40, title: 'The OS as referee: one program\'s fault stays its own',
    blurb: 'Programs make mistakes: a write through a NULL pointer, a division by zero, a loop that never ends. The CPU traps each fault to the kernel, which ends the process that made it with a signal, frees what it held and tells its parent; every other process carries on untouched. A loop is no fault at all, but the timer still takes the CPU back, so the others keep their turns and one of them can end it.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: '0', options: REF.map((m, i) => ({ value: String(i), label: m.name })) }],
    presets: REF.map((m, i) => ({ label: m.name, values: { prog: String(i) } })),
    counters: [{ id: 'killed', label: 'processes ended by a signal' }],
    run(inp) {
      const pr = REF[Number(inp.prog)], sys = H.kern(pr.src, Object.assign({ names: pr.names }, pr.opts));
      const shares = cpuShares(sys), bs = H.beats(sys), F = new S.Frames(['killed']);
      let killed = 0;
      bs.forEach((b) => {
        if (b.kind === 'exit' && b.evs[0].crash) killed++;
        const sh = shares.get(b.evs[b.evs.length - 1]) || {};
        const pids = Object.keys(sh).map(Number).sort((a, c) => a - c), max = Math.max(1, ...pids.map((p) => sh[p]));
        const sc = H.scene({ sys, beat: b, src: pr.src, file: pr.file, depth: 1, codeW: 420, lineH: 19, treeOpts: { hide: ['init', 'shell'], boxW: 112 }, rowsShown: 2, buffers: false,
          extraRight: (y, x, w) => {
            const items = [H.title('cs:t', x, y + 10, 'statements each has run')];
            pids.forEach((p, k) => {
              const yy = y + 22 + k * 32, bw = Math.max(4, Math.round(((w - 150) * sh[p]) / max));
              items.push(H.text('cs:n' + p, x + 36, yy + 19, String(p), 'strong', 14, 'end'), H.cell('cs:b' + p, x + 44, yy + 4, bw, 22, '', 'bar ' + (p === 100 ? 'c0' : 'c1')), H.text('cs:v' + p, x + 52 + bw, yy + 20, String(sh[p]), 'mono', 13));
            });
            return { items, h: 22 + Math.max(1, pids.length) * 32 };
          } });
        F.set('killed', killed);
        F.add({ items: sc.items, say: b.say, meta: H.metaOf(b, { shares: sh, killed }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Faults and their signals', text: ['NULL or a bad address → SIGSEGV (11)', 'division by zero → SIGFPE (8)', 'kill(pid, SIGKILL) → SIGKILL (9)', 'the default action ends the process', 'the parent\'s wait gets the signal:', '  WTERMSIG(status)'].join('\n') }] }, result: { out: sys.out } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'error', pick: 'option', ask: 'The child is about to run its faulty line. What happens to the parent?', options: ['nothing: it carries on and learns why the child died', 'it is ended too', 'the whole machine stops'], answer: 'nothing: it carries on and learns why the child died', explain: (fr) => fr.filter((x) => x.meta.phase === 'wait')[0].say },
      { at: (f) => f.meta.phase === 'block' && f.meta.evs[0].why === 'sleep', pick: 'option', ask: 'The parent sleeps while its child loops for ever. Will the parent ever run again?', options: ['yes: the timer takes the CPU back and the parent wakes when its sleep ends', 'no: the loop keeps the CPU'], answer: 'yes: the timer takes the CPU back and the parent wakes when its sleep ends', explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A child process writes through a NULL pointer. Who is ended?', options: ['only the child', 'the child and its parent', 'every process', 'nobody: the write is ignored'], answer: 0, why: 'The fault traps in the child; the kernel ends that process alone.' },
      { q: 'How does the parent find out what killed its child?', options: ['wait gives a status; WTERMSIG(status) is the signal number', 'it reads the child\'s memory', 'from the terminal', 'it cannot'], answer: 0, why: 'The zombie keeps the status until the parent collects it.' },
      { q: 'Why can a loop that never makes a system call not freeze the machine?', options: ['the timer interrupt hands the CPU back to the kernel, which schedules the others', 'the compiler removes such loops', 'the loop eventually overflows', 'it can'], answer: 0, why: 'See [[p01-lde]].' },
      { q: 'Can a process catch SIGKILL and refuse to die?', options: ['no: SIGKILL cannot be caught, blocked or ignored', 'yes, with a handler', 'yes, by blocking it', 'only the shell can'], answer: 0, why: 'The referee keeps one signal no program can resist.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
