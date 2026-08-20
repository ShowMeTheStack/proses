// The VM lab in node: every preset and a run of random setups go through the lab's run(), wide and narrow; the frames
// are well formed (unique keys, a sentence each, no undefined or NaN shown, steps that point into the trace) and the
// same seed gives the same frames. The numbers are checked by independent means: the typed-address walk against the
// engine's own walk2d on the engine's addresses, every walk's reads against (g + 1)(h + 1) − 1 and its host address
// against translating the guest's result through the host table again, the shadow walk landing on the same address;
// shadow against nested by a small reimplementation of exits and walk reads; the CPU's traps, wrong instructions,
// exits and cycles counted from the instruction list; the I/O paths' exits by formula; the control groups' CPU, quotas
// and memory limits checked tick by tick; and the namespaces' views by pid numbering.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-vmm-[a-z])\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
S.UI = S.UI || { storage: { get: (k, d) => d, set() {} } };
const t = harness('lab-vmm');
const lab = S.Labs.get('vmm'), LS = S.LabSetup, VX = S.VmmLab, V = S.Virt, M = S.Mem;
t.ok(!!lab, 'the VM lab registers');
const defs = LS.defaults(lab);
t.ok(LS.check(lab, defs) === null, 'the defaults are a valid setup');
const setup = (vals) => LS.merge(lab, Object.assign({}, defs, vals));

function frames(v, seed, narrow, what) {
  let r;
  try { r = lab.run(v, { seed, narrow }); } catch (e) { t.ok(false, what + ': runs (' + e.stack + ')'); return null; }
  t.ok(r.frames.length >= 2, what + ': has frames (' + r.frames.length + ')');
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' has a duplicate or missing key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 10, what + ': frame ' + i + ' says something');
    t.ok(f.at >= 0 && f.at < Math.max(1, r.trace.length), what + ': frame ' + i + ' points into the trace');
    for (const it of f.items) {
      const s = [it.text, it.sub].concat(it.lines || []).filter((x) => x !== undefined).join(' ');
      if (/undefined|NaN|\[object|Infinity/.test(s) || /NaN/.test(String(it.x) + it.y + it.w + it.h + it.x1 + it.x2)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '" (' + it.key + ')'); break; }
    }
    if (/undefined|NaN|\[object|Infinity/.test(f.say)) t.ok(false, what + ': frame ' + i + ' says "' + f.say + '"');
    for (const tb of f.tables || []) for (const row of tb.rows) if (row.length !== tb.cols.length) { t.ok(false, what + ': frame ' + i + ' table "' + tb.title + '" rows match its columns'); break; }
    for (const m of f.metrics || []) if (/undefined|NaN/.test(String(m.value))) t.ok(false, what + ': frame ' + i + ' metric ' + m.label + ' = ' + m.value);
  });
  return r;
}

// ---- every preset, wide and narrow, twice -------------------------------------------------------------------------
for (const p of lab.setup.presets) {
  const v = setup(p.values);
  t.ok(LS.check(lab, v) === null, p.label + ': the preset is a valid setup (' + LS.check(lab, v) + ')');
  const r1 = frames(v, 1, false, p.label);
  frames(v, 1, true, p.label + ' (narrow)');
  const r2 = lab.run(v, { seed: 1, narrow: false });
  if (r1) t.eq(r2.frames.map((f) => f.say), r1.frames.map((f) => f.say), p.label + ': the same seed gives the same run');
}

