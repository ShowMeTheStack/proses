// The Scheduler lab, registered: one setup panel, six workbenches (lab-scheduler-b.js lists them). The diagram checks
// cover every preset at a middle tick and at the end, a typed workload, and the side panel's tables and metrics.
(function (S) {
  'use strict';
  const SL = S.SchedLab;

  S.Labs.add({
    id: 'scheduler', part: 'scheduling', title: 'Scheduler lab',
    blurb: 'Type a workload or pick one, then choose up to four policies with their parameters: their Gantt charts side by side, the ready queues and I/O at every tick, why each job runs when it does, and the metrics with their sums worked out. Starvation and convoys are flagged. Or sweep the quantum, watch the CFS tree and the lottery draws, test real-time tasks under RM and EDF, or see priority inversion and the protocols that bound it.',
    setup: { fields: SL.fields, presets: SL.presets, check: (v) => SL.check(v) },
    run(v, ctx) {
      switch (v.mode) {
        case 'sweep': return SL.sweep(v, ctx);
        case 'cfs': return SL.cfsRun(v, ctx);
        case 'lottery': return SL.lotteryRun(v, ctx);
        case 'rt': return SL.rtRun(v, ctx);
        case 'pi': return SL.piRun(v, ctx);
        default: return SL.compare(v, ctx);
      }
    },
  });

  if (S.Checks) {
    const clear = "try { localStorage.removeItem('proses.lab:scheduler'); } catch (e) {}";
    const pick = (k, at) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + k + "].click(); for (let n = 0; n < 60 && !(P.res && P.frames.length); n++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 300)); P.go(" + at + ", true); P.stage.finish(); " + clear;
    const mid = 'Math.floor(P.frames.length / 2)', end = 'P.frames.length - 1';
    S.Checks.push({ group: 'labs', name: 'scheduler lab', hash: 'labs/scheduler', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: clear + " const P = Proses.app.page.lab; P.go(6, true); P.stage.finish();", sel: '#main' });
    const typed = "const P = Proses.app.page.lab; for (let n = 0; n < 50 && !(P && P.res); n++) await new Promise((r) => setTimeout(r, 100)); const v = P.setup.get(); v.work = [{ id: 'Web', arrive: 0, bursts: [2, 3, 2, 3, 2], prio: 1, tickets: 100, nice: 0, cls: 0, cores: 'all' }, { id: 'Db', arrive: 1, bursts: [6, 2, 4], prio: 2, tickets: 100, nice: 0, cls: 0, cores: 'all' }, { id: 'Bk', arrive: 0, bursts: [12], prio: 5, tickets: 100, nice: 0, cls: 0, cores: 'all' }, { id: 'Ed', arrive: 3, bursts: [1, 4, 1, 4, 1], prio: 0, tickets: 100, nice: 0, cls: 0, cores: 'all' }]; v.pol1 = 'srtnp'; v.pol2 = 'mlfq'; v.pol3 = 'cfs'; v.pol4 = 'rr'; v.q4 = 3; v.cs = 1; v.boost = 12; P.setup.set(v); P.values = P.setup.get(); await P.runNow(false); P.go(30, true); P.stage.finish(); " + clear;
    S.Checks.push({ group: 'labs', name: 'scheduler lab: four policies typed', hash: 'labs/scheduler', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: typed, sel: '#main' });
    SL.presets.forEach((p, k) => {
      S.Checks.push({ group: 'labs', name: 'scheduler lab: ' + p.label, hash: 'labs/scheduler', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k, mid), sel: '#main' });
      S.Checks.push({ group: 'labs', name: 'scheduler lab: ' + p.label + ', end', hash: 'labs/scheduler', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k, end) + " P.showTab(" + (k % 2 ? "'metrics'" : "'tables'") + ');', sel: '#main' });
    });
  }
})(globalThis.Proses = globalThis.Proses || {});
