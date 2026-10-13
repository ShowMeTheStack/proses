// Part 17, protection and security: the exercises of chapter 1 (least privilege, mechanism and policy, domains and
// rings, the access matrix, its implementations and revocation). Every answer is worked out here by the engines
// (S.Prot): nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, P = S.Prot;
  if (!C || !P || C.exercises.has('prt-x-excess')) return;
  const CH = 'prt-principles';
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const yn = (b) => (b ? 'yes' : 'no');

  // =========================================================================================================
  // Least privilege
  // =========================================================================================================
  // our own scenario: a print shop's spooler and its mailer
  const LP = {
    grants: [
      { subject: 'spooler', object: 'jobs', rights: ['read', 'write'] },
      { subject: 'spooler', object: 'printer', rights: ['write'] },
      { subject: 'spooler', object: 'config', rights: ['read', 'write'] },
      { subject: 'mailer', object: 'jobs', rights: ['read', 'write'] },
      { subject: 'mailer', object: 'outbox', rights: ['write'] },
      { subject: 'mailer', object: 'keys', rights: ['read'] },
    ],
    needs: [
      { subject: 'spooler', object: 'jobs', rights: ['read', 'write'] },
      { subject: 'spooler', object: 'printer', rights: ['write'] },
      { subject: 'spooler', object: 'config', rights: ['read'] },
      { subject: 'mailer', object: 'jobs', rights: ['read'] },
      { subject: 'mailer', object: 'outbox', rights: ['write'] },
    ],
  };
  const lp = P.leastPrivilege(LP);
  const granted = LP.grants.reduce((n, g) => n + g.rights.length, 0);
  const lpText = 'A print shop runs two services. The **spooler** is granted read and write on `jobs`, write on `printer`, and read and write on `config`. The **mailer** is granted read and write on `jobs`, write on `outbox`, and read on `keys`. Their work needs: the spooler reads and writes `jobs`, writes `printer` and reads `config`; the mailer reads `jobs` and writes `outbox`.';
  const exList = lp.excess.map((e) => e.subject + ' ' + e.right + ' on ' + e.object);
  C.exercise({ id: 'prt-x-excess', chapter: CH, title: 'Rights nobody needs', level: 1, kind: 'number',
    text: [lpText, 'How many of the granted rights should be removed to reach least privilege?'],
    answer: lp.excess.length, whyNot: { [String(granted)]: 'That is every granted right. Remove only those no task needs.', [String(granted - lp.excess.length)]: 'That is how many rights are needed, the ones to keep.', '*': 'Go through the grants one right at a time and strike each one no task needs.' },
    hints: ['Count the granted rights first: ' + granted + ' of them.', 'A right is excess when no need of the same service names the same object and right.', 'Excess: ' + list(exList) + '. ' + lp.steps[lp.steps.length - 1].say],
    solution: lp.excess.length, wrong: [granted, granted - lp.excess.length] });

  const share = Math.round(lp.score * 1000) / 1000;
  C.exercise({ id: 'prt-x-share', chapter: CH, title: 'How tight are the grants?', level: 2, kind: 'number',
    text: [lpText, 'What share of the granted rights is actually needed? Give a decimal to three places (1 means every grant is needed).'],
    answer: share, tolerance: 0.005,
    whyNot: { [String(Math.round((lp.excess.length / granted) * 1000) / 1000)]: 'That is the share of excess rights, the ones to remove.', '*': 'Divide the rights both granted and needed by all the rights granted.' },
    hints: ['The share is (granted and needed) / (granted).', granted + ' rights are granted; ' + lp.excess.length + ' of them are excess.', (granted - lp.excess.length) + ' / ' + granted + ' = ' + share + '. The aim is 1: every right granted is used.'],
    solution: share, wrong: [Math.round((lp.excess.length / granted) * 1000) / 1000, 1] });

  // =========================================================================================================
  // Mechanism and policy
  // =========================================================================================================
  C.exercise({ id: 'prt-x-policy', chapter: CH, title: 'Mechanism or policy?', level: 1, kind: 'choice',
    text: ['A school\'s file server checks every access with one routine: look up the (user, file) entry and allow the access if it holds the right. On exam day the head of department wants students barred from the notes folder. Which change does that, the way a well-designed system expects?'],
    options: ['Edit the table of rights for exam day; the checking routine stays as it is', 'Add an `if (exam_day)` test inside the checking routine', 'Write a second checking routine used only on exam day', 'Turn off access checks for teachers so they can still work'],
    answer: 0, whyNot: { 1: 'That writes a policy into the mechanism: every new rule would need new code, tested and shipped again.', 2: 'Two mechanisms double what must be trusted; the old one already enforces any table it is given.', 3: 'Switching checks off is never the way to change who may do what.' },
    hints: ['The mechanism is how a rule is enforced; the policy is which rules hold.', 'A good mechanism enforces any policy it is handed, so changing the rules should not change code.', 'Edit the data: the exam-day table denies students read on the notes, and the same routine enforces it.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Domains and rings
  // =========================================================================================================
  C.exercise({ id: 'prt-x-gate', chapter: CH, title: 'Why a gate?', level: 1, kind: 'choice',
    text: ['A process in the user ring holds a switch right into the kernel domain. Entering the kernel is only possible through a fixed gate (a trap with a set entry point). What does the gate protect against?'],
    options: ['The caller choosing where in the kernel to start running, skipping its checks', 'The kernel running too slowly', 'The user process losing its own files', 'Two processes entering the kernel at once'],
    answer: 0, whyNot: { 1: 'Gates cost a little time; they are there for safety, not speed.', 2: 'The process keeps its own files; the gate is about the kernel\'s code.', 3: 'Many processes may be in the kernel at once; locks, not gates, keep them apart.' },
    hints: ['The switch right says the process may enter the kernel domain. It does not say where.', 'If the caller could jump to any kernel address, it could start after the code that checks its arguments.', 'The gate fixes the entry point: the kernel starts where its own checks run first.'],
    solution: 0, wrong: [1, 3] });

  // our own rings: an app, a driver ring, the kernel
  const RM = P.matrix({ domains: ['app', 'driver', 'kernel'], objects: ['screen', 'nic', 'pagetable'],
    cells: { 'app|screen': ['write'], 'app|driver': ['switch'], 'driver|screen': ['read', 'write'], 'driver|nic': ['read', 'write'], 'driver|kernel': ['switch'], 'driver|app': ['switch'], 'kernel|screen': ['read', 'write'], 'kernel|nic': ['read', 'write'], 'kernel|pagetable': ['read', 'write'], 'kernel|driver': ['switch'] } });
  const RQ = [['app', 'screen', 'write'], ['app', 'nic', 'read'], ['driver', 'nic', 'write'], ['driver', 'pagetable', 'read'], ['app', 'kernel', 'switch'], ['driver', 'kernel', 'switch']];
  const rRows = RQ.map(([d, o, r]) => d + ': ' + r + ' ' + o);
  const rCells = Object.fromEntries(RQ.map(([d, o, r], i) => [rRows[i] + '|allowed?', yn(P.has(RM, d, o, r))]));
  const rSay = RQ.map(([d, o, r]) => P.check(RM, d, o, r).say);
  const rFlip = Object.assign({}, rCells, { [rRows[1] + '|allowed?']: 'yes' }), rFlip2 = Object.assign({}, rCells, { [rRows[4] + '|allowed?']: 'yes' });
  C.exercise({ id: 'prt-x-rings', chapter: CH, title: 'Three rings in a matrix', level: 2, kind: 'table',
    text: ['A small machine has three domains, from the outside in: `app`, `driver` and `kernel`. The matrix holds:',
      { table: [['', 'screen', 'nic', 'pagetable', 'app', 'driver', 'kernel'], ['app', 'write', '', '', '', 'switch', ''], ['driver', 'read, write', 'read, write', '', 'switch', '', 'switch'], ['kernel', 'read, write', 'read, write', 'read, write', '', 'switch', '']], caption: 'Rows are domains; the last three columns are the domains themselves, holding the switch rights.' },
      'For each attempt, write yes if the matrix allows it and no if it does not.'],
    rows: rRows, cols: ['allowed?'], cells: rCells, cellKind: 'text',
    hints: ['Find the entry (domain, object): the access is allowed only if that entry holds the right.', 'A switch is a right like any other, in the column of the domain being entered.', rSay.join(' ')],
    solution: rCells, wrong: [rFlip, rFlip2] });

  // =========================================================================================================
  // The access matrix and its operations
  // =========================================================================================================
  C.exercise({ id: 'prt-x-copy-flag', chapter: CH, title: 'The copy flag', level: 2, kind: 'choice',
    text: ['D2 holds `read*` on a file (read, with the copy flag). It gives D3 the right by a *limited* copy. Later D3 tries to copy read on to D4. What happens?'],
    options: ['Refused: D3 holds read without the copy flag, so it may use the right but not pass it on', 'Allowed: D3 holds read, so it may copy it', 'Allowed, but D3 loses read itself', 'Refused: only the owner of a file may ever add rights'],
    answer: 0, whyNot: { 1: 'Holding a right and holding it with the copy flag are different: copying needs the *.', 2: 'That is a transfer, and a transfer also needs the copy flag.', 3: 'The owner may add rights, but so may a holder of right*: that is what the flag is for.' },
    hints: ['A limited copy gives the right without the *.', 'Copying, limited copying and transferring all need right* in the giver\'s own entry.', P.apply(P.matrix({ domains: ['D3', 'D4'], objects: ['F'], cells: { 'D3|F': ['read'] } }), { op: 'copy', by: 'D3', to: 'D4', obj: 'F', right: 'read' }).say],
    solution: 0, wrong: [1, 2] });

  // the matrix-ops topic's own starting matrix, and our own sequence of operations
  const M0 = P.preset();
  const OPS = [{ op: 'copy', by: 'D1', to: 'D2', obj: 'F1', right: 'write' }, { op: 'limited-copy', by: 'D2', to: 'D3', obj: 'F1', right: 'write' }, { op: 'copy', by: 'D3', to: 'D1', obj: 'F2', right: 'read' }, { op: 'transfer', by: 'D2', to: 'D3', obj: 'F2', right: 'read' }];
  let MX = M0;
  const opSay = [];
  for (const a of OPS) { const r = P.apply(MX, a); opSay.push(r.say); MX = r.M; }
  const AQ = [['D2', 'F1'], ['D3', 'F1'], ['D2', 'F2'], ['D3', 'F2']];
  const aRows = ['D2', 'D3'], aCols = ['F1', 'F2'];
  const aCells = Object.fromEntries(AQ.map(([d, o]) => [d + '|' + o, P.rights(MX, d, o).join(', ')]));
  const fmt = (M, d, o) => (P.rights(M, d, o).join(', ') || 'nothing');
  const opText = ['D1 copies write on F1 to D2', 'D2 makes a limited copy of write on F1 to D3', 'D3 copies read on F2 to D1', 'D2 transfers read on F2 to D3'];
  const aWrong1 = Object.assign({}, aCells, { 'D3|F1': 'write*' }), aWrong2 = Object.assign({}, aCells, { 'D2|F2': P.rights(M0, 'D2', 'F2').join(', ') });
  C.exercise({ id: 'prt-x-after-ops', chapter: CH, title: 'Four operations on a matrix', level: 3, kind: 'table',
    text: ['The matrix starts as in [the access-matrix topic](#topic=prot-matrix-ops): (D1, F1) holds ' + fmt(M0, 'D1', 'F1') + '; (D1, F2) ' + fmt(M0, 'D1', 'F2') + '; (D2, F2) ' + fmt(M0, 'D2', 'F2') + '; (D3, F1) ' + fmt(M0, 'D3', 'F1') + '; and (D2, F1) and (D3, F2) are empty. A * marks the copy flag.',
      'Then, in order: ' + opText.map((t, i) => (i + 1) + '. ' + t).join('; ') + '. An operation that is not allowed changes nothing.',
      'Fill in the four entries afterwards, as lists like `read, write*` (leave a cell empty for an empty entry).'],
    rows: aRows, cols: aCols, cells: aCells, cellKind: 'set',
    hints: ['A copy keeps the * on the new right; a limited copy drops it; a transfer moves right* and the giver loses it. All three need right* in the giver\'s entry.', 'Check the third step carefully: does D3 hold read* on F2 at that moment?', opSay.join(' ')],
    solution: aCells, wrong: [aWrong1, aWrong2] });

  // =========================================================================================================
  // Implementations: lists, capabilities, keys
  // =========================================================================================================
  // our own clinic
  const CM = P.matrix({ domains: ['nurse', 'doctor', 'billing', 'audit'], objects: ['chart', 'rx', 'invoice'],
    cells: { 'nurse|chart': ['read', 'write'], 'doctor|chart': ['read', 'write'], 'doctor|rx': ['read', 'write'], 'nurse|rx': ['read'], 'billing|invoice': ['read', 'write'], 'audit|chart': ['read'], 'audit|invoice': ['read'], 'billing|rx': ['read'] } });
  const clinicTable = { table: [['', 'chart', 'rx', 'invoice'], ['nurse', 'read, write', 'read', ''], ['doctor', 'read, write', 'read, write', ''], ['billing', '', 'read', 'read, write'], ['audit', 'read', '', 'read']], caption: 'The clinic\'s access matrix.' };
  const acl = P.toACL(CM), chartDoms = acl.chart.map((e) => e.domain);
  C.exercise({ id: 'prt-x-acl-list', chapter: CH, title: 'One column, one list', level: 1, kind: 'set',
    text: ['A clinic\'s records system has four domains and three objects:', clinicTable, 'Stored as access-control lists, which domains does the list attached to `chart` name? Answer as a set, like {nurse, audit}.'],
    answer: '{' + chartDoms.join(', ') + '}',
    hints: ['An access-control list is one column of the matrix, kept with its object.', 'Read down the chart column and keep the domains whose entry is not empty.', 'chart\'s list: ' + acl.chart.map((e) => e.domain + ' {' + e.rights.join(', ') + '}').join(', ') + '.'],
    solution: '{' + chartDoms.join(', ') + '}', wrong: ['{nurse, doctor}', '{nurse, doctor, billing, audit}'], whyNot: 'Read the chart column: every domain with a non-empty entry is on the list, and no other.' });

  const G = P.toGlobal(CM), CAPS = P.toCaps(CM);
  const SQ = [['audit', 'invoice', 'read'], ['billing', 'rx', 'write'], ['nurse', 'chart', 'write']];
  const sRows = SQ.map(([d, o, r]) => d + ' ' + r + ' ' + o + '?');
  const sCells = {};
  const sSay = [];
  SQ.forEach(([d, o, r], i) => { const g = P.checkGlobal(G, d, o, r), a = P.checkACL(acl, d, o, r); sCells[sRows[i] + '|global table'] = g.scanned; sCells[sRows[i] + '|ACL'] = a.scanned; sSay.push(g.say + ' ' + a.say); });
  const sWrong = Object.assign({}, sCells, { [sRows[0] + '|global table']: G.length }), sWrong2 = Object.assign({}, sCells, { [sRows[1] + '|ACL']: 0 });
  C.exercise({ id: 'prt-x-scan', chapter: CH, title: 'Entries read for one check', level: 2, kind: 'table',
    text: ['The same clinic matrix, stored two ways. The **global table** keeps the triples in this order: ' + G.map((t) => '(' + t.domain + ', ' + t.object + ', {' + t.rights.join(', ') + '})').join(', ') + '. Each object\'s **access list** keeps its entries in the same order, so chart\'s list is ' + list(acl.chart.map((e) => e.domain)) + '.',
      'A check reads entries from the start until it finds the domain (or reaches the end). How many entries does each check read in each form?'],
    rows: sRows, cols: ['global table', 'ACL'], cells: sCells, cellKind: 'number',
    hints: ['The global table is one long list for every object: the search may pass many unrelated triples.', 'An ACL check reads only the object\'s own list. If the domain is not on it, every entry of that list is read before the answer is no.', sSay.join(' ')],
    solution: sCells, wrong: [sWrong, sWrong2] });

  // =========================================================================================================
  // Revocation
  // =========================================================================================================
  const RV = { obj: 'chart', right: 'read', from: 'all' };
  const forms = [['acl', 'access lists'], ['global', 'global table'], ['caps', 'capability lists'], ['lockkey', 'lock and key']];
  const vCells = {}, vSay = [];
  for (const [f, label] of forms) { const r = P.revoke(CM, f, RV); vCells[label + '|entries touched or searched'] = r.cost; vSay.push(r.steps[0].say); }
  const capTotal = CM.domains.reduce((n, d) => n + CAPS[d].length, 0);
  C.exercise({ id: 'prt-x-revoke-cost', chapter: CH, title: 'Taking read on the chart away', level: 2, kind: 'table',
    text: ['The clinic decides that nobody may read `chart` any more until the records are checked. In the clinic matrix:', clinicTable,
      'How many entries must each form search or change to take read on chart from every domain? For lock and key, each domain has one key, and each right on an object has one lock per domain that holds it.'],
    rows: forms.map((f) => f[1]), cols: ['entries touched or searched'], cells: vCells, cellKind: 'number',
    hints: ['Access lists: only chart\'s own list. Global table: every triple. Capabilities: they are spread over every domain\'s list.', 'With no back-pointers, finding every capability for chart means searching all ' + capTotal + ' capabilities. With lock and key, only chart\'s read locks change.', vSay.join(' ')],
    solution: vCells, wrong: [Object.assign({}, vCells, { 'capability lists|entries touched or searched': CAPS.audit.length }), Object.assign({}, vCells, { 'access lists|entries touched or searched': G.length })] });

  C.exercise({ id: 'prt-x-revoke-pick', chapter: CH, title: 'Revoke one domain, at once', level: 2, kind: 'choice',
    text: ['An auditor\'s account must lose read on the invoices immediately, while billing keeps its rights. Which way of storing the rights makes this a single, quick edit with no extra machinery?'],
    options: ['Access-control lists: strike audit from invoice\'s list', 'Capabilities with indirection: delete the table entry they point through', 'Capabilities with a master key: change the key', 'Capabilities by re-acquisition: delete them all now and then'],
    answer: 0, whyNot: { 1: 'Every capability for the invoices points through the same entry, so deleting it takes read from billing too: not selective.', 2: 'A new master key makes every old capability stop matching, billing\'s included.', 3: 'Re-acquisition is not immediate: audit keeps its right until the next sweep.' },
    hints: ['Two things are asked: immediate, and selective (one domain, not everyone).', 'Look at the comparison in [the revocation topic](#topic=prot-revocation): which forms are both?', 'An access list is the object\'s own column, so striking one entry is immediate and touches only audit.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
