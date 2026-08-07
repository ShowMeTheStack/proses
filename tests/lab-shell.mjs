// The Shell lab in node: the skeleton compiles and runs; the reference shell passes every job-control test under
// several schedules, and shells with a known gap fail the tests about that gap (and only fail for a reason); each
// sample session and typed lines give well-formed frames whose terminal is the kernel's output, whose groups are
// the kernel's process groups, and whose pipes are the kernel's pipes; the same seed gives the same run.
import { files, harness } from './load.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-process-[a-z]|lab-shell-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
S.UI = S.UI || { storage: { get: (k, d) => d, set() {} } };
const t = harness('lab-shell');
const SL = S.ShellLab, LS = S.LabSetup, lab = S.Labs.get('shell');
t.ok(!!lab, 'the Shell lab registers');
t.ok(LS.check(lab, LS.defaults(lab)) === null, 'the defaults are a valid setup');

// the tests: the reference passes all of them; the skeleton none
for (const tc of SL.TESTS) {
  const r = SL.runTest(SL.REFERENCE, tc);
  t.ok(r.pass, 'the reference passes "' + tc.name + '"' + (r.pass ? '' : ': ' + r.why));
  const s = SL.runTest(SL.SKELETON, tc);
  t.ok(!s.pass && s.why, 'the skeleton fails "' + tc.name + '" with a reason');
}
// shells with one gap each fail the tests about it
const gaps = [
  ['no process groups', (src) => src.replace('    setpgid(0, pgid);\n', '').replace('        setpgid(k, j->pgid);\n', '').replace('    tcsetpgrp(0, j->pgid);\n', ''), ['^C reaches the foreground only']],
  ['no SIGCHLD handler', (src) => src.replace('    signal(SIGCHLD, on_child);\n', '    signal(SIGCHLD, on_child);\n    signal(SIGCHLD, SIG_DFL);\n').replace('    while (alive(j) > 0 && !j->stopped)\n        sigsuspend(old);', '    for (int i = 0; i < j->n; i++) if (j->pids[i]) { waitpid(j->pids[i], NULL, 0); j->pids[i] = 0; }'), ['SIGCHLD reaps at once', 'no zombies left']],
  ['a pipe end left open', (src) => src.replace('            close(fd[1]);\n            in = fd[0];', '            in = fd[0];'), ['a pipe', 'three in a pipeline']],
  ['no wait at end of input', (src) => src.replace('    for (int j = 0; j < MAXJOBS; j++)\n        while (alive(&jobs[j]))\n            sigsuspend(&old);\n', ''), ['no zombies left']],
];
for (const [name, edit, fails] of gaps) {
  const src = edit(SL.REFERENCE);
  t.ok(src !== SL.REFERENCE, name + ': the edit applies');
  for (const tc of SL.TESTS.filter((x) => fails.includes(x.name))) {
    const r = SL.runTest(src, tc);
    t.ok(!r.pass, name + ': fails "' + tc.name + '"' + (r.pass ? '' : ' (' + r.why + ')'));
  }
}

