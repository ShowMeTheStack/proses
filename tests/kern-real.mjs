// The kernel against the real thing: every program in tests/c/kern (pipes, dup2 redirection, exec of built-ins,
// signals, threads, files) is compiled with the system cc in a scratch directory and run many times, through a
// pipe and on a pseudo-terminal; every output a real run prints must be one the simulated kernel enumerates over
// all schedules. Each program's enumeration must also be complete (no state limit reached).
import { load, harness } from './load.mjs';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const t = harness('kern-real');
const S = load(['core']);
const K = S.Kern;
const kdir = join(dirname(fileURLToPath(import.meta.url)), 'c', 'kern');
const memo = new Map();
const outs = (src, o) => {
  const k = JSON.stringify([src, o]);
  if (!memo.has(k)) { const r = K.outcomes(src, o); t.ok(r.complete, 'the enumeration is complete (' + r.states + ' states)'); memo.set(k, new Set(r.outputs.keys())); }
  return memo.get(k);
};
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
  if (!have('cc')) { console.log('kern-real: no system cc, the real-program check is skipped'); return; }
  const tty = have('python3') && existsSync('/usr/bin/pgrep');
  const dir = mkdtempSync(join(tmpdir(), 'proses-c-'));
  try {
    const jobs = [];
    const progs = readdirSync(kdir).filter((x) => x.endsWith('.c')).map((f) => [f, readFileSync(join(kdir, f), 'utf8')]);
    for (const [f, src] of progs) {
      const bin = join(dir, f.slice(0, -2));
      writeFileSync(bin + '.c', src);
      execFileSync('cc', ['-std=c99', '-w', '-o', bin, bin + '.c', '-lpthread']);
      const slow = /sleep\s*\(|alarm\s*\(/.test(src);
      // machine granularity: a race inside count++ is one of the schedules
      const sets = { pipe: outs(src, { tty: false, granularity: 'machine' }), tty: outs(src, { tty: true, granularity: 'machine' }) };
      // a program that orders itself with sleep: what a run with real timing prints is narrower still
      if (/^sleep-/.test(f)) for (const m of ['pipe', 'tty']) { const timed = outs(src, { tty: m === 'tty', sleep: 'timed' }); t.ok(timed.size < sets[m].size, f + ' (' + m + '): timed enumeration narrows ' + sets[m].size + ' outputs to ' + timed.size); sets[m] = timed; }
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
    if (!tty) console.log('kern-real: no python3 or pgrep, the terminal runs are skipped');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
await real();
t.done();
