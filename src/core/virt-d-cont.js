// Virtual machines, part 4: containers. A container is not a machine: it is a set of ordinary processes on the one
// host kernel, each given its own namespaces (what it can see) and a control group (how much it may use).
//   S.Virt.containers({host: [names], containers: [{name, procs: [names], hostname, mounts, net, share: {net:
//       'host'}}]}) -> sys: {procs: [{pid, ppid, name, ns: {pid, mnt, net, uts}, nsPid}], mounts: {ns: [..]},
//       net: {ns: [..]}, uts: {ns: hostname}}: one kernel's process table, every process tagged with the
//       namespaces it lives in and its pid as its own pid namespace numbers it (1 for a container's first).
//   S.Virt.view(sys, pid) -> {pids: [{seen, name, hostPid}], mounts, net, hostname, steps}: what that process sees
//       (the host's pid namespace sees every process, a container's only its own, renumbered).
//   S.Virt.signal(sys, fromPid, seenPid) -> {ok, target (host pid), say}: kill() resolves a pid inside the
//       sender's own pid namespace.
//   S.Virt.cgroups({groups: [{name, weight: 100, quota: ticks per period | null, memLimit: null}], procs: [{name,
//       group, work: ticks | Infinity, memPerTick: 0, mem: 0}], period: 10, ticks: 30})
//       -> {segs: [{t, proc, group}], groups: {name: {cpu, share, throttled, mem, killed: [..]}}, steps}
//       Each tick the group with the least CPU per unit of weight runs (ties in the order given), unless it has
//       used its quota for this period (then it is throttled until the next period starts); within a group the
//       process that has run least goes. A process that runs grows by memPerTick; when a group's memory passes
//       its limit, the kernel kills the group's largest process (out of memory), and no other group is touched.
(function (S) {
  'use strict';
  const V = (S.Virt = S.Virt || {});

  V.containers = function (o) {
    o = o || {};
    const host = o.host || ['init', 'sshd', 'containerd'];
    const cs = o.containers || [
      { name: 'web', procs: ['nginx', 'worker', 'worker'], hostname: 'web-1', mounts: ['/ (web image)', '/proc', '/data (volume)'], net: ['lo', 'eth0 10.1.0.2'] },
      { name: 'db', procs: ['dbserver', 'writer'], hostname: 'db-1', mounts: ['/ (db image)', '/proc'], net: ['lo', 'eth0 10.1.0.3'] },
    ];
    const procs = [], mounts = { host: o.hostMounts || ['/', '/proc', '/home', '/var'] }, net = { host: o.hostNet || ['lo', 'eth0 192.168.1.20', 'bridge0'] }, uts = { host: o.hostname || 'lab-host' };
    let pid = 1;
    host.forEach((name, i) => procs.push({ pid: pid++, ppid: i === 0 ? 0 : 1, name, ns: { pid: 'host', mnt: 'host', net: 'host', uts: 'host' }, nsPid: pid - 1 }));
    const runtime = procs.length > 2 ? procs[2].pid : 1;
    for (const c of cs) {
      const share = c.share || {};
      mounts[c.name] = c.mounts || ['/ (' + c.name + ' image)', '/proc'];
      if (share.net !== 'host') net[c.name] = c.net || ['lo'];
      uts[c.name] = c.hostname || c.name;
      let local = 1, first = null;
      for (const name of c.procs) {
        const p = { pid: pid++, ppid: first ? first.pid : runtime, name, ns: { pid: c.name, mnt: c.name, net: share.net === 'host' ? 'host' : c.name, uts: c.name }, nsPid: local++, container: c.name };
        if (!first) first = p;
        procs.push(p);
      }
    }
    return { procs, mounts, net, uts };
  };

  V.view = function (sys, pid) {
    const me = sys.procs.find((p) => p.pid === pid);
    if (!me) throw new Error('no process ' + pid);
    const all = me.ns.pid === 'host';
    const pids = sys.procs.filter((p) => all || p.ns.pid === me.ns.pid).map((p) => ({ seen: all ? p.pid : p.nsPid, name: p.name, hostPid: p.pid }));
    const steps = [];
    steps.push({ kind: 'pid', say: me.name + ' (host pid ' + me.pid + ') lists processes: ' + (all ? 'it is in the host\'s pid namespace, so it sees all ' + pids.length + ', with their host pids.' : 'its pid namespace "' + me.ns.pid + '" holds only ' + pids.length + ', numbered ' + pids.map((x) => x.seen).join(', ') + ', and it sees itself as pid ' + me.nsPid + '.') });
    steps.push({ kind: 'mnt', say: 'Its mount namespace "' + me.ns.mnt + '" shows ' + sys.mounts[me.ns.mnt].join(', ') + '.' });
    steps.push({ kind: 'net', say: 'Its network namespace "' + me.ns.net + '" has ' + sys.net[me.ns.net].join(', ') + (me.ns.net === 'host' && !all ? ' (it shares the host\'s network)' : '') + '.' });
    steps.push({ kind: 'uts', say: 'hostname says ' + sys.uts[me.ns.uts] + '. All of this is one kernel\'s data, shown through different namespaces.' });
    return { pids, mounts: sys.mounts[me.ns.mnt].slice(), net: sys.net[me.ns.net].slice(), hostname: sys.uts[me.ns.uts], steps };
  };

  V.signal = function (sys, from, seen) {
    const me = sys.procs.find((p) => p.pid === from);
    const v = V.view(sys, from).pids.find((x) => x.seen === seen);
    if (!v) return { ok: false, target: null, say: me.name + ' sends a signal to pid ' + seen + ': no such process in its pid namespace "' + me.ns.pid + '", so kill fails with ESRCH; processes outside cannot even be named.' };
    return { ok: true, target: v.hostPid, say: me.name + ' sends a signal to pid ' + seen + ', which in its namespace is ' + v.name + ' (host pid ' + v.hostPid + ').' };
  };

  V.cgroups = function (o) {
    o = o || {};
    const period = Math.max(1, o.period || 10), T = Math.max(1, o.ticks || 30);
    const groups = (o.groups || [{ name: 'web', weight: 200 }, { name: 'batch', weight: 100, quota: 2 }, { name: 'db', weight: 100, memLimit: 12 }]).map((g, i) => ({ name: g.name, weight: Math.max(1, g.weight || 100), quota: g.quota == null ? null : g.quota, memLimit: g.memLimit == null ? null : g.memLimit, i, cpu: 0, used: 0, throttled: 0, killed: [] }));
    const procs = (o.procs || [{ name: 'nginx', group: 'web', work: Infinity }, { name: 'job', group: 'batch', work: Infinity }, { name: 'dbserver', group: 'db', work: Infinity, memPerTick: 2 }, { name: 'cache', group: 'db', work: Infinity, memPerTick: 3 }])
      .map((p, i) => ({ name: p.name, group: p.group, left: p.work === undefined ? Infinity : p.work, memPerTick: p.memPerTick || 0, mem: p.mem || 0, cpu: 0, i, alive: true }));
    const G = Object.fromEntries(groups.map((g) => [g.name, g]));
    const steps = [], segs = [];
    const memOf = (g) => procs.filter((p) => p.alive && p.group === g.name).reduce((a, p) => a + p.mem, 0);
    for (let t = 0; t < T; t++) {
      const ev = [];
      if (t % period === 0) { for (const g of groups) g.used = 0; if (t) ev.push('a new period starts, every quota refills'); }
      const runnable = procs.filter((p) => p.alive && p.left > 0);
      const throttled = groups.filter((g) => g.quota !== null && g.used >= g.quota && runnable.some((p) => p.group === g.name));
      for (const g of throttled) g.throttled++;
      const ok = groups.filter((g) => !throttled.includes(g) && runnable.some((p) => p.group === g.name));
      if (!ok.length) {
        segs.push({ t, proc: null, group: null });
        steps.push({ kind: 'idle', t, say: 't = ' + t + ': ' + (ev.length ? ev.join('; ') + '; ' : '') + (throttled.length ? throttled.map((g) => g.name).join(', ') + ' used its quota of ' + throttled.map((g) => g.quota).join(', ') + ', so the CPU idles though work is waiting.' : 'nothing to run.'), groups: snap() });
        continue;
      }
      ok.sort((a, b) => a.cpu / a.weight - b.cpu / b.weight || a.i - b.i);
      const g = ok[0];
      const p = runnable.filter((x) => x.group === g.name).sort((a, b) => a.cpu - b.cpu || a.i - b.i)[0];
      p.cpu++; p.left--; g.cpu++; g.used++;
      if (p.memPerTick) p.mem += p.memPerTick;
      segs.push({ t, proc: p.name, group: g.name });
      let say = 't = ' + t + ': ' + (ev.length ? ev.join('; ') + '; ' : '') + g.name + ' has had the least CPU for its weight (' + (g.cpu - 1) + '/' + g.weight + ')' + (throttled.length ? ' among groups not throttled (' + throttled.map((x) => x.name).join(', ') + (throttled.length === 1 ? ' waits' : ' wait') + ' for the next period)' : '') + ', so its ' + p.name + ' runs' + (g.quota !== null ? ' (' + g.used + ' of its quota ' + g.quota + ')' : '') + '.';
      if (g.memLimit !== null && memOf(g) > g.memLimit) {
        const victim = procs.filter((x) => x.alive && x.group === g.name).sort((a, b) => b.mem - a.mem || a.i - b.i)[0];
        const before = memOf(g);
        victim.alive = false; g.killed.push(victim.name);
        say += ' ' + g.name + '\'s memory reaches ' + before + ', over its limit ' + g.memLimit + ': the out-of-memory killer ends ' + victim.name + ' (' + V.plural(victim.mem, 'unit') + '), the largest in that group only.';
      }
      steps.push({ kind: 'tick', t, proc: p.name, group: g.name, say, groups: snap() });
    }
    function snap() { return groups.map((g) => ({ name: g.name, cpu: g.cpu, used: g.used, quota: g.quota, mem: memOf(g), memLimit: g.memLimit, killed: g.killed.slice() })); }
    const busy = segs.filter((s) => s.proc).length || 1;
    const out = {};
    for (const g of groups) out[g.name] = { cpu: g.cpu, share: Math.round((g.cpu / busy) * 1000) / 1000, throttled: g.throttled, mem: memOf(g), killed: g.killed.slice() };
    steps.push({ kind: 'end', say: 'After ' + V.plural(T, 'tick') + ': ' + groups.map((g) => g.name + ' ran ' + g.cpu + (g.throttled ? ' (throttled ' + g.throttled + ')' : '') + (g.killed.length ? ', lost ' + g.killed.join(', ') : '')).join('; ') + '.', groups: snap() });
    return { segs, groups: out, steps };
  };

  (S.engines = S.engines || []).push({ name: 'Virtual machines and containers' });
})(globalThis.Proses = globalThis.Proses || {});