// frames: each session, with the skeleton and the reference
function check(v, seed, narrow, what) {
  const r = lab.run(LS.merge(lab, v), { seed, narrow });
  t.ok(!r.error, what + ': runs');
  if (r.error) return r;
  t.ok(r.frames.length > 2, what + ': has frames (' + r.frames.length + ')');
  const run = r.shell;
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 8, what + ': frame ' + i + ' says something');
    for (const it of f.items) if (it.kind === 'text' || it.kind === 'cell') { const s = it.text === undefined ? (it.lines || []).join(' ') : String(it.text); if (/undefined|NaN|\[object/.test(s)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '"'); break; } }
    // the groups drawn are the kernel's process groups at that beat
    const b = run.beats[i];
    const drawn = f.items.filter((it) => /^jg:\d+$/.test(it.key)).map((it) => +it.key.slice(3));
    const real = [...new Set(b.snap.filter((p) => p.role === 'prog' && p.pid !== 100 && p.state !== 'reaped').map((p) => p.pgid))];
    t.ok(drawn.every((g) => real.includes(g)), what + ': frame ' + i + ' draws only real groups');
    const pipes = f.items.filter((it) => /^jpp\d+:n$/.test(it.key)).map((it) => +it.key.slice(3, -2));
    t.ok(pipes.every((id) => b.ks.pipes[id]), what + ': frame ' + i + ' draws only real pipes');
  });
  const out = run.sys.term.map((w) => w.text).join('');
  t.eq(run.sys.out, out, what + ': the terminal holds everything the kernel wrote');
  return r;
}
for (const id of Object.keys(SL.SESSIONS)) {
  for (const src of [SL.SKELETON, SL.REFERENCE]) {
    const v = { src, session: id };
    const a = check(v, 1, false, id + (src === SL.REFERENCE ? ' (reference)' : ' (skeleton)'));
    check(v, 1, true, id + ' narrow');
    const b = lab.run(LS.merge(lab, v), { seed: 1, narrow: false });
    t.eq(b.frames.map((f) => f.say), a.frames.map((f) => f.say), id + ': the same seed gives the same run');
  }
}
const ref = (session, extra) => lab.run(LS.merge(lab, Object.assign({ src: SL.REFERENCE, session }, extra || {})), { seed: 2 }).shell;
t.eq(ref('pipes').sys.out, '       1       2      12\napple\nbanana\napple\nbanana\nfig\npear\n', 'the pipes session prints what a shell would');
t.ok(ref('jobs').sys.out === 'still here\n' && ref('jobs').sys.trace.some((e) => e.kind === 'exit' && /SIGINT/.test(e.say)), '^C kills the foreground sleep and the shell reads on');
t.ok(ref('stop').sys.trace.some((e) => e.kind === 'stop') && ref('stop').sys.trace.some((e) => e.kind === 'cont'), '^Z stops the job and fg continues it');
t.eq(ref('yes').sys.out, 'y\ny\ny\n', 'yes | head -n 3 prints three lines');
t.ok(ref('yes').sys.trace.some((e) => e.kind === 'exit' && /SIGPIPE/.test(e.say)), 'yes is ended by SIGPIPE');
for (const cap of [16, 64, 4096]) check({ src: SL.REFERENCE, session: 'yes', cap }, 3, false, 'yes with a ' + cap + '-byte pipe');
for (const show of ['fds', 'signals']) check({ src: SL.REFERENCE, session: 'pipes', show }, 1, false, 'the ' + show + ' view');
check({ src: SL.REFERENCE, session: 'mine', lines: [{ type: 'ls', key: '' }, { type: 'cat fruit.txt | wc', key: '' }, { type: 'sleep 3', key: 'Z' }, { type: 'fg', key: 'C' }] }, 5, false, 'typed lines');
const bad = lab.run(LS.merge(lab, { src: 'int main(void) { return 0 }' }), { seed: 1 });
t.ok(bad.error && bad.error.line === 1, 'a shell that does not compile reports its line');
// the reference shell compiled with the system cc and given the same lines on its stdin: for every test that presses
// no key, the real output is the one the test expects (and the simulated kernel prints)
const have = (cmd) => { try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
if (have('cc')) {
  const dir = mkdtempSync(join(tmpdir(), 'proses-shc-'));
  try {
    const bin = join(dir, 'refsh');
    writeFileSync(bin + '.c', SL.REFERENCE);
    execFileSync('cc', ['-std=c99', '-w', '-o', bin, bin + '.c']);
    // one real run, killed after ms: {out, why} where why says what went wrong with the run itself
    const runOnce = (tc, ms) => new Promise((res) => {
      const cwd = mkdtempSync(join(tmpdir(), 'proses-shr-'));
      for (const [n, d] of Object.entries(tc.files || {})) writeFileSync(join(cwd, n), d);
      let o = '', done = false, timedOut = false;
      const p = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
      const timer = setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch (x) { /* gone */ } }, ms);
      const finish = (why) => { if (done) return; done = true; clearTimeout(timer); rmSync(cwd, { recursive: true, force: true }); res({ out: o, why }); };
      p.stdout.on('data', (d) => (o += d));
      p.on('error', (x) => finish('could not start (' + x.message + ')'));
      p.on('close', (code, signal) => finish(timedOut ? 'timed out after ' + ms / 1000 + ' s' : signal ? 'was killed by ' + signal : code ? 'exited with ' + code : ''));
      p.stdin.on('error', () => {});
      p.stdin.end(tc.lines.map((l) => l.type + '\n').join(''));
    });
    // a run that did not run properly (or printed nothing where output is due) is tried again with more time
    const runReal = async (tc, want) => {
      let r;
      for (const ms of [10000, 30000, 60000]) { r = await runOnce(tc, ms); if (!r.why && !(want && r.out === '')) return r; if (!r.why) r.why = 'printed nothing'; }
      return r;
    };
    for (const tc of SL.TESTS.filter((x) => !x.lines.some((l) => l.key))) {
      const r = await runReal(tc, !!tc.expect);
      if (r.why) t.ok(false, 'the real reference shell on "' + tc.name + '" never ran properly: it ' + r.why + ', three times');
      else if (tc.expect !== undefined) t.eq(r.out, tc.expect, 'the real reference shell on "' + tc.name + '"');
    }
    const yes = await runReal({ lines: [{ type: 'yes | head -n 3' }] }, true);
    if (yes.why) t.ok(false, 'the real reference shell on yes | head never ran properly: it ' + yes.why); else t.eq(yes.out, 'y\ny\ny\n', 'the real reference shell runs yes | head -n 3');
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else console.log('lab-shell: no system cc, the real-shell check is skipped');
t.done();
