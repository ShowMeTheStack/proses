// Part 17, protection and security: the exercises of chapter 2 (UNIX permission bits, setuid, stored passwords,
// limits on guessing and a second factor) and chapter 3 (the defences against memory-safety bugs, sandboxes and
// isolation). Every answer is worked out here by the engines (S.Prot): nothing is typed from memory. The exercises
// teach the defences; none of them builds an attack.
(function (S) {
  'use strict';
  const C = S.Content, P = S.Prot;
  if (!C || !P || C.exercises.has('prt-x-mode-strings')) return;
  const U = 'prt-unix', D = 'prt-defence';
  const yn = (b) => (b ? 'yes' : 'no');
  const sys = P.unix();
  const fileLine = (p) => '`' + P.modeString(sys.files[p].mode, sys.files[p].type) + '` ' + p;
  const sysText = 'The machine of [the permission-bits topic](#topic=prot-unix-perms): users ana (uid 1001; groups users and lab), ben (uid 1002; group users) and eve (uid 1003; group guests). Files, with owner and group: ' +
    ['/home (root, root)', '/home/ana (ana, users)', '/home/ana/notes.txt (ana, users)', '/home/ben (ben, users)', '/home/ben/public.txt (ben, users)', '/tmp (root, root)', '/tmp/ana.log (ana, users)', '/lab (root, lab)', '/lab/data.csv (ana, lab)']
      .map((t) => { const p = t.split(' ')[0]; return '`' + P.modeString(sys.files[p].mode, sys.files[p].type) + '` ' + t; }).join('; ') + '. The root directory / is `drwxr-xr-x`.';

  // =========================================================================================================
  // Permission bits
  // =========================================================================================================
  const MODES = [0o640, 0o711, 0o1777, 0o4755, 0o2770, 0o460];
  const mRows = MODES.map((m) => m.toString(8));
  const mCells = Object.fromEntries(MODES.map((m, i) => [mRows[i] + '|bits', P.modeString(m)]));
  C.exercise({ id: 'prt-x-mode-strings', chapter: U, title: 'Octal to letters', level: 1, kind: 'table',
    text: ['Write each mode as the nine letters `ls -l` shows after the type letter, like `rw-r-----`. A setuid bit shows as s in the owner\'s x place, setgid as s in the group\'s, and the sticky bit as t in the others\' (a capital S or T when the x under it is off).'],
    rows: mRows, cols: ['bits'], cells: mCells, cellKind: 'text',
    hints: ['Each octal digit is three bits, r = 4, w = 2, x = 1, for owner, group and others in turn.', 'A fourth, leading digit holds the special bits: 4 setuid, 2 setgid, 1 sticky.', MODES.map((m, i) => mRows[i] + ' is ' + mCells[mRows[i] + '|bits']).join('; ') + '.'],
    solution: mCells, wrong: [Object.assign({}, mCells, { '4755|bits': 'rwxr-xr-x' }), Object.assign({}, mCells, { '1777|bits': 'rwxrwxrwx' })] });

  const STRS = ['rwxr-x---', 'rw-rw-r--', 'rwsr-xr-x', 'rwxrwxrwt', 'r--------', 'rwxr-sr-x'];
  const oCells = Object.fromEntries(STRS.map((s) => [s + '|octal', P.parseMode(s).toString(8)]));
  C.exercise({ id: 'prt-x-mode-octal', chapter: U, title: 'Letters to octal', level: 2, kind: 'table',
    text: ['Write each mode in octal, as `chmod` takes it: three digits, or four when a setuid, setgid or sticky bit is on (setuid 4, setgid 2, sticky 1 in the leading digit).'],
    rows: STRS, cols: ['octal'], cells: oCells, cellKind: 'text',
    hints: ['Add r = 4, w = 2, x = 1 within each group of three letters.', 'An s or t also stands for x being on, and adds its special bit to a leading digit.', STRS.map((s) => s + ' = ' + oCells[s + '|octal']).join('; ') + '.'],
    solution: oCells, wrong: [Object.assign({}, oCells, { 'rwsr-xr-x|octal': '755' }), Object.assign({}, oCells, { 'rwxrwxrwt|octal': '777' })] });

  const CQ = [['ben', '/home/ana/notes.txt'], ['eve', '/home/ben/public.txt'], ['ana', '/lab/data.csv'], ['ana', '/home/ben/public.txt'], ['root', '/etc/shadow']];
  const cRows = CQ.map(([u, p]) => u + ' reads ' + p);
  const cRes = CQ.map(([u, p]) => P.access(sys, u, p, 'read'));
  const cCells = Object.fromEntries(cRes.map((r, i) => [cRows[i] + '|class', r.cls]));
  C.exercise({ id: 'prt-x-class', chapter: U, title: 'Whose bits count?', level: 2, kind: 'table',
    text: [sysText + ' And `/etc/shadow` is `-rw-------`, owned by root.', 'For each read, which one class of bits does the kernel use for the file itself: owner, group or other? Write root when the process runs as root and the bits are not consulted.'],
    rows: cRows, cols: ['class'], cells: cCells, cellKind: 'text',
    hints: ['The kernel picks exactly one class: owner if the process\'s uid owns the file, else group if the file\'s group is one of the process\'s groups, else other.', 'Only that class\'s three bits count, even if another class would allow more.', cRes.map((r) => r.steps[r.steps.length - 2].say).join(' ')],
    solution: cCells, wrong: [Object.assign({}, cCells, { [cRows[2] + '|class']: 'group' }), Object.assign({}, cCells, { [cRows[3] + '|class']: 'other' })] });

  const BOPS = [['a', 'list', '/home/ben'], ['b', 'list', '/home/ana'], ['c', 'write', '/home/ana/notes.txt'], ['d', 'create', '/home/ana/todo.txt'], ['e', 'read', '/lab/data.csv'], ['f', 'delete', '/home/ben/public.txt']];
  const bRes = BOPS.map(([, op, p]) => P.access(sys, 'ben', p, op));
  const bOk = BOPS.filter((_, i) => bRes[i].ok).map((b) => b[0]);
  C.exercise({ id: 'prt-x-ben-ops', chapter: U, title: 'What may ben do?', level: 2, kind: 'set',
    text: [sysText, 'ben tries: (a) list /home/ben; (b) list /home/ana; (c) write /home/ana/notes.txt; (d) create /home/ana/todo.txt; (e) read /lab/data.csv; (f) delete /home/ben/public.txt. Which are allowed? Answer as a set of letters, like {a, c}.'],
    answer: '{' + bOk.join(', ') + '}',
    hints: ['Every directory on the way needs x for ben\'s class; listing a directory needs r on it; creating or deleting a name needs w on the directory that holds it.', 'ben is in group users, which owns /home/ana; he is not in lab.', BOPS.map(([k], i) => '(' + k + ') ' + bRes[i].steps[bRes[i].steps.length - (bRes[i].ok ? 2 : 1)].say).join(' ')],
    solution: '{' + bOk.join(', ') + '}', wrong: ['{a, b, c, f}', '{a, f}'], whyNot: 'Check each one in turn: search on every directory, then the right bit on the file, or w on the directory for create and delete.' });

  const eve = P.access(sys, 'eve', '/home/ana/notes.txt', 'read');
  const STOPS = ['/', '/home', '/home/ana', '/home/ana/notes.txt'];
  C.exercise({ id: 'prt-x-eve-stop', chapter: U, title: 'Where is eve stopped?', level: 1, kind: 'choice',
    text: [sysText, 'eve asks to read /home/ana/notes.txt. Where does the check refuse her?'],
    options: STOPS.map((p) => '`' + p + '`'), answer: STOPS.indexOf(eve.denied),
    whyNot: { 0: '/ is drwxr-xr-x: the others\' bits include x, so eve may pass.', 1: '/home is drwxr-xr-x too.', 3: 'The check never reaches the file: it stops at a directory on the way.' },
    hints: ['Before the file\'s own bits, every directory on the path needs x (search) for eve\'s class.', 'eve owns none of these and is in none of their groups, so the others\' bits count every time.', eve.steps.map((s) => s.say).join(' ')],
    solution: STOPS.indexOf(eve.denied), wrong: [3, 1] });

  const sticky = P.access(sys, 'ben', '/tmp/ana.log', 'delete');
  C.exercise({ id: 'prt-x-sticky', chapter: U, title: 'A shared scratch directory', level: 2, kind: 'choice',
    text: ['/tmp is `drwxrwxrwt` and owned by root; /tmp/ana.log is `-rw-rw-rw-` and owned by ana. ben asks to delete /tmp/ana.log. What happens, and why?'],
    options: ['Refused: the sticky bit lets only the file\'s owner, the directory\'s owner or root delete in /tmp', 'Allowed: everyone may write /tmp, and deleting a name only needs w on the directory', 'Allowed: the file is writable by everyone', 'Refused: ben may not search /tmp'],
    answer: 0, whyNot: { 1: 'That is the rule without the t: the sticky bit adds an ownership test for deleting and renaming.', 2: 'Deleting a name changes the directory, not the file; the file\'s bits do not decide it.', 3: 'The others\' bits on /tmp are rwt, and t includes x.' },
    hints: ['Deleting a name is a write to the directory that holds it.', 'What does the t in the others\' place add?', sticky.steps.map((s) => s.say).join(' ')],
    solution: 0, wrong: [1, 2] });

  const ow = P.access(sys, 'ana', '/lab/data.csv', 'write');
  C.exercise({ id: 'prt-x-owner-bits', chapter: U, title: 'The owner may do less', level: 3, kind: 'choice',
    text: ['/lab/data.csv is `-r--rw----`, owned by ana, group lab. ana is in group lab, and /lab is `drwxrws---` (root, lab). ana asks to write the file. What happens?'],
    options: ['Refused: ana owns the file, so only the owner bits r-- count, though the group bits would allow it', 'Allowed: ana is in group lab, whose bits include w', 'Allowed: the owner of a file may always write it', 'Refused: ana may not search /lab'],
    answer: ow.ok ? 1 : 0, whyNot: { 1: 'The kernel does not try every class: it picks the first that fits, and owner comes first.', 2: 'The owner may change the mode with chmod, but until then the owner bits decide.', 3: 'ana is in group lab, and the group bits of /lab are rws: x is on.' },
    hints: ['Exactly one class is chosen, in the order owner, group, other.', 'ana owns the file, so the class is owner, whatever her groups are.', ow.steps.map((s) => s.say).join(' ')],
    solution: ow.ok ? 1 : 0, wrong: [1, 2] });

  // =========================================================================================================
  // setuid
  // =========================================================================================================
  const XQ = [['ana', '/usr/bin/passwd'], ['eve', '/usr/bin/passwd'], ['ana', '/usr/bin/ls']];
  const xRows = XQ.map(([u, p]) => u + ' runs ' + p);
  const xRes = XQ.map(([u, p]) => P.execAs(sys, u, p));
  const xCells = {};
  xRes.forEach((r, i) => { xCells[xRows[i] + '|real uid'] = r.ruid; xCells[xRows[i] + '|effective uid'] = r.euid; });
  C.exercise({ id: 'prt-x-setuid-ids', chapter: U, title: 'Real and effective uid', level: 2, kind: 'table',
    text: ['`/usr/bin/passwd` is `-rwsr-xr-x` and `/usr/bin/ls` is `-rwxr-xr-x`, both owned by root (uid 0). ana is uid 1001 and eve uid 1003. Fill in the real and the effective uid of each new program.'],
    rows: xRows, cols: ['real uid', 'effective uid'], cells: xCells, cellKind: 'number',
    hints: ['The real uid is always the user who started the program.', 'The setuid bit (the s in the owner\'s place) sets the effective uid to the file\'s owner; without it the effective uid stays the user\'s.', xRes.map((r) => r.steps[r.steps.length - 1].say).join(' ')],
    solution: xCells, wrong: [Object.assign({}, xCells, { [xRows[0] + '|effective uid']: 1001 }), Object.assign({}, xCells, { [xRows[0] + '|real uid']: 0 })] });

  C.exercise({ id: 'prt-x-setuid-care', chapter: U, title: 'Writing a setuid program carefully', level: 2, kind: 'choice',
    text: ['A small setuid-root program lets users change their own entry in a protected file. Which design follows least privilege best?'],
    options: ['Check the caller\'s real uid and change only that user\'s entry, then drop root as soon as the file is written', 'Run the whole program as root and trust the arguments it is given', 'Make the protected file world-writable so the program need not be setuid', 'Let the program run any command the user names, as root, for flexibility'],
    answer: 0, whyNot: { 1: 'A setuid program runs with its owner\'s rights for whoever starts it: everything it is given must be checked.', 2: 'That removes protection from the file altogether: every user could change every entry.', 3: 'That hands root to every user.' },
    hints: ['Whoever runs it gets root\'s rights inside it, so the program is a door into root\'s domain.', 'The safest door is narrow: it checks who is asking, does one small thing, and closes quickly.', 'Check the real uid, change only that user\'s entry, and give up the extra rights as soon as they are no longer needed.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Stored passwords
  // =========================================================================================================
  const noSalt = P.store([{ name: 'kim', password: 'maple-7' }, { name: 'lee', password: 'harbor' }, { name: 'max', password: 'maple-7' }], { salted: false, rounds: 3 });
  const salted = P.store([{ name: 'kim', password: 'maple-7' }, { name: 'lee', password: 'harbor' }, { name: 'max', password: 'maple-7' }], { salted: true, rounds: 3, seed: 11 });
  C.exercise({ id: 'prt-x-salt', chapter: U, title: 'Why a salt?', level: 1, kind: 'choice',
    text: ['kim and max chose the same password. Stored with no salt, the password file holds ' + noSalt.records.map((r) => r.name + ' ' + r.hash).join(', ') + '. With a fresh random salt for each account it holds ' + salted.records.map((r) => r.name + ' ' + r.salt + ':' + r.hash).join(', ') + '. (The hash here is a toy, for following the steps.) What does the salt change?'],
    options: ['Equal passwords no longer give equal stored hashes, and no table of hashes computed in advance fits every account', 'It makes the password longer for the user to type', 'It hides the password from the server while it is checked', 'It lets the server decrypt the password when needed'],
    answer: 0, whyNot: { 1: 'The salt is stored by the system and added by it; the user never types it.', 2: 'The server still sees the typed password at login and hashes it with the salt.', 3: 'A hash cannot be decrypted; the server only ever compares hashes.' },
    hints: ['Compare kim\'s and max\'s records in the two files.', 'Without salt the file itself shows that two users share a password, and one precomputed table of hashes would serve every account.', noSalt.steps[noSalt.steps.length - 1].say + ' ' + salted.steps[salted.steps.length - 1].say],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'prt-x-slow', chapter: U, title: 'Why a slow hash?', level: 2, kind: 'choice',
    text: ['A password file is stolen. Its records are salted. Why should the stored hash also be slow to compute (many rounds, or a deliberately costly function)?'],
    options: ['Each guess tried against the stolen file costs the guesser that much work, while one login costs the server only once', 'It makes logins faster for real users', 'A slow hash produces shorter records', 'It makes salts unnecessary'],
    answer: 0, whyNot: { 1: 'It makes each login a little slower, which is the point: the cost is small once and large a billion times.', 2: 'The length of the output has nothing to do with its speed.', 3: 'Salts and slowness defend against different things; good systems use both.' },
    hints: ['The rate limit on the login page does not apply to a copy of the file.', 'Off line, the only brake left is how long one hash takes.', 'A real system checks one password per login; a guesser must hash every guess. Making each hash costly costs the server a little and the guesser enormously. (The toy hash in these pages is fast on purpose, only to follow the steps.)'],
    solution: 0, wrong: [1, 3] });

  // =========================================================================================================
  // Limiting guesses, and a second factor
  // =========================================================================================================
  const RL = { free: 2, delay: 1, lockAfter: 6, attempts: [0, 1, 2, 3, 4, 6, 8, 16, 17, 18].map((t, i) => ({ t, ok: i === 7 })) };
  const rl = P.rateLimit(RL);
  const rRows = RL.attempts.map((a) => 't = ' + a.t + (a.ok ? ' (right)' : ' (wrong)'));
  const rCells = Object.fromEntries(rl.results.map((r, i) => [rRows[i] + '|outcome', r.outcome]));
  C.exercise({ id: 'prt-x-rate', chapter: U, title: 'A login that slows down', level: 3, kind: 'table',
    text: ['A login allows 2 free failures in a row. After that, each new attempt must wait 1 s × 2^(failures − 2) since the last checked attempt, or it is refused unchecked (too-soon). After 6 failures the account locks. A right password resets the failure count.',
      'Attempts come at the times shown, with the right password only at t = 16. Write each outcome: ok, fail, too-soon or locked.'],
    rows: rRows, cols: ['outcome'], cells: rCells, cellKind: 'text',
    hints: ['Keep two numbers: the failures in a row, and the time of the last attempt that was checked.', 'A too-soon attempt is not checked, so it neither counts as a failure nor moves the time of the last attempt.', rl.steps.map((s) => s.say).join(' ')],
    solution: rCells, wrong: [Object.assign({}, rCells, { [rRows[3] + '|outcome']: 'fail' }), Object.assign({}, rCells, { [rRows[8] + '|outcome']: 'too-soon' })] });

  const GB = { free: 5, delay: 2, lockAfter: 20, seconds: 3600 };
  const gb = P.guessBudget(GB);
  C.exercise({ id: 'prt-x-budget', chapter: U, title: 'Guesses in an hour', level: 3, kind: 'number',
    text: ['A login allows 5 free failures, then waits that start at 2 s and double after each further failure; it locks after 20 failures. However fast someone types, at most how many wrong passwords can be tried in one hour (3600 s) against one account?'],
    answer: gb.guesses, whyNot: { '20': 'The lock is at 20, but the doubling waits run out the hour first.', '1800': 'That ignores the doubling: the waits grow after every failure.', '*': 'Add up the waits: none for the first 5, then 2, 4, 8, ... seconds, and stop when the next would pass 3600.' },
    hints: ['The first 5 attempts need no wait. The 6th needs 2 s, the 7th 4 s, and so on.', 'The total time after k waits is 2 + 4 + ... + 2^k = 2^(k+1) − 2 seconds.', gb.say + ' (2 + 4 + ... + 2048 = 4094 s is already past the hour.)'],
    solution: gb.guesses, wrong: [20, 1800] });

  C.exercise({ id: 'prt-x-mfa', chapter: U, title: 'A code used twice', level: 2, kind: 'choice',
    text: ['A login asks for the password and then a six-digit code from the user\'s device, which changes every 30 s. The server accepts the code for the current time step or one step either side, for clock drift. A code that has just logged a user in is typed again in the same 30 s. What should the server do, and why?'],
    options: ['Refuse it: each code may be used only once, so a code seen by someone else is worthless', 'Accept it: it is still inside its time window', 'Accept it, but ask for the password again', 'Lock the account at once'],
    answer: 0, whyNot: { 1: 'The window is there for clock drift, not for reuse: a code that worked once must not work again.', 2: 'The password is the first factor; it says nothing about whether this code was already spent.', 3: 'A reused code is refused; locking on one refusal would let anyone lock others out.' },
    hints: ['A one-time code is meant to be good for one login only.', 'The server can remember the last time step a user logged in with.', 'Refuse any code from a time step at or before the last one used, as [the login topic](#topic=prot-login) shows with "replay".'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Chapter 3: canaries and bounded copies
  // =========================================================================================================
  C.exercise({ id: 'prt-x-overrun', chapter: D, title: 'How far past the buffer?', level: 1, kind: 'number',
    text: ['A function keeps a 24-byte buffer on its stack and copies 40 bytes of input into it with no length check. How many bytes land past the end of the buffer?'],
    answer: 40 - 24, whyNot: { '40': 'That is the whole input; the first 24 bytes fit.', '24': 'That is the buffer itself.', '*': 'Subtract the buffer\'s size from the bytes copied.' },
    hints: ['The buffer takes the first bytes; the rest run on into whatever lies above it.', 'Above the buffer sit the canary (if any), the saved frame pointer and the return address.', '40 − 24 = 16 bytes too many. A bounded copy, taking min(40, 24) = 24 bytes, would touch nothing past the buffer.'],
    solution: 16, wrong: [40, 24] });

  const CQ2 = [[12, true, false], [30, true, false], [40, false, false], [40, true, true], [28, false, false]];
  const kRows = CQ2.map(([n, c, b]) => n + ' bytes, ' + (c ? 'canary' : 'no canary') + ', ' + (b ? 'bounded' : 'unchecked'));
  const kRes = CQ2.map(([n, c, b]) => P.copyInto(P.frame({ buffer: 16, canary: c, seed: 5 }), n, { bounded: b }));
  const kCells = {};
  kRes.forEach((r, i) => { kCells[kRows[i] + '|damaged'] = r.damaged.length; kCells[kRows[i] + '|outcome'] = r.outcome; });
  C.exercise({ id: 'prt-x-canary-table', chapter: D, title: 'What each defence does', level: 2, kind: 'table',
    text: ['A function has a 16-byte buffer. Above it, from low to high addresses: an 8-byte canary (when the compiler adds one), the 8-byte saved frame pointer, and the 8-byte return address.',
      'For each call, how many of those slots above the buffer are damaged, and what is the outcome? Write ok (fits, returns normally), truncated (a bounded copy cut the input short), stopped (the canary check caught the damage before returning) or crash (the program fails with damaged state).'],
    rows: kRows, cols: ['damaged', 'outcome'], cells: kCells,
    hints: ['Count the extra bytes, then lay them over the 8-byte slots above the buffer in order.', 'A bounded copy never writes past the buffer. With a canary, damage to it is noticed before the function returns.', kRes.map((r, i) => kRows[i] + ': ' + r.steps.slice(1).map((s) => s.say).join(' ')).join(' ')],
    solution: kCells, wrong: [Object.assign({}, kCells, { [kRows[1] + '|outcome']: 'crash' }), Object.assign({}, kCells, { [kRows[2] + '|damaged']: 3 })] });

  // =========================================================================================================
  // NX and ASLR
  // =========================================================================================================
  const PAGES = [{ name: 'text', perms: 'r-x' }, { name: 'rodata', perms: 'r--' }, { name: 'heap', perms: 'rw-' }, { name: 'stack', perms: 'rw-' }];
  const ACC = [{ page: 'text', op: 'exec' }, { page: 'rodata', op: 'write' }, { page: 'heap', op: 'exec' }, { page: 'rodata', op: 'read' }, { page: 'stack', op: 'write' }, { page: 'text', op: 'write' }];
  const nx = P.nx({ pages: PAGES, accesses: ACC });
  const verb = { exec: 'execute', read: 'read', write: 'write' };
  const nRows = ACC.map((a) => verb[a.op] + ' ' + a.page);
  const nCells = Object.fromEntries(nx.results.map((r, i) => [nRows[i] + '|allowed?', yn(r.ok)]));
  C.exercise({ id: 'prt-x-nx-table', chapter: D, title: 'Page bits on every access', level: 2, kind: 'table',
    text: ['A program\'s pages: ' + PAGES.map((p) => p.name + ' `' + p.perms + '`').join(', ') + '. The hardware checks each access against the page\'s bits. Write yes if it is allowed and no if the CPU faults.'],
    rows: nRows, cols: ['allowed?'], cells: nCells, cellKind: 'text',
    hints: ['r, w and x are separate bits; a - means that kind of access faults.', 'The NX bit is the missing x on data pages: bytes there can be read and written but never run as code.', nx.steps.slice(1).map((s) => s.say).join(' ')],
    solution: nCells, wrong: [Object.assign({}, nCells, { [nRows[2] + '|allowed?']: 'yes' }), Object.assign({}, nCells, { [nRows[5] + '|allowed?']: 'yes' })] });

  const LAYOUTS = [
    [{ name: 'text', perms: 'r-x' }, { name: 'heap', perms: 'rw-' }, { name: 'stack', perms: 'rw-' }],
    [{ name: 'text', perms: 'r-x' }, { name: 'heap', perms: 'rw-' }, { name: 'stack', perms: 'rwx' }],
    [{ name: 'text', perms: 'r--' }, { name: 'heap', perms: 'rw-' }, { name: 'stack', perms: 'rw-' }],
    [{ name: 'text', perms: 'rwx' }, { name: 'heap', perms: 'r--' }, { name: 'stack', perms: 'rw-' }],
  ];
  const wx = LAYOUTS.map((L) => P.nx({ pages: L, accesses: [] }).wx);
  const bad = wx.map((w, i) => (w.length ? i : -1)).filter((i) => i >= 0);
  C.exercise({ id: 'prt-x-wx', chapter: D, title: 'Writable or executable', level: 1, kind: 'choice',
    text: ['W^X ("write xor execute") says no page may be both writable and executable. Which layouts break it? Choose every one that does.'],
    options: LAYOUTS.map((L) => L.map((p) => p.name + ' ' + p.perms).join(', ')), answer: bad,
    whyNot: Object.fromEntries(LAYOUTS.map((L, i) => [i, 'No page here has both w and x.']).filter(([i]) => !wx[i].length)),
    hints: ['Look only for pages whose bits hold both w and x.', 'A page that is read-only, or executable but not writable, keeps the rule.', LAYOUTS.map((L, i) => 'Layout ' + (i + 1) + ': ' + (wx[i].length ? wx[i].join(', ') + ' is writable and executable' : 'W^X holds')).join('; ') + '.'],
    solution: bad, wrong: [[0], [bad[0]]] });

  const aslr = P.aslr({ regions: [{ name: 'libraries', base: 0x70000000, bits: 14 }], runs: 1, seed: 3 });
  const slots = Math.round(1 / aslr.odds.libraries);
  C.exercise({ id: 'prt-x-aslr', chapter: D, title: 'How many places to start?', level: 1, kind: 'number',
    text: ['At every start, address-space layout randomisation moves the shared libraries by a whole number of 4096-byte pages, chosen at random from 2^14 possibilities. In how many different places can the libraries start?'],
    answer: slots, whyNot: { '14': 'That is the number of random bits, not the number of places.', '67108864': 'That is how many bytes the libraries can move over, 2^14 × 4096: count places, not bytes.', '*': '14 random bits choose one of 2^14 places.' },
    hints: ['Each random bit doubles the number of places.', 'The page size sets how far apart the places are, not how many there are.', '2^14 = ' + slots + ' places: a fixed address guessed in advance is right for one run with odds of 1 in ' + slots + ', and a wrong guess usually crashes the program, which is noticed.'],
    solution: slots, wrong: [14, 67108864] });

  // =========================================================================================================
  // Sandboxes and isolation
  // =========================================================================================================
  const SB = { policy: { calls: ['read', 'write', 'open', 'close', 'exit'], paths: ['/box/'], write: ['/box/out/'], net: false },
    requests: [{ call: 'open', path: '/box/in/report.csv' }, { call: 'open', path: '/box/out/chart.svg', write: true }, { call: 'open', path: '/box/in/report.csv', write: true }, { call: 'open', path: '/box/in/../../home/kim/mail' }, { call: 'connect', host: 'stats.example' }, { call: 'exit' }] };
  const sb = P.sandbox(SB);
  const letters = 'abcdef'.split('');
  const refused = sb.results.map((r, i) => (r.ok ? null : letters[i])).filter(Boolean);
  const reqText = SB.requests.map((q, i) => '(' + letters[i] + ') ' + q.call + (q.path ? '("' + q.path + '"' + (q.write ? ', write' : '') + ')' : q.host ? '(' + q.host + ')' : '()')).join('; ');
  C.exercise({ id: 'prt-x-sandbox-set', chapter: D, title: 'What the box refuses', level: 2, kind: 'set',
    text: ['A chart maker runs in a sandbox: it may call only read, write, open, close and exit; it may open files only under /box/, and write only under /box/out/; it has no network. Paths are resolved (. and .. taken out) before they are checked.', 'It asks for: ' + reqText + '. Which requests are refused? Answer as a set of letters, like {a, c}.'],
    answer: '{' + refused.join(', ') + '}',
    hints: ['First the call itself must be on the list; then the resolved path must lie under /box/; a write must lie under /box/out/.', 'Resolve the .. parts before comparing: each one climbs a directory.', sb.steps.map((s) => s.say).join(' ')],
    solution: '{' + refused.join(', ') + '}', wrong: ['{e}', '{c, e}'], whyNot: 'Check each request against all three rules: the call, the resolved path, and the write area.' });

  const DD = '/box/out/../../etc/hosts', ddN = P.normalise(DD), dd = P.sandbox({ policy: SB.policy, requests: [{ call: 'open', path: DD }] });
  C.exercise({ id: 'prt-x-dotdot', chapter: D, title: 'A path that climbs', level: 2, kind: 'choice',
    text: ['The same chart maker asks to open `' + DD + '` for reading. The sandbox resolves the path before checking it. What does it decide?'],
    options: ['Refused: the path is really ' + ddN + ', outside /box/', 'Allowed: it starts with /box/', 'Allowed: reading is permitted anywhere', 'Refused: open is not an allowed call'],
    answer: dd.results[0].ok ? 1 : 0, whyNot: { 1: 'Comparing the spelling, not the resolved path, is exactly the mistake the resolution step avoids.', 2: 'Reading is allowed only under /box/.', 3: 'open is on the list; the path is what fails.' },
    hints: ['Take out each .. together with the directory before it.', '/box/out/.. is /box, and one more .. leaves the box.', dd.steps[0].say],
    solution: dd.results[0].ok ? 1 : 0, wrong: [1, 3] });

  const IA = { uid: 1001, files: ['/srv/web/index.html', '/srv/shared/cache'], net: 'bridge0', pidns: 'host' };
  const IB = { uid: 1001, files: ['/srv/db/data', '/srv/shared/cache'], net: 'bridge1', pidns: 'host' };
  const iso = P.isolation(IA, IB);
  C.exercise({ id: 'prt-x-isolate', chapter: D, title: 'Count the paths between two services', level: 3, kind: 'number',
    text: ['A web server and a database run on one machine. The web server runs as uid 1001, uses /srv/web/index.html and /srv/shared/cache, sits on network bridge0, and sees the host\'s process ids. The database also runs as uid 1001, uses /srv/db/data and /srv/shared/cache, sits on network bridge1, and sees the host\'s process ids too.',
      'Counting a shared user id, each shared file, a shared network and a shared process-id view as one each: how many things do they share?'],
    answer: iso.shared.length, whyNot: { '1': 'More than the cache file is shared: look at the user id and the process ids too.', '4': 'Their networks differ: bridge0 and bridge1.', '*': 'Go through the four kinds one by one: user id, files, network, process ids.' },
    hints: ['Each shared thing is a path by which a fault in one service could reach the other.', 'Same uid means each may signal and open what the other may; the same pid view means each can see and signal the other.', iso.steps.map((s) => s.say).join(' ') + ' Separate uids, no shared file and separate pid namespaces would close all three.'],
    solution: iso.shared.length, wrong: [1, 4] });
})(globalThis.Proses = globalThis.Proses || {});
