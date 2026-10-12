// Part 16, distributed file systems: the lessons of chapter 2 (cached attributes, flush on close, close-to-open, the
// last writer winning) and chapter 3 (callback promises, a server crash, the cost of each design). The chapters are
// declared in 160-dfs.js. Every value quoted here is what the topics' own engine (S.DFS) says on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('dfs-attrs')) return;
  const X = (id) => ({ exercise: id });
  const row = (t, c, op, file, data) => ({ t, c, op, file, data: data || '' });
  const dfsLab = (title, text, more) => ({ lab: 'fs', title, text, setup: Object.assign({ mode: 'dfs', dproto: 'nfs', dlat: 1, dtimeout: 4, dattr: 3, ddup: true, dprobe: 0, dfiles: [{ name: 'tides', text: 'high water 06:10' }], dcrash: [], ddrops: [] }, more) });
  const orc = (t, c, f) => [row(t, c, 'open', f), row(t, c, 'read', f), row(t, c, 'close', f)];
  const edit = (t, c, f, data, tc) => [row(t, c, 'open', f), row(t, c, 'read', f), row(t, c, 'write', f, data), row(tc === undefined ? t : tc, c, 'close', f)];

  // =========================================================================================================
  // Chapter 2: client caching and consistency
  // =========================================================================================================
  C.lesson({
    id: 'dfs-attrs', chapter: 'dfs-cache', title: 'Cached attributes and stale reads', minutes: 8,
    summary: 'Asking the server before every read would double the messages, so an NFS-style client caches a file\'s attributes and trusts them, and its cached data, for a few seconds. Inside that window a change made by another client goes unseen: the read is answered from the cache, stale. The window is at most the timeout after the client last heard from the server; a shorter timeout gives fresher reads for more messages.',
    blocks: [
      'Client A read the tide table a moment ago and has it in its memory. Before reading it again, should it ask the server whether the file has changed? Asking costs a round trip every time; not asking risks returning old data. How long can it go without asking?',
      { def: 'attribute cache', text: 'the client keeps each file\'s attributes (size, modification time, version) with the time it got them. While they are younger than the attribute timeout, the client trusts them and its cached data; after that, the next read sends GETATTR, and a new version makes it READ the data again.' },
      { topic: 'dfs-attr', frame: 6, caption: 'The timeout is 6. B changed the file and closed it: the server holds version 2 from t = 5. A\'s attributes date from t = 4.' },
      { topic: 'dfs-attr', frame: 7, caption: 't = 8: A\'s attributes are 4 ticks old, under the timeout of 6, so A answers the read from its cache: "High water 06:10", while the server holds the revised time. A stale read.' },
      { topic: 'dfs-attr', frame: 12, caption: 'At t = 10 the attributes are too old: GETATTR sees version 2, READ fetches it. 4 reads, 1 stale, 12 messages.' },
      { predict: { q: 'Run the same reads with a timeout of 2 instead of 6. How many of A\'s reads are stale?', options: ['0', '1', '2'], answer: 0, explain: 'At t = 8 the attributes are 4 ticks old, past a timeout of 2, so A asks the server first and gets version 2. Here it costs nothing extra: 12 messages, as before, because the GETATTR and READ simply come at t = 8 instead of t = 10.' } },
      { topic: 'dfs-attr', input: { attr: 2 }, frame: 7, caption: 'Timeout 2: at t = 8 A sends GETATTR before reading.' },
      { topic: 'dfs-attr', input: { attr: 0 }, frame: 15, caption: 'Timeout 0: every read asks first. No stale read, but 18 messages.' },
      { topic: 'dfs-attr', input: { reopen: 'yes' }, frame: 15, caption: 'Timeout 6, but A reopens the file before each read: open always asks the server, so no read is stale. 16 messages.' },
      { table: [['A\'s reads', 'messages', 'stale reads'], ['timeout 6', '12', '1'], ['timeout 2', '12', '0'], ['timeout 0', '18', '0'], ['timeout 6, reopening first', '16', '0']], caption: 'The same reads at t = 8, 10 and 13 (and the first at t = 2); B\'s change reaches the server at t = 5.' },
      { tip: 'Real clients often scale the timeout with how recently the file changed: a file that has not changed for an hour is unlikely to change in the next few seconds, so its attributes are trusted longer.' },
      dfsLab('Stale reads in the File-system lab', 'A reads board again and again while B changes it. Change the attribute cache timeout and watch which reads turn stale, and what each fresh one costs.', { dattr: 6, dfiles: [{ name: 'board', text: 'open' }], dscript: [row(0, 'A', 'open', 'board'), row(0, 'A', 'read', 'board'), row(1, 'B', 'open', 'board'), row(1, 'B', 'write', 'board', 'closed'), row(1, 'B', 'close', 'board'), row(5, 'A', 'read', 'board'), row(9, 'A', 'read', 'board'), row(13, 'A', 'read', 'board')] }),
      { h: 'Recap' },
      { list: ['Attributes younger than the timeout are trusted, with the cached data: no message.', 'Inside that window another client\'s change is invisible: a stale read.', 'A change can hide for up to the timeout after the client last heard from the server.', 'Shorter timeout: fresher reads, more messages. Opening the file always asks.'] },
      X('dfs-x-attr-window'), X('dfs-x-stale-set'), X('dfs-x-attr-table'), X('dfs-x-attr-sweep'),
    ],
  });

  C.lesson({
    id: 'dfs-c2o', chapter: 'dfs-cache', title: 'Flush on close, check on open', minutes: 7,
    summary: 'An NFS-style client keeps a program\'s writes in its own memory and sends them to the server when the file is closed: flush on close. Open always asks the server for the file\'s version. Together they give close-to-open consistency: a client that opens a file after another client closed it sees that client\'s writes. A client that reads while the writer still has the file open sees the old contents.',
    blocks: [
      'B is writing the harbour log and has not closed it yet. A opens the log to read it. Should A see B\'s new line? And if B closes the file a moment later, when will A see it?',
      { def: 'flush on close', text: 'writes are kept at the client and sent to the server, all of them, when the file is closed (or earlier, if the client runs short of memory). Until then no one else can see them.' },
      { def: 'close-to-open consistency', text: 'open asks the server for the file\'s version and refetches the data if it moved. So a client that opens a file after another closed it sees every write made before that close.' },
      { topic: 'dfs-close', input: { scen: 'unflushed' }, frame: 2, caption: 'B opens the log and writes "B: lamp relit". The write stays in B\'s memory.' },
      { topic: 'dfs-close', input: { scen: 'unflushed' }, frame: 7, caption: 't = 8: A opened at t = 4 and reads "harbour log, empty", the server\'s latest. B\'s line exists only at B.' },
      { predict: { q: 'B closes the file at t = 10, and A opens it again at t = 12 and reads. What does A read?', options: ['"harbour log, empty", from its cache', '"B: lamp relit"', 'It depends on the attribute timeout'], answer: 1, explain: 'B\'s close sent the WRITE, so the server holds version 2 from t = 11. A\'s open asks for the version whatever the timeout, sees 2, and its read fetches "B: lamp relit".' } },
      { topic: 'dfs-close', input: { scen: 'unflushed' }, frame: 10, caption: 't = 12: B\'s close is done (version 2) and A opens the file: GETATTR.' },
      { topic: 'dfs-close', input: { scen: 'unflushed' }, frame: 14, caption: 't = 16: A reads "B: lamp relit". Close, then open: the promise is kept.' },
      { topic: 'dfs-close', input: { scen: 'turns' }, frame: 9, caption: 'In turns: B closes at t = 6, A opens at t = 8 and the server says version 2. A builds on B\'s line, and nothing is lost.' },
      { warn: 'Close-to-open says nothing about reads while both clients have the file open. Programs that share a file at the same time need locks, or must close and reopen.' },
      dfsLab('Close, then open, in the File-system lab', 'B writes the log and closes it late; A opens and reads twice, once before and once after. Move B\'s close earlier and see A\'s first read change.', { dfiles: [{ name: 'log', text: 'harbour log' }], dscript: [row(0, 'B', 'open', 'log'), row(0, 'B', 'write', 'log', 'B: lamp relit'), row(10, 'B', 'close', 'log'), row(4, 'A', 'open', 'log'), row(4, 'A', 'read', 'log'), row(12, 'A', 'open', 'log'), row(12, 'A', 'read', 'log')] }),
      { h: 'Recap' },
      { list: ['Writes stay at the client until close: flush on close.', 'Open always checks the version with the server.', 'Close-to-open: open after a close and you see that close\'s writes.', 'While a writer still has the file open, others see the old contents.'] },
      X('dfs-x-unflushed'), X('dfs-x-c2o-table'),
    ],
  });

  C.lesson({
    id: 'dfs-lastwins', chapter: 'dfs-cache', title: 'The last close wins', minutes: 7,
    summary: 'Two clients that open the same file, both change it, and both close it each send their whole new version at close. The server keeps the later one: the earlier change is lost, silently, under both designs. Caching rules decide how soon a change is seen; they do not order writers. A lock held from open to close, or a write that is refused when it was based on an old version, does.',
    blocks: [
      'A and B both open the harbour log within a tick of each other. Each adds a line and closes. Both closes succeed. How many of the two lines are in the file afterwards?',
      { topic: 'dfs-close', input: { scen: 'together' }, frame: 5, caption: 'Both read version 1. At t = 5 B closes first and sends its WRITE: "B: lamp relit" will be version 2.' },
      { predict: { q: 'A closes at t = 6 with its own version, "A: moorings checked". What does the server hold afterwards?', options: ['"A: moorings checked"', '"B: lamp relit"', 'both lines', 'an error for A'], answer: 0, explain: 'A\'s WRITE carries A\'s whole version, built on version 1. The server replaces version 2 with it: B\'s line is gone, and nobody is told.' } },
      { topic: 'dfs-close', input: { scen: 'together' }, frame: 7, caption: 't = 7: A\'s WRITE replaces version 2, which A never saw: B\'s update is lost.' },
      { topic: 'dfs-close', input: { scen: 'together' }, frame: 8, caption: 'The server ends with "A: moorings checked", version 3. Both clients were told their close worked.' },
      { topic: 'dfs-afs', input: { scen: 'both' }, frame: 8, caption: 'Whole-file caching does no better: B stores first, A stores last, and B\'s "buoy repainted" is lost. The server breaks promises, but a BREAK only marks a copy for the next open.' },
      { h: 'What does stop it' },
      { list: ['A lock held from open to close, taken from a lock service, so that the second editor waits for the first.', 'A conditional write: the client sends the version its change was based on, and the server refuses it if the file has moved on, so the client can merge and try again.', 'Or a design where each edit is its own file, or an append that the server orders.'] },
      { tip: 'A shorter attribute timeout, or closing sooner, narrows the window but cannot close it: two edits that overlap still both start from the same version.' },
      dfsLab('The last close in the File-system lab', 'A and B both edit log at once. Swap the order of their closes and see whose line survives; then make B open after A closes.', { dfiles: [{ name: 'log', text: 'harbour log' }], dscript: edit(0, 'A', 'log', 'A: moorings checked', 6).concat(edit(1, 'B', 'log', 'B: lamp relit', 3)) }),
      { h: 'Recap' },
      { list: ['Each close sends a whole new version; the server keeps the last.', 'Two overlapping edits: the earlier close is lost, silently.', 'It happens with block requests and with whole files alike.', 'Locks or version-checked writes order the writers; caching rules cannot.'] },
      X('dfs-x-last-close'), X('dfs-x-lost-fix'), X('dfs-x-lost-count'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: whole files, callbacks and cost
  // =========================================================================================================
  C.lesson({
    id: 'dfs-callbacks', chapter: 'dfs-afs', title: 'Whole files and callback promises', minutes: 8,
    summary: 'An AFS-style client fetches the whole file when it opens it, and the server promises to call back if the file changes. While the promise holds, opening the file again costs no message at all. Reads and writes use the local copy. Close stores a changed file whole, and the server breaks every other client\'s promise. A client sees another\'s change at its next open: sessions run from open to close on a copy.',
    blocks: [
      'An NFS-style client asks the server for the version at every open, even of a file that has not changed for a month. Could the server instead promise to say when the file changes, so that the client need not ask?',
      { def: 'callback promise', text: 'a record at the server that a client caches a file. When another client stores a new version, the server sends a BREAK to each client it promised, and forgets the promise. A client that holds a promise may use its copy without asking.' },
      { topic: 'dfs-afs', frame: 2, caption: 'A\'s first open fetches the whole chart and gets a promise. The read is local; the close sends nothing, as nothing changed.' },
      { topic: 'dfs-afs', frame: 3, caption: 't = 4: A opens the chart again. It holds a promise, so it uses its copy: no message at all.' },
      { topic: 'dfs-afs', frame: 7, caption: 't = 9: B stored version 2; the server breaks A\'s promise with a BREAK.' },
      { predict: { q: 'A opens the chart again at t = 14. What does the open send?', options: ['Nothing: A still has the file', 'A FETCH: its promise was broken', 'A GETATTR, to check the version'], answer: 1, explain: 'The BREAK reached A at t = 10, so A holds no promise and cannot trust its copy. The open fetches the whole file again, version 2, and gets a new promise.' } },
      { topic: 'dfs-afs', frame: 11, caption: 'A fetches version 2. In all 9 messages: 1 open answered by a promise, 1 promise broken.' },
      { topic: 'dfs-afs', input: { scen: 'session' }, frame: 7, caption: 'If B stores while A has the file open, A\'s reads in that session keep using its copy: at t = 8 A reads "chart v1", stale. The BREAK only matters at A\'s next open.' },
      { table: [['Moment', 'NFS-style', 'AFS-style'], ['open, file unchanged', 'GETATTR', 'nothing (a promise)'], ['open, file changed', 'GETATTR, then READ at the first read', 'FETCH the whole file'], ['read in a session', 'cache, or GETATTR after the timeout', 'the local copy, always'], ['another client stores', 'nobody is told', 'BREAK to each promised client']], caption: 'Asking every time against being told.' },
      dfsLab('Callbacks in the File-system lab', 'A opens the file twice, B changes it, A opens it again. Add a third open for A, or let B change it twice, and count the FETCH and BREAK messages.', { dproto: 'afs', dfiles: [{ name: 'chart', text: 'chart v1' }], dscript: orc(0, 'A', 'chart').concat(orc(4, 'A', 'chart'), [row(6, 'B', 'open', 'chart'), row(6, 'B', 'write', 'chart', 'chart v2'), row(6, 'B', 'close', 'chart')], orc(14, 'A', 'chart')) }),
      { h: 'Recap' },
      { list: ['Open fetches the whole file, unless the client holds a promise.', 'With a promise, an open costs no message.', 'Close stores a changed file whole; the server breaks the other promises.', 'Changes are seen at the next open: open-to-close sessions.'] },
      X('dfs-x-promise-opens'), X('dfs-x-afs-table'), X('dfs-x-breaks'), X('dfs-x-session'),
    ],
  });

  C.lesson({
    id: 'dfs-epoch', chapter: 'dfs-afs', title: 'A crash forgets the promises', minutes: 7,
    summary: 'Callback promises are state the server keeps in memory. After a crash it no longer knows who holds which promise, so a later change breaks nobody, and a client still trusting its promise reads a stale copy. The server numbers its lives (epochs) and puts the number in every reply; a client that sees a new epoch, from a reply or from a periodic probe, drops every promise it holds.',
    blocks: [
      'The stateless server of chapter 1 recovered from a crash by doing nothing. An AFS-style server holds promises to its clients. What happens to them when it crashes?',
      { topic: 'dfs-afs-crash', frame: 3, caption: 'A holds a promise on the chart. t = 4: the server crashes, and with it every promise it made.' },
      { topic: 'dfs-afs-crash', frame: 9, caption: 't = 12: B stores version 2. The server, back since t = 7, does not know A caches the chart, so it breaks nothing.' },
      { topic: 'dfs-afs-crash', frame: 10, caption: 't = 14: A opens the chart, still trusting its promise. No message, and a stale read: "chart v1".' },
      { def: 'epoch', text: 'a number the server adds 1 to each time it starts, and puts in every reply. A client that sees a number newer than the last it saw knows the server restarted and has forgotten every promise, and drops them all.' },
      { predict: { q: 'Each client now probes the server every 12 ticks (at t = 12, 24, ..). Does A read version 2 when it opens at t = 14?', options: ['Yes', 'No, still stale'], answer: 0, explain: 'A\'s probe goes at t = 12 and its reply, carrying epoch 2, arrives at t = 14, just before the open. A drops its promise, so the open fetches version 2. 4 probe messages.' } },
      { topic: 'dfs-afs-crash', input: { probe: 12 }, frame: 11, caption: 't = 14: A learns of the restart and drops 1 promise; the open sends FETCH.' },
      { topic: 'dfs-afs-crash', input: { probe: 3 }, frame: 7, caption: 'Probing every 3 ticks: A learns at t = 8, long before it needs to. But by the end 18 probe messages have crossed the network.' },
      { table: [['Probe every', 'A learns of the restart', 'probe messages', 'A at t = 14 reads'], ['never', 'never', '0', 'v1, stale'], ['3 ticks', 't = 8', '18', 'v2'], ['12 ticks', 't = 14', '4', 'v2'], ['15 ticks', 'too late', '0 before the end', 'v1, stale']], caption: 'Probing trades messages for a shorter time of trusting a void promise.' },
      { tip: 'A real server can also wait, after it restarts, for clients to come back and tell it what they cache, or simply refuse to serve until every client\'s promises have timed out. Either way, the state it kept must be rebuilt or written off.' },
      dfsLab('A forgotten promise in the File-system lab', 'The server crashes while A holds a promise, and B changes the file. Set the probe interval to 3, then to 15, and watch whether A\'s last read is stale.', { dproto: 'afs', dtimeout: 4, dfiles: [{ name: 'chart', text: 'chart v1' }], dcrash: [{ t: 4, until: 7 }], dscript: orc(0, 'A', 'chart').concat([row(8, 'B', 'open', 'chart'), row(8, 'B', 'write', 'chart', 'chart v2'), row(8, 'B', 'close', 'chart')], orc(14, 'A', 'chart')) }),
      { h: 'Recap' },
      { list: ['Promises live in the server\'s memory; a crash forgets them.', 'After the restart, changes break nobody: trusting clients read stale copies.', 'Each reply carries the server\'s epoch; a new one voids every promise.', 'Probing finds a restart sooner, at the cost of messages when nothing happens.'] },
      X('dfs-x-epoch'), X('dfs-x-probe-set'),
    ],
  });

  C.lesson({
    id: 'dfs-tradeoff', chapter: 'dfs-afs', title: 'Two designs, one workload', minutes: 7,
    summary: 'Neither design is cheaper everywhere. Whole-file caching with callbacks makes repeated opens of an unchanged file free and loads the server least, but moves the whole file at every open after a change and at every close that changed it, and shows changes only at the next open. Block requests with attribute caching keep asking, but move only what is read. Count messages, bytes, server operations and stale reads on the workload you have.',
    blocks: [
      'One client opens a chart every few ticks to read it; another changes it now and then. Which design costs less? It depends on what you count, and on the workload.',
      { topic: 'dfs-cost', frame: 0, caption: 'Read often, change rarely, NFS-style: a GETATTR at every open. 16 messages, 472 bytes, 8 operations at the server.' },
      { topic: 'dfs-cost', frame: 1, caption: 'AFS-style: opens with a promise cost nothing. 9 messages, 4 server operations, but 560 bytes: each FETCH moves the whole file.' },
      { predict: { q: 'The same workload on a 2000-byte file. Which design sends fewer bytes?', options: ['NFS-style', 'AFS-style', 'The same'], answer: 0, explain: 'NFS-style sends 2272 bytes against 4160: the file is fetched whole three times and stored once AFS-style, against two READs and one WRITE. AFS-style still sends fewer messages, 9 against 16.' } },
      { topic: 'dfs-cost', input: { size: 2000 }, frame: 2, caption: 'A 2000-byte file: 16 against 9 messages, 2272 against 4160 bytes.' },
      { topic: 'dfs-cost', input: { work: 'session' }, frame: 2, caption: 'One long read session while B changes the file: AFS-style sends 7 messages against 12, but 2 of its reads are stale; NFS-style sees the change once its attributes time out.' },
      { topic: 'dfs-cost', input: { work: 'shared' }, frame: 2, caption: 'Writing in turns: 24 against 19 messages, 598 against 518 bytes, and 3 BREAKs.' },
      { table: [['Workload (200-byte file)', 'NFS-style messages / bytes', 'AFS-style messages / bytes'], ['read often, change rarely', '16 / 472', '9 / 560'], ['both read and write in turns', '24 / 598', '19 / 518'], ['one long read session', '12 / 408', '7 / 520'], ['read often, a 2000-byte file', '16 / 2272', '9 / 4160']], caption: 'The four workloads of the topic, each run both ways.' },
      { list: ['Many opens, few changes, small files: callbacks win on messages and server load.', 'Huge files read in part: block requests move far less.', 'Changes that must be seen during a session: attribute timeouts see them; whole-file sessions do not.', 'Server memory and recovery: callbacks are state; a stateless server has none.'] },
      dfsLab('Your own workload in the File-system lab', 'A reads the file three times while B changes it once. Run it NFS-style, switch the protocol to AFS-style, and compare the message counts and bytes in Metrics.', { dfiles: [{ name: 'notice', text: 'notice: meeting at nine' }], dscript: orc(0, 'A', 'notice').concat(orc(4, 'A', 'notice'), [row(9, 'B', 'open', 'notice'), row(9, 'B', 'write', 'notice', 'notice: meeting at ten'), row(9, 'B', 'close', 'notice')], orc(12, 'A', 'notice')) }),
      { h: 'Recap' },
      { list: ['Count messages, bytes, server operations and stale reads, on the real workload.', 'Callbacks: free repeated opens, whole files moved, server state.', 'Attribute caching: a question at every open and timeout, partial transfers, no server state.', 'Both lose updates when two writers overlap.'] },
      X('dfs-x-cost-table'), X('dfs-x-cost-size'), X('dfs-x-which'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
