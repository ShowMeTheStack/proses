// Courses: ordered paths through the topics (and lessons and exercises), each step with a word on what
// to look for. #courses lists them with progress, #course=id shows one, and #course=id/k opens step k
// with a strip above it that tells where you are and leads on. Courses are registered with
// S.Content.course({id, title, blurb, steps}) by the content files.
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  const C = () => S.Content;

  const steps = (c) => c.steps.map((s) => C().stepOf(s)).filter((st) => C().stepExists(st));
  const titleOf = (st) => (st.type === 'topic' ? S.byId(st.id).title : st.type === 'lesson' ? C().lessons.get(st.id).title : C().exercises.get(st.id).title);
  const isDone = (app, st) => (st.type === 'topic' ? S.Learner.done.has(st.id) : S.Learn ? S.Learn.isDone(st.type, st.id) : false);
  const ICON = { topic: 'watch', lesson: 'book', exercise: 'edit' };
  const KIND = { topic: 'Topic', lesson: 'Lesson', exercise: 'Exercise' };

  S.Courses = {
    steps,
    open(app, main, arg) {
      app = S.Learner || app;
      if (!arg) return this.list(app, main);
      const [cid, ks] = arg.split('/');
      const c = C() && C().courses.get(cid);
      if (!c) { this.list(app, main, 'There is no course called "' + cid + '".'); return { dispose() {} }; }
      const st = steps(c);
      if (ks === undefined || !st.length) return this.overview(app, main, c, st);
      const k = Math.max(0, Math.min(st.length - 1, +ks || 0));
      return this.step(app, main, c, st, k);
    },
    list(app, main, notice) {
      document.title = 'Courses · Proses';
      const box = h('div.home', { id: 'coursesView' });
      if (notice) box.appendChild(h('div.notice', icon('info'), h('span', notice)));
      box.append(h('h1.page-title', 'Courses'), h('p.lead', 'Topics, lessons and exercises in an order that builds up, with a word on what to look for in each. Your progress is kept in this browser.'));
      const grid = h('div.fam-grid');
      for (const c of (C() ? [...C().courses.values()] : [])) {
        const st = steps(c);
        if (!st.length) continue;
        const done = st.filter((s) => isDone(app, s)).length;
        const card = h('button.fam-card.course-card', { type: 'button', dataset: { course: c.id } },
          h('div.fc-art.course-art', icon('route')),
          h('div.fc-body', h('h3', c.title), h('p', c.blurb || ''), h('span.n', done + ' of ' + st.length + ' steps done'), h('span.fc-bar', h('i', { style: { width: Math.round((100 * done) / st.length) + '%' } }))));
        card.addEventListener('click', () => { location.hash = 'course=' + c.id; });
        grid.appendChild(card);
      }
      if (grid.children.length) box.appendChild(grid);
      else box.appendChild(S.UI.empty('route', 'No courses yet', 'Courses are guided paths through the topics; they are being written. Meanwhile, every topic is in the catalogue.', [{ label: 'Browse the topics', icon: 'library', action: () => { location.hash = 'topics'; } }]));
      main.appendChild(box);
      return { dispose() {} };
    },
    overview(app, main, c, st) {
      document.title = c.title + ' · Courses · Proses';
      const box = h('div.home.course', { id: 'courseView' });
      const next = st.findIndex((s) => !isDone(app, s));
      const start = h('button.btn.primary', { type: 'button', id: 'courseStart', disabled: !st.length }, icon('run'), next === 0 ? 'Start' : next < 0 ? 'Start again' : 'Continue with step ' + (next + 1));
      start.addEventListener('click', () => { location.hash = 'course=' + c.id + '/' + Math.max(0, next); });
      box.append(h('div.crumbs', h('a', { href: '#courses' }, 'Courses')), h('h1.page-title', c.title), h('p.lead', c.blurb || ''), start);
      if (!st.length) box.appendChild(S.UI.empty('route', 'This course is empty', 'None of its steps is in this build yet.'));
      const ol = h('ol.course-steps');
      st.forEach((s, k) => {
        const d = isDone(app, s);
        ol.appendChild(h('li' + (d ? '.done' : ''), h('span.cs-kind', icon(ICON[s.type]), KIND[s.type]), h('div', h('a', { href: '#course=' + c.id + '/' + k }, titleOf(s)), d ? h('span.done', { title: 'Done' }, ' ✓') : null, s.note ? h('p', s.note) : null)));
      });
      box.appendChild(ol);
      main.appendChild(box);
      return { dispose() {} };
    },
    step(app, main, c, st, k) {
      const s = st[k];
      // the step itself, opened the usual way, with the strip put above it
      let page = null;
      if (s.type === 'topic') { const p = S.openTopic(main, S.byId(s.id)); page = { player: p, players: [p], dispose() { p.dispose(); } }; }
      else page = S.Learn.open(app, main, (s.type === 'lesson' ? 'lesson=' : 'exercise=') + s.id, { inCourse: true });
      const prev = h('button.btn', { type: 'button', id: 'coursePrev', disabled: k === 0 }, icon('stepBack'), 'Back');
      prev.addEventListener('click', () => { location.hash = 'course=' + c.id + '/' + (k - 1); });
      const last = k === st.length - 1;
      const next = h('button.btn.primary', { type: 'button', id: 'courseNext' }, last ? 'Finish' : 'Next', icon(last ? 'check' : 'stepOver'));
      next.addEventListener('click', () => { location.hash = last ? 'course=' + c.id : 'course=' + c.id + '/' + (k + 1); });
      const dots = h('div.cs-dots', { 'aria-label': 'Steps of the course' }, ...st.map((x, i) => h('a.cs-dot' + (i === k ? '.on' : '') + (isDone(app, x) ? '.done' : ''), { href: '#course=' + c.id + '/' + i, title: (i + 1) + '. ' + titleOf(x), 'aria-label': 'Step ' + (i + 1) + ': ' + titleOf(x), 'aria-current': i === k ? 'step' : null })));
      const bar = h('div.course-strip', { id: 'courseStrip' },
        h('div.cs-where', h('div.cs-top', h('a', { href: '#course=' + c.id }, c.title), h('span.muted', ' · step ' + (k + 1) + ' of ' + st.length + ' · ' + KIND[s.type].toLowerCase())), s.note ? h('p', s.note) : null, dots),
        h('div.course-nav', prev, next));
      main.insertBefore(bar, main.firstChild);
      document.title = titleOf(s) + ' · ' + c.title + ' · Proses';
      return page || { player: null, dispose() {} };
    },
  };
  S.Pages.register('courses', {
    nav: 'courses',
    open(app, main, rest) {
      const arg = rest && rest !== 'courses' ? rest.replace(/^course[=/]/, '') : '';
      const page = S.Courses.open(app, main, arg) || {};
      return S.Learn ? S.Learn.page(page) : page;
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
