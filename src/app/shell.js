// The frame around Proses's pages, as in the sister tools: the sections of the top bar (Topics, Learn, Courses, Labs,
// Challenges), the home page, the settings dialog, About, share links (#share=code opens a shared lab setup or a
// topic's input) and autosave. S.Shell holds it all; the app (app.js) calls it.
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  const NAV = [['topics', 'Topics', 'library'], ['learn', 'Learn', 'learn'], ['courses', 'Courses', 'route'], ['labs', 'Labs', 'chip'], ['challenges', 'Challenges', 'trophy']];
  // other names a link may use for a page
  const ALIAS = { topic: 'topics', part: 'topics', lesson: 'learn', exercise: 'learn', tour: 'learn', course: 'courses', challenge: 'challenges', scenes: 'demo', lab: 'labs' };
  const frame = () => document.getElementById('app') || document.body;
  const SIBLINGS = [['See', 'https://see.jyotiprakash.org'], ['Strux', 'https://strux.jyotiprakash.org'], ['Baysik', 'https://baysik.jyotiprakash.org'], ['Lohgo', 'https://lohgo.jyotiprakash.org'], ['Kwery', 'https://kwery.jyotiprakash.org'], ['Tooring', 'https://tooring.jyotiprakash.org'], ['Sirkit', 'https://sirkit.jyotiprakash.org'], ['Sifer', 'https://sifer.jyotiprakash.org'], ['Nooral', 'https://nooral.jyotiprakash.org']];

  const Shell = (S.Shell = {
    NAV, ALIAS,
    /** is autosave on? (it is unless the reader turned it off) */
    autosave: () => !S.app || S.app.settings.autosave !== false,

    buildTop(app) {
      const top = document.getElementById('top');
      let menu = document.getElementById('btnMenu');
      if (!menu) { menu = h('button.icon-btn', { id: 'btnMenu', type: 'button', 'aria-label': 'Sections', title: 'Sections' }); top.insertBefore(menu, top.firstChild); }
      let nav = document.getElementById('topNav');
      if (!nav) { nav = h('nav.top-nav', { id: 'topNav', 'aria-label': 'Sections' }); document.getElementById('brand').after(nav); }
      menu.innerHTML = '';
      menu.appendChild(icon('menu'));
      menu.setAttribute('aria-expanded', 'false');
      menu.addEventListener('click', () => { const on = frame().classList.toggle('menu-open'); menu.setAttribute('aria-expanded', String(on)); });
      document.getElementById('brand').addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });
      nav.innerHTML = '';
      for (const [id, label, ic] of NAV) {
        if (!S.Pages.get(id)) continue;
        const b = h('button', { type: 'button', dataset: { route: id }, title: label }, icon(ic), h('span', label));
        b.addEventListener('click', () => { frame().classList.remove('menu-open'); location.hash = id; });
        nav.appendChild(b);
      }
      const tools = document.getElementById('topTools');
      tools.innerHTML = '';
      app.btnProj = h('button.icon-btn', { type: 'button', title: 'Projector mode: large type and strong lines for a classroom (Shift+P)', 'aria-label': 'Projector mode', id: 'btnProjector' }, icon('screen'));
      app.btnProj.addEventListener('click', () => app.setProjector(!app.settings.projector));
      app.btnTheme = h('button.icon-btn', { type: 'button', title: 'Light or dark (T)', 'aria-label': 'Light or dark', id: 'btnTheme' });
      app.btnTheme.addEventListener('click', () => app.toggleTheme());
      const about = h('button.icon-btn', { type: 'button', title: 'Help, settings and About', 'aria-label': 'Help and About', id: 'btnAbout' }, icon('help'));
      about.addEventListener('click', () => Shell.aboutMenu(app, about));
      tools.append(app.btnProj, app.btnTheme, about);
      app.applyTheme();
    },
    aboutMenu(app, anchor) {
      const r = anchor.getBoundingClientRect();
      S.UI.showMenu([
        { label: 'Keyboard shortcuts', sc: '?', action: () => app.shortcuts() },
        { label: 'Settings…', action: () => Shell.settings(app) },
        { label: 'The sample scenes', action: () => { location.hash = 'demo'; } },
        { sep: true },
        { label: 'About Proses', action: () => Shell.about(app) },
        { label: 'About the author', action: () => S.authorDialog && S.authorDialog() },
      ], r.right - 220, r.bottom + 4, { anchor, keyboard: true });
    },
    pageOf(hash) {
      const m = /^([a-z]+)(?:[=/?](.*))?$/i.exec(hash);
      if (!m) return [null, ''];
      return [ALIAS[m[1]] || m[1], hash];
    },

    // ---- home ----------------------------------------------------------------------------------------------
    renderHome(app, main, notice) {
      const box = h('div.home', { id: 'homeView' });
      if (notice) box.appendChild(h('div.notice', icon('info'), h('span', notice)));
      const go = (id, ic, label, hash, primary) => { const b = h('button.btn' + (primary ? '.primary' : ''), { type: 'button', id }, icon(ic), label); b.addEventListener('click', () => { location.hash = hash; }); return b; };
      const art = h('div.hero-art', { id: 'heroArt' }), cap = h('div.hero-cap', { id: 'heroCap', 'aria-live': 'off' });
      box.appendChild(h('section.hero.home-hero',
        h('div.hero-text', h('h1', 'Operating systems you can see inside.'),
          h('p.lead', 'Every mechanism of the operating system as a small machine you set up, run and break: a scheduler deciding tick by tick, a page table walked level by level, a file system written block by block, and a C program whose process tree grows as it forks.'),
          h('div.cta', go('btnToTopics', 'library', 'Browse the topics', 'topics', true), go('btnToScenes', 'layers', 'See the sample scenes', 'demo')),
          h('p.hero-stats', 'Every step says what happened with the actual values, and every run replays the same way from its seed.')),
        h('div.hero-show', art, cap)));
      const tool = (id, ic, title, text, hash) => { const b = h('button.tool-card', { type: 'button', id }, h('span.tc-icon', icon(ic)), h('span.tc-text', h('b', title), h('span', text))); b.addEventListener('click', () => { location.hash = hash; }); return b; };
      box.appendChild(h('h2.sub-title', 'Watch it, try it, then set it up yourself'));
      box.appendChild(h('section.home-tools',
        tool('toTopics', 'library', 'Topics', 'The course, part by part: each idea a picture that runs, with a sentence for every step.', 'topics'),
        tool('toLearn', 'learn', 'Learn', 'Lessons with live figures, and exercises checked the moment you answer.', 'learn'),
        tool('toLabs', 'chip', 'Labs', 'Your own workload, program, page table or disk image, run and drawn step by step.', 'labs'),
        tool('toChallenges', 'trophy', 'Challenges', 'Targets to reach within limits, checked on cases you cannot see.', 'challenges'),
        tool('toScenes', 'layers', 'Sample scenes', 'The pictures at a glance: processes, schedules, page walks, frames, disks and files.', 'demo')));
      const parts = S.parts || [];
      if (parts.length) box.appendChild(h('h2.sub-title', 'The course, in ' + parts.length + ' parts'));
      const grid = h('div.part-grid');
      parts.forEach((p) => {
        const n = (S.topics || []).filter((t) => { const f = S.familyOf(t); return f && f.part === p.id; }).length;
        grid.appendChild(h('section.part.part-card', { id: 'part-' + p.n }, h('div.part-head', h('span.num', String(p.n)), h('h3', h('a', { href: '#part=' + p.id }, p.title)), n ? h('span.part-n', n + ' topic' + (n === 1 ? '' : 's')) : null), h('p.part-blurb', p.blurb)));
      });
      box.appendChild(grid);
      main.appendChild(box);
      requestAnimationFrame(() => { if (!art.isConnected || !S.HomeHero) return; const hero = S.HomeHero(art, cap); if (hero) { app.hero = hero; app.players.push(hero); } });
    },

    // ---- settings and About ------------------------------------------------------------------------------------
    settings(app) {
      const s = app.settings;
      const row = (title, sub, ctl) => h('div.settings-row', h('div.what', h('b', title), h('span', sub)), ctl);
      const chk = (key, after, dflt) => { const c = h('input', { type: 'checkbox', checked: s[key] === undefined ? !!dflt : !!s[key], id: 'set-' + key }); c.addEventListener('change', () => { s[key] = c.checked; app.saveSettings(); app.applyTheme(); if (after) after(); }); return c; };
      const sel = (key, opts, after) => { const c = h('select', { id: 'set-' + key, 'aria-label': key }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l))); c.addEventListener('change', () => { s[key] = c.value; app.saveSettings(); app.applyTheme(); if (after) after(); }); return c; };
      const L = S.Learner;
      const pr = h('input', { type: 'checkbox', checked: !!(L && L.settings.predict), id: 'set-predict' });
      pr.addEventListener('change', () => { if (L) { L.settings.predict = pr.checked; L.saveSettings(); } });
      S.UI.modal({ title: 'Settings', wide: true, body: h('div',
        row('Theme', 'Light, dark, or whatever the system uses', sel('theme', [['auto', 'Like the system'], ['light', 'Light'], ['dark', 'Dark']], () => app.redraw())),
        row('Animate', 'Values glide between steps; off shows each step at once', chk('animate', null, true)),
        row('Predictions', 'The topic player stops to ask what comes next before key moments', pr),
        row('Keep my work', 'Save lab workloads, programs and disk images in this browser as I go', chk('autosave', null, true)),
        row('Projector mode', 'Large type and strong lines for a classroom (Shift+P)', chk('projector', () => app.setProjector(s.projector))),
        h('p.muted.engines', { id: 'engineStatus' }, Shell.engines().length ? 'Engines: ' + Shell.engines().map((x) => x.name).join(', ') + '.' : 'The engines are on their way.')),
      buttons: [{ label: 'Close', value: true, primary: true }] });
    },
    /** the engines that have registered (S.engines.push({name}) in src/core), for the settings dialog */
    engines() { return (S.engines || []).slice(); },
    about() {
      const more = h('a', { href: '#' }, 'About the author');
      more.addEventListener('click', (e) => { e.preventDefault(); S.UI.closeAllModals(); setTimeout(() => S.authorDialog && S.authorDialog(), 50); });
      const sib = (name, url) => h('a', { href: url, target: '_blank', rel: 'noopener' }, name);
      const sibs = [];
      SIBLINGS.forEach(([n, u], i) => { if (i) sibs.push(i === SIBLINGS.length - 1 ? ' and ' : ', '); sibs.push(sib(n, u)); });
      S.UI.modal({
        title: 'About Proses',
        body: h('div', h('p', h('b', 'Proses'), ' @@VERSION@@ is operating systems you can see inside: processes and their fork trees, schedulers, synchronisation, deadlocks, memory and virtual memory, storage, file systems and virtual machines, each a small machine you set up, run step by step and break. Every step says what happened with the actual values, and every run comes from a visible seed, so it replays the same way. Every example, program, workload and exercise in it was made for Proses.'),
          h('p', 'It runs entirely in your browser from one file: no server, no account, nothing sent anywhere. Your progress, settings and lab setups stay in this browser.'),
          h('p', 'Its sister tools: ', ...sibs, '.'),
          h('p', 'Proses teaches the concepts; for the code of a real kernel, its companion is ', h('a', { href: 'https://xv6.jyotiprakash.org', target: '_blank', rel: 'noopener' }, 'xv6, line by line'), ', every line of a teaching operating system explained.'),
          h('p', 'Free software under the GNU General Public License, version 3 or later. Every copy and every derived work must keep this attribution: Based on Proses by Jyotiprakash Mishra (https://proses.jyotiprakash.org).'),
          h('p', 'Copyright © 2026 Jyotiprakash Mishra. The name Proses is not licensed for derived works.'), h('p', more)),
        buttons: [{ label: 'OK', value: true, primary: true }],
      });
    },

    // ---- share links -------------------------------------------------------------------------------------------
    /** copy a link that opens this state: kind is the page that opens it (a page registered with a load(data)) */
    async share(kind, data) {
      const code = await S.Share.pack({ kind, data });
      const url = location.href.replace(/#.*$/, '') + '#share=' + code;
      S.Share.copy(url, url.length > 6000 ? 'Copied. The link is long (' + Math.round(url.length / 1000) + ' KB): some apps cut long links, so for a big setup save it as a file instead.' : 'Link copied: whoever opens it gets this exact setup.');
      return url;
    },
    async openShared(app, code) {
      try {
        const { kind, data } = await S.Share.unpack(code);
        const pg = S.Pages.get(kind);
        if (!pg || !pg.load) throw new Error('This link is for a part of Proses this version does not have.');
        const where = pg.load(data) || kind;
        history.replaceState(null, '', '#' + where);
        app.route();
        S.UI.toast('Opened the shared ' + (pg.shareName || 'setup') + '.', 'ok');
      } catch (e) {
        history.replaceState(null, '', '#');
        app.route();
        S.UI.toast(e.message, 'err', 5000);
      }
    },
  });

})(globalThis.Proses = globalThis.Proses || {});
