// The Virtual memory lab, part three: the pictures after the last reference. Faults against frames for every chosen
// policy (where one more frame brings more faults, Belady's anomaly, it is flagged); the working-set size over time
// against the frames given; and what the faults cost: one fault's path step by step with its times, and the
// effective access time the run's fault rate gives.
//   VL.sweepFrame(v, refs, narrow)   VL.wsFrame(v, refs, runs, narrow)   VL.eatFrame(v, refs, narrow)
(function (S) {
  'use strict';
  const VL = S.VMLab, D = VL.D;
  const M = () => S.Mem, V = () => S.VM, C = () => S.Kit.curve, T11 = () => S.Kit.p11;
  const us = (x) => (x >= 1000 ? +(x / 1000).toFixed(3) + ' ms' : +(+x).toFixed(3) + ' µs');

  VL.sweep = function (v, refs) {
    const hi = Math.max(v.frames, v.sweepMax);
    return VL.policies(v).map((p) => {
      const curve = M().faultCurve(p, refs, 1, hi, VL.opts(v));
      const belady = [];
      for (let k = 1; k < curve.length; k++) if (curve[k].faults > curve[k - 1].faults) belady.push({ from: curve[k - 1].n, to: curve[k].n, a: curve[k - 1].faults, b: curve[k].faults });
      return { policy: p, name: M().policyName(p), curve, belady };
    });
  };

  VL.sweepFrame = function (v, refs, narrow) {
    const sw = VL.sweep(v, refs), W = narrow ? 380 : 1000, items = [], hi = Math.max(v.frames, v.sweepMax);
    const top = Math.max(1, ...sw.flatMap((s) => s.curve.map((c) => c.faults)));
    items.push(D.text('sw:t', 0, 14, 'faults against frames, ' + refs.length + ' references', 'title'));
    const ax = C().axes({ prefix: 'sw', x: narrow ? 36 : 60, y: 50, w: narrow ? W - 50 : W - 80, h: narrow ? 220 : 330, xr: [1, hi], yr: [0, top * 1.08], xticks: 1, yticks: C().ticks(0, top, 5).filter(Number.isInteger), xname: 'frames', yname: 'faults', fmtX: (u) => String(u), tickSize: 12 });
    items.push(...ax.items);
    items.push(C().vline(ax, 'sw:you', v.frames, 'act'));
    sw.forEach((s, k) => {
      items.push(C().line(ax, 'sw:l' + k, s.curve.map((c) => [c.n, c.faults]), 'c' + k));
      s.curve.forEach((c) => items.push(C().dot(ax, 'sw:d' + k + '_' + c.n, c.n, c.faults, 'c' + k, 3.5)));
      s.belady.forEach((b, j) => {
        items.push(Object.assign(C().dot(ax, 'sw:b' + k + '_' + j, b.to, b.b, 'hot', 7), { layer: 'top' }));
      });
    });
    const ly = 50 + (narrow ? 220 : 330) + 52;
    items.push(...C().legend('sw:lg', narrow ? 0 : 60, ly, sw.map((s, k) => ({ text: s.name + (s.belady.length ? ' (Belady)' : ''), cls: 'c' + k })), { dir: narrow ? 'col' : 'row', size: 13 }));
    const all = sw.flatMap((s) => s.belady.map((b) => s.name + ' faults ' + b.a + ' times with ' + b.from + ' frame' + (b.from === 1 ? '' : 's') + ' but ' + b.b + ' with ' + b.to));
    const say = 'Faults against frames from 1 to ' + hi + ': ' + sw.map((s) => s.name + ' ' + s.curve.map((c) => c.faults).join(', ')).join('; ') + '. ' + (all.length ? 'Belady’s anomaly: ' + all.join('; ') + ', more memory and more faults.' : 'No policy here faults more with more frames on this string' + (sw.some((s) => s.policy === 'fifo') ? '; FIFO can, on other strings.' : '.'));
    const cellOf = (s, j) => (s.belady.some((x) => x.to === s.curve[j].n) ? { text: s.curve[j].faults + ' ↑', cls: 'bad' } : String(s.curve[j].faults));
    const rows = sw[0].curve.map((c, j) => [String(c.n)].concat(sw.map((s) => cellOf(s, j))));
    const f = { items, say, title: 'faults against frames', hold: 2200, tables: [{ title: 'Faults against frames', cols: ['Frames'].concat(sw.map((s) => s.name)), rows, hl: v.frames - 1 }] };
    return { frame: f, sweep: sw };
  };

  VL.wsFrame = function (v, refs, runs, narrow) {
    const pages = refs.map((r) => r.page), ws = V().workingSet(pages, v.delta), n = refs.length, W = narrow ? 380 : 1000, items = [];
    items.push(D.text('ws:t', 0, 14, 'working-set size over time, Δ = ' + v.delta, 'title'));
    const top = Math.max(v.frames, ws.max) + 1;
    const pw = narrow ? W - 110 : W - 150, px = narrow ? 36 : 60;
    const ax = C().axes({ prefix: 'ws', x: px, y: 50, w: pw, h: narrow ? 180 : 260, xr: [1, Math.max(2, n)], yr: [0, top], xticks: C().ticks(1, n, narrow ? 4 : 8).filter((x) => Number.isInteger(x) && x >= 1), yticks: C().ticks(0, top, 5).filter(Number.isInteger), xname: 'reference', yname: 'pages', tickSize: 12 });
    items.push(...ax.items);
    const pts = [];
    ws.steps.forEach((s, t) => { pts.push([t + 1, s.wss]); if (t + 1 < n) pts.push([t + 2, s.wss]); });
    items.push(C().line(ax, 'ws:l', pts, 'c1'));
    items.push(C().hline(ax, 'ws:fr', v.frames, 'act'));
    items.push(D.text('ws:frl', px + pw + 8, ax.Y(v.frames) + 5, v.frames + ' frame' + (v.frames === 1 ? '' : 's'), 'strong', 13, 'start'));
    // the faults of the first policy, a mark a reference, under the plot
    const run = runs[0], by = 50 + (narrow ? 180 : 260) + 44, cw = pw / Math.max(1, n);
    items.push(D.text('ws:fl', px - 8, by + 12, run.name, 'tick', 12, 'end'));
    items.push({ key: 'ws:bm', kind: 'bitmap', x: Math.round(px), y: by, cw: +cw.toFixed(2), ch: 16, gap: Math.min(2, cw / 4), rows: [run.steps.map((s) => (s.hit ? '1' : '2')).join('')], cls: 'vl-faults' });
    items.push(D.text('ws:key', px, by + 40, 'faults (red) and hits (green) under ' + run.name + ', ' + run.faults + ' of ' + n, 'tick', 12));
    const over = ws.steps.filter((s) => s.wss > v.frames).length;
    const say = 'With Δ = ' + v.delta + ' the working set averages ' + ws.avg.toFixed(2) + ' pages and peaks at ' + ws.max + '; ' + (over ? 'at ' + over + ' of the ' + n + ' references it needs more than the ' + v.frames + ' frames given, and those stretches are where the faults gather.' : 'it never needs more than the ' + v.frames + ' frames given, so faults come only as the set moves.');
    return { items, say, title: 'working set', hold: 2200, tables: [{ title: 'Working set', cols: ['t', 'Page', 'W(t, Δ)', 'Size'], rows: ws.steps.map((s) => [String(s.t + 1), String(s.page), '{' + s.ws.join(', ') + '}', String(s.wss)]) }], ws };
  };

  /** the costs in µs: a memory access, and one disk transfer for a read or a write-back */
  VL.costs = (v) => Object.assign({}, V().COSTS, { mem: v.memNs / 1000, read: v.diskMs * 1000, writeBack: v.diskMs * 1000 });

  VL.eatFrame = function (v, refs, narrow) {
    const pol = VL.policies(v)[0], c = VL.costs(v), dm = V().demand({ refs, frames: v.frames, policy: pol, opts: VL.opts(v), costs: c, anon: [] });
    const W = narrow ? 380 : 1000, items = [];
    const faults = dm.steps.filter((s) => s.kind === 'fault'), n = refs.length;
    const pick = faults.find((s) => s.rep.writeBack) || faults.find((s) => s.rep.victim !== null) || faults[0];
    items.push(D.text('ea:t', 0, 14, 'what the faults cost, under ' + M().policyName(pol), 'title'));
    let y = 40;
    if (pick) {
      items.push(D.text('ea:pt', 0, y + 2, 'reference ' + (pick.i + 1) + ', page ' + pick.page + ': its fault path', 'strong', 14));
      const rows = pick.path.map((p, k) => ({ key: 's' + k, cls: p.kind === 'read' || p.kind === 'writeBack' ? 'hot' : '', cells: [p.kind === 'writeBack' ? 'write back' : p.kind, us(p.cost), us(p.t)] }));
      const t = T11().table({ prefix: 'ea:tb', x: 0, y: y + 14, cols: [{ name: 'step', w: narrow ? 130 : 150, cls: 'name' }, { name: 'costs', w: narrow ? 110 : 120 }, { name: 'so far', w: narrow ? 110 : 120 }], rows, rowH: 26 });
      items.push(...t.items);
      y = narrow ? y + 14 + t.h + 34 : 40;
    }
    const x0 = narrow ? 0 : 440, p = n ? dm.faults / n : 0, faultUs = faults.length ? faults.reduce((a, s) => a + s.us, 0) / faults.length : 0;
    const lines = [
      ['p', 'fault rate p = ' + dm.faults + ' / ' + n + ' = ' + +p.toFixed(3)],
      ['m', 'memory access = ' + us(c.mem)],
      ['f', 'average fault = ' + us(faultUs) + (dm.writeBacks ? ' (' + dm.writeBacks + ' with a write-back)' : '')],
      ['e', 'EAT = (1 − p) × ' + us(c.mem) + ' + p × ' + us(faultUs)],
      ['e2', '    = ' + us(dm.eat) + ', ' + Math.round(dm.eat / c.mem).toLocaleString('en') + ' × a memory access'],
    ];
    lines.forEach(([k, t], j) => items.push(D.text('ea:' + k, x0, y + 2 + j * 30, t, 'mono' + (k[0] === 'e' ? ' strong' : ''), narrow ? 12 : 14)));
    const mx = V().maxFaultRate({ mem: c.mem, fault: Math.max(faultUs, c.read), slowdown: 0.1 });
    items.push(D.text('ea:mx', x0, y + 2 + lines.length * 30 + 12, 'to stay within 10% of the memory speed: at most 1 fault in ' + Math.round(1 / mx).toLocaleString('en') + ' accesses', 'tick', narrow ? 12 : 13));
    const say = 'Under ' + M().policyName(pol) + ', ' + dm.faults + ' faults in ' + n + ' references give p = ' + +p.toFixed(3) + '; a fault averages ' + us(faultUs) + (pick ? ' (the path of reference ' + (pick.i + 1) + ': ' + pick.path.map((q) => q.kind === 'writeBack' ? 'write back' : q.kind).join(', ') + ')' : '') + ', so EAT = ' + us(dm.eat) + ', about ' + Math.round(dm.eat / c.mem).toLocaleString('en') + ' times a memory access.';
    return { items, say, title: 'fault cost', hold: 2200, demand: dm, metrics: [{ label: 'Fault rate', value: +p.toFixed(3) }, { label: 'Average fault', value: us(faultUs) }, { label: 'EAT', value: us(dm.eat), cls: 'act' }] };
  };
})(globalThis.Proses = globalThis.Proses || {});
