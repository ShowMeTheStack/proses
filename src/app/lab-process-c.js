// The Process lab, part three: the lab itself. A C program in the editor runs on the simulated kernel; the stage shows
// the fork tree and the timeline beside one detail view (the process table, the stdout buffers, the descriptor tables
// with the open-file table and the pipes, the copy-on-write pages, the signals, or the threads) and the terminal. Who
// runs next is the student's: by hand (click a ready process), FIFO, round robin or a seeded random choice; stdout can
// be a terminal or a pipe, and with threads the steps can be single loads and stores. "Every output" lists each
// distinct output the program can print, with a schedule that replays it.
(function (S) {
  'use strict';
  const PL = S.ProcLab, PD = S.ProcDraw;
  const box = (x, y, w, h) => ({ x, y, w, h });
  const SHOWS = [
    { value: 'auto', label: 'What the program uses' }, { value: 'procs', label: 'Process table' }, { value: 'buffers', label: 'stdout buffers' },
    { value: 'fds', label: 'Descriptors and pipes' }, { value: 'pages', label: 'Copy-on-write pages' }, { value: 'signals', label: 'Signals' }, { value: 'threads', label: 'Threads and shared variables' },
  ];
  const POLICIES = [{ value: 'hand', label: 'You choose: click a ready process' }, { value: 'fifo', label: 'FIFO: run until it blocks' }, { value: 'rr', label: 'Round robin' }, { value: 'random', label: 'Random, from the seed' }];
  const autoShow = (src) => (/pthread_create/.test(src) ? 'threads' : /\b(signal|sigaction|kill|alarm|pause)\s*\(/.test(src) ? 'signals' : /\b(pipe|dup2?|open)\s*\(/.test(src) ? 'fds' : /\bfork\s*\(/.test(src) ? 'procs' : 'buffers');
  PL.autoShow = autoShow;
  /** the files table as {name: text}; "\n" in a cell is a new line */
  PL.filesOf = (rows) => { const o = {}; for (const r of rows || []) if (r.name) { const t = String(r.text || '').replace(/\\n/g, '\n'); o[r.name] = t && !t.endsWith('\n') ? t + '\n' : t; } return o; };
  const FILE_ROWS = Object.entries(PL.FILES).map(([name, text]) => ({ name, text: text.replace(/\n$/, '').replace(/\n/g, '\\n') }));
  PL.optsOf = (v, seed) => ({ tty: v.tty !== false, files: PL.filesOf(v.files), policy: v.policy === 'hand' ? 'fifo' : v.policy, quantum: v.q || 1, seed: seed || 1, gran: v.gran || 'statement', hand: v.policy === 'hand', sched: PL.parseSched(v.sched), shell: false });

  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  /** the sentences of one step's events, each capitalised; a thread's run of loads, adds and stores at one line is
   *  told once: "Thread 101 (process 100), line 7: computes 1, then stores 1 to `count`." */
  PL.joinSays = function (evs, C) {
    const name = (a) => (C && C.objName && C.objName(+a) ? '`' + C.objName(+a) + '`' : String(a));
    const out = [];
    for (let k = 0; k < evs.length; k++) {
      const e = evs[k];
      if (e.mstep) {
        const run = [e];
        while (k + 1 < evs.length && evs[k + 1].mstep && evs[k + 1].tid === e.tid && evs[k + 1].line === e.line) run.push(evs[++k]);
        const parts = run.map((x) => { const m = x.mstep; return m.what === 'load' ? 'loads ' + m.value + ' from ' + name(m.addr) : m.what === 'store' ? 'stores ' + m.value + ' to ' + name(m.addr) : m.what === 'op' ? 'computes ' + m.value : 'copies memory'; });
        out.push('Thread `' + e.tid + '` (process `' + e.pid + '`), line `' + e.line + '`: ' + parts.join(', then ') + '.');
        continue;
      }
      let t = String(e.say);
      if (C && C.objName) t = t.replace(/((?:mutex|semaphore|condition variable) at )(\d+)/g, (m, a, addr) => (C.objName(+addr) ? a.replace(/ at $/, ' ') + name(addr) : m));
      out.push(cap(t));
    }
    return out;
  };
  /** one sentence (or a few) for a beat, from the engine's own */
  function sayOf(b, C) {
    // an exit is told again by the zombie sentence that follows it
    const evs = b.evs.filter((e) => e.say && (e.mstep || !PL.QUIET.has(e.kind) || e.kind === 'buffer' || e.kind === 'cow') && !(e.kind === 'exit' && b.evs.some((z) => z.kind === 'zombie' && z.pid === e.pid)));
    const says = PL.joinSays(evs.length ? evs : b.main && b.main.say ? [b.main] : [], C);
    return says.slice(0, 3).join(' ');
  }

  function build(v, ctx, res, src) {
    const C = PD.context(res, src), narrow = ctx.narrow, show = v.show === 'auto' ? autoShow(src) : v.show, hand = v.policy === 'hand';
    const n = res.beats.length, frames = [];
    const W = narrow ? 380 : 930, LW = 400, RX = 430, RW = 500;
    const y0 = hand ? 44 : 0;
    // the detail panel's tallest beat, so the terminal under it stays put
    const panelKind = narrow && show === 'procs' ? null : show;
    let panelH = 0;
    C.machine = v.gran === 'machine';
    const treeH0 = C.maxLevels * 72 - 20, tlH = 24 + Math.min(10, C.laneIds.length) * 20;
    const leftOf = !narrow && panelKind === 'threads' ? { x: 0, y: y0 + treeH0 + 22 + tlH + 20, w: LW } : null;
    let extraLeft = 0;
    const panels = res.beats.map((b, i) => { if (!panelKind) return null; const p = PD.panel(panelKind, b, C, i, narrow ? 0 : RX, y0, narrow ? W : RW, { narrow, left: leftOf }); panelH = Math.max(panelH, p.h); extraLeft = Math.max(extraLeft, p.leftH || 0); return p; });
    const treeH = treeH0, leftH = treeH + 22 + tlH + (extraLeft ? 20 + extraLeft : 0), termH = 200;
    // the terminal goes under the shorter column
    const termLeft = Math.max(leftH + 22 + termH, panelH) <= Math.max(leftH, panelH + 18 + termH);
    for (let i = 0; i < n; i++) {
      const b = res.beats[i], items = [], last = i === n - 1;
      const pick = last && res.waiting ? res.waiting.filter((c) => typeof c === 'number').map((c) => PD.pidOf(res, c)) : [];
      if (hand) items.push(...PD.chooser(C, res, i, 0, 0, W).items);
      if (!narrow) {
        items.push(...PD.tree(b, C, i, 0, y0, LW, { pick }).items);
        items.push(...PD.timeline(C, i, 0, y0 + treeH + 22, LW).items);
        items.push(...panels[i].items);
        const tt = v.tty === false ? 'stdout goes to a pipe: what its reader gets' : 'terminal';
        items.push(...(termLeft ? PD.term(b, C, 0, y0 + leftH + 22, LW, { sys: res.sys, rowsShown: 4, title: tt }) : PD.term(b, C, RX, y0 + panelH + 18, RW, { sys: res.sys, rowsShown: 4, title: tt })).items);
      } else {
        let y = y0;
        if (panelKind) { items.push(...panels[i].items); y += panelH + 16; } else { items.push(...PD.tree(b, C, i, 0, y0, W, { pick }).items); y += treeH + 18; }
        items.push(...PD.term(b, C, 0, y, W, { sys: res.sys, rowsShown: 3, title: v.tty === false ? 'stdout → a pipe' : 'terminal' }).items);
      }
      const marks = [];
      for (const p of b.snap) {
        if (p.role !== 'prog' || p.image !== 'c' || p.state === 'zombie' || p.state === 'reaped') continue;
        const ts = C.threaded ? p.threads.filter((t) => t.state !== 'done') : [p.threads.find((t) => t.main) || p.threads[0]];
        for (const t of ts) if (t && t.line) marks.push({ line: t.line, tag: C.threaded && !t.main ? 'T' + t.tid : String(p.pid), cls: C.threaded ? 'p' + (C.laneIds.indexOf(t.tid) % 6) : C.cls(p.pid), act: b.main && (b.main.tid ? b.main.tid === t.tid : b.main.pid === p.pid), title: (C.threaded ? 'thread ' + t.tid : 'pid ' + p.pid) + ', ' + t.state });
      }
      let say = sayOf(b, C);
      if (last && res.bad) say = 'The schedule asks for ' + res.bad.choice + ' at choice ' + (res.bad.at + 1) + ', but only ' + res.bad.choices.join(', ') + ' can run then: click one of them, or edit the choices.';
      else if (last && res.waiting) say = (i ? say + ' ' : '') + 'Your turn: ' + res.waiting.map((c) => (typeof c === 'string' ? 'the alarm of ' + c.slice(1) : String(c))).join(', ') + ' can run. Click one: it runs until it does something another process can notice.';
      frames.push({ items, say, title: b.main ? b.main.kind : '', at: b.at, marks, hold: b.main && b.main.kind === 'step' ? 700 : 1200, tables: tablesOf(b, C, i), metrics: metricsOf(res, C, i) });
    }
    return frames;
  }
  function tablesOf(b, C, i) {
    const ps = b.snap.filter((p) => p.role === 'prog');
    const act = ps.findIndex((p) => b.main && p.pid === b.main.pid);
    const st = (p) => ({ text: p.state, cls: p.state === 'zombie' ? 'bad' : p.state === 'running' ? 'good' : '' });
    const out = [{ title: 'Processes', cols: ['pid', 'ppid', 'pgid', 'state', 'line', 'exit', 'reaped by'], hl: act, rows: ps.map((p) => [C.label(p.pid, i), String(p.ppid), String(p.pgid), st(p), p.image === 'c' && p.state !== 'zombie' && p.state !== 'reaped' ? String(p.line) : '–', p.exitCode === null || p.exitCode === undefined ? '–' : String(p.exitCode), p.reapedBy ? String(p.reapedBy) : '–']) }];
    const fdRows = [];
    for (const p of ps) if (p.state !== 'zombie' && p.state !== 'reaped') p.fds.forEach((id, fd) => { if (id !== null && id !== undefined && b.ks.ofiles[id]) fdRows.push([String(p.pid), String(fd), '#' + id, PD.ofText(b.ks.ofiles[id], b.ks), String(b.ks.ofiles[id].refs)]); });
    out.push({ title: 'Descriptors', cols: ['pid', 'fd', 'entry', 'open file', 'refs'], rows: fdRows });
    const sigRows = [];
    for (const p of ps) if (p.state !== 'reaped') {
      const hs = Object.entries(p.handlers || {}).map(([s, h]) => (S.Kern.SIGNAME[s] || s) + ' → ' + (h === 'ign' ? 'ignore' : h.fn));
      const mask = p.threads && p.threads[0] ? p.threads[0].mask : 0, bl = [], pe = [];
      for (let s = 1; s < 32; s++) { if (p.pending & (1 << (s - 1))) pe.push(S.Kern.SIGNAME[s] || s); if (mask & (1 << (s - 1))) bl.push(S.Kern.SIGNAME[s] || s); }
      sigRows.push([String(p.pid), hs.join(', ') || 'all default', pe.join(' ') || '–', bl.join(' ') || '–']);
    }
    out.push({ title: 'Signals', cols: ['pid', 'handlers', 'pending', 'blocked'], rows: sigRows });
    return out;
  }
  function metricsOf(res, C, i) {
    const upto = res.beats.slice(0, i + 1), evs = upto.flatMap((b) => b.evs), b = res.beats[i];
    const count = (k) => evs.filter((e) => e.kind === k).length;
    const lines = res.sys.term.slice(0, b.nterm).map((w) => w.text).join('').split('\n').filter(Boolean).length;
    const zombies = b.snap.filter((p) => p.role === 'prog' && p.state === 'zombie').length;
    return [
      { label: 'Processes created', value: count('fork') + 1 }, { label: 'Lines printed', value: lines },
      { label: 'Zombies now', value: zombies, cls: zombies ? 'bad' : '' }, { label: 'Adopted by init', value: count('reparent'), cls: count('reparent') ? 'act' : '' },
      { label: 'Pages copied on write', value: count('cow') }, { label: 'Signals sent', value: count('signal') },
      { label: 'Clock', value: b.clock, unit: 's' }, { label: 'Pictures', value: (i + 1) + ' of ' + res.beats.length },
    ];
  }

  // ---- by hand: a click on a choice ----------------------------------------------------------------------------------
  function hook() {
    setTimeout(() => {
      const P = S.app && S.app.page && S.app.page.lab;
      if (!P || !P.lab || P.lab.id !== 'process' || !P.stage) return;
      P.stage.onPick = (key) => PL.pick(P, key);
    }, 0);
  }
  PL.pick = async function (P, key) {
    const res = P.res && P.res.proc;
    if (!res || !res.waiting || P.i !== P.frames.length - 1) return;
    const list = PL.parseSched(P.values.sched).slice(0, res.decisions.length);
    let c = null;
    const m = /^pick:(.+)$/.exec(key) || /^tr:n(\d+)$/.exec(key);
    if (!m) return;
    if (m[1] === 'undo') list.pop();
    else {
      const w = /^\d+$/.test(m[1]) ? +m[1] : m[1];
      c = res.waiting.includes(w) ? w : res.waiting.find((x) => typeof x === 'number' && PD.pidOf(res, x) === w);
      if (c === undefined || c === null) return;
      list.push(c);
    }
    const v = Object.assign({}, P.values, { sched: PL.schedText(list) });
    P.values = v; P.setup.set(v); P.save();
    await P.runNow(false);
    if (P.frames.length > 1) { P.go(P.frames.length - 2, true); P.go(P.frames.length - 1); }
  };

  // ---- every output ------------------------------------------------------------------------------------------------
  let every = { key: null, r: null, busy: false };
  const everyKey = (v) => JSON.stringify([v.src, v.tty, v.gran, v.files]);
  function renderEvery(host, ctx) {
    const { h } = S.UI, v = ctx.values, key = everyKey(v);
    const head = h('div.pl-every-head');
    host.appendChild(head);
    if (every.key !== key || !every.r) {
      const btn = h('button.btn.primary', { type: 'button', id: 'plEvery' }, every.busy ? 'Searching every schedule…' : 'List every output');
      btn.disabled = every.busy;
      btn.addEventListener('click', () => {
        every.busy = true; btn.disabled = true; btn.textContent = 'Searching every schedule…';
        setTimeout(() => {
          let r;
          try { r = PL.every(v.src, PL.optsOf(v, 1)); } catch (e) { r = { error: e.msg || e.message }; }
          every = { key, r, busy: false };
          const P = S.app && S.app.page && S.app.page.lab;
          if (P) P.showTab('outputs', true);
        }, 30);
      });
      head.append(h('p.lab-note', 'Every schedule the kernel could choose is tried (each process running up to its next action another can notice), and each different output is listed once, with a schedule that prints it.'), btn);
      return;
    }
    const r = every.r;
    if (r.error) { head.appendChild(h('p.lab-note.bad', 'The search stopped: ' + r.error)); return; }
    const ends = r.list.filter((x) => !x.hangs).length, hangs = r.list.filter((x) => x.hangs).length;
    head.append(h('div.pl-count', h('b.mono', { id: 'plEveryCount' }, String(r.list.length)), h('span', ' different output' + (r.list.length === 1 ? '' : 's') + (hangs ? ' (' + hangs + ' where the program can hang)' : ''))),
      h('p.lab-note', r.states + ' states searched' + (r.complete ? ', every schedule covered.' : '; the search stopped at its limit, so there may be more.') + (ends && hangs ? '' : '')));
    const ol = h('ol.pl-outs', { id: 'plOuts' });
    r.list.slice(0, 120).forEach((x, k) => {
      const replay = h('button.btn.small', { type: 'button', dataset: { k: String(k) } }, 'Replay');
      replay.addEventListener('click', async () => {
        const P = S.app.page.lab;
        const nv = Object.assign({}, P.values, { policy: 'hand', sched: PL.schedText(x.hangs && x.hangPath ? x.hangPath : x.sched) });
        P.values = nv; P.setup.set(nv); P.save();
        await P.runNow(false);
        P.go(0, true); P.play();
      });
      ol.appendChild(h('li.pl-out' + (x.hangs ? '.hangs' : ''), h('div.pl-out-h', h('span.pl-out-n', '#' + (k + 1)), x.hangs ? h('span.pl-tag.bad', 'can hang') : null, replay),
        h('pre.mono.pl-out-text', x.out === '' ? '(nothing)' : x.out.replace(/\n$/, '')),
        h('div.pl-sched', h('span.lab-note', 'schedule: '), h('code', x.sched.length ? PL.schedText(x.hangs && x.hangPath ? x.hangPath : x.sched) : 'any (no choice matters)'))));
    });
    host.appendChild(ol);
    if (r.list.length > 120) host.appendChild(h('p.lab-note', 'The first 120 of ' + r.list.length + ' outputs.'));
  }

  const PRESETS = PL.PROGS.map((p) => ({ label: p.label || p.name.replace(/\.c$/, '').replace(/-/g, ' '), values: { src: p.src, show: p.show, policy: p.policy, tty: p.tty !== false, gran: p.gran || 'statement', sched: p.sched || '' } }));
  S.Labs.add({
    id: 'process', part: 'processes', icon: 'terminal', title: 'Process lab', wide: true,
    blurb: 'A C program on the simulated kernel: its fork tree, timeline, terminal and stdout buffers, the descriptor tables, the copy-on-write pages and the signals. You choose who runs next, and can list every output it can print.',
    setup: {
      fields: [
        { id: 'src', label: 'Program', type: 'code', def: PL.PROGS[0].src, examples: PL.PROGS.map((p) => ({ name: p.name, src: p.src })), files: 'process', minLines: 14 },
        { id: 'show', label: 'Beside the tree', type: 'select', group: 'View', options: SHOWS, def: 'auto' },
        { id: 'policy', label: 'Who runs next', type: 'select', group: 'Kernel', options: POLICIES, def: 'fifo' },
        { id: 'q', label: 'Quantum', type: 'number', min: 1, max: 20, def: 2, unit: 'statements', show: (v) => v.policy === 'rr' },
        { id: 'sched', label: 'Your choices so far', type: 'text', def: '', placeholder: 'click a ready process on the stage', pattern: '^[0-9a\\s]*$', patternWhy: 'numbers (a thread or process), or a then a pid for its alarm', show: (v) => v.policy === 'hand', help: 'Each number runs that process or thread until it does something another process could notice; `a101` fires the alarm of 101. A schedule from **Every output** replays here.' },
        { id: 'tty', label: 'stdout is a terminal (off: a pipe)', type: 'toggle', def: true, help: 'A terminal is line-buffered: a newline sends the line. A pipe is fully buffered: text waits for exit or fflush.' },
        { id: 'gran', label: 'A step is', type: 'select', options: [{ value: 'statement', label: 'a statement' }, { value: 'machine', label: 'a load, an add or a store (threads)' }], def: 'statement' },
        { id: 'files', label: 'Files on the disk', type: 'table', group: 'Disk', def: FILE_ROWS, minRows: 0, maxRows: 5, columns: [{ id: 'name', label: 'Name', type: 'text', pattern: '^[A-Za-z0-9_.-]{1,20}$', patternWhy: 'letters, digits, dot, dash or underscore', width: '110px' }, { id: 'text', label: 'Contents (\\n: new line)', type: 'text' }], newRow: (i) => ({ name: 'file' + (i + 1) + '.txt', text: 'line one\\nline two' }), check: (r, i, rows) => (rows.findIndex((x) => x.name === r.name) !== i ? { name: 'two files are called ' + r.name } : null) },
      ],
      presets: PRESETS,
    },
    views: [{ id: 'outputs', label: 'Every output', render: renderEvery }],
    run(v, ctx) {
      const src = v.src;
      try { S.Kern.compile(src); } catch (e) { return { error: e, frames: [] }; }
      const res = PL.run(src, PL.optsOf(v, ctx.seed));
      hook();
      const frames = build(v, ctx, res, src);
      const trace = res.beats.flatMap((b) => b.evs.filter((e) => e.say && e.kind !== 'step').map((e) => ({ kind: e.kind, say: e.say, pid: e.pid, at: b.at })));
      // a frame's place in the trace: the index of its first sentence
      let k = 0;
      res.beats.forEach((b, i) => { frames[i].at = k; k += b.evs.filter((e) => e.say && e.kind !== 'step').length; });
      const last = frames[frames.length - 1];
      return { frames, trace, tables: last.tables, metrics: last.metrics, proc: res };
    },
  });

  if (S.Checks) {
    const go = (k) => "const P = Proses.app.page.lab; P.go(" + k + ", true); P.stage.finish();";
    const preset = (n) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + n + "].click(); await new Promise((r) => setTimeout(r, 900)); P.go(P.frames.length - 1, true); P.stage.finish(); try { localStorage.removeItem('proses.lab:process'); } catch (e) {}";
    S.Checks.push({ group: 'labs', name: 'process lab', hash: 'labs/process', fresh: true, ready: "document.querySelector('#labView svg .it') && document.querySelector('.le-tag')", setup: go(6), sel: '#main' });
    PRESETS.forEach((p, k) => S.Checks.push({ group: 'labs', name: 'process lab: ' + p.label, hash: 'labs/process', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: preset(k), sel: '#main' }));
    S.Checks.push({ group: 'labs', name: 'process lab: by hand, every output', hash: 'labs/process', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[1].click(); await new Promise((r) => setTimeout(r, 900)); P.showTab('outputs'); document.getElementById('plEvery').click(); for (let k = 0; k < 100 && !document.getElementById('plOuts'); k++) await new Promise((r) => setTimeout(r, 100)); P.go(P.frames.length - 1, true); P.stage.finish(); try { localStorage.removeItem('proses.lab:process'); } catch (e) {}", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
