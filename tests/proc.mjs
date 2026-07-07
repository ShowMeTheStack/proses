// The C subset and the simulated kernel. Hand-worked cases for the front end and for fork, exit, wait, zombies,
// orphans and stdio buffering; an independent model of fork counting; and the real thing: every program in
// tests/c is compiled with the system cc in a scratch directory and run many times, through a pipe and on a
// pseudo-terminal, and every output it prints must be one the interpreter enumerates over all schedules.
import { load, harness } from './load.mjs';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const t = harness('proc');
const S = load(['core']);
const { CLang: C, Kern: K } = S;
const here = dirname(fileURLToPath(import.meta.url)), cdir = join(here, 'c');
const prog = (name) => readFileSync(join(cdir, name + '.c'), 'utf8');
const memo = new Map();
const outs = (src, o) => { const k = JSON.stringify([src, o]); if (!memo.has(k)) memo.set(k, new Set(K.outcomes(src, o).outputs.keys())); return memo.get(k); };
const same = (set, list, msg) => t.eq([...set].sort(), list.slice().sort(), msg);
const run = (src, o) => K.run(src, o);

// ---- the front end ------------------------------------------------------------------------------------------
const err = (src) => { try { C.compile(src); return null; } catch (e) { return e instanceof C.CError ? e : String(e); } };
t.eq(C.preprocess('#define N 3\n#define SQ(x) ((x) * (x))\nint a = SQ(N + 1);').text.split('\n')[2].replace(/\s+/g, ''), 'inta=((3+1)*(3+1));', 'function-like macros substitute their arguments as written, as cc does');
t.eq(C.preprocess('#ifdef NOPE\nint x;\n#else\nint y;\n#endif').text.trim(), 'int y;', '#ifdef and #else');
t.eq(C.lex('x >>= 0x1F; "a\\n" \'\\0\'').map((k) => k.v), ['x', '>>=', 31, ';', 'a\n', 0, ''], 'the lexer reads operators, hex, strings and escapes');
t.eq(err('int main(void) {\n  int x = 1;\n  y = 2;\n  return 0;\n}').line, 3, 'an undeclared name is reported on its line');
t.eq([err('int main(void) {\n  int x = 1\n  return x;\n}').line, err('int main(void) {\n  int x = 1\n  return x;\n}').col], [2, 12], "a missing ';' is reported where it belongs, just after the last token");
t.ok(/no function named frok/.test(err('int main(void) { frok(); return 0; }').message), 'an unknown function is named');
t.ok(/takes 1 argument/.test(err('int main(void) { exit(); }').message), 'a call with the wrong count is reported');
t.ok(/struct/.test(err('int main(void) { int a; a.b = 1; return 0; }').message), '. on a non-struct says it needs a struct');
t.ok(/bit-fields are not in the subset/.test(err('struct s { int a : 2; };\nint main(void) { return 0; }').message), 'what is outside the subset says so');
const p0 = C.compile('int g;\nint main(void) {\n  g = 1;\n  g = g + 1;\n  return g;\n}');
t.eq(p0.code.filter((i) => i[0] === 'stmt').map((i) => i[1]), [3, 4, 5], 'one statement mark a statement, with its line');

// ---- plain C, hand-worked ---------------------------------------------------------------------------------------
t.eq(run(prog('plain-c')).out, 'sum 23, fib 6765, ssecorp\n[   42] [42   ] [00042] [ff] [FF] [10] [+7]\n4294967295 -56 -3 -1\n1099511627776 ok str abc|    ab|\n3 4 45 24\n', 'pointers, arrays, strings, recursion and formats');
t.eq(run('int main(void) { int *p = 0; return *p; }').trace.find((e) => e.kind === 'error').line, 1, 'a NULL dereference is caught');
t.eq(run('int main(void) { int x = 5; return x / (x - 5); }').procs.find((p) => p.pid === 100).status, 8, 'division by zero kills the process with SIGFPE');