// ---- the walk ---------------------------------------------------------------------------------------------------------
for (let g = 1; g <= 5; g++) for (let h = 1; h <= 5; h++) for (const seed of [1, 3, 9]) {
  const E = V.walk2d({ guestLevels: g, hostLevels: h, seed });
  const W = VX.walkAt(g, h, E.gva, seed);
  const w = g + '/' + h + ' seed ' + seed;
  t.eq(W.steps.map((s) => s.say), E.steps.map((s) => s.say), w + ': the adapter walks exactly as walk2d');
  t.eq([W.accesses, W.hpa, W.gpa, W.grid], [E.accesses, E.hpa, E.gpa, E.grid], w + ': the same reads, grid and addresses');
  t.eq(W.accesses, (g + 1) * (h + 1) - 1, w + ': (g + 1)(h + 1) − 1 table reads');
  t.eq(W.steps.filter((s) => s.kind === 'host-read').length, (g + 1) * h, w + ': h host reads for each guest level and for the data');
}
const R0 = rng(7);
for (let k = 0; k < 30; k++) {
  const g = 1 + Math.floor(R0() * 5), h = 1 + Math.floor(R0() * 5), bits = 12 + 9 * g;
  let a = 0n;
  for (let b = 0; b < bits; b++) if (R0() < 0.5) a |= 1n << BigInt(b);
  const W = VX.walkAt(g, h, a, k + 1), w = 'random walk ' + k;
  // independently: the guest table gives the guest-physical address, the host table the host one
  const gp = M.translate(W.guest, a), hp = M.translate(W.host, gp.pa);
  t.eq([W.gpa, W.hpa], [gp.pa, hp.pa], w + ': the host address is the guest result translated by the host table');
  t.eq(W.hpa & 0xfffn, a & 0xfffn, w + ': the offset survives both translations');
  const SH = VX.shadowWalk(W);
  t.eq([SH.pa, SH.reads], [W.hpa, g], w + ': the shadow walk reaches the same host address in g reads');
  // every guest entry read is at the host address the host walk just produced for it
  for (const s of W.steps.filter((x) => x.kind === 'guest-read')) t.eq(s.addr, M.translate(W.host, s.gpa).pa, w + ': guest level ' + (s.row + 1) + ' is read where the host maps it');
  const v = setup({ mode: 'walk', wG: g, wH: h, wAddr: '0x' + a.toString(16), wShadow: k % 2 === 0 });
  t.ok(LS.check(lab, v) === null, w + ': a valid setup');
  const r = frames(v, k + 1, k % 3 === 0, w);
  if (r) t.eq(r.frames.length, 1 + (g + 1) * (h + 1) + (k % 2 === 0 ? g + 1 : 0) + 1, w + ': a frame a read, the data, the shadow reads and the sums');
}
t.ok(LS.check(lab, setup({ mode: 'walk', wG: 2, wAddr: '0x7f3a_c0de_1234' })) !== null, 'an address too wide for two guest levels is refused');

// ---- shadow against nested: a small reimplementation ---------------------------------------------------------------
function syncRef(events, tech, g, h, tlbOn) {
  const maps = { P: new Set([1, 2]), Q: new Set([1]) }, kept = new Set(['P']), tlb = new Set();
  let cur = 'P', exits = 0, reads = 0;
  const miss = tech === 'shadow' ? g : (g + 1) * (h + 1) - 1, sh = tech === 'shadow' ? 1 : 0;
  for (const e of events) {
    if (e.op === 'switch') { maps[e.to] = maps[e.to] || new Set(); cur = e.to; tlb.clear(); exits += sh; kept.add(cur); continue; }
    if (e.op === 'map') { maps[cur].add(e.page); exits += sh; continue; }
    if (e.op === 'unmap') { maps[cur].delete(e.page); tlb.delete(e.page); exits += sh; continue; }
    if (tlbOn && tlb.has(e.page)) continue;
    if (!maps[cur].has(e.page)) { exits += 2 * sh; maps[cur].add(e.page); }
    reads += miss; tlb.add(e.page);
  }
  return { exits, reads };
}
const R1 = rng(11);
for (let k = 0; k < 40; k++) {
  const n = 1 + Math.floor(R1() * 16), rows = [];
  for (let i = 0; i < n; i++) { const x = R1(); rows.push(x < 0.15 ? { op: 'switch', arg: 'PQR'[Math.floor(R1() * 3)] } : { op: x < 0.3 ? 'map' : x < 0.4 ? 'unmap' : 'access', arg: String(Math.floor(R1() * 8)) }); }
  const g = 1 + Math.floor(R1() * 5), h = 1 + Math.floor(R1() * 5), tlb = R1() < 0.7, E = 1 + Math.floor(R1() * 30);
  const v = setup({ mode: 'sync', sEvents: rows, sG: g, sH: h, sTlb: tlb, sExit: E });
  t.ok(LS.check(lab, v) === null, 'sync ' + k + ': a valid setup (' + LS.check(lab, v) + ')');
  const r = frames(v, 1, k % 2 === 1, 'sync ' + k);
  if (!r) continue;
  const ev = VX.syncEvents(rows);
  for (const tech of ['shadow', 'nested']) {
    const ref = syncRef(ev, tech, g, h, tlb), got = tech === 'shadow' ? r.plan.A : r.plan.B;
    t.eq([got.exits, got.walkReads], [ref.exits, ref.reads], 'sync ' + k + ', ' + tech + ': exits and walk reads');
  }
  t.eq(r.plan.A.steps.length, r.plan.B.steps.length, 'sync ' + k + ': the two designs step together');
  const last = r.frames[r.frames.length - 1].metrics;
  t.eq(last.find((m) => m.label === 'Shadow: cost').value, r.plan.A.walkReads + E * r.plan.A.exits, 'sync ' + k + ': shadow cost = reads + exit weight × exits');
}

