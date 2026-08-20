// The VM lab, part four: virtualising the CPU. A guest kernel's instruction stream the student types (ordinary,
// privileged and sensitive instructions, with popf's flag and lcr3's table base) runs under trap-and-emulate, binary
// translation and hardware support side by side (S.Virt.run), instruction by instruction: each one's fate in each
// technique (native, a trap and emulation, a translated call, a VM exit, or wrong with no trap), the virtual CPU the
// guest believes in against the real one, and the cycles and exits counted with the student's own cycle costs.
//   VX.TECHS [{id, label, short}]   VX.program(rows) -> engine program   VX.cpuRun(v, ctx) -> the lab's result
(function (S) {
  'use strict';
  const VX = S.VmmLab;
  const box = (x, y, w, h) => ({ x, y, w, h });
  VX.TECHS = [{ id: 'trap-emulate', label: 'Trap-and-emulate', short: 'trap & emulate', field: 'cTE' }, { id: 'binary-translation', label: 'Binary translation', short: 'translation', field: 'cBT' }, { id: 'hardware', label: 'Hardware support', short: 'hardware', field: 'cHW' }];
  VX.techsOn = (v) => VX.TECHS.filter((t) => v[t.field]);
  VX.program = (rows) => rows.map((r) => {
    const a = String(r.arg === undefined || r.arg === null ? '' : r.arg).trim();
    if (r.op === 'popf') return { op: 'popf', arg: a === '' ? 1 : Number(VX.parseHex(a)) ? 1 : 0 };
    if (r.op === 'lcr3') return { op: 'lcr3', arg: a === '' ? 0x3000 : Number(VX.parseHex(a)) };
    return { op: r.op };
  });
  VX.insText = (x) => x.op + (x.arg !== undefined ? ' ' + (x.op === 'lcr3' ? '0x' + x.arg.toString(16) : x.arg) : '');
  const FATE = { native: ['runs natively', 'native', 'good'], trap: ['trap, emulated', 'trap', 'act'], wrong: ['no trap: wrong', 'wrong', 'hot'], call: ['translated call', 'call', 'act'], exit: ['VM exit', 'exit', 'act'] };
  VX.costsOf = (v) => ({ native: v.cNative, trap: v.cTrap, exit: v.cExit, call: v.cCall, translate: v.cTranslate });

  VX.cpuRun = function (v, ctx) {
    const V = S.Virt, narrow = ctx.narrow, techs = VX.techsOn(v), prog = VX.program(v.cProg), n = prog.length, rep = v.cRepeat;
    const C = VX.costsOf(v);
    const runs = techs.map((t) => ({ t, R: VX.withCosts(C, () => V.run({ program: prog, technique: t.id, arch: v.cArch, repeat: rep, ept: v.cEpt })) }));
    const stepCost = (st) => (st.kind === 'native' || st.kind === 'wrong' ? C.native : st.kind === 'trap' ? C.trap : st.kind === 'exit' ? C.exit : st.kind === 'call' ? C.call : st.kind === 'translate' ? C.translate * n : 0);
    // each technique's state after its j-th instruction (j = −1: before any; −2: the start)
    for (const r of runs) {
      r.ops = r.R.steps.filter((s) => s.op);
      r.cum = []; let c = 0, ex = 0;
      r.R.steps.forEach((s) => { c += stepCost(s); if (s.kind === 'trap' || s.kind === 'exit') ex++; s._cyc = c; s._ex = ex; });
    }
    const T = runs.length;
    // ---- geometry
    const lw = narrow ? 100 : 140, x0 = lw + (narrow ? 8 : 20), x1 = narrow ? 374 : 990, colW = narrow ? (x1 - x0) / T : Math.min(300, (x1 - x0) / T), rowH = narrow ? 27 : 32, y0 = 44;
    const listH = n * rowH;
    const stY = y0 + listH + 20;
    const stH = narrow ? 0 : 2 * 32 + 18;
    const barY = narrow ? stY : stY + stH + 20;
    const pic = (j, pass, cur) => {
      const items = [VX.title('lt', 0, 26, rep > 1 ? (narrow ? 'code ' : 'code, pass ') + (pass + 1) + '/' + rep : narrow ? 'code' : 'guest kernel code')];
      prog.forEach((ins, i) => items.push(VX.cell('in' + i, 0, y0 + i * rowH, lw, rowH - 4, VX.insText(ins), 'vx-ins mono' + (narrow ? ' small' : '') + (cur === i ? ' act' : '') + (V.INSTR[ins.op] && V.INSTR[ins.op].sensitive ? ' sens' : ''), narrow ? 13 : 14, { rx: 4, align: 'left' })));
      runs.forEach((r, k) => {
        const cx = x0 + k * colW;
        items.push(VX.text('th' + k, cx + (colW - 10) / 2, 26, narrow ? r.t.short : r.t.label, 'strong', narrow ? 12 : 14, 'middle'));
        for (let i = 0; i < n; i++) {
          const idx = pass * n + i;
          if (idx > j) continue;
          const st = r.ops[idx], f = FATE[st.kind] || [st.kind, st.kind, ''];
          items.push(VX.cell('f' + k + '_' + i, cx, y0 + i * rowH + 2, colW - 10, rowH - 8, narrow ? f[1] : f[0], 'vx-fate ' + f[2] + (cur === i ? ' cur' : ''), narrow ? 12 : 13, { rx: 10 }));
        }
      });
      return items;
    };
    const stateOf = (r, j) => (j < 0 ? r.R.steps[0] : r.ops[j]);
    const cpuPic = (j) => {
      const items = [];
      if (narrow) return items;
      runs.forEach((r, k) => {
        const s = stateOf(r, j), vc = s.vcpu, rc = s.real;
        const vt = (narrow ? r.t.short + ' sees: ' : '') + vc.mode + ' · IF ' + (vc.IF ? 1 : 0) + ' · cr3 0x' + vc.cr3.toString(16);
        const rt = (narrow ? 'machine: ' : '') + rc.mode + ' · IF ' + (rc.IF ? 1 : 0);
        if (narrow) {
          items.push(VX.cell('vc' + k, 0, stY + k * 60, 370, 26, vt, 'vx-vcpu', 12, { rx: 4, align: 'left' }));
          items.push(VX.cell('rc' + k, 0, stY + k * 60 + 28, 370, 26, rt, 'vx-rcpu', 12, { rx: 4, align: 'left' }));
        } else {
          const cx = x0 + k * colW;
          items.push(VX.cell('vc' + k, cx, stY, colW - 10, 28, vt, 'vx-vcpu', 13, { rx: 4, align: 'left' }));
          items.push(VX.cell('rc' + k, cx, stY + 34, colW - 10, 28, rt, 'vx-rcpu', 13, { rx: 4, align: 'left' }));
        }
      });
      if (!narrow) {
        items.push(VX.text('vcl', x0 - 12, stY + 19, 'guest sees', 'tick', 13, 'end'));
        items.push(VX.text('rcl', x0 - 12, stY + 53, 'machine', 'tick', 13, 'end'));
      }
      return items;
    };
    const maxC = Math.max(1, ...runs.map((r) => r.R.cycles));
    const bars = (j, final) => {
      const rows = runs.map((r) => {
        const s = final ? r.R.steps[r.R.steps.length - 1] : j < 0 ? (r.R.steps.find((x) => x.kind === 'translate' && j === -1) || r.R.steps[0]) : r.ops[j];
        const ex = r.t.id === 'trap-emulate' ? ['trap', 'traps'] : r.t.id === 'hardware' ? ['exit', 'exits'] : ['call', 'calls'];
        const exN = r.t.id === 'binary-translation' ? r.R.steps.slice(0, r.R.steps.indexOf(s) + 1).filter((x) => x.kind === 'call').length : s._ex;
        const wrong = r.R.steps.slice(0, r.R.steps.indexOf(s) + 1).filter((x) => x.kind === 'wrong').length;
        return { label: narrow ? r.t.short : r.t.label, v: s._cyc, text: narrow ? s._cyc + ' · ' + (wrong ? wrong + ' wrong' : exN + ' ' + (exN === 1 ? ex[0] : ex[1])) : s._cyc + ' cycles · ' + exN + ' ' + (exN === 1 ? ex[0] : ex[1]) + (wrong ? ' · ' + wrong + ' wrong' : ''), cls: wrong ? 'vx-wrongbar' : 'vx-cycbar' };
      });
      const lg = VX.legend({ prefix: 'lg', x: 0, y: barY + 16 + T * 30 + 10, maxW: narrow ? 370 : 900, entries: narrow ? [{ cls: 'vx-fate good', text: 'native' }, { cls: 'vx-fate act', text: 'to the VMM' }, { cls: 'vx-fate hot', text: 'wrong' }, { cls: 'vx-ins sens', text: 'sensitive' }] : [{ cls: 'vx-fate good', text: 'runs natively' }, { cls: 'vx-fate act', text: 'reaches the VMM (trap, call or exit)' }, { cls: 'vx-fate hot', text: 'wrong: no trap' }, { cls: 'vx-ins sens', text: 'a sensitive instruction' }] }).items;
      return [...lg, VX.title('bt', 0, barY, narrow ? 'cycles so far' : 'cycles so far (native ' + C.native + ', trap ' + C.trap + ', exit ' + C.exit + ', call ' + C.call + ', translate ' + C.translate + ' an instruction)'), ...VX.bars({ prefix: 'cb', x: 0, y: barY + 16, labelW: narrow ? 104 : 170, w: narrow ? 110 : 440, rowH: 30, rows, max: maxC, size: 13 }).items];
    };
    const lgH = narrow ? 2 * 26 + 20 : 26;
    const view = narrow ? box(-6, -4, 386, barY + 16 + T * 30 + 12 + lgH) : box(-10, -4, 1010, barY + 16 + T * 30 + 12 + lgH);
    const tablesAt = (j) => [{ title: 'Each instruction’s fate', cols: ['#', 'instruction'].concat(runs.map((r) => r.t.short)), rows: Array.from({ length: Math.max(0, j + 1) }, (_, idx) => [String(idx + 1), VX.insText(prog[idx % n])].concat(runs.map((r) => { const st = r.ops[idx], f = FATE[st.kind]; return { text: f ? f[1] : st.kind, cls: st.kind === 'wrong' ? 'bad' : st.kind === 'native' ? 'good' : '' }; }))), hl: j }];
    const metricsAt = (final) => [].concat(...runs.map((r) => [
      { label: r.t.label + ': cycles', value: final ? r.R.cycles : '…', unit: final ? 'cycles' : '' },
      { label: r.t.label + (r.t.id === 'hardware' ? ': VM exits' : r.t.id === 'trap-emulate' ? ': traps' : ': translated'), value: r.t.id === 'hardware' ? r.R.exits : r.t.id === 'trap-emulate' ? r.R.traps : r.R.translated },
      { label: r.t.label + ': correct?', value: r.R.wrong.length ? r.R.wrong.length + ' wrong' : 'yes', cls: r.R.wrong.length ? 'bad' : 'good' },
    ]));

    const frames = [], trace = [];
    const add = (kind, say, items, j, final, title) => {
      trace.push({ kind, say });
      frames.push({ items, say, at: trace.length - 1, view, title, tables: tablesAt(j), metrics: metricsAt(final), hold: final ? 2600 : 1200 });
    };
    const join = (parts) => (parts.length === 1 ? parts[0].s : parts.every((p) => p.s === parts[0].s) ? 'In ' + (parts.length === 2 ? 'both' : 'all ' + parts.length) + ' techniques: ' + parts[0].s : parts.map((p) => p.t.label + ': ' + p.s).join(' '));
    add('start', join(runs.map((r) => ({ t: r.t, s: VX.plain(r.R.steps[0].say) }))) + ' The program has ' + VX.plural(n, 'instruction') + (rep > 1 ? ', run ' + rep + ' times' : '') + '.', [...pic(-1, 0, null), ...cpuPic(-1), ...bars(-2)], -1, false, 'start');
    const bt = runs.find((r) => r.t.id === 'binary-translation');
    if (bt) {
      const tr = bt.R.steps.find((s) => s.kind === 'translate');
      add('translate', VX.plain(tr.say), [...pic(-1, 0, null), ...cpuPic(-1), ...bars(-1)], -1, false, 'translate');
    }
    for (let j = 0; j < n * rep; j++) {
      const pass = Math.floor(j / n), i = j % n;
      const parts = runs.map((r) => {
        const st = r.ops[j];
        let s = VX.plain(st.say);
        if (r.t.id === 'binary-translation' && i === 0 && pass > 0) { const c = r.R.steps[r.R.steps.indexOf(st) - 1]; if (c && c.kind === 'cache') s = VX.plain(c.say) + ' ' + s; }
        return { t: r.t, s };
      });
      add('ins', (rep > 1 ? 'Pass ' + (pass + 1) + '. ' : '') + join(parts), [...pic(j, pass, i), ...cpuPic(j), ...bars(j)], j, false, VX.insText(prog[i]));
    }
    add('end', join(runs.map((r) => ({ t: r.t, s: VX.plain(r.R.steps[r.R.steps.length - 1].say) }))), [...pic(n * rep - 1, rep - 1, null), ...cpuPic(n * rep - 1), ...bars(0, true)], n * rep - 1, true, 'totals');
    return { frames, trace, tables: frames[frames.length - 1].tables, metrics: frames[frames.length - 1].metrics, plan: { runs, prog } };
  };
})(globalThis.Proses = globalThis.Proses || {});
