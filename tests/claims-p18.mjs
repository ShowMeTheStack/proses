// Part 18 (virtual machines and containers): every topic with its default, every preset and random valid inputs; the
// same wording and quoted-number checks as part 9 (tests/claims-p09.mjs), then each topic's counts against a second
// computation written here: which instructions trap, the cycle totals, (g + 1)(h + 1) − 1, a replay of shadow and
// nested paging, the exit formulas for each I/O design, what a namespace shows, and CPU shares by weight.
// Prints "claims-p18 N passed, M failed".
import { pathToFileURL } from 'node:url';
import { runClaims, pick, int } from './claims-p09.mjs';

const SENS = ['cli', 'sti', 'popf', 'pushf', 'smsw', 'sgdt', 'lcr3', 'out', 'in', 'hlt'];
const PRIV = { classic: SENS, x86: ['cli', 'sti', 'lcr3', 'out', 'in', 'hlt'] };
const PROGS = { entry: ['add', 'cli', 'store', 'popf', 'pushf', 'sgdt', 'lcr3', 'out'], irq: ['cli', 'load', 'in', 'store', 'sti', 'hlt'], sched: ['pushf', 'cli', 'lcr3', 'popf', 'add', 'sti'], plain: ['add', 'load', 'store', 'add', 'load'] };
/** cycles of a run, worked out from the costs (native 1, trap 500, exit 300, call 20, translate 50 an instruction) */
function cyclesOf(prog, tech, arch, repeat, ept) {
  let c = 0;
  if (tech === 'binary-translation') c += 50 * prog.length;
  for (let r = 0; r < repeat; r++) for (const op of prog) {
    const s = SENS.includes(op);
    if (!s) { c += 1; continue; }
    if (tech === 'trap-emulate') c += PRIV[arch].includes(op) ? 500 : 1;
    else if (tech === 'binary-translation') c += 20;
    else c += ['out', 'in', 'hlt'].concat(ept === false ? ['lcr3'] : []).includes(op) ? 300 : 1;
  }
  return c;
}
/** shadow and nested paging replayed: exits and walk reads */
function memInd(events, tech, g, h) {
  const procs = { P: new Set([1, 2]), Q: new Set([1]) }, tlb = new Set(), miss = tech === 'shadow' ? g : (g + 1) * (h + 1) - 1;
  let cur = 'P', exits = 0, reads = 0;
  for (const e of events) {
    if (e.op === 'switch') { procs[e.to] = procs[e.to] || new Set(); cur = e.to; tlb.clear(); if (tech === 'shadow') exits++; continue; }
    if (e.op === 'map') { procs[cur].add(e.page); if (tech === 'shadow') exits++; continue; }
    if (e.op === 'unmap') { procs[cur].delete(e.page); tlb.delete(e.page); if (tech === 'shadow') exits++; continue; }
    if (tlb.has(e.page)) continue;
    if (!procs[cur].has(e.page)) { procs[cur].add(e.page); if (tech === 'shadow') exits += 2; }
    reads += miss; tlb.add(e.page);
  }
  return { exits, reads };
}
const ev = (op, x) => (op === 'switch' ? { op, to: x } : { op, page: x });
const EVENTS = {
  mixed: [ev('access', 1), ev('access', 2), ev('access', 1), ev('map', 3), ev('access', 3), ev('switch', 'Q'), ev('access', 1), ev('access', 5), ev('switch', 'P'), ev('access', 2)],
  switchy: [ev('access', 1), ev('switch', 'Q'), ev('access', 1), ev('switch', 'P'), ev('access', 1), ev('switch', 'Q'), ev('access', 1), ev('switch', 'P'), ev('access', 2)],
  mapper: [ev('map', 3), ev('map', 4), ev('map', 5), ev('access', 3), ev('access', 4), ev('access', 5), ev('unmap', 3), ev('map', 6), ev('access', 6)],
  hot: [ev('access', 1), ev('access', 1), ev('access', 2), ev('access', 1), ev('access', 2), ev('access', 2), ev('access', 1)],
};
const ioExits = (mode, n, regs, batch, posted) => (mode === 'emulated' ? n * regs + n : mode === 'paravirtual' ? Math.ceil(n / batch) : posted ? 0 : n);

