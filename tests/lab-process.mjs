// The Process lab in node: every preset and a few typed programs run through the lab's run() under each policy;
// the frames are well formed (items with keys, a sentence each, process tags on real lines), the numbers they show
// come from the kernel (the terminal is the kernel's output, the tree's processes are its processes), the same seed
// gives the same frames, a schedule picked by hand replays, and every output the lab lists replays to that output
// and matches the kernel's own enumeration.
import { files, harness } from './load.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-process-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
S.UI = S.UI || { storage: { get: (k, d) => d, set() {} } };
const t = harness('lab-process');
const PL = S.ProcLab, lab = S.Labs.get('process');
t.ok(!!lab, 'the Process lab registers');
const LS = S.LabSetup;
const defs = LS.defaults(lab);
t.ok(LS.check(lab, defs) === null, 'the defaults are a valid setup');

/** every frame well formed, its numbers the kernel's */
function frames(v, seed, narrow, what) {
  const r = lab.run(LS.merge(lab, v), { seed, narrow });
  t.ok(!r.error, what + ': runs (' + (r.error && (r.error.msg || r.error.message)) + ')');
  if (r.error) return r;
  t.ok(r.frames.length >= 2, what + ': has frames (' + r.frames.length + ')');
  const lines = v.src.split('\n').length;
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' has a duplicate or missing key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 10, what + ': frame ' + i + ' says something');
    for (const m of f.marks || []) t.ok(m.line >= 1 && m.line <= lines, what + ': frame ' + i + ' tags a real line (' + m.line + ')');
    t.ok(f.at >= 0 && f.at <= r.trace.length, what + ': frame ' + i + ' points into the trace');
    for (const it of f.items) if (it.kind === 'text' || it.kind === 'cell') { const s = it.text === undefined ? (it.lines || []).join(' ') : String(it.text); if (/undefined|NaN|\[object/.test(s)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '"'); break; } }
  });
  // the terminal rows on the last frame are the kernel's output
  const res = r.proc, out = res.sys.term.map((w) => w.text).join('');
  const shown = r.frames[r.frames.length - 1].items.filter((it) => /^tm:r\d+$/.test(it.key)).map((it) => it.text);
  const real = out.split('\n').filter(Boolean);
  t.eq(shown, real.slice(-shown.length), what + ': the terminal shows the kernel\'s last lines');
  // the tree's processes are the kernel's
  const last = r.frames[r.frames.length - 1].items.filter((it) => /^tr:n\d+$/.test(it.key)).map((it) => +it.key.slice(4)).sort((a, b) => a - b);
  const lastSnap = res.beats[res.beats.length - 1].snap.map((p) => p.pid).sort((a, b) => a - b);
  t.ok(last.every((pid) => lastSnap.includes(pid)), what + ': the tree draws only the kernel\'s processes');
  return r;
}

for (const p of lab.setup.presets) {
  t.ok(LS.check(lab, LS.merge(lab, Object.assign({}, defs, p.values))) === null, p.label + ': the preset is a valid setup (' + LS.check(lab, LS.merge(lab, Object.assign({}, defs, p.values))) + ')');
  const r1 = frames(p.values, 1, false, p.label);
  frames(p.values, 1, true, p.label + ' (narrow)');
  const r2 = lab.run(LS.merge(lab, p.values), { seed: 1, narrow: false });
  t.eq(r2.frames.map((f) => f.say), r1.frames.map((f) => f.say), p.label + ': the same seed gives the same run');
  for (const policy of ['fifo', 'rr', 'random']) {
    const v = Object.assign({}, p.values, { policy });
    const r = lab.run(LS.merge(lab, v), { seed: 7, narrow: false });
    const sys = S.Kern.run(p.values.src, { tty: v.tty !== false, files: PL.filesOf(defs.files), policy, quantum: 2, seed: 7, granularity: v.gran, shell: false });
    t.eq(r.proc.sys.out, sys.out, p.label + ' under ' + policy + ': the lab prints what the kernel prints');
  }
}

// by hand: click the first choice until the end; the choices replay
for (const p of lab.setup.presets.slice(0, 6)) {
  let v = LS.merge(lab, Object.assign({}, p.values, { policy: 'hand', sched: '' }));
  let r;
  for (let n = 0; n < 60; n++) {
    r = lab.run(v, { seed: 1, narrow: false });
    if (!r.proc.waiting) break;
    const w = r.proc.waiting;
    t.ok(r.frames[r.frames.length - 1].items.some((it) => it.key === 'pick:' + w[0]), p.label + ': the choices can be clicked');
    v = Object.assign({}, v, { sched: PL.schedText(PL.parseSched(v.sched).concat(w[w.length - 1])) });
  }
  t.ok(r && !r.proc.waiting, p.label + ': clicking the last choice each time finishes');
  const again = lab.run(v, { seed: 99, narrow: false });
  t.eq(again.proc.sys.out, r.proc.sys.out, p.label + ': a schedule by hand replays the same, whatever the seed');
}

