// Part 18, containers (virt-d-cont.js): one kernel's process table seen through namespaces, a signal resolved inside
// the sender's own pid namespace, and control groups sharing the CPU by weight, capped by quota and limited in
// memory.
(function (S) {
  'use strict';
  const H = S.P09, V = () => S.Virt;
  const SYS = () => V().containers();

  S.topic({
    id: 'virt-namespaces', family: 'p18-containers', order: 10, title: 'Namespaces: one kernel, many views',
    blurb: 'Every process below runs on one kernel, in one process table. Namespaces decide what each can see: a process in a container\'s pid namespace sees only that container\'s processes, numbered from 1, and cannot even name the others; its mount namespace shows its own files, its network namespace its own interfaces, and its own hostname. The host\'s namespaces see everything. Nothing is copied: it is the same kernel data, looked at through different windows.',
    inputs: [
      { id: 'viewer', kind: 'choice', label: 'Looking from', def: '5', options: SYS().procs.map((p) => ({ value: String(p.pid), label: p.name + ' (host pid ' + p.pid + ')' })) },
      { id: 'target', kind: 'number', label: 'Signal pid', def: 3, min: 1, max: 9 },
    ],
    presets: [
      { label: 'From nginx in the web container', values: { viewer: '4', target: 2 } },
      { label: 'From the database\'s writer', values: { viewer: '8', target: 3 } },
      { label: 'From the host\'s sshd', values: { viewer: '2', target: 7 } },
      { label: 'From a worker, signalling pid 1', values: { viewer: '6', target: 1 } },
    ],
    counters: [{ id: 'seen', label: 'processes visible' }],
    run(inp) {
      const sys = SYS(), pid = +inp.viewer, me = sys.procs.find((p) => p.pid === pid), Vw = V().view(sys, pid), sig = V().signal(sys, pid, inp.target);
      const F = new S.Frames(['seen']), seen = new Map(Vw.pids.map((x) => [x.hostPid, x.seen]));
      const table = (show) => {
        const items = [H.title('pt', 0, 6, 'the kernel\'s one process table')];
        S.Kit.gantt.table({ prefix: 'pt', x: 0, y: 20, rowH: 30, size: 14, cols: [{ w: 80, label: 'host pid' }, { w: 120, label: 'name' }, { w: 110, label: 'pid space' }, { w: 90, label: 'seen as' }], rows: sys.procs.map((p) => ({ cls: p.pid === pid ? 'act' : show && show.hot === p.pid ? 'hot' : '', cells: [String(p.pid), p.name, p.ns.pid, show && show.pids ? (seen.has(p.pid) ? { text: 'pid ' + seen.get(p.pid), cls: 'good' } : { text: 'invisible', cls: '' }) : ''] })) }).items.forEach((it) => items.push(it));
        return items;
      };
      const panel = (k) => {
        const items = [H.title('vt', 450, 6, 'what ' + me.name + ' sees')], rows = [['processes', Vw.pids.length + ' (' + Vw.pids.map((x) => x.seen).join(', ') + ')'], ['files', Vw.mounts.join(', ')], ['network', Vw.net.join(', ')], ['hostname', Vw.hostname]];
        rows.slice(0, k).forEach(([a, b], j) => items.push(H.text('va' + j, 450, 40 + j * 56, a, 'strong', 14), ...H.para('vb' + j + '_', 450, 60 + j * 56, b, 330, 'mono', 13)));
        return items;
      };
      F.add({ items: [...table(null), ...panel(0)], say: `One kernel runs ${sys.procs.length} processes: ${H.list(sys.procs.filter((p) => p.ns.pid === 'host').map((p) => p.name))} on the host, and two containers. We look from ${me.name}, host pid ${pid}, in the ${me.ns.pid} namespaces.`, meta: { phase: 'start', n: sys.procs.length, pid } });
      Vw.steps.forEach((st, k) => {
        if (k === 0) F.set('seen', Vw.pids.length);
        F.add({ items: [...table({ pids: k >= 0 }), ...panel(k + 1)], say: st.say, meta: { phase: st.kind, k, pid, nsPid: me.nsPid, seen: Vw.pids.map((x) => x.seen), n: Vw.pids.length, net: Vw.net, mounts: Vw.mounts, host: Vw.hostname }, title: st.kind });
      });
      F.add({ items: [...table({ pids: true, hot: sig.ok ? sig.target : null }), ...panel(4), H.text('sg', 450, 290, 'kill(' + inp.target + ') → ' + (sig.ok ? 'host pid ' + sig.target : 'ESRCH: no such process'), 'verdict2 ' + (sig.ok ? 'good' : 'hot'), 15)], say: sig.say, meta: { phase: 'signal', target: inp.target, host: sig.target, ok: sig.ok }, title: 'kill(' + inp.target + ')', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Namespaces', text: ['pid: which processes exist, and their numbers', 'mount: which files', 'network: which interfaces and addresses', 'uts: the hostname', 'one kernel; each process sees through its own'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many processes will this one be able to see?', options: (fr) => [...new Set(['2', '3', '8', String(fr[1].meta.n)])].sort((a, b) => a - b), answer: (fr) => String(fr[1].meta.n), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'A process in a container lists the processes and sees itself as pid 1. On the host it is…', options: ['an ordinary process with some other pid', 'pid 1 as well', 'invisible', 'a virtual machine'], answer: 0, why: 'Its pid namespace numbers its processes from 1; the host numbers them all.' },
      { q: 'Why can a process in one container not signal one in another?', options: ['it cannot name it: pids resolve inside its own namespace', 'signals are encrypted', 'the other is stopped', 'it can'], answer: 0, why: 'kill() looks the number up in the sender\'s namespace.' },
      { q: 'What does a mount namespace change?', options: ['which file systems and files a process sees', 'its memory limit', 'its CPU share', 'its user id'], answer: 0, why: 'Each container sees its own root file system.' },
      { q: 'Namespaces limit what a process can see; what limits how much it can use?', options: ['control groups', 'more namespaces', 'the page table', 'the TLB'], answer: 0, why: 'CPU time, memory and I/O are limited by control groups.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const CG = {
    mixed: { label: 'Web (weight 200), batch with a quota, a database with a memory limit', groups: [{ name: 'web', weight: 200 }, { name: 'batch', weight: 100, quota: 2 }, { name: 'db', weight: 100, memLimit: 12 }], procs: [{ name: 'nginx', group: 'web', work: Infinity }, { name: 'job', group: 'batch', work: Infinity }, { name: 'dbserver', group: 'db', work: Infinity, memPerTick: 2 }, { name: 'cache', group: 'db', work: Infinity, memPerTick: 3 }] },
    weights: { label: 'Three groups weighted 3 : 2 : 1', groups: [{ name: 'gold', weight: 300 }, { name: 'silver', weight: 200 }, { name: 'bronze', weight: 100 }], procs: [{ name: 'g1', group: 'gold', work: Infinity }, { name: 's1', group: 'silver', work: Infinity }, { name: 'b1', group: 'bronze', work: Infinity }] },
    quota: { label: 'A quota leaves the CPU idle', groups: [{ name: 'capped', weight: 100, quota: 3 }], procs: [{ name: 'job1', group: 'capped', work: Infinity }, { name: 'job2', group: 'capped', work: Infinity }] },
    oom: { label: 'Memory limits: one group runs out', groups: [{ name: 'app', weight: 100, memLimit: 10 }, { name: 'tools', weight: 100 }], procs: [{ name: 'server', group: 'app', work: Infinity, memPerTick: 1 }, { name: 'leaky', group: 'app', work: Infinity, memPerTick: 2 }, { name: 'shell', group: 'tools', work: Infinity, memPerTick: 1 }] },
  };
  S.topic({
    id: 'virt-cgroups', family: 'p18-containers', order: 20, title: 'Control groups: shares, quotas, memory limits',
    blurb: 'A control group gathers processes so the kernel can limit them together. Weights share the CPU in proportion when groups compete: each tick goes to the group that has had least for its weight. A quota caps a group\'s CPU per period, even when the CPU would otherwise sit idle. A memory limit is enforced inside the group: when the group goes over, the out-of-memory killer ends the group\'s largest process, and no other group is touched.',
    inputs: [
      { id: 'cfg', kind: 'choice', label: 'Groups', def: 'mixed', options: Object.entries(CG).map(([value, c]) => ({ value, label: c.label })) },
      { id: 'ticks', kind: 'number', label: 'Ticks', def: 30, min: 10, max: 40 },
      { id: 'period', kind: 'number', label: 'Quota period (ticks)', def: 10, min: 5, max: 20 },
    ],
    presets: [
      { label: 'Weights, a quota and a memory limit', values: { cfg: 'mixed', ticks: 30, period: 10 } },
      { label: 'Weights 3 : 2 : 1', values: { cfg: 'weights', ticks: 30, period: 10 } },
      { label: 'A quota that idles the CPU', values: { cfg: 'quota', ticks: 20, period: 5 } },
      { label: 'A memory limit', values: { cfg: 'oom', ticks: 20, period: 10 } },
    ],
    counters: [{ id: 't', label: 'ticks' }, { id: 'idle', label: 'idle ticks' }, { id: 'killed', label: 'killed' }],
    run(inp) {
      const c = CG[inp.cfg], R = V().cgroups({ groups: c.groups, procs: c.procs, period: inp.period, ticks: inp.ticks }), F = new S.Frames(['t', 'idle', 'killed']);
      const names = c.groups.map((g) => g.name), cw = Math.min(18, Math.floor(560 / inp.ticks)), x0 = 120, y0 = 50, rh = 34;
      const lane = (upto) => {
        const items = [H.title('lt', 0, 6, 'which group ran at each tick')];
        names.forEach((nm, i) => items.push(H.text('ln' + i, x0 - 10, y0 + i * rh + 22, nm, 'rowname', 14, 'end')));
        items.push(H.text('li', x0 - 10, y0 + names.length * rh + 22, 'idle', 'rowname', 14, 'end'));
        R.segs.slice(0, upto).forEach((sg, t) => {
          const i = sg.group === null ? names.length : names.indexOf(sg.group), st = R.steps[t];
          items.push({ key: 'sg' + t, kind: 'cell', x: x0 + t * cw, y: y0 + i * rh + 4, w: cw - 2, h: rh - 8, rx: 2, text: '', cls: sg.group === null ? 'cgidle' : 'cg' + (i % 4) + (t === upto - 1 ? ' act' : '') });
          for (const g of st.groups || []) if (g.quota !== null && g.used >= g.quota && sg.group !== g.name && st.kind !== 'end') { const gi = names.indexOf(g.name); items.push({ key: 'th' + t + '_' + gi, kind: 'cell', x: x0 + t * cw, y: y0 + gi * rh + 12, w: cw - 2, h: rh - 24, rx: 2, text: '', cls: 'cgthr' }); }
        });
        for (let p = 0; p <= inp.ticks; p += inp.period) items.push({ key: 'pl' + p, kind: 'line', x1: x0 + p * cw - 1, y1: y0 - 4, x2: x0 + p * cw - 1, y2: y0 + (names.length + 1) * rh, cls: 'dash' }, H.text('pt' + p, x0 + p * cw - 1, y0 - 10, 't = ' + p, 'tick', 12, 'middle'));
        return items;
      };
      const side = (st) => {
        const items = [H.title('st', 0, y0 + (names.length + 1) * rh + 34, 'per group: CPU ticks so far, and memory')];
        (st.groups || []).forEach((g, i) => {
          const y = y0 + (names.length + 1) * rh + 50 + i * 30;
          items.push(H.text('gn' + i, 0, y + 16, g.name, 'strong', 14), H.text('gc' + i, 90, y + 16, g.cpu + ' ticks' + (g.quota !== null ? ' (quota ' + g.quota + ' a period)' : ''), 'mono', 13));
          if (g.memLimit !== null || g.mem) { const w = Math.round(Math.min(1, g.mem / Math.max(g.memLimit || 1, g.mem || 1, 1)) * 200); items.push({ key: 'mb' + i, kind: 'cell', x: 400, y: y + 2, w: Math.max(3, w), h: 18, rx: 3, text: '', cls: 'bar ' + (g.memLimit !== null && g.mem > g.memLimit * 0.8 ? 'neg' : 'soft') }, H.text('mt' + i, 410 + Math.max(3, w), y + 16, 'memory ' + g.mem + (g.memLimit !== null ? ' of ' + g.memLimit : '') + (g.killed.length ? ', killed ' + g.killed.join(', ') : ''), g.killed.length ? 'hot' : '', 13)); }
        });
        return items;
      };
      let idle = 0, killed = 0;
      // what each process has grown to, from the ticks it ran (memory grows by memPerTick at each tick it runs)
      const ran = {}, memAt = (t) => { const m = {}; for (const p of c.procs) m[p.name] = 0; R.segs.slice(0, t + 1).forEach((sg) => { if (sg.proc) m[sg.proc] += (c.procs.find((p) => p.name === sg.proc).memPerTick || 0); }); return m; };
      void ran;
      F.add({ items: [...lane(0), ...side({ groups: c.groups.map((g) => ({ name: g.name, cpu: 0, used: 0, quota: g.quota == null ? null : g.quota, mem: 0, memLimit: g.memLimit == null ? null : g.memLimit, killed: [] })) })], say: `${H.plural(c.groups.length, 'group')}: ${H.list(c.groups.map((g) => g.name + ' (weight ' + (g.weight || 100) + (g.quota != null ? ', quota ' + g.quota + ' ticks a period' : '') + (g.memLimit != null ? ', memory limit ' + g.memLimit : '') + ')'))}. Every process always has work, so the groups compete at every tick.`, meta: { phase: 'start', period: inp.period, n: c.groups.length, cfg: c.groups } });
      R.steps.forEach((st, t) => {
        if (st.kind === 'end') return;
        F.count('t');
        if (st.kind === 'idle') { idle++; F.count('idle'); }
        const k = st.groups.reduce((a, g) => a + g.killed.length, 0);
        if (k > killed) { F.count('killed', k - killed); killed = k; }
        const mem = memAt(t), before = st.groups.map((g) => c.procs.filter((p) => p.group === g.name).reduce((a, p) => a + mem[p.name], 0) - (g.killed.length && R.steps[t].say.includes('out-of-memory') ? 0 : 0));
        F.add({ items: [...lane(t + 1), ...side(st)], say: st.say, meta: { phase: st.kind, t, groups: st.groups, period: inp.period, weights: c.groups.map((g) => g.weight || 100), cpuBefore: st.groups.map((g) => g.cpu - 1), procMem: Object.values(mem), groupMem: before }, title: 't = ' + t });
      });
      const end = R.steps[R.steps.length - 1];
      F.add({ items: [...lane(R.segs.length), ...side(end)], say: end.say + ` Shares of the busy ticks: ${H.list(names.map((n) => n + ' ' + Math.round(R.groups[n].share * 100) + '%'))}.`, meta: { phase: 'end', groups: end.groups, shares: names.map((n) => R.groups[n].share), pct: names.map((n) => Math.round(R.groups[n].share * 100)), throttled: names.map((n) => R.groups[n].throttled) }, title: 'totals', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Control groups', text: ['weight: CPU shared in proportion when busy', '  the group with least CPU per weight runs next', 'quota: at most q ticks each period, even if idle', 'memory limit: over it, the group\'s largest', '  process is killed; other groups untouched'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which group will get the most CPU?', options: (fr) => fr[fr.length - 1].meta.groups.map((g) => g.name), answer: (fr) => { const gs = fr[fr.length - 1].meta.groups, m = Math.max(...gs.map((g) => g.cpu)); return gs.filter((g) => g.cpu === m).map((g) => g.name); }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Two busy groups with weights 200 and 100 share the CPU about…', options: ['2 to 1', '1 to 1', '1 to 2', '3 to 1'], answer: 0, why: 'Shares follow the weights when both want the CPU.' },
      { q: 'A group has used its quota for this period. Its processes…', options: ['wait for the next period, even if the CPU is idle', 'run anyway if the CPU is free', 'are killed', 'move to another group'], answer: 0, why: 'A quota is a hard cap, not a share.' },
      { q: 'A group goes over its memory limit. The kernel…', options: ['kills the largest process in that group only', 'kills the largest process on the machine', 'swaps every group out', 'ignores it'], answer: 0, why: 'The limit and its consequences stay inside the group.' },
      { q: 'Containers use control groups so that…', options: ['one container cannot starve the others of CPU or memory', 'they can see each other', 'they boot faster', 'they get their own kernel'], answer: 0, why: 'Namespaces hide; control groups limit.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