export const P18 = {
  'virt-popek-goldberg': {
    names: ['32-bit'],
    random: (rnd) => ({ arch: pick(rnd, ['classic', 'x86']) }),
    check({ input, last, near, ok }) {
      near(last().meta.violators, SENS.filter((x) => !PRIV[input.arch].includes(x)).length, 'sensitive but not privileged, counted again');
      ok(last().meta.ok === (input.arch === 'classic'), 'virtualisable exactly on the classic machine');
    },
  },
  'virt-trap-emulate': {
    names: ['32-bit'],
    random: (rnd) => ({ prog: pick(rnd, Object.keys(PROGS)), arch: pick(rnd, ['classic', 'x86']) }),
    check({ input, last, frames, near }) {
      const p = PROGS[input.prog];
      near(frames('trap').length, p.filter((x) => SENS.includes(x) && PRIV[input.arch].includes(x)).length, 'traps: the sensitive, privileged instructions');
      near(frames('wrong').length, p.filter((x) => SENS.includes(x) && !PRIV[input.arch].includes(x)).length, 'wrong: the sensitive instructions that do not trap');
      near(last().meta.cycles, cyclesOf(p, 'trap-emulate', input.arch, 1), 'cycles, worked out from the costs');
    },
  },
  'virt-bt-hw': {
    names: ['32-bit'],
    random: (rnd) => ({ tech: pick(rnd, ['binary-translation', 'hardware']), prog: pick(rnd, Object.keys(PROGS)), repeat: int(rnd, 1, 3), ept: pick(rnd, ['yes', 'no']) }),
    nRandom: 10,
    check({ input, last, near, ok }) {
      near(last().meta.cycles, cyclesOf(PROGS[input.prog], input.tech, 'x86', input.repeat, input.ept === 'yes'), 'cycles, worked out from the costs');
      ok(last().meta.wrong === 0, 'nothing goes wrong');
    },
  },
  'virt-cpu-cost': {
    random: (rnd) => ({ prog: pick(rnd, Object.keys(PROGS)), runs: int(rnd, 2, 20) }),
    check({ input, last, near }) {
      const p = PROGS[input.prog];
      near(last().meta.end, ['trap-emulate', 'binary-translation', 'hardware'].map((t) => cyclesOf(p, t, 'classic', input.runs)), 'the totals after the last run');
    },
  },
  'virt-walk-2d': {
    random: (rnd) => ({ g: int(rnd, 1, 5), h: int(rnd, 1, 5), seed: int(rnd, 1, 999) }),
    nRandom: 12,
    check({ input, frames, near }) {
      const g = input.g, h = input.h;
      near(frames('host-read').length, (g + 1) * h, 'host reads: h for each guest level and for the data');
      near(frames('guest-read').length, g, 'guest entry reads: one a level');
      near(frames('data')[0].meta.total, (g + 1) * (h + 1) - 1, '(g + 1)(h + 1) − 1 table reads');
      near(frames('host-read').concat(frames('guest-read')).map((f) => f.meta.n).sort((a, b) => a - b), Array.from({ length: (g + 1) * (h + 1) - 1 }, (_, k) => k + 1), 'every read numbered once, in order');
    },
  },
  'virt-shadow-nested': {
    random: (rnd) => ({ events: pick(rnd, Object.keys(EVENTS)), g: int(rnd, 1, 5), h: int(rnd, 1, 5) }),
    nRandom: 10,
    check({ input, last, near }) {
      const a = memInd(EVENTS[input.events], 'shadow', input.g, input.h), b = memInd(EVENTS[input.events], 'nested', input.g, input.h), m = last().meta;
      near([m.a[0], m.a[1]], [a.exits, a.reads], 'shadow: exits and walk reads, replayed');
      near([m.b[0], m.b[1]], [b.exits, b.reads], 'nested: exits and walk reads, replayed');
    },
  },
  'virt-io-paths': {
    random: (rnd) => ({ mode: pick(rnd, ['emulated', 'paravirtual', 'passthrough']), n: int(rnd, 1, 64), regs: int(rnd, 1, 8), batch: int(rnd, 1, 32), posted: pick(rnd, ['yes', 'no']) }),
    nRandom: 12,
    check({ input, last, near }) {
      near(last().meta.exits, ioExits(input.mode, input.n, input.regs, input.batch, input.posted === 'yes'), 'exits by the formula');
      near(last().meta.copies, { emulated: 2 * input.n, paravirtual: input.n, passthrough: 0 }[input.mode], 'copies by the formula');
    },
  },
  'virt-io-compare': {
    random: (rnd) => ({ n: int(rnd, 1, 64), batch: int(rnd, 1, 32), regs: int(rnd, 1, 8) }),
    check({ input, last, near }) {
      near(last().meta.e, ['emulated', 'paravirtual', 'passthrough'].map((m) => ioExits(m, input.n, input.regs, input.batch, true)), 'exits of the three designs');
    },
  },
  'virt-vm-container': {
    random: (rnd) => ({ io: pick(rnd, ['emulated', 'paravirtual', 'passthrough']), n: int(rnd, 1, 8) }),
    check({ input, frames, near }) {
      const rows = frames('row');
      near(rows.map((f) => f.meta.sw), [2 * input.n, 2 * input.n, 2 * input.n], 'two mode switches a call in every setting');
      near(rows.map((f) => f.meta.exits), [0, 0, ioExits(input.io, input.n, 4, 1, true)], 'exits only in the virtual machine');
    },
  },
  'virt-namespaces': {
    random: (rnd) => ({ viewer: String(int(rnd, 1, 8)), target: int(rnd, 1, 9) }),
    nRandom: 12,
    check({ input, frames, last, near, ok }) {
      const v = +input.viewer, size = v <= 3 ? 8 : v <= 6 ? 3 : 2;
      near(frames('pid')[0].meta.n, size, 'the processes visible from this namespace');
      ok(last().meta.ok === (input.target <= size), 'kill finds a process exactly when the number exists in the namespace');
    },
  },
  'virt-cgroups': {
    random: (rnd) => ({ cfg: pick(rnd, ['mixed', 'weights', 'quota', 'oom']), ticks: int(rnd, 10, 40), period: int(rnd, 5, 20) }),
    nRandom: 10,
    check({ input, frames, last, near, ok }) {
      const gs = last().meta.groups, idle = frames('idle').length;
      near(gs.reduce((a, g) => a + g.cpu, 0) + idle, input.ticks, 'every tick ran one group or idled');
      if (input.cfg === 'weights') { const w = [300, 200, 100], sum = 600; gs.forEach((g, i) => ok(Math.abs(g.cpu - (input.ticks * w[i]) / sum) <= 1, g.name + ' gets its share by weight, within a tick')); }
      for (const f of frames('tick')) for (const g of f.meta.groups) if (g.quota !== null) ok(g.used <= g.quota, g.name + ' never exceeds its quota in a period');
    },
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) runClaims('claims-p18', /^p18-/, P18);
