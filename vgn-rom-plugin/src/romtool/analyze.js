// analyze.js — recursive code scan: follows the control flow from entry points,
// discovers reachable instructions, labels and call targets (functions).

export function nextAddr(cpu, addr, size) {
  const mask = cpu.id === '65816' ? 0xffffff : cpu.id === '68000' ? 0xffffffff : 0xffff;
  return (addr + size) & mask;
}

export function scan(cpu, mem, entries, opts = {}) {
  const maxIns = opts.maxIns || 250000;
  const code = new Map();          // addr -> instruction
  const labelAddr = new Set();     // addrs that need a label
  const callTargets = new Set();   // function starts (call targets)
  const calls = new Map();         // target -> [caller addrs]
  const funcEntry = new Set();     // user entry points

  for (const e of entries) {
    if (e.addr != null) { funcEntry.add(e.addr); labelAddr.add(e.addr); }
  }

  const work = [];
  for (const e of entries) if (e.addr != null) work.push({ addr: e.addr, entry: true });

  let count = 0;
  const visited = new Set();

  while (work.length && count < maxIns) {
    const item = work.pop();
    const addr = item.addr;
    if (visited.has(addr)) continue;
    const ins = cpu.decode(mem, addr);
    if (!ins) continue;
    visited.add(addr);
    code.set(addr, ins);
    count++;

    const br = ins.branch;
    if (!br) {
      work.push({ addr: nextAddr(cpu, addr, ins.size), entry: false });
      continue;
    }
    if (br.kind === 'call') {
      if (br.target != null) {
        callTargets.add(br.target);
        labelAddr.add(br.target);
        work.push({ addr: br.target, entry: false });
        const list = calls.get(br.target) || [];
        list.push(addr);
        calls.set(br.target, list);
      }
      work.push({ addr: nextAddr(cpu, addr, ins.size), entry: false });
    } else if (br.kind === 'cond') {
      if (br.target != null) labelAddr.add(br.target);
      work.push({ addr: nextAddr(cpu, addr, ins.size), entry: false });
      if (br.target != null) work.push({ addr: br.target, entry: false });
    } else if (br.kind === 'jump') {
      if (br.target != null) {
        labelAddr.add(br.target);
        work.push({ addr: br.target, entry: false });
      }
    }
    // ret → nothing more
  }

  // Optional full-coverage linear sweep: decode every byte of the ROM ranges
  // so the listing shows the whole game (reachable code + anything missed).
  if (opts.cover) {
    const ranges = mem.coverRanges || (mem.segments || []).map((s) => [s.start, s.start + s.bytes.length]);
    for (const [start, end] of ranges) {
      let addr = start;
      while (addr < end && count < maxIns) {
        if (!visited.has(addr)) {
          const ins = cpu.decode(mem, addr);
          if (ins) {
            visited.add(addr);
            code.set(addr, ins);
            count++;
            addr += Math.max(1, ins.size);
            continue;
          }
        }
        addr += 1;
      }
    }
  }

  // keep code entries in address order
  const sorted = [...code.keys()].sort((a, b) => a - b);

  // labels
  const labels = new Map();
  for (const a of funcEntry) labels.set(a, 'ENTREE');
  for (const a of callTargets) if (!labels.has(a)) labels.set(a, 'FONCTION');

  return {
    code,
    sorted,
    labels,
    labelAddr,
    callTargets,
    calls,
    funcEntry,
    truncated: count >= maxIns,
    count,
  };
}

// Build per-function basic blocks from the scanned code.
export function buildBlocks(cpu, mem, code, callTargets, entry) {
  const next = (a, s) => nextAddr(cpu, a, s);

  // pass 1: discover every block start (entry, branch/fall-through successors)
  const starts = new Set([entry]);
  const queued = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const start = queue.pop();
    let addr = start;
    let guard = 0;
    while (guard++ < 500000 && code.has(addr)) {
      if (addr !== start && starts.has(addr)) break;
      const i = code.get(addr);
      const br = i.branch;
      if (br) {
        const addStart = (a) => { if (a != null && !starts.has(a) && !queued.has(a)) { starts.add(a); queued.add(a); queue.push(a); } };
        if (br.kind === 'call') {
          addStart(next(addr, i.size));
          break;
        } else if (br.kind === 'ret') {
          break;
        } else if (br.kind === 'jump') {
          addStart(br.target);
          break;
        } else if (br.kind === 'cond') {
          addStart(next(addr, i.size));
          addStart(br.target);
          break;
        }
      }
      addr = next(addr, i.size);
    }
  }

  // pass 2: build each block by walking until the next start
  const blocks = new Map();   // start addr -> block
  for (const start of starts) {
    const ins = [];
    let addr = start;
    let lastBranch = null;
    let succ = null;
    let guard = 0;
    while (guard++ < 500000) {
      if (!code.has(addr)) break;
      const i = code.get(addr);
      if (ins.length && (starts.has(addr) || (callTargets.has(addr) && addr !== start))) break;
      ins.push(i);
      const br = i.branch;
      if (br) {
        lastBranch = br;
        if (br.kind === 'call') {
          const f = next(addr, i.size);
          succ = { next: f };
          break;
        } else if (br.kind === 'ret') {
          break;
        } else if (br.kind === 'jump') {
          if (br.target != null) succ = { jump: br.target };
          break;
        } else if (br.kind === 'cond') {
          const f = next(addr, i.size);
          succ = { next: f, cond: br.target };
          break;
        }
      }
      addr = next(addr, i.size);
    }
    blocks.set(start, { addr: start, ins, succ, lastBranch });
  }
  return blocks;
}
