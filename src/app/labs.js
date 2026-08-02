// The Labs page: workspaces where the reader sets up the machine and runs it (a workload, a C program, a page-table
// design, a disk image). #labs lists them; #labs/id opens one. A lab registers itself (lab-0-registry.js):
//   S.Labs.add({id, title, blurb, part, setup, run, views})   drawn by the lab shell (lab-shell.js)
//   S.Labs.register({id, title, icon, blurb, order, open(app, main, rest) -> page, preset?(setup), shareName?})
// open() works like a page's open (ui.js): it fills main and returns {dispose(), redraw()?, onKey()?, keys?}.
// preset(setup) is called before the route changes to the lab, so the lab opens set up (lesson cards use it).
// The labs the plan names are listed as on their way until each one registers; hidden labs are not listed.
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  // the registry lives in lab-0-registry.js, which loads first, so a lab's file can register as it loads
  const L = S.Labs;
  const PLANNED = L.planned;
  const labs = { has: (id) => !!L.get(id), get: (id) => L.get(id) };

  function listPage(main, notice) {
    document.title = 'Labs · Proses';
    const box = h('div.home.labs', { id: 'labsView' });
    if (notice) box.appendChild(h('div.notice', icon('info'), h('span', notice)));
    box.append(h('h1.page-title', 'Labs'), h('p.lead', 'Each lab starts from a preset, and every parameter is yours to change: the picture follows. Runs come from visible seeds, so the same setup replays the same way, and your setups stay in this browser.'));
    const grid = h('section.home-tools.lab-grid');
    const seen = new Set();
    for (const lab of L.list()) {
      seen.add(lab.id);
      const b = h('a.tool-card', { href: '#labs/' + lab.id, dataset: { lab: lab.id } }, h('span.tc-icon', icon(lab.icon)), h('span.tc-text', h('b', lab.title), h('span', lab.blurb || '')));
      grid.appendChild(b);
    }
    for (const [id, title, ic, blurb] of PLANNED) {
      if (seen.has(id)) continue;
      grid.appendChild(h('div.tool-card.soon', { dataset: { lab: id } }, h('span.tc-icon', icon(ic)), h('span.tc-text', h('b', title), h('span', blurb), h('span.soon-tag', 'On its way'))));
    }
    box.appendChild(grid);
    main.appendChild(box);
  }

  S.Pages.register('labs', {
    nav: 'labs', title: 'Labs',
    shareName: 'lab setup',
    /** a share link's data {lab, setup}: set the lab up, and say where to go */
    load(data) { if (!data || !labs.has(data.lab)) throw new Error('This link is for a lab this version does not have.'); L.preset(data.lab, data.setup); return 'labs/' + data.lab; },
    open(app, main, rest) {
      const m = /^labs?[=/]([a-z0-9-]+)(?:[/?](.*))?$/.exec(rest || '');
      if (m) {
        const lab = labs.get(m[1]);
        if (lab) { document.title = lab.title + ' · Labs · Proses'; return lab.open(app, main, m[2] || '') || { dispose() {} }; }
        const plan = PLANNED.find((p) => p[0] === m[1]);
        listPage(main, plan ? 'The ' + plan[1] + ' is on its way.' : 'There is no lab called "' + m[1] + '". Pick one from the list.');
        return { dispose() {} };
      }
      listPage(main);
      return { dispose() {} };
    },
  });

  if (S.Checks && !S.Checks.some((c) => c.group === 'labs')) {
    S.Checks.push({ group: 'labs', name: 'labs list', hash: 'labs', ready: "document.querySelector('#labsView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
