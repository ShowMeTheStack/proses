// The registry of labs. It loads before every other src/app/lab-*.js file (the 0 sorts first), so a lab's own file
// can register itself as it loads. Two ways to register:
//   S.Labs.add({id, title, blurb, part, icon, order, setup, run, views, ...})   a lab drawn by the lab shell
//     (src/app/lab-shell.js says what each field means); this is the way for every new lab
//   S.Labs.register({id, title, icon, blurb, order, open(app, main, rest) -> page, preset?(setup)})   a lab that
//     draws its whole page itself
// A lab with hidden: true opens at #labs/<id> but is not listed (the framework's own samples).
// Nothing here touches the page, so node can load it.
(function (S) {
  'use strict';
  if (S.Labs && S.Labs._registry) return;
  const labs = new Map();
  const PLANNED = [
    ['process', 'Process lab', 'terminal', 'A C program that forks, execs, waits and pipes: its process tree, descriptor tables and every possible output.'],
    ['scheduler', 'Scheduler lab', 'history', 'Your own workload under any policy, Gantt charts side by side, with the metrics worked out.'],
    ['sync', 'Sync lab', 'procs', 'Threads, locks, semaphores and condition variables, with every interleaving searched for a bug.'],
    ['deadlock', 'Deadlock lab', 'route', 'Processes and resources, the allocation graph, and the banker’s algorithm row by row.'],
    ['memory', 'Memory lab', 'grid', 'Choose the address bits, page size and levels, and watch every page walk and TLB lookup.'],
    ['vm', 'Virtual memory lab', 'layers', 'A reference string, a frame count and a policy: hits, faults and every victim explained.'],
    ['storage', 'Storage lab', 'drive', 'A disk arm and its queue, an SSD collecting garbage, and RAID rebuilding a failed disk.'],
    ['fs', 'File-system lab', 'folder', 'A disk image block by block: create, write and link, then cut the power and replay the journal.'],
    ['shell', 'Shell lab', 'gw', 'A small shell of your own, with pipelines, redirection, background jobs and no zombies left.'],
    ['vmm', 'VM lab', 'screen', 'A guest page table on a host page table: shadow against nested paging, with the walk counted.'],
  ];
  const pending = {};
  const L = (S.Labs = {
    _registry: true,
    planned: PLANNED,
    /** a lab that draws its own page */
    register(def) { labs.set(def.id, Object.assign({ icon: 'chip', order: 100 }, def)); return def; },
    /** a lab the shell draws: {id, title, blurb, part, setup, run, views} */
    add(def) {
      if (!def || !def.id || !def.title || typeof def.run !== 'function') throw new Error('S.Labs.add needs an id, a title and run(setup, ctx)');
      const plan = PLANNED.find((p) => p[0] === def.id);
      const lab = Object.assign({ icon: plan ? plan[2] : 'chip', order: plan ? PLANNED.indexOf(plan) * 10 : 100, blurb: plan ? plan[3] : '' }, def, { shell: true });
      lab.open = (app, main, rest) => S.LabShell.open(app, main, lab, rest);
      lab.preset = (setup) => { pending[lab.id] = setup; };
      labs.set(lab.id, lab);
      return lab;
    },
    get: (id) => labs.get(id) || null,
    /** every lab, the hidden ones too, in order */
    all: () => [...labs.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    /** the labs the Labs page lists */
    list: () => L.all().filter((l) => !l.hidden),
    /** open a lab set up like this (a lesson card, a share link) */
    preset(id, setup) { const lab = labs.get(id); if (lab && lab.preset) lab.preset(setup); },
    /** the setup a lab was told to open with, taken once */
    takePreset(id) { const s = pending[id]; delete pending[id]; return s === undefined ? null : s; },
  });
})(globalThis.Proses = globalThis.Proses || {});
