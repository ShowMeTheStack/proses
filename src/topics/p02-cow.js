// Part 2, copy-on-write after fork: fork copies no memory at first. The child's page table points at the parent's
// frames, every one marked read-only and counted twice; the first write to a shared page, by either process,
// traps, and only then does the kernel copy that one page. Each process's page table is a row of frame numbers,
// over the regions they hold; under them every frame in use, shared ones marked.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const INC = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n';
  const PROGS = {
    global: {
      label: 'the child changes a global', file: 'count.c',
      src: INC + `int count = 0;

int main(void) {
    pid_t k = fork();
    if (k == 0) {
        count = 42;
        printf("child: %d\\n", count);
        return 0;
    }
    wait(NULL);
    printf("parent: %d\\n", count);
    return 0;
}`,
    },
    reads: {
      label: 'the child only reads', file: 'look.c',
      src: INC + `int table[2000];

int main(void) {
    table[1500] = 7;
    if (fork() == 0) {
        int s = table[0] + table[1500];
        printf("child read %d\\n", s);
        return 0;
    }
    wait(NULL);
    return 0;
}`,
    },
    array: {
      label: 'writes spread over an array', file: 'spread.c',
      src: INC + `int big[3000];

int main(void) {
    pid_t k = fork();
    if (k == 0) {
        for (int i = 0; i < 3; i++)
            big[i * 1100] = 2;
        return 0;
    }
    wait(NULL);
    printf("parent sees %d\\n", big[0]);
    return 0;
}`,
    },
    exec: {
      label: 'the child execs at once', file: 'spawn.c',
      src: INC + `int main(void) {
    pid_t k = fork();
    if (k == 0) {
        execlp("echo", "echo", "x", NULL);
        return 127;
    }
    wait(NULL);
    printf("done\\n");
    return 0;
}`,
    },
  };
  P.PROGS_COW = PROGS;

  /** the region a page holds, from the program's layout */
  const region = (prog, i, ps) => { const a = i * ps; return i === 0 ? 'lib' : a < prog.heapBase ? 'data' : a < prog.stackBase ? 'heap' : 'stack'; };
  const RNAME = { lib: 'C library', data: 'data', heap: 'heap', stack: 'stack' };

  function pages(b, prog, x, y, w) {
    const items = [], ps = 4096;
    const procs = b.snap.filter((p) => p.role === 'prog' && p.pages.length && p.state !== 'zombie' && p.state !== 'reaped');
    const n = Math.max(1, ...procs.map((p) => p.pages.length), prog ? Math.ceil(prog.memSize / ps) : 1);
    const lw = 56, cw = Math.max(26, Math.min(40, Math.floor((w - lw) / n)));
    const owner = {};
    b.snap.filter((p) => p.role === 'prog').forEach((p, k) => p.pages.forEach((f) => { owner[f] = owner[f] === undefined ? k % 2 : owner[f]; }));
    const frames = Object.values(b.ks.frames || {}).sort((a, c) => a.id - c.id);
    const shared = (f) => (b.ks.frames[f] || {}).refs >= 2;
    items.push(H.text('pgt', x, y + 13, 'page tables: page → frame', 'title', 13));
    let yy = y + 24;
    // the regions over the pages
    if (prog) {
      let i = 0;
      while (i < n) {
        const r = region(prog, i, ps); let j = i; while (j + 1 < n && region(prog, j + 1, ps) === r) j++;
        items.push(H.cell('rg' + i, x + lw + i * cw, yy, (j - i + 1) * cw - 2, 22, (j - i + 1) * cw > 70 ? RNAME[r] : r === 'lib' ? 'lib' : RNAME[r].slice(0, 4), 'seg ' + (r === 'lib' ? 'null' : r), { size: 13 }));
        i = j + 1;
      }
      yy += 28;
    }
    items.push(H.text('pgi', x + lw - 8, yy + 15, 'page', 'addr', 13, 'end'));
    for (let i = 0; i < n; i++) if (n <= 14 || i % 2 === 0) items.push(H.text('pn' + i, x + lw + i * cw + cw / 2, yy + 15, String(i), 'addr', 13, 'middle'));
    yy += 22;
    procs.forEach((p, k) => {
      const tag = String(p.pid), tw = Math.round(H.tw(tag, 13, { bold: true }) + 12);
      items.push(H.cell('pp' + p.pid, x, yy + 4, tw, 22, tag, 'ptag' + (p.pid === b.pid ? ' act' : ''), { rx: 11, size: 13 }));
      p.pages.forEach((f, i) => {
        const hit = b.kind === 'cow' && b.pid === p.pid && b.evs[0].page === i;
        items.push(H.cell('pg' + p.pid + '_' + i, x + lw + i * cw, yy, cw - 2, 28, String(f), 'pg ' + (shared(f) ? 'shared' : 'own' + (owner[f] || 0)) + (hit ? ' act' : ''), { size: 13 }));
      });
      yy += 34;
    });
    yy += 8;
    items.push(H.text('frt', x, yy + 13, 'frames in memory: ' + frames.length + ' (' + frames.filter((f) => f.refs >= 2).length + ' shared)', 'title', 13));
    yy += 22;
    const per = Math.max(1, Math.floor(w / 32));
    frames.forEach((f, k) => {
      const hit = b.kind === 'cow' && b.evs[0].to === f.id;
      items.push(H.cell('fr' + f.id, x + (k % per) * 32, yy + Math.floor(k / per) * 32, 30, 28, String(f.id), 'pg ' + (f.refs >= 2 ? 'shared' : 'own' + (owner[f.id] || 0)) + (hit ? ' act' : ''), { size: 13 }));
    });
    yy += Math.ceil(frames.length / per) * 32 + 4;
    return { items, h: yy - y };
  }

  S.topic({
    id: 'p02-cow', family: 'p02-copy', order: 10, title: 'Copy-on-write after fork',
    blurb: 'Copying every page at fork would be wasted work, since many children exec at once. So fork copies only the page table: the child\'s pages point at the parent\'s frames, which both now see as read-only, each frame counted twice. The first write to a shared page faults, and the kernel copies just that page into a new frame for the writer. A page only read is never copied; after exec, the child lets go of every shared frame.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'global', options: P.options(PROGS) }],
    presets: [
      { label: 'The child changes a global', values: { prog: 'global' } },
      { label: 'The child only reads', values: { prog: 'reads' } },
      { label: 'Writes spread over an array', values: { prog: 'array' } },
      { label: 'The child execs at once', values: { prog: 'exec' } },
    ],
    counters: [{ id: 'copies', label: 'pages copied' }, { id: 'frames', label: 'frames in use' }],
    run(inp) {
      const pr = PROGS[inp.prog], sys = P.run(pr.src, { cow: true, policy: 'fifo' });
      const bs = P.beats(sys, { keep: ['cow-share'], skip: ['wake', 'block'] }).filter((b) => b.kind !== 'fork');
      const F = new S.Frames(['copies', 'frames']), prog = sys.procs.find((p) => p.pid === 100).prog;
      let copies = 0;
      bs.forEach((b) => {
        if (b.kind === 'cow') copies++;
        const nf = Object.keys(b.ks.frames || {}).length, nshared = Object.values(b.ks.frames || {}).filter((f) => f.refs >= 2).length;
        F.set('copies', copies).set('frames', nf);
        const sc = P.scene({ sys, beat: b, src: pr.src, file: pr.file, noTree: true, rowsShown: 2, extra: (y, rx, rw) => pages(b, prog, rx, y, rw) });
        let say = b.say;
        if (b.kind === 'cow-share') say = 'Process ' + b.evs[0].parent + ' forks process ' + b.pid + ': ' + say.charAt(0).toLowerCase() + say.slice(1) + ' Every frame is now counted twice.';
        if (b.kind === 'cow') { const e = b.evs[0]; say += ' Page ' + e.page + ' is ' + H.an(RNAME[region(prog, e.page, 4096)]) + ' page.'; }
        F.add({ items: sc.items, say, meta: H.metaOf(b, { copies, frames: nf, shared: nshared }), title: b.kind });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Copy-on-write', text: ['fork: copy the page table only;', '  every frame now has 2 users,', '  both mappings read-only', 'a write to a shared page faults:', '  copy that page to a new frame,', '  map it writable for the writer', 'a page only read: never copied', 'exec or exit: the shares are', '  given back'].join('\n') }] }, result: { copies } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'cow-share', once: true, pick: 'option', ask: 'fork has just shared every page. How many pages will be copied in this whole run?', options: (fr) => [...new Set([0, 1, 2, 3, fr[fr.length - 1].meta.copies])].sort((a, b) => a - b).map(String), answer: (fr) => String(fr[fr.length - 1].meta.copies), explain: (fr) => 'Only pages written while shared are copied: ' + fr.filter((g) => g.meta.phase === 'cow').map((g) => 'page ' + g.meta.evs[0].page + ' by ' + g.meta.evs[0].pid).join(', ') + (fr.some((g) => g.meta.phase === 'cow') ? '.' : 'none here.') },
    ],
    quiz: [
      { q: 'Right after fork with copy-on-write, how much memory has been copied?', options: ['none: only the page table', 'all of it', 'the stack only', 'the heap only'], answer: 0, why: 'The two page tables point at the same frames, marked read-only.' },
      { q: 'Which access makes the kernel copy a shared page?', options: ['the first write to it, by either process', 'any read', 'the next context switch', 'the child\'s first instruction'], answer: 0, why: 'The write faults on the read-only mapping; the handler copies the page.' },
      { q: 'Why is copy-on-write a big saving for fork followed by exec?', options: ['exec throws the copy away, so copying first would be wasted', 'exec needs the pages copied', 'it makes exec faster than fork', 'it saves disk space'], answer: 0, why: 'Only the few pages touched before exec are ever copied.' },
      { q: 'Even if neither process writes a variable on purpose, a page is usually copied at once after fork. Which?', options: ['a stack page: fork\'s return value is stored on the stack', 'the code page', 'page 0', 'none'], answer: 0, why: 'pid_t k = fork() writes k, which lives on the stack.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
