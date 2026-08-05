// The exercise kinds' checkers (src/app/check-*.js): every kind's sample exercise, the solution passes and the wrong
// answers fail, plus independent reimplementations of the arithmetic (XOR parity, FCFS charts, FIFO replacement,
// address splits, disk movement, safe sequences) compared with the checkers' expected answers on seeded random cases.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => /\/(check-|lab-sync-[abc]\.js)/.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses, K = S.Check;
const t = harness('app-check');

// ---- every kind's own example ----
const KINDS = ['gantt', 'address-split', 'page-walk', 'replacement-table', 'banker', 'graph-cycle', 'fork-outputs', 'process-tree', 'inode-walk', 'disk-order', 'raid-parity', 'semaphore-trace', 'code'];
for (const k of KINDS) {
  const kind = K.kinds[k];
  t.ok(!!kind, 'kind ' + k + ' is registered');
  if (!kind) continue;
  t.ok(K.kindNames.includes(k), k + ' is listed in kindNames');
  const x = kind.example();
  t.eq(kind.lint ? kind.lint(x) : [], [], k + ' example lints clean');
  const r = K.answer(x, x.solution);
  t.ok(r.ok, k + ' example solution passes: ' + r.message);
  t.ok((x.hints || []).length === 3, k + ' example has three hints');
  for (const w of x.wrong || []) { const q = K.answer(x, w); t.ok(!q.ok && q.message && !/could not be checked/.test(q.message), k + ' wrong answer fails with a message: ' + JSON.stringify(w).slice(0, 60) + ' -> ' + q.message); }
  for (const w of kind.wrongFrom ? kind.wrongFrom(x) : []) t.ok(!K.answer(x, w).ok, k + ' wrongFrom answer fails');
}
// the basic kinds still work
t.ok(K.answer({ kind: 'number', answer: 3 }, '3').ok, 'number kind');
t.ok(!K.answer({ kind: 'number', answer: 3 }, '4').ok, 'number kind wrong');
t.ok(K.answer({ kind: 'choice', answer: 1, options: ['a', 'b'] }, 1).ok, 'choice kind');
t.ok(K.answer({ kind: 'set', answer: '{a, b}' }, '{b, a}').ok, 'set kind');
t.ok(K.answer({ kind: 'table', rows: ['r'], cols: ['c'], cells: { 'r|c': 5 } }, { 'r|c': '5' }).ok, 'table kind');

// ---- numbers typed in any base ----
t.eq(String(K.os.int('0x1F')), '31', 'hex'); t.eq(String(K.os.int('0b101')), '5', 'binary'); t.eq(String(K.os.int('1,024')), '1024', 'grouped'); t.eq(K.os.int('12z'), null, 'junk');

const R = rng(7), ri = (a, b) => a + Math.floor(R() * (b - a + 1));

// ---- FCFS charts against a reimplementation ----
for (let n = 0; n < 40; n++) {
  const jobs = Array.from({ length: ri(2, 4) }, (_, i) => ({ id: String.fromCharCode(65 + i), arrive: ri(0, 6), bursts: [ri(1, 5)] }));
  const ticks = []; let tm = 0;
  for (const j of jobs.slice().sort((a, b) => a.arrive - b.arrive || a.id.localeCompare(b.id))) { while (tm < j.arrive) { ticks.push('-'); tm++; } for (let k = 0; k < j.bursts[0]; k++) { ticks.push(j.id); tm++; } }
  const x = { kind: 'gantt', workload: jobs, policy: 'fcfs', ask: 'chart' };
  t.eq(K.kinds.gantt.solve(x).ticks, ticks, 'fcfs chart ' + n);
  t.ok(K.answer(x, { ticks: ticks.join('') }).ok, 'fcfs chart as a string ' + n);
}