// every output: each listed output replays to itself, and the list is the kernel's enumeration
for (const p of lab.setup.presets) {
  const v = LS.merge(lab, p.values), o = PL.optsOf(v, 1);
  if (/fork-count/.test(p.label)) o.tty = false;
  const e = PL.every(v.src, o);
  const ref = S.Kern.outcomes(v.src, { tty: o.tty, files: o.files, granularity: o.gran, shell: false });
  t.eq(e.list.map((x) => x.out).sort(), [...ref.outputs.keys()].sort(), p.label + ': every output is the kernel\'s enumeration (' + e.list.length + ')');
  t.ok(e.complete, p.label + ': the search is complete (' + e.states + ' states)');
  for (const x of e.list) {
    const r = PL.run(v.src, Object.assign({}, o, { hand: true, sched: x.hangs && x.hangPath ? x.hangPath : x.sched }));
    t.ok(!r.waiting && !r.bad, p.label + ': the schedule for an output needs no more choices');
    t.eq(r.sys.out, x.out, p.label + ': its schedule replays to that output');
  }
}
const race = lab.setup.presets.find((p) => /race/.test(p.label));
t.eq(lab.run(LS.merge(lab, race.values), { seed: 1 }).proc.sys.out, 'count = 1\n', 'the race preset loses an increment');

// typed programs, and a compile error
const typed = [
  '#include <stdio.h>\n#include <unistd.h>\nint main(void) {\n    fork();\n    fork();\n    printf("hi from %d\\n", getpid());\n    return 0;\n}\n',
  '#include <stdio.h>\n#include <signal.h>\n#include <unistd.h>\nvoid h(int s) { printf("got %d\\n", s); }\nint main(void) {\n    signal(SIGUSR1, h);\n    raise(SIGUSR1);\n    kill(getpid(), SIGUSR1);\n    return 0;\n}\n',
];
for (const src of typed) for (const show of ['auto', 'procs', 'buffers', 'fds', 'pages', 'signals', 'threads']) frames({ src, show }, 3, false, 'typed program, ' + show);
const bad = lab.run(LS.merge(lab, { src: 'int main(void) { return 0 }' }), { seed: 1 });
t.ok(bad.error && bad.error.line === 1, 'a program that does not compile reports its line');
// every example against the real thing: compiled with the system cc and run, through a pipe and on a pseudo-terminal;
// each real output (pids written as P, since real pids differ) must be one the lab lists under "Every output"
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
const norm = (o) => o.replace(/\b\d{3,}\b/g, 'P');
/** one real run: {out, code, signal, timedOut, err}; killed after ms */
function runIn(files, cmd, args, ms) {
  const cwd = mkdtempSync(join(tmpdir(), 'proses-lab-'));
  for (const [n, d] of Object.entries(files)) writeFileSync(join(cwd, n), d);
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
/** a run that did not run properly (timed out, killed, failed, or silent where output is due) is tried again with
 *  more time; a mismatch counts only from a run that ran properly */
async function realRun(files, cmd, args, wantOutput, slow) {
  let r, why = '';
  for (const ms of slow ? [15000, 30000, 60000] : [5000, 15000, 40000]) {
    r = await runIn(files, cmd, args, ms);
    why = r.timedOut ? 'timed out after ' + ms / 1000 + ' s' : r.signal ? 'killed by ' + r.signal : r.code ? 'exited with ' + r.code + (r.err ? ' (' + r.err + ')' : '') : wantOutput && r.out === '' ? 'printed nothing' : '';
    if (!why) return { out: r.out, why: '' };
  }
  return { out: r.out, why };
}
if (have('cc')) {
  const dir = mkdtempSync(join(tmpdir(), 'proses-labc-'));
  const tty = have('python3');
  try {
    const jobs = [];
    for (const p of PL.PROGS) {
      const bin = join(dir, p.name.replace(/\W/g, '_'));
      writeFileSync(bin + '.c', p.src);
      execFileSync('cc', ['-std=c99', '-w', '-o', bin, bin + '.c', '-lpthread']);
      const slow = /sleep\s*\(/.test(p.src);
      for (const mode of tty ? ['pipe', 'tty'] : ['pipe']) {
        const o = { tty: mode === 'tty', files: PL.FILES, gran: 'machine', shell: false };
        const set = new Set(PL.every(p.src, o).list.map((x) => norm(x.out)));
        const want = !set.has('');
        for (let i = 0; i < (slow ? 2 : 8); i++) jobs.push(() => (mode === 'pipe' ? realRun(PL.FILES, bin, [], want, slow) : realRun(PL.FILES, 'python3', ['-I', '-c', PTY, bin], want, slow)).then((r) => t.ok(!r.why && set.has(norm(r.out)), p.name + ' (' + mode + '): ' + (r.why ? 'the real run never ran properly: it ' + r.why + ', three times' : 'the real output ' + JSON.stringify(r.out) + ' is one the lab lists'))));
      }
    }
    let k = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (k < jobs.length) await jobs[k++](); }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else console.log('lab-process: no system cc, the real-program check is skipped');
t.done();