// ---- fork, hand-worked -----------------------------------------------------------------------------------------
same(outs(prog('fork-basic')), ['child: x = 15\nparent: x = 10, child exited with 7\n'], 'fork-basic: the child changes its own copy; wait gives its code');
same(outs(prog('own-memory')), ['child: 42 work\nparent: 0 fork\n'], 'own-memory: globals and arrays are copied, not shared');
same(outs(prog('fork-loop')), ['0 1 2', '0 2 1', '1 0 2', '1 2 0', '2 0 1', '2 1 0'].map((o) => o.split(' ').map((i) => 'child ' + i + '\n').join('') + 'parent reaped 3\n'), 'fork-loop: the three children in any order, the parent last');
same(outs(prog('exit-lost')), ['ab\n'], '_exit throws the child\'s copy of the buffer away');
// fork counts: every process that exists runs each later fork
const three = run(prog('fork-three'));
t.eq(three.procs.filter((p) => p.role === 'prog').length, 8, 'fork(); fork(); fork(); makes 8 processes');
t.eq(three.trace.filter((e) => e.kind === 'fork').length, 7, '... by 7 forks');
t.eq(three.out, 'hello\n'.repeat(8), '... and each prints once');
t.ok(three.procs.every((p) => p.role !== 'prog' || p.state === 'reaped'), '... and all are reaped in the end');
same(outs(prog('fork-three')), ['hello\n'.repeat(8)], 'every schedule of fork-three prints 8 lines');
same(outs(prog('fork-logic')), ['+\n'.repeat(5)], 'fork() && fork() || fork() makes 5 processes');

// an independent model: the number of processes a sequence of fork expressions makes, by short-circuit rules,
// with each process followed by hand (no interpreter involved)
function model(exprs) {
  // an expression: 'f' (a fork), ['&&', a, b], ['||', a, b]; it returns [value, processes] per process
  const ev = (e) => {
    if (e === 'f') return [[1, 'parent'], [0, 'child']];
    const out = [];
    for (const [v, who] of ev(e[1])) {
      if ((e[0] === '&&' && !v) || (e[0] === '||' && v)) { out.push([v ? 1 : 0, who]); continue; }
      for (const [w, who2] of ev(e[2])) out.push([w ? 1 : 0, who + '/' + who2]);
    }
    return out;
  };
  let n = 1;
  for (const e of exprs) n *= ev(e).length;
  return n;
}
const CASES = [
  ['fork(); fork(); fork();', ['f', 'f', 'f']],
  ['fork() && fork() || fork();', [['||', ['&&', 'f', 'f'], 'f']]],
  ['fork() && (fork() || fork());', [['&&', 'f', ['||', 'f', 'f']]]],
  ['fork() || fork(); fork();', [['||', 'f', 'f'], 'f']],
  ['fork() && fork() && fork();', [['&&', ['&&', 'f', 'f'], 'f']]],
];
for (const [code, m] of CASES) {
  const want = model(m);
  for (const seed of [1, 2, 3]) {
    const sys = run('#include <stdio.h>\nint main(void) {\n  ' + code + '\n  printf("+\\n");\n  return 0;\n}', { policy: 'random', seed });
    t.eq(sys.procs.filter((p) => p.role === 'prog').length, want, code + ' (seed ' + seed + '): ' + want + ' processes');
    t.eq(sys.out, '+\n'.repeat(want), code + ' (seed ' + seed + '): one line each');
  }
}

// ---- stdio buffering across fork --------------------------------------------------------------------------------
same(outs(prog('fork-dup')), ['start end\nstart end\n'], 'printf without a newline before fork prints twice');
same(outs(prog('fork-dup'), { tty: false }), ['start end\nstart end\n'], '... through a pipe too');
same(outs(prog('fork-dup-nl')), ['begin\nafter\nafter\n'], 'on a terminal the newline flushes before fork: begin prints once');
same(outs(prog('fork-dup-nl'), { tty: false }), ['begin\nafter\nbegin\nafter\n'], 'through a pipe the buffer is copied: begin prints twice');
const dup = run(prog('fork-dup'));
const fk = dup.trace.find((e) => e.kind === 'fork');
t.eq(fk.buf, 'start ', 'the fork event carries the copied buffer');
t.ok(/start/.test(fk.say) && /copied/.test(fk.say), 'and says so');
t.eq(dup.trace.filter((e) => e.kind === 'buffer').length, 1, 'printf("start ") only buffers');
t.eq(dup.term.map((w) => w.text), ['start end\n', 'start end\n'], 'each process writes its whole line at its newline');