// ---- address splits ----
for (let n = 0; n < 40; n++) {
  const off = ri(4, 12), levels = ri(1, 3), per = ri(2, 6), vaBits = off + levels * per, va = ri(0, 2 ** vaBits - 1);
  const x = { kind: 'address-split', vaBits, pageBytes: 2 ** off, levels, bits: Array(levels).fill(per), pteBytes: 4, va };
  const want = {}; for (let l = 0; l < levels; l++) want['L' + (l + 1)] = String(Math.floor(va / 2 ** (off + (levels - 1 - l) * per)) % 2 ** per); want.offset = String(va % 2 ** off);
  t.ok(K.answer(x, want).ok, 'split ' + n + ' ' + JSON.stringify(want));
}

// ---- FIFO replacement ----
for (let n = 0; n < 40; n++) {
  const refs = Array.from({ length: ri(6, 14) }, () => ri(0, 6)), F = ri(2, 4);
  const frames = Array(F).fill(null), queue = [], want = {};
  refs.forEach((p, i) => {
    let fault = false;
    if (!frames.includes(p)) { fault = true; let slot = frames.indexOf(null); if (slot < 0) { slot = frames.indexOf(queue.shift()); } frames[slot] = p; queue.push(p); }
    frames.forEach((v, f) => { want['f' + f + '|' + (i + 1)] = v === null ? '' : String(v); });
    want['fault|' + (i + 1)] = fault ? 'F' : '';
  });
  t.ok(K.answer({ kind: 'replacement-table', refs, frames: F, policy: 'fifo' }, want).ok, 'fifo table ' + n);
}

// ---- disk FCFS and SSTF movement ----
for (let n = 0; n < 40; n++) {
  const reqs = [...new Set(Array.from({ length: ri(3, 8) }, () => ri(0, 199)))], start = ri(0, 199);
  let pos = start, mv = 0; for (const c of reqs) { mv += Math.abs(c - pos); pos = c; }
  t.ok(K.answer({ kind: 'disk-order', policy: 'fcfs', requests: reqs, start, cylinders: 200 }, { order: reqs.join(' '), movement: String(mv) }).ok, 'fcfs disk ' + n);
  const left = reqs.slice(), order = []; pos = start; mv = 0;
  while (left.length) { left.sort((a, b) => Math.abs(a - pos) - Math.abs(b - pos)); if (left.length > 1 && Math.abs(left[0] - pos) === Math.abs(left[1] - pos)) break; const c = left.shift(); mv += Math.abs(c - pos); pos = c; order.push(c); }
  if (order.length === reqs.length) t.ok(K.answer({ kind: 'disk-order', policy: 'sstf', requests: reqs, start, cylinders: 200 }, { order: order.join(', '), movement: String(mv) }).ok, 'sstf disk ' + n);
}

// ---- XOR parity ----
for (let n = 0; n < 40; n++) {
  const d = Array.from({ length: ri(2, 6) }, () => ri(0, 255));
  const p = d.reduce((a, b) => a ^ b, 0);
  t.ok(K.answer({ kind: 'raid-parity', chunks: d }, '0x' + p.toString(16)).ok, 'parity ' + n);
  t.ok(!K.answer({ kind: 'raid-parity', chunks: d }, '0x' + (p ^ 4).toString(16)).ok, 'parity off by a bit ' + n);
}

// ---- safe sequences: any valid one passes, an invalid one fails ----
for (let n = 0; n < 40; n++) {
  const N = ri(3, 5), M = ri(2, 3);
  const max = Array.from({ length: N }, () => Array.from({ length: M }, () => ri(1, 6)));
  const alloc = max.map((r) => r.map((v) => ri(0, v)));
  const avail = Array.from({ length: M }, () => ri(0, 4));
  const x = { kind: 'banker', ask: 'sequence', avail, alloc, max };
  // brute force every order
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((v, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map((p) => [v].concat(p))));
  const ok = (ord) => { let w = avail.slice(); for (const i of ord) { if (max[i].some((m, j) => m - alloc[i][j] > w[j])) return false; w = w.map((v, j) => v + alloc[i][j]); } return true; };
  const all = perms([...Array(N).keys()]);
  const good = all.filter(ok);
  if (!good.length) t.ok(K.answer(x, 'none').ok, 'unsafe state ' + n);
  else {
    t.ok(K.answer(x, good[good.length - 1].map((i) => 'P' + i).join(', ')).ok, 'a safe sequence passes ' + n);
    const bad = all.find((p) => !ok(p));
    if (bad) t.ok(!K.answer(x, bad.map((i) => 'P' + i).join(', ')).ok, 'an unsafe order fails ' + n);
  }
}

