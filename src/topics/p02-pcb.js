// Part 2, the process control block: everything the kernel keeps about one process, field by field, read from the
// simulated kernel's process table as a real C program runs. First a tour of the fields, then the run, with each
// field that changes lit.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const SRC = `#include <stdio.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>

void on_usr(int s) { }

int main(void) {
    int fd = open("notes.txt",
                  O_WRONLY | O_CREAT, 0644);
    signal(SIGUSR1, on_usr);
    pid_t k = fork();
    if (k == 0) {
        printf("child up");
        sleep(1);
        return 3;
    }
    kill(k, SIGUSR1);
    waitpid(k, NULL, 0);
    return 0;
}`;
  P.SRC_PCB = SRC;
  const FIELDS = [
    ['pid', 'pid', 'the process\'s number, unique while it exists'],
    ['ppid', 'parent', 'the pid of its parent, which will reap it'],
    ['state', 'state', 'ready, running, blocked, zombie: what the scheduler needs'],
    ['line', 'next line', 'where it will resume: its saved program counter, as a line'],
    ['mem', 'memory', 'its page table: which frames hold its pages'],
    ['fds', 'open files', 'its descriptor table: each fd points at an open file'],
    ['sig', 'handlers', 'what each signal does to it: default, ignored or a handler'],
    ['pend', 'pending', 'signals sent but not yet delivered'],
    ['buf', 'stdout buffer', 'kept in its own memory by the C library, drawn here too'],
    ['exit', 'exit status', 'set at exit, kept until the parent reaps it'],
  ];
  const sigNames = (mask) => { const out = []; for (let s = 1; s < 32; s++) if (mask & (1 << (s - 1))) out.push(P.SIGNAME[s] || 'signal ' + s); return out; };
  function values(p, ks) {
    if (!p) return null;
    const files = (ks.files || { dir: {} }).dir;
    const nm = (id) => { const o = ks.ofiles[id] || {}; return o.kind === 'tty' ? 'terminal' : o.kind === 'file' ? Object.keys(files).find((n) => files[n] === o.ino) || 'file' : o.kind || '?'; };
    const fds = [];
    p.fds.forEach((id, i) => { if (id === null || id === undefined) return; const n = nm(id), g = fds.find((x) => x.n === n); if (g) g.f.push(i); else fds.push({ n, f: [i] }); });
    return {
      pid: String(p.pid), ppid: String(p.ppid), state: p.state + (p.why ? ' (' + p.why + ')' : ''), line: p.state === 'zombie' || p.state === 'reaped' ? '—' : String(p.line),
      mem: p.pages.length ? p.pages.length + ' pages, frames ' + Math.min(...p.pages) + '–' + Math.max(...p.pages) : 'freed',
      fds: fds.map((g) => g.f.join(',') + ' → ' + g.n).join('; ') || 'none (closed at exit)',
      sig: Object.keys(p.handlers).map((k) => (P.SIGNAME[k] || k) + ' → ' + (p.handlers[k] === 'ign' ? 'ignore' : p.handlers[k].fn || 'handler')).join(', ') || 'all default',
      pend: sigNames(p.pending).join(', ') || 'none', buf: p.buf ? '"' + p.buf + '"' : 'empty',
      exit: p.exitCode === null || p.exitCode === undefined ? (p.state === 'zombie' ? 'killed' : '—') : String(p.exitCode),
    };
  }

  S.topic({
    id: 'p02-pcb', family: 'p02-image', order: 20, title: 'The process control block',
    blurb: 'For every process the kernel keeps one record, the process control block: its pid and its parent\'s, its state, where it will resume, its page table, its table of open files, what each signal does to it and which are pending, and, once it exits, its status. The scheduler, the memory manager, the file layer and the signal code all read and write this one record. Watch one process\'s record change as a real program runs.',
    inputs: [{ id: 'who', kind: 'choice', label: 'Whose PCB', def: 'child', options: [{ value: 'child', label: 'the child (pid 101)' }, { value: 'parent', label: 'the parent (pid 100)' }] }],
    presets: [
      { label: 'The child\'s PCB', values: { who: 'child' } },
      { label: 'The parent\'s PCB', values: { who: 'parent' } },
    ],
    counters: [{ id: 'changes', label: 'fields changed' }],
    run(inp) {
      const sys = P.run(SRC, { cow: true, policy: 'fifo' }), focus = inp.who === 'child' ? 101 : 100;
      const bs = P.beats(sys, { skip: ['cow', 'wake'] }), F = new S.Frames(['changes']);
      let prev = null, changes = 0, toured = false;
      const panel = (vals, lit, changed) => (y, rx, rw) => {
        const kw = 120, rows = FIELDS.map(([k, label]) => [{ text: label, cls: 'pcbk' + (lit === k ? ' act' : '') }, { text: vals ? vals[k] : '', cls: 'pcbv' + (lit === k ? ' act' : changed && changed.includes(k) ? ' changed' : '') }]);
        const t = H.table({ prefix: 'pcb', x: rx, y: y + 18, cols: [{ w: kw, label: 'field' }, { w: rw - kw, label: 'value' }], rows, rowH: 24, size: 13 });
        return { items: [H.text('pcbt', rx, y + 8, 'PCB of process ' + focus, 'title', 13)].concat(t.items), h: t.h + 18 };
      };
      bs.forEach((b) => {
        const p = b.snap.find((x) => x.pid === focus && x.state !== 'reaped');
        const vals = values(p, b.ks);
        // exit's own flush happens as the process leaves main: its line is not a place it will resume
        if (vals && prev && b.kind === 'print' && /exits/.test(b.say)) vals.line = prev.line;
        const changed = vals && prev ? FIELDS.map((f) => f[0]).filter((k) => vals[k] !== prev[k]) : [];
        changes += changed.length;
        F.set('changes', changes);
        const sc = (lit, ch) => P.scene({ sys, beat: b, src: SRC, file: 'pcb.c', rowsShown: 1, depth: 1, levelH: 54, boxH: 40, extra: panel(vals, lit, ch) });
        const meta = (x) => H.metaOf(b, Object.assign({ focus, vals, changed, changes }, x || {}));
        let say = b.say;
        if (vals && changed.length && prev) say += ' In ' + focus + '\'s PCB: ' + changed.map((k) => FIELDS.find((f) => f[0] === k)[1] + ' → ' + vals[k]).join('; ') + '.';
        if (vals && !prev) say += ' Process ' + focus + ' now has a PCB.';
        F.add({ items: sc(null, changed).items, say, meta: meta(), title: b.kind });
        // the first time the process is seen, a tour of its fields
        if (vals && !toured) {
          toured = true;
          for (const [k, label, what] of FIELDS) F.add({ items: sc(k, []).items, say: H.cap(label) + ': ' + what + '. For process ' + focus + ' now: ' + vals[k] + '.', meta: meta({ phase: 'field', field: k }), title: label });
        }
        prev = vals || prev;
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'What a PCB holds', text: ['identity: pid, parent, group', 'scheduling: state, priority,', '  saved registers and PC', 'memory: the page table', 'files: the descriptor table', 'signals: handlers, pending, mask', 'accounting: CPU time used', 'exit status, until reaped'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'block' && fr[i + 1].meta.evs[0].pid === f.meta.focus && f.meta.phase !== 'field', once: true, pick: 'option', ask: (fr, i) => 'Process ' + fr[i].meta.focus + ' is about to block. Which PCB field changes?', options: ['state', 'pid', 'open files', 'parent'], answer: 'state', explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => f.meta.phase === 'field' && f.meta.field === 'exit', once: true, pick: 'option', ask: 'When this process exits, which part of its PCB stays until it is reaped?', options: ['the pid and the exit status', 'its memory', 'its open files', 'nothing'], answer: 'the pid and the exit status', explain: 'Exit frees memory and closes files; the entry with its status waits for the parent.' },
    ],
    quiz: [
      { q: 'Where does the kernel keep a process\'s saved registers while it is not running?', options: ['with its PCB (on its kernel stack, pointed to by the PCB)', 'in the heap of the process', 'on the disk', 'in the parent\'s PCB'], answer: 0, why: 'A context switch saves them there and loads them back.' },
      { q: 'Which PCB fields does fork give the child as copies of the parent\'s?', options: ['open files, signal handlers, memory', 'pid and parent', 'exit status', 'none'], answer: 0, why: 'The child gets a new pid and the parent\'s pid as its parent.' },
      { q: 'A process blocks on sleep. Which field records it?', options: ['state', 'pid', 'pending', 'exit status'], answer: 0, why: 'The scheduler skips processes whose state is blocked.' },
      { q: 'A signal is sent while the process is asleep. Where is it noted?', options: ['in the pending set of its PCB', 'in its stdout buffer', 'in the parent\'s PCB', 'nowhere'], answer: 0, why: 'It is delivered when the process next runs.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
