// Part 4 (threads): every topic run with its default, every preset and random valid inputs, with each frame's
// wording and quoted numbers checked by the shared machinery of claims-p07.mjs. Then the values themselves, against
// a second computation written here: the threading models and the parallel-loop splits by independent simulators,
// the C programs' outputs by working out what they must print, Amdahl's law by the formula, and hand-worked cases.
// Prints "claims-p04 N passed, M failed".
import { load, harness } from './load.mjs';
import { checkTopics } from './claims-p07.mjs';

const S = load(['core', 'stage', 'topics']);
const t = harness('claims-p04');
const H = S.P04;

// ---- an independent threading-model simulator: state per user thread, one tick at a time ----
function models(model, kernel, cores, work) {
  const n = work.length, K = model === 'one-to-one' ? n : model === 'many-to-one' ? 1 : Math.min(kernel, n);
  const th = work.map((w) => ({ parts: w.slice(), at: 0, rem: w[0], fin: null, on: -1 }));
  const carrier = Array(K).fill(-1), last = Array(K).fill(-1), waiting = th.map((_, u) => u);
  let t = 0, busy = 0;
  const computing = (u) => th[u].at % 2 === 0;
  while (th.some((x) => x.fin === null) && t < 400) {
    for (let k = 0; k < K; k++) if (carrier[k] < 0 && waiting.length) { carrier[k] = waiting.shift(); th[carrier[k]].on = k; }
    const can = [];
    for (let k = 0; k < K; k++) if (carrier[k] >= 0 && computing(carrier[k])) can.push(k);
    can.sort((a, b) => last[a] - last[b] || a - b);
    const go = new Set(can.slice(0, cores));
    for (const k of go) last[k] = t;
    busy += go.size;
    for (let u = 0; u < n; u++) {
      const x = th[u];
      if (x.fin !== null || x.on < 0) continue;
      if (!computing(u) || go.has(x.on)) x.rem--;
    }
    t++;
    for (let k = 0; k < K; k++) {
      const u = carrier[k];
      if (u < 0 || th[u].rem > 0) continue;
      th[u].at++;
      if (th[u].at >= th[u].parts.length) { th[u].fin = t; carrier[k] = -1; } else th[u].rem = th[u].parts[th[u].at];
    }
  }
  return { finish: th.map((x) => x.fin), end: t, busy };
}
// ---- an independent parallel-loop splitter ----
function split(costs, W, policy, chunk) {
  const n = costs.length, busy = Array(W).fill(0), who = Array(n).fill(-1);
  if (policy === 'static') { const base = Math.floor(n / W), extra = n % W; let i = 0; for (let w = 0; w < W; w++) for (let k = 0; k < base + (w < extra ? 1 : 0); k++) who[i++] = w; }
  else if (policy === 'cyclic') for (let i = 0; i < n; i++) who[i] = i % W;
  else for (let i = 0; i < n; i += chunk) { const w = busy.indexOf(Math.min(...busy)); for (let k = i; k < Math.min(n, i + chunk); k++) { who[k] = w; busy[w] += costs[k]; } }
  if (policy !== 'dynamic') costs.forEach((c, i) => { busy[who[i]] += c; });
  return { end: Math.max(...busy), busy, who };
}

// hand-worked cases
{
  const m = H.mapSim({ model: 'many-to-one', kernel: 2, cores: 2, work: [[2, 4, 2], [3], [3]] });
  t.eq([m.finish, m.end], [[8, 11, 14], 14], 'many-to-one: U0 blocks for 4 ticks holding the only kernel thread; the others wait');
  const o = H.mapSim({ model: 'one-to-one', kernel: 2, cores: 1, work: [[3], [3], [3], [3]] });
  t.eq([o.finish, o.end, o.busy], [[9, 10, 11, 12], 12, 12], 'one-to-one on one core: turns in order, nothing faster than serial');
  const p = H.mapSim({ model: 'one-to-one', kernel: 2, cores: 2, work: [[2, 4, 2], [3], [3]] });
  t.eq([p.finish, p.end], [[8, 4, 4], 8], 'one-to-one on two cores: U1 and U2 finish while U0 waits in its call');
  const s = H.parfor({ costs: [1, 1, 2, 2, 3, 3, 4, 5, 6], workers: 3, policy: 'static' });
  t.eq([s.busy, s.end], [[4, 8, 15], 15], 'static blocks of growing costs: the last worker gets 4 + 5 + 6');
  const d = H.parfor({ costs: [9, 1, 1, 1, 1, 1, 1, 1], workers: 2, policy: 'dynamic', chunk: 2 });
  t.eq(d.end, 10, 'dynamic by 2 with one slow iteration: 9 + 1 on one worker, 6 on the other');
}

