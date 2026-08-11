// The Sync lab's own side tabs: Programs (every ready-made program by family, each with what Check it finds and an
// Open button) and Step model (the same problem in the step machine's catalogue, S.Sync.catalog, checked there by
// S.MC.verify; and for a data structure, how each locking design scales with threads, from S.Sync.scaling). Then
// what the diagram checker looks at.
(function (S) {
  'use strict';
  const SL = S.SyncLab;
  const VERDICT = { ok: 'correct', deadlock: 'deadlocks', assert: 'an assert fails', invariant: 'a property breaks', starve: 'can starve', bounded: 'within the bound' };
  const page = () => S.app && S.app.page && S.app.page.lab;

  SL.renderPrograms = function (host) {
    const { h } = S.UI, P = page();
    host.appendChild(h('p.lab-note', 'Every program here is C on the simulated kernel, with its specification. Open one to load it into the editor with its run mode; Check it shows what the badge says.'));
    for (const [fam, title] of SL.FAMILIES) {
      const list = SL.PROGS.filter((p) => p.fam === fam);
      const sec = h('section.sl-fam', h('h4', title));
      for (const p of list) {
        const cur = P && P.values && P.values.src === p.src;
        const btn = h('button.btn' + (cur ? '' : '.primary'), { type: 'button', dataset: { prog: p.id }, disabled: cur ? true : null }, cur ? 'Open now' : 'Open');
        btn.addEventListener('click', () => SL.open(page(), p.id));
        sec.appendChild(h('div.sl-prog' + (cur ? '.on' : ''), h('div.sl-prog-h', h('b', p.label), h('span.sl-badge.' + (p.expect === 'ok' ? 'good' : 'bad'), VERDICT[p.expect] || p.expect), btn), h('p', p.about)));
      }
      host.appendChild(sec);
    }
    machineSection(host);
  };

  /** the step-machine programs C cannot write here, each opened on the stage */
  function machineSection(host) {
    const { h } = S.UI, P = page();
    const sec = h('section.sl-fam', h('h4', 'Step-machine programs'), h('p.lab-note', 'These need atomic instructions, a machine that buffers stores, or request tokens, so they run on the step machine (every one of its 61 programs is in the Source select).'));
    for (const id of SL.MACHINE_ONLY) {
      const c = S.Sync.catalog.find((x) => x.id === id);
      if (!c) continue;
      const spec = c.build(), about = (spec.about || (spec.spec && spec.spec.about) || ''), exp = spec.expect || (spec.spec && spec.spec.expect), live = spec.expectLive || (spec.spec && spec.spec.expectLive);
      const verdict = exp && exp !== 'ok' ? exp : live === 'starve' ? 'starve' : 'ok';
      const cur = P && P.values && P.values.source === 'model' && P.values.cat === id;
      const btn = h('button.btn' + (cur ? '' : '.primary'), { type: 'button', dataset: { cat: id }, disabled: cur ? true : null }, cur ? 'Open now' : 'Open');
      btn.addEventListener('click', () => SL.openModel(page(), id));
      sec.appendChild(h('div.sl-prog' + (cur ? '.on' : ''), h('div.sl-prog-h', h('b', c.title), h('span.sl-badge.' + (verdict === 'ok' ? 'good' : 'bad'), VERDICT[verdict] || verdict), btn), about ? h('p', about) : null));
    }
    host.appendChild(sec);
  }
  SL.openModel = async function (P, id) {
    if (!P) return;
    const v = S.LabSetup.merge(P.lab, Object.assign({}, P.values, { source: 'model', cat: id, mode: 'check', sched: '' }));
    P.values = v; P.setup.set(v); P.save();
    await P.runNow(false);
  };
  SL.renderListing = function (host, ctx) {
    const { h } = S.UI, P = page(), r = P && P.res && P.res.sync;
    if (!r || !r.P.machine) { host.appendChild(S.UI.empty('file', 'The program is in the editor', 'A C program shows each thread\'s line in the editor itself. A step-machine program (Source, in the setup) lists its steps here.')); return; }
    const b = r.run.beats[ctx.i] || r.run.beats[0];
    for (const g of SL.listing(r.P, b)) {
      const ol = h('ol.sl-listing');
      g.lines.forEach((t, k) => { const who = g.at[k + 1] || []; ol.appendChild(h('li' + (who.some((x) => x.act) ? '.act' : ''), h('code', t), ...who.map((x) => h('span.sl-tag.' + x.cls + (x.act ? '.act' : ''), x.name)))); });
      host.appendChild(h('section.lab-tsec', h('h4', (g.threads.length > 1 ? g.threads.join(', ') : g.threads[0]) + ': each runs this'), ol));
    }
    if (r.P.machine.system) host.appendChild(h('p.lab-note', 'The Chandy–Misra table has no program text: each philosopher\'s moves (get hungry, ask for a fork, hand one over, eat, finish) are the choices of every step.'));
  };

  const modelMemo = new Map();
  SL.renderModel = function (host, ctx) {
    const { h } = S.UI;
    if (ctx.values.source === 'model') {
      const c = S.Sync.catalog.find((x) => x.id === ctx.values.cat);
      const twin = SL.PROGS.find((x) => x.cat === ctx.values.cat);
      host.appendChild(h('section.lab-tsec', h('h4', 'On the stage: ' + (c ? c.title : '')), h('p.lab-note', 'This program runs on the step machine itself; the stage shows it with the same views as a C program, and Check it searches its schedules.' + (twin ? ' Its C form is the program "' + twin.label + '".' : ' It has no C form in this lab.'))));
      if (twin) { const b = h('button.btn.primary', { type: 'button', id: 'slOpenC' }, 'Open the C form'); b.addEventListener('click', () => SL.open(page(), twin.id)); host.appendChild(b); }
      return;
    }
    const p = SL.PROGS.find((x) => x.src === ctx.values.src);
    if (!p) { host.appendChild(S.UI.empty('layers', 'Your own program', 'Open a ready-made program (the Programs tab) to compare it with the same problem as a step-machine model, and, for a data structure, how it scales.')); return; }
    const c = (S.Sync.catalog || []).find((x) => x.id === p.cat);
    if (c) {
      let r = modelMemo.get(c.id);
      if (!r) { const t0 = Date.now(); const v = S.MC.verify(c.build(), { maxStates: 30000 }); r = { verdict: v.verdict, states: v.safety.stats.states, ms: Date.now() - t0, say: v.say }; modelMemo.set(c.id, r); }
      const spec = c.build(), threads = spec.threads ? spec.threads.length : '–';
      host.appendChild(h('section.lab-tsec', h('h4', 'The same problem as a step-machine model'),
        h('p.lab-note', 'The catalogue of the step machine has this problem as "' + c.title + '": ' + threads + ' threads of primitive steps (lock, wait, post, read, write), checked by the same model checker.'),
        h('div.lab-tscroll', h('table.lab-table', h('thead', h('tr', h('th', ''), h('th', 'C program (this lab)'), h('th', 'step-machine model'))),
          h('tbody', h('tr', h('th', 'what it finds'), h('td', VERDICT[p.expect] || p.expect), h('td', { class: r.verdict === 'ok' ? 'good' : 'bad' }, VERDICT[r.verdict] || r.verdict)),
            h('tr', h('th', 'states'), h('td', 'see Metrics after Check it'), h('td', String(r.states))),
            h('tr', h('th', 'time'), h('td', '–'), h('td', r.ms + ' ms'))))),
        h('p.lab-note', S.UI.inline(String(r.say).replace(/`/g, '')))));
    }
    if (p.perf) {
      const kinds = { counter: ['lock', 'sloppy', 'faa'], list: ['coarse', 'hoh'], hash: ['coarse', 'bucket'], queue: ['one-lock', 'two-lock'] }[p.perf.kind] || [p.perf.variant];
      const ns = [1, 2, 4, 8];
      const rows = kinds.map((v) => { const r = S.Sync.scaling(p.perf.kind, v, { threads: ns, ops: 12, seed: 1 }); return { v, r }; });
      const most = Math.max(...rows.flatMap((x) => x.r.map((y) => y.throughput)));
      const NAMES = { lock: 'one lock', sloppy: 'approximate (local counts)', faa: 'fetch-and-add', coarse: 'one lock', hoh: 'hand over hand', bucket: 'a lock a bucket', 'one-lock': 'one lock', 'two-lock': 'head and tail locks' };
      const tb = h('table.lab-table', h('thead', h('tr', h('th', 'design'), ...ns.map((n) => h('th', n + (n === 1 ? ' thread' : ' threads'))))),
        h('tbody', ...rows.map((x) => h('tr' + (x.v === p.perf.variant ? '.hl' : ''), h('th', NAMES[x.v] || x.v), ...x.r.map((y) => h('td', h('span.sl-bar', { style: 'width:' + Math.round(4 + 56 * y.throughput / most) + 'px' }), ' ' + y.throughput.toFixed(2)))))));
      host.appendChild(h('section.lab-tsec', h('h4', 'How the ' + p.perf.kind + ' scales: operations per tick'), h('div.lab-tscroll', tb),
        h('p.lab-note', 'An ideal machine with a core for every thread runs 12 operations a thread (S.Sync.perf): each tick every ready thread takes one step. One lock flattens out as threads queue for it; finer locks keep more threads moving. The row of this program is lit.')));
    }
  };

  if (S.Checks) {
    const clear = "try { localStorage.removeItem('proses.lab:sync'); localStorage.removeItem('proses.labTab:sync'); } catch (e) {}";
    const open = (id, extra) => "const P = Proses.app.page.lab; await Proses.SyncLab.open(P, '" + id + "'); " + (extra || '') + ' P.stage.finish(); ' + clear;
    S.Checks.push({ group: 'labs', name: 'sync lab: philosophers, deadlock found', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('phil', 'P.go(P.frames.length - 1, true); P.showTab(\'metrics\');'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: bounded buffer, random run', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('buffer', 'P.go(9, true); P.showTab(\'tables\');'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: race at machine granularity', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('race', 'P.go(Math.floor(P.frames.length / 2), true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: readers first, a writer starves', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('rw-readers', 'P.go(P.frames.length - 3, true); P.showTab(\'programs\');'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: barber, by hand', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('barber-nomutex', "P.values.mode = 'hand'; P.setup.set(P.values); await P.runNow(false); P.go(P.frames.length - 1, true);"), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: hand-over-hand list', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('list-broken', "P.go(P.frames.length - 1, true); P.showTab('model');"), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: hash table, no locks', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('hash-nolock', 'P.go(P.frames.length - 1, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: barrier', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('barrier-racy', 'P.go(P.frames.length - 1, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: reusable barrier, a sample schedule', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('barrier', 'P.go(30, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: Peterson, registers and memory', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('peterson-check', 'P.go(P.frames.length - 2, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: if instead of while, the failed thread', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('cv-if', 'P.go(P.frames.length - 1, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: two-lock queue', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('queue', 'P.go(25, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: polite livelock, the lasso', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('livelock', 'P.go(20, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: philosophers by hand, choices to click', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: open('phil', "P.values.mode = 'hand'; P.values.sched = 'P0 P1 P2'; P.setup.set(P.values); await P.runNow(false); P.go(P.frames.length - 1, true);"), sel: '#main' });
    const model = (id, extra) => "const P = Proses.app.page.lab; await Proses.SyncLab.openModel(P, '" + id + "'); " + (extra || '') + ' P.stage.finish(); ' + clear;
    S.Checks.push({ group: 'labs', name: 'sync lab: step machine, test-and-set lock starves', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: model('lock-tas', "P.go(16, true); P.showTab('listing');"), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: step machine, Peterson with store buffers', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: model('peterson-tso', 'P.go(P.frames.length - 1, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: step machine, Chandy-Misra cyclic', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: model('chandy-cyclic', 'P.go(P.frames.length - 1, true);'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: step machine, MCS lock', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: model('lock-mcs', "P.go(30, true); P.showTab('model');"), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'sync lab: step machine, bounded buffer ring', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: model('buffer-swapped', 'P.go(P.frames.length - 1, true);'), sel: '#main' });
    const typed = '#include <pthread.h>\n#include <semaphore.h>\n\nint tickets = 2, sold = 0;\nsem_t desk;\n\nvoid *clerk(void *arg) {\n    sem_wait(&desk);\n    if (tickets > 0) {\n        tickets--;\n        sold++;\n    }\n    sem_post(&desk);\n    return NULL;\n}\n\nint main(void) {\n    pthread_t a, b, c;\n    sem_init(&desk, 0, 1);\n    pthread_create(&a, NULL, clerk, NULL);\n    pthread_create(&b, NULL, clerk, NULL);\n    pthread_create(&c, NULL, clerk, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    pthread_join(c, NULL);\n    return 0;\n}\n';
    S.Checks.push({ group: 'labs', name: 'sync lab: a typed program, checked', hash: 'labs/sync', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.setup.editor.set(" + JSON.stringify(typed) + ", true); P.values = Object.assign({}, P.values, { src: P.setup.editor.get(), mode: 'check', gran: 'statement', spec: [{ kind: 'deadlock', what: '' }, { kind: 'always', what: 'tickets + sold == 2' }, { kind: 'end', what: 'sold == 2' }] }); P.setup.set(P.values); await P.runNow(false); P.go(12, true); P.stage.finish(); " + clear, sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
