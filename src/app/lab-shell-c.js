// The Shell lab, part three: the lab itself. The student completes a small shell in C (the skeleton has the main loop,
// fgets and strtok) and types lines into it at a simulated terminal, with ^C and ^Z; the stage shows every child,
// pipe and process group, and which group has the terminal. The Tests tab runs the job-control tests and shows a
// failing run's trace; the Reference tab keeps a complete shell hidden until the student asks for it.
(function (S) {
  'use strict';
  const SL = S.ShellLab, PL = S.ProcLab;
  const L = (type, key) => ({ type, key: key || '' });
  const SESSIONS = {
    pipes: { label: 'Pipelines and redirection', lines: [L('echo hello there | wc'), L('cat fruit.txt | sort | head -n 2'), L('sort < fruit.txt > sorted.txt'), L('cat sorted.txt')] },
    jobs: { label: 'A background job, then ^C', lines: [L('sleep 3 &'), L('sleep 5', 'C'), L('echo still here')] },
    stop: { label: '^Z, then fg', lines: [L('sleep 4', 'Z'), L('echo the shell reads on'), L('fg')] },
    yes: { label: 'yes | head: the writer gets SIGPIPE', lines: [L('yes | head -n 3')] },
    zombies: { label: 'Jobs that end while the shell reads', lines: [L('sleep 1 &'), L('sleep 2 &'), L('echo two jobs started')] },
  };
  SL.SESSIONS = SESSIONS;
  const FILE_ROWS = [{ name: 'fruit.txt', text: 'pear\\napple\\nfig\\nbanana' }];
  const linesOf = (v) => (v.session === 'mine' ? v.lines || [] : (SESSIONS[v.session] || SESSIONS.pipes).lines);
  SL.linesOf = linesOf;
  SL.optsOf = (v, seed) => ({ files: PL.filesOf(v.files), policy: v.policy, quantum: v.q || 2, seed: seed || 1, pipeCap: +v.cap || 64, beats: true });
  const page = () => S.app && S.app.page && S.app.page.lab && S.app.page.lab.lab.id === 'shell' ? S.app.page.lab : null;

  function tablesOf(b, C, i) {
    const ps = b.snap.filter((p) => p.role === 'prog'), fg = b.ks.tty ? b.ks.tty.fg : 0;
    return [{ title: 'Processes', cols: ['pid', 'program', 'ppid', 'group', 'state', 'reaped by'], hl: ps.findIndex((p) => b.main && p.pid === b.main.pid), rows: ps.map((p) => [String(p.pid), p.pid === 100 ? 'your shell' : (C.names[i] && C.names[i][p.pid]) || 'a copy of the shell', String(p.ppid), p.pgid + (p.pgid === fg ? ' (fg)' : ''), { text: p.state, cls: p.state === 'zombie' ? 'bad' : p.state === 'running' ? 'good' : '' }, p.reapedBy ? String(p.reapedBy) + (p.reapedBy === 1 ? ' (init)' : '') : '–']) }];
  }
  function metricsOf(run, i) {
    const b = run.beats[i], evs = run.sys.trace.slice(0, (run.beats[i + 1] ? run.beats[i + 1].at : run.sys.trace.length));
    const forks = evs.filter((e) => e.kind === 'fork').length, byShell = evs.filter((e) => e.kind === 'reap' && e.by === 100).length, byInit = evs.filter((e) => e.kind === 'reap' && e.by === 1 && e.pid !== 100).length;
    const zombies = b.snap.filter((p) => p.role === 'prog' && p.state === 'zombie').length;
    return [{ label: 'Lines typed', value: run.typed.slice(0, b.typed).filter((t) => !t.key && !t.eof).length }, { label: 'Processes forked', value: forks }, { label: 'Reaped by the shell', value: byShell, cls: byShell ? 'good' : '' }, { label: 'Left to init', value: byInit, cls: byInit ? 'bad' : '' }, { label: 'Zombies now', value: zombies, cls: zombies ? 'bad' : '' }, { label: 'Terminal’s group', value: b.ks.tty ? b.ks.tty.fg : '–' }, { label: 'Clock', value: b.clock, unit: 's' }];
  }

  /** set new values from a view, run, and show the last picture */
  async function apply(P, nv, opts) {
    P.values = nv; P.setup.set(nv); P.save();
    if (opts && opts.seed) { P.seed = opts.seed; if (P.seedIn) P.seedIn.value = String(opts.seed); }
    await P.runNow(false);
    const at = opts && opts.at !== undefined ? P.frames.findIndex((f) => f.at >= opts.at) : -1;
    P.go(at >= 0 ? at : P.frames.length - 1, true);
  }

  // ---- the terminal tab: type a line, press a key ------------------------------------------------------------------
  function renderTerm(host, ctx) {
    const { h } = S.UI, res = ctx.result || {}, run = res.shell, P = page();
    const box = h('div.sl-term', { id: 'slTerm' });
    const out = h('div.sl-term-out.mono', { id: 'slTermOut', role: 'log', 'aria-label': 'What the terminal shows' });
    if (run) {
      const b = run.beats[Math.min(ctx.i, run.beats.length - 1)];
      const rows = PL.termRows(run.sys, b.nterm, run.typed.slice(0, b.typed));
      if (!rows.length) out.appendChild(h('div.sl-row.muted', 'nothing on the terminal yet'));
      for (const r of rows) out.appendChild(h('div.sl-row' + (r.you ? '.you' : ''), r.you ? h('span.sl-prompt', '$') : h('span.sl-tags', ...r.tags.map((t) => h('span.sl-tag', String(t.pid)))), h('span.sl-text', r.text || ' ')));
    }
    const input = h('input.mono', { id: 'slType', type: 'text', placeholder: 'type a command, then Enter', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'A line to type into your shell', maxlength: '80' });
    const form = h('form.sl-form', h('span.sl-prompt', '$'), input, h('button.btn.small.primary', { type: 'submit' }, 'Enter'));
    const lines = () => (P ? linesOf(P.values).map((l) => Object.assign({}, l)) : []);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t || !P) return;
      await apply(P, Object.assign({}, P.values, { session: 'mine', lines: lines().concat([L(t)]).slice(-8) }));
      const again = document.getElementById('slType'); if (again) again.focus();
    });
    const key = (k) => async () => { if (!P) return; const ls = lines(); if (!ls.length) { S.UI.toast('Type a line first: the key is pressed while it runs.', 'warn'); return; } ls[ls.length - 1].key = ls[ls.length - 1].key === k ? '' : k; await apply(P, Object.assign({}, P.values, { session: 'mine', lines: ls })); };
    const kb = (k, label) => { const b = h('button.btn.small', { type: 'button', id: 'slKey' + k, title: label }, '^' + k); b.addEventListener('click', key(k)); return b; };
    const clear = h('button.btn.small', { type: 'button', id: 'slClear' }, 'Clear the lines');
    clear.addEventListener('click', async () => { if (P) await apply(P, Object.assign({}, P.values, { session: 'mine', lines: [] })); });
    const sess = h('div.sl-sessions', h('span.lab-note', 'Sample sessions: '), ...Object.entries(SESSIONS).map(([id, s]) => { const c = h('button.chip' + (P && P.values.session === id ? '.on' : ''), { type: 'button', dataset: { session: id } }, s.label); c.addEventListener('click', async () => { if (P) await apply(P, Object.assign({}, P.values, { session: id })); }); return c; }));
    box.append(out, form, h('div.sl-keys', kb('C', 'Press ^C while the last line runs: SIGINT to the foreground group'), kb('Z', 'Press ^Z while the last line runs: SIGTSTP to the foreground group'), clear), h('p.lab-note', 'Each line is typed when your shell reads the terminal; a key is pressed once that line’s job has settled (it waits, or reads). The whole session runs again from the start, so the same seed gives the same story.'), sess);
    host.appendChild(box);
    requestAnimationFrame(() => { out.scrollTop = out.scrollHeight; });
  }

  // ---- the tests tab ---------------------------------------------------------------------------------------------------
  let tests = { src: null, results: [], busy: false };
  function renderTests(host, ctx) {
    const { h } = S.UI, P = page(), src = ctx.values.src;
    const head = h('div.sl-tests-head');
    const btn = h('button.btn.primary', { type: 'button', id: 'slRunTests' }, tests.busy ? 'Running the tests…' : 'Run the job-control tests');
    btn.disabled = tests.busy;
    btn.addEventListener('click', () => {
      tests = { src, results: [], busy: true };
      if (P) P.showTab('tests', true);
      let k = 0;
      const next = () => {
        if (k >= SL.TESTS.length) { tests.busy = false; if (page()) page().showTab('tests', true); return; }
        const t = SL.TESTS[k++];
        let r;
        try { S.Kern.compile(src); r = SL.runTest(src, t); } catch (e) { r = { pass: false, why: 'your shell does not compile: ' + (e.msg || e.message) }; }
        tests.results.push(r);
        if (page()) page().showTab('tests', true);
        setTimeout(next, 20);
      };
      setTimeout(next, 30);
    });
    const done = tests.src === src ? tests.results : [];
    const pass = done.filter((r) => r.pass).length;
    head.append(btn, done.length ? h('div.pl-count', h('b.mono', { id: 'slPassed' }, pass + '/' + SL.TESTS.length), h('span', ' passed' + (tests.busy ? ' so far' : ''))) : h('p.lab-note', 'Ten tests type lines into your shell under three random schedules each, and check its output and its children: foreground lines waited for, pipes closed, background jobs reaped by SIGCHLD, ^C and ^Z reaching only the foreground job, no zombies left.'));
    if (tests.src && tests.src !== src && tests.results.length) head.appendChild(h('p.lab-note', 'The program has changed since the last run of the tests.'));
    host.appendChild(head);
    const ol = h('ol.sl-tests', { id: 'slTests' });
    SL.TESTS.forEach((t, k) => {
      const r = done[k];
      const li = h('li.sl-test' + (r ? (r.pass ? '.pass' : '.fail') : ''), h('div.sl-test-h', h('span.sl-badge', r ? (r.pass ? 'pass' : 'fail') : '·'), h('b', t.name)), h('div.lab-note', t.why), h('div.sl-lines.mono', t.lines.map((l) => '$ ' + l.type + (l.key ? '   ^' + l.key : '')).join('\n')));
      if (r && !r.pass) {
        li.appendChild(h('p.sl-why', S.UI.inline(r.why.replace(/^./, (c) => c.toUpperCase()) + (r.seed ? ' (schedule seed ' + r.seed + ')' : '') + '.')));
        if (r.run) {
          const show = h('button.btn.small', { type: 'button' }, 'Show it on the stage');
          show.addEventListener('click', async () => {
            if (!P) return;
            const files = Object.entries(t.files || {}).map(([name, text]) => ({ name, text: text.replace(/\n$/, '').replace(/\n/g, '\\n') }));
            await apply(P, Object.assign({}, P.values, { session: 'mine', lines: t.lines.map((l) => Object.assign({}, l)), files: files.length ? files : P.values.files, policy: 'random' }), { seed: r.seed, at: r.at });
          });
          const evs = r.run.sys.trace.slice(0, r.at === undefined ? r.run.sys.trace.length : r.at + 1).filter((e) => /^(typed|key|input|fork|exec|exit|signal|stop|cont|reap|wait|pgid|foreground|pipe|dup|close|handler|fail|done|limit)$/.test(e.kind)).slice(-30);
          const tr = h('ol.lab-trace.sl-trace', ...evs.map((e) => h('li', h('span.lt-k', e.kind), h('span.lt-s', ...S.UI.inline(String(e.say || ''))))));
          li.append(show, h('details.sl-details', h('summary', 'The failing run, up to where it went wrong'), tr));
        }
      }
      ol.appendChild(li);
    });
    host.appendChild(ol);
  }

  // ---- the reference tab ---------------------------------------------------------------------------------------------
  let revealed = false;
  function renderRef(host) {
    const { h } = S.UI, P = page();
    if (!revealed) {
      const b = h('button.btn', { type: 'button', id: 'slReveal' }, 'Reveal the reference shell');
      b.addEventListener('click', () => { revealed = true; if (P) P.showTab('ref', true); });
      host.append(h('p.lab-note', 'A complete shell that passes every test: pipelines, < and >, & jobs in their own process groups, the terminal given to the foreground job, a SIGCHLD handler that reaps, ^Z noticed with WUNTRACED, and fg. Try your own first: the Tests tab says what is missing.'), b);
      return;
    }
    const pre = h('div.sl-ref.mono', { id: 'slRef', html: S.LabEditor.highlight(SL.REFERENCE.replace(/\n$/, '')).map((l, i) => '<div class="sl-refl"><span class="sl-ln">' + (i + 1) + '</span><span class="sl-code">' + (l || ' ') + '</span></div>').join('') });
    const load = h('button.btn.small', { type: 'button', id: 'slLoadRef' }, 'Load it into the editor');
    load.addEventListener('click', async () => {
      if (!P) return;
      if (!(await S.UI.confirm('Replace your shell?', 'The editor gets the reference shell. Save yours by name first if you want to keep it.', 'Load the reference', 'Keep mine'))) return;
      P.setup.editor.set(SL.REFERENCE);
      await apply(P, Object.assign({}, P.values, { src: SL.REFERENCE }));
    });
    const hide = h('button.btn.small', { type: 'button' }, 'Hide it');
    hide.addEventListener('click', () => { revealed = false; if (P) P.showTab('ref', true); });
    host.append(h('div.sl-ref-bar', load, hide), pre);
  }

  S.Labs.add({
    id: 'shell', part: 'ipc', icon: 'gw', title: 'Shell lab', wide: true,
    blurb: 'Finish a small shell in C: fork, exec and wait, pipes, < and >, background jobs, process groups and SIGCHLD reaping. Type lines into it, press ^C and ^Z, watch every child, pipe and group, and run the job-control tests.',
    setup: {
      fields: [
        { id: 'src', label: 'Your shell', type: 'code', def: SL.SKELETON, examples: [{ name: 'shell-skeleton.c', src: SL.SKELETON }], files: 'shell', minLines: 16 },
        { id: 'session', label: 'At the terminal', type: 'select', group: 'At the terminal', options: Object.entries(SESSIONS).map(([value, s]) => ({ value, label: s.label })).concat([{ value: 'mine', label: 'My own lines (below)' }]), def: 'pipes', help: 'Or type lines in the **Terminal** tab.' },
        { id: 'lines', label: 'Lines to type', type: 'table', show: (v) => v.session === 'mine', def: [L('echo hello | wc'), L('sleep 2 &'), L('sleep 4', 'C'), L('echo done')], minRows: 0, maxRows: 8, columns: [{ id: 'type', label: 'You type', type: 'text', maxLen: 80 }, { id: 'key', label: 'Then press', type: 'select', options: [{ value: '', label: 'nothing' }, { value: 'C', label: '^C' }, { value: 'Z', label: '^Z' }], width: '96px' }], newRow: () => L('echo hi') },
        { id: 'show', label: 'Beside the terminal', type: 'select', group: 'View', options: [{ value: 'jobs', label: 'Jobs, groups and pipes' }, { value: 'fds', label: 'Descriptor tables' }, { value: 'signals', label: 'Signals' }], def: 'jobs' },
        { id: 'policy', label: 'Who runs next', type: 'select', group: 'Kernel', options: [{ value: 'fifo', label: 'FIFO: run until it blocks' }, { value: 'rr', label: 'Round robin' }, { value: 'random', label: 'Random, from the seed' }], def: 'random' },
        { id: 'q', label: 'Quantum', type: 'number', min: 1, max: 20, def: 2, unit: 'statements', show: (v) => v.policy === 'rr' },
        { id: 'cap', label: 'A pipe holds', type: 'select', options: [{ value: 16, label: '16 bytes' }, { value: 64, label: '64 bytes' }, { value: 4096, label: '4096 bytes' }], def: 64 },
        { id: 'files', label: 'Files on the disk', type: 'table', group: 'Disk', def: FILE_ROWS, minRows: 0, maxRows: 5, columns: [{ id: 'name', label: 'Name', type: 'text', pattern: '^[A-Za-z0-9_.-]{1,20}$', patternWhy: 'letters, digits, dot, dash or underscore', width: '110px' }, { id: 'text', label: 'Contents (\\n: new line)', type: 'text' }], newRow: (i) => ({ name: 'file' + (i + 1) + '.txt', text: 'one\\ntwo' }), check: (r, i, rows) => (rows.findIndex((x) => x.name === r.name) !== i ? { name: 'two files are called ' + r.name } : null) },
      ],
    },
    views: [{ id: 'tables', label: 'Tables', render: (host, ctx) => { S.LabViews.tables(host, ctx.frame.tables); S.LabViews.metrics(host, ctx.frame.counts); } }, { id: 'term', label: 'Terminal', render: renderTerm }, { id: 'tests', label: 'Tests', render: renderTests }, { id: 'ref', label: 'Answer', render: renderRef }],
    run(v, ctx) {
      const src = v.src;
      try { S.Kern.compile(src); } catch (e) { return { error: e, frames: [] }; }
      const run = SL.drive(src, linesOf(v), SL.optsOf(v, ctx.seed));
      const { frames, C } = SL.frames(run, v, ctx, src);
      const trace = run.sys.trace.filter((e) => e.kind !== 'step' && e.say).map((e) => ({ kind: e.kind, say: e.say, pid: e.pid }));
      // a frame's place in the trace: the sentences before its beat
      const idx = []; let k = 0;
      run.sys.trace.forEach((e, i) => { idx[i] = k; if (e.kind !== 'step' && e.say) k++; });
      frames.forEach((f, i) => { f.at = Math.min(trace.length, idx[run.beats[i].at] || 0); f.tables = tablesOf(run.beats[i], C, i); f.counts = metricsOf(run, i); });
      return { frames, trace, shell: run };
    },
  });

  if (S.Checks) {
    const clear = "try { localStorage.removeItem('proses.lab:shell'); } catch (e) {}";
    const sess = (id, extra) => "const P = Proses.app.page.lab; const v = Object.assign({}, P.values, { session: '" + id + "'" + (extra || '') + " }); P.values = v; P.setup.set(v); await P.runNow(false); P.go(Math.floor(P.frames.length * 0.7), true); P.stage.finish(); " + clear;
    S.Checks.push({ group: 'labs', name: 'shell lab', hash: 'labs/shell', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.showTab('term'); P.go(P.frames.length - 1, true); P.stage.finish();", sel: '#main' });
    for (const id of Object.keys(SESSIONS)) S.Checks.push({ group: 'labs', name: 'shell lab, reference: ' + SESSIONS[id].label, hash: 'labs/shell', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: sess(id, ', src: Proses.ShellLab.REFERENCE'), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'shell lab: descriptors', hash: 'labs/shell', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: sess('pipes', ", src: Proses.ShellLab.REFERENCE, show: 'fds'"), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'shell lab: tests', hash: 'labs/shell', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.showTab('tests'); document.getElementById('slRunTests').click(); for (let k = 0; k < 200 && !(document.getElementById('slPassed') && !document.querySelector('#slRunTests[disabled]')); k++) await new Promise((r) => setTimeout(r, 100)); const d = document.querySelector('.sl-details'); if (d) d.open = true;", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'shell lab: reference', hash: 'labs/shell', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.showTab('ref'); document.getElementById('slReveal').click();", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