// ---- zombies and orphans --------------------------------------------------------------------------------------
for (const seed of [1, 2, 3, 4, 5]) {
  const z = run(prog('zombie'), { policy: 'random', seed });
  const kid = z.procs.find((p) => p.pid === 101), at = (k, pid) => z.trace.findIndex((e) => e.kind === k && e.pid === pid);
  t.ok(at('zombie', 101) >= 0 && at('zombie', 101) < at('wait', 100), 'seed ' + seed + ': the kid is a zombie before the parent waits');
  t.eq([kid.state, kid.reapedBy, kid.exitCode], ['reaped', 100, 4], 'seed ' + seed + ': the parent reaps it, code 4');
  t.eq(z.out, 'kid: done\nparent: reaped the kid: 1, code 4\n', 'seed ' + seed + ': zombie output');
  const o = run(prog('orphan'), { policy: 'random', seed });
  const re = o.trace.find((e) => e.kind === 'reparent');
  t.eq([re && re.pid, re && re.from, re && re.to], [101, 100, 1], 'seed ' + seed + ': the orphan is re-parented from 100 to init');
  t.eq(o.trace.find((e) => e.kind === 'reap' && e.pid === 101).by, 1, 'seed ' + seed + ': init reaps the orphan');
  t.eq(o.trace.find((e) => e.kind === 'reap' && e.pid === 100).by, 2, 'seed ' + seed + ': the shell reaps the parent');
  t.eq(o.out, 'parent: leaving\norphan: my parent is init: 1\n', 'seed ' + seed + ': orphan output with real timing');
}
same(outs(prog('orphan')), ['parent: leaving\norphan: my parent is init: 1\n', 'parent: leaving\norphan: my parent is init: 0\n', 'orphan: my parent is init: 0\nparent: leaving\n'], 'orphan: every order, with sleep only a yield');
// waitpid with WNOHANG, and wait with no children
t.eq(run('#include <stdio.h>\n#include <sys/wait.h>\nint main(void) { int r = waitpid(-1, 0, WNOHANG); int s = wait(0); printf("%d %d\\n", r, s); return 0; }').out, '-1 -1\n', 'no children: -1');
t.eq(run('#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\nint main(void) { int k = fork(); if (k == 0) { sleep(1); exit(2); } int r = waitpid(k, 0, WNOHANG); int st; waitpid(k, &st, 0); printf("%d %d\\n", r, WEXITSTATUS(st)); return 0; }').out, '0 2\n', 'WNOHANG returns 0 while the child runs');

// ---- the scheduler hook ---------------------------------------------------------------------------------------
const trace = (o) => JSON.stringify(run(prog('fork-loop'), o).trace);
t.eq(trace({ policy: 'random', seed: 9 }), trace({ policy: 'random', seed: 9 }), 'same seed, same trace');
const ab = '#include <stdio.h>\n#include <unistd.h>\nint main(void) {\n  if (fork() == 0) printf("a\\n"); else printf("b\\n");\n  return 0;\n}';
t.eq([...new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => run(ab, { policy: 'random', seed }).out))].sort(), ['a\nb\n', 'b\na\n'], 'different seeds, different orders');
const byHand = run(prog('fork-basic'), { policy: 'hand', choose: (pids) => Math.max(...pids) });
t.eq(byHand.trace.filter((e) => e.kind === 'print').map((e) => e.pid), [101, 100], 'a hand-picked schedule (newest first)');
for (const name of readdirSync(cdir).filter((f) => f.endsWith('.c')).map((f) => f.slice(0, -2))) {
  const all = outs(prog(name));
  for (const o of [{ policy: 'fifo' }, { policy: 'rr' }, { policy: 'rr', quantum: 3 }, ...[1, 2, 3, 4, 5, 6].map((seed) => ({ policy: 'random', seed }))]) {
    const got = run(prog(name), o).out;
    t.ok(all.has(got), name + ' under ' + JSON.stringify(o) + ': the run is one of the enumerated outputs');
  }
}

// ---- the scene: its story holds on every seed, and its frames build at both widths ---------------------------
const SC = load(['core', 'stage', 'demo']).Demo.byId('fork-tree');
for (let seed = 1; seed <= 12; seed++) {
  const tr = SC.trace({ p: 0, seed }), at = (k, pid) => tr.findIndex((e) => e.kind === k && e.pid === pid);
  t.ok(at('zombie', 101) >= 0 && at('zombie', 101) < at('wait', 100), 'scene seed ' + seed + ': A is a zombie before P waits');
  t.ok(at('zombie', 100) < at('reparent', 102), 'scene seed ' + seed + ': P exits, then B is re-parented');
  t.eq(tr.find((e) => e.kind === 'reap' && e.pid === 102).by, 1, 'scene seed ' + seed + ': init reaps B');
  for (let p = 0; p < SC.presets.length; p++) for (const narrow of [false, true]) {
    const fr = SC.frames({ narrow, knobs: { p, seed } });
    t.ok(fr.length > 5 && fr.every((f) => f.say && !/undefined|NaN/.test(f.say) && new Set(f.items.map((i) => i.key)).size === f.items.length), 'scene preset ' + p + ' seed ' + seed + (narrow ? ' narrow' : '') + ': frames build');
  }
}

