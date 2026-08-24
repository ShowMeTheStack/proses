// Part 1 (what an operating system does): every topic run with its default, every preset and random valid inputs.
// For every frame: the wording (a/an, doubled words, stray spaces, "1 processes"), and every number the narration
// quotes must be a value the frame carries from the engines (its meta), an input, or a named constant of the topic.
// Then each topic's values are checked against a second computation here (an independent model of the mechanism,
// or hand-worked values). Prints "claims-p01 N passed, M failed". The machinery is exported for parts 2 and 3.
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { load, harness, rng } from './load.mjs';

// ---- wording ----
const vowelSound = (w) => {
  if (/^NULL$/.test(w)) return false;
  if (/^[A-Za-z]$/.test(w) || /^[A-Z][A-Z0-9²-]*$/.test(w)) return /^[AEFHILMNORSX]/.test(w.toUpperCase());
  if (/^\d/.test(w)) return /^(8|11|18)(\D|$)/.test(w) || /^8\d/.test(w);
  if (/^(hour|honest|heir)/i.test(w)) return true;
  return /^[aeiou]/i.test(w) && !/^(one|once|uni|use|usu|eu|ur[ai])/i.test(w);
};
const SINGULAR_S = /(ss|us|is|ous|ics)$/;
export function wording(say) {
  const s = String(say || '').replace(/"[^"]*"/g, '"…"'), out = [];
  if (/\S {2,}\S/.test(s)) out.push('a double space');
  if (/\s[,.;:](\s|$)/.test(s)) out.push('a space before punctuation');
  if (/\.\./.test(s.replace(/…/g, ''))) out.push('two full stops');
  for (const m of s.matchAll(/\b([A-Za-z]{2,}) \1\b/g)) if (!/^(that|had)$/i.test(m[1])) out.push('the word "' + m[1] + '" twice');
  for (const m of s.matchAll(/(^|[^\w'’])(a|an|A|An) ([\w²’'-]+)/g)) {
    // a capital A inside a sentence is a name (process A), not the article
    if (m[2] === 'A' && !/(^|[.:!?]\s*)$/.test(s.slice(0, m.index + m[1].length))) continue;
    const art = m[2].toLowerCase(), w = m[3], vowel = vowelSound(w);
    if (art === 'a' && vowel && !(m[2] === 'A' && /^[A-Z]$/.test(w))) out.push('"a ' + w + '"');
    if (art === 'an' && !vowel) out.push('"an ' + w + '"');
  }
  for (const m of s.matchAll(/(^|[^\w.−-])1 ([a-z]+)\b/g)) if (m[2].length > 2 && /s$/.test(m[2]) && !SINGULAR_S.test(m[2]) && !/^(has|was|does|is|its|goes|says|gets|makes|holds|needs|stays|takes|runs)$/.test(m[2])) out.push('"1 ' + m[2] + '"');
  for (const m of s.matchAll(/(^|[^\w.])([02-9]|\d\d+) (process|tick|switch|call|byte|message|page|child|frame|instruction|signal)\b(?![-'’])/g)) out.push('"' + m[2] + ' ' + m[3] + '"');
  if (/\bundefined\b|\bNaN\b|\[object/.test(s)) out.push('a broken value');
  if (/`/.test(s)) out.push('a stray backtick');
  return out;
}

// ---- numbers ----
export function stringsOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) stringsOf(v[k], out);
  return out;
}
export function numbersOf(v, out = []) {
  if (typeof v === 'number') { if (Number.isFinite(v)) out.push(v); }
  else if (typeof v === 'string') { for (const m of v.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(+m[0]); }
  else if (typeof v === 'boolean') { /* no number */ }
  else if (Array.isArray(v)) { out.push(v.length); for (const x of v) numbersOf(x, out); }
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numbersOf(v[k], out);
  return out;
}
/** the numbers quoted in a sentence: [text, value, decimals, percent] (hex, names such as r0, rax, SIGINT 2 are filtered by the caller) */
export function quoted(say) {
  const s = String(say || '').replace(/−/g, '-').replace(/0x[0-9a-fA-F]+/g, ' '), out = [];
  for (const m of s.matchAll(/(^|[^\w.²³⁰¹⁴⁵⁶⁷⁸⁹_])(-?\d+(?:\.\d+)?)(%?)(?![\w²³¹⁰⁴⁵⁶⁷⁸⁹])/g)) {
    if (/[A-Za-z]$/.test(m[1])) continue;
    const t = m[2], d = t.includes('.') ? t.split('.')[1].length : 0;
    out.push([t + m[3], +t, d, !!m[3]]);
  }
  return out;
}
const matches = (tok, v) => {
  const [, x, d, pct] = tok, tol = 0.5 * Math.pow(10, -d) + 1e-9 * Math.max(1, Math.abs(x));
  const cand = pct ? [v * 100, v] : [v, v * 100];
  return cand.some((c) => Math.abs(c - x) <= tol || Math.abs(Math.abs(c) - Math.abs(x)) <= tol);
};
export function untraced(say, allowed, names) {
  let s = String(say || '');
  for (const nm of (names || []).filter((x) => /\d/.test(x)).sort((a, b) => b.length - a.length)) s = s.replace(new RegExp('(?<![\\w.])' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w|\\.\\d)', 'g'), ' ');
  return quoted(s).filter((tok) => !(tok[2] === 0 && Math.abs(tok[1]) <= 1) && !allowed.some((v) => matches(tok, v))).map((t) => t[0]);
}
export const close = (a, b, tol = 1e-6) => {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v, i) => close(a[i], v, tol));
  if (b && typeof b === 'object') return a && typeof a === 'object' && Object.keys(b).every((k) => close(a[k], b[k], tol));
  if (typeof b === 'string' || typeof b === 'boolean' || b === null || b === undefined) return a === b || (b === null && a === undefined) || (b === undefined && a === null);
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
};

/**
 * Run the claims of the topics whose family matches `family`: CHECKS[topicId] = {constants: [n..], names: [strings
 * with digits that are not quoted numbers], random(rnd) -> values, nRandom, check(ctx)}; ctx = {S, t, input, r,
 * near(got, want, what, tol), ok(cond, what), frame(phase), frames(phase)}.
 */
export function runClaims(name, family, CHECKS) {
  const S = load(['core', 'stage', 'topics']);
  if (S.PX && S.PX.SRC) Object.assign(P01_SRC, S.PX.SRC);
  const t0 = harness(name);
  const only = process.argv.slice(2);
  const rnd = rng(20261019);
  let runs = 0;
  for (const t of S.topics) {
    if (!family.test(t.family)) continue;
    if (only.length && !only.some((o) => t.id.startsWith(o))) continue;
    const C = CHECKS[t.id] || {};
    if (!CHECKS[t.id]) t0.ok(false, t.id + ': no claims check is written for this topic');
    const inputs = [{}].concat((t.presets || []).map((p) => p.values));
    const nFixed = inputs.length;
    if (C.random) for (let k = 0; k < (C.nRandom || 6); k++) inputs.push(C.random(rnd));
    inputs.forEach((v, idx) => {
      const input = S.inputOf(t, Object.assign(S.inputOf(t), v));
      if (S.checkInput(t, input)) { if (idx < nFixed) t0.ok(false, t.id + ' ' + JSON.stringify(v) + ': its input is refused: ' + S.checkInput(t, input)); return; }
      const tag = t.id + ' ' + JSON.stringify(v).slice(0, 80);
      const r = S.run(t, input);
      runs++;
      if (!r.ok) { t0.ok(false, tag + ': ' + r.error); return; }
      const consts = (C.constants || []).concat(numbersOf(input));
      r.frames.forEach((f, i) => {
        for (const w of wording(f.say)) t0.ok(false, tag + ' frame ' + i + ': ' + w + ': ' + f.say);
        if (f.predict) for (const w of wording(f.predict.ask)) t0.ok(false, tag + ' frame ' + i + ' prediction: ' + w);
        if (!f.meta) { t0.ok(false, tag + ' frame ' + i + ': no meta'); return; }
        const allowed = numbersOf(f.meta).concat(consts);
        const bad = untraced(f.say, allowed, stringsOf(f.meta).filter((x) => x.length < 40).concat(C.names || []));
        t0.ok(!bad.length, tag + ' frame ' + i + ': the narration quotes ' + bad.join(', ') + ', which the frame does not carry: ' + f.say);
      });
      const ctx = {
        S, t, input, r,
        near: (got, want, what, tol) => t0.ok(close(got, want, tol === undefined ? 1e-6 : tol), tag + ': ' + what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)),
        ok: (c, what) => t0.ok(!!c, tag + ': ' + what),
        frame: (phase) => r.frames.find((f) => f.meta && f.meta.phase === phase),
        frames: (phase) => r.frames.filter((f) => f.meta && f.meta.phase === phase),
      };
      try { if (C.check) C.check(ctx); } catch (e) { t0.ok(false, tag + ': the check fails: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
    });
  }
  console.log('  (' + runs + ' runs)');
  t0.done();
}

// ---------------------------------------------------------------------------------------------------------------
// Part 1's checks
// ---------------------------------------------------------------------------------------------------------------
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

/** limited direct execution, worked out a second way: tick by tick with a round-robin queue */
function ldeModel(procs, q, timer, cost, max) {
  const left = {}, done = {}, finish = {};
  const queue = procs.map((p) => p.name);
  for (const p of procs) { left[p.name] = p.loop ? Infinity : p.work; done[p.name] = 0; }
  let t = 0, cur = queue.shift(), switches = 0, timers = 0, next = q;
  const sys = Object.fromEntries(procs.map((p) => [p.name, new Set(p.syscalls || [])]));
  const go = () => { const prev = cur; cur = queue.shift() || null; if (cur && cur !== prev) { switches++; t += cost; if (timer && cost) while (next <= t) next += q; } };
  while (cur && t < max) {
    t++; done[cur]++; left[cur]--;
    // an exit is a trap: a timer tick due at the same moment is used up by it, so the next tick stays on the beat
    if (left[cur] === 0) { finish[cur] = t; if (timer) while (next <= t) next += q; go(); continue; }
    if (sys[cur].has(done[cur])) { if (!timer) { queue.push(cur); go(); } continue; }
    if (timer && t >= next) { timers++; while (next <= t) next += q; queue.push(cur); go(); }
  }
  return { switches, timers, finish };
}
function parseProcs(text) {
  return text.split(',').map((x) => x.trim().split(/\s+/)).map((w) => ({ name: w[0], loop: w[1] === 'loop', work: w[1] === 'loop' ? 0 : +w[1], syscalls: w[2] === 'sys' ? w.slice(3).map(Number) : [] }));
}

export const P01 = {
  'p01-lde': {
    random: (rnd) => {
      const n = int(rnd, 1, 4), ps = [];
      for (let i = 0; i < n; i++) {
        const name = 'ABCDE'[i], loop = rnd() < 0.15, work = int(rnd, 1, 9);
        let s = name + ' ' + (loop ? 'loop' : work);
        if (!loop && work > 2 && rnd() < 0.5) s += ' sys ' + int(rnd, 1, work - 1);
        ps.push(s);
      }
      return { procs: ps.join(', '), quantum: int(rnd, 1, 6), timer: pick(rnd, ['on', 'off']), cost: int(rnd, 0, 2) };
    },
    nRandom: 12,
    check({ input, r, near, ok }) {
      const procs = parseProcs(input.procs), loops = procs.some((p) => p.loop);
      const max = loops ? (input.timer === 'on' ? 24 : 18) : 60;
      const m = ldeModel(procs, input.quantum, input.timer === 'on', input.cost, max);
      near(r.result.switches, m.switches, 'context switches');
      near(r.result.timerInterrupts, m.timers, 'timer interrupts');
      for (const p of procs) if (m.finish[p.name] !== undefined) near(r.result.finish[p.name], m.finish[p.name], p.name + ' finishes');
      const last = r.frames[r.frames.length - 1].meta;
      near(last.switches, m.switches, 'the counter of switches');
      ok(r.frames.filter((f) => f.meta.kind === 'switch').length === m.switches, 'one frame per switch');
      if (input.timer === 'off' && loops) ok(!!r.result.stuck, 'a loop with no timer is stuck');
      if (input.timer === 'on') ok(!r.result.stuck, 'with the timer nothing is stuck');
    },
  },
};

// ---- real programs: compiled with the system cc (tests only) and run in a fresh directory ----
const CC_DIR = join(tmpdir(), 'proses-claims-cc');
/** compile src and run it with files written first; -> {out, files: {name: text}} or null when cc is missing */
export function realRun(src, files) {
  try {
    mkdirSync(CC_DIR, { recursive: true });
    const h = createHash('sha1').update(src).digest('hex').slice(0, 16), bin = join(CC_DIR, h), cfile = bin + '.c';
    if (!existsSync(bin)) { writeFileSync(cfile, src); execFileSync('cc', ['-w', '-O0', '-o', bin, cfile], { stdio: 'ignore' }); }
    const dir = join(CC_DIR, 'run-' + h + '-' + process.pid);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    for (const [n, t] of Object.entries(files || {})) writeFileSync(join(dir, n), t);
    let out = '';
    try { out = execFileSync(bin, [], { cwd: dir, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { out = e.stdout || ''; }
    const after = {};
    for (const n of ['f.txt', 'log.txt', 'list.txt']) if (existsSync(join(dir, n))) after[n] = readFileSync(join(dir, n), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    return { out, files: after };
  } catch (e) { return null; }
}
const noAddr = (t) => String(t).replace(/0x[0-9a-f]+/gi, 'ADDR');

/** the toy CPU worked out a second way: which instruction ends the program, and the registers at the end */
function toyModel(prog, mode, irq) {
  const P = { cli: 1, sti: 1, hlt: 1, in: 1, out: 1, lcr3: 1, lidt: 1, settimer: 1, iret: 1 }, OK = { load: 1, store: 1, add: 1, div: 1, jmp: 1, call: 1, syscall: 1 };
  const regs = { r0: 0, r1: 0, r2: 0, r3: 0 };
  let pc = 0, done = 0, IF = true, pending = irq ? [irq] : [], traps = 0, async = 0;
  while (pc < prog.length && done < 200) {
    if (IF && pending.length && pending[0] <= done) { pending.shift(); traps++; async++; continue; }
    const { op, args } = prog[pc]; done++;
    if (!OK[op] && !P[op]) return { killed: { pc, vector: 6 }, regs, traps: traps + 1, async, executed: done };
    if (P[op] && mode === 'user') return { killed: { pc, vector: 13 }, regs, traps: traps + 1, async, executed: done };
    if (op === 'div' && !regs[args[1] || 'r1']) return { killed: { pc, vector: 0 }, regs, traps: traps + 1, async, executed: done };
    if (op === 'syscall') { traps++; regs.r0 = 0; pc++; continue; }
    if (op === 'add') regs[args[0] || 'r0'] += regs[args[1] || 'r1'];
    if (op === 'div') regs[args[0] || 'r0'] = Math.trunc(regs[args[0] || 'r0'] / regs[args[1] || 'r1']);
    if (op === 'load') regs[args[0] || 'r0'] = args[1] === undefined ? 0 : args[1];
    if (op === 'cli') IF = false;
    if (op === 'sti') IF = true;
    if (op === 'hlt') break;
    pc = op === 'jmp' ? (args[0] === undefined ? pc + 1 : args[0]) : pc + 1;
  }
  return { killed: null, regs, traps, async, executed: done };
}
const parseToy = (text) => String(text).split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((l) => { const w = l.split(/[\s,]+/); return { op: w[0].toLowerCase(), args: w.slice(1).map((a) => (/^-?\d+$/.test(a) ? Number(a) : a)) }; });

/** a request through a kernel design, counted a second way from its parts */
function structureModel(parts) {
  let modes = 0, msgs = 0, calls = 0;
  const hop = (a, b, down) => {
    if (a.space === 'kernel' && b.space === 'kernel') calls++;
    else if (a.space !== b.space) { modes++; if ((a.space === 'kernel') === down) msgs++; }
    else { modes += 2; msgs++; }
  };
  for (let i = 0; i + 1 < parts.length; i++) hop(parts[i], parts[i + 1], true);
  for (let i = parts.length - 1; i > 0; i--) hop(parts[i], parts[i - 1], false);
  return { modes, msgs, calls };
}

// the topics' own programs, read from the topic files' presets at run time
const P01_SRC = { persist: [], sysc: [] };
Object.assign(P01, {
  'p01-cpu-share': {
    random: (rnd) => ({ procs: Array.from({ length: int(rnd, 1, 4) }, (_, i) => 'ABCD'[i] + ' ' + int(rnd, 1, 8)).join(', '), quantum: int(rnd, 1, 5) }),
    check({ input, r, near }) {
      const procs = parseProcs(input.procs), m = ldeModel(procs, input.quantum, true, 0, 80), last = r.frames[r.frames.length - 1].meta;
      for (const p of procs) { near(last.finish[p.name], m.finish[p.name], p.name + ' finishes on the wall clock'); near(last.done[p.name], p.work, p.name + ' did all its own ticks'); }
      near(last.end, Math.max(...Object.values(m.finish)), 'the run ends with the last finish');
    },
  },
  'p01-memory-private': {
    check({ S, input, r, ok, near }) {
      const pr = S.PX.MEM[Number(input.prog)], real = realRun(pr.src);
      if (real) near(noAddr(r.result.out).split('\n').sort(), noAddr(real.out).split('\n').sort(), 'the output, addresses aside, equals the real program\'s');
      const prints = r.frames.filter((f) => f.meta.phase === 'print').map((f) => f.meta.evs[0].text);
      const addr = prints.map((t) => (/0x[0-9a-f]+/.exec(t) || [])[0]);
      ok(addr.length === 2 && addr[0] === addr[1], 'both processes print the same address');
      ok(prints[0].split(' ').pop() !== prints[1].split(' ').pop(), 'but different values');
      const cow = r.frames.filter((f) => f.meta.phase === 'cow');
      ok(cow.length >= 1 && cow.every((f) => f.meta.evs[0].from !== f.meta.evs[0].to), 'each copy-on-write gives a new frame');
    },
  },
  'p01-persist': {
    check({ S, input, r, ok, near }) {
      const name = ['f.txt', 'log.txt'][Number(input.prog || 0)], last = r.frames[r.frames.length - 1].meta;
      const data = last.files.inodes[last.files.dir[name]].data;
      near(last.bytes, data.length, 'bytes on the disk');
      // the same program compiled and run for real leaves the same file behind
      const real = realRun(P01_SRC.persist[Number(input.prog || 0)]);
      if (real) { ok(real.files[name] === data, 'the file the real program leaves holds the same bytes'); near(real.out, r.result.out, 'the same output as the real program'); }
    },
  },
  'p01-referee': {
    check({ S, input, r, ok, near }) {
      const prog = Number(input.prog || 0), want = [11, 8, 9][prog];
      const w = r.frames.find((f) => f.meta.phase === 'wait' && f.meta.evs[0].pid === 100);
      near(w.meta.evs[0].status & 0x7f, want, 'the parent\'s status holds the signal number');
      ok(r.result.out.includes('died of ' + want), 'the parent prints the signal');
      ok(r.frames.some((f) => f.meta.phase === 'exit' && f.meta.evs[0].crash === want), 'the child is ended by that signal');
    },
  },
  'p01-modes': {
    random: (rnd) => { const ops = ['load r0 4', 'load r1 0', 'load r1 3', 'add r0 r1', 'store r0', 'div r0 r1', 'cli', 'sti', 'out r0', 'syscall', 'lcr3 r0', 'zap']; return { prog: Array.from({ length: int(rnd, 1, 7) }, () => pick(rnd, ops)).join('; '), mode: pick(rnd, ['user', 'kernel']), irq: int(rnd, 0, 4) }; },
    nRandom: 14,
    check({ input, r, near, ok }) {
      const m = toyModel(parseToy(input.prog), input.mode, input.irq);
      near(r.result.killed ? [r.result.killed.pc, r.result.killed.vector] : null, m.killed ? [m.killed.pc, m.killed.vector] : null, 'where the program is ended, and by which vector');
      if (!m.killed) near(r.result.cpu.regs, m.regs, 'the registers at the end');
      near(r.result.traps.length, m.traps, 'the number of traps');
      near(r.result.executed, m.executed, 'instructions started');
    },
  },
  'p01-trap': {
    random: (rnd) => { const cause = pick(rnd, ['interrupt', 'exception', 'syscall']); const v = { interrupt: [32, 33, 46], exception: [14, 13, 0, 6], syscall: [128] }[cause]; return { cause, vector: String(pick(rnd, v)), pc: int(rnd, 4096, 8191), r0: int(rnd, 0, 400), result: int(rnd, -50, 5000), mode: pick(rnd, ['user', 'kernel']) }; },
    nRandom: 12,
    check({ input, r, near, ok }) {
      const v = Number(input.vector), kill = [0, 6, 13].includes(v);
      const saves = r.frames.filter((f) => f.meta.phase === 'save');
      near(saves.map((f) => f.meta.words), [3, 7], 'three words from the hardware, then four registers');
      const top = saves[1].meta.kstack;
      near(top.map((w) => w.name), ['user sp', 'flags', 'pc', 'r0', 'r1', 'r2', 'r3'], 'the order of the trap frame');
      near(top[2].value, input.cause === 'exception' ? input.pc : input.pc + 1, 'the saved PC: the same instruction after a fault, the next one otherwise');
      ok(r.result.outcome === (kill ? 'kill' : v === 14 ? 'retry' : 'resume'), 'the outcome of vector ' + v);
      if (!kill) { near(r.result.resumePc, top[2].value, 'it resumes at the saved PC'); near(r.result.cpu.regs.r0, input.cause === 'syscall' ? input.result : input.r0, 'r0 after the trap'); ok(r.result.cpu.mode === input.mode, 'back in the mode it was in'); }
    },
  },
  'p01-trapkinds': {
    random: (rnd) => { const ops = ['load r0 4', 'load r1 0', 'load r1 3', 'add r0 r1', 'store r0', 'div r0 r1', 'syscall', 'hlt']; return { prog: Array.from({ length: int(rnd, 2, 7) }, () => pick(rnd, ops)).join('; '), irqs: Array.from({ length: int(rnd, 0, 3) }, () => int(rnd, 0, 6)).sort().join(', '), dev: pick(rnd, ['32', '33', '46']) }; },
    nRandom: 12,
    check({ input, r, near }) {
      const last = r.frames[r.frames.length - 1].meta, prog = parseToy(input.prog);
      const sync = r.result.traps.filter((t) => t.cause !== 'interrupt').length;
      near(last.nS, sync, 'synchronous traps counted');
      near(last.nA + last.nS, r.result.traps.length, 'every trap is in the table');
      const m = toyModel(prog, 'user', 0);
      near(r.result.killed ? r.result.killed.pc : null, m.killed ? m.killed.pc : null, 'the same instruction fails, interrupts or not');
    },
  },
  'p01-syscall': {
    constants: [4095],
    check({ input, r, near }) {
      // hand-worked: fd 3 is /home/ana/notes.txt holding "buy milk\n" (9 bytes); /etc/motd is read-only
      const WANT = { 'read(3, buf, 4)': [4, 0], 'getpid()': [4242, 0], 'write(1, "hi there\\n", 9)': [9, 0], 'open("/etc/motd", O_RDONLY)': [4, 0], 'open("/home/ana/todo.txt", O_RDONLY)': [-1, 2], 'read(7, buf, 4)': [-1, 9], 'open("/etc/motd", O_WRONLY)': [-1, 13], '200()': [-1, 38], 'lseek(3, 2, 2)': [11, 0] };
      const w = WANT[input.call];
      if (w) near([r.result.ret, r.result.errno], w, 'the result and errno, worked out by hand');
      near(r.frames.filter((f) => f.meta.phase === 'trap' || f.meta.phase === 'return').length, 2, 'two mode switches');
    },
  },
  'p01-sysc': {
    check({ input, r, near, ok }) {
      const last = r.frames[r.frames.length - 1].meta;
      const written = r.frames.filter((f) => f.meta.phase === 'print').map((f) => f.meta.evs[0].text).join('');
      near(written.length, r.result.out.length, 'every byte out came from a write');
      near(last.writes, r.frames.filter((f) => f.meta.phase === 'print').length, 'one write per flush');
      // run for real, stdout is a pipe: the bytes and their order must match the pipe setting exactly
      if (input.tty === 'pipe' || input.prog === '3') { const real = realRun(P01_SRC.sysc[Number(input.prog)], input.prog === '3' ? { 'in.txt': 'pears, plums\n' } : {}); if (real) near(r.result.out, real.out, 'the same bytes as the real program'); }
      if (input.tty === 'pipe') ok(last.writes <= 2, 'into a pipe the buffer is written at most twice here');
    },
  },
  'p01-boot': {
    random: (rnd) => ({ fw: pick(rnd, ['bios', 'uefi']), order: pick(rnd, ['usb, disk', 'disk', 'cd, usb, disk', 'usb']), devs: pick(rnd, ['disk', 'usb', 'usb, disk', 'cd']), services: pick(rnd, ['getty', 'logd, netd', 'syslogd, cron, sshd, getty', '']), ramdisk: pick(rnd, ['yes', 'no']) }),
    check({ input, r, near, ok }) {
      const L = (v) => String(v).split(/[\s,]+/).filter(Boolean), order = L(input.order), devs = L(input.devs), boots = order.find((d) => devs.includes(d));
      near(r.frames.filter((f) => f.meta.phase === 'probe').length, boots ? order.indexOf(boots) : order.length, 'devices tried before the one that boots');
      if (!boots) { ok(r.frames[r.frames.length - 1].meta.phase === 'fail', 'no bootable device stops the firmware'); return; }
      const last = r.frames[r.frames.length - 1].meta;
      near(last.pids.length, L(input.services).length + 2, 'idle, init and one process per service');
      ok(last.pids.every((p) => p.pid < 2 || p.ppid === 1), 'every service is a child of init');
      ok(r.frames.findIndex((f) => f.meta.phase === 'traps') < r.frames.findIndex((f) => f.meta.phase === 'init'), 'the trap table is filled before the first user process');
    },
  },
  'p01-structure': {
    check({ S, input, r, near }) {
      const m = structureModel(S.Os.STRUCTURES[input.st].parts), last = r.frames[r.frames.length - 1].meta;
      near([last.modeSwitches, last.messages, last.calls], [m.modes, m.msgs, m.calls], 'the totals counted a second way');
    },
  },
  'p01-structures': {
    check({ S, r, near }) {
      const all = r.frames[r.frames.length - 1].meta.all;
      for (const row of all) { const m = structureModel(S.Os.STRUCTURES[row.id].parts); near([row.modeSwitches, row.messages, row.calls], [m.modes, m.msgs, m.calls], row.name + ' counted a second way'); }
      // hand-worked: a monolithic read crosses into the kernel once and back once
      near(all.find((x) => x.id === 'monolithic').modeSwitches, 2, 'monolithic: two mode switches');
    },
  },
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runClaims('claims-p01', /^p01-/, P01);
