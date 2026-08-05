// The Challenges pages: #challenges lists the challenges with the reader's best score and medal; #challenge/id sets
// one: its story, the task, the goal and the limits, the workspace its kind brings (S.Challenges.kinds), and Submit,
// which scores the answer on the hidden cases and keeps the attempt in this browser.
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  const C = () => S.Challenges;
  const LEVEL = ['', 'easy', 'medium', 'hard'];
  const MEDAL = { gold: 'Gold', silver: 'Silver', bronze: 'Target reached' };
  const inline = (t) => S.UI.inline(t);
  const medalEl = (m) => (m ? h('span.medal.' + m, { title: MEDAL[m] }, icon('trophy'), MEDAL[m]) : null);

  function listPage(main, notice) {
    document.title = 'Challenges · Proses';
    const box = h('div.home.challenges', { id: 'challengesView' });
    if (notice) box.appendChild(h('div.notice', icon('info'), h('span', notice)));
    box.append(h('h1.page-title', 'Challenges'), h('p.lead', 'Each challenge is a task with a story, a target and limits on what you may use: tune a scheduler, design a page table under a memory budget, write a lock that no schedule starves. Submit, and it is checked on cases you have not seen. Your attempts and best scores stay in this browser.'));
    const list = S.Content ? S.Content.ladder() : [];
    if (!list.length) { box.appendChild(S.UI.empty('trophy', 'No challenges yet', 'They are being written. Meanwhile the topics and the sample scenes show each mechanism running, step by step.', [{ label: 'Browse the topics', icon: 'library', primary: true, action: () => { location.hash = 'topics'; } }])); main.appendChild(box); return; }
    const grid = h('div.ch-grid');
    for (const x of list) {
      const best = C().best(x.id), solved = C().solved(x.id), medal = best ? C().medal(x, best.score) : null;
      const card = h('a.ch-card' + (solved ? '.solved' : ''), { href: '#challenge/' + x.id, dataset: { challenge: x.id } },
        h('div.ch-top', h('span.ch-n', String(x.n)), h('span.ch-level', { title: LEVEL[x.level || 1] }, '●'.repeat(x.level || 1) + ' ' + LEVEL[x.level || 1]), solved ? h('span.ch-ok', { title: 'Target reached' }, icon('check')) : null),
        h('h3', x.title),
        h('p.ch-story', String(x.story).split(/(?<=\.)\s/)[0]),
        h('div.ch-meta', h('span.ch-goal', icon('target'), C().goal(x)), best ? h('span.ch-best', 'best ' + C().fmt(best.score)) : h('span.muted', 'not tried yet'), medalEl(medal)));
      grid.appendChild(card);
    }
    box.appendChild(grid);
    main.appendChild(box);
  }

  function challengePage(main, x) {
    document.title = x.title + ' · Challenges · Proses';
    const kind = C().kinds[x.kind];
    const page = { dispose() { if (S.Remote && S.Remote.busy()) S.Remote.cancel(); if (ws && ws.dispose) ws.dispose(); }, redraw() { if (ws && ws.redraw) ws.redraw(); } };
    const box = h('article.challenge', { id: 'challengeView', dataset: { challenge: x.id } });
    box.append(h('div.crumbs', h('a', { href: '#challenges' }, 'Challenges'), ' › ' + x.n + '. ' + x.title),
      h('h1.page-title', x.title),
      h('div.ls-meta', h('span.level', '●'.repeat(x.level || 1) + ' ' + LEVEL[x.level || 1]), C().solved(x.id) ? h('span.solved', icon('check'), 'Target reached') : null),
      h('div.ch-story-full', ...String(x.story).split(/\n\s*\n/).map((p) => h('p', inline(p)))),
      S.ExWidgets.taskCard(x));
    const host = h('div.ch-work', { id: 'chWork' });
    const submit = h('button.btn.primary', { type: 'button', id: 'btnSubmit' }, icon('trophy'), 'Submit for scoring');
    const reset = h('button.btn', { type: 'button', id: 'btnReset' }, icon('restart'), 'Start again');
    const hintBtn = h('button.btn', { type: 'button', id: 'btnHint' }, icon('hint'), 'A hint');
    const result = h('div.ch-result', { id: 'chResult', 'aria-live': 'polite' });
    const hints = h('div.hints', { id: 'hints' });
    box.append(host, h('div.ex-tools.ch-tools', submit, reset, hintBtn), result, hints, history());
    main.appendChild(box);
    // the workspace: the reader's saved attempt, or the starting answer
    let ws = null;
    const save = S.UI.debounce(() => { if (ws && (!S.Shell || S.Shell.autosave())) C().saveDraft(x.id, ws.get()); }, 500);
    const open = (answer) => {
      if (ws && ws.dispose) ws.dispose();
      host.innerHTML = '';
      ws = null;
      if (!kind || !kind.workspace) { host.appendChild(S.UI.empty('chip', 'The workspace is on its way', 'This challenge needs a part of Proses that is not in this build yet.')); submit.disabled = true; return; }
      ws = kind.workspace(host, x, answer, save);
    };
    const draft = C().draft(x.id);
    open(draft !== null ? draft : C().starter(x));
    reset.addEventListener('click', async () => {
      if (!(await S.UI.confirm('Start again?', 'Your answer to this challenge is replaced by the starting one. Your scores are kept.', 'Start again', 'Keep mine'))) return;
      C().saveDraft(x.id, null);
      open(C().starter(x));
    });
    let shown = 0;
    hintBtn.addEventListener('click', () => {
      const hs = x.hints || [];
      if (shown >= hs.length) return;
      hints.appendChild(h('div.ls-note.tip.hint', icon('hint'), h('div', h('b', 'Hint ' + (shown + 1) + '. '), inline(hs[shown]))));
      shown++;
      if (shown >= hs.length) { hintBtn.disabled = true; hintBtn.lastChild.textContent = 'No more hints'; }
    });
    submit.addEventListener('click', async () => {
      if (submit.disabled || !ws) return;
      submit.disabled = true;
      result.className = 'ch-result busy';
      result.innerHTML = '';
      const slow = kind && kind.remote && S.Remote;
      const stop = slow ? S.Remote.progress(result) : null;
      if (!slow) result.appendChild(h('div.ex-v', icon('history'), h('b', 'Scoring… '), h('span', 'your answer meets the hidden cases.')));
      let r;
      try { r = await C().evaluateAsync(x, ws.get()); }
      catch (e) {
        if (e && e.cancelled) { if (stop) stop(); submit.disabled = false; result.className = 'ch-result'; result.innerHTML = ''; result.appendChild(h('div.ex-v', icon('x'), h('b', 'Not scored. '), h('span', 'The scoring was cancelled; submit again when you are ready.'))); return; }
        r = { ok: false, score: null, problems: [String(e.message || e)], limits: [] };
      }
      finally { submit.disabled = false; if (stop) stop(); }
      const rank = C().record(x.id, r);
      showResult(x, r, rank, result);
      const hist = document.getElementById('chHistory');
      if (hist) hist.replaceWith(history());
    });
    function history() {
      const at = C().attempts(x.id);
      if (!at.length) return h('div', { id: 'chHistory' });
      const rows = at.slice(-8).reverse().map((a) => h('tr' + (a.reached ? '.ok' : ''), h('td', new Date(a.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), h('td.mono', a.limits ? 'broke the limits' : C().fmt(a.score)), h('td', medalEl(a.medal) || (a.reached ? 'reached' : '—'))));
      return h('details.ch-history', { id: 'chHistory' }, h('summary', 'Your attempts (' + at.length + ')'), h('div.fit-table', h('table.ch-hist', h('thead', h('tr', h('th', 'When'), h('th', C().metricLabel(x)), h('th', ''))), h('tbody', rows))));
    }
    page.submit = () => submit.click();
    page.load = (answer) => { if (ws && ws.load) ws.load(answer); else open(answer); };
    page.workspace = () => ws;
    return page;
  }

  function showResult(x, r, rank, box) {
    box.innerHTML = '';
    box.className = 'ch-result ' + (r.reached ? 'ok' : 'bad');
    const head = r.limits && r.limits.length ? 'The answer breaks the limits.' : r.score === null || r.score === undefined ? 'The answer could not be scored.' : r.reached ? 'Target reached.' : 'Not there yet.';
    box.appendChild(h('div.ex-v', icon(r.reached ? 'check' : 'x'), h('b', head)));
    if (r.score !== null && r.score !== undefined && !(r.limits && r.limits.length)) {
      box.appendChild(h('div.ch-score', h('span.ch-big.mono', C().fmt(r.score)), h('span', C().metricLabel(x) + (r.n ? ' over ' + r.n + ' hidden cases' : '') + ' · the target is ' + C().goal(x)), medalEl(r.medal)));
      if (rank && rank.rank) box.appendChild(h('p.muted', rank.rank === 1 ? (rank.of > 1 ? 'Your best of ' + rank.of + ' attempts.' : 'Your first scored attempt.') : 'Number ' + rank.rank + ' of your ' + rank.of + ' attempts.'));
      const m = x.marks || {};
      if (r.reached && r.medal !== 'gold' && m.gold !== undefined) box.appendChild(h('p.muted', 'Silver at ' + (m.silver !== undefined ? m.silver : '—') + ', gold at ' + m.gold + '.'));
    }
    for (const d of r.details || []) box.appendChild(h('div.ex-d', inline(d)));
    for (const p of r.problems || []) box.appendChild(h('div.ex-d', p.replace(/^./, (c) => c.toUpperCase()) + (/[.!?]$/.test(p) ? '' : '.')));
  }

  S.Pages.register('challenges', {
    nav: 'challenges', title: 'Challenges',
    open(app, main, rest) {
      const m = /^challenges?[=/](.+)$/.exec(rest || '');
      if (m) {
        const x = S.Content && S.Content.challenges.get(m[1]);
        if (x) return challengePage(main, x);
        listPage(main, 'There is no challenge called "' + m[1] + '". Pick one from the list.');
        return { dispose() {} };
      }
      listPage(main);
      return { dispose() {} };
    },
  });

  // ---- what the diagram checker looks at ------------------------------------------------------------------------
  // a challenge's own page joins this list when the first challenge is written:
  //   S.Checks.push({ group: 'challenges', name: 'a challenge', hash: 'challenge/<id>', ready: "document.querySelector('#challengeView')", sel: '#main' })
  if (S.Checks && !S.Checks.some((c) => c.group === 'challenges')) {
    S.Checks.push({ group: 'challenges', name: 'challenges list', hash: 'challenges', ready: "document.querySelector('#challengesView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
