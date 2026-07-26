// Virtual machines (virt-*.js): trap-and-emulate counts worked by hand for each technique and architecture, the
// Popek–Goldberg condition; the two-dimensional walk count (g + 1)(h + 1) − 1 for every pair of levels, with the
// final host address checked by composing two independent S.Mem walks; shadow against nested paging by hand;
// the I/O paths; namespaces as views of one process table; and the cgroup scheduler against an independent
// reimplementation on random configurations.
import { load, harness, rng } from './load.mjs';

const t = harness('virt');
const S = load(['core']);
const V = S.Virt;
const clean = (steps, what) => { for (const s of steps) if (typeof s.say !== 'string' || !s.say || /undefined|NaN/.test(s.say)) { t.ok(false, what + ': bad say ' + JSON.stringify(s.say)); return; } t.ok(true, what); };

// ---- trap-and-emulate ----
{
  t.eq(V.popekGoldberg('x86').violators, ['popf', 'pushf', 'smsw', 'sgdt'], 'x86 before hardware support: sensitive but unprivileged');
  t.eq([V.popekGoldberg('classic').virtualisable, V.popekGoldberg('x86').virtualisable], [true, false], 'Popek–Goldberg condition');
  t.ok(/four of them, among some seventeen on real 32-bit x86/.test(V.popekGoldberg('x86').say), 'the x86 list is presented as a sample, not the whole set');
  const sm = V.run({ technique: 'trap-emulate', arch: 'x86', program: [{ op: 'smsw' }] }).steps.find((s) => s.op === 'smsw').say;
  t.ok(/real CR0/.test(sm) && !/user mode|kernel mode/.test(sm), 'smsw reads the real CR0 bits; it does not reveal the mode');
  const te = V.run({ technique: 'trap-emulate', arch: 'x86' });
  t.eq([te.traps, te.wrong.map((w) => w.op), te.native], [3, ['popf', 'pushf', 'sgdt'], 5], 'x86 trap-and-emulate: 3 traps, 3 silent errors');
  const cl = V.run({ technique: 'trap-emulate', arch: 'classic' });
  t.eq([cl.traps, cl.wrong.length, cl.cycles], [6, 0, 6 * 500 + 2], 'classic: every sensitive instruction traps');
  const bt = V.run({ technique: 'binary-translation', repeat: 3 });
  t.eq([bt.traps, bt.translated, bt.emulated, bt.wrong.length, bt.cycles], [0, 6, 18, 0, 8 * 50 + 3 * (6 * 20 + 2)], 'binary translation: translate once, call three times');
  t.eq(bt.steps.filter((s) => s.kind === 'cache').length, 2, 'the translation cache serves passes 2 and 3');
  const hw = V.run({ technique: 'hardware' });
  t.eq([hw.exits, hw.wrong.length], [1, 0], 'hardware support with nested paging: only the I/O exits');
  t.eq(V.run({ technique: 'hardware', ept: false }).exits, 2, 'without nested paging the page-table base exits too');
  // the virtual CPU follows the guest's intent when the instruction is caught
  const v1 = V.run({ technique: 'trap-emulate', arch: 'classic', program: [{ op: 'cli' }, { op: 'popf', arg: 1 }, { op: 'lcr3', arg: 0x5000 }] });
  const last = v1.steps[v1.steps.length - 1];
  t.eq([last.vcpu.IF, last.vcpu.cr3], [true, 0x5000], 'cli then popf restores the virtual interrupt flag');
  const v2 = V.run({ technique: 'trap-emulate', arch: 'x86', program: [{ op: 'cli' }, { op: 'popf', arg: 1 }] });
  t.eq(v2.steps[v2.steps.length - 1].vcpu.IF, false, 'on x86 the popf is lost: the guest thinks interrupts are on, the VMM does not');
  t.ok(v2.steps.every((s) => s.real.mode === 'user'), 'the guest kernel really runs in user mode');
  for (const r of [te, cl, bt, hw]) clean(r.steps, 'trap narration ' + r.technique);
}
// ---- the two-dimensional walk ----
{
  t.eq([V.count2d(4, 4), V.count2d(1, 1), V.count2d(5, 5), V.count2d(2, 4)], [24, 3, 35, 14], 'the formula');
  const M = S.Mem;
  for (let g = 1; g <= 5; g++) for (let h = 1; h <= 5; h++) for (const seed of [1, 2]) {
    const w = V.walk2d({ guestLevels: g, hostLevels: h, seed });
    t.eq(w.accesses, (g + 1) * (h + 1) - 1, 'table reads for ' + g + ' × ' + h);
    t.eq([w.steps.filter((s) => s.kind === 'host-read').length, w.steps.filter((s) => s.kind === 'guest-read').length], [(g + 1) * h, g], 'host and guest reads for ' + g + ' × ' + h);
    // independently: translate guest-virtual with the guest table, then guest-physical with the host table
    const gpa = M.translate(w.guest, w.gva).pa, hpa = M.translate(w.host, gpa).pa;
    t.eq([w.gpa, w.hpa], [gpa, hpa], 'the 2-D walk ends where two separate walks do, ' + g + ' × ' + h + ' seed ' + seed);
    // each guest-entry read lands where the host maps that entry's guest-physical address
    const gw = M.translate(w.guest, w.gva).steps.filter((s) => s.kind === 'read');
    const gr = w.steps.filter((s) => s.kind === 'guest-read');
    t.eq(gr.map((s) => s.addr), gw.map((s) => M.translate(w.host, s.entryAddr).pa), 'guest entries read at their host addresses, ' + g + ' × ' + h);
    t.ok(w.grid.every((row) => row.every((c) => c)), 'every cell of the grid is visited, ' + g + ' × ' + h);
  }
  clean(V.walk2d({}).steps, '2-D walk narration');
}
// ---- shadow against nested paging ----
{
  const sh = V.memVirt({ technique: 'shadow' }), ne = V.memVirt({ technique: 'nested' });
  t.eq([sh.exits, sh.walkReads, sh.tlbMisses, sh.faults], [5, 24, 6, 1], 'shadow by hand: map, switch, fault, map, switch exit');
  t.eq([ne.exits, ne.walkReads, ne.tlbMisses, ne.faults], [0, 144, 6, 1], 'nested by hand: no exits, 24 reads per miss');
  const r = rng(12);
  for (let trial = 0; trial < 40; trial++) {
    const events = Array.from({ length: 5 + Math.floor(r() * 15) }, () => { const x = r(); return x < 0.6 ? { op: 'access', page: Math.floor(r() * 6) } : x < 0.75 ? { op: 'map', page: Math.floor(r() * 6) } : x < 0.85 ? { op: 'unmap', page: Math.floor(r() * 6) } : { op: 'switch', to: r() < 0.5 ? 'P' : 'Q' }; });
    const g = 2 + Math.floor(r() * 3), h = 2 + Math.floor(r() * 3);
    const a = V.memVirt({ technique: 'shadow', events, guestLevels: g, hostLevels: h }), b = V.memVirt({ technique: 'nested', events, guestLevels: g, hostLevels: h });
    t.eq([a.tlbMisses, a.faults], [b.tlbMisses, b.faults], 'both designs miss and fault alike, trial ' + trial);
    t.eq([a.walkReads, b.walkReads], [a.tlbMisses * g, b.tlbMisses * V.count2d(g, h)], 'walk costs, trial ' + trial);
    const want = events.filter((e) => e.op !== 'access').length + a.faults * 2;
    t.eq([a.exits, b.exits], [want, 0], 'shadow exits on every table change, switch and fault, trial ' + trial);
  }
  clean(sh.steps.concat(ne.steps), 'paging narration');
}
// ---- I/O virtualisation and crossings ----
{
  const c = Object.fromEntries(V.compareIO({ requests: 8, regs: 4, batch: 8 }).map((r) => [r.mode, [r.exits, r.injections, r.copies]]));
  t.eq(c, { emulated: [40, 8, 16], paravirtual: [1, 1, 8], passthrough: [0, 0, 0] }, 'exits for 8 requests');
  t.eq(V.ioPath('paravirtual', { requests: 10, batch: 4 }).exits, 3, 'ceil(10 / 4) notifications');
  t.eq(V.ioPath('passthrough', { requests: 5, posted: false }).exits, 5, 'without posted interrupts each completion exits');
  const x = V.crossings({ io: 'emulated', regs: 3 });
  t.eq(x.rows.map((r) => [r.modeSwitches, r.exits, r.kernels]), [[2, 0, 1], [2, 0, 1], [2, 4, 2]], 'native, container and VM for one read');
  clean(V.ioPath('emulated').steps.concat(x.steps), 'I/O narration');
}
// ---- namespaces ----
{
  const sys = V.containers();
  t.eq(sys.procs.map((p) => [p.pid, p.name, p.ns.pid, p.nsPid]), [[1, 'init', 'host', 1], [2, 'sshd', 'host', 2], [3, 'containerd', 'host', 3], [4, 'nginx', 'web', 1], [5, 'worker', 'web', 2], [6, 'worker', 'web', 3], [7, 'dbserver', 'db', 1], [8, 'writer', 'db', 2]], 'one process table, two pid namespaces');
  const web = V.view(sys, 5);
  t.eq([web.pids.map((p) => p.seen), web.hostname, web.net], [[1, 2, 3], 'web-1', ['lo', 'eth0 10.1.0.2']], 'the web container\'s view');
  t.eq(V.view(sys, 1).pids.length, 8, 'the host sees every process');
  t.eq([V.signal(sys, 4, 2).target, V.signal(sys, 4, 7).ok, V.signal(sys, 1, 7).target], [5, false, 7], 'kill resolves pids in the sender\'s namespace');
  const shared = V.containers({ containers: [{ name: 'tool', procs: ['probe'], share: { net: 'host' } }] });
  t.eq(V.view(shared, 4).net, V.view(shared, 1).net, 'a container sharing the host network sees its interfaces');
  clean(web.steps, 'namespace narration');
  // every process appears in exactly the views of its own pid namespace and the host's
  const r = rng(3);
  for (let trial = 0; trial < 20; trial++) {
    const cs = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({ name: 'c' + i, procs: Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => 'p' + k) }));
    const s2 = V.containers({ containers: cs });
    let ok = true;
    for (const p of s2.procs) {
      const seen = V.view(s2, p.pid).pids;
      const want = s2.procs.filter((q) => p.ns.pid === 'host' || q.ns.pid === p.ns.pid);
      if (seen.length !== want.length || seen.some((x, i) => x.hostPid !== want[i].pid)) ok = false;
      if (p.ns.pid !== 'host' && seen.map((x) => x.seen).join() !== want.map((_, i) => i + 1).join()) ok = false;
    }
    t.ok(ok, 'views match the namespaces, trial ' + trial);
  }
}
// ---- cgroups against an independent scheduler ----
{
  const d = V.cgroups({});
  t.eq([d.groups.web.cpu, d.groups.batch.cpu, d.groups.db.cpu], [16, 6, 8], 'hand-checked default run');
  t.eq(d.groups.db.killed, ['cache'], 'the db group\'s largest process is killed when it passes its limit');
  t.ok(d.groups.batch.throttled > 0, 'the batch group is throttled');
  clean(d.steps, 'cgroup narration');
  const indep = (o) => {
    const P = o.period, gs = o.groups.map((g, i) => ({ ...g, i, cpu: 0, used: 0 })), ps = o.procs.map((p, i) => ({ ...p, i, cpu: 0, mem: 0, alive: true, left: p.work }));
    const order = [];
    for (let tt = 0; tt < o.ticks; tt++) {
      if (tt % P === 0) gs.forEach((g) => { g.used = 0; });
      const run = ps.filter((p) => p.alive && p.left > 0);
      const cand = gs.filter((g) => run.some((p) => p.group === g.name) && (g.quota == null || g.used < g.quota));
      if (!cand.length) { order.push(null); continue; }
      let best = cand[0];
      for (const g of cand) if (g.cpu * best.weight < best.cpu * g.weight) best = g;
      let pr = null;
      for (const p of run) if (p.group === best.name && (!pr || p.cpu < pr.cpu)) pr = p;
      pr.cpu++; pr.left--; best.cpu++; best.used++; pr.mem += pr.memPerTick || 0;
      order.push(pr.name);
      if (best.memLimit != null) {
        const mine = ps.filter((p) => p.alive && p.group === best.name);
        if (mine.reduce((a, p) => a + p.mem, 0) > best.memLimit) { let v = mine[0]; for (const p of mine) if (p.mem > v.mem) v = p; v.alive = false; }
      }
    }
    return order;
  };
  const r = rng(44);
  for (let trial = 0; trial < 60; trial++) {
    const ng = 1 + Math.floor(r() * 3);
    const groups = Array.from({ length: ng }, (_, i) => ({ name: 'g' + i, weight: [50, 100, 200, 300][Math.floor(r() * 4)], quota: r() < 0.4 ? 1 + Math.floor(r() * 4) : null, memLimit: r() < 0.3 ? 5 + Math.floor(r() * 10) : null }));
    const procs = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({ name: 'p' + i, group: 'g' + Math.floor(r() * ng), work: r() < 0.5 ? Infinity : 1 + Math.floor(r() * 12), memPerTick: Math.floor(r() * 3) }));
    const o = { groups, procs, period: 3 + Math.floor(r() * 8), ticks: 10 + Math.floor(r() * 30) };
    const got = V.cgroups(o);
    t.eq(got.segs.map((s) => s.proc), indep(o), 'cgroup schedule matches an independent scheduler, trial ' + trial);
    // no group runs more than its quota in any period
    let within = true;
    for (const g of groups) if (g.quota != null) {
      const per = {};
      for (const s of got.segs) if (s.group === g.name) { const k = Math.floor(s.t / o.period); per[k] = (per[k] || 0) + 1; }
      if (Object.values(per).some((n) => n > g.quota)) within = false;
    }
    t.ok(within, 'quotas hold in every period, trial ' + trial);
  }
}
// ---- narration slips: every say string from seeded runs of every function ----
const sayLint = (() => {
  const SING = ['item', 'message', 'byte', 'operation', 'slot', 'spin', 'tick', 'call', 'entry', 'request', 'exit', 'copy', 'trap', 'read', 'failure', 'guess', 'instruction', 'register', 'page', 'run', 'notification', 'interrupt', 'domain', 'right', 'finding', 'level', 'miss', 'fault', 'thing', 'unit', 'cycle', 'digit', 'character', 'reply', 'try', 'process', 'switch', 'triple', 'list', 'key', 'lock', 'capability', 'service', 'client', 'second', 'write', 'transition', 'event', 'round', 'attempt'];
  const plural = (w) => (/(ss|sh|ch|x)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
  const PL = new Map(SING.map((w) => [plural(w), w]));
  const vowelOk = /^(use|usa|uni|uin|one|once|eu|ur)/i, consOk = /^(hour|honest|honou)/i;
  // words that follow a name such as process A, not the article a
  const FN = new Set(['is', 'as', 'at', 'in', 'on', 'of', 'or', 'and', 'are', 'also', 'again', 'until', 'up', 'if', 'its', 'it', 'opens', 'owns', 'ends', 'exits', 'enters', 'uses', 'accepts', 'asks', 'unlinks', 'ran', 'eats', 'issues', 'even', 'once', 'only']);
  const collect = (x, out, seen) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return out;
    seen.add(x);
    if (typeof x.say === 'string') out.push(x.say);
    else if ('say' in x && x.say !== undefined) out.push('[say is ' + typeof x.say + ']');
    for (const v of Object.values(x)) if (v && typeof v === 'object') collect(v, out, seen);
    return out;
  };
  const slips = (s) => {
    const bad = [];
    if (/undefined|NaN|\bnull\b|\[object|Infinity/.test(s)) bad.push('undefined/NaN/null');
    if (!s.trim()) bad.push('empty');
    for (const m of s.matchAll(/(?<![\w.−-])1 ([a-z]+)\b/g)) if (PL.has(m[1])) bad.push('"1 ' + m[1] + '"');
    for (const m of s.matchAll(/(?<![\w.])(\d+|zero|two|three|four) ([a-z]+)(?=[.,;:)]|$| (?:of|and|in|for|so|to|but|with|from|after|before|each|per)\b)/g)) if (m[1] !== '1' && SING.includes(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/(?<![\w/'])(a|A) ([A-Za-z]\w*)/g)) if (!FN.has(m[2]) && /^[aeiou]/i.test(m[2]) && !vowelOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) ([A-Za-z]\w*)/g)) if (!/^[aeiou]/i.test(m[2]) && !consOk.test(m[2]) && !/^[A-Z]{2,}/.test(m[2]) && !/^[A-Z]$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(a|A) (8|11|18|80\d*|8\d)\b/g)) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b(an|An) (\d+)/g)) if (!/^(8|11|18|8\d*)$/.test(m[2])) bad.push('"' + m[0] + '"');
    for (const m of s.matchAll(/\b([A-Za-z]+) \1\b/gi)) if (!/^[0-9a-f]{2}$/i.test(m[1])) bad.push('doubled "' + m[0] + '"');
    return bad;
  };
  return (t, results, what) => {
    const says = [];
    for (const r of results) collect(r, says, new Set());
    const found = [];
    for (const s of new Set(says)) for (const b of slips(s)) found.push(b + ' in: ' + s);
    t.ok(says.length > 0, what + ': some narration to scan');
    t.ok(!found.length, what + ': ' + found.length + ' slips, e.g.\n  ' + Array.from(new Set(found.map((f) => f.split(' in: ')[0]))).slice(0, 40).map((k) => found.find((f) => f.startsWith(k))).join('\n  '));
    return found;
  };
})();
{
  const r = rng(404), out = [];
  const ops = Object.keys(V.INSTR).concat(['mystery']);
  for (let seed = 1; seed <= 30; seed++) {
    out.push(V.popekGoldberg('x86'), V.popekGoldberg('classic'));
    for (const technique of ['trap-emulate', 'binary-translation', 'hardware']) out.push(V.run({ technique, arch: r() < 0.5 ? 'x86' : 'classic', repeat: 1 + Math.floor(r() * 3), ept: r() < 0.5, program: Array.from({ length: 1 + Math.floor(r() * 6) }, () => ({ op: ops[Math.floor(r() * ops.length)], arg: Math.floor(r() * 2) })) }));
    out.push(V.walk2d({ guestLevels: 1 + Math.floor(r() * 5), hostLevels: 1 + Math.floor(r() * 5), seed }));
    const events = Array.from({ length: 1 + Math.floor(r() * 8) }, () => { const x = r(); return x < 0.6 ? { op: 'access', page: Math.floor(r() * 4) } : x < 0.75 ? { op: 'map', page: Math.floor(r() * 4) } : x < 0.85 ? { op: 'unmap', page: Math.floor(r() * 4) } : { op: 'switch', to: r() < 0.5 ? 'P' : 'R' }; });
    for (const technique of ['shadow', 'nested']) out.push(V.memVirt({ technique, events, tlb: r() < 0.8 }));
    for (const m of ['emulated', 'paravirtual', 'passthrough']) out.push(V.ioPath(m, { requests: 1 + Math.floor(r() * 9), regs: 1 + Math.floor(r() * 4), batch: 1 + Math.floor(r() * 9), posted: r() < 0.5 }));
    out.push(V.crossings({ io: ['emulated', 'paravirtual', 'passthrough'][Math.floor(r() * 3)], requests: 1 + Math.floor(r() * 3) }));
    const sys = V.containers({ containers: [{ name: 'c', procs: Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => 'p' + i), share: r() < 0.5 ? { net: 'host' } : {} }] });
    for (const p of sys.procs) out.push(V.view(sys, p.pid), V.signal(sys, p.pid, 1 + Math.floor(r() * 6)));
    out.push(V.cgroups({ groups: [{ name: 'g', weight: 100, quota: r() < 0.5 ? 1 : null, memLimit: r() < 0.5 ? 3 : null }, { name: 'h', weight: 300 }], procs: [{ name: 'a', group: 'g', work: 1 + Math.floor(r() * 5), memPerTick: 1 }, { name: 'b', group: 'g', memPerTick: 2 }, { name: 'c', group: 'h', work: Math.floor(r() * 3) + 1 }], period: 1 + Math.floor(r() * 5), ticks: 1 + Math.floor(r() * 20) }));
  }
  for (let g = 1; g <= 5; g++) for (let h = 1; h <= 5; h++) for (const technique of ['shadow', 'nested']) out.push(V.memVirt({ technique, guestLevels: g, hostLevels: h }));
  sayLint(t, out, 'virt narration slips');
}
t.done();
