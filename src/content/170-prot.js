// Part 17, protection and security: the chapters, and the lessons of chapter 1 (principles, domains and rings, the
// access matrix, lists against capabilities and revocation). Chapters 2 and 3 are in 170-prot2.js; the exercises in
// 171-prot-ex.js and 171-prot-ex2.js; the tour, the course and the checker's pages in 172-prot-ch.js. Every value
// quoted in a caption is what the topic's own frames say on the input given. The part is defensive throughout: a
// weakness is named as a concept, and the lesson teaches the defence.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'prt-principles')) return;

  C.chapter({ id: 'prt-principles', part: 'protection', n: 1, title: 'Principles and the access matrix', blurb: 'Least privilege, mechanism against policy, protection domains and rings, the access matrix with its operations, and how it is stored: lists, capabilities, keys, and taking rights back.' });
  C.chapter({ id: 'prt-unix', part: 'protection', n: 2, title: 'Users, permission bits and logins', blurb: 'UNIX users and groups, the nine permission bits and the special three, setuid as a domain switch, passwords stored salted and hashed, limits on guessing, and a second factor.' });
  C.chapter({ id: 'prt-defence', part: 'protection', n: 3, title: 'Memory safety and isolation', blurb: 'Why an unchecked copy is dangerous, and the defences: bounded copies, stack canaries, non-executable pages, shuffled addresses, sandbox policies, and keeping processes apart.' });
  const X = (id) => ({ exercise: id });

  // =========================================================================================================
  // Chapter 1: principles
  // =========================================================================================================
  C.lesson({
    id: 'prt-least', chapter: 'prt-principles', title: 'Least privilege, and mechanism against policy', minutes: 7,
    summary: 'Every program should hold the rights its work needs and no more, so that a mistake in it can reach as little as possible. Protection systems separate the mechanism (the code that enforces a rule) from the policy (which rules hold), so that the rules can change without touching the code that enforces them.',
    blocks: [
      'A web shop runs a web server and a database. Somebody set them up in a hurry and gave each one a few more rights than it uses, "just in case". Nothing is wrong today. What does that "just in case" cost on the day one of them has a bug?',
      { def: 'least privilege', text: 'each program, user or service is given exactly the rights its task needs, for only as long as it needs them. Anything more is excess: it does no work, and it widens what a fault can damage.' },
      { topic: 'prot-least-privilege', frame: 0, caption: '10 rights are granted to web and db; their tasks need 7. Each grant is checked against the needs, and each need against the grants.' },
      { predict: { q: 'The web server holds read on the keys file, which none of its tasks uses. Should it keep it?', options: ['Yes: rights that are never used cannot do any harm', 'No: if the web server ever misbehaves, the keys are within its reach', 'Only if the keys are encrypted'], answer: 1, explain: 'An unused right does nothing on a good day and everything on a bad one: a bug in the web server could now read the keys. Least privilege removes it.' } },
      { topic: 'prot-least-privilege', frame: 3, caption: 'web holds read on keys, but no task of its needs it: remove it.' },
      { topic: 'prot-least-privilege', frame: 5, caption: '7 of 10 granted rights are needed: 3 excess and 0 missing. Removing the 3 shrinks what a mistake in these programs could reach.' },
      { topic: 'prot-least-privilege', input: { sc: 'backup' }, frame: 5, caption: 'A nightly backup: 3 of 5 rights needed, 2 excess, and 1 missing. A missing right is the other kind of mistake: the job will fail.' },
      { h: 'Mechanism against policy' },
      'The rules change more often than the code that enforces them. A school lab is open to everyone on a normal day and closed to students on exam day. If the exam-day rule lives inside the checking code, every new rule means new code.',
      { def: 'mechanism and policy', text: 'the mechanism is how something is enforced (look up the entry, allow if it holds the right); the policy is what is allowed (who may read the notes today). A good mechanism enforces any policy it is given.' },
      { topic: 'prot-mechanism-policy', frame: 1, caption: 'The same checking function answers twice: student may read notes under "open lab", but not under "exam day". Only the policy changed.' },
      { topic: 'prot-mechanism-policy', frame: 7, caption: '4 answers of 6 differ, and not a line of the checking code changed: changing the rules for exam day is an edit of data.' },
      { h: 'Recap' },
      { list: ['Grant only what the task needs: an excess right is a risk with no benefit.', 'A missing right breaks the task; an excess one waits for a bug.', 'Keep the rules (policy) as data; keep the enforcing code (mechanism) small, general and unchanged.'] },
      X('prt-x-excess'), X('prt-x-share'), X('prt-x-policy'),
    ],
  });

  C.lesson({
    id: 'prt-domains', chapter: 'prt-principles', title: 'Protection domains and rings', minutes: 7,
    summary: 'A protection domain is a set of rights: which objects a process may touch and how. A process runs in one domain at a time and may move to another only through a switch right, at a fixed gate. Hardware rings are nested domains: the kernel\'s ring holds every right, the user ring the fewest.',
    blocks: [
      'A program asks the kernel to read a file for it. Moments before, the same program was refused when it tried to touch the page table itself. It is the same process both times. What changed between the refusal and the kernel doing the work?',
      { def: 'protection domain', text: 'a set of (object, rights) pairs. A process runs in exactly one domain at a time, and what it may do is what that domain holds.' },
      { def: 'switch right', text: 'a right whose object is another domain: a process in domain A holding switch on B may move into B, and from then on has B\'s rights instead of A\'s.' },
      { topic: 'prot-domains', frame: 2, caption: 'In the user ring the entry (user, page table) holds nothing: the access is stopped, and nothing changes.' },
      { predict: { q: 'The user domain holds switch on the kernel domain. May the process then jump to any kernel address it likes?', options: ['Yes: it holds the switch right', 'No: it enters only through a fixed gate, where the kernel\'s own checks run first', 'No: a user process can never enter the kernel'], answer: 1, explain: 'The switch right says the process may enter; the gate (a trap with a set entry point) decides where. Otherwise a caller could start after the code that checks its arguments.' } },
      { topic: 'prot-domains', frame: 3, caption: 'Entry (user, kernel) holds switch: the process moves into the kernel domain, through the gate, and now has the kernel\'s rights.' },
      { topic: 'prot-domains', frame: 4, caption: 'In the kernel ring the same process may write the page table: (kernel, page table) holds {read, write}.' },
      { h: 'More than two rings' },
      'Some machines have rings between the user and the kernel, for services that need more than a program but less than the kernel. Each ring is a domain with a gate to the next one in.',
      { topic: 'prot-domains', input: { story: 'service' }, frame: 4, caption: 'In the middle ring a logging service may write its log, but (service, disk) holds only {read}: it may not write the disk.' },
      { topic: 'prot-domains', input: { story: 'service' }, frame: 5, caption: 'From the service ring the process passes the gate into the kernel ring.' },
      { tip: 'Rings are nested: an inner ring has every right of the outer ones. Domains in general need not be nested; rings are the special case hardware can check cheaply on every instruction.' },
      { h: 'Recap' },
      { list: ['A domain is a set of rights; a process is in one domain at a time.', 'Changing domain is itself a right (switch), and it goes through a gate with a fixed entry.', 'Rings are nested domains checked by the hardware: user outside, kernel inside.'] },
      X('prt-x-gate'), X('prt-x-rings'),
    ],
  });

  C.lesson({
    id: 'prt-matrix', chapter: 'prt-principles', title: 'The access matrix and its operations', minutes: 8,
    summary: 'The access matrix has a row for each domain and a column for each object; the entry holds the rights. Domains are columns too, holding switch and control. Rights can be passed on only under rules: a copy flag (*) lets a holder copy a right, owner lets a domain change its object\'s column, and control lets a domain change another domain\'s row.',
    blocks: [
      'Three teams share files and a printer. A team lead wants to let another team write one of her files, and that team wants to pass the right on to a third. Who decides whether it may? Rights that can be passed on freely end up anywhere.',
      { def: 'access matrix', text: 'rows are domains, columns are objects (and the domains themselves); entry (D, O) is the set of rights a process in D has on O.' },
      { topic: 'prot-matrix-ops', frame: 0, caption: 'Three domains and three objects, and the domains as columns too. A * marks the copy flag; owner controls a column; control controls a row; switch lets a process move into a domain.' },
      { def: 'copy flag', text: 'right* lets the holder copy the right into another domain\'s entry in the same column. A copy keeps the *; a limited copy gives the right without it; a transfer gives right* and the giver loses it.' },
      { topic: 'prot-matrix-ops', frame: 2, caption: 'D2 got write* from D1, so it may copy write* on to D3.' },
      { predict: { q: 'D2 gives D3 read on F2 by a limited copy. May D3 now copy read on F2 to someone else?', options: ['Yes, it holds read', 'No: it holds read without the *', 'Only with the owner\'s consent'], answer: 1, explain: 'A limited copy drops the copy flag. D3 may read F2 but not pass the right on: the giver keeps control of how far it spreads.' } },
      { topic: 'prot-matrix-ops', frame: 4, caption: 'D3 holds no read* on F2, so it may not copy read: the copy flag is missing.' },
      { h: 'Owner and control' },
      { topic: 'prot-matrix-ops', input: { seq: 'owner' }, frame: 3, caption: 'D1 owns F1 and may add or remove any right in F1\'s column; D2 does not own F1, so it may not add rights there.' },
      { topic: 'prot-matrix-ops', input: { seq: 'control' }, frame: 1, caption: 'D2 holds control over D3, so it may remove print on the printer from D3\'s row.' },
      { table: [['Right', 'Held in', 'Lets the holder'], ['right*', '(D, O)', 'copy the right into another row of column O'], ['owner', '(D, O)', 'add or remove any right in column O'], ['control', '(D, D\')', 'remove rights from row D\''], ['switch', '(D, D\')', 'move a process from D into D\'']], caption: 'The four rights that change the matrix or the domain.' },
      { h: 'Recap' },
      { list: ['Rows are domains, columns are objects and domains; entries are sets of rights.', 'A copy flag limits who may pass a right on; a limited copy stops the chain.', 'owner rules a column, control rules a row, switch moves a process between domains.'] },
      X('prt-x-copy-flag'), X('prt-x-after-ops'),
    ],
  });

  C.lesson({
    id: 'prt-lists', chapter: 'prt-principles', title: 'Lists, capabilities, and taking rights back', minutes: 9,
    summary: 'Most entries of an access matrix are empty, so it is never stored whole. Kept by column it becomes access-control lists, one per object; kept by row it becomes capability lists, one per domain; a lock-and-key scheme sits between. The choice decides what is quick: an ACL answers "who may use this object?" and revokes selectively at once; a capability is checked quickly but is hard to take back.',
    blocks: [
      'A file server has ten thousand users and a million files. Each user may touch a few hundred files. A table with a cell for every pair would hold ten billion cells, nearly all empty. How should the rights be stored, and what does that choice make easy or hard?',
      { topic: 'prot-matrix-impl', frame: 0, caption: 'May D3 read F1? The matrix holds 8 non-empty entries among 18 places.' },
      { topic: 'prot-matrix-impl', frame: 1, caption: 'A global table of triples: found after 7 of 8. The whole table may have to be searched, and it is too big for fast memory.' },
      { def: 'access-control list (ACL)', text: 'one column of the matrix kept with its object: the domains that may use it, and how. UNIX permission bits are a very short ACL: owner, group, others.' },
      { topic: 'prot-matrix-impl', frame: 2, caption: 'F1\'s access list names D3 with {read}, entry 2 of 2: only this object\'s list is read, and its owner can see who has access.' },
      { def: 'capability', text: 'one entry of a row, held by the domain: an unforgeable token naming an object and the rights on it. The kernel keeps capabilities where the domain cannot change them, and a domain uses one simply by presenting it.' },
      { topic: 'prot-matrix-impl', frame: 3, caption: 'D3 presents its capability for F1 with {read}: a quick check, because the domain holds the capability itself.' },
      { topic: 'prot-matrix-impl', frame: 4, caption: 'Lock and key: D3\'s key k3 fits one of F1\'s read locks {k1, k3}.' },
      { predict: { q: 'Rights are to be taken away from one domain only, at once. Which form makes that a single small edit?', options: ['Capabilities: they are spread over every domain\'s list', 'Access-control lists: edit the object\'s own list', 'The global table: it holds everything in one place'], answer: 1, explain: 'An ACL is the object\'s own column: striking one domain from it is immediate and touches nobody else. Capabilities are scattered among the domains that hold them.' } },
      { h: 'Taking rights away' },
      { topic: 'prot-revocation', frame: 1, caption: 'ACL: walk F1\'s list (2 entries) and strike read from D1 and D3. Immediate, and it can pick any one domain.' },
      { topic: 'prot-revocation', frame: 3, caption: 'Capabilities: finding every one for F1 means searching all 8; real systems use back-pointers, indirection or keys to avoid that search.' },
      { topic: 'prot-revocation', frame: 5, caption: 'Indirection or a new key takes the right from everyone at once; only back-pointers stay selective, at a cost.' },
      { table: [['', 'Access lists', 'Capabilities'], ['Kept', 'with the object (a column)', 'with the domain (a row)'], ['Check', 'search the object\'s list', 'present the token'], ['Who may use this object?', 'read one list', 'search every domain'], ['Revoke one domain, now', 'edit one list', 'needs back-pointers'], ['Fits', 'files people share', 'passing a right with a request']], caption: 'Access lists against capabilities.' },
      { tip: 'Real systems mix the two: the ACL is checked once, at open, and the open file descriptor then works like a capability for the reads and writes that follow.' },
      { h: 'Recap' },
      { list: ['The matrix is sparse: store it by column (ACLs), by row (capabilities), or with locks and keys.', 'ACLs make review and revocation easy; capabilities make the check quick and rights easy to pass on.', 'Revoking a capability selectively and at once needs extra machinery.'] },
      X('prt-x-acl-list'), X('prt-x-scan'), X('prt-x-revoke-cost'), X('prt-x-revoke-pick'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
