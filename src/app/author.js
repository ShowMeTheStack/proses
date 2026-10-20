// About the author: who made Proses.
(function () {
  'use strict';
  const S = (globalThis.Proses = globalThis.Proses || {});
  const { h } = S.UI;
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

  const AUTHOR = {
    name: 'Jyotiprakash Mishra',
    roles: [
      'Assistant Professor of Computer Science, KIIT',
      'Co-founder and CEO, ENineHQ Technologies',
      'PhD candidate (thesis submitted), BITS Pilani',
    ],
    profile: 'Computer scientist, teacher and engineer: sixteen years across enterprise software, healthcare technology, '
      + 'university teaching and hardware-security research on RISC-V. Doctoral research at BITS Pilani on the security of the '
      + 'hardware-software interface (microarchitectural side channels, memory encryption and hardware-assisted malware '
      + 'detection), with the degree expected in December 2026. Formerly a Team Lead at Epic in the USA and a Senior Member of '
      + 'Technical Staff at Oracle.',
    education: [
      ['PhD in Computer Science', 'BITS Pilani', '2021 to 2026 (expected)'],
      ['MS in Computer Science', 'University of Wisconsin-Madison', '2014 to 2016, GPA 3.9/4.0, with distinction'],
      ['BE (Hons.) in Computer Science', 'BITS Pilani', '2006 to 2010, CGPA 9.53/10, with distinction'],
    ],
    work: [
      ['Co-founder and CEO', 'ENineHQ Technologies', '2022 to now'],
      ['Assistant Professor', 'KIIT, Bhubaneswar', '2020 to now'],
      ['Team Lead, earlier Software Developer', 'Epic Systems, Madison, USA', '2015 to 2020'],
      ['Teaching Assistant, Introduction to Operating Systems', 'University of Wisconsin-Madison', '2014 to 2016'],
      ['Senior Member of Technical Staff', 'Oracle, Bangalore', '2010 to 2014'],
    ],
    books: [
      'RISC-V Architecture and XV6: Instruction Set Architecture, Systems Programming, and Kernel Development (De Gruyter Brill, 2026)',
      'Cryptographic Foundations: Symmetric and Public-Key Cryptography, Hashes, Digital Signatures, and Protocols (De Gruyter Brill, 2026)',
    ],
    numbers: [['16', 'years of experience'], ['2', 'books'], ['6', 'published patents'], ['16', 'research publications'], ['78', 'free lectures on YouTube']],
    made: [
      ['xv6, line by line', 'https://xv6.jyotiprakash.org', 'every line of a teaching operating system explained'],
      ['µSystem 8086', 'https://8086.jyotiprakash.org', 'a PC/XT you wire chip by chip, which boots FreeDOS'],
      ['See', 'https://see.jyotiprakash.org', 'C89 step by step, down to the byte'],
      ['Compy', 'https://compy.jyotiprakash.org', 'a C compiler you can see through, phase by phase'],
      ['Baysik', 'https://baysik.jyotiprakash.org', 'GW-BASIC and QBasic, with a debugger'],
      ['Lohgo', 'https://lohgo.jyotiprakash.org', 'Logo with turtle graphics and a debugger'],
      ['Kwery', 'https://kwery.jyotiprakash.org', 'a relational database you can see into, from SQL down to the pages'],
      ['Strux', 'https://strux.jyotiprakash.org', 'data structures and algorithms animated from real C code'],
      ['NetSim', 'https://netsim.jyotiprakash.org', 'a network simulator you can watch packet by packet'],
      ['Tooring', 'https://tooring.jyotiprakash.org', 'theory of computation you can play with: automata, grammars and Turing machines, animated'],
      ['Sirkit', 'https://sirkit.jyotiprakash.org', 'digital design you can build, run and see inside, from gates to a small processor'],
      ['Sifer', 'https://sifer.jyotiprakash.org', 'cryptography you can see inside: every cipher, hash and curve opened up, from Enigma to post-quantum'],
      ['Nooral', 'https://nooral.jyotiprakash.org', 'machine learning you can see inside: every model opened up, from least squares to a tiny GPT trained in the browser'],
      ['Arkitek', 'https://arkitek.jyotiprakash.org', 'computer organization you can see inside: RISC-V from an instruction\'s bits to pipelines, caches and GPUs, with every adder, multiplier and floating-point unit opened up'],
    ],
    links: [
      ['mail@jyotiprakash.org', 'mailto:mail@jyotiprakash.org'],
      ['blog.jyotiprakash.org', 'https://blog.jyotiprakash.org'],
      ['eninehq.com', 'https://eninehq.com'],
      ['LinkedIn', 'https://www.linkedin.com/in/mishrajp88/'],
      ['GitHub', 'https://github.com/ShowMeTheStack'],
    ],
  };

  S.authorDialog = function () {
    const A = AUTHOR;
    const photo = h('div.author-photo', h('img', { src: S.AUTHOR_PHOTO || '', alt: 'Photo of ' + A.name, width: '128', height: '160' }));
    const head = h('div.author-head', photo,
      h('div', h('div.author-name', A.name), ...A.roles.map((r) => h('div.author-role', r)),
        h('div.author-nums', ...A.numbers.map(([n, l]) => h('div', h('b', n), ' ' + l))),
        h('div.author-links', ...A.links.map(([t, u], i) => [i ? ' · ' : '', link(u, t)]))));
    const section = (title, rows) => h('div.author-sec', h('div.author-sec-t', title), ...rows);
    const body = h('div.author',
      head,
      h('p', A.profile),
      section('Education', A.education.map(([d, s, y]) => h('div.author-row', h('b', d), ', ' + s + ' (' + y + ')'))),
      section('Work', A.work.map(([r, o, y]) => h('div.author-row', h('b', r), ', ' + o + ' (' + y + ')'))),
      section('Books', A.books.map((b) => h('div.author-row', b))),
      section('Other things I made', A.made.map(([n, u, d]) => h('div.author-row', link(u, n), ': ' + d))),
      h('p.muted', { style: { marginTop: '10px' } }, 'I teach operating systems at KIIT, and I taught it before as a teaching assistant at UW-Madison. Students often meet the subject as definitions and diagrams that never move: they can recite the states of a process or the steps of a page walk without ever watching one happen, and a fork program that prints in a surprising order stays a puzzle. I built Proses so that every mechanism runs. A scheduler shows each decision and why it was made, a page walk counts every memory access, a file system lights up the blocks each command writes and survives a cut in the power, and a C program grows its process tree as it forks, with every run replayable from its seed. What the C programs print is checked against the same programs compiled and run on a real machine. When you want to see the same ideas in the code of a real kernel, xv6, line by line is the companion. If a part of the operating system finally makes sense to you here, I would love to hear about it.'));
    return S.UI.modal({ title: 'About the author', body, wide: true, buttons: [{ label: 'OK', value: true, primary: true }], enterValue: true });
  };

  // what the diagram checker looks at: About Proses and About the author, each open over the home page
  if (S.Checks && !S.Checks.some((c) => c.group === 'about')) {
    const open = (call) => 'Proses.UI.closeAllModals(); await new Promise((r) => setTimeout(r, 60)); ' + call + '; await new Promise((r) => setTimeout(r, 200));';
    S.Checks.push({ group: 'about', name: 'about proses', hash: '', fresh: true, setup: open('Proses.Shell.about(Proses.app)'), ready: "document.querySelector('.modal')", sel: '.modal' });
    S.Checks.push({ group: 'about', name: 'about the author', hash: '', fresh: true, setup: open('Proses.authorDialog()'), ready: "document.querySelector('.modal .author')", sel: '.modal' });
  }
})();