// ---- the real thing: cc, run many times ------------------------------------------------------------------------
const PTY = `import os, pty, subprocess, sys, time
pid, fd = pty.fork()
if pid == 0:
    subprocess.run(sys.argv[1:])
    me = os.getpid()
    for _ in range(500):
        r = subprocess.run(['pgrep', '-g', str(os.getpgid(0))], capture_output=True, text=True)
        if not [p for p in r.stdout.split() if int(p) != me]:
            break
        time.sleep(0.01)
    os._exit(0)
out = b''
while True:
    try:
        b = os.read(fd, 4096)
    except OSError:
        break
    if not b:
        break
    out += b
os.waitpid(pid, 0)
sys.stdout.buffer.write(out.replace(b'\\r\\n', b'\\n'))
`;
const have = (cmd) => { try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
/** one real run, in a directory of its own (a program may create files): {out, code, signal, timedOut, err};
 *  killed after ms */
function runIn(cmd, args, ms) {
  const cwd = mkdtempSync(join(tmpdir(), 'proses-run-'));
  return new Promise((res) => {
    let o = '', e = '', timedOut = false, done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); rmSync(cwd, { recursive: true, force: true }); res(Object.assign({ out: o, err: e.trim().split('\n').pop() || '' }, r)); };
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    const timer = setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch (x) { /* gone */ } }, ms);
    p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (e += d));
    p.on('error', (x) => finish({ code: null, signal: null, timedOut, err: x.message }));
    p.on('close', (code, signal) => finish({ code, signal, timedOut }));
  });
}
/** a run that did not run properly (timed out, killed, failed to start or exited non-zero, or printed nothing where
 *  every enumerated output has text) is tried again with more time; only a run that ran properly can mismatch.
 *  -> {out, why} (why: how the last try went wrong, when all of them did) */
async function exec(cmd, args, wantOutput, slow) {
  let r, why = '';
  for (const ms of slow ? [15000, 30000, 60000] : [5000, 15000, 40000]) {
    r = await runIn(cmd, args, ms);
    why = r.timedOut ? 'timed out after ' + ms / 1000 + ' s' : r.signal ? 'was killed by ' + r.signal : r.code === null ? 'failed to start' + (r.err ? ' (' + r.err + ')' : '') : r.code ? 'exited with ' + r.code + (r.err ? ' (' + r.err + ')' : '') : wantOutput && r.out === '' ? 'printed nothing' : '';
    if (!why) return { out: r.out, why: '' };
  }
  return { out: r.out, why };
}
async function real() {
  if (!have('cc')) { console.log('proc: no system cc, the real-program check is skipped'); return; }
  const tty = have('python3') && existsSync('/usr/bin/pgrep');
  const dir = mkdtempSync(join(tmpdir(), 'proses-c-'));
  try {
    const jobs = [];
    const progs = readdirSync(cdir).filter((x) => x.endsWith('.c')).map((f) => [f, readFileSync(join(cdir, f), 'utf8')]);
    // the scene's programs too, but not one that prints its own pid: a real machine's pids are its own
    SC.presets.forEach((pr, i) => { if (!/getpid\s*\(/.test(pr.src)) progs.push(['scene-' + i + '.c', pr.src]); });
    for (const [f, src] of progs) {
      const bin = join(dir, f.slice(0, -2));
      writeFileSync(bin + '.c', src);
      execFileSync('cc', ['-std=c99', '-w', '-o', bin, bin + '.c']);
      const slow = /sleep\s*\(/.test(src);
      const sets = { pipe: outs(src, { tty: false }), tty: outs(src) };
      for (let i = 0; i < (slow ? 3 : 25); i++) {
        jobs.push(() => exec(bin, [], !sets.pipe.has(''), slow).then((r) => [f, 'pipe', r, sets.pipe]));
        if (tty && i < (slow ? 2 : 8)) jobs.push(() => exec('python3', ['-I', '-c', PTY, bin], !sets.tty.has(''), slow).then((r) => [f, 'tty', r, sets.tty]));
      }
    }
    const seen = {};
    let k = 0;
    const worker = async () => { while (k < jobs.length) { const [f, mode, r, set] = await jobs[k++](); const key = f + ' ' + mode; seen[key] = seen[key] || new Set(); seen[key].add(r.out); t.ok(!r.why && set.has(r.out), f + ' (' + mode + '): ' + (r.why ? 'the real run never ran properly: its last try ' + r.why + ', after three tries' : 'the real output ' + JSON.stringify(r.out) + ' is enumerated')); } };
    await Promise.all(Array.from({ length: 4 }, worker));
    t.ok(Object.keys(seen).length >= progs.length, 'every program ran for real');
    if (!tty) console.log('proc: no python3 or pgrep, the terminal runs are skipped');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
await real();
t.done();