// ---- inode walks against the file system's own walk on a real image ----
{
  const F = S.FS;
  let walked = 0;
  for (const g0 of [{ bs: 128, ps: 4, ndirect: 4, levels: 2 }, { bs: 64, ps: 2, ndirect: 3, levels: 3 }]) {
    const g = F.geometry(Object.assign({ nblocks: 400, ninodes: 16 }, g0));
    const img = F.mkfs(g);
    F.apply(img, 'create', ['/f']);
    F.apply(img, 'write', ['/f', 0, 'x'.repeat(g0.bs * (g0.ndirect + 40))]);
    const ino = F.lookup(img, '/f').ino;
    for (const N of [0, g0.bs * 2 + 5, g0.bs * (g0.ndirect + 3) + 7, g0.bs * (g0.ndirect + 30) + 1]) {
      const w = F.walk(img, ino, N);
      const s = K.kinds['inode-walk'].want(Object.assign({ kind: 'inode-walk', N }, g0));
      t.eq(s.fb, w.fb, 'inode walk file block for N = ' + N);
      t.eq(+s.offset, w.off, 'inode walk offset for N = ' + N);
      t.eq(s.indices, (w.loc.level === 0 ? [w.loc.slot] : w.loc.idx).join(', '), 'inode walk indices for N = ' + N);
      walked++;
    }
  }
  t.eq(walked, 8, 'the walks ran on real images');
  // the arithmetic by hand
  const x = { kind: 'inode-walk', bs: 1024, ps: 4, ndirect: 12, levels: 3, N: 1024 * (12 + 256 + 5) + 9 };
  t.eq(K.kinds['inode-walk'].solve(x), { part: 'double', indices: '0, 5', offset: '9' }, 'double indirect by hand');
  t.eq(K.kinds['inode-walk'].solve({ kind: 'inode-walk', bs: 1024, ps: 4, ndirect: 12, levels: 3, ask: 'max' }), String(1024 * (12 + 256 + 65536 + 16777216)), 'max file size by hand');
}

