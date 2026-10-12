// Part 16, distributed file systems: the chapters and the lessons of chapter 1 (160-dfs2.js has chapters 2 and 3).
// The exercises are in 161-dfs-ex.js and 161-dfs-ex2.js; the guided tour, the course and the pages the diagram checker
// looks at are in 162-dfs-ch.js. Each lesson opens with a question, runs the topic that shows the idea at a frame
// chosen for the point being made, asks for a prediction, sums up, and leads to its exercises. Every value quoted
// here is what the topics' own engine (S.DFS) says on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'dfs-wire')) return;

  C.chapter({ id: 'dfs-wire', part: 'dfs', n: 1, title: 'Clients, servers and retries', blurb: 'Every call becomes messages; a server that keeps no state about its clients survives lost messages and crashes because clients simply retry, and that is safe only for idempotent requests.' });
  C.chapter({ id: 'dfs-cache', part: 'dfs', n: 2, title: 'Client caching and consistency', blurb: 'Cached attributes that save messages and allow stale reads, flush on close and close-to-open, and the last close silently winning.' });
  C.chapter({ id: 'dfs-afs', part: 'dfs', n: 3, title: 'Whole files, callbacks and cost', blurb: 'Whole-file caching with callback promises, what a server crash does to them, and the two designs measured on the same work.' });
  const X = (id) => ({ exercise: id });
  /** what the last frame of dfs-stateless says about a fault (the version the server ends with, the retries) */
  const stateless = (fault) => { const t = S.byId && S.byId('dfs-stateless'); if (!t) return null; const fr = t.run(S.inputOf(t, { fault })).frames; return fr[fr.length - 1].meta; };
  const WR = stateless('writereply') || { version: 3 }, WV = WR.version;
  /** a card opening the File-system lab on its distributed workbench, set up like this */
  const row = (t, c, op, file, data) => ({ t, c, op, file, data: data || '' });
  const dfsLab = (title, text, more) => ({ lab: 'fs', title, text, setup: Object.assign({ mode: 'dfs', dproto: 'nfs', dlat: 1, dtimeout: 4, dattr: 3, ddup: true, dprobe: 0, dfiles: [{ name: 'tides', text: 'high water 06:10' }], dcrash: [], ddrops: [] }, more) });
  const EDIT = (f, data) => [row(0, 'A', 'open', f), row(0, 'A', 'read', f), row(0, 'A', 'write', f, data), row(0, 'A', 'close', f)];

  // =========================================================================================================
  // Chapter 1: clients, servers and retries
  // =========================================================================================================
  C.lesson({
    id: 'dfs-remote', chapter: 'dfs-wire', title: 'A file on another machine', minutes: 7,
    summary: 'With a distributed file system a program calls open, read, write and close as usual, but the file is on a server. The client\'s file system turns each call that needs the server into a request and waits for the reply. A round trip costs two trips across the network, so what a design sends, and what it can answer from the client\'s own memory, decides how long a program waits.',
    blocks: [
      'A program on a laptop opens a file, reads it, changes a line and closes it. The file lives on a server across the building. The program\'s code is the same as for a local file. What does the network have to carry, and how long does the program wait?',
      { def: 'client and server', text: 'the client is the machine running the program; its file system sends requests for the files it does not hold. The server keeps the files on its disk and answers each request with a reply.' },
      { def: 'round trip', text: 'a request and its reply. With a latency of L ticks each way, a client that waits for the reply waits 2L ticks, however few bytes the messages hold.' },
      { topic: 'dfs-model', frame: 0, caption: 'open becomes a request: A sends GETATTR to ask the server for the file\'s attributes, its version among them, before trusting anything it may hold.' },
      { topic: 'dfs-model', frame: 2, caption: 't = 2: the reply says version 1. The read finds no data in A\'s cache, so it sends READ.' },
      { predict: { q: 'A has read the file. The program now writes a new line and then closes the file. How many more messages does the network carry before close returns?', options: ['None: the write already went to the server', 'Two: a WRITE at close and its reply', 'Four: one pair for the write call, one for close'], answer: 1, explain: 'The write call only changes A\'s own copy. Close sends the change in one WRITE and waits for its reply. In all 6 messages, 152 bytes and 6 ticks.' } },
      { topic: 'dfs-model', frame: 6, caption: 'Close returns at t = 6: 6 messages (3 requests and their replies), 152 bytes, 3 operations at the server.' },
      { topic: 'dfs-model', input: { latency: 3 }, frame: 6, caption: 'The same program with 3 ticks each way takes 18 ticks: three round trips of 6. For small files the waiting is in the latency, not in the bytes.' },
      { h: 'Whole files instead' },
      'A different design sends the whole file to the client when it opens it, lets every read and write work on that copy, and sends the whole file back at close if it changed.',
      { topic: 'dfs-model', input: { protocol: 'afs' }, frame: 4, caption: 'AFS-style: FETCH at open, STORE at close. 4 messages, 120 bytes, 4 ticks; the read and the write sent nothing.' },
      { topic: 'dfs-model', input: { work: 'read' }, frame: 4, caption: 'NFS-style, reading twice: the second read is answered from A\'s cache while its attributes are fresh. 4 messages in all.' },
      { table: [['Call', 'NFS-style (block requests)', 'AFS-style (whole files)'], ['open', 'GETATTR: is my copy current?', 'FETCH the whole file'], ['read', 'from the cache, or GETATTR and READ', 'from the local copy'], ['write', 'kept at the client', 'kept at the client'], ['close', 'WRITE the changes back', 'STORE the file, if changed']], caption: 'What each call costs in the two designs this part follows.' },
      dfsLab('Your own program in the File-system lab', 'The distributed workbench: one client opening, reading, writing and closing a file 2 ticks from the server. Add reads, a second client, or switch the protocol, and count the messages.', { dlat: 2, dfiles: [{ name: 'menu', text: 'soup: leek' }], dscript: [row(0, 'A', 'open', 'menu'), row(0, 'A', 'read', 'menu'), row(0, 'A', 'read', 'menu'), row(0, 'A', 'write', 'menu', 'soup: fennel'), row(0, 'A', 'close', 'menu')] }),
      { h: 'Recap' },
      { list: ['Each call that needs the server becomes a request and a reply: a round trip.', 'With small files the latency dominates: count round trips, not bytes.', 'NFS-style clients check the version at open, read blocks when they need them and write back at close.', 'AFS-style clients move the whole file at open and at close, and touch only their copy in between.'] },
      X('dfs-x-trip'), X('dfs-x-requests'), X('dfs-x-why-cache'),
    ],
  });

  C.lesson({
    id: 'dfs-retry', chapter: 'dfs-wire', title: 'Retry until it works', minutes: 8,
    summary: 'A client that hears no reply cannot tell a lost request from a lost reply, a slow server or a crashed one. A stateless server makes the answer simple: the client sends the same request again, with the same transaction id, after a timeout. That is safe because each request carries everything the server needs and the common ones are idempotent: a READ or a WRITE at a given offset done twice leaves things as done once.',
    blocks: [
      'Client A sent a READ at t = 2. At t = 6 it has heard nothing. Was the request lost, or the reply? Is the server slow, or has it crashed? A cannot know, and it cannot wait for ever. What can it safely do?',
      { def: 'stateless server', text: 'a server that keeps no information about its clients between requests: no table of open files, no offsets, no record of who reads what. Each request names the file, the offset and the byte count, so it can be served on its own.' },
      { def: 'idempotent request', text: 'one that has the same effect, and gets the same reply, whether it is carried out once or several times. Reading, getting attributes and writing given bytes at a given offset are idempotent.' },
      { def: 'transaction id (xid)', text: 'a number the client puts in each request. A retry carries the same xid as the first try: it names the request, not the attempt.' },
      { topic: 'dfs-stateless', input: { fault: 'readreply' }, frame: 3, caption: 't = 3: the server answered, but the network loses the READ reply. From A\'s side nothing has happened at all.' },
      { topic: 'dfs-stateless', input: { fault: 'readreply' }, frame: 4, caption: 't = 6: 4 ticks with no reply. A sends the same READ again, same xid 2. The server serves it as if it were new.' },
      { topic: 'dfs-stateless', input: { fault: 'readreply' }, frame: 8, caption: 'The server carried out READ twice; reading is idempotent, so nothing changed. 1 retry, and the run ends at t = 10 instead of t = 6.' },
      { predict: { q: 'Now the WRITE that close sends is carried out, but its reply is lost. A sends the same WRITE again. What does the server do with it?', options: ['Writes the same bytes at the same offset again: the file ends the same', 'Recognises the retry and skips it', 'Appends the bytes a second time'], answer: 0, explain: 'The server keeps no record of what it has done, so it carries out the WRITE again. The same bytes land in the same place: the contents are what one WRITE would leave. Only the version number moves on twice, to ' + WV + '.' } },
      { topic: 'dfs-stateless', input: { fault: 'writereply' }, frame: 7, caption: 't = 9: the retry arrives. The server has no record of xid 3, so it carries out the WRITE again, and the version moves on to ' + WV + '. A stateless server cannot tell a retry from a new request.' },
      { topic: 'dfs-stateless', input: { fault: 'writereply' }, frame: 8, caption: 'The server ends with "High water at 06:25.", version ' + WV + ': the right bytes, written twice.' },
      { table: [['Request', 'Idempotent?', 'Why'], ['READ n bytes at offset k', 'yes', 'reading changes nothing'], ['GETATTR', 'yes', 'asking changes nothing'], ['WRITE these bytes at offset k', 'yes', 'the same bytes land in the same place'], ['append', 'no', 'each try adds the bytes again'], ['REMOVE, CREATE, RENAME', 'no', 'the second try finds the first one\'s result']], caption: 'Requests named by file and offset are idempotent; changes to names are not (next lessons).' },
      { warn: 'Idempotent requests make retries safe, not free: every retry costs a timeout of waiting and another round trip.' },
      dfsLab('A lost reply in the File-system lab', 'A edits tides; the reply to its WRITE is lost. Change the retry timeout, or lose the WRITE request instead of its reply, and compare.', { dtimeout: 3, dscript: EDIT('tides', 'high water 06:25'), ddrops: [{ t: 5, dir: 'reply', c: 'A', op: 'WRITE' }] }),
      { h: 'Recap' },
      { list: ['A client with no reply cannot tell which of four things went wrong.', 'So it waits a timeout and sends the same request, with the same xid.', 'A stateless server serves the retry like any request.', 'That is correct only if the request is idempotent.'] },
      X('dfs-x-idem'), X('dfs-x-silence'), X('dfs-x-twice'),
    ],
  });

  C.lesson({
    id: 'dfs-reboot', chapter: 'dfs-wire', title: 'A crash with nothing to rebuild', minutes: 7,
    summary: 'When a stateless server crashes and restarts, it has nothing to recover about its clients: no open files, no offsets, no promises. Clients simply keep retrying until it answers again. The cost falls on the clients, who wait out the outage one timeout at a time.',
    blocks: [
      'Halfway through A\'s read, the server loses power. Its disk is fine, but everything in its memory is gone. A server that remembered which clients had which files open, at which offsets, would come back with none of that. What does a server that remembers nothing have to do when it restarts?',
      { table: [['What a server might keep', 'Lost in a crash', 'A stateless server'], ['open files and offsets', 'yes', 'keeps none: requests carry the offset'], ['who caches which file', 'yes', 'keeps none: clients check for themselves'], ['locks', 'yes', 'left to a separate lock service'], ['the files themselves', 'no, they are on disk', 'the same']], caption: 'Stateless: nothing about clients lives only in the server\'s memory.' },
      { topic: 'dfs-stateless', input: { fault: 'crash', during: 'read', timeout: 4, down: 6 }, frame: 3, caption: 't = 3: the server crashes. A\'s READ arrives while it is down, and is lost.' },
      { topic: 'dfs-stateless', input: { fault: 'crash', during: 'read', timeout: 4, down: 6 }, frame: 6, caption: 't = 9: the server is back, in its second epoch. It has rebuilt nothing, because it had nothing to rebuild. A does not know yet: its retry at t = 6 was lost too.' },
      { predict: { q: 'The server is back at t = 9. A retries every 4 ticks without a reply, its last try having gone at t = 6. When does A get its data?', options: ['At t = 9, as soon as the server is back', 'At t = 12', 'At t = 10'], answer: 1, explain: 'A only acts when its timer runs out, at t = 10. That try arrives at t = 11 and the reply reaches A at t = 12.' } },
      { topic: 'dfs-stateless', input: { fault: 'crash', during: 'read', timeout: 4, down: 6 }, frame: 9, caption: 't = 12: the third try\'s reply arrives and the read returns. The rest of the program goes on as if nothing had happened.' },
      { topic: 'dfs-stateless', input: { fault: 'crash', during: 'write', timeout: 3, down: 12 }, frame: 14, caption: 'A 12-tick outage during the WRITE: 4 retries, close returns at t = 18. The program waited, but nothing was lost and nothing had to be recovered.' },
      { tip: 'A client that retries for ever makes a program wait out the whole outage (a hard mount). One that gives up after a few tries returns an error to the program instead (a soft mount), and many programs do not expect a read or a close to fail.' },
      dfsLab('An outage in the File-system lab', 'A edits tides while the server is down from t = 3 to t = 12. Shorten the retry timeout and count the messages a shorter wait costs.', { dtimeout: 3, dscript: EDIT('tides', 'high water 06:25'), dcrash: [{ t: 3, until: 12 }] }),
      { h: 'Recap' },
      { list: ['A stateless server recovers by restarting: it has no client state to rebuild.', 'Requests sent while it is down are lost; clients retry on their own timers.', 'The client waits at least until its first retry after the restart.', 'The price is paid in waiting, not in lost or wrong data.'] },
      X('dfs-x-retry-table'), X('dfs-x-outage'),
    ],
  });

  C.lesson({
    id: 'dfs-notidem', chapter: 'dfs-wire', title: 'Requests that are not idempotent', minutes: 7,
    summary: 'REMOVE, CREATE and RENAME change names, and a second try finds the first one\'s result: a retried REMOVE whose reply was lost fails with "no such file", though the file was removed. A duplicate-request cache at the server remembers recent requests by xid with the reply it gave, and answers a repeat with that reply. It lives in memory, so a crash between the first try and the retry defeats it.',
    blocks: [
      'A removes an old file. The server removes it and replies, but the reply is lost. A retries, as the last two lessons taught it to. What does the server say this time?',
      { topic: 'dfs-dupcache', input: { op: 'remove', dup: 'off', crash: 'no' }, frame: 1, caption: 'The server removed old-chart and replied; the reply is lost.' },
      { topic: 'dfs-dupcache', input: { op: 'remove', dup: 'off', crash: 'no' }, frame: 4, caption: 'The retry finds no file: A is told ENOENT, though its REMOVE worked. A program might report an error, or try something else, for a removal that succeeded.' },
      { def: 'duplicate-request cache', text: 'a small table in the server\'s memory of recent requests, by xid, with the reply each got. A request whose xid is in it is not carried out again: the stored reply is sent.' },
      { predict: { q: 'The same lost reply, but the server keeps a duplicate-request cache. What is A told?', options: ['Success', 'ENOENT', 'Nothing until the cache is cleared'], answer: 0, explain: 'The retry carries the same xid, 1. The cache holds the reply to xid 1, success, and the server sends it again without removing anything.' } },
      { topic: 'dfs-dupcache', input: { op: 'remove', dup: 'on', crash: 'no' }, frame: 3, caption: 't = 5: the server has already done REMOVE xid 1. Its cache sends the same answer again instead of doing it twice.' },
      { topic: 'dfs-dupcache', input: { op: 'remove', dup: 'on', crash: 'yes' }, frame: 5, caption: 'But the cache is in memory. A crash between the first try and the retry empties it, and the retry fails with ENOENT again.' },
      { topic: 'dfs-dupcache', input: { op: 'create', dup: 'off', crash: 'no' }, frame: 4, caption: 'CREATE (failing if the file exists) has the same problem the other way round: the retry finds the file the first try made, EEXIST.' },
      { table: [['Request', 'A second try finds', 'and fails with'], ['REMOVE f', 'no f', 'ENOENT'], ['CREATE f (exclusive)', 'f already there', 'EEXIST'], ['RENAME a to b', 'no a', 'ENOENT']], caption: 'Changes to names are not idempotent.' },
      { warn: 'The duplicate-request cache narrows the window; it does not close it. It holds only recent requests, and a crash forgets them all.' },
      dfsLab('A retried REMOVE in the File-system lab', 'The reply to A\'s REMOVE is lost. Turn the duplicate-request cache off and on, then add a server crash between the two tries.', { dtimeout: 3, ddup: false, dscript: [row(0, 'A', 'remove', 'tides')], ddrops: [{ t: 1, dir: 'reply', c: 'A', op: 'REMOVE' }] }),
      { h: 'Recap' },
      { list: ['REMOVE, CREATE and RENAME are not idempotent: a retry finds the first try\'s result.', 'A lost reply then turns a success into an error.', 'A duplicate-request cache replays the stored reply for a repeated xid.', 'It is in memory: a crash before the retry reopens the window.'] },
      X('dfs-x-dup-table'), X('dfs-x-dup-count'), X('dfs-x-dup-which'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