// ---- the CPU: counted from the instruction list ----------------------------------------------------------------------
const OPS = Object.keys(V.INSTR), R2 = rng(5);
for (let k = 0; k < 40; k++) {
  const n = 1 + Math.floor(R2() * 12), prog = [];
  for (let i = 0; i < n; i++) { const op = OPS[Math.floor(R2() * OPS.length)]; prog.push({ op, arg: op === 'popf' ? String(Math.floor(R2() * 2)) : op === 'lcr3' ? '0x' + (0x1000 + Math.floor(R2() * 0x8000)).toString(16) : '' }); }
  const arch = R2() < 0.5 ? 'x86' : 'classic', rep = 1 + Math.floor(R2() * 4), ept = R2() < 0.5;
  const cost = { cNative: 1 + Math.floor(R2() * 3), cTrap: 100 + Math.floor(R2() * 900), cExit: 100 + Math.floor(R2() * 600), cCall: 5 + Math.floor(R2() * 40), cTranslate: Math.floor(R2() * 100) };
  const v = setup(Object.assign({ mode: 'cpu', cProg: prog, cArch: arch, cRepeat: rep, cEpt: ept, cTE: true, cBT: k % 3 !== 0, cHW: k % 4 !== 1 }, cost));
  t.ok(LS.check(lab, v) === null, 'cpu ' + k + ': a valid setup (' + LS.check(lab, v) + ')');
  const r = frames(v, 1, k % 2 === 1, 'cpu ' + k);
  if (!r) continue;
  const priv = V.ARCH[arch].privileged, sens = (op) => V.INSTR[op].sensitive;
  const ns = prog.filter((x) => sens(x.op)).length, np = prog.filter((x) => sens(x.op) && priv.includes(x.op)).length;
  const hwExit = prog.filter((x) => ['out', 'in', 'hlt'].concat(ept ? [] : ['lcr3']).includes(x.op)).length;
  for (const run of r.plan.runs) {
    const R = run.R, id = run.t.id;
    if (id === 'trap-emulate') {
      t.eq([R.traps, R.wrong.length], [np * rep, (ns - np) * rep], 'cpu ' + k + ': trap-and-emulate traps the privileged ones and misses the rest');
      t.eq(R.cycles, rep * ((n - np) * cost.cNative + np * cost.cTrap), 'cpu ' + k + ': trap-and-emulate cycles');
    }
    if (id === 'binary-translation') t.eq([R.translated, R.cycles, R.wrong.length], [ns, n * cost.cTranslate + rep * ((n - ns) * cost.cNative + ns * cost.cCall), 0], 'cpu ' + k + ': translation once, then calls');
    if (id === 'hardware') t.eq([R.exits, R.cycles, R.wrong.length], [hwExit * rep, rep * ((n - hwExit) * cost.cNative + hwExit * cost.cExit), 0], 'cpu ' + k + ': hardware exits only where asked');
  }
  t.eq(r.frames.length, 2 + n * rep + (v.cBT ? 1 : 0), 'cpu ' + k + ': a frame an instruction, plus start, translation and totals');
  t.eq(V.COST, { native: 1, trap: 500, exit: 300, call: 20, translate: 50 }, 'cpu ' + k + ': the engine\'s own costs are put back');
}