// ---- semaphores by hand ----
{
  const x = K.kinds['semaphore-trace'].example();
  const s = K.kinds['semaphore-trace'].solve(x);
  t.eq([1, 2, 3, 4, 5, 6].map((k) => s[k + '|s']), ['0', '0', '0', '0', '0', '1'], 'semaphore values');
  t.eq(s['2|blocked'], 'T2', 'T2 blocked after step 2');
}
// ---- the code kind reports where it fails to compile ----
{
  const x = K.kinds.code.example();
  const r = K.answer(x, 'int main(void) {\n  int a = ;\n  return 0;\n}\n');
  t.ok(!r.ok && r.error && r.error.line === 2, 'a compile error comes back with its line: ' + JSON.stringify(r.error));
}
// ---- the basic kinds' forms: percent, one element with no braces, caseless and synonyms ----
{
  const num = { kind: 'number', answer: 66.7, tolerance: 0.05 };
  t.ok(K.answer(num, '66.7%').ok, 'a trailing % reads as the number');
  t.ok(K.answer(num, ' 66.7 % ').ok, 'with spaces too');
  t.ok(!K.answer(num, '0.667').ok, 'a fraction is not the percentage asked');
  const frac = { kind: 'number', answer: 0.667, tolerance: 0.0005, percent: 'fraction' };
  t.ok(K.answer(frac, '66.7%').ok && K.answer(frac, '0.667').ok, 'percent: fraction reads 66.7% as 0.667');
  t.ok(!K.answer(num, '%').ok, 'a lone % is no number');
  const one = { kind: 'set', answer: '{P2}' };
  t.ok(K.answer(one, 'P2').ok, 'one element with no braces is the set of it');
  t.ok(!K.answer(one, 'P3').ok, 'and a wrong one still fails');
  t.ok(K.answer({ kind: 'set', answer: '{P1, P2}', caseless: true }, '{p2, p1}').ok, 'a caseless set');
  t.ok(!K.answer({ kind: 'set', answer: '{P1, P2}' }, '{p2, p1}').ok, 'case counts unless caseless');
  const syn = { kind: 'string', answer: 'system call', caseless: true, spaces: true, synonyms: [['system call', 'syscall', 'sys call']] };
  t.ok(K.answer(syn, 'Syscall').ok && K.answer(syn, 'sys  call').ok && K.answer(syn, 'System Call').ok, 'string synonyms, caseless');
  t.ok(!K.answer(syn, 'interrupt').ok, 'a word outside the group fails');
  const synObj = { kind: 'string', answer: 'trap', synonyms: { trap: ['software interrupt'] }, spaces: true };
  t.ok(K.answer(synObj, 'software interrupt').ok, 'synonyms as an object');
  const setSyn = { kind: 'set', answer: '{fork, exec}', caseless: true, synonyms: [['exec', 'execve', 'execvp']] };
  t.ok(K.answer(setSyn, '{EXECVP, Fork}').ok, 'set synonyms, element by element');
  const strSet = { kind: 'string', set: true, answer: '{ready, blocked}', caseless: true, synonyms: [['blocked', 'waiting']] };
  t.ok(K.answer(strSet, 'Waiting, READY').ok, 'a string compared as a set takes synonyms and case too');
}

// ---- fork-outputs: timed sleep and machine granularity reach the enumeration ----
{
  const sl = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\nint main(void) {\n    if (fork() == 0) { sleep(1); printf("child\\n"); return 0; }\n    printf("parent\\n");\n    wait(NULL);\n    return 0;\n}\n';
  const fo = K.kinds['fork-outputs'];
  t.eq(fo.outputs({ src: sl }).length, 2, 'a sleep only yields by default: both orders');
  t.eq(fo.outputs({ src: sl, sleep: 'timed' }), ['parent\nchild\n'], 'with timed sleep the child prints last');
  const race = '#include <stdio.h>\n#include <pthread.h>\nint n = 0;\nvoid *w(void *a) { n++; return NULL; }\nint main(void) {\n    pthread_t a, b;\n    pthread_create(&a, NULL, w, NULL);\n    pthread_create(&b, NULL, w, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    printf("%d\\n", n);\n    return 0;\n}\n';
  t.eq(fo.outputs({ src: race }).length, 1, 'whole statements: n++ never races');
  t.eq(fo.outputs({ src: race, granularity: 'machine' }).sort(), ['1\n', '2\n'], 'machine granularity: it can lose an increment');
}

// ---- table cells take synonyms and caseless too ----
{
  const tb = { kind: 'table', rows: ['read', 'add'], cols: ['what'], cells: { 'read|what': 'system call', 'add|what': 'user code' }, cellKind: 'text', synonyms: [['system call', 'syscall', 'sys call']] };
  t.ok(K.answer(tb, { 'read|what': 'Syscall', 'add|what': 'User code' }).ok, 'a synonym in a text cell');
  t.ok(!K.answer(tb, { 'read|what': 'interrupt', 'add|what': 'user code' }).ok, 'a wrong cell still fails');
  const ts = { kind: 'table', rows: ['t1'], cols: ['in'], cells: { 't1|in': 'P1, exec' }, cellKind: 'set', caseless: true, synonyms: [['exec', 'execvp']] };
  t.ok(K.answer(ts, { 't1|in': 'EXECVP, p1' }).ok, 'set cells, caseless with synonyms');
}

