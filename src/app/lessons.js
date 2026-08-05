// Lessons, exercises and tours. #learn lists the chapters of every part with their lessons and exercises (and
// progress); #lesson=id reads a lesson, whose blocks may hold a live topic player or a scene of the demo page;
// #exercise=id sets an exercise with the answer area its kind needs, checks the answer with S.Check (a kind may
// check asynchronously, in a worker), and gives hints one at a time; #tour=id starts a
// guided tour.
//
// Lesson blocks (a lesson's blocks: [...]):
//   'text' or {p}            a paragraph, with `code`, **bold**, *italic* and [links](#topic=aes-round)
//   {h}                      a heading                {list: [..]}, {steps: [..]}   bullets, numbered steps
//   {tip}, {warn}            a note, a warning        {def: 'term', text}          a definition
//   {math: 'lines'}          formal text, monospaced  {code, lang}                 code (a C program, a shell session)
//   {table: [[head..], [row..]], caption}            {svg: '<svg..>', caption}     a figure
//   {predict: {q, options, answer, explain}}         a question to answer before reading on
//   {topic: id, input: {..}, frame: n, inputs: true, caption}  a live player of a topic (no side panel;
//                                                    inputs: true shows its inputs and examples too)
//   {exercise: id}, {lesson: id}, {challenge: id}    a card leading to it
// More blocks (src/app/exercises-blocks.js; any block kind registered in S.LessonBlocks):
//   {scene: 'demo scene id', caption}                a scene of the demo page, with its own controls
//   {lab: 'lab id', setup: {..}, title, text}         a card that opens a lab (S.Labs) set up like this
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  const store = S.UI.storage;
  const C = () => S.Content;
  const inline = (t) => S.UI.inline(t);
  const LEVEL = ['', 'easy', 'medium', 'hard'];

  // ---- progress, kept in this browser --------------------------------------------------------------------
  const prog = () => Object.assign({ read: {}, solved: {}, hints: {}, drafts: {}, tours: {} }, store.get('learn', {}));
  const saveProg = (p) => store.set('learn', p);
  const mark = (kind, id) => { const p = prog(); p[kind][id] = Date.now(); saveProg(p); };

  const L = (S.Learn = {
    answerKinds: {},
    isDone(type, id) { const p = prog(); return type === 'lesson' ? !!p.read[id] : type === 'exercise' ? !!p.solved[id] : false; },
    progress: prog,
    open(app, main, hash, opts) {
      app = S.Learner || app;
      if (hash.startsWith('lesson=')) return lessonPage(app, main, hash.slice(7), opts || {});
      if (hash.startsWith('exercise=')) return exercisePage(app, main, hash.slice(9), opts || {});
      if (hash.startsWith('tour=')) { const id = hash.slice(5); setTimeout(() => S.Tour.start(id), 0); return listPage(app, main); }
      return listPage(app, main);
    },
  });

  // ---- the list --------------------------------------------------------------------------------------------
  function listPage(app, main) {
    document.title = 'Learn · Proses';
    const p = prog();
    const box = h('div.home.learn', { id: 'learnView' });
    box.append(h('h1.page-title', 'Learn'));
    const chs = C() ? C().chapters.filter((c) => c.lessons.length || c.exercises.length) : [];
    const total = (k) => chs.reduce((n, c) => n + c[k].length, 0);
    const nl = total('lessons'), nx = total('exercises');
    const rd = chs.reduce((n, c) => n + c.lessons.filter((id) => p.read[id]).length, 0), sv = chs.reduce((n, c) => n + c.exercises.filter((id) => p.solved[id]).length, 0);
    if (!chs.length) {
      box.appendChild(h('p.lead', 'Lessons explain each idea with figures that run, and exercises are checked the moment you answer.'));
      box.appendChild(S.UI.empty('learn', 'Lessons and exercises are on their way', 'They are being written. Meanwhile the topics and the sample scenes show each mechanism running, step by step.', [{ label: 'Browse the topics', icon: 'library', primary: true, action: () => { location.hash = 'topics'; } }, { label: 'The sample scenes', icon: 'layers', action: () => { location.hash = 'demo'; } }]));
      main.appendChild(box);
      return { dispose() {} };
    }
    box.appendChild(h('p.lead', 'Lessons explain each idea with pictures that run on real values; exercises are checked the moment you answer, from a schedule worked out by hand to a page walk or a program\'s possible outputs, with hints when you are stuck. Your progress stays in this browser.'));
    box.appendChild(h('div.learn-sum', h('div', h('b', rd + ' of ' + nl), ' lessons read'), h('div.fc-bar', h('i', { style: { width: (nl ? Math.round((100 * rd) / nl) : 0) + '%' } })), h('div', h('b', sv + ' of ' + nx), ' exercises solved'), h('div.fc-bar', h('i', { style: { width: (nx ? Math.round((100 * sv) / nx) : 0) + '%' } }))));
    if (C().tours.size) {
      const tours = h('div.tour-list');
      for (const t of C().tours.values()) { const b = h('button.chip', { type: 'button', dataset: { tour: t.id } }, icon('flag'), t.title, p.tours[t.id] ? ' ✓' : ''); b.addEventListener('click', () => S.Tour.start(t.id)); tours.appendChild(b); }
      box.append(h('h2.sub-title', 'Guided tours'), tours);
    }
    for (const part of S.parts) {
      const mine = chs.filter((c) => c.part === part.id);
      if (!mine.length) continue;
      const sec = h('section.part', h('div.part-head', h('span.num', String(part.n)), h('h2', part.title)));
      const grid = h('div.chap-grid');
      for (const ch of mine) {
        const card = h('div.card.chap-card', { dataset: { chapter: ch.id } }, h('h3', ch.title), ch.blurb ? h('p.muted', ch.blurb) : null);
        const list = h('ul.chap-items');
        for (const id of ch.lessons) { const l = C().lessons.get(id); list.appendChild(h('li' + (p.read[id] ? '.done' : ''), h('a', { href: '#lesson=' + id }, icon('book'), h('span', l.title)), l.minutes ? h('span.meta', l.minutes + ' min') : null, p.read[id] ? h('span.ok', { title: 'Read' }, '✓') : null)); }
        for (const id of ch.exercises) { const x = C().exercises.get(id); list.appendChild(h('li' + (p.solved[id] ? '.done' : ''), h('a', { href: '#exercise=' + id }, icon('edit'), h('span', x.title)), h('span.meta', { title: LEVEL[x.level || 1] }, '●'.repeat(x.level || 1)), p.solved[id] ? h('span.ok', { title: 'Solved' }, '✓') : null)); }
        card.appendChild(list);
        grid.appendChild(card);
      }
      sec.appendChild(grid);
      box.appendChild(sec);
    }
    main.appendChild(box);
    return { dispose() {} };
  }

  const crumbs = (x) => { const ch = C().chapterOf(x); const part = ch && S.partOf(ch.part); return h('div.crumbs', h('a', { href: '#learn' }, 'Learn'), part ? ' › Part ' + part.n + ': ' + part.title : '', ch ? ' › ' + ch.title : ''); };
  const missing = (what, id) => (main) => { main.appendChild(h('div.home', S.UI.empty('book', 'There is no ' + what + ' called "' + id + '"', 'It may have been renamed or removed.', [{ label: 'All lessons and exercises', icon: 'learn', primary: true, action: () => { location.hash = 'learn'; } }]))); return { dispose() {} }; };

  // ---- a lesson -------------------------------------------------------------------------------------------
  function lessonPage(app, main, id, opts) {
    const l = C() && C().lessons.get(id);
    if (!l) return missing('lesson', id)(main);
    document.title = l.title + ' · Learn · Proses';
    const page = { players: [], editors: [], player: null, dispose() { if (S.Remote && S.Remote.busy()) S.Remote.cancel(); for (const p of page.players) p.dispose(); for (const e of page.editors) if (e.dispose) e.dispose(); } };
    const box = h('article.lesson', { id: 'lessonView', dataset: { lesson: id } });
    box.append(crumbs(l), h('h1.page-title', l.title), h('div.ls-meta', l.minutes ? h('span', icon('history'), l.minutes + ' minutes') : null));
    if (l.summary) box.appendChild(h('p.lead', inline(l.summary)));
    (l.blocks || []).forEach((b, i) => { const el = block(app, b, page, 'b' + i + '-'); if (el) box.appendChild(el); });
    // previous / done
    const ch = C().chapterOf(l), ids = ch ? ch.lessons : [], k = ids.indexOf(id);
    const nav = h('div.ls-nav');
    if (!opts.inCourse) {
      nav.appendChild(k > 0 ? h('a.btn', { href: '#lesson=' + ids[k - 1] }, icon('stepBack'), 'Previous lesson') : h('span'));
      const done = h('button.btn.primary', { type: 'button', id: 'lessonDone' }, icon('check'), k + 1 < ids.length ? 'Done, next lesson' : 'Done');
      done.addEventListener('click', () => { mark('read', id); location.hash = k + 1 < ids.length ? 'lesson=' + ids[k + 1] : ch && ch.exercises.length ? 'exercise=' + ch.exercises[0] : 'learn'; });
      nav.appendChild(done);
    } else {
      const done = h('button.btn', { type: 'button', id: 'lessonDone' }, icon('check'), prog().read[id] ? 'Read ✓' : 'Mark as read');
      done.addEventListener('click', () => { mark('read', id); done.textContent = 'Read ✓'; });
      nav.appendChild(done);
    }
    box.appendChild(nav);
    main.appendChild(box);
    for (const p of page.players) p.redraw();
    page.player = page.players[0] || null;
    // the keyboard drives the player last pointed at or focused
    box.addEventListener('pointerover', (e) => { const p = page.players.find((x) => x.root.contains(e.target)); if (p) page.player = p; });
    box.addEventListener('focusin', (e) => { const p = page.players.find((x) => x.root.contains(e.target)); if (p) page.player = p; });
    S.UI.fitTables(box);
    return page;
  }

  /** One block of a lesson as an element */
  function block(app, b, page, idp) {
    if (typeof b === 'string') return paras(b);
    if (b.p) return paras(b.p);
    if (b.h) return h('h2.ls-h', b.h);
    if (b.list) return h('ul.ls-list', b.list.map((x) => h('li', inline(x))));
    if (b.steps) return h('ol.ls-steps', b.steps.map((x) => h('li', inline(x))));
    if (b.tip) return h('div.ls-note.tip', icon('hint'), h('div', inline(b.tip)));
    if (b.warn) return h('div.ls-note.warn', icon('warn'), h('div', inline(b.warn)));
    if (b.def) return h('div.ls-def', h('b', b.def), ' ', h('span', inline(b.text || '')));
    if (b.math !== undefined) return h('div.ls-math', ...String(b.math).split('\n').map((x) => h('div', x)));
    if (b.code !== undefined) return h('pre.ls-code', String(b.code));
    if (b.table) {
      const head = h('thead', h('tr', b.table[0].map((x) => h('th', inline(String(x))))));
      const body = h('tbody', b.table.slice(1).map((r) => h('tr', r.map((x) => h('td', inline(String(x)))))));
      return figure(h('div.fit-table', h('table.ls-table', head, body)), b.caption);
    }
    if (b.svg) { const d = h('div.ls-svg'); d.innerHTML = b.svg; return figure(d, b.caption); }
    if (b.predict) return predictBlock(b.predict);
    if (b.topic) return topicBlock(app, b, page, idp);
    if (b.exercise) { const x = C().exercises.get(b.exercise); return x ? linkCard('#exercise=' + x.id, 'edit', 'Exercise', x.title, (x.level ? LEVEL[x.level] : '') + (prog().solved[x.id] ? ' · solved ✓' : '')) : null; }
    if (b.lesson) { const x = C().lessons.get(b.lesson); return x ? linkCard('#lesson=' + x.id, 'book', 'Lesson', x.title, x.minutes ? x.minutes + ' min' : '') : null; }
    if (b.challenge) { const x = C().challenges.get(b.challenge); return x ? linkCard('#challenge/' + x.id, 'trophy', 'Challenge', x.title, (S.Challenges ? S.Challenges.goal(x) : (x.metricName || x.metric || '') + ' ≥ ' + x.target) + (S.Challenges && S.Challenges.solved(x.id) ? ' · reached ✓' : '')) : null; }
    const ext = S.LessonBlocks && Object.keys(S.LessonBlocks).find((k) => b[k] !== undefined);
    if (ext) return S.LessonBlocks[ext](b, page, app, idp);
    return null;
  }
  /** Text with blank lines between paragraphs and single line breaks kept */
  function paras(text) {
    const ps = String(text).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => h('p', ...t.split('\n').map((line, i) => [i ? h('br') : null, inline(line)])));
    return ps.length === 1 ? ps[0] : h('div.ls-paras', ...ps);
  }
  const figure = (el, caption, cls) => h('figure.ls-fig' + (cls ? '.' + cls : ''), el, caption ? h('figcaption', inline(caption)) : null);
  const linkCard = (href, ic, kind, title, meta) => h('a.ls-link', { href }, h('span.tc-icon', icon(ic)), h('span', h('span.kind', kind), h('b', title), meta ? h('span.meta', meta) : null), h('span.go', '→'));
  function predictBlock(q) {
    const box = h('div.ls-predict', h('div.lp-q', icon('help'), h('div', h('b', 'Before reading on: '), inline(q.q))));
    const opts = h('div.lp-opts'), res = h('div.lp-res', { 'aria-live': 'polite' });
    q.options.forEach((o, i) => {
      const b = h('button.quiz-opt', { type: 'button' }, inline(o));
      b.addEventListener('click', () => {
        [...opts.children].forEach((c, k) => { c.disabled = true; c.classList.toggle('right', k === q.answer); c.classList.toggle('wrong', k === i && i !== q.answer); });
        res.innerHTML = '';
        res.appendChild(h('div.' + (i === q.answer ? 'lp-ok' : 'lp-no'), h('b', i === q.answer ? 'Right. ' : 'Not quite. '), inline(q.explain || '')));
      });
      opts.appendChild(b);
    });
    box.append(opts, res);
    return box;
  }
  function topicBlock(app, b, page, idp) {
    const t = S.byId(b.topic);
    if (!t) return figure(S.UI.empty('watch', 'A figure is missing here', 'It shows the topic "' + b.topic + '", which is not in this build.'), b.caption);
    const host = h('div.ls-player');
    let input = S.inputOf(t, Object.assign(S.inputOf(t), b.input || {}));
    if (S.checkInput(t, input)) input = S.inputOf(t);
    const p = new S.TopicPlayer(app, host, { topic: t, input, embed: true, side: false, counters: true, inputs: !!b.inputs, idp: 'ls' + idp });
    if (b.frame) p.go(b.frame, true);
    page.players.push(p);
    const open = h('a.btn.small', { href: '#topic=' + t.id, title: 'Open this topic on its own page, with its definition and inputs' }, 'Open the topic');
    return figure(h('div', host, h('div.ls-fig-tools', h('span.muted', t.title), open)), b.caption, 'topic');
  }

  // ---- an exercise -------------------------------------------------------------------------------------------
  function exercisePage(app, main, id, opts) {
    const x = C() && C().exercises.get(id);
    if (!x) return missing('exercise', id)(main);
    document.title = x.title + ' · Exercise · Proses';
    const page = { players: [], editors: [], player: null, dispose() { if (S.Remote && S.Remote.busy()) S.Remote.cancel(); for (const p of page.players) p.dispose(); for (const e of page.editors) if (e.dispose) e.dispose(); } };
    const p0 = prog();
    const box = h('article.lesson.exercise', { id: 'exerciseView', dataset: { exercise: id, kind: x.kind } });
    box.append(crumbs(x), h('h1.page-title', x.title), h('div.ls-meta', h('span.level', { title: 'Level' }, '●'.repeat(x.level || 1) + ' ' + LEVEL[x.level || 1]), p0.solved[id] ? h('span.solved', icon('check'), 'Solved') : null));
    for (const b of [].concat(x.text || [])) { const el = block(app, b, page, 'x-'); if (el) box.appendChild(el); }
    const answerHost = h('div.answer', { id: 'answer' });
    box.appendChild(answerHost);
    const A = answerUI(app, page, x, answerHost, p0.drafts[id]);
    const saveDraft = S.UI.debounce(() => { const p = prog(); try { p.drafts[id] = A.get(); saveProg(p); } catch (e) { /* not ready */ } }, 400);
    answerHost.addEventListener('input', saveDraft);
    answerHost.addEventListener('click', saveDraft);
    // check, hints, result
    const result = h('div.ex-result', { id: 'exResult', 'aria-live': 'polite' });
    const hintBox = h('div.hints', { id: 'hints' });
    const check = h('button.btn.primary', { type: 'button', id: 'btnCheck' }, icon('check'), 'Check my answer');
    const hintBtn = h('button.btn', { type: 'button', id: 'btnHint' }, icon('hint'), 'A hint');
    const hints = x.hints || [];
    const showHints = () => {
      const n = prog().hints[id] || 0;
      hintBox.innerHTML = '';
      for (let i = 0; i < Math.min(n, hints.length); i++) hintBox.appendChild(h('div.ls-note.tip.hint' + (i === hints.length - 1 ? '.worked' : ''), icon(i === hints.length - 1 ? 'book' : 'hint'), h('div', h('b', i === hints.length - 1 ? 'Worked answer. ' : 'Hint ' + (i + 1) + '. '), inline(hints[i]))));
      hintBtn.disabled = n >= hints.length;
      hintBtn.lastChild.textContent = n >= hints.length ? 'No more hints' : n === hints.length - 1 ? 'Show the worked answer' : n ? 'Another hint' : 'A hint';
      hintBtn.style.display = hints.length ? '' : 'none';
    };
    hintBtn.addEventListener('click', async () => {
      const p = prog(), n = p.hints[id] || 0;
      if (n === hints.length - 1 && !(await S.UI.confirm('Show the worked answer?', 'You learn more by trying first. Show it anyway?', 'Show it', 'Keep trying'))) return;
      p.hints[id] = n + 1; saveProg(p); showHints();
    });
    let checking = false;
    check.addEventListener('click', async () => {
      if (checking) return;
      let a;
      try { a = A.get(); } catch (e) { a = undefined; }
      checking = true; check.disabled = true;
      let r;
      // a long check (in a worker) shows how long it has run, with Cancel
      const slow = S.Check.kinds[x.kind] && S.Check.kinds[x.kind].remote && S.Remote;
      let stop = null;
      if (slow) { result.className = 'ex-result busy'; result.innerHTML = ''; stop = S.Remote.progress(result); }
      try { r = await S.Check.answerAsync(x, a); }
      catch (e) { r = e && e.cancelled ? { ok: false, cancelled: true, message: 'Cancelled: check again when you are ready.' } : { ok: false, message: 'Your answer could not be checked: ' + ((e && e.message) || e) + '.' }; }
      finally { checking = false; check.disabled = false; if (stop) stop(); }
      if (r.cancelled) { result.className = 'ex-result'; result.innerHTML = ''; result.appendChild(h('div.ex-v', icon('x'), h('b', 'Not checked. '), h('span', 'The check was cancelled; check again when you are ready.'))); return; }
      if (A.mark) A.mark(r);
      result.innerHTML = '';
      result.className = 'ex-result ' + (r.ok ? 'ok' : 'bad');
      // the heading already says Correct or Not yet: drop a checker's own "Right." or "Not quite."
      const msg = String(r.message || '').replace(r.ok ? /^Right\.\s*/ : /^Not quite(?:\.|:)?\s*/, '').replace(/^./, (c) => c.toUpperCase());
      result.appendChild(h('div.ex-v', icon(r.ok ? 'check' : 'x'), h('b', r.ok ? 'Correct.' : 'Not yet.'), ' ', h('span', msg)));
      for (const d of r.details || []) result.appendChild(h('div.ex-d', inline(d)));
      if (A.after) A.after(r, result);
      if (r.ok) {
        mark('solved', id);
        const ch = C().chapterOf(x), ids = ch ? ch.exercises : [], k = ids.indexOf(id);
        if (!opts.inCourse && k + 1 < ids.length) result.appendChild(h('a.btn.small.primary', { href: '#exercise=' + ids[k + 1], id: 'btnNextEx' }, 'Next exercise', icon('stepOver')));
      }
    });
    box.appendChild(h('div.ex-tools', check, hintBtn, h('a.btn.ghost', { href: '#learn' }, 'All exercises')));
    box.append(result, hintBox);
    showHints();
    main.appendChild(box);
    for (const p of page.players) p.redraw();
    page.player = page.players[0] || null;
    S.UI.fitTables(box);
    page.check = () => check.click();
    page.answer = A;
    return page;
  }

  /**
   * The answer area for an exercise's kind: {get() -> answer, mark(result)}. Kinds a later file adds can bring
   * their own: S.Learn.answerKinds.kind = (x, host, draft, page) -> {get, mark}.
   */
  function answerUI(app, page, x, host, draft) {
    const K = S.Check;
    const own = L.answerKinds[x.kind] || (S.ExerciseViews || {})[x.kind];
    if (own) return own(x, host, draft, page);
    if (x.kind === 'table') {
      const SP = K.tableSpec(x);
      const inputs = {};
      const tbl = h('table.fill-table', h('thead', h('tr', h('th', SP.corner || ''), ...SP.cols.map((c) => h('th', c)))));
      const body = h('tbody');
      SP.rows.forEach((r, ri) => {
        const tr = h('tr', h('th.mono', r));
        SP.cols.forEach((c, ci) => {
          const key = SP.cell(ri, ci);
          if (key === null) { tr.appendChild(h('td.none')); return; }
          const i = h('input.mono', { type: 'text', 'aria-label': r + (SP.cols.length > 1 ? ', ' + c : ''), spellcheck: 'false', autocomplete: 'off', placeholder: SP.kind === 'bit' ? '0/1' : SP.kind === 'number' ? '0' : '–', maxlength: SP.kind === 'bit' ? '1' : null, dataset: { key } });
          if (draft && draft[key] !== undefined) i.value = draft[key];
          inputs[key] = i;
          tr.appendChild(h('td', i));
        });
        body.appendChild(tr);
      });
      tbl.appendChild(body);
      host.appendChild(h('div.fit-table.ans-table', tbl));
      if (SP.kind === 'bit') host.appendChild(h('p.muted.ans-note', 'Write 0 or 1 in each cell.'));
      if (SP.kind === 'number') host.appendChild(h('p.muted.ans-note', 'Write a number in each cell' + (SP.tolerance ? ', to within ' + SP.tolerance : '') + '.'));
      return { get: () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])), mark(r) { for (const [k, i] of Object.entries(inputs)) { i.classList.toggle('right', !!(r.cells && r.cells[k])); i.classList.toggle('wrong', !!(r.cells && !r.cells[k])); } } };
    }
    if (x.kind === 'choice') {
      const many = Array.isArray(x.answer);
      const chosen = new Set([].concat(draft === undefined || draft === null ? [] : draft));
      const opts = h('div.choices', { role: many ? 'group' : 'radiogroup' });
      x.options.forEach((o, i) => {
        const b = h('button.quiz-opt.choice', { type: 'button', role: many ? 'checkbox' : 'radio', 'aria-checked': String(chosen.has(i)), dataset: { i: String(i) } }, h('span.box'), h('span', inline(o)));
        b.addEventListener('click', () => {
          if (!many) chosen.clear();
          if (chosen.has(i) && many) chosen.delete(i); else chosen.add(i);
          for (const c of opts.children) { const on = chosen.has(+c.dataset.i); c.setAttribute('aria-checked', String(on)); c.classList.toggle('on', on); c.classList.remove('right', 'wrong'); }
        });
        b.classList.toggle('on', chosen.has(i));
        opts.appendChild(b);
      });
      if (many) host.appendChild(h('p.muted.ans-note', 'Choose all that apply.'));
      host.appendChild(opts);
      return { get: () => (many ? [...chosen].sort() : chosen.size ? [...chosen][0] : null), mark(r) { for (const c of opts.children) { const i = +c.dataset.i; c.classList.toggle('right', r.ok && chosen.has(i)); c.classList.toggle('wrong', !r.ok && chosen.has(i) && !many); } } };
    }
    if (x.kind === 'string' || x.kind === 'number' || x.kind === 'set') {
      const i = h('input' + (x.kind !== 'number' ? '.mono' : ''), { type: 'text', id: 'ansText', 'aria-label': 'Your answer', placeholder: x.placeholder || (x.kind === 'number' ? 'a number' : x.kind === 'set' ? 'like {2, 3, 5} or (1, 2)' : ''), spellcheck: 'false', autocomplete: 'off', inputmode: x.kind === 'number' ? 'decimal' : null });
      if (draft !== undefined && draft !== null) i.value = draft;
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnCheck').click(); } });
      host.appendChild(h('label.ans-line', h('span', 'Your answer'), i));
      return { get: () => i.value };
    }
    host.appendChild(h('p.muted', 'This kind of exercise (' + x.kind + ') has no answer area yet.'));
    return { get: () => null };
  }

  // ---- guided tours -------------------------------------------------------------------------------------------
  S.Tour = {
    active: null,
    start(id) {
      const t = C() && C().tours.get(id);
      if (!t) { S.UI.toast('There is no tour called ' + id + '.', 'err'); return; }
      this.close();
      this.active = { t, i: 0 };
      this.show();
    },
    close() {
      if (this.box) this.box.remove();
      this.box = null;
      document.querySelectorAll('.tour-hi').forEach((e) => e.classList.remove('tour-hi'));
      document.removeEventListener('keydown', this.onKey, true);
      this.active = null;
    },
    onRoute() { /* a tour that changes the route waits for the page in show() */ },
    async show() {
      const a = this.active;
      if (!a) return;
      const st = a.t.steps[a.i];
      // a step {lab: id, setup: values} opens that lab set up so (route defaults to the lab's page); the preset is
      // taken when the lab opens, so the page opens again even when the tour is already on it
      if (st.lab !== undefined && S.Labs && S.Labs.get(st.lab)) {
        if (st.setup) S.Labs.preset(st.lab, st.setup);
        const to = st.route !== undefined ? st.route : 'labs/' + st.lab;
        window.__prosesReady = false;
        if (location.hash.replace(/^#/, '') === to) S.app.route(); else location.hash = to;
        for (let k = 0; k < 80 && !window.__prosesReady; k++) await new Promise((r) => setTimeout(r, 50));
        await new Promise((r) => setTimeout(r, 120));
      } else if (st.route !== undefined && location.hash.replace(/^#/, '') !== st.route) { location.hash = st.route; await new Promise((r) => setTimeout(r, 120)); }
      if (st.before) { try { st.before(S.app); } catch (e) { /* the step still shows */ } }
      let target = null;
      for (let k = 0; k < 30 && st.target && !(target = document.querySelector(st.target)); k++) await new Promise((r) => setTimeout(r, 60));
      if (this.active !== a) return;
      if (this.box) this.box.remove();
      document.querySelectorAll('.tour-hi').forEach((e) => e.classList.remove('tour-hi'));
      if (target) { target.classList.add('tour-hi'); target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      const last = a.i === a.t.steps.length - 1;
      const back = h('button.btn.small', { type: 'button', id: 'tourBack', disabled: a.i === 0 }, 'Back');
      const next = h('button.btn.small.primary', { type: 'button', id: 'tourNext' }, last ? 'Finish' : 'Next');
      const close = h('button.icon-btn.tour-x', { type: 'button', id: 'tourClose', 'aria-label': 'Close the tour' }, icon('x'));
      back.addEventListener('click', () => { a.i--; this.show(); });
      next.addEventListener('click', () => { if (last) { const p = prog(); p.tours[a.t.id] = Date.now(); saveProg(p); this.close(); S.UI.toast('Tour finished.', 'ok', 2000); } else { a.i++; this.show(); } });
      close.addEventListener('click', () => this.close());
      this.box = h('div.tour', { role: 'dialog', 'aria-label': a.t.title, id: 'tourBox' },
        h('div.tour-k', a.t.title + ' · ' + (a.i + 1) + ' of ' + a.t.steps.length), close,
        h('div.tour-t', inline(st.text)), h('div.tour-b', back, next));
      document.body.appendChild(this.box);
      this.place(target);
      this.onKey = this.onKey || ((e) => { if (!this.active || S.UI.anyModalOpen()) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
      document.addEventListener('keydown', this.onKey, true);
      setTimeout(() => next.focus(), 30);
    },
    place(target) {
      const b = this.box, bw = b.offsetWidth, bh = b.offsetHeight, W = innerWidth, H = innerHeight;
      let x, y;
      if (target) {
        const r = target.getBoundingClientRect();
        x = Math.min(W - bw - 12, Math.max(12, r.left));
        y = r.bottom + 12;
        if (y + bh > H - 12) y = r.top - bh - 12;
        if (y < 12) y = Math.max(12, Math.min(H - bh - 12, r.top + 12));
      } else { x = (W - bw) / 2; y = (H - bh) / 2; }
      b.style.left = Math.round(x) + 'px'; b.style.top = Math.round(y) + 'px';
    },
  };

  // ---- the Learn page ---------------------------------------------------------------------------------------
  /** the page object the app keeps: the keys go to the player last pointed at, a redraw redraws every figure */
  L.page = function (page) {
    page = page || {};
    return Object.assign(page, {
      keys: page.players && page.players.length ? S.PLAYER_KEYS : null,
      onKey: (e, typing) => S.playerKey(page.player, e, typing),
      redraw() {
        for (const p of page.players || []) p.redraw();
        for (const b of document.querySelectorAll('#main .ls-scene')) if (b._redraw) b._redraw();
        for (const e of page.editors || []) if (e.redraw) e.redraw();
        S.UI.fitTables(document.getElementById('main'));
      },
      dispose: page.dispose || (() => {}),
    });
  };
  S.Pages.register('learn', {
    nav: 'learn',
    open(app, main, rest) {
      const hash = !rest || rest === 'learn' ? '' : rest.replace(/^(lesson|exercise|tour)\//, '$1=');
      return L.page(L.open(app, main, hash));
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
