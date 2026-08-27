// Part 3 (inter-process communication and signals): every topic run with its default, every preset and random valid
// inputs, through the shared claims machinery of part 1 (wording, and every quoted number carried by the frame).
// Then each topic's values against a second computation: the C programs are compiled with the system compiler and
// run, and each real output must be one the simulated kernel can produce (S.Kern.outcomes); the IPC models are
// replayed by small independent models here; marshalled bytes are worked out by hand.
// Prints "claims-p03 N passed, M failed".
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runClaims } from './claims-p01.mjs';
import { load } from './load.mjs';

// ---- real programs ----
const dir = join(tmpdir(), 'proses-claims-p03');
mkdirSync(dir, { recursive: true });
let haveCc = true;
try { execFileSync('cc', ['--version'], { stdio: 'ignore' }); } catch (e) { haveCc = false; }
const realCache = new Map();
/** run the program with the system compiler: [outputs] (stdout is a pipe here), or null without a compiler */
export function real(src, o = {}) {
  if (!haveCc) return null;
  const key = createHash('sha1').update(src + JSON.stringify(o)).digest('hex').slice(0, 16);
  if (realCache.has(key)) return realCache.get(key);
  const work = join(dir, key);
  mkdirSync(work, { recursive: true });
  const bin = join(work, 'a.out');
  if (!existsSync(bin)) { writeFileSync(join(work, 'p.c'), src); execFileSync('cc', ['-w', '-o', bin, join(work, 'p.c')], { stdio: 'ignore' }); }
  for (const [n, t] of Object.entries(o.files || {})) writeFileSync(join(work, n), t);
  const outs = [];
  for (let k = 0; k < (o.runs || 4); k++) {
    for (const n of o.clean || []) rmSync(join(work, n), { force: true });
    const r = spawnSync(bin, o.argv || [], { cwd: work, input: o.input || '', timeout: o.timeout || 6000, encoding: 'utf8' });
    if (r.error) { outs.push(null); continue; }
    outs.push(r.stdout + (o.stderr ? r.stderr : ''));
  }
  realCache.set(key, outs);
  return outs;
}
let Sk = null;
const outcomes = (src, o) => { Sk = Sk || load(['core']); return Sk.Kern.outcomes(src, Object.assign({ tty: false, maxStates: 200000 }, o || {})); };
/** every real output is one the kernel can produce */
function realInSet(ctx, src, o, what) {
  const outs = real(src, o);
  if (!outs) return;
  const set = outcomes(src, o.kern || {});
  for (const x of outs) {
    if (x === null) { ctx.ok(false, what + ': the real program timed out'); continue; }
    ctx.ok(set.outputs.has(x), what + ': the real output ' + JSON.stringify(x) + ' is one the kernel can produce (' + set.outputs.size + ' known)');
  }
}

const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