// ---- process-tree: a child exiting under a parent already blocked in wait is reaped at once, never a zombie ----
{
  const waitFirst = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\nint main(void) {\n    pid_t c = fork();\n    if (c == 0) { sleep(1); printf("child\\n"); return 0; }\n    wait(NULL);\n    printf("parent\\n");\n    return 0;\n}';
  t.eq(K.os.procFacts({ src: waitFirst, names: { 100: 'P', 101: 'C' } }).zombie, [], 'a child of a waiting parent is no zombie');
  const late = waitFirst.replace('sleep(1); printf("child\\n");', 'printf("child\\n");').replace('wait(NULL);', 'sleep(1);\n    wait(NULL);');
  t.eq(K.os.procFacts({ src: late, names: { 100: 'P', 101: 'C' } }).zombie, ['C'], 'a child that exits while its parent sleeps is');
}
// ---- code: a test may expect a crash, and which signal ----
{
  const src = '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\nint main(void) {\n    if (fork() == 0) { int *p = NULL; *p = 1; return 0; }\n    int st;\n    wait(&st);\n    if (WIFSIGNALED(st)) printf("signal %d\\n", WTERMSIG(st));\n    else printf("exit %d\\n", WEXITSTATUS(st));\n    return 0;\n}\n';
  const ex = (t) => ({ kind: 'code', tests: [Object.assign({ name: 'how the child ended', stdout: 'signal 11\n' }, t)] });
  t.ok(!K.answer(ex({}), src).ok, 'a crash nobody expects fails');
  t.ok(K.answer(ex({ crash: true }), src).ok, 'crash: true lets it pass');
  t.ok(K.answer(ex({ signal: 'SIGSEGV' }), src).ok, 'signal: SIGSEGV lets it pass');
  t.ok(/expects only signal 8/.test(K.answer(ex({ signal: 8 }), src).message), 'the wrong signal is named');
  const clean = src.replace('int *p = NULL; *p = 1; ', '');
  t.ok(/no process crashed/.test(K.answer(ex({ signal: 11, stdout: 'exit 0\n' }), clean).message), 'an expected crash that never comes fails');
}

