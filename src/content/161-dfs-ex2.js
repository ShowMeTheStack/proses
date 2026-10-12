// Part 16, distributed file systems: the exercises of chapter 2 (cached attributes, flush on close, close-to-open and
// lost updates) and chapter 3 (callback promises, a server crash, and the cost of each design). Every number in a
// text, an answer or a hint is worked out here by the timeline engine (S.DFS.run): nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, D = S.DFS;
  if (!C || !D || C.exercises.has('dfs-x-stale-set')) return;
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const plural = (n, w, pl) => n + ' ' + (n === 1 ? w : pl || w + 's');
  const sc = (c, ops, file) => ops.map(([t, op, data]) => Object.assign({ t, c, op, file }, data !== undefined ? { data } : {}));
  /** the requests each of client c's operations sends, found by running the script one more op at a time */
  const perOp = (cfg, c) => {
    const mine = cfg.script.filter((s) => s.c === c), rest = cfg.script.filter((s) => s.c !== c);
    const sent = (k) => D.run(Object.assign({}, cfg, { script: rest.concat(mine.slice(0, k)) })).messages.filter((m) => m.from === c).map((m) => m.kind);
    return mine.map((_, i) => { const a = sent(i), b = sent(i + 1); return b.slice(a.length); });
  };
  /** client c's reads in order, each with the time it was asked for */
  const readsOf = (cfg, r, c) => { const asked = cfg.script.filter((s) => s.c === c && s.op === 'read').map((s) => s.t); return r.reads.filter((x) => x.c === c).map((x, i) => Object.assign({ asked: asked[i] }, x)); };
  const arrival = (r, kind, from) => r.messages.find((m) => m.kind === kind && (!from || m.from === from));

  // =========================================================================================================
  // Chapter 2: cached attributes
  // =========================================================================================================
  const READS = [5, 9, 13, 17];
  const attrCfg = (to, bAt) => ({ protocol: 'nfs', clients: ['A', 'B'], files: { board: 'open' }, latency: 1, timeout: 4, attrTimeout: to,
    script: sc('A', [[0, 'open'], [0, 'read']].concat(READS.map((t) => [t, 'read'])), 'board').concat(sc('B', [[bAt, 'open'], [bAt, 'write', 'closed'], [bAt, 'close']], 'board')) });
  const attrText = (to, bAt, r) => `A file \`board\` says "open". Client A opens it at t = 0 and reads it (GETATTR, then READ: the data is in A's cache at t = 4). Client B opens the file at t = ${bAt}, writes "closed" and closes it: its WRITE reaches the server at t = ${arrival(r, 'WRITE', 'B').recv}. A then reads again at t = ${list(READS.map(String))}. A trusts its cached attributes for ${plural(to, 'tick')} after it last heard from the server; older attributes make it send GETATTR, and a new version makes it READ again. Each message takes 1 tick.`;

  const sa = attrCfg(6, 1), saR = D.run(sa), saReads = readsOf(sa, saR, 'A').slice(1), saStale = saReads.filter((x) => x.stale).map((x) => x.asked);
  C.exercise({ id: 'dfs-x-stale-set', chapter: 'dfs-cache', title: 'Which reads are stale?', level: 2, kind: 'set',
    text: [attrText(6, 1, saR), 'Which of A\'s later reads return "open" although the server already holds "closed"? Answer with their times as a set, like {5, 9}.'],
    answer: '{' + saStale.join(', ') + '}',
    whyNot: 'A read is stale when A answers it from its cache, with attributes younger than the timeout, after the server already holds the new version.',
    hints: ['A last heard from the server at t = 4, when the READ reply came in.', 'Each read asks: are my attributes younger than 6 ticks? If so, it answers from the cache without a message.', saReads.map((x) => `t = ${x.asked}: ${x.how === 'from the server' ? 'asks the server, "' + x.got + '" at t = ' + x.t : x.stale ? 'cached, "' + x.got + '", stale' : 'cached, "' + x.got + '"'}`).join('; ') + `. Stale: {${saStale.join(', ')}}.`],
    solution: '{' + saStale.join(', ') + '}', wrong: ['{' + saStale.slice(0, 1).join(', ') + '}', '{' + READS.join(', ') + '}'] });

  const at = attrCfg(7, 5), atR = D.run(at), atReads = readsOf(at, atR, 'A').slice(1), atReq = perOp(at, 'A').slice(2);
  const atRows = READS.map((t) => 'read at ' + t), atCells = {};
  atReads.forEach((x, i) => { atCells[atRows[i] + '|messages'] = String(2 * atReq[i].length); atCells[atRows[i] + '|A reads'] = x.got; atCells[atRows[i] + '|stale?'] = x.stale ? 'yes' : 'no'; });
  const atW1 = Object.assign({}, atCells, { [atRows[1] + '|stale?']: 'no' }), atW2 = Object.assign({}, atCells, { [atRows[2] + '|messages']: '2' });
  C.exercise({ id: 'dfs-x-attr-table', chapter: 'dfs-cache', title: 'Read by read', level: 2, kind: 'table',
    text: [attrText(7, 5, atR), 'For each of A\'s later reads, give the messages it costs (requests and replies), what A reads ("open" or "closed"), and whether that read is stale (yes or no).'],
    rows: atRows, cols: ['messages', 'A reads', 'stale?'], corner: 'A', cells: atCells, cellKind: 'text',
    hints: ['A\'s attributes date from t = 4, and they are trusted for 7 ticks.', `The server holds "closed" from t = ${arrival(atR, 'WRITE', 'B').recv}. A read answered from the cache after that is stale.`, atReads.map((x, i) => `t = ${x.asked}: ${atReq[i].length ? atReq[i].join(' and ') + ', ' : 'no message, '}"${x.got}"${x.stale ? ', stale' : ''}`).join('; ') + '.'],
    solution: atCells, wrong: [atW1, atW2] });

  const SWEEP = [0, 3, 6, 12], swCells = {};
  for (const to of SWEEP) { const r = D.run(attrCfg(to, 1)); swCells['timeout ' + to + '|messages'] = r.costs.messages; swCells['timeout ' + to + '|stale reads'] = r.reads.filter((x) => x.stale).length; }
  const swW = Object.assign({}, swCells, { 'timeout 0|stale reads': 1 }), swW2 = Object.assign({}, swCells, { 'timeout 12|messages': swCells['timeout 0|messages'] });
  C.exercise({ id: 'dfs-x-attr-sweep', chapter: 'dfs-cache', title: 'Fresher or cheaper', level: 2, kind: 'table',
    text: [attrText(6, 1, saR).replace('for 6 ticks', 'for a timeout of T ticks'), 'Run it with four timeouts. For each, give the number of messages in the whole run (both clients, requests and replies) and the number of A\'s reads that are stale.'],
    rows: SWEEP.map((t) => 'timeout ' + t), cols: ['messages', 'stale reads'], corner: 'T', cells: swCells,
    hints: ['B costs the same in every run: GETATTR at open and WRITE at close, 4 messages.', 'With timeout 0 every read sends GETATTR first; with a long timeout most reads are answered from the cache, and some of them stale.', SWEEP.map((t) => `T = ${t}: ${swCells['timeout ' + t + '|messages']} messages, ${swCells['timeout ' + t + '|stale reads']} stale`).join('; ') + '. Fewer messages, more stale reads.'],
    solution: swCells, wrong: [swW, swW2] });

  C.exercise({ id: 'dfs-x-attr-window', chapter: 'dfs-cache', title: 'How long a change can hide', level: 1, kind: 'choice',
    text: ['An NFS-style client caches attributes for 30 seconds. It last checked a file with the server at 10:00:00. Another client changes the file at 10:00:05. Up to when can this client go on reading the old data from its cache, if it does not reopen the file?'],
    options: ['Until 10:00:30, when its attributes are 30 seconds old', 'Until 10:00:35, 30 seconds after the change', 'Not at all: the server tells it about the change', 'For as long as it keeps the file open'],
    answer: 0, whyNot: { 1: 'The clock starts when this client last heard from the server, not when the change happened.', 2: 'An NFS-style server keeps no list of clients, so it tells no one.', 3: 'Once the attributes are older than the timeout, the next read asks the server again, open or not.' },
    hints: ['Who could tell the client that the file changed?', 'Nobody: the client finds out only when it asks, and it does not ask while its attributes are younger than the timeout.', 'Until 10:00:30. From then on, the next read sends GETATTR, sees the new version and fetches the new data.'],
    solution: 0, wrong: [1, 2] });

  // ---- flush on close and close-to-open ---------------------------------------------------------------------------
  const unf = { protocol: 'nfs', clients: ['A', 'B'], files: { plan: 'v1' }, latency: 1, timeout: 4, attrTimeout: 3, script: sc('B', [[0, 'open'], [0, 'write', 'v2'], [12, 'close']], 'plan').concat(sc('A', [[3, 'open'], [3, 'read']], 'plan')) };
  const unR = D.run(unf), unGot = unR.reads.find((x) => x.c === 'A').got, unOpts = ['"v1", the old contents', '"v2", B\'s change', 'an error: B has the file open for writing', 'nothing: the file is locked'];
  C.exercise({ id: 'dfs-x-unflushed', chapter: 'dfs-cache', title: 'A write not yet closed', level: 1, kind: 'choice',
    text: ['The file `plan` holds "v1". Client B opens it at t = 0 and writes "v2", but does not close it until t = 12. Client A opens the file at t = 3 and reads it. Both are NFS-style clients. What does A read?'],
    options: unOpts, answer: unGot === 'v1' ? 0 : 1,
    whyNot: { 1: 'B\'s write is still only in B\'s memory: it goes to the server at close.', 2: 'Nothing at the server knows that B has the file open; open is not a request that reserves anything.', 3: 'No locks are taken unless a program asks for them, through a separate locking service.' },
    hints: ['Where is B\'s "v2" at t = 3?', 'B\'s client keeps the write and sends it with WRITE at close, which is at t = 12.', `A reads "${unGot}": the server has had nothing from B. After B closes, A's next open would see "v2".`],
    solution: unGot === 'v1' ? 0 : 1, wrong: [unGot === 'v1' ? 1 : 0, 2] });

  const c2o = { protocol: 'nfs', clients: ['A', 'B'], files: { plan: 'v1' }, latency: 1, timeout: 4, attrTimeout: 5,
    script: sc('A', [[0, 'open'], [0, 'read'], [6, 'read'], [8, 'read'], [10, 'close'], [11, 'open'], [11, 'read']], 'plan').concat(sc('B', [[1, 'open'], [1, 'write', 'v2'], [4, 'close']], 'plan')) };
  const c2R = D.run(c2o), c2Reads = readsOf(c2o, c2R, 'A'), c2Rows = ['read at 0', 'read at 6', 'read at 8', 'read after reopening at 11'], c2Cells = {};
  c2Reads.forEach((x, i) => { c2Cells[c2Rows[i] + '|A reads'] = x.got; c2Cells[c2Rows[i] + '|stale?'] = x.stale ? 'yes' : 'no'; });
  const bWrite = arrival(c2R, 'WRITE', 'B');
  const c2W1 = Object.assign({}, c2Cells, { [c2Rows[2] + '|A reads']: 'v2', [c2Rows[2] + '|stale?']: 'no' }), c2W2 = Object.assign({}, c2Cells, { [c2Rows[3] + '|A reads']: 'v1' });
  C.exercise({ id: 'dfs-x-c2o-table', chapter: 'dfs-cache', title: 'Close, then open', level: 3, kind: 'table',
    text: ['NFS-style clients, 1 tick each way, attributes trusted for 5 ticks after the client last heard from the server. The file `plan` holds "v1".', { list: ['Client A opens `plan` at t = 0 and reads it, reads again at t = 6 and at t = 8, closes it at t = 10, opens it again at t = 11 and reads.', 'Client B opens `plan` at t = 1, writes "v2", and closes it at t = 4.'] }, 'Each operation starts at its time or when the one before it ends, whichever is later. For each of A\'s reads, what does it read, and is it stale?'],
    rows: c2Rows, cols: ['A reads', 'stale?'], corner: 'A', cells: c2Cells, cellKind: 'text',
    hints: [`B\'s write reaches the server only with the WRITE its close sends, at t = ${bWrite.recv}.`, 'A\'s reads in the open session trust the cache while its attributes are younger than 5 ticks; the reopen at t = 11 always asks the server.', c2Reads.map((x, i) => `${c2Rows[i]}: "${x.got}" ${x.how}${x.stale ? ', stale' : ''}`).join('; ') + '. Close-to-open promises only the last one.'],
    solution: c2Cells, wrong: [c2W1, c2W2] });

  // ---- lost updates ---------------------------------------------------------------------------------------------
  const lc = { protocol: 'nfs', clients: ['A', 'B'], files: { plan: 'v1' }, latency: 1, timeout: 4, attrTimeout: 3, script: sc('A', [[0, 'open'], [0, 'read'], [0, 'write', 'A: add a bench'], [9, 'close']], 'plan').concat(sc('B', [[2, 'open'], [2, 'read'], [2, 'write', 'B: move the gate'], [5, 'close']], 'plan')) };
  const lcR = D.run(lc), lcEnd = lcR.server.files.plan.data, lcOpts = ['"A: add a bench"', '"B: move the gate"', 'both changes, one after the other', 'an error at A\'s close'];
  const lcAns = lcEnd === 'A: add a bench' ? 0 : lcEnd === 'B: move the gate' ? 1 : 2;
  C.exercise({ id: 'dfs-x-last-close', chapter: 'dfs-cache', title: 'Who wins?', level: 2, kind: 'choice',
    text: ['NFS-style clients, the file `plan` holding "v1". Client A opens it at t = 0, reads it and writes "A: add a bench", and closes it at t = 9. Client B opens it at t = 2, reads it, writes "B: move the gate", and closes it at t = 5. Each write replaces the whole contents. What does the server hold at the end?'],
    options: lcOpts, answer: lcAns,
    whyNot: { [lcAns === 0 ? 1 : 0]: 'That was the first close; a later close replaced it.', 2: 'Each close sends the client\'s whole version; the server does not merge.', 3: 'Nothing checks that A saw the version it is replacing, so the WRITE succeeds.' },
    hints: ['When does each client\'s change reach the server?', 'Each change reaches the server at its close: B\'s at about t = 5, A\'s at about t = 9.', `The server holds ${lcOpts[lcAns]}. A opened first but closed last, so its WRITE replaced B's version, which A never saw: B's update is lost.`],
    solution: lcAns, wrong: [lcAns === 0 ? 1 : 0, 2] });

  C.exercise({ id: 'dfs-x-lost-fix', chapter: 'dfs-cache', title: 'Stopping the lost update', level: 2, kind: 'choice',
    text: ['Two NFS-style clients keep editing a shared to-do file, and from time to time one client\'s changes vanish. Which change prevents it?'],
    options: ['Take a lock on the file (from a lock service) for each edit, or have the server refuse a write based on an old version', 'Set the attribute timeout to 0', 'Close the file more often', 'Use a smaller block size'],
    answer: 0, whyNot: { 1: 'Fresher reads do not stop two clients from editing the same version at once.', 2: 'Closing sooner narrows the window, but two edits that overlap still both start from the same version.', 3: 'The lost update is a whole version replaced, whatever the block size.' },
    hints: ['The problem is two edits that both start from the same version.', 'Caching rules decide how soon a client sees a change; they do not order the writers.', 'Serialise the writers: a lock held from open to close, or a write that carries the version it was based on and is refused if the file has moved on.'],
    solution: 0, wrong: [1, 2] });

  const LCS = sc('A', [[0, 'open'], [0, 'read'], [0, 'write', 'A1'], [6, 'close'], [10, 'open'], [10, 'read'], [10, 'write', 'A2'], [10, 'close']], 'tally').concat(sc('B', [[1, 'open'], [1, 'read'], [1, 'write', 'B1'], [3, 'close'], [7, 'open'], [7, 'read'], [7, 'write', 'B2'], [16, 'close']], 'tally'));
  const lcn = { protocol: 'nfs', clients: ['A', 'B'], files: { tally: 'v1' }, latency: 1, timeout: 4, attrTimeout: 3, script: LCS };
  const lnR = D.run(lcn), lost = lnR.outcomes.filter((x) => x.kind === 'lost-update'), lnEnd = lnR.server.files.tally.data;
  const closes = lnR.messages.filter((m) => m.kind === 'WRITE').map((m) => `${m.from}'s at t = ${m.recv}`);
  C.exercise({ id: 'dfs-x-lost-count', chapter: 'dfs-cache', title: 'Count the lost updates', level: 3, kind: 'number',
    text: ['NFS-style clients, 1 tick each way, attributes trusted for 3 ticks. The file `tally` holds "v1". Each line is open, read, write the new contents, and close at the time given (an operation starts at its time or when the one before ends, whichever is later):', { list: ['A: opens at t = 0, writes "A1", closes at t = 6; opens again at t = 10, writes "A2", closes at once.', 'B: opens at t = 1, writes "B1", closes at t = 3; opens again at t = 7, writes "B2", closes at t = 16.'] }, 'A write loses an update when it replaces a version its writer never read. How many updates are lost?'],
    answer: lost.length,
    whyNot: { '0': 'Look at A\'s first close: B\'s "B1" reached the server in between.', '1': 'There is a second overlap: B\'s second session started before A\'s second write.', '*': 'For each close, ask which version its writer read at open, and which version the server holds when the WRITE arrives.' },
    hints: ['Write down each client\'s sessions as intervals from open to close.', `The WRITEs reach the server in this order: ${list(closes)}.`, lost.map((x) => x.say).join(' ') + ` ${plural(lost.length, 'update')} lost; the server ends with "${lnEnd}".`],
    solution: lost.length, wrong: [0, 1] });

  // =========================================================================================================
  // Chapter 3: callback promises
  // =========================================================================================================
  const orc = (t) => [[t, 'open'], [t, 'read'], [t, 'close']];
  const ph = { protocol: 'afs', clients: ['A', 'B'], files: { menu: 'leek soup' }, latency: 1, timeout: 6, script: sc('A', [0, 3, 6, 9, 12].flatMap(orc), 'menu').concat(sc('B', [[4, 'open'], [4, 'write', 'fennel soup'], [4, 'close']], 'menu')) };
  const phOpens = perOp(ph, 'A').map((ks, i) => ({ t: ph.script.filter((x) => x.c === 'A')[i].t, op: ph.script.filter((x) => x.c === 'A')[i].op, fetch: ks.includes('FETCH') })).filter((o) => o.op === 'open');
  const phR = D.run(ph), phHits = phR.events.filter((e) => e.kind === 'cb-hit' && e.c === 'A');
  C.exercise({ id: 'dfs-x-promise-opens', chapter: 'dfs-afs', title: 'Opens that cost nothing', level: 1, kind: 'number',
    text: ['AFS-style clients, 1 tick each way. Client A opens the file `menu`, reads it and closes it at t = 0, 3, 6, 9 and 12. Client B opens it at t = 4, writes "fennel soup" and closes it, which stores it and makes the server break A\'s promise. How many of A\'s five opens send no message at all?'],
    answer: phHits.length,
    whyNot: { '4': 'One of A\'s later opens comes after the promise was broken; that one must fetch.', '0': 'After the first FETCH, A holds a promise, and an open with a promise sends nothing.', '*': 'An open sends FETCH only if A holds no promise on the file.' },
    hints: ['The first open fetches the file and gets a promise.', `B's store reaches the server at t = ${arrival(phR, 'STORE').recv}, and the BREAK reaches A at t = ${phR.events.find((e) => e.kind === 'break').t}.`, `The opens at ${list(phOpens.filter((o) => o.fetch).map((o) => 't = ' + o.t))} send FETCH; the opens at ${list(phHits.map((e) => 't = ' + e.t))} use the promise and send nothing: ${phHits.length}.`],
    solution: phHits.length, wrong: [4, 0] });

  const pt = { protocol: 'afs', clients: ['A', 'B'], files: { menu: 'leek soup' }, latency: 1, timeout: 6, script: sc('A', [0, 5, 10, 15].flatMap(orc), 'menu').concat(sc('B', [[6, 'open'], [6, 'write', 'fennel soup'], [6, 'close']], 'menu')) };
  const ptR = D.run(pt), ptReq = perOp(pt, 'A'), ptReads = ptR.reads.filter((x) => x.c === 'A'), ptRows = [0, 5, 10, 15].map((t) => 'open at ' + t), ptCells = {};
  ptRows.forEach((row, i) => { ptCells[row + '|messages'] = String(2 * ptReq[3 * i].length); ptCells[row + '|A reads'] = ptReads[i].got; });
  const ptW1 = Object.assign({}, ptCells, { [ptRows[2] + '|messages']: '0', [ptRows[2] + '|A reads']: 'leek soup' }), ptW2 = Object.assign({}, ptCells, { [ptRows[1] + '|messages']: '2' });
  C.exercise({ id: 'dfs-x-afs-table', chapter: 'dfs-afs', title: 'Open by open', level: 2, kind: 'table',
    text: ['AFS-style clients, 1 tick each way. The file `menu` holds "leek soup". Client A opens it, reads it and closes it at t = 0, 5, 10 and 15. Client B opens it at t = 6, writes "fennel soup" and closes it. For each of A\'s opens, give the messages it costs (requests and replies) and what A then reads.'],
    rows: ptRows, cols: ['messages', 'A reads'], corner: 'A', cells: ptCells, cellKind: 'text',
    hints: ['An open with a promise costs nothing; an open without one costs a FETCH and its reply.', `B fetches the file too, then stores it; the server sends A a BREAK at t = ${ptR.messages.find((m) => m.kind === 'BREAK').sent}.`, ptRows.map((row) => `${row}: ${ptCells[row + '|messages']} messages, "${ptCells[row + '|A reads']}"`).join('; ') + '.'],
    solution: ptCells, wrong: [ptW1, ptW2] });

  const br = { protocol: 'afs', clients: ['A', 'B', 'C'], files: { menu: 'leek soup' }, latency: 1, timeout: 6, script: sc('A', [[0, 'open'], [0, 'read'], [0, 'close'], [10, 'open'], [10, 'write', 'pea soup'], [10, 'close']], 'menu').concat(sc('B', orc(1), 'menu')).concat(sc('C', [[2, 'open'], [2, 'write', 'fennel soup'], [5, 'close']], 'menu')) };
  const brR = D.run(br), brks = brR.messages.filter((m) => m.kind === 'BREAK');
  C.exercise({ id: 'dfs-x-breaks', chapter: 'dfs-afs', title: 'Promises broken', level: 2, kind: 'number',
    text: ['Three AFS-style clients. A opens `menu` at t = 0, reads it and closes it. B does the same at t = 1. C opens it at t = 2, writes "fennel soup" and closes it at t = 5. At t = 10, A opens it again, writes "pea soup" and closes it. When a client stores a file, the server breaks the promise of every other client it promised. How many BREAK messages does the server send in all?'],
    answer: brks.length,
    whyNot: { '2': 'That is C\'s store. A\'s store at the end breaks a promise too.', '4': 'B\'s promise was broken by C\'s store and B never fetched again, so A\'s store has only C to tell.', '*': 'Keep, for each moment, the set of clients holding a promise, and update it at each FETCH and STORE.' },
    hints: ['After A\'s and B\'s first opens and C\'s open, all three hold promises.', 'C\'s store breaks A\'s and B\'s promises; the server then promises only C. A\'s open at t = 10 fetches again and gets a promise.', `BREAKs: ${list(brks.map((m) => 'to ' + m.to + ' at t = ' + m.sent))}: ${brks.length} in all.`],
    solution: brks.length, wrong: [2, 4] });

  C.exercise({ id: 'dfs-x-session', chapter: 'dfs-afs', title: 'A change during a session', level: 1, kind: 'choice',
    text: ['AFS-style. Client A has opened a file and is reading it, on and off, for an hour. Twenty minutes in, client B stores a new version, and the server sends A a BREAK. What do A\'s reads in the last forty minutes return?'],
    options: ['The old version: A works on its own copy until it opens the file again', 'The new version: the BREAK carries the new contents', 'An error: the file has changed under it', 'The new version for reads, the old one for writes'],
    answer: 0, whyNot: { 1: 'A BREAK only says the promise is gone; nothing is fetched until the next open.', 2: 'Nothing fails: the session goes on with A\'s copy.', 3: 'Reads and writes both use the local copy.' },
    hints: ['When does an AFS-style client go to the server at all?', 'Only at open (if it holds no promise) and at close (if it changed the file). The BREAK marks its copy as no longer promised.', 'The old version, for the rest of the session. A sees B\'s change at its next open, which fetches the file again: open-to-close sessions.'],
    solution: 0, wrong: [1, 2] });

  // ---- a crash forgets the promises -------------------------------------------------------------------------------
  const crCfg = (probe) => ({ protocol: 'afs', clients: ['A', 'B'], files: { menu: 'leek soup' }, latency: 1, timeout: 4, probe, crashes: [{ t: 3, until: 6 }], script: sc('A', [[0, 'open'], [0, 'read'], [0, 'close'], [16, 'open'], [16, 'read'], [16, 'close']], 'menu').concat(sc('B', [[7, 'open'], [7, 'write', 'fennel soup'], [7, 'close']], 'menu')) });
  const PROBES = [4, 7, 10, 13, 15, 18], probeRes = PROBES.map((p) => { const r = D.run(crCfg(p)); return { p, stale: r.reads.some((x) => x.stale), learned: (r.events.find((e) => e.kind === 'epoch' && e.c === 'A') || {}).t, probes: r.messages.filter((m) => /PROBE/.test(m.kind)).length }; });
  const okP = probeRes.filter((x) => !x.stale).map((x) => x.p);
  C.exercise({ id: 'dfs-x-probe-set', chapter: 'dfs-afs', title: 'Probing often enough', level: 3, kind: 'set',
    text: ['AFS-style clients, 1 tick each way. A opens `menu` at t = 0, reads it and closes it, keeping a promise. The server crashes at t = 3 and is back at t = 6, having forgotten every promise. B opens the file at t = 7, writes "fennel soup" and closes it; the server breaks no one, since it no longer knows about A. A opens the file again at t = 16 and reads it.', 'Each client sends the server a PROBE every P ticks (at t = P, 2P, ..). A probe that arrives while the server is down is lost; a reply carries the server\'s new epoch, and a client that sees it drops every promise. A reply that arrives at the same tick as an open is handled first. For which of P = ' + list(PROBES.map(String)) + ' does A read "fennel soup" at t = 16? Answer as a set, like {4, 7}.'],
    answer: '{' + okP.join(', ') + '}',
    whyNot: 'A must hear a probe reply from after the restart by t = 16: a probe sent at t arrives at t + 1 (lost if the server is down) and its reply reaches A at t + 2.',
    hints: ['A probe helps only if it reaches the server after t = 6, and its reply reaches A by t = 16.', 'So A needs a probe sent between t = 5 (arriving at 6, when the server is back) and t = 14.', probeRes.map((x) => `P = ${x.p}: ${x.learned !== undefined ? 'A learns of the restart at t = ' + x.learned : 'A never learns'}, ${x.stale ? 'stale' : 'fresh'} (${x.probes} probe messages)`).join('; ') + `. Fresh for {${okP.join(', ')}}.`],
    solution: '{' + okP.join(', ') + '}', wrong: ['{' + okP.slice(0, -1).join(', ') + '}', '{' + PROBES.join(', ') + '}'] });

  C.exercise({ id: 'dfs-x-epoch', chapter: 'dfs-afs', title: 'A new epoch', level: 2, kind: 'choice',
    text: ['An AFS-style client holds promises on 40 files. A reply from the server carries epoch 8, and the last one it saw carried epoch 7. What must it do?'],
    options: ['Drop all 40 promises, so that each file is checked with the server at its next open', 'Nothing: its promises still hold', 'Throw away all 40 cached files at once', 'Send every file back to the server'],
    answer: 0, whyNot: { 1: 'Epoch 8 means the server restarted and forgot every promise; it would not break them if the files changed.', 2: 'The copies may still be good; it only cannot trust them without asking. Revalidating at the next open is enough.', 3: 'Only files it changed and has not stored need to go back, and that happens at close as usual.' },
    hints: ['What does a new epoch say about the server?', 'It restarted, and promises live only in its memory: the server no longer knows this client caches anything.', 'Drop every promise. Each file is then checked or fetched again at its next open, so no stale copy is trusted.'],
    solution: 0, wrong: [1, 2] });

  // ---- the cost of each design -----------------------------------------------------------------------------------
  const costCfg = (protocol, size) => ({ protocol, clients: ['A', 'B'], files: { notice: 'notice: '.padEnd(size, '.') }, latency: 1, timeout: 6, attrTimeout: 3,
    script: sc('A', [0, 4, 8, 12, 16].flatMap(orc), 'notice').concat(sc('B', [[9, 'open'], [9, 'write', 'notice, revised: '.padEnd(size, '.')], [9, 'close']], 'notice')) });
  const SZ = 300, cN = D.run(costCfg('nfs', SZ)), cA = D.run(costCfg('afs', SZ));
  const ROWSC = [['messages', (r) => r.costs.messages], ['bytes', (r) => r.costs.bytes], ['server operations', (r) => r.costs.serverOps]], cCells = {};
  for (const [row, f] of ROWSC) { cCells[row + '|NFS-style'] = f(cN); cCells[row + '|AFS-style'] = f(cA); }
  const cW1 = Object.assign({}, cCells, { 'messages|NFS-style': cA.costs.messages, 'messages|AFS-style': cN.costs.messages }), cW2 = Object.assign({}, cCells, { 'bytes|AFS-style': cN.costs.bytes });
  const costText = (size) => `Client A opens ${size === 'N' ? 'an' : 'a'} ${size}-byte file \`notice\`, reads it and closes it at t = 0, 4, 8, 12 and 16. Client B opens it at t = 9, writes a new ${size}-byte version and closes it. Each message takes 1 tick and is 16 bytes of header plus any file data it carries. NFS-style clients ask for the version at every open, trust attributes for 3 ticks, READ the whole file when they need data, and WRITE at close; AFS-style clients FETCH the whole file at an open without a promise and STORE it at close.`;
  C.exercise({ id: 'dfs-x-cost-table', chapter: 'dfs-afs', title: 'Count both designs', level: 2, kind: 'table',
    text: [costText(SZ), 'Fill in the cost of the whole run under each design.'],
    rows: ROWSC.map((x) => x[0]), cols: ['NFS-style', 'AFS-style'], corner: 'cost', cells: cCells,
    hints: ['NFS-style: a GETATTR at each of the 6 opens; READs only for new data; one WRITE. AFS-style: a FETCH at each open without a promise, one STORE, and a BREAK for A.', `NFS-style sends ${list(Object.entries(cN.costs.byKind).filter(([k]) => !/REPLY/.test(k)).map(([k, n]) => n + ' ' + k))}; AFS-style ${list(Object.entries(cA.costs.byKind).filter(([k]) => !/REPLY/.test(k)).map(([k, n]) => n + ' ' + k))}, each request with its reply.`, `NFS-style: ${cN.costs.messages} messages, ${cN.costs.bytes} bytes, ${cN.costs.serverOps} server operations. AFS-style: ${cA.costs.messages} messages, ${cA.costs.bytes} bytes, ${cA.costs.serverOps} server operations. Fewer messages, but each FETCH moves the whole file.`],
    solution: cCells, wrong: [cW1, cW2] });

  let cross = 0;
  for (let s = 10; s <= 2000 && !cross; s++) if (D.run(costCfg('afs', s)).costs.bytes > D.run(costCfg('nfs', s)).costs.bytes) cross = s;
  const bN = D.run(costCfg('nfs', cross)).costs.bytes, bA = D.run(costCfg('afs', cross)).costs.bytes, bN1 = D.run(costCfg('nfs', cross - 1)).costs.bytes, bA1 = D.run(costCfg('afs', cross - 1)).costs.bytes;
  const movesN = Object.entries(cN.costs.byKind).filter(([k]) => k === 'READ-REPLY' || k === 'WRITE').reduce((a, [, n]) => a + n, 0), movesA = Object.entries(cA.costs.byKind).filter(([k]) => k === 'FETCH-REPLY' || k === 'STORE').reduce((a, [, n]) => a + n, 0);
  C.exercise({ id: 'dfs-x-cost-size', chapter: 'dfs-afs', title: 'When whole files cost more', level: 3, kind: 'number',
    text: [costText('N'), 'For small files the AFS-style run sends fewer bytes, because it sends fewer messages. What is the smallest file size N, in bytes, for which the AFS-style run sends more bytes than the NFS-style run?'],
    answer: cross,
    whyNot: { [String(cross - 1)]: `At that size both runs send ${bN1} bytes: equal, not more.`, [String(16 * cN.costs.messages)]: 'That is the NFS-style headers alone; the file data counts too, and AFS-style moves the file more often.', '*': 'Write each run\'s bytes as 16 × messages + N × (the number of messages that carry the file), and find where the AFS-style line passes the NFS-style one.' },
    hints: [`Headers: ${cN.costs.messages} × 16 bytes against ${cA.costs.messages} × 16 bytes, whatever N is.`, `The file travels ${movesN} times NFS-style (each READ reply and the WRITE) and ${movesA} times AFS-style (each FETCH reply and the STORE). B's write carries a file of N bytes too.`, `NFS-style: 16 × ${cN.costs.messages} + ${movesN}N; AFS-style: 16 × ${cA.costs.messages} + ${movesA}N. They are equal at N = ${cross - 1} (${bN1} bytes each); at N = ${cross}, ${bA} against ${bN}.`],
    solution: cross, wrong: [cross - 1, 16 * cN.costs.messages] });

  C.exercise({ id: 'dfs-x-which', chapter: 'dfs-afs', title: 'Which design suits which file', level: 2, kind: 'choice',
    text: ['Which of these suits whole-file caching with callbacks better than block requests with attribute caching?'],
    options: ['A shared configuration file, a few kilobytes, read at every program start on hundreds of machines and changed once a week', 'A 40 GB database file of which each client reads a few pages', 'A log file that two clients append to all day', 'A file that one client rewrites every second while another watches it'],
    answer: 0, whyNot: { 1: 'Whole-file caching would fetch 40 GB at open to read a few pages.', 2: 'Every store sends the whole file and breaks the other client\'s promise; and concurrent writers lose updates at close.', 3: 'The watcher sees changes only at its next open, and every rewrite moves the whole file.' },
    hints: ['Callbacks pay off when opens are many and changes are few.', 'Whole-file transfers pay off only when the file is small, or read whole anyway.', 'The configuration file: after the first fetch each machine\'s opens cost nothing until the weekly change, which costs one store and a break to each holder.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
