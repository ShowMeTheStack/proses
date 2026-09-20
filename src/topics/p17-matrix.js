// Part 17, protection domains and the access matrix (prot-a-matrix.js): rings as domains entered only through
// gates, the matrix's operations (copy, transfer, owner, control, switch), its four implementations with what each
// lookup must scan, and the cost of taking a right away in each.
(function (S) {
  'use strict';
  const H = S.P09, P17 = S.P17, Pr = () => S.Prot;

  // ---- rings as domains --------------------------------------------------------------------------------------
  const RINGS = () => Pr().matrix({
    domains: ['kernel', 'service', 'user'], objects: ['page table', 'disk', 'log', 'my file'],
    cells: { 'kernel|page table': ['read', 'write'], 'kernel|disk': ['read', 'write'], 'kernel|log': ['read', 'write'], 'kernel|my file': ['read', 'write'], 'kernel|user': ['switch'], 'kernel|service': ['switch'],
      'service|disk': ['read'], 'service|log': ['read', 'write'], 'service|kernel': ['switch'], 'service|user': ['switch'],
      'user|my file': ['read', 'write'], 'user|log': ['read'], 'user|kernel': ['switch'], 'user|service': ['switch'] },
  });
  const STORIES = {
    syscall: { label: 'A system call: user to kernel and back', start: 'user', acts: [['check', 'my file', 'write'], ['check', 'page table', 'read'], ['switch', 'kernel'], ['check', 'page table', 'write'], ['switch', 'user'], ['check', 'page table', 'write']] },
    service: { label: 'A logging service in the middle ring', start: 'user', acts: [['check', 'log', 'write'], ['switch', 'service'], ['check', 'log', 'write'], ['check', 'disk', 'write'], ['switch', 'kernel'], ['check', 'disk', 'write'], ['switch', 'user']] },
    deny: { label: 'Writing the disk from the user ring', start: 'user', acts: [['check', 'disk', 'read'], ['check', 'disk', 'write'], ['switch', 'service'], ['check', 'disk', 'write']] },
  };
  S.topic({
    id: 'prot-domains', family: 'p17-matrix', order: 10, title: 'Protection domains and rings',
    blurb: 'A protection domain is a set of rights: which objects may be used, and how. A process runs in one domain at a time. Rings are domains nested by privilege: the kernel ring can do everything the outer rings can and more. A process moves inward only through a gate, a switch right the matrix grants (a system call), so that it enters the inner ring at a place the inner ring chose. The domains are columns too: an entry "switch" in row user, column kernel is that gate.',
    inputs: [{ id: 'story', kind: 'choice', label: 'Story', def: 'syscall', options: Object.entries(STORIES).map(([value, s]) => ({ value, label: s.label })) }],
    presets: Object.entries(STORIES).map(([k, s]) => ({ label: s.label, values: { story: k } })),
    counters: [{ id: 'allowed', label: 'allowed' }, { id: 'refused', label: 'refused' }, { id: 'switches', label: 'switches' }],
    run(inp) {
      const M = RINGS(), st = STORIES[inp.story], F = new S.Frames(['allowed', 'refused', 'switches']);
      const CX = 170, CY = 180, RR = { kernel: 56, service: 108, user: 160 };
      let dom = st.start;
      const acts = (cur) => [H.title('al', 370, 30, 'what the process does')].concat(st.acts.map((a, k) => H.text('ac' + k, 370, 58 + k * 26, (k + 1) + '. ' + (a[0] === 'check' ? a[2] + ' ' + a[1] : 'call through the gate to ' + a[1]), k === cur ? 'stepline act' : k < cur ? 'stepline done' : 'stepline', 14)));
      const pic = (cur, hl, verdict, k) => {
        const items = [H.title('rt', 10, 0, 'the rings')];
        ['user', 'service', 'kernel'].forEach((d) => items.push({ key: 'ring:' + d, kind: 'ellipse', x: CX, y: CY, rx: RR[d], ry: RR[d], cls: 'pring ' + (d === cur ? 'act' : ''), audit: 'overlap-ok' }));
        ['user', 'service', 'kernel'].forEach((d) => items.push(H.text('rn:' + d, CX, d === 'kernel' ? CY - 12 : CY - RR[d] + 28, d, d === cur ? 'act' : 'strong', 15, 'middle')));
        items.push({ key: 'tok', kind: 'token', x: CX, y: cur === 'kernel' ? CY + 22 : CY + RR[cur] - 26, r: 15, text: 'P', cls: 'proc' });
        const am = P17.matrix(M, { x: 10, y: 400, minW: 70, cls: (d, o) => (hl && d === hl.d && o === hl.o ? (hl.ok ? 'good' : 'hot') : ''), rowCls: (d) => (d === cur ? 'act' : '') });
        items.push(H.title('mt', 10, 360, 'the access matrix (row: domain; column: object or domain)'), ...am.items, ...acts(k === undefined ? -1 : k));
        if (verdict) items.push(H.text('vd', 370, 58 + st.acts.length * 26 + 24, verdict.text, 'verdict2 ' + verdict.cls, 16));
        return items;
      };
      F.add({ items: pic(dom), say: `A process starts in the ${dom} ring. Its rights are the ${dom} row of the matrix; the domain columns hold the gates it may pass through.`, meta: { phase: 'start' } });
      st.acts.forEach((a, k) => {
        if (a[0] === 'check') {
          const r = Pr().check(M, dom, a[1], a[2]);
          F.count(r.ok ? 'allowed' : 'refused');
          F.add({ items: pic(dom, { d: dom, o: a[1], ok: r.ok }, { text: (r.ok ? 'allowed: ' : 'refused: ') + a[2] + ' ' + a[1], cls: r.ok ? 'good' : 'hot' }, k), say: `In the ${dom} ring the process tries to ${a[2]} ${a[1]}. ${r.say}` + (r.ok ? '' : ' The hardware or the kernel stops it, and nothing changes.'), meta: { phase: 'check', ok: r.ok, k }, title: a[2] + ' ' + a[1] });
        } else {
          const r = Pr().apply(M, { op: 'switch', by: dom, to: a[1] }), from = dom;
          if (r.ok) { F.count('switches'); dom = a[1]; }
          F.add({ items: pic(dom, { d: from, o: a[1], ok: r.ok }, { text: r.ok ? 'through the gate into ' + dom : 'no gate', cls: r.ok ? 'good' : 'hot' }, k), say: r.say + (r.ok && dom === 'kernel' ? ' The gate fixes where the kernel starts running, so the caller cannot jump into the middle of kernel code.' : ''), meta: { phase: 'switch', ok: r.ok, to: a[1], k }, title: 'switch to ' + a[1] });
        }
      });
      F.last().hold = 2500;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Domains', text: ['a domain: a set of (object, rights) pairs', 'a process runs in one domain at a time', 'rings: domain i has every right of ring i + 1', 'inward only through a gate (a switch entry)', 'outward on return'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'check' && fr[i + 1].meta.k > 0, once: true, pick: 'option', ask: 'Before you step: will the next access be allowed?', options: ['allowed', 'refused'], answer: (fr, i) => (fr[i + 1].meta.ok ? 'allowed' : 'refused'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A protection domain is…', options: ['a set of objects with the operations allowed on each', 'a part of memory', 'a user account only', 'a network address'], answer: 0, why: 'A process\'s rights at any moment are those of the domain it runs in.' },
      { q: 'Why may a user program enter the kernel only through a gate?', options: ['so the kernel decides where its code starts running and checks the request', 'to save time', 'because the kernel is in another building', 'so the program keeps its own rights'], answer: 0, why: 'Entering anywhere else could skip the kernel\'s checks.' },
      { q: 'In rings, the innermost ring has…', options: ['every right of the outer rings and more', 'the fewest rights', 'no rights at all', 'only the right to switch'], answer: 0, why: 'Rings are nested by privilege.' },
      { q: 'Two-mode hardware (user and kernel) is…', options: ['the simplest ring structure: two rings', 'unrelated to protection', 'a capability system', 'a kind of access-control list'], answer: 0, why: 'The mode bit separates one privileged domain from the rest.' },
    ],
  });

  // ---- operations on the matrix ------------------------------------------------------------------------------
  const OPS = {
    copy: { label: 'Copying rights, with and without the copy flag', ops: [{ op: 'copy', by: 'D1', to: 'D2', obj: 'F1', right: 'write' }, { op: 'copy', by: 'D2', to: 'D3', obj: 'F1', right: 'write' }, { op: 'limited-copy', by: 'D2', to: 'D3', obj: 'F2', right: 'read' }, { op: 'copy', by: 'D3', to: 'D1', obj: 'F2', right: 'read' }, { op: 'transfer', by: 'D2', to: 'D1', obj: 'F2', right: 'read' }] },
    owner: { label: 'An owner adds and removes rights in its column', ops: [{ op: 'add', by: 'D1', to: 'D3', obj: 'F1', right: 'write' }, { op: 'remove', by: 'D1', to: 'D3', obj: 'F1', right: 'read' }, { op: 'add', by: 'D2', to: 'D2', obj: 'F1', right: 'read' }, { op: 'add', by: 'D1', to: 'D2', obj: 'F1', right: 'owner' }, { op: 'add', by: 'D2', to: 'D2', obj: 'F1', right: 'read' }] },
    control: { label: 'Control over a domain, and switching', ops: [{ op: 'control-remove', by: 'D2', to: 'D3', obj: 'printer', right: 'print' }, { op: 'control-remove', by: 'D1', to: 'D3', obj: 'F1', right: 'read' }, { op: 'switch', by: 'D1', to: 'D2' }, { op: 'switch', by: 'D3', to: 'D1' }] },
  };
  const opWords = (a) => a.op === 'switch' ? a.by + ' switches to ' + a.to : a.op === 'control-remove' ? a.by + ' removes ' + a.right + ' on ' + a.obj + ' from ' + a.to + '\'s row' : a.by + ' ' + { copy: 'copies', 'limited-copy': 'copies (limited)', transfer: 'transfers', add: 'adds', remove: 'removes' }[a.op] + ' ' + a.right + ' on ' + a.obj + (a.op === 'remove' ? ' from ' : ' to ') + a.to;
  S.topic({
    id: 'prot-matrix-ops', family: 'p17-matrix', order: 20, title: 'The access matrix and its operations',
    blurb: 'Rows are domains, columns are objects, and each entry lists the rights a domain has on an object. The matrix changes too, under rules of its own. A right marked with * can be copied into another domain\'s entry in the same column (a limited copy drops the *; a transfer moves it). An owner of an object may add and remove rights anywhere in that column. A control right over a domain lets the holder remove rights from that domain\'s row. Each change below is checked against those rules.',
    inputs: [{ id: 'seq', kind: 'choice', label: 'Operations', def: 'copy', options: Object.entries(OPS).map(([value, s]) => ({ value, label: s.label })) }],
    presets: Object.entries(OPS).map(([k, s]) => ({ label: s.label, values: { seq: k } })),
    counters: [{ id: 'done', label: 'done' }, { id: 'refused', label: 'refused' }],
    run(inp) {
      let M = Pr().preset();
      const seq = OPS[inp.seq].ops, F = new S.Frames(['done', 'refused']);
      const list = (cur) => [H.title('ol', 0, 220, 'operations')].concat(seq.map((a, k) => H.text('op' + k, 0, 248 + k * 26, (k + 1) + '. ' + opWords(a), k === cur ? 'stepline act' : k < cur ? 'stepline done' : 'stepline', 14)));
      const pic = (M, cur, changed, bad) => [H.title('tt', 0, 6, 'the access matrix'), ...P17.matrix(M, { x: 0, y: 60, cls: (d, o) => (changed && changed.includes(d + '|' + o) ? 'changed' : bad && bad === d + '|' + o ? 'hot' : '') }).items, ...list(cur)];
      F.add({ items: pic(M, -1), say: 'Three domains, three objects, and the domains as columns too. A * after a right is its copy flag; owner gives control of a column; control gives control of a row; switch lets a process move into that domain.', meta: { phase: 'start' } });
      seq.forEach((a, k) => {
        const r = Pr().apply(M, a);
        F.count(r.ok ? 'done' : 'refused');
        const key = a.op === 'switch' ? a.by + '|' + a.to : a.op === 'control-remove' ? a.by + '|' + a.to : a.by + '|' + a.obj;
        F.add({ items: pic(r.M, k, r.ok ? r.changed : null, r.ok ? null : key), say: r.say, meta: { phase: 'op', ok: r.ok, k, op: a.op }, title: opWords(a) });
        M = r.M;
      });
      F.last().hold = 2500;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Rules for changing the matrix', text: ['copy r on O to D: needs r* on O; D gets r*', 'limited copy: D gets r without *', 'transfer: D gets r*, the giver loses it', 'owner on O: add or remove any right in column O', 'control over D: remove rights from row D', 'switch to D: needs switch in column D'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'op', pick: 'option', ask: 'Before you step: will the next operation be allowed?', options: ['allowed', 'refused'], answer: (fr, i) => (fr[i + 1].meta.ok ? 'allowed' : 'refused'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'D2 holds read* on F2. It may…', options: ['copy read on F2 into another domain\'s entry', 'make itself the owner of F2', 'remove read from every domain', 'switch to any domain'], answer: 0, why: 'The * is the copy flag for that right in that column.' },
      { q: 'A limited copy gives the receiver…', options: ['the right without the copy flag', 'the right and the flag', 'ownership', 'nothing'], answer: 0, why: 'The receiver can use it but not pass it on.' },
      { q: 'The owner right on an object lets its holder…', options: ['add and remove rights in that object\'s column', 'change any row', 'switch domains', 'delete other objects'], answer: 0, why: 'Owner governs a column; control governs a row.' },
      { q: 'Why are the domains also columns of the matrix?', options: ['so that switching and controlling domains are rights like any other', 'to make it square', 'for speed', 'they are not'], answer: 0, why: 'One mechanism then covers objects and domains alike.' },
    ],
  });

  // ---- four implementations ------------------------------------------------------------------------------------
  const IMPL = [
    { id: 'global', name: 'global table', make: (M) => Pr().toGlobal(M), check: (T, d, o, r) => Pr().checkGlobal(T, d, o, r) },
    { id: 'acl', name: 'access-control list', make: (M) => Pr().toACL(M), check: (T, d, o, r) => Pr().checkACL(T, d, o, r) },
    { id: 'caps', name: 'capability list', make: (M) => Pr().toCaps(M), check: (T, d, o, r) => Pr().checkCaps(T, d, o, r) },
    { id: 'lockkey', name: 'lock and key', make: (M) => Pr().toLockKey(M), check: (T, d, o, r) => Pr().checkLockKey(T, d, o, r) },
  ];
  const doms = ['D1', 'D2', 'D3'], objs = ['F1', 'F2', 'printer'];
  S.topic({
    id: 'prot-matrix-impl', family: 'p17-matrix', order: 30, title: 'Storing the matrix: lists, capabilities, keys',
    blurb: 'The matrix is mostly empty, so nobody stores it whole. A global table keeps only the non-empty entries as (domain, object, rights) triples and must be searched. An access-control list keeps each column with its object: checking means reading that object\'s list. A capability list keeps each row with its domain: the domain presents the capability, and the system only checks it is genuine. Lock and key gives each object locks and each domain keys. The same question goes to all four.',
    inputs: [
      { id: 'd', kind: 'choice', label: 'Domain', def: 'D3', options: doms.map((v) => ({ value: v, label: v })) },
      { id: 'o', kind: 'choice', label: 'Object', def: 'F1', options: objs.map((v) => ({ value: v, label: v })) },
      { id: 'r', kind: 'choice', label: 'Right', def: 'read', options: ['read', 'write', 'execute', 'print'].map((v) => ({ value: v, label: v })) },
    ],
    presets: [
      { label: 'May D3 read F1?', values: { d: 'D3', o: 'F1', r: 'read' } },
      { label: 'May D2 write F1?', values: { d: 'D2', o: 'F1', r: 'write' } },
      { label: 'May D2 print?', values: { d: 'D2', o: 'printer', r: 'print' } },
      { label: 'May D1 execute F2?', values: { d: 'D1', o: 'F2', r: 'execute' } },
    ],
    counters: [{ id: 'scanned', label: 'entries scanned' }],
    run(inp) {
      const M = Pr().preset(), F = new S.Frames(['scanned']), d = inp.d, o = inp.o, r = inp.r;
      const res = IMPL.map((im) => { const T = im.make(M); return { im, T, out: im.check(T, d, o, r) }; });
      const PW = 380, PH = 274;
      const panel = (k, cur) => {
        const lit = cur === k, { im, T, out } = res[k], x = (k % 2) * (PW + 30), y = 40 + Math.floor(k / 2) * (PH + 20), items = [];
        items.push({ key: 'pn' + k, kind: 'region', x, y, w: PW, h: PH, rx: 8, cls: lit ? 'act' : 'panel' });
        items.push(H.title('pt' + k, x + 14, y + 24, im.name));
        let rows;
        if (im.id === 'global') rows = T.map((t) => t.domain + ', ' + t.object + ', {' + t.rights.join(' ') + '}');
        else if (im.id === 'acl') rows = (T[o] || []).map((e) => e.domain + ': ' + e.rights.join(' '));
        else if (im.id === 'caps') rows = (T[d] || []).map((c) => c.object + ': ' + c.rights.join(' '));
        else rows = ['keys of ' + d + ': ' + T.keys[d].join(' '), r + ' locks on ' + o + ': ' + (((T.locks[o] || {})[r]) || []).join(' ')];
        const head = im.id === 'acl' ? 'the list kept with ' + o : im.id === 'caps' ? 'the capabilities ' + d + ' holds' : im.id === 'global' ? 'every non-empty entry' : '';
        if (head) items.push(H.text('ph' + k, x + 14, y + 48, head, '', 13));
        const max = 8;
        rows.slice(0, max).forEach((t, j) => {
          const hit = lit && j < out.scanned && im.id !== 'lockkey', found = hit && j === out.scanned - 1 && (im.id === 'global' ? t.startsWith(d + ', ' + o + ',') : im.id === 'acl' ? t.startsWith(d + ':') : t.startsWith(o + ':'));
          items.push({ key: 'pr' + k + '_' + j, kind: 'cell', x: x + 14, y: y + (head ? 60 : 44) + j * 22, w: PW - 28, h: 20, rx: 3, text: t, size: 13, align: 'left', cls: 'implrow mono ' + (found ? (out.ok ? 'good' : 'hot') : hit ? 'act' : '') });
        });
        if (k <= cur) items.push(H.text('pv' + k, x + 14, y + PH - 14, (out.ok ? 'allowed' : 'denied') + ' · ' + (im.id === 'lockkey' ? out.scanned + ' lock' + (out.scanned === 1 ? '' : 's') + ' tried' : out.scanned + ' scanned'), out.ok ? 'good' : 'hot', 14));
        return items;
      };
      const all = (lit) => [H.title('tt', 0, 10, 'may ' + d + ' ' + r + ' ' + o + '?'), ...[0, 1, 2, 3].flatMap((k) => panel(k, lit))];
      F.add({ items: all(-1), say: `The question: may ${d} ${r} ${o}? The matrix holds ${H.plural(res[0].T.length, 'non-empty entry', 'non-empty entries')} among ${M.domains.length * Pr().columns(M).length} places.`, meta: { phase: 'start', entries: res[0].T.length, places: M.domains.length * Pr().columns(M).length } });
      res.forEach((x, k) => {
        F.count('scanned', x.out.scanned);
        F.add({ items: all(k), say: H.plain(x.out.say) + ({ global: ' The whole table may have to be searched, and it is too big to keep in fast memory.', acl: ' Only this object\'s list is read; the list sits with the object, so its owner can see who has access.', caps: ' The check is quick, since the domain holds the capability itself; it must not be able to forge one, so capabilities live where only the kernel can write them.', lockkey: ' Keys and locks can be changed independently, which makes revocation easy.' }[x.im.id]), meta: { phase: 'impl', impl: x.im.id, ok: x.out.ok, scanned: x.out.scanned, sizes: [res[0].T.length, (res[1].T[o] || []).length, (res[2].T[d] || []).length] }, title: x.im.name });
      });
      F.last().hold = 2500;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Four ways to store the matrix', text: ['global table: (domain, object, rights) triples', 'access list: a column, kept with the object', 'capability list: a row, kept with the domain', 'lock and key: locks on objects, keys in domains', 'every one gives the same answer'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Will the answer be allowed or denied?', options: ['allowed', 'denied'], answer: (fr) => (fr[1].meta.ok ? 'allowed' : 'denied'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'An access-control list is…', options: ['a column of the matrix, kept with the object', 'a row, kept with the domain', 'the whole matrix', 'a list of passwords'], answer: 0, why: 'It names who may do what to that object.' },
      { q: 'A capability list is…', options: ['a row of the matrix, kept with the domain', 'a column, kept with the object', 'a list of users', 'a lock'], answer: 0, why: 'It is what the domain can do, object by object.' },
      { q: 'Why must capabilities be protected from the process that holds them?', options: ['a process that could edit one could forge any right', 'they are large', 'they slow the CPU', 'they hold passwords'], answer: 0, why: 'Possession is the right; so possession must be controlled by the kernel or by hardware tags.' },
      { q: 'Which answers "who can read this file?" most easily?', options: ['the access-control list', 'capability lists', 'lock and key', 'none of them'], answer: 0, why: 'It is the file\'s own list; with capabilities one would search every domain.' },
    ],
  });

  // ---- revocation ----------------------------------------------------------------------------------------------
  S.topic({
    id: 'prot-revocation', family: 'p17-matrix', order: 40, title: 'Taking rights away',
    blurb: 'A right granted may have to be taken back: from one domain or from all, at once or later, in part or in full. With access lists it is easy: edit the object\'s list. With capabilities it is hard, because the copies are spread over every domain; real systems add back-pointers, an indirection table, or keys that can be changed. The cost of each, counted on one matrix, and what each form can do.',
    inputs: [
      { id: 'o', kind: 'choice', label: 'Object', def: 'F1', options: objs.map((v) => ({ value: v, label: v })) },
      { id: 'r', kind: 'choice', label: 'Right', def: 'read', options: ['read', 'write', 'print', 'execute'].map((v) => ({ value: v, label: v })) },
      { id: 'from', kind: 'choice', label: 'From', def: 'all', options: [{ value: 'all', label: 'every domain' }].concat(doms.map((v) => ({ value: v, label: v }))) },
    ],
    presets: [
      { label: 'Read on F1, from everyone', values: { o: 'F1', r: 'read', from: 'all' } },
      { label: 'Read on F1, from D3 only', values: { o: 'F1', r: 'read', from: 'D3' } },
      { label: 'Print, from everyone', values: { o: 'printer', r: 'print', from: 'all' } },
    ],
    counters: [{ id: 'cost', label: 'entries touched' }],
    run(inp) {
      const M = Pr().preset(), F = new S.Frames(['cost']), forms = [['acl', 'access-control list'], ['global', 'global table'], ['caps', 'capability lists'], ['lockkey', 'lock and key']];
      const R = forms.map(([f, name]) => ({ f, name, r: Pr().revoke(M, f, { obj: inp.o, right: inp.r, from: inp.from }) }));
      const after = R[0].r.M, targets = R[0].r.targets;
      const bars = (upto) => {
        const items = [H.title('bt', 470, 6, 'entries each form must touch')], max = Math.max(1, ...R.map((x) => x.r.cost));
        R.slice(0, upto).forEach((x, k) => {
          const y = 40 + k * 44, w = Math.round((x.r.cost / max) * 200);
          items.push(H.text('bn' + k, 470, y + 20, x.name, 'strong', 14));
          items.push({ key: 'bb' + k, kind: 'cell', x: 620, y: y + 4, w: Math.max(4, w), h: 24, rx: 3, text: '', cls: 'bar ' + (k === upto - 1 ? '' : 'soft') });
          items.push(H.text('bv' + k, 620 + Math.max(4, w) + 8, y + 22, String(x.r.cost), 'mono', 14));
        });
        return items;
      };
      const tbl = () => {
        const rows = Pr().REVOCATION;
        return [H.title('rt', 0, 300, 'what each form can do')].concat(S.Kit.gantt.table({ prefix: 'rv', x: 0, y: 312, rowH: 28, size: 13, cols: [{ w: 230, label: 'form' }, { w: 90, label: 'at once' }, { w: 90, label: 'selective' }, { w: 80, label: 'partial' }, { w: 96, label: 'temporary' }], rows: rows.map((x) => ({ cells: [x.form, ...['immediate', 'selective', 'partial', 'temporary'].map((k) => ({ text: x[k] ? 'yes' : 'no', cls: x[k] ? 'good' : 'hot' }))] })) }).items);
      };
      const mat = (Mx, hit) => [H.title('mt', 0, 6, 'column ' + inp.o), ...P17.matrix(Mx, { x: 0, y: 60, cols: [inp.o], cls: (d, o) => (hit && hit.includes(d) ? 'changed' : '') }).items];
      F.add({ items: [...mat(M), ...bars(0)], say: targets.length ? `Take ${inp.r} on ${inp.o} away from ${H.list(targets)}.` : `No domain holds ${inp.r} on ${inp.o}, so there is nothing to take; each form still has to look.`, meta: { phase: 'start', n: targets.length } });
      R.forEach((x, k) => { F.set('cost', x.r.cost); F.add({ items: [...mat(after, targets), ...bars(k + 1)], say: H.plain(x.r.steps[0].say), meta: { phase: 'form', form: x.f, cost: x.r.cost }, title: x.name }); });
      F.add({ items: [...mat(after, targets), ...bars(4), ...tbl()], say: 'Access lists revoke at once and selectively, by editing one list. Capabilities need extra machinery to do the same: re-acquisition is slow, back-pointers are costly, and indirection or a new key takes the right from everyone at once.', meta: { phase: 'table' }, title: 'compare', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Questions about revocation', text: ['immediate or delayed?', 'selective (some domains) or general (all)?', 'partial (some rights) or total?', 'temporary or permanent?'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which form will have to touch the most entries?', options: ['access-control list', 'global table', 'capability lists', 'lock and key'], answer: (fr) => { const fs = fr.filter((f) => f.meta.phase === 'form'), max = Math.max(...fs.map((f) => f.meta.cost)); return fs.filter((f) => f.meta.cost === max).map((f) => ({ acl: 'access-control list', global: 'global table', caps: 'capability lists', lockkey: 'lock and key' }[f.meta.form])); }, explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Revoking a right with access-control lists means…', options: ['editing the object\'s list', 'searching every domain', 'changing the hardware', 'rebooting'], answer: 0, why: 'The column is stored in one place.' },
      { q: 'Capabilities make revocation hard because…', options: ['copies are scattered over many domains', 'they are encrypted', 'they are too small', 'they cannot be deleted'], answer: 0, why: 'One must find every copy, or make the old ones stop working.' },
      { q: 'Capabilities through an indirection table can be revoked by…', options: ['deleting the table entry they point to', 'asking each domain politely', 'editing the access list', 'changing the user\'s password'], answer: 0, why: 'Every capability for it now points nowhere: at once, but for everyone.' },
      { q: 'A change of an object\'s master key revokes…', options: ['every capability made with the old key at once', 'one domain\'s right only', 'nothing', 'only read rights'], answer: 0, why: 'It is immediate but not selective.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