// ---- the gantt kind's modes: one CPU, several cores, real-time, a multilevel queue ----
{
  const G = K.kinds.gantt, xs = G.examples();
  t.eq(xs.map((x) => x.id), ['k-gantt', 'k-gantt-multi', 'k-gantt-rt', 'k-gantt-mlq'], 'a sample of each mode');
  for (const x of xs) {
    t.eq(G.lint(x), [], x.id + ' lints clean');
    t.ok(K.answer(x, x.solution).ok, x.id + ' solution passes');
    for (const w of x.wrong) t.ok(!K.answer(x, w).ok, x.id + ' wrong answer fails');
    t.ok(!/[{}\[\]"]/.test(G.paramsText(x)), x.id + ' parameters read as words: ' + G.paramsText(x));
  }
  // independently: two cores sharing a queue, round robin q = 2, worked by hand
  const multi = xs[1];
  t.eq(multi.solution.lanes.map((l) => l.join('')), ['AACCAA', 'BBDDBD'], 'two cores, worked by hand');
  const half = K.answer(multi, { lanes: [multi.solution.lanes[0], 'BBDD--'] });
  t.ok(/core 1's row is right up to t = 4/.test(half.message), 'a wrong core is named: ' + half.message);
  // real time under RM, by hand: A (1 every 3) always first at its releases, B (2 every 5) in the gaps
  const rt = xs[2];
  t.eq(rt.solution.ticks.join(''), 'ABBA-BAB-ABBA--', 'rate monotonic, worked by hand');
  t.eq(G.rtMarks(rt, 15).filter((m) => m.what === 'release').map((m) => m.task + m.t).join(' '), 'A0 A3 A6 A9 A12 B0 B5 B10', 'the releases marked');
  t.ok(K.answer(rt, Object.assign({}, rt.solution, { metrics: Object.assign({}, rt.solution.metrics, { 'B1|response': '-' }) })).ok === false, 'a response written as - where one exists is wrong');
  t.ok(/class 0 \(interactive\): round robin, quantum 1; class 1 \(batch\): FCFS; strict priority/.test(G.paramsText(xs[3])), 'a multilevel queue in words');
  t.ok(/3 levels; quanta 2, 4, 8 ticks/.test(G.paramsText({ policy: 'mlfq', params: { levels: 3, quantum: [2, 4, 8], boost: 12 } })), 'an MLFQ in words');
}

// ---- the code kind's samples: granularity, the set of outputs, properties and starvation ----
{
  const code = K.kinds.code, xs = code.examples();
  t.eq(xs.length, 3, 'the code kind has three samples');
  for (const x of xs) {
    t.eq(code.lint(x), [], x.id + ' lints clean');
    const r = K.answer(x, x.solution);
    t.ok(r.ok, x.id + ' solution passes: ' + r.message);
    for (const w of x.wrong) t.ok(!K.answer(x, w).ok, x.id + ' wrong answer fails');
  }
  const race = xs[1], gate = xs[2];
  // independently: with whole statements an increment cannot be split, so only 4; with loads and stores, a thread
  // can load 0 and store 1 over the other's two increments, so 2 and 3 appear too, and never more than 4 or less than 2
  const st = K.os.allOutputs(Object.assign({}, race, { granularity: 'statement' }), race.wrong[0]);
  t.eq(st.outs, ['hits = 4'], 'at statement granularity the unlocked tally always gives 4');
  const mach = K.os.allOutputs(race, race.wrong[0]);
  t.eq(mach.outs.slice().sort(), ['hits = 2', 'hits = 3', 'hits = 4'], 'at machine granularity it gives 2, 3 or 4');
  const rr = K.answer(race, race.wrong[0]);
  t.ok(/some schedule prints "hits = [23]"/.test(rr.message), 'the race is named by an output it can print: ' + rr.message);
  const gr = K.answer(gate, gate.wrong[0]);
  t.ok(/^Not yet: V[01] can starve: .*cycle of \d+ steps/.test(gr.message), 'the starving thread is named: ' + gr.message);
  t.ok(gr.starved && gr.replay && gr.replay.schedule.length > gr.replay.cycleFrom && gr.replay.cycleLen > 0, 'with a lasso to replay');
  t.ok(!/did not finish/.test(gr.message), 'not just a step limit');
  // with no properties the step limit is explained by who kept running
  const bare = Object.assign({}, gate, { spec: undefined });
  const br = K.answer(bare, gate.wrong[0]);
  t.ok(/did not finish in 20000 steps: thread 10[12] and thread 10[12] kept going round at line \d+/.test(br.message), 'a livelock without properties says who loops: ' + br.message);
  const sp = K.os.specCheck(Object.assign({}, gate, { spec: [{ kind: 'always', what: 'inside <= 1' }] }), gate.wrong[1]);
  t.ok(!sp.ok && /inside <= 1/.test(sp.why) && sp.replay, 'an "always" property names itself when it breaks: ' + sp.why);
  t.ok(code.lint(Object.assign({}, gate, { spec: [{ kind: 'often', what: 'x' }] })).length > 0, 'a bad spec kind is linted');
  t.ok(code.lint(Object.assign({}, gate, { spec: [{ kind: 'live', what: 'visitor calls nowhere' }] })).some((p) => /no function nowhere/.test(p)), 'a property naming no function is linted');
}
t.done();