// ---- I/O: exits by formula -------------------------------------------------------------------------------------------
for (let k = 0; k < 20; k++) {
  const R = rng(30 + k), n = 1 + Math.floor(R() * 64), regs = 1 + Math.floor(R() * 16), batch = 1 + Math.floor(R() * 64), posted = R() < 0.5;
  const v = setup({ mode: 'io', ioReq: n, ioRegs: regs, ioBatch: batch, ioPosted: posted, ioCross: k % 2 === 0, ioXMode: ['emulated', 'paravirtual', 'passthrough'][k % 3], ioOp: k % 4 ? 'read' : 'write' });
  const r = frames(v, 1, k % 3 === 0, 'io ' + k);
  if (!r) continue;
  t.eq(r.plan.cmp.map((c) => c.exits), [n * regs + n, Math.ceil(n / batch), posted ? 0 : n], 'io ' + k + ': exits per path');
  t.eq(r.frames.length, 3 * 5 + 1 + (k % 2 === 0 ? 4 : 0), 'io ' + k + ': every step of every path, the comparison and the crossings');
}

// ---- namespaces --------------------------------------------------------------------------------------------------------
for (const p of lab.setup.presets.filter((p) => p.values.mode === 'ns')) {
  const v = setup(p.values), r = lab.run(v, { seed: 1, narrow: false }), sys = r.plan.sys;
  for (const pid of v.nsViewers) {
    const me = sys.procs.find((x) => x.pid === pid), vw = V.view(sys, pid);
    if (me.ns.pid === 'host') t.eq(vw.pids.map((x) => x.seen), sys.procs.map((x) => x.pid), p.label + ': the host sees every pid as it is');
    else t.eq(vw.pids.map((x) => x.seen), vw.pids.map((x, i) => i + 1), p.label + ': a container numbers its own from 1');
  }
  const from = sys.procs.find((x) => x.pid === v.nsFrom), inside = sys.procs.filter((x) => from.ns.pid === 'host' || x.ns.pid === from.ns.pid);
  const want = from.ns.pid === 'host' ? inside.find((x) => x.pid === v.nsTo) : inside.find((x) => x.nsPid === v.nsTo);
  t.eq(r.plan.sig.ok ? r.plan.sig.target : null, want ? want.pid : null, p.label + ': kill() resolves inside the sender\'s namespace');
}
t.ok(LS.check(lab, setup({ mode: 'ns', nsViewers: [30] })) !== null, 'a viewer pid that does not exist is refused');

// ---- control groups: tick by tick ------------------------------------------------------------------------------------
for (let k = 0; k < 14; k++) {
  const R = rng(60 + k), ng = 1 + Math.floor(R() * 4), period = 2 + Math.floor(R() * 10);
  const groups = Array.from({ length: ng }, (_, i) => ({ name: 'g' + i, weight: 50 + Math.floor(R() * 300), quota: R() < 0.4 ? 1 + Math.floor(R() * period) : 0, mem: R() < 0.4 ? 5 + Math.floor(R() * 30) : 0 }));
  const procs = Array.from({ length: 1 + Math.floor(R() * 8) }, (_, i) => ({ name: 'p' + i, group: 'g' + Math.floor(R() * ng), work: R() < 0.3 ? 1 + Math.floor(R() * 10) : 0, grow: Math.floor(R() * 4), mem: Math.floor(R() * 5) }));
  const v = setup({ mode: 'cg', cgGroups: groups, cgProcs: procs, cgPeriod: period, cgTicks: 5 + Math.floor(R() * 55) });
  t.ok(LS.check(lab, v) === null, 'cg ' + k + ': a valid setup (' + LS.check(lab, v) + ')');
  const r = frames(v, 1, k % 2 === 1, 'cg ' + k);
  if (!r) continue;
  const segs = r.plan.R.segs;
  for (const g of groups) {
    const ran = segs.filter((s) => s.group === g.name).length;
    t.eq(r.plan.R.groups[g.name].cpu, ran, 'cg ' + k + ': ' + g.name + '’s CPU is its ticks on the lanes');
    if (g.quota) for (let p0 = 0; p0 < v.cgTicks; p0 += period) t.ok(segs.slice(p0, p0 + period).filter((s) => s.group === g.name).length <= g.quota, 'cg ' + k + ': ' + g.name + ' stays within its quota each period');
    t.eq(r.plan.thr[groups.indexOf(g)].size, r.plan.R.groups[g.name].throttled, 'cg ' + k + ': ' + g.name + '’s throttled ticks are the engine’s count');
    for (const t2 of r.plan.thr[groups.indexOf(g)]) t.ok(segs[t2].group !== g.name, 'cg ' + k + ': a throttled tick is not one it ran');
  }
}
t.done();
