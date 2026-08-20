// The VM lab, part six: containers. Namespaces: the one kernel's process table, every process tagged with the
// namespaces it lives in (S.Virt.containers), seen through the eyes of the processes the student picks (S.Virt.view):
// which processes each can see and under what pid, its mounts, its network and its hostname; then a kill() resolved
// inside the sender's pid namespace (S.Virt.signal). Control groups: the student's groups (weight, CPU quota a period,
// memory limit) and processes (work, memory growth) on a toy scheduler (S.Virt.cgroups), tick by tick, with the
// throttled ticks and the out-of-memory kills.
//   VX.nsSys(v) -> the engine's system   VX.nsRun(v, ctx)   VX.cgSetup(v) -> engine options   VX.cgRun(v, ctx)
(function (S) {
  'use strict';
  const VX = S.VmmLab;
  const box = (x, y, w, h) => ({ x, y, w, h });
  const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);

  // ---- namespaces ---------------------------------------------------------------------------------------------------
  VX.nsSys = (v) => S.Virt.containers({
    host: v.nsHost.slice(),
    containers: v.nsCont.map((c, i) => ({ name: c.name, procs: words(c.procs), hostname: c.hostname, mounts: ['/ (' + c.name + ' image)', '/proc'].concat(i === 0 ? ['/data (volume)'] : []), net: ['lo', 'eth0 10.1.0.' + (i + 2)], share: c.net === 'host' ? { net: 'host' } : {} })),
  });

  VX.nsRun = function (v, ctx) {
    const V = S.Virt, narrow = ctx.narrow, sys = VX.nsSys(v);
    const nsNames = ['host'].concat(v.nsCont.map((c) => c.name));
    const nsCls = (ns) => 'vx-ns' + (nsNames.indexOf(ns) % 4);
    const cols = narrow ? [{ w: 48, label: 'pid', id: 'pid' }, { w: 112, label: 'name', id: 'name' }, { w: 90, label: 'pid ns', id: 'ns' }, { w: 62, label: 'inside', id: 'in' }] : [{ w: 80, label: 'host pid', id: 'pid' }, { w: 130, label: 'name', id: 'name' }, { w: 110, label: 'pid ns', id: 'ns' }, { w: 90, label: 'pid inside', id: 'in' }, { w: 90, label: 'net ns', id: 'net' }];
    const rowH = narrow ? 24 : 28, ty = 30, tW = cols.reduce((a, c) => a + c.w, 0);
    const procTable = (seen, me, hot) => {
      const items = [VX.title('pt', 0, 14, 'one kernel’s process table')];
      let x = 0;
      cols.forEach((c, i) => { items.push(VX.cell('ph' + i, x, ty, c.w, rowH, c.label, 'gth', 13, { rx: 0 })); x += c.w; });
      sys.procs.forEach((p, r) => {
        const y = ty + (r + 1) * rowH, st = seen ? (p.pid === me ? ' me' : p.pid === hot ? ' hot' : seen.has(p.pid) ? ' seen' : ' unseen') : '';
        let cx = 0;
        cols.forEach((c, i) => {
          const t = c.id === 'pid' ? p.pid : c.id === 'name' ? p.name : c.id === 'ns' ? p.ns.pid : c.id === 'in' ? p.nsPid : p.ns.net;
          items.push(VX.cell('pr' + p.pid + '_' + i, cx, y, c.w, rowH, VX.fit(t, c.w - 10, 13), 'vx-ptab ' + (c.id === 'ns' || c.id === 'net' ? nsCls(c.id === 'ns' ? p.ns.pid : p.ns.net) : st.trim()), 13, { rx: 0 }));
          cx += c.w;
        });
      });
      return items;
    };
    const tH = ty + (sys.procs.length + 1) * rowH;
    const rx = narrow ? 0 : tW + 40, ry = narrow ? tH + 30 : 0;
    const viewPic = (vw, me, upto) => {
      const items = [VX.title('vt', rx, ry + 14, 'what ' + me.name + ' (host pid ' + me.pid + ') sees')];
      // ps
      const pw = narrow ? 172 : 170, ph = narrow ? 24 : 26;
      items.push(VX.cell('psh', rx, ry + 30, pw, ph, 'ps: PID  NAME', 'gth', 13, { rx: 0, align: 'left' }));
      vw.pids.forEach((p, i) => items.push(VX.cell('ps' + p.hostPid, rx, ry + 30 + ph + i * ph, pw, ph, String(p.seen).padStart(3, ' ') + '  ' + p.name, 'vx-ps mono' + (p.hostPid === me.pid ? ' me' : ''), 13, { rx: 0, align: 'left' })));
      const ox = narrow ? rx + 186 : rx + 200, ow = narrow ? 184 : 300;
      let y = ry + 30;
      const block = (k, label, lines, show) => {
        items.push(VX.text('ol' + k, ox, y + 14, label, 'strong', 13));
        y += 22;
        lines.forEach((l, i) => items.push(VX.cell('ov' + k + '_' + i, ox, y + i * 28, ow, 24, show ? VX.fit(l, ow - 12, 13) : '', 'vx-nsv' + (show ? '' : ' empty'), 13, { rx: 4, align: 'left' })));
        y += lines.length * 28 + 8;
      };
      block('m', 'mounts (' + me.ns.mnt + ')', vw.mounts, upto >= 1);
      block('n', 'network (' + me.ns.net + ')', vw.net, upto >= 2);
      block('u', 'hostname (' + me.ns.uts + ')', [vw.hostname], upto >= 3);
      return { items, h: Math.max(56 + vw.pids.length * 26, y - ry) };
    };
    const maxVh = Math.max(...v.nsViewers.map((pid) => { const vw = V.view(sys, pid); return Math.max(56 + vw.pids.length * 26, 30 + 3 * 30 + (vw.mounts.length + vw.net.length + 1) * 28 + 24); }));
    const view = narrow ? box(-6, -4, 384, ry + maxVh + 20) : box(-10, -4, Math.max(rx + 520, 900), Math.max(tH, maxVh) + 20);
    const frames = [], trace = [];
    const tables = [{ title: 'The kernel’s process table', cols: ['host pid', 'ppid', 'name', 'pid ns', 'pid inside', 'mnt', 'net', 'uts'], rows: sys.procs.map((p) => [String(p.pid), String(p.ppid), p.name, p.ns.pid, String(p.nsPid), p.ns.mnt, p.ns.net, p.ns.uts]) }];
    const add = (kind, say, items, title, extra) => { trace.push(Object.assign({ kind, say }, extra || {})); frames.push({ items, say, at: trace.length - 1, view, title, tables, metrics: mets, hold: 1500 }); };
    const mets = [{ label: 'Processes in the kernel', value: sys.procs.length }, { label: 'Pid namespaces', value: nsNames.length }, { label: 'Kernels', value: 1, note: 'every container shares it' }];
    add('start', 'One kernel runs ' + VX.plural(sys.procs.length, 'process', 'processes') + ': ' + v.nsHost.length + ' on the host and ' + v.nsCont.map((c) => VX.plural(words(c.procs).length, 'process', 'processes') + ' in ' + c.name).join(', ') + '. Each is tagged with its namespaces; a container is only that tagging.', [...procTable(null)], 'the process table');
    for (const pid of v.nsViewers) {
      const me = sys.procs.find((p) => p.pid === pid), vw = V.view(sys, pid), seen = new Set(vw.pids.map((x) => x.hostPid));
      vw.steps.forEach((st, k) => add('view-' + st.kind, VX.plain(st.say), [...procTable(seen, pid), ...viewPic(vw, me, k).items], me.name + ': ' + st.kind, { pid }));
    }
    const sig = V.signal(sys, v.nsFrom, v.nsTo), from = sys.procs.find((p) => p.pid === v.nsFrom), fv = V.view(sys, v.nsFrom);
    add('signal', VX.plain(sig.say), [...procTable(new Set(fv.pids.map((x) => x.hostPid)), v.nsFrom, sig.ok ? sig.target : null), ...viewPic(fv, from, 3).items], 'kill(' + v.nsTo + ')', { ok: sig.ok, target: sig.target });
    return { frames, trace, tables, metrics: mets.concat([{ label: 'kill(' + v.nsTo + ') from pid ' + v.nsFrom, value: sig.ok ? 'host pid ' + sig.target : 'ESRCH', cls: sig.ok ? 'good' : 'bad' }]), plan: { sys, sig } };
  };

  // ---- control groups ---------------------------------------------------------------------------------------------
  VX.cgSetup = (v) => ({
    groups: v.cgGroups.map((g) => ({ name: g.name, weight: g.weight, quota: g.quota ? g.quota : null, memLimit: g.mem ? g.mem : null })),
    procs: v.cgProcs.map((p) => ({ name: p.name, group: p.group, work: p.work ? p.work : Infinity, memPerTick: p.grow, mem: p.mem })),
    period: v.cgPeriod, ticks: v.cgTicks,
  });

  VX.cgRun = function (v, ctx) {
    const V = S.Virt, narrow = ctx.narrow, o = VX.cgSetup(v), R = V.cgroups(o), T = v.cgTicks;
    const names = o.groups.map((g) => g.name), gi = (n) => names.indexOf(n);
    // throttled ticks: the engine counts them; running it to each tick says which ticks they were
    const thr = names.map(() => new Set());
    let prev = names.map(() => 0);
    for (let t = 0; t < T; t++) {
      const r = V.cgroups(Object.assign({}, o, { ticks: t + 1 }));
      names.forEach((n, k) => { if (r.groups[n].throttled > prev[k]) thr[k].add(t); prev[k] = r.groups[n].throttled; });
    }
    const lw = narrow ? 64 : 110, x0 = lw, x1 = narrow ? 376 : 990, per = (x1 - x0) / T, laneH = 32, ly = 30;
    const lanes = (upto) => {
      const items = [VX.title('lt', 0, 14, narrow ? 'who runs, tick by tick' : 'who runs, tick by tick (period ' + v.cgPeriod + ')')];
      names.forEach((n, k) => {
        const y = ly + k * (laneH + 6);
        items.push(VX.text('ln' + k, lw - 10, y + laneH / 2 + 5, VX.fit(n, lw - 14, 13), 'strong', 13, 'end'));
        items.push(VX.cell('tr' + k, x0, y, x1 - x0, laneH, '', 'vx-track', 13, { rx: 3, audit: 'group' }));
        for (let t = 0; t < Math.min(upto, T); t++) {
          const s = R.segs[t];
          if (s.group === n) { const txt = per >= 22 ? s.proc.slice(0, Math.max(1, Math.floor((per - 6) / 8))) : ''; items.push(VX.cell('s' + k + '_' + t, x0 + t * per, y + 2, per, laneH - 4, txt, 'vx-cg cg' + (k % 4) + (t === upto - 1 ? ' act' : ''), 12, { rx: 2, audit: 'overlap-ok' })); }
          else if (thr[k].has(t)) items.push(VX.cell('s' + k + '_' + t, x0 + t * per, y + 2, per, laneH - 4, '', 'vx-cg thr', 12, { rx: 2, audit: 'overlap-ok' }));
        }
      });
      const yI = ly + names.length * (laneH + 6);
      items.push(VX.text('lni', lw - 10, yI + 13, 'idle', 'tick', 13, 'end'));
      for (let t = 0; t < Math.min(upto, T); t++) if (!R.segs[t].group) items.push(VX.cell('si' + t, x0 + t * per, yI, per, 18, '', 'vx-cg idle', 12, { rx: 2, audit: 'overlap-ok' }));
      const yA = yI + 26;
      let d = `M${x0},${yA} H${x1}`;
      for (let t = 0; t <= T; t += v.cgPeriod) {
        const x = VX.r1(x0 + t * per);
        d += ` M${x},${yA} v6`;
        items.push(VX.text('ax' + t, x, yA + 20, String(t), 'tick', 12, t === 0 ? 'start' : t === T ? 'end' : 'middle'));
        if (t > 0 && t < T) items.push({ key: 'pd' + t, kind: 'line', x1: x, y1: ly - 4, x2: x, y2: yA, cls: 'vx-period', audit: 'ignore', layer: 'top' });
      }
      items.push({ key: 'axis', kind: 'path', d, cls: 'axis', audit: 'ignore', layer: 'back' });
      const lgE = [{ cls: 'vx-cg thr', text: 'throttled: quota used' }, { cls: 'vx-cg idle', text: 'CPU idle' }];
      if (narrow) items.push(...VX.legend({ prefix: 'lg', x: 0, y: yA + 30, maxW: 370, entries: lgE }).items);
      else items.push(...VX.legend({ prefix: 'lg', x: x1 - 400, y: 1, maxW: 400, entries: lgE }).items);
      return items;
    };
    const lanesH = ly + names.length * (laneH + 6) + 26 + (narrow ? 66 : 40);
    const bars = (snap) => {
      const items = [], bw = narrow ? 170 : 260, bx2 = narrow ? 0 : 500, y1 = lanesH + 10, y2 = narrow ? y1 + 16 + names.length * 28 + 20 : y1;
      const wsum = o.groups.reduce((a, g) => a + g.weight, 0), busy = Math.max(1, snap.reduce((a, g) => a + g.cpu, 0));
      items.push(VX.title('bc', 0, y1, narrow ? 'CPU ticks (weight share)' : 'CPU ticks so far (share against weight share)'));
      items.push(...VX.bars({ prefix: 'cb', x: 0, y: y1 + 14, labelW: 80, w: bw, rowH: 28, max: T, rows: snap.map((g, k) => ({ label: VX.fit(g.name, 72, 13), v: g.cpu, text: g.cpu + ' (' + Math.round((100 * g.cpu) / busy) + '% · ' + Math.round((100 * o.groups[k].weight) / wsum) + '%)', cls: 'vx-cg cg' + (k % 4) })) }).items);
      items.push(VX.title('bm', bx2, y2, 'memory against the limit'));
      const mmax = Math.max(1, ...snap.map((g) => Math.max(g.mem, g.memLimit || 0)), ...R.steps.map((s) => (s.groups ? Math.max(...s.groups.map((x) => x.mem)) : 0)));
      items.push(...VX.bars({ prefix: 'mb', x: bx2, y: y2 + 14, labelW: 80, w: narrow ? 110 : 220, rowH: 28, max: mmax, rows: snap.map((g, k) => ({ label: VX.fit(g.name, 72, 13), v: g.mem, mark: g.memLimit, text: g.mem + (g.memLimit ? ' / ' + g.memLimit : '') + (g.killed.length ? ' · killed ' + g.killed.join(', ') : ''), cls: g.killed.length ? 'vx-wrongbar' : 'vx-membar' })) }).items);
      return { items, h: (narrow ? y2 : y1) + 14 + names.length * 28 - lanesH };
    };
    const bH = bars(R.steps[R.steps.length - 1].groups).h;
    const view = narrow ? box(-6, -4, 386, lanesH + bH + 20) : box(-10, -4, 1012, lanesH + bH + 20);
    const frames = [], trace = R.steps.map((s) => ({ kind: s.kind, say: s.say, t: s.t }));
    const tablesOf = (snap) => [{ title: 'Each group', cols: ['group', 'weight', 'quota', 'mem limit', 'CPU', 'throttled', 'memory', 'killed'], rows: snap.map((g, k) => [g.name, String(o.groups[k].weight), g.quota === null ? '–' : String(g.quota), g.memLimit === null ? '–' : String(g.memLimit), String(g.cpu), String([...thr[k]].filter((t) => t < (snap._t === undefined ? T : snap._t)).length), String(g.mem), g.killed.length ? { text: g.killed.join(', '), cls: 'bad' } : '–']) }];
    frames.push({ items: [...lanes(0), ...bars(names.map((n, k) => ({ name: n, cpu: 0, mem: o.procs.filter((p) => p.group === n).reduce((a, p) => a + p.mem, 0), memLimit: o.groups[k].memLimit, killed: [] }))).items], say: 'Groups ' + VX.list(names.map((n, k) => n + ' (weight ' + o.groups[k].weight + (o.groups[k].quota ? ', quota ' + o.groups[k].quota + ' a period' : '') + (o.groups[k].memLimit ? ', memory limit ' + o.groups[k].memLimit : '') + ')')) + ' share one CPU for ' + VX.plural(T, 'tick') + ', with periods of ' + v.cgPeriod + '.', at: 0, view, title: 'start', tables: [], metrics: [], hold: 1500 });
    R.steps.forEach((st, i) => {
      const snap = st.groups.slice(); snap._t = st.kind === 'end' ? T : st.t + 1;
      const met = snap.map((g, k) => ({ label: g.name + ': CPU', value: g.cpu, note: 'weight ' + o.groups[k].weight + (g.quota ? ', quota ' + g.quota : '') })).concat(snap.filter((g) => g.killed.length).map((g) => ({ label: g.name + ': killed', value: g.killed.join(', '), cls: 'bad' })));
      frames.push({ items: [...lanes(st.kind === 'end' ? T : st.t + 1), ...bars(snap).items], say: VX.plain(st.say), at: i, view, title: st.kind === 'end' ? 'totals' : 't = ' + st.t, tables: tablesOf(snap), metrics: met, hold: st.kind === 'end' ? 2600 : 700 });
    });
    return { frames, trace, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics, plan: { R, thr } };
  };
})(globalThis.Proses = globalThis.Proses || {});