const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const random = {
  'thr-models': (r) => ({ model: ['many-to-one', 'one-to-one', 'many-to-many'][ri(r, 0, 2)], cores: ['1', '2', '4'][ri(r, 0, 2)], kernel: ['2', '3'][ri(r, 0, 1)], work: Array.from({ length: ri(r, 2, 4) }, () => Array.from({ length: [1, 3][ri(r, 0, 1)] }, () => ri(r, 1, 4)).join('/')) }),
  'thr-parfor': (r) => ({ policy: ['static', 'cyclic', 'dynamic'][ri(r, 0, 2)], workers: String(ri(r, 2, 4)), chunk: String(ri(r, 1, 3)), costs: Array.from({ length: ri(r, 4, 12) }, () => String(ri(r, 1, 9))) }),
  'thr-amdahl': (r) => ({ serial: ri(r, 1, 90), max: ['8', '16', '64'][ri(r, 0, 2)], work: ri(r, 10, 500) }),
  'thr-forkjoin': (r) => ({ k: String(ri(r, 1, 4)), data: Array.from({ length: ri(r, 2, 10) }, () => String(ri(r, -50, 99))) }),
  'thr-pool': (r) => ({ workers: String(ri(r, 1, 3)), costs: Array.from({ length: ri(r, 2, 6) }, () => String(ri(r, 1, 5))), seed: ri(r, 1, 50) }),
  'thr-tls': (r) => ({ own: ['shared', 'own'][ri(r, 0, 1)], seed: ri(r, 1, 40) }),
};

const last = (res) => res.frames[res.frames.length - 1];
function extra(tp, input, res, label) {
  const where = tp.id + ' / ' + label;
  const f = last(res);
  switch (tp.id) {
    case 'thr-space': {
      const k = +input.k;
      t.eq(f.meta.final, input.how === 'threads' ? 5 * k * (k + 1) : 0, where + ': threads share one total, children each have their own');
      break;
    }
    case 'thr-share': {
      const a = f.meta.addrs;
      t.ok(a.length === +input.k && new Set(a).size === a.length, where + ': every worker\'s local has its own address');
      t.ok(res.frames.every((x) => !x.meta.sAddr || x.meta.sAddr === f.meta.vals[0]), where + ': shared has one address throughout');
      break;
    }
    case 'thr-models': {
      const work = input.work.map((x) => String(x).split('/').map(Number));
      for (const m of ['many-to-one', 'one-to-one', 'many-to-many']) {
        const mine = models(m, +input.kernel, +input.cores, work);
        t.eq(f.meta.ends[m], mine.end, where + ': ' + m + ' ends where an independent simulation says');
      }
      const mine = models(input.model, +input.kernel, +input.cores, work), sim = H.mapSim({ model: input.model, kernel: +input.kernel, cores: +input.cores, work });
      t.eq([sim.finish, sim.busy], [mine.finish, mine.busy], where + ': finish times and busy core-ticks agree');
      if (input.model === 'many-to-one') t.ok(sim.ticks.every((tk) => tk.core.filter((u) => u !== null).length <= 1), where + ': many-to-one never uses two cores');
      break;
    }
    case 'thr-join': {
      const k = +input.k;
      t.eq(f.meta.sum, Array.from({ length: k }, (_, i) => (i + 2) * (i + 2)).reduce((a, b) => a + b, 0), where + ': join collects every square');
      break;
    }
    case 'thr-tls':
      if (input.own === 'own') t.eq(f.meta.bad, 0, where + ': a slot per thread: no output with a wrong read');
      else t.ok(f.meta.bad > 0 && f.meta.bad < f.meta.outs, where + ': one shared global: some schedules read the other thread\'s code, some do not');
      if (label === 'Shared: a clash') t.ok(/went wrong/.test(f.say), where + ': the preset\'s own schedule shows the clash');
      break;
    case 'thr-pool': {
      const per = f.meta.per, n = input.costs.length;
      t.eq(Object.values(per).reduce((a, b) => a + b, 0), n, where + ': every task is done exactly once');
      break;
    }
    case 'thr-forkjoin':
      t.eq(f.meta.printed, input.data.map(Number).reduce((a, b) => a + b, 0), where + ': the joined parts add up to the array\'s sum');
      break;
    case 'thr-parfor': {
      const costs = input.costs.map(Number);
      for (const p of ['static', 'cyclic', 'dynamic']) t.eq(f.meta.ends[p], split(costs, +input.workers, p, +input.chunk).end, where + ': ' + p + ' ends where an independent split says');
      const lb = Math.max(Math.ceil(costs.reduce((a, b) => a + b, 0) / +input.workers), Math.max(...costs));
      t.ok(Object.values(f.meta.ends).every((e) => e >= lb), where + ': no split beats the lower bound');
      break;
    }
    case 'thr-amdahl': {
      const s = input.serial / 100;
      res.frames.filter((x) => x.meta.sp !== undefined).forEach((x) => { const n = x.meta.vals[0]; t.ok(Math.abs(x.meta.sp - input.work / (input.work * s + (input.work * (1 - s)) / n)) < 0.006, where + ': speed-up at ' + n + ' cores is time on one over time on n'); });
      t.ok(Math.abs(f.meta.limit - 1 / s) < 0.006, where + ': the limit is 1/s');
      break;
    }
    case 'thr-fork':
      t.eq(f.meta.stuck, input.v === 'lock', where + ': only the child that locks the copied, held mutex hangs');
      break;
    case 'thr-exec':
      t.ok(/a new image/.test(f.say), where + ': echo runs after exec');
      break;
    case 'thr-cancel': {
      const bad = res.frames.some((x) => /Deadlock|deadlock/.test(x.say));
      t.eq(bad, input.mode === 'async', where + ': asynchronous cancellation can deadlock, deferred cannot');
      break;
    }
  }
}
const n = checkTopics(S, t, ['p04-'], { random, randomRuns: 5, extra });
console.log('  (' + n + ' topics)');
t.done();
