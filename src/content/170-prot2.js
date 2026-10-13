// Part 17, protection and security: the lessons of chapter 2 (permission bits, setuid, stored passwords, limits on
// guessing and a second factor) and chapter 3 (memory-safety defences, sandboxes and isolation). The chapters are
// declared in 170-prot.js. Captions quote what the topics' own frames say. Weaknesses are named only as concepts;
// every lesson is about the defence.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('prt-perms')) return;
  const X = (id) => ({ exercise: id });

  // =========================================================================================================
  // Chapter 2: users, permission bits and logins
  // =========================================================================================================
  C.lesson({
    id: 'prt-perms', chapter: 'prt-unix', title: 'Permission bits, directory by directory', minutes: 9,
    summary: 'Every UNIX file has an owner, a group and nine permission bits: read, write and execute for the owner, the group and everyone else. The kernel picks exactly one class for a process, owner first, then group, then other, and only that class\'s bits count. Every directory on the path needs x (search). Three more bits change the rules: setuid, setgid and the sticky bit.',
    blocks: [
      'ben is in ana\'s group and wants to read her notes. eve is not, and wants to read them too. Both type the same command. Where, exactly, does the kernel decide, and how many checks does it make before it even looks at the file?',
      { def: 'permission bits', text: 'nine bits in three groups of three: r (read), w (write), x (execute; for a directory, search) for the owner, the group and others. `-rw-r-----` is 640: the owner reads and writes, the group reads, others nothing.' },
      { topic: 'prot-unix-perms', frame: 0, caption: 'ben (uid 1002, group users) asks to read /home/ana/notes.txt. First every directory on the way must allow search.' },
      { topic: 'prot-unix-perms', frame: 3, caption: 'Search /home/ana (drwxr-x---): ben is in its group users, so only the group bits r-x count, and they include x.' },
      { topic: 'prot-unix-perms', frame: 5, caption: 'ben may read /home/ana/notes.txt: the group bits r-- of the file include r.' },
      { predict: { q: 'eve (group guests) asks for the same file. Where is she refused?', options: ['At the file: its other bits are ---', 'At /home/ana: its other bits are ---, with no x to search', 'Nowhere: everyone may read a home directory'], answer: 1, explain: 'The check never reaches the file. /home/ana is drwxr-x---: for eve the other bits count, and without x she cannot pass through it.' } },
      { topic: 'prot-unix-perms', input: { user: 'eve' }, frame: 3, caption: 'Search /home/ana (drwxr-x---): eve is neither the owner nor in its group, so the other bits --- count, and they lack x.' },
      { h: 'One class, not the best of three' },
      { topic: 'prot-unix-perms', input: { user: 'ana', path: '/lab/data.csv', op: 'read' }, frame: 3, caption: '/lab/data.csv is -r--rw----: ana owns it, so only the owner bits r-- count. She may read it, but not write it, though her group lab could.' },
      { warn: 'The class is chosen first and the bits second. An owner with fewer bits than the group gets the owner\'s bits: the kernel does not look for the most generous class.' },
      { h: 'The sticky bit' },
      'A directory that everyone may write, like /tmp, would let anyone delete anyone\'s files in it, because deleting a name is a write to the directory. The sticky bit (t in the others\' x place) adds a rule: only the file\'s owner, the directory\'s owner or root may delete or rename in it.',
      { topic: 'prot-unix-perms', input: { user: 'ben', path: '/tmp/ana.log', op: 'delete' }, frame: 4, caption: '/tmp is drwxrwxrwt: ben may write the directory, but the sticky bit lets only the owner, the directory\'s owner or root delete ana\'s log.' },
      { table: [['Bit', 'On a file', 'On a directory'], ['r', 'read the bytes', 'list the names'], ['w', 'change the bytes', 'create, delete, rename names'], ['x', 'run it', 'pass through it (search)'], ['setuid (4000)', 'run as the file\'s owner', '(not used here)'], ['setgid (2000)', 'run as the file\'s group', 'new files get the directory\'s group'], ['sticky (1000)', '(not used here)', 'only owners may delete or rename']], caption: 'What each bit means.' },
      { h: 'Recap' },
      { list: ['One class: owner, else group, else other; only its three bits count.', 'Every directory on the path needs x; a directory\'s w governs its names.', 'Root passes read and write checks whatever the bits; the sticky bit protects shared directories.'] },
      X('prt-x-mode-strings'), X('prt-x-mode-octal'), X('prt-x-class'), X('prt-x-ben-ops'), X('prt-x-eve-stop'), X('prt-x-sticky'), X('prt-x-owner-bits'),
    ],
  });

  C.lesson({
    id: 'prt-setuid', chapter: 'prt-unix', title: 'setuid: running with the owner\'s rights', minutes: 7,
    summary: 'Users must be able to change their own password, but the password file must be writable only by root. A setuid program solves this: it runs with the effective uid of its owner while the real uid stays the user\'s. It is a switch of protection domain, so such a program must check everything it is given, do one small thing, and give up its extra rights as soon as it can.',
    blocks: [
      'The file of password hashes is writable by root alone, as it must be. Yet every user can change their own password, without anyone\'s help. How can a user change a file they are not allowed to write?',
      { topic: 'prot-setuid', frame: 0, caption: 'ana runs as uid 1001: writing /etc/shadow directly is refused.' },
      { def: 'real and effective uid', text: 'the real uid says who started the process; the effective uid is the one the kernel checks permissions against. They are equal, unless the program has the setuid bit.' },
      { topic: 'prot-setuid', frame: 4, caption: '/usr/bin/passwd has the setuid bit: it runs with effective uid 0, its owner root, while the real uid stays 1001.' },
      { predict: { q: 'Running as uid 0, passwd could now write any entry of /etc/shadow. What stops it from changing ben\'s password when ana runs it?', options: ['The kernel: it still checks against ana\'s uid', 'The program\'s own checks: it must look at the real uid and change only that user\'s entry', 'Nothing could; that is why setuid is never used'], answer: 1, explain: 'The kernel now lets this process write the file. Protection has moved into the program, which must use the real uid to decide whose entry may change, and ask for the old password first.' } },
      { topic: 'prot-setuid', frame: 5, caption: 'The kernel no longer protects the file from this process; the program\'s own checks must.' },
      { topic: 'prot-setuid', input: { prog: '/usr/bin/ls' }, frame: 4, caption: 'ls has no setuid bit, so it runs with ana\'s own rights, uid 1001.' },
      { h: 'Writing such a program carefully' },
      { list: ['Check who is asking (the real uid), and do only what that user is entitled to.', 'Treat every input as untrusted: arguments, environment, file names.', 'Do one small thing, and give up the extra rights (set the effective uid back) as soon as they are no longer needed.', 'Keep setuid programs few and audit them.'] },
      { topic: 'prot-setuid', frame: 6, caption: 'An audit finds 2 risky modes. Setuid-root programs are listed on purpose: each one is a door into root\'s domain.' },
      { h: 'Recap' },
      { list: ['setuid makes the effective uid the file\'s owner; the real uid is unchanged.', 'It is a domain switch: the program, not the kernel, now guards what it can reach.', 'Least privilege applies twice: few setuid programs, and each one holding root briefly.'] },
      X('prt-x-setuid-ids'), X('prt-x-setuid-care'),
    ],
  });

  C.lesson({
    id: 'prt-passwords', chapter: 'prt-unix', title: 'Passwords, salted and hashed', minutes: 7,
    summary: 'A system never stores passwords. It stores a salt, fresh and random for each account, and the hash of salt and password, computed slowly on purpose. To check a login it hashes what was typed with the stored salt and compares. Salts make equal passwords look different and spoil tables computed in advance; slowness makes every guess against a stolen file expensive.',
    blocks: [
      'A backup tape holding the password file goes missing. If the file held the passwords themselves, every account would be open. What should the file hold instead, so that losing it gives away as little as possible?',
      { def: 'password hash', text: 'a one-way function of the password: easy to compute, infeasible to turn back. The system stores the hash and, at login, hashes what was typed and compares.' },
      { tip: 'The hash in these pages is a toy: 32 bits and fast, so the steps are easy to follow. Real systems use a slow, salted, memory-hard password hash with a long output.' },
      { topic: 'prot-passwords', frame: 1, caption: 'ana: a fresh random salt 020ffab2, then 3 rounds of the toy hash give dcfc3a61. The file keeps the salt and the hash, never the password.' },
      { predict: { q: 'Two users pick the same password, and the system uses no salt. What does the password file show?', options: ['Nothing: hashes look random', 'The same hash twice: anyone who reads the file sees that they share a password', 'An error: two users may not share a password'], answer: 1, explain: 'The same input always gives the same hash. Without a salt, equal passwords stand out, and one table of hashes computed in advance would fit every account.' } },
      { topic: 'prot-passwords', input: { salted: 'no', who: 'eve' }, frame: 5, caption: 'Without salts, ana and eve store the same hash 1f458427: the file itself shows they chose the same password.' },
      { topic: 'prot-passwords', frame: 5, caption: 'With a salt per record, even equal passwords give different hashes, and no shared table of precomputed hashes fits.' },
      { h: 'Checking a login' },
      { topic: 'prot-passwords', frame: 7, caption: 'The typed password is hashed with ana\'s salt, 3 rounds: dcfc3a61 equals the stored hash. All 8 digits are compared, whatever matched first, so the time taken says nothing.' },
      { h: 'Why slow' },
      'A stolen file can be attacked away from the login page, where no rate limit applies. The only brake left is the cost of each hash. Many rounds, or a function that also needs much memory, cost the server a moment once per login, and cost anyone working through guesses that moment for every single guess.',
      { h: 'Recap' },
      { list: ['Store salt and hash, never the password.', 'A fresh random salt per account: equal passwords differ, and precomputed tables do not fit.', 'A deliberately slow hash makes every guess against a stolen file costly.', 'Compare every digit, so timing reveals nothing.'] },
      X('prt-x-salt'), X('prt-x-slow'),
    ],
  });

  C.lesson({
    id: 'prt-login', chapter: 'prt-unix', title: 'Limiting guesses, and a second factor', minutes: 7,
    summary: 'A login page that answers as fast as it is asked lets anyone try password after password. Rate limiting makes each failure cost time, doubling after a few free tries, and locks the account after many. A second factor, a one-time code from a device the user has, means a known password alone is not enough; each code works once.',
    blocks: [
      'A user mistypes a password three times. A program somewhere tries a thousand passwords a second against the same account. The login page should be kind to the first and useless to the second. How can one rule do both?',
      { topic: 'prot-login', frame: 0, caption: 'The policy: 3 free tries, then a wait that starts at 1 s and doubles after each failure, and a lock after 8 failures.' },
      { topic: 'prot-login', frame: 5, caption: 't = 4: after 4 failures the next try must wait 2 s from t = 3; this one comes too soon and is refused unchecked.' },
      { predict: { q: 'However fast someone can type or send attempts, about how many wrong passwords does this policy allow in a whole day?', options: ['About 86400, one a second', '8: the account locks', 'About 17, until the waits pass a day'], answer: 1, explain: 'The waits double after each failure, and the eighth failure locks the account. Speed buys nothing.' } },
      { topic: 'prot-login', frame: 11, caption: 'At most 8 wrong guesses fit in 86400 s, however fast the guesser. That is why the stored hashes, which could be attacked away from this page, must be salted and slow as well.' },
      { h: 'A second factor' },
      { def: 'multi-factor authentication', text: 'proof from two different kinds: something the user knows (a password), has (a device that shows a code), or is. A leaked password alone no longer opens the account.' },
      { topic: 'prot-login', frame: 15, caption: 'Code 766712 matches time step 33, now: both factors pass.' },
      { topic: 'prot-login', input: { mfa: 'drift', pattern: 'forgetful' }, frame: 9, caption: 'A device one step behind: code 544331 matches time step 32, one step old, allowed for clock drift.' },
      { topic: 'prot-login', input: { mfa: 'replay', pattern: 'patient' }, frame: 14, caption: 'The same code a second time: its time step was already used, so it is refused. A code seen by someone else is worthless.' },
      { h: 'Recap' },
      { list: ['A few free tries for honest mistakes; then doubling waits and a lock.', 'A wrong-password answer never says which factor failed.', 'A one-time code is good for one time step (or one either side) and one login only.'] },
      X('prt-x-rate'), X('prt-x-budget'), X('prt-x-mfa'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: memory safety and isolation
  // =========================================================================================================
  C.lesson({
    id: 'prt-canary', chapter: 'prt-defence', title: 'A buffer, a canary, and a bounded copy', minutes: 7,
    summary: 'A function\'s local buffer sits on the stack just below the saved frame pointer and the return address. A copy that does not check the length can run past the buffer and damage them: a memory-safety bug. The defences: copy with a bound, so nothing past the buffer is touched; and a stack canary, a random value the compiler places above the buffer and checks before returning, so damage is caught before it is used.',
    blocks: [
      'A function reads a name into a 16-byte array. Most names fit. One day a 28-byte name arrives. The array cannot grow, so the extra 12 bytes go somewhere. Where, and what should stop that from mattering?',
      { topic: 'prot-canary', frame: 0, caption: 'The frame: a 16-byte buffer at 0x7ffd0100, then the canary 0xb0951500, the saved frame pointer and the return address above it.' },
      { def: 'memory-safety bug', text: 'a program reading or writing memory outside the object it means to use: past the end of an array, after a free, before initialising. In C the language does not check; the program must.' },
      { topic: 'prot-canary', frame: 1, caption: 'An unchecked copy of 28 bytes is 12 too many: the extra bytes run upward over the canary, then the saved frame pointer.' },
      { def: 'stack canary', text: 'a random value placed between the buffer and the saved state when the function starts, and compared with a copy kept elsewhere just before it returns. Overflowing bytes must cross it, so a change means the frame is damaged.' },
      { topic: 'prot-canary', frame: 2, caption: 'The canary changed: the program reports "stack smashing detected" and stops before returning, so the damaged saved frame pointer is never used.' },
      { predict: { q: 'Now an even longer input, 36 bytes, arrives, but the function copies it with a bounded copy, which takes at most the buffer\'s size. What happens?', options: ['The canary catches it, as before', 'Only 16 bytes are copied: nothing past the buffer is touched, and the function returns normally', 'The program crashes'], answer: 1, explain: 'A bounded copy takes min(36, 16) = 16 bytes and cuts the input short. The canary is a safety net; the bound is the fix.' } },
      { topic: 'prot-canary', input: { len: 36, copy: 'bounded' }, frame: 1, caption: 'A bounded copy takes min(36, 16) = 16 bytes, cutting the input short: nothing past the buffer is touched.' },
      { topic: 'prot-canary', input: { len: 36, canary: 'no' }, frame: 2, caption: 'With neither defence, the return address is damaged and the program crashes.' },
      { h: 'Layers of defence' },
      { table: [['Defence', 'Where', 'What it does'], ['Bounded copy (check the length)', 'the program', 'prevents the damage'], ['Stack canary', 'the compiler', 'detects the damage before return'], ['Non-executable pages', 'the hardware and kernel', 'data cannot be run as code'], ['Shuffled addresses (ASLR)', 'the kernel', 'nothing is at a known address'], ['A memory-safe language', 'the language', 'every access is checked']], caption: 'Each layer covers what the one before might miss.' },
      { h: 'Recap' },
      { list: ['An unchecked copy can run past a buffer into the saved state above it.', 'Check lengths: a bounded copy is the real fix.', 'A canary turns silent damage into a clean stop.'] },
      X('prt-x-overrun'), X('prt-x-canary-table'),
    ],
  });

  C.lesson({
    id: 'prt-nx', chapter: 'prt-defence', title: 'Non-executable pages and shuffled addresses', minutes: 7,
    summary: 'Two defences work on every program without changing it. Non-executable pages (the NX bit, and the rule W^X: no page both writable and executable) mean bytes a program writes as data can never run as code. Address-space layout randomisation (ASLR) moves the code, heap, libraries and stack to new random places at every start, so no address can be known in advance.',
    blocks: [
      'A program\'s stack holds data: numbers, names, buffers. It never needs to run instructions from there. Its code never needs to change while it runs. Why, then, would a page ever be both writable and executable?',
      { def: 'NX and W^X', text: 'each page-table entry carries a no-execute bit. W^X ("write xor execute") is the policy that every page is writable or executable, never both. The hardware checks it on every instruction fetch.' },
      { topic: 'prot-nx-aslr', frame: 0, caption: 'W^X holds: no page is both writable and executable, and every access is checked against its page\'s bits.' },
      { topic: 'prot-nx-aslr', frame: 3, caption: 'The stack is rw-: its NX bit is set, so trying to run bytes there raises a fault and the kernel stops the process.' },
      { predict: { q: 'A program is built with an executable stack (rwx). What changes?', options: ['Nothing: the stack never holds code', 'W^X is broken: bytes written to the stack could be run as code', 'The program cannot start'], answer: 1, explain: 'With rwx, the CPU will execute bytes that were written as data. W^X exists to close exactly that gap.' } },
      { topic: 'prot-nx-aslr', input: { layout: 'rwx' }, frame: 3, caption: 'With an rwx stack, the CPU may execute the stack: W^X is broken.' },
      { h: 'Shuffled addresses' },
      { def: 'ASLR', text: 'address-space layout randomisation: at every start the kernel places each region at a random whole-page offset. A fixed address that was right for one run is wrong for the next.' },
      { topic: 'prot-nx-aslr', frame: 6, caption: 'Run 1: text at 0x004a0000, heap at 0x01016000, libraries at 0x70870000, stack at 0x7fed9000.' },
      { topic: 'prot-nx-aslr', frame: 7, caption: 'Run 2: every region elsewhere: text at 0x0042a000, stack at 0x7f857000.' },
      { topic: 'prot-nx-aslr', frame: 9, caption: 'A fixed address is right for one run with odds of 1 in 256 for text, 1 in 8192 for heap, 1 in 4096 for libraries and 1 in 2048 for the stack; a wrong guess usually crashes the program, and that is noticed.' },
      { tip: 'A program that generates code as it runs (a JIT compiler) writes a page, then flips it to executable, never holding both at once. The topic\'s third layout shows it.' },
      { h: 'Recap' },
      { list: ['NX: data pages cannot be run; W^X: no page is both writable and executable.', 'ASLR: regions move at every start; more random bits, more places.', 'Both work under every program, with no change to its code.'] },
      X('prt-x-nx-table'), X('prt-x-wx'), X('prt-x-aslr'),
    ],
  });

  C.lesson({
    id: 'prt-sandbox', chapter: 'prt-defence', title: 'Sandboxes and isolation', minutes: 8,
    summary: 'A sandbox runs a program under a policy that lists what it may ask the kernel for: which system calls, which files, whether the network. Everything else is refused, so a bug in the program cannot reach beyond its box. Paths are resolved before they are checked. Isolation is the same idea between programs: count what two processes share (a user id, files, a network, a view of process ids), since each shared thing is a way for a fault in one to reach the other.',
    blocks: [
      'An image viewer opens files from strangers. It needs to read its input and write a thumbnail, and nothing else. If a malformed image triggers a bug in its decoder, what should that bug be able to touch?',
      { def: 'sandbox', text: 'a policy enforced by the kernel around one program: the system calls it may make, the files it may open and write, the network it may reach. Requests outside the policy fail with an error, and the program carries on inside.' },
      { topic: 'prot-sandbox', frame: 0, caption: 'The viewer\'s box: 5 system calls allowed, files under /sandbox/, and no network.' },
      { topic: 'prot-sandbox', frame: 3, caption: 'open("/etc/passwd") is refused with EPERM: it is outside /sandbox/.' },
      { predict: { q: 'The program asks for "/sandbox/in/../../etc/passwd". It starts with /sandbox/. Is it allowed?', options: ['Yes: it starts with /sandbox/', 'No: resolved, it is /etc/passwd, outside the box', 'Only for reading'], answer: 1, explain: 'Each .. climbs one directory. The sandbox resolves the path first and checks where it really leads, never just its spelling.' } },
      { topic: 'prot-sandbox', frame: 4, caption: '/sandbox/in/../../etc/passwd is really /etc/passwd: refused.' },
      { topic: 'prot-sandbox', frame: 9, caption: '5 of 8 requests refused: the program keeps working inside its box, and a mistake in it cannot reach anything outside.' },
      { topic: 'prot-sandbox', input: { pol: 'strict' }, frame: 6, caption: 'A calculator needs no files at all: only read, write and exit; open and connect are refused.' },
      { h: 'What two processes share' },
      { topic: 'prot-isolation', input: { pair: 'same' }, frame: 5, caption: 'Two programs of one user share 4 things: the uid, a file, the network and the process-id space.' },
      { topic: 'prot-isolation', input: { pair: 'boxed' }, frame: 5, caption: 'Two boxed services: separate uids, files, networks and process ids. A fault in one cannot reach the other through any of these.' },
      { tip: 'Containers (part 18) build exactly this kind of box from kernel features: namespaces give each its own view, control groups limit what it may use.' },
      { h: 'Recap' },
      { list: ['A sandbox is least privilege enforced by the kernel around one program.', 'Allow lists, not deny lists: what is not named is refused.', 'Resolve paths before checking them.', 'Isolation: remove every shared uid, file, network and process view that is not needed.'] },
      X('prt-x-sandbox-set'), X('prt-x-dotdot'), X('prt-x-isolate'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
