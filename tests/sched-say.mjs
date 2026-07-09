// The schedulers' narration: every function of S.Sched run over seeded inputs and a range of parameters, and every
// sentence it writes (each step's say and why, each event's say) scanned for slips: a count that disagrees with
// its noun ("1 ticks", "2 tick"), "a" before a vowel or "an" before a consonant, a doubled word, stray spacing
// around punctuation, spaced ratios ("2 : 2"), and values that were never filled in (undefined, NaN, null).
// Also the lottery's behaviour when no ready job holds a ticket.
import { load, harness, rng } from './load.mjs';

const t = harness('sched-say');
const S = load(['core']);
const Sch = S.Sched;

const NOUNS = 'tick|job|task|deadline|burst|quantum|level|core|ticket|switch|class|window|step|time';
const PLURAL = { quantum: 'quanta', switch: 'switches', class: 'classes' };
const pl = (n) => PLURAL[n] || n + 's';
const sing = new RegExp('(?:^|[^\\d.\\w−-])1`?\\s+(' + NOUNS.split('|').map(pl).join('|') + ')\\b');
const plur = new RegExp('(?:^|[^\\d.\\w−-])(?:0|[2-9]|\\d{2,})`?\\s+(' + NOUNS + ')\\b(?![-\\w])');
const checks = [
  ['one with a plural noun', (s) => sing.test(s)],
  ['a plural count with a singular noun', (s) => plur.test(s)],
  ['"a" before a vowel', (s) => /(^|[^\w])a [aeioAEIO]\w/.test(s.replace(/a (one|use|unit|user)/g, ''))],
  ['"an" before a consonant', (s) => /(^|[^\w])an [b-df-hj-np-tv-zB-DF-HJ-NP-TV-Z]/.test(s.replace(/an (I\/O|F[^a-z]|H[^a-z]|L[^a-z]|M[^a-z]|N[^a-z]|R[^a-z]|S[^a-z]|X[^a-z])/g, ''))],
  ['a doubled word', (s) => /\b([a-z]{2,}) \1\b/i.test(s.replace(/`/g, ''))],
  ['double space', (s) => /\S {2,}\S/.test(s)],
  ['space before punctuation', (s) => / [,.;:!?)]/.test(s.replace(/ : /g, '§'))],
  ['space after an opening bracket', (s) => /[([] /.test(s)],
  ['doubled punctuation', (s) => /([,;.])\s*\1|[,;]\s*[.;,]|\.\s*\./.test(s.replace(/\.\.\./g, ''))],
  ['a spaced ratio', (s) => /\d`? : `?\d/.test(s)],
  ['leading or trailing space', (s) => s !== s.trim()],
  ['a value never filled in', (s) => /undefined|NaN|null|\[object|Infinity/.test(s)],
  ['an empty backtick pair', (s) => /``/.test(s)],
  ['an allotment that is no limit', (s) => /of its no limit|of its ∞|of its Infinity/.test(s)],
  ['a comma before a bracket', (s) => /, \(/.test(s)],
];
const seen = new Map();
let scanned = 0;
function scan(tr, at) {
  const lines = [];
  for (const st of tr.steps || []) { if (st.say) lines.push(st.say); if (st.why) lines.push(st.why); }
  for (const e of tr.events || []) if (e.say) lines.push(e.say);
  for (const s0 of lines) {
    scanned++;
    const s = s0.replace(/t = `?\d+`?/g, 't = T');
    for (const [name, bad] of checks) if (bad(s)) {
      const k = name + '|' + s.replace(/\d+/g, '#');
      if (!seen.has(k)) { seen.set(k, s); t.ok(false, at + ': ' + name + ': ' + s); }
    }
  }
}

const R = rng(2026);
for (let n = 0; n < 60; n++) {
  const seed = Math.floor(R() * 1e9);
  const work = Sch.random(seed, { io: n % 3 !== 0, n: 2 + (n % 6) }).map((j, i) => Object.assign(j, { cls: (seed >> i) % 3, tickets: 1 + ((seed >> i) % 4) * 100, nice: ((seed >> i) % 7) - 3, affinity: (seed >> i) % 5 === 0 ? [i % 2] : undefined }));
  for (const p of ['fcfs', 'sjf', 'srtn', 'prio', 'rr']) for (const P of [{}, { quantum: 1, cs: 1 }, { cs: 2, quantum: 3 }, { predict: { alpha: 0.5, tau0: 1 } }, { preemptive: true, age: 1, ageFrom: 'arrival' }]) scan(Sch.run(work, p, P), `run ${p} ${JSON.stringify(P)}`);
  for (const P of [{}, { levels: 2, quantum: [1], allot: 1, boost: 5 }, { allotMode: 'reset-io', cs: 1 }, { preempt: false, boost: 7 }]) scan(Sch.mlfq(work, P), 'mlfq ' + JSON.stringify(P));
  for (const P of [{}, { mode: 'share', shares: [1, 1, 1], window: 3, cs: 1 }, { mode: 'share', shares: [6, 3, 1] }]) scan(Sch.mlq(work, P), 'mlq ' + JSON.stringify(P));
  for (const P of [{ quantum: 1, seed }, { quantum: 3, cs: 1, seed: 2 }]) { scan(Sch.lottery(work, P), 'lottery'); scan(Sch.stride(work, P), 'stride'); }
  for (const P of [{}, { latency: 4, minGran: 1, cs: 1 }, { sleeperCredit: false }]) scan(Sch.cfs(work, P), 'cfs ' + JSON.stringify(P));
  for (const P of [{ cores: 2, queue: 'shared', migrate: 1 }, { cores: 3, push: 2, migrate: 2, cs: 1 }, { cores: 2, pull: false, push: 1, migrate: 1, quantum: 1 }]) scan(Sch.multi(work, P), 'multi ' + JSON.stringify(P));
  const ts = [];
  for (let i = 0; i < 2 + (n % 3); i++) { const T = 3 + Math.floor(R() * 8); ts.push({ id: String.fromCharCode(65 + i), C: 1 + Math.floor(R() * (T / 2)), T, D: n % 2 ? T : Math.max(1, T - 1) }); }
  for (const pol of ['rm', 'edf']) for (const onMiss of ['continue', 'abort']) scan(Sch.rt(ts, { policy: pol, onMiss }), `rt ${pol} ${onMiss}`);
  for (const proto of ['none', 'inherit', 'ceiling']) scan(Sch.inversion(n % 2 ? null : [
    { id: 'P', prio: 2, arrive: 0, script: [['run', 1], ['lock', 'a'], ['run', 1 + (n % 3)], ['unlock', 'a']] },
    { id: 'Q', prio: 1, arrive: 1, script: [['lock', 'a'], ['run', 1], ['unlock', 'a'], ['run', 1]] },
    { id: 'U', prio: 3, arrive: 0, script: [['run', 2 + (n % 2)]] }], { protocol: proto }), 'inversion ' + proto);
}
// the presets too
for (const k of Object.keys(Sch.presets)) for (const p of ['fcfs', 'srtn', 'rr']) scan(Sch.run(Sch.presets[k].jobs, p, { quantum: 1, cs: 1 }), 'preset ' + k);
t.ok(scanned > 100000, 'scanned ' + scanned + ' sentences');

// ---- the lottery when no ready job holds a ticket -----------------------------------------------------------------
{
  // C lends all of its 100 tickets to A until t = 9; A waits for I/O from t = 1 to 9, leaving C the only ready job
  const w = [{ id: 'A', arrive: 0, bursts: [1, 8, 2], tickets: 100 }, { id: 'C', arrive: 0, bursts: [6], tickets: 100 }];
  const tr = Sch.lottery(w, { seed: 4, quantum: 2, transfers: [{ t: 0, from: 'C', to: 'A', tickets: 100, until: 9 }] });
  const d = tr.draws.find((x) => x.recalled);
  t.ok(!!d, 'a draw with the loan called back');
  t.eq([d.total, d.winner, d.recalled], [100, 'C', ['C']], 'C’s 100 tickets come back and C wins');
  t.ok(tr.events.some((e) => e.kind === 'recall' && /C takes its loan back/.test(e.say)), 'the recall is an event');
  const st = tr.steps.find((x) => x.draw && x.draw.recalled);
  t.ok(/no ready job holds a ticket, so C takes its loan back for this draw/.test(st.say), 'and narrated: ' + st.say);
  t.ok(tr.draws.every((x) => x.total > 0 && x.number < x.total), 'every draw has tickets and a number within them');
  t.ok(tr.metrics.rows.every((r) => Number.isFinite(r.finish)), 'both finish');
  // a holder with no tickets is listed as holding none
  const z = Sch.lottery([{ id: 'A', arrive: 0, bursts: [3] }, { id: 'B', arrive: 0, bursts: [3] }], { seed: 1, transfers: [{ t: 0, from: 'B', to: 'A', tickets: 100 }] });
  t.ok(/B none/.test(z.steps[0].say), 'a holder with none: ' + z.steps[0].say);
}
t.done();
