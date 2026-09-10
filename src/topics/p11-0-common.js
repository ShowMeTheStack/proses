// Part 11, virtual memory: the families. The helpers are part 10's (S.P10, src/topics/p10-0-common.js).
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'vm', order, title, blurb });
  fam('p11-demand', 10, 'Demand paging', 'Pages loaded only when touched: the valid bit, the page-fault path step by step with its costs, and what the fault rate does to the effective access time.');
  fam('p11-cow', 20, 'Copy-on-write and mapped files', 'Frames shared after fork until someone writes, pages that start as zeros, and files mapped into memory, shared or private.');
  fam('p11-replace', 30, 'Page replacement', 'Which page goes when memory is full: FIFO, OPT, LRU and its approximations, LFU and MFU, side by side on one reference string, and Belady\'s anomaly.');
  fam('p11-refs', 40, 'Reference strings', 'Where reference strings come from: generated with locality, or traced from a C program address by address.');
  fam('p11-frames', 50, 'Frames, thrashing and the working set', 'How many frames each process gets, global against local replacement, the collapse called thrashing, and the working set and page-fault frequency that prevent it.');
  fam('p11-kalloc', 60, 'Kernel allocators', 'The buddy system splitting and coalescing powers of two, and slab caches of ready-made objects.');
  fam('p11-ualloc', 70, 'User allocators', 'malloc and free on a heap: boundary tags, splitting and coalescing, first, next and best fit against segregated lists.');
  fam('p11-pagesize', 80, 'Page size', 'Small pages against large: the table, the waste in the last page, the TLB reach, and bringing pages in before they are asked for.');
})(globalThis.Proses = globalThis.Proses || {});