export const P03 = {
  'p03-pipe': {
    constants: [4096],
    random: (rnd) => ({ prog: pick(rnd, ['basic', 'two', 'hang']), cap: pick(rnd, ['4', '8', '16', '4096']), sched: pick(rnd, ['fifo', 'rr']) }),
    check(ctx) {
      const { S, input, r, ok, near, frames } = ctx;
      const src = S.P03.PIPE_PROGS[input.prog].src;
      const reads = frames('read').map((f) => f.meta.evs[0].n), writes = r.frames.flatMap((f) => f.meta.evs.filter((e) => e.kind === 'write').map((e) => e.n));
      if (input.prog === 'hang') { ok(r.result.status === 'deadlock', 'the reader with a write end of its own hangs'); return; }
      const sent = input.prog === 'basic' ? 9 : 8;
      near(reads.reduce((a, b) => a + b, 0), sent, 'every byte written is read once');
      ok(reads[reads.length - 1] === 0, 'the last read is end of file');
      ok(reads.slice(0, -1).every((n) => n > 0 && n <= Math.min(+input.cap, input.prog === 'basic' ? 6 : 9)), 'no read returns more than the buffer or the pipe holds');
      if (input.prog === 'basic') ok(r.result.term.startsWith('[') && r.result.term.endsWith('read gave 0\n'), 'the terminal ends with end of file');
      if (input.prog === 'two') near(Number(/(\d+) bytes/.exec(r.result.term)[1]), 8, 'the total printed');
      if (input.cap === '4096' && input.sched === 'fifo') realInSet(ctx, src, {}, 'compiled');
      ok(writes.every((n) => n > 0), 'writes move bytes');
    },
  },
  'p03-fdtables': {
    check(ctx) {
      const { S, input, r, ok, frames } = ctx;
      // offsets worked out by hand: shared, the parent writes at the child's offset 6; separate, at its own 0
      const want = input.prog === 'shared' ? 'child\nparent\n' : 'parent\n';
      ok(r.result.term === want, 'cat prints ' + JSON.stringify(want) + ', got ' + JSON.stringify(r.result.term));
      const ws = frames('write').map((f) => f.meta.evs[0]);
      ok(ws.length === 2, 'two writes');
      const most = Math.max(...r.frames.map((f) => f.meta.ofiles.filter((o) => o.offset !== undefined).length));
      ok(most >= 1, 'the open-file table is carried');
      realInSet(ctx, S.P03.SHARE_PROGS[input.prog].src, { clean: ['log'] }, 'compiled');
    },
  },
  'p03-dup': {
    check(ctx) {
      const { S, input, r, ok, near } = ctx;
      if (input.prog === 'redirect') {
        const listing = Object.keys(S.P03.DUP_FILES).concat(['out']).sort().map((n) => n + '\n').join('');
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+) out\n$/.exec(r.result.term);
        ok(!!m, 'wc prints one line');
        if (m) near([+m[1], +m[2], +m[3]], [listing.split('\n').length - 1, listing.trim().split(/\s+/).length, listing.length], 'wc counts of the ls listing');
        return;
      }
      ok(r.result.term === (input.prog === 'lost' ? 'into the file\n' : 'back on screen\ninto the file\n'), 'the lines that reach the terminal: ' + JSON.stringify(r.result.term));
      realInSet(ctx, S.P03.DUP_PROGS[input.prog].src, { clean: ['out'] }, 'compiled');
    },
  },
  'p03-fifo': {
    random: (rnd) => ({ scene: pick(rnd, ['basic', 'small', 'epipe', 'nonblock']), cap: int(rnd, 2, 16), policy: pick(rnd, ['rr', 'random']), seed: int(rnd, 1, 20) }),
    check({ S, input, r, ok }) {
      // the rules, checked on every step: order kept, bounded buffer, end of file and SIGPIPE only when they may
      const sc = S.P03.FIFO[input.scene], written = sc.procs[0].ops.filter((o) => o.op === 'write').map((o) => o.data).join('');
      ok(written.startsWith(r.result.got.R), 'the reader gets a prefix of what was written, in order: ' + JSON.stringify(r.result.got.R));
      for (const f of r.frames) {
        const m = f.meta;
        ok(m.n <= input.cap, 'the buffer never holds more than its capacity');
        if (m.phase === 'eof') ok(m.n === 0 && m.writers === 0, 'end of file only when empty with no writer');
        if (m.phase === 'sigpipe') ok(m.readers === 0, 'SIGPIPE only with no reader');
      }
      if (input.scene === 'epipe' && input.policy === 'rr') ok(r.frames.some((f) => f.meta.phase === 'sigpipe'), 'the late write gets SIGPIPE');
      if (input.scene === 'nonblock') ok(r.frames.some((f) => f.meta.phase === 'error'), 'the non-blocking open fails');
    },
  },
  'p03-shm': {
    constants: [64],
    random: (rnd) => ({ size: int(rnd, 2, 8), n: int(rnd, 1, 7), quantum: int(rnd, 1, 5), policy: pick(rnd, ['rr', 'random']), seed: int(rnd, 1, 20) }),
    check({ input, r, near, ok }) {
      // replay the ring with the rules: in and out advance mod size, count = (in - out) mod size
      let inn = 0, out = 0, puts = 0, takes = 0;
      for (const f of r.frames) {
        const m = f.meta;
        if (m.phase === 'put') { inn = (inn + 1) % input.size; puts++; }
        if (m.phase === 'take') { out = (out + 1) % input.size; takes++; }
        near([m.in, m.out, m.count], [inn, out, (inn - out + input.size) % input.size], 'the indexes after ' + m.phase);
        ok(m.count <= input.size - 1, 'at most size - 1 items');
      }
      near([puts, takes], [input.n, input.n], 'every item goes in and out once');
      near(r.result.consumed.length, input.n, 'all consumed');
      near(r.result.cost.rows[1].syscalls, 2 * input.n, 'a send and a receive per item');
      near(r.result.cost.rows[0].syscalls, 2 * 2, 'shared memory: create and map, on each side');
      near(r.frames[0].meta.sys, r.result.cost.rows[0].syscalls, 'the setup quotes the engine\'s count');
      ok(r.frames[0].say.includes(r.result.cost.rows[0].syscalls + ' system calls'), 'the setup says how many system calls');
      near(r.result.cost.rows[1].bytesCopied, 2 * input.n * 64, 'copied into the kernel and out');
    },
  },
  'p03-msg': {
    random: (rnd) => ({ scene: pick(rnd, ['pair', 'burst', 'poll', 'mailbox', 'both']), cap: pick(rnd, ['0', '1', '2', 'inf']), send: pick(rnd, ['blocking', 'nonblocking']), recv: pick(rnd, ['blocking', 'nonblocking']), policy: pick(rnd, ['rr', 'random']), seed: int(rnd, 1, 20) }),
    nRandom: 12,
    check({ S, input, r, ok }) {
      const cap = input.cap === 'inf' ? Infinity : +input.cap, sc = S.P03.MSG[input.scene];
      for (const f of r.frames) for (const n of Object.values(f.meta.queues)) ok(n <= cap, 'a queue never holds more than its capacity');
      // each sender's messages arrive in the order sent (a queue is first in, first out)
      const sent = {};
      for (const p of sc.procs) for (const o of p.ops) if (o.op === 'send') (sent[p.name] = sent[p.name] || []).push(o.msg);
      const got = r.result.delivered.map((d) => d.body), failed = r.result.failed.map((d) => d.body);
      for (const [nm, list] of Object.entries(sent)) { const mine = got.filter((b) => list.includes(b)); ok(mine.every((b, i) => i === 0 || list.indexOf(b) > list.indexOf(mine[i - 1])), nm + '\'s messages keep their order'); }
      ok(got.every((b) => !failed.includes(b)), 'a refused message is never delivered');
      if (input.send === 'blocking') ok(!failed.length, 'blocking sends never fail');
      if (input.scene === 'both' && input.recv === 'blocking') ok(!!r.result.deadlock, 'both receiving first is a deadlock');
    },
  },
  'p03-signal': {
    check(ctx) {
      const { input, r, ok } = ctx;
      // worked out by hand: a handler counts the presses until 2; the default action ends the program; ignored, it ticks
      const n = input.presses;
      if (input.prog === 'handler') ok(r.result.term === (n >= 2 ? 'caught ^C 1\ncaught ^C 2\nbye\n' : 'caught ^C 1\n'), 'the handler output: ' + JSON.stringify(r.result.term));
      if (input.prog === 'deflt') ok(r.result.end === 'killed by SIGINT', 'the default action ends it');
      if (input.prog === 'ignore') ok(r.result.term === 'tick 1\ntick 2\n' && r.result.end === 'exit 0', 'ignored: it runs to the end');
      for (const f of r.frames) if (f.meta.phase === 'handler') ok(f.meta.evs[0].sig === 2, 'the handler gets signal 2');
    },
  },
  'p03-mask': {
    check(ctx) {
      const { S, input, r, ok, frames } = ctx;
      ok(frames('handler').length === 1, 'the handler runs exactly once');
      const sig = frames('signal')[0].meta.evs[0];
      ok(sig.pending === 1 << (10 - 1), 'SIGUSR1 sets pending bit 9 (512)');
      ok(frames('mask')[0].meta.evs[0].mask === 512, 'the mask blocks SIGUSR1');
      realInSet(ctx, S.P03.SIG_MASK[input.prog].src, {}, 'compiled');
    },
  },
  'p03-sigchld': {
    check(ctx) {
      const { S, input, r, ok } = ctx;
      const last = r.frames[r.frames.length - 1].meta;
      if (input.prog === 'once') { ok(r.result.status === 'deadlock' && last.zombies >= 1, 'one per signal leaves a zombie and the parent waits for ever'); return; }
      ok(r.result.term === 'all reaped\n' && r.result.status === 'done', 'every child reaped');
      ok(r.frames.filter((f) => f.meta.phase === 'wait' && f.meta.evs[0].ret > 100).length === 3, 'three reaps');
      realInSet(ctx, S.P03.SIG_CHLD[input.prog].src, { timeout: 10000, runs: 2 }, 'compiled');
    },
  },
  'p03-kill': {
    check(ctx) {
      const { S, input, r, ok } = ctx;
      // by hand: _exit(40 + 15) after SIGTERM; SIGKILL leaves status 9; the alarm handler gets 14
      const want = { term: 'exit 55\n', kill9: 'signal 9\n', alarm: 'ring 14\n' }[input.prog];
      ok(r.result.term === want, 'the output ' + JSON.stringify(r.result.term) + ' is ' + JSON.stringify(want));
      const w = r.frames.find((f) => f.meta.phase === 'wait' && f.meta.evs[0].pid === 100);
      if (input.prog === 'term') ok(w && w.meta.evs[0].status === 55 << 8, 'status = 55 << 8');
      if (input.prog === 'kill9') ok(w && w.meta.evs[0].status === 9, 'status = the signal, 9');
      realInSet(ctx, S.P03.SIG_KILL[input.prog].src, { timeout: 10000, runs: 2 }, 'compiled');
    },
  },
  'p03-sockets': {
    constants: [8080],
    check({ S, input, r, ok, near }) {
      // packets by hand: a handshake is 3, a refusal 2 (SYN, RST), each request and reply 1, each close of a connection 1
      const sc = S.P03.SOCK[input.scene];
      // packets by the rules: a handshake is 3; a SYN to a full backlog is dropped (1 packet, no reply) and
      // retransmitted after 1, 2 and 4 s; each request, reply and close of a connection 1; no listener: SYN, RST
      const kinds = r.frames.map((f) => f.meta.phase), drops = r.result.timeline.filter((p) => /dropped/.test(p.label)).length;
      const retries = kinds.filter((k) => k === 'retry').length, timeouts = kinds.filter((k) => k === 'timeout').length;
      near(drops, kinds.filter((k) => k === 'dropped').length + retries + timeouts, 'one dropped SYN per attempt that found the backlog full');
      const want = { one: 3 + 4 + 2, two: 2 * (3 + 2 + 2), early: 2 + 3 + 2 + 2, retry: 2 * (3 + 2 + 2) + drops, full: (3 + 2 + 2) + drops }[input.scene];
      near(r.result.timeline.length, want, 'packets');
      near(r.frames[r.frames.length - 1].meta.packets, want, 'the last frame shows them all');
      if (input.scene === 'retry') { ok(drops >= 1 && !timeouts, 'dropped, then let in'); ok(r.result.got.client2.join() === 'OK /a', 'the retrying client is served'); }
      if (input.scene === 'full') { near(drops, 4, 'the first SYN and 3 retransmissions are dropped'); ok(timeouts === 1, 'connect times out'); }
      if (input.scene === 'early') ok(r.frames.some((f) => f.meta.phase === 'refused'), 'no listener: refused');
      ok(r.result.got.client1.join() === sc.reqs.map((q) => q.replace('GET', 'OK')).join(), 'client1 gets its replies');
      if (input.scene === 'full') ok(!r.result.got.client2.length, 'the client that timed out gets nothing');
    },
  },
  'p03-rpc': {
    random: (rnd) => ({ call: pick(rnd, ['add', 'big', 'greet', 'total']), id: int(rnd, 1, 9999) }),
    check({ S, input, r, near }) {
      // an encoder written here: big-endian, padded to 4, strings and arrays led by a 4-byte count
      const be = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      const enc = (type, v) => type === 'int32' ? be(v) : type === 'uint8' ? [v, 0, 0, 0] : type === 'string' ? be(v.length).concat([...v].map((c) => c.charCodeAt(0)), Array((4 - (v.length % 4)) % 4).fill(0)) : be(v.length).concat(...v.map(be));
      const c = S.P03.CALLS[input.call];
      const req = be(input.id).concat(be(7), ...c.args.map((a) => enc(a.type, c.value[a.name])));
      near(r.result.request, req, 'the request bytes');
      const res = c.impl(c.value);
      near(r.result.reply, be(input.id).concat(...c.result.map((a) => enc(a.type, res[a.name]))), 'the reply bytes');
      near(JSON.stringify(r.result.result) === JSON.stringify(res) ? 1 : 0, 1, 'the result');
    },
  },
  'p03-rpc-retry': {
    random: (rnd) => ({ calls: pick(rnd, ['deposits', 'sets', 'mixed']), sem: pick(rnd, ['at-least-once', 'at-most-once']), loss: pick(rnd, [0, 0.1, 0.2, 0.3, 0.4, 0.5]), dup: pick(rnd, [0, 0.1, 0.2, 0.3, 0.4]), seed: int(rnd, 1, 30) }),
    nRandom: 12,
    check({ input, r, near, ok }) {
      // replay the calls with how many times each ran: deposit adds per run, set sets, read reads
      const apply = (v, c, k) => { for (let i = 0; i < k; i++) v = c.op === 'deposit' ? v + c.arg : c.op === 'set' ? c.arg : v; return v; };
      near(r.result.final, r.result.calls.reduce((v, c) => apply(v, c, c.executions), 100), 'the final number from the runs');
      near(r.result.expected, r.result.calls.reduce((v, c) => apply(v, c, 1), 100), 'exactly once');
      if (input.sem === 'at-most-once') ok(r.result.calls.every((c) => c.executions <= 1), 'at most once runs each call at most once');
      if (input.loss === 0 && input.dup === 0) ok(r.result.correct && r.result.calls.every((c) => c.executions === 1 && c.tries === 1), 'a perfect network runs each once');
      ok(r.result.calls.every((c) => c.tries <= 3), 'at most 3 tries');
    },
  },
  'p03-shell-run': {
    check(ctx) {
      const { S, input, r, ok } = ctx;
      // the real commands of this machine: those whose output does not depend on the directory or on stderr
      const typed = 'echo hi there\nsort notes\nwc todo\n';
      if (!input.cmds || input.cmds.startsWith('echo')) realInSet(ctx, S.P03.SHELL_LOOP, { input: typed, files: S.P03.SHELL_FILES, kern: { input: typed, files: S.P03.SHELL_FILES } }, 'compiled');
      ok(r.result.term.split('$ ').length - 1 === r.result.typed.split('\n').length, 'one prompt per line typed, and one at the end');
    },
  },
  'p03-shell-pipe': {
    check(ctx) {
      const { S, input, r, ok } = ctx;
      if (input.closes === 'no') { ok(r.result.status === 'deadlock', 'left open, the reader waits for ever'); return; }
      ok(r.result.status === 'done', 'the pipeline finishes');
      const F = S.P03.SHELL_FILES, lines = (t) => t.split('\n').filter(Boolean);
      const want = { lswc: null, sort: lines(F.notes).sort().join('\n') + '\n', head: lines(F.todo).sort()[0] + '\n' }[input.pipe];
      if (want) ok(r.result.term === want, 'the pipeline prints ' + JSON.stringify(want));
      if (input.pipe !== 'lswc') realInSet(ctx, r.result.src, { files: F, kern: { files: F } }, 'compiled');
    },
  },
  'p03-shell-redir': {
    check(ctx) {
      const { S, input, r, ok } = ctx;
      const R = S.P03.REDIR[input.cmd], F = S.P03.SHELL_FILES;
      const pad = (n) => String(n).padStart(8);
      const wcOf = (t) => pad(t.split('\n').length - 1) + pad(t.split(/\s+/).filter(Boolean).length) + pad(t.length) + '\n';
      ok(r.result.term === (input.cmd === 'input' ? wcOf(F.todo) : '') + '[done]\n', 'the terminal: ' + JSON.stringify(r.result.term));
      if (input.cmd === 'both') ok(r.result.out === F.notes.split('\n').filter(Boolean).sort().join('\n') + '\n', 'sorted holds the sorted notes');
      if (input.cmd === 'output') ok(r.result.out === 'ok\n', 'memo holds the echo');
      realInSet(ctx, r.result.src, { files: F, clean: [R.outF].filter(Boolean), kern: { files: F } }, 'compiled');
    },
  },
  'p03-shell-bg': {
    check({ input, r, ok }) {
      const last = r.frames.filter((f) => f.meta.phase === 'print').pop().meta;
      if (input.handler === 'yes') ok(!last.zombies.some((p) => p > 100) && /\[101\] done\n.*\[102\] done/s.test(r.result.term), 'both jobs reaped and announced');
      else { ok(last.zombies.filter((p) => p > 100).length === 2, 'two zombies while the shell runs'); ok(r.frames.some((f) => f.meta.phase === 'reparent'), 'init adopts them at the end'); }
    },
  },
  'p03-shell-jobs': {
    check({ input, r, ok }) {
      if (input.groups === 'yes') ok(r.result.term === 'job: signal 2\n$ the shell lives on\n', 'only the job dies');
      else ok(r.result.term === '' && r.frames.some((f) => f.meta.phase === 'exit' && f.meta.evs[0].pid === 100 && f.meta.evs[0].crash === 2), 'the shell dies too');
    },
  },
};

runClaims('claims-p03', /^p03-/, P03);
