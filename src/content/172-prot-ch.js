// Part 17, protection and security: the guided tour, the course, and the pages the diagram checker looks at. No
// challenge kind fits this part (the kinds tune schedulers, write synchronisation, design page tables, order disks
// or build shells), so it has none.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.tours.has('prt-tour')) return;

  // ---- the guided tour ---------------------------------------------------------------------------------------------
  C.tour({
    id: 'prt-tour', title: 'Tour: protection and security', blurb: 'Least privilege, the access matrix as lists and capabilities, permission bits, setuid, stored passwords, and the defences against memory-safety bugs, in nine steps.',
    steps: [
      { route: 'part=protection', target: '#main', text: 'Part 17 of the catalogue: who may do what, how the system enforces it, and the defences that keep a bug from reaching further than it should.' },
      { route: 'topic=prot-least-privilege', target: '#stageWrap', text: 'Least privilege, right by right: every grant checked against what the work needs, and the excess struck out.' },
      { target: '#btnPlay', text: 'Play steps through the run; the arrow keys go one step at a time, forwards or back.' },
      { route: 'topic=prot-matrix-impl', target: '#inputs', text: 'One question, may this domain use this object, answered by a global table, an access list, a capability and a lock and key. Choose another domain or right.' },
      { route: 'topic=prot-unix-perms', target: '#stageWrap', text: 'UNIX permission bits, directory by directory: one class of bits counts, and every directory on the way needs x.' },
      { route: 'topic=prot-setuid', target: '#stageWrap', text: 'setuid: passwd runs with root\'s rights for whoever starts it, so its own checks must do the protecting.' },
      { route: 'topic=prot-passwords', target: '#stageWrap', text: 'Passwords are never stored: a fresh salt and a slow hash are. Switch the salt off to see equal passwords give themselves away.' },
      { route: 'topic=prot-canary', target: '#stageWrap', text: 'A buffer, a canary and a bounded copy: the defences that stop an over-long copy from doing harm.' },
      { route: 'learn', target: '[data-chapter="prt-principles"]', text: 'The lessons and exercises of this part start here: matrices to fill, permission bits to read, logins to slow down, and defences to compare.' },
    ],
  });

  // ---- a course through every topic of the part --------------------------------------------------------------------
  C.course({
    id: 'prt-course', title: 'Protection and security', blurb: 'All fourteen topics of part 17, from least privilege to isolation, with lessons and exercises on the way.',
    steps: [
      { lesson: 'prt-least', note: 'Only the rights the work needs.' },
      { topic: 'prot-least-privilege', note: 'Grants against needs.' },
      { exercise: 'prt-x-excess', note: 'Count the excess.' },
      { topic: 'prot-mechanism-policy', note: 'One mechanism, two policies.' },
      { exercise: 'prt-x-policy', note: 'Change the rules, not the code.' },
      { lesson: 'prt-domains', note: 'Domains and rings.' },
      { topic: 'prot-domains', note: 'A system call through a gate.' },
      { exercise: 'prt-x-rings', note: 'Three rings in a matrix.' },
      { lesson: 'prt-matrix', note: 'The access matrix.' },
      { topic: 'prot-matrix-ops', note: 'Copy, transfer, owner, control.' },
      { exercise: 'prt-x-after-ops', note: 'Four operations by hand.' },
      { lesson: 'prt-lists', note: 'How the matrix is stored.' },
      { topic: 'prot-matrix-impl', note: 'Lists, capabilities, keys.' },
      { exercise: 'prt-x-scan', note: 'Entries read for one check.' },
      { topic: 'prot-revocation', note: 'Taking rights away.' },
      { exercise: 'prt-x-revoke-cost', note: 'What revocation costs.' },
      { lesson: 'prt-perms', note: 'Permission bits.' },
      { topic: 'prot-unix-perms', note: 'Directory by directory.' },
      { exercise: 'prt-x-ben-ops', note: 'What may ben do?' },
      { exercise: 'prt-x-mode-octal', note: 'Letters to octal.' },
      { topic: 'prot-setuid', note: 'Running as the owner.' },
      { exercise: 'prt-x-setuid-ids', note: 'Real and effective uid.' },
      { lesson: 'prt-passwords', note: 'Salted and hashed.' },
      { topic: 'prot-passwords', note: 'Store, then verify.' },
      { exercise: 'prt-x-salt', note: 'Why a salt.' },
      { topic: 'prot-login', note: 'Rate limits and a second factor.' },
      { exercise: 'prt-x-rate', note: 'A login that slows down.' },
      { lesson: 'prt-canary', note: 'Memory-safety defences.' },
      { topic: 'prot-canary', note: 'A canary and a bounded copy.' },
      { exercise: 'prt-x-canary-table', note: 'What each defence does.' },
      { topic: 'prot-nx-aslr', note: 'NX and ASLR.' },
      { exercise: 'prt-x-nx-table', note: 'Page bits on every access.' },
      { lesson: 'prt-sandbox', note: 'Boxes and isolation.' },
      { topic: 'prot-sandbox', note: 'A sandbox policy.' },
      { exercise: 'prt-x-sandbox-set', note: 'What the box refuses.' },
      { topic: 'prot-isolation', note: 'What two processes share.' },
      { exercise: 'prt-x-isolate', note: 'Count the paths.' },
    ],
  });

  // ---- what the diagram checker looks at on these pages -------------------------------------------------------------
  if (S.Checks && !S.Checks.some((c) => c.name === 'p17 lesson prt-least')) {
    const lessonReady = "document.querySelector('#lessonView')", exReady = "document.querySelector('#exerciseView')";
    for (const id of C.chapters.filter((c) => c.part === 'protection').flatMap((c) => c.lessons)) S.Checks.push({ group: 'learn', name: 'p17 lesson ' + id, hash: 'lesson=' + id, ready: lessonReady, sel: '#main' });
    for (const id of ['prt-x-rings', 'prt-x-after-ops', 'prt-x-scan', 'prt-x-ben-ops', 'prt-x-class', 'prt-x-rate', 'prt-x-canary-table', 'prt-x-wx', 'prt-x-sandbox-set'])
      S.Checks.push({ group: 'learn', name: 'p17 exercise ' + id, hash: 'exercise=' + id, ready: exReady, sel: '#main' });
    S.Checks.push({ group: 'learn', name: 'p17 course prt-course', hash: 'course=prt-course', ready: "document.querySelector('#courseView')", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
