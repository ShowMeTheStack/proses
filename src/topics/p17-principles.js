// Part 17, goals and principles: least privilege checked right by right (S.Prot.leastPrivilege), and one mechanism
// (the access-matrix check, S.Prot.check) serving two different policies.
(function (S) {
  'use strict';
  const H = S.P09, P17 = S.P17, Pr = () => S.Prot;
  const g = (subject, object, rights) => ({ subject, object, rights });
  const LP = {
    shop: { label: 'A web shop: the web server and the database', subjects: ['web', 'db'], objects: ['pages', 'orders', 'logs', 'keys'],
      grants: [g('web', 'pages', ['read']), g('web', 'orders', ['read', 'write']), g('web', 'logs', ['write']), g('web', 'keys', ['read']), g('db', 'orders', ['read', 'write']), g('db', 'logs', ['read', 'write']), g('db', 'keys', ['read'])],
      needs: [g('web', 'pages', ['read']), g('web', 'orders', ['write']), g('web', 'logs', ['write']), g('db', 'orders', ['read', 'write']), g('db', 'logs', ['write']), g('db', 'keys', ['read'])] },
    backup: { label: 'A nightly backup job', subjects: ['backup'], objects: ['home', 'tape', 'config', 'catalog'],
      grants: [g('backup', 'home', ['read', 'write']), g('backup', 'tape', ['write']), g('backup', 'config', ['read', 'write'])],
      needs: [g('backup', 'home', ['read']), g('backup', 'tape', ['write']), g('backup', 'config', ['read']), g('backup', 'catalog', ['write'])] },
    tight: { label: 'The web shop, tightened', subjects: ['web', 'db'], objects: ['pages', 'orders', 'logs', 'keys'],
      grants: [g('web', 'pages', ['read']), g('web', 'orders', ['write']), g('web', 'logs', ['write']), g('db', 'orders', ['read', 'write']), g('db', 'logs', ['write']), g('db', 'keys', ['read'])],
      needs: [g('web', 'pages', ['read']), g('web', 'orders', ['write']), g('web', 'logs', ['write']), g('db', 'orders', ['read', 'write']), g('db', 'logs', ['write']), g('db', 'keys', ['read'])] },
  };
  H.LP = LP;
  S.topic({
    id: 'prot-least-privilege', family: 'p17-principles', order: 10, title: 'Least privilege, right by right',
    blurb: 'Give every program and user only the rights its work needs, for only as long as it needs them. Then a mistake, or a program taken over, can do only so much damage. Separation helps too: split a job between parts with different rights, so no single part holds them all. Here the rights granted are compared with the rights each task needs: an excess right is a risk with no use, and a missing right is a failure waiting to happen.',
    inputs: [{ id: 'sc', kind: 'choice', label: 'System', def: 'shop', options: Object.entries(LP).map(([value, s]) => ({ value, label: s.label })) }],
    presets: Object.entries(LP).map(([k, s]) => ({ label: s.label, values: { sc: k } })),
    counters: [{ id: 'excess', label: 'excess rights' }, { id: 'missing', label: 'missing rights' }],
    run(inp) {
      const sc = LP[inp.sc], R = Pr().leastPrivilege({ grants: sc.grants, needs: sc.needs }), F = new S.Frames(['excess', 'missing']);
      const has = (L, s, o, r) => L.some((x) => x.subject === s && x.object === o && x.rights.includes(r));
      const cw = 150, rh = 56, x0 = 90, y0 = 70;
      const grid = (lit, shown) => {
        const items = [H.title('tt', 0, 6, sc.label)];
        sc.objects.forEach((o, k) => items.push({ key: 'co' + o, kind: 'text', x: x0 + k * (cw + 4) + cw / 2, y: y0 - 12, text: o, anchor: 'middle', size: 14, cls: 'colname' }));
        sc.subjects.forEach((s, i) => {
          const y = y0 + i * (rh + 4);
          items.push({ key: 'ro' + s, kind: 'text', x: x0 - 10, y: y + rh / 2 + 5, text: s, anchor: 'end', size: 14, cls: 'rowname' });
          sc.objects.forEach((o, k) => {
            const x = x0 + k * (cw + 4);
            items.push({ key: 'bx' + s + o, kind: 'cell', x, y, w: cw, h: rh, rx: 5, text: '', cls: 'amcell' + (lit && lit.subject === s && lit.object === o ? ' changed' : '') });
            const rs = ['read', 'write'].filter((r) => has(sc.grants, s, o, r) || has(sc.needs, s, o, r));
            rs.forEach((r, j) => {
              const gr = has(sc.grants, s, o, r), nd = has(sc.needs, s, o, r), judged = shown.has(s + o + r);
              const cls = !judged ? (gr ? '' : 'faded') : gr && nd ? 'good' : gr ? 'hot' : 'missing';
              items.push({ key: 'rt' + s + o + r, kind: 'cell', x: x + 8 + j * 68, y: y + 14, w: 62, h: 28, rx: 12, text: r, size: 13, cls: 'tag ' + cls });
            });
          });
        });
        const ly = y0 + sc.subjects.length * (rh + 4) + 30;
        [['good', 'granted and needed'], ['hot', 'granted, not needed: remove'], ['missing', 'needed, not granted: add']].forEach(([c, t], k) => {
          items.push({ key: 'lgb' + k, kind: 'cell', x: k * 230, y: ly, w: 26, h: 20, rx: 8, text: '', cls: 'tag ' + c });
          items.push(H.text('lgt' + k, k * 230 + 34, ly + 15, t, '', 13));
        });
        return items;
      };
      const shown = new Set();
      F.add({ items: grid(null, shown), say: `${H.plural(sc.grants.reduce((a, x) => a + x.rights.length, 0), 'right')} granted to ${H.list(sc.subjects)}; their tasks need ${H.plural(sc.needs.reduce((a, x) => a + x.rights.length, 0), 'right')}. Each granted right is checked against the needs, then each need against the grants.`, meta: { phase: 'start', granted: sc.grants.reduce((a, x) => a + x.rights.length, 0), needed: sc.needs.reduce((a, x) => a + x.rights.length, 0) } });
      // the needed-and-granted ones together, then each finding from the engine
      for (const x of sc.grants) for (const r of x.rights) if (has(sc.needs, x.subject, x.object, r)) shown.add(x.subject + x.object + r);
      F.add({ items: grid(null, shown), say: 'Rights that are both granted and needed are fine (green).', meta: { phase: 'ok' } });
      R.steps.filter((s) => s.kind !== 'result').forEach((st, k) => {
        const it = st.kind === 'excess' ? R.excess.find((e) => st.say.startsWith(e.subject + ' holds ' + e.right + ' on ' + e.object)) : R.missing.find((e) => st.say.startsWith(e.subject + ' needs ' + e.right + ' on ' + e.object));
        shown.add(it.subject + it.object + it.right);
        F.count(st.kind);
        F.add({ items: grid(it, new Set(shown)), say: st.say, meta: { phase: st.kind, k }, title: st.kind + ': ' + it.subject + ' · ' + it.object });
      });
      const last = R.steps[R.steps.length - 1];
      F.add({ items: grid(null, shown).concat([H.text('vd', 0, y0 + sc.subjects.length * (rh + 4) + 80, R.ok ? 'least privilege holds' : Math.round(R.score * 100) + '% of granted rights are used', 'verdict2 ' + (R.ok ? 'good' : 'hot'), 16)]), say: last.say + (R.ok ? '' : ` Removing the ${H.plural(R.excess.length, 'excess right')} shrinks what a mistake in these programs could reach.`), meta: { phase: 'end', score: R.score, pct: Math.round(R.score * 100), excess: R.excess.length, missing: R.missing.length, granted: sc.grants.reduce((a, x) => a + x.rights.length, 0), used: Math.round(R.score * sc.grants.reduce((a, x) => a + x.rights.length, 0)) }, title: 'verdict', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Principles', text: ['least privilege: only the rights the work needs', '  and only while it needs them', 'separation: split duties so no one part has all', 'fail-safe defaults: deny unless granted', 'economy: keep the protection mechanism small'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'ok', pick: 'option', ask: 'How many granted rights are not needed?', options: ['0', '1', '2', '3', '4 or more'], answer: (fr) => { const k = fr[fr.length - 1].meta.excess; return k >= 4 ? '4 or more' : String(k); }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Least privilege limits…', options: ['the damage a mistake or a compromised program can do', 'the speed of programs', 'the number of users', 'disk usage'], answer: 0, why: 'A program can misuse only the rights it holds.' },
      { q: 'A web server that can read the payment keys but never needs to…', options: ['holds an excess right: remove it', 'is following least privilege', 'needs more rights', 'is safe because it never uses them'], answer: 0, why: 'If the server is taken over, the keys are within reach.' },
      { q: 'Separation of privilege means…', options: ['splitting a task so that no single part holds every right', 'running every program as root', 'one password for everyone', 'separating memory into pages'], answer: 0, why: 'Then two parts must both fail before harm is done.' },
      { q: 'Fail-safe defaults means…', options: ['deny access unless it was explicitly granted', 'allow everything by default', 'reboot on errors', 'keep backups'], answer: 0, why: 'A forgotten rule then refuses rather than permits.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const POL = {
    open: { label: 'open lab', M: { domains: ['student', 'teacher', 'guest'], objects: ['notes', 'exam', 'printer'], cells: { 'student|notes': ['read', 'write'], 'student|exam': ['read'], 'student|printer': ['print'], 'teacher|notes': ['read', 'write'], 'teacher|exam': ['read', 'write'], 'teacher|printer': ['print'], 'guest|notes': ['read'], 'guest|printer': ['print'] } } },
    exam: { label: 'exam day', M: { domains: ['student', 'teacher', 'guest'], objects: ['notes', 'exam', 'printer'], cells: { 'student|exam': ['read'], 'teacher|notes': ['read', 'write'], 'teacher|exam': ['read', 'write'], 'teacher|printer': ['print'] } } },
    closed: { label: 'after hours', M: { domains: ['student', 'teacher', 'guest'], objects: ['notes', 'exam', 'printer'], cells: { 'teacher|notes': ['read'], 'teacher|exam': ['read'] } } },
  };
  const REQS = [['student', 'notes', 'read'], ['student', 'exam', 'read'], ['student', 'printer', 'print'], ['teacher', 'exam', 'write'], ['guest', 'notes', 'read'], ['guest', 'printer', 'print']];
  S.topic({
    id: 'prot-mechanism-policy', family: 'p17-principles', order: 20, title: 'Mechanism against policy',
    blurb: 'The mechanism is how something is enforced: here, a check of the access matrix before every operation. The policy is what is allowed: the entries of the matrix. Keeping them apart means the same small, trusted mechanism serves any policy, and a new policy is a change of data, not of code. The same requests go through one mechanism under two policies, and the answers differ only because the policies do.',
    inputs: [
      { id: 'a', kind: 'choice', label: 'Policy A', def: 'open', options: Object.entries(POL).map(([value, p]) => ({ value, label: p.label })) },
      { id: 'b', kind: 'choice', label: 'Policy B', def: 'exam', options: Object.entries(POL).map(([value, p]) => ({ value, label: p.label })) },
    ],
    presets: [{ label: 'Open lab against exam day', values: { a: 'open', b: 'exam' } }, { label: 'Exam day against after hours', values: { a: 'exam', b: 'closed' } }, { label: 'Open lab against after hours', values: { a: 'open', b: 'closed' } }],
    counters: [{ id: 'differ', label: 'answers that differ' }],
    run(inp) {
      const A = Pr().matrix(POL[inp.a].M), B = Pr().matrix(POL[inp.b].M), F = new S.Frames(['differ']);
      const results = REQS.map(([d, o, r]) => ({ d, o, r, a: Pr().check(A, d, o, r), b: Pr().check(B, d, o, r) }));
      const pic = (cur) => {
        const lit = cur >= 0 ? results[cur] : null;
        const ma = P17.matrix(A, { prefix: 'ma', x: 0, y: 60, rowW: 70, cols: A.objects, minW: 96, cls: (d, o) => (lit && d === lit.d && o === lit.o ? (lit.a.ok ? 'good' : 'hot') : '') });
        const mb = P17.matrix(B, { prefix: 'mb', x: ma.w + 40, y: 60, rowW: 70, cols: B.objects, minW: 96, cls: (d, o) => (lit && d === lit.d && o === lit.o ? (lit.b.ok ? 'good' : 'hot') : '') });
        const items = [H.title('ta', 0, 14, 'policy A: ' + POL[inp.a].label), H.title('tb', ma.w + 40, 14, 'policy B: ' + POL[inp.b].label), ...ma.items, ...mb.items];
        const rows = results.map((x, k) => ({ cls: k === cur ? 'act' : '', cells: [x.d + ' ' + x.r + ' ' + x.o, k <= cur ? { text: x.a.ok ? 'allowed' : 'denied', cls: x.a.ok ? 'good' : 'hot' } : '', k <= cur ? { text: x.b.ok ? 'allowed' : 'denied', cls: x.b.ok ? 'good' : 'hot' } : ''] }));
        items.push(H.title('mt', 0, 200, 'one mechanism: check the entry before every request'), ...S.Kit.gantt.table({ prefix: 'rq', x: 0, y: 214, rowH: 28, size: 14, cols: [{ w: 240, label: 'request' }, { w: 130, label: 'under A' }, { w: 130, label: 'under B' }], rows }).items);
        return items;
      };
      F.add({ items: pic(-1), say: `Two policies for the same lab: "${POL[inp.a].label}" and "${POL[inp.b].label}". The mechanism is one function, the same for both: look up the entry, allow if it holds the right.`, meta: { phase: 'start' } });
      results.forEach((x, k) => {
        const diff = x.a.ok !== x.b.ok;
        if (diff) F.count('differ');
        F.add({ items: pic(k), say: `${x.d} asks to ${x.r} ${x.o}: ${x.a.ok ? 'allowed' : 'denied'} under A, ${x.b.ok ? 'allowed' : 'denied'} under B.` + (diff ? ' Same code, different answer: only the policy changed.' : ''), meta: { phase: 'req', k, a: x.a.ok, b: x.b.ok, diff }, title: x.d + ' ' + x.r + ' ' + x.o });
      });
      const nd = results.filter((x) => x.a.ok !== x.b.ok).length;
      F.add({ items: pic(results.length - 1), say: `${H.plural(nd, 'answer')} of ${results.length} differ, and not a line of the checking code changed between them. Changing the rules for exam day is an edit of data.`, meta: { phase: 'end', nd, n: results.length }, title: 'compare', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Two separate things', text: ['mechanism: how it is enforced (the check)', 'policy: what is allowed (the entries)', 'one mechanism, many policies', 'the mechanism must be small and trusted;', 'the policy changes with the situation'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many of the six requests will get different answers under the two policies?', options: ['0', '1', '2', '3', '4', '5 or 6'], answer: (fr) => { const k = fr[fr.length - 1].meta.nd; return k >= 5 ? '5 or 6' : String(k); }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Which is policy, not mechanism?', options: ['students may not read the exam today', 'the kernel checks a table before each access', 'the MMU checks page permissions', 'a trap enters the kernel'], answer: 0, why: 'It decides what is allowed; the others enforce whatever is decided.' },
      { q: 'Why keep mechanism and policy apart?', options: ['policies change often; the mechanism should not have to', 'it makes programs faster', 'policies are secret', 'mechanisms are cheaper to change'], answer: 0, why: 'A small, fixed, well-tested mechanism can enforce any policy.' },
      { q: 'A scheduler with tunable priorities is an example of…', options: ['one mechanism serving different policies', 'a policy without a mechanism', 'neither', 'a capability'], answer: 0, why: 'The priority values are the policy; the dispatcher is the mechanism.' },
      { q: 'If a policy is hard-coded into the mechanism, changing it means…', options: ['changing and re-testing trusted code', 'editing a table', 'nothing', 'rebooting only'], answer: 0, why: 'And every change to trusted code risks a new hole.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
