// Part 16, distributed file systems: the exercises of chapter 1 (messages, retries, crashes and requests that are
// not idempotent). Every number in a text, an answer or a hint is worked out here by the timeline engine (S.DFS.run):
// nothing is typed from memory. A latency of 1 tick each way unless the text says otherwise.
(function (S) {
  'use strict';
  const C = S.Content, D = S.DFS;
  if (!C || !D || C.exercises.has('dfs-x-trip')) return;
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const plural = (n, w, pl) => n + ' ' + (n === 1 ? w : pl || w + 's');
  /** a client's script: [[t, op, data], ..] on one file */
  const sc = (c, ops, file) => ops.map(([t, op, data]) => Object.assign({ t, c, op, file }, data !== undefined ? { data } : {}));
  /** the requests (not replies) each of client c's operations sends, worked out by running the script one more op at a time */
  const perOp = (cfg, c) => {
    const mine = cfg.script.filter((s) => s.c === c), rest = cfg.script.filter((s) => s.c !== c);
    const sent = (k) => D.run(Object.assign({}, cfg, { script: rest.concat(mine.slice(0, k)) })).messages.filter((m) => m.from === c).map((m) => m.kind);
    return mine.map((_, i) => { const a = sent(i), b = sent(i + 1); return b.slice(a.length); });
  };
  const lastRecv = (r) => Math.max(...r.messages.map((m) => m.recv));
  const msgLine = (r) => r.messages.map((m) => `${m.kind} ${m.sent}→${m.recv}${m.lost === 'dropped' ? ' (lost)' : m.lost ? ' (server down)' : ''}`).join(', ');

  // =========================================================================================================
  // Chapter 1: every call becomes messages
  // =========================================================================================================
  const EDIT = [[0, 'open'], [0, 'read'], [0, 'read'], [0, 'write', 'soup of the day: fennel'], [0, 'close']];
  const editCfg = (lat, protocol) => ({ protocol: protocol || 'nfs', clients: ['A'], files: { menu: 'soup of the day: leek' }, latency: lat, timeout: 4 * lat + 2, attrTimeout: 3, script: sc('A', EDIT, 'menu') });
  const trip2 = D.run(editCfg(2)), trip1 = D.run(editCfg(1)), end2 = lastRecv(trip2), end1 = lastRecv(trip1);
  const rtrips = trip2.messages.filter((m) => m.from === 'A').length;
  C.exercise({ id: 'dfs-x-trip', chapter: 'dfs-wire', title: 'How long the program waits', level: 1, kind: 'number',
    text: ['A program on client A opens `menu`, reads it twice, writes a new line and closes it. The file is on an NFS-style server, and every message takes **2 ticks** each way. The client checks the version at open, keeps the data it reads, trusts its cached attributes for 3 ticks, and sends its writes at close. Nothing is lost. How many ticks pass from the open call to the moment close returns?'],
    answer: end2,
    whyNot: { [String(end1)]: 'That is the time with 1 tick each way. Each message here takes 2.', [String(4 * EDIT.length)]: 'That gives every call a round trip. The second read finds its data cached, and the write stays at the client until close.', '*': 'Count the requests that go to the server, and give each a full round trip.' },
    hints: ['Which calls need the server? open asks for the version, the first read needs the data, close sends the write. The second read and the write call itself are local.', `That is ${plural(rtrips, 'request')}, each a round trip of 2 + 2 ticks.`, `${msgLine(trip2)}: close returns at t = ${end2}. With 1 tick each way it would be ${end1}.`],
    solution: end2, wrong: [end1, 4 * EDIT.length] });

  const reqN = perOp(editCfg(1), 'A'), reqA = perOp(editCfg(1, 'afs'), 'A');
  const CALLS = ['open', 'read', 'read again', 'write', 'close'], cell = (ks) => (ks.length ? ks.join(' ') : 'none');
  const reqCells = {}; CALLS.forEach((c, i) => { reqCells[c + '|NFS-style'] = cell(reqN[i]); reqCells[c + '|AFS-style'] = cell(reqA[i]); });
  const reqWrong1 = Object.assign({}, reqCells, { 'read again|NFS-style': 'READ' }), reqWrong2 = Object.assign({}, reqCells, { 'write|NFS-style': 'WRITE', 'close|NFS-style': 'none' });
  C.exercise({ id: 'dfs-x-requests', chapter: 'dfs-wire', title: 'Which call sends what', level: 2, kind: 'table',
    text: ['The same program (open, read, read again, write, close, one after another) runs on two clients, one NFS-style and one AFS-style. The NFS-style client asks for the version at open (GETATTR), fetches data with READ, trusts its cached attributes for 3 ticks, and sends its changes with WRITE at close. The AFS-style client fetches the whole file at open (FETCH) and stores it whole at close (STORE). For each call, write the requests it sends to the server, or `none`.'],
    rows: CALLS, cols: ['NFS-style', 'AFS-style'], corner: 'call', cells: reqCells, cellKind: 'text',
    hints: ['A read that finds the data in the cache, with attributes younger than the timeout, sends nothing.', 'Neither design sends anything when the program writes: the change stays at the client until close.', 'NFS-style: ' + CALLS.map((c, i) => c + ' ' + cell(reqN[i])).join(', ') + '. AFS-style: ' + CALLS.map((c, i) => c + ' ' + cell(reqA[i])).join(', ') + '.'],
    solution: reqCells, wrong: [reqWrong1, reqWrong2] });

  C.exercise({ id: 'dfs-x-why-cache', chapter: 'dfs-wire', title: 'What the cache saves', level: 1, kind: 'choice',
    text: ['A client reads a 200-byte file across a network where a message takes 1 ms each way but the link moves a megabyte in a few ms. Which cost does answering a read from the client\'s own cache mainly save?'],
    options: ['The round trip: 2 ms of waiting for a request and its reply', 'The bandwidth: the 200 bytes would clog the link', 'The server\'s disk read, which is the slowest part', 'Nothing: a cache only helps writes'],
    answer: 0, whyNot: { 1: '200 bytes take a tiny fraction of a millisecond on this link; the waiting is in the latency.', 2: 'The server keeps hot files in its own memory; the client still pays the round trip to reach it.', 3: 'Reads gain most: a read answered locally sends no message at all.' },
    hints: ['Compare the time to send 200 bytes with the time a message spends on its way.', 'For small requests a round trip costs the same whatever is in it.', 'A read from the cache sends no message, so it saves a whole round trip, 1 + 1 = 2 ms; the bytes are almost free.'],
    solution: 0, wrong: [1, 2] });

  // ---- idempotent requests ----------------------------------------------------------------------------------------
  const IDEM = ['a: READ 512 bytes at offset 0', 'b: WRITE these 100 bytes at offset 4096', 'c: GETATTR', 'd: append 100 bytes at the end', 'e: REMOVE the file', 'f: CREATE the file, failing if it exists', 'g: set the file\'s length to 0', 'h: RENAME draft to final'];
  C.exercise({ id: 'dfs-x-idem', chapter: 'dfs-wire', title: 'Twice the same as once', level: 1, kind: 'set',
    text: ['A request is idempotent when doing it twice leaves the file system, and the reply, just as doing it once. Which of these are idempotent? Answer with their letters as a set, like {a, b}.', { list: IDEM }],
    answer: '{a, b, c, g}', caseless: true,
    whyNot: 'Ask of each: if the server does it, then does it again, does the second try change anything, or answer differently?',
    hints: ['Reading or asking for attributes changes nothing, so any number of tries give the same answer.', 'A write that names its offset puts the same bytes in the same place each time; an append adds them again at the new end.', 'Idempotent: {a, b, c, g}. Append grows the file twice; REMOVE, CREATE (exclusive) and RENAME find the first try\'s result and fail the second time.'],
    solution: '{a, b, c, g}', wrong: ['{a, b, c, d, g}', '{a, c}', '{a, b, c, e, g}'] });

  C.exercise({ id: 'dfs-x-silence', chapter: 'dfs-wire', title: 'What silence tells the client', level: 1, kind: 'choice',
    text: ['A client sent a WRITE 4 ticks ago and has heard nothing. Which of these can it rule out?'],
    options: ['None of them: the request lost, the reply lost, the server slow, or the server down all look the same from here', 'That the server did the WRITE: no reply means it never arrived', 'That the server crashed: a crashed server would have said so', 'That the reply was lost: replies are never lost'],
    answer: 0, whyNot: { 1: 'The WRITE may have been done and its reply lost on the way back.', 2: 'A crashed server sends nothing at all; that is exactly what silence looks like.', 3: 'Any message can be lost, a reply as easily as a request.' },
    hints: ['List what could have happened to the request, and to the reply.', 'Each of those cases produces the same thing at the client: no reply.', 'It can rule out nothing, which is why it simply sends the same request again with the same xid, and why that request had better be idempotent.'],
    solution: 0, wrong: [1, 2] });

  // ---- a WRITE done twice -----------------------------------------------------------------------------------------
  const ROSTER = { roster: 'Mon: Ivo' }, RSCRIPT = sc('A', [[0, 'open'], [0, 'read'], [0, 'write', 'Mon: Ivo, Tue: Kai'], [0, 'close']], 'roster');
  const rBase = { protocol: 'nfs', clients: ['A'], files: ROSTER, latency: 1, timeout: 3, attrTimeout: 3, script: RSCRIPT };
  const rClean = D.run(rBase), wReq = rClean.messages.find((m) => m.kind === 'WRITE'), wRep = rClean.messages.find((m) => m.kind === 'WRITE-REPLY');
  // the server here keeps no record of the requests it has done: no duplicate-request cache
  const twice = D.run(Object.assign({}, rBase, { dupCache: false, drops: [{ t: wRep.sent, dir: 'reply', c: 'A', op: 'WRITE-REPLY' }] }));
  const twV = twice.server.files.roster.version, twOps = twice.messages.filter((m) => m.kind === 'WRITE' && !m.lost).length;
  C.exercise({ id: 'dfs-x-twice', chapter: 'dfs-wire', title: 'A WRITE carried out twice', level: 2, kind: 'number',
    text: [`The file \`roster\` holds "Mon: Ivo" at version 1. Client A opens it, reads it, writes "Mon: Ivo, Tue: Kai" and closes it; the close sends a WRITE at t = ${wReq.sent}. The server does the WRITE, but its reply is lost. A retries after 3 ticks with the same xid, and this time the reply arrives. The server keeps no record of the requests it has done, and adds 1 to a file's version each time it carries out a WRITE. Which version number does the server hold at the end?`],
    answer: twV,
    whyNot: { [String(twV - 1)]: 'That is a single WRITE. The server did it, the reply was lost, and the retry made it do the same WRITE again.', '1': 'The WRITE was done; only its reply was lost.', '*': 'Count how many times the server carried out the WRITE.' },
    hints: ['The server cannot tell a retry from a new request: it has no memory of what it did.', `It carries out the WRITE ${plural(twOps, 'time')}. Each time the same bytes go to the same place.`, `Version 1, then ${twV - 1} after the first WRITE, then ${twV} after the retry. The contents are "${twice.server.files.roster.data}" either way: the request is idempotent, only the version number moved on twice.`],
    solution: twV, wrong: [twV - 1, 1] });

  // ---- retries through a lost request and an outage -----------------------------------------------------------------
  const outCfg = Object.assign({}, rBase, { drops: [{ t: wReq.sent, dir: 'request', c: 'A', op: 'WRITE' }], crashes: [{ t: wReq.sent + 2, until: wReq.sent + 8 }] });
  const out = D.run(outCfg), tries = out.messages.filter((m) => m.kind === 'WRITE');
  const fate = (m) => (m.lost === 'dropped' ? 'lost' : m.lost ? 'down' : 'served');
  const tryRows = tries.map((_, i) => 'try ' + (i + 1)), tryCells = {};
  tries.forEach((m, i) => { tryCells[tryRows[i] + '|sent at'] = String(m.sent); tryCells[tryRows[i] + '|fate'] = fate(m); });
  const doneAt = out.events.find((e) => e.kind === 'close').t;
  const tryW1 = Object.assign({}, tryCells, { [tryRows[1] + '|fate']: 'served' }), tryW2 = Object.assign({}, tryCells, { [tryRows[1] + '|sent at']: String(+tryCells[tryRows[1] + '|sent at'] + 1) });
  C.exercise({ id: 'dfs-x-retry-table', chapter: 'dfs-wire', title: 'Every try of one WRITE', level: 3, kind: 'table',
    text: [`The same program on \`roster\`, retrying after 3 ticks. This time the network loses the WRITE request sent at t = ${wReq.sent}, and the server crashes at t = ${outCfg.crashes[0].t} and is back at t = ${outCfg.crashes[0].until}. A request that arrives while the server is down is lost. A keeps sending the same WRITE every 3 ticks until a reply comes. For each try, give the tick it is sent and its fate: \`lost\` (by the network), \`down\` (it arrives while the server is down) or \`served\`.`],
    rows: tryRows, cols: ['sent at', 'fate'], corner: 'WRITE', cells: tryCells, cellKind: 'text',
    hints: ['A try is sent 3 ticks after the one before it, because that is when A gives up waiting.', `Each try arrives 1 tick after it is sent. The server is down for arrivals from t = ${outCfg.crashes[0].t} until it is back at t = ${outCfg.crashes[0].until}.`, tries.map((m, i) => `try ${i + 1} at ${m.sent}: ${fate(m)}`).join('; ') + `. The reply reaches A and close returns at t = ${doneAt}; the server never had to rebuild anything about A.`],
    solution: tryCells, wrong: [tryW1, tryW2] });

  const OUT = { t: 2, until: 13 }, slow = D.run({ protocol: 'nfs', clients: ['A'], files: ROSTER, latency: 1, timeout: 4, attrTimeout: 3, script: sc('A', [[0, 'open'], [0, 'read'], [0, 'close']], 'roster'), crashes: [OUT] });
  const slowRead = slow.reads[0].t, slowRetries = slow.outcomes.filter((x) => x.kind === 'retry');
  C.exercise({ id: 'dfs-x-outage', chapter: 'dfs-wire', title: 'Waiting out an outage', level: 2, kind: 'number',
    text: [`Client A opens \`roster\` (GETATTR at t = 0, the reply at t = 2) and then reads it. The server crashes at t = ${OUT.t} and is back at t = ${OUT.until}. A retries after 4 ticks with no reply, again and again. At which tick does A's read return?`],
    answer: slowRead,
    whyNot: { [String(OUT.until)]: 'The server is back then, but A does not know: it only tries again when its timer runs out.', [String(OUT.until + 2)]: 'That is a round trip from the moment the server is back; A sends nothing until its next retry.', '*': 'List A\'s tries of the READ, 4 ticks apart from t = 2, and find the first that arrives while the server is up.' },
    hints: ['The READ goes out at t = 2 and arrives at t = 3, while the server is down.', `A tries again at ${list(slowRetries.map((x) => String(x.t)))}. Which of those arrives after t = ${OUT.until}?`, `The try sent at t = ${slowRetries[slowRetries.length - 1].t} arrives at ${slowRetries[slowRetries.length - 1].t + 1}, after the restart; its reply reaches A at t = ${slowRead}. A waited ${slowRead - 2} ticks for one read, and the server rebuilt nothing.`],
    solution: slowRead, wrong: [OUT.until, OUT.until + 2] });

  // ---- not idempotent: the duplicate-request cache -----------------------------------------------------------------
  const dupRun = (op, cache, crash) => {
    const file = op === 'remove' ? 'draft' : 'minutes', K = op.toUpperCase();
    const cfg = { protocol: 'nfs', clients: ['A'], files: op === 'remove' ? { draft: 'old notes' } : {}, latency: 1, timeout: 3, dupCache: cache, script: [{ t: 0, c: 'A', op, file }], drops: [{ t: 1, dir: 'reply', c: 'A', op: K + '-REPLY' }] };
    if (crash === 'between') cfg.crashes = [{ t: 2, until: 3 }];
    if (crash === 'before') { cfg.crashes = [{ t: 0, until: 2 }]; cfg.drops = []; }
    const r = D.run(cfg), err = r.outcomes.find((x) => x.kind === 'error');
    return { r, told: err ? err.err : 'success' };
  };
  const DUPS = [['REMOVE, no cache', 'remove', false, 'no'], ['REMOVE, cache', 'remove', true, 'no'], ['REMOVE, cache, crash before the retry', 'remove', true, 'between'], ['REMOVE, cache, down when the first try arrives', 'remove', true, 'before'], ['CREATE, no cache', 'create', false, 'no'], ['CREATE, cache', 'create', true, 'no']];
  const dupCells = {}; DUPS.forEach(([row, op, cache, crash]) => { dupCells[row + '|A is told'] = dupRun(op, cache, crash).told; });
  const dupW1 = Object.assign({}, dupCells, { 'REMOVE, cache, crash before the retry|A is told': 'success' }), dupW2 = Object.assign({}, dupCells, { 'REMOVE, cache, down when the first try arrives|A is told': 'ENOENT' });
  C.exercise({ id: 'dfs-x-dup-table', chapter: 'dfs-wire', title: 'What the client is told', level: 2, kind: 'table',
    text: ['Client A sends one REMOVE (of a file that exists) or one CREATE (of a file that does not), and retries after 3 ticks without a reply. In each case below the first reply is lost, except in the last REMOVE case, where nothing is lost but the server is down when the first try arrives and back before the retry. "Cache" means the server keeps a duplicate-request cache, which answers a repeated xid with the reply it gave before; "crash before the retry" means the server restarts between the first try and the retry. What is A told in the end: `success`, `ENOENT` (no such file) or `EEXIST` (it already exists)?'],
    rows: DUPS.map((d) => d[0]), cols: ['A is told'], corner: 'case', cells: dupCells, cellKind: 'text',
    hints: ['Without a cache, the retry is carried out again, and it finds what the first try did.', 'The cache is in the server\'s memory: a restart empties it. A request lost while the server is down was never carried out at all.', DUPS.map(([row]) => row + ': ' + dupCells[row + '|A is told']).join('; ') + '.'],
    solution: dupCells, wrong: [dupW1, dupW2] });

  const tw = (cache) => D.run({ protocol: 'nfs', clients: ['A'], files: { draft: 'old notes' }, latency: 1, timeout: 3, dupCache: cache, script: [{ t: 0, c: 'A', op: 'remove', file: 'draft' }], drops: [{ t: 1, dir: 'reply', op: 'REMOVE-REPLY' }, { t: 4, dir: 'reply', op: 'REMOVE-REPLY' }] });
  const twOff = tw(false), twOn = tw(true), offOps = twOff.costs.serverOps, onOps = twOn.costs.serverOps;
  const offErr = twOff.outcomes.find((x) => x.kind === 'error');
  C.exercise({ id: 'dfs-x-dup-count', chapter: 'dfs-wire', title: 'Two replies lost', level: 2, kind: 'number',
    text: ['Client A removes `draft`, retrying after 3 ticks. The replies to its first two tries are both lost; the third reply arrives. The server has **no** duplicate-request cache. How many times does the server carry out a REMOVE request?'],
    answer: offOps,
    whyNot: { [String(onOps)]: 'That is what happens with a duplicate-request cache. Without one, every try that arrives is carried out.', '2': 'Count the tries: the first, and one retry for each lost reply.', '*': 'Each try that reaches the server is carried out, whether or not it is a repeat.' },
    hints: ['The requests all arrive; only replies are lost.', `A sends ${plural(twOff.messages.filter((m) => m.kind === 'REMOVE').length, 'REMOVE')}, at ${list(twOff.messages.filter((m) => m.kind === 'REMOVE').map((m) => String(m.sent)))}.`, `The server carries out ${offOps} REMOVEs: the first removes \`draft\`, the next ${offOps - 1} fail, and A is told ${offErr ? offErr.err : 'success'}. With a cache it would carry out ${onOps} and replay its answer twice.`],
    solution: offOps, wrong: [onOps, 2] });

  C.exercise({ id: 'dfs-x-dup-which', chapter: 'dfs-wire', title: 'What the cache must hold', level: 2, kind: 'choice',
    text: ['A server\'s duplicate-request cache can hold only a few thousand entries. Which requests is it most important to record, by xid with the reply sent?'],
    options: ['The ones that are not idempotent, like REMOVE, CREATE and RENAME', 'Every READ, because reads are the most common', 'Only GETATTR, because clients send it most often', 'None: a stateless server must not remember anything'],
    answer: 0, whyNot: { 1: 'A repeated READ does no harm: doing it again gives the same answer, so recording it wastes space.', 2: 'GETATTR is idempotent; repeating it is harmless.', 3: 'The cache is a small, deliberate exception. It holds no state about clients that must survive a crash; losing it in a crash only reopens the window it was there to close.' },
    hints: ['Which repeats cause a wrong answer?', 'A repeated READ, WRITE at an offset or GETATTR gives the same result as the first.', 'The non-idempotent ones: a repeated REMOVE, CREATE or RENAME finds the first try\'s result and fails, unless the cache replays the first reply.'],
    solution: 0, wrong: [1, 3] });
})(globalThis.Proses = globalThis.Proses || {});
