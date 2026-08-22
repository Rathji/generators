// src/progress.test.js — Task 5 validation suite for src/progress.js.
// Run in-page via ?test=progress, or programmatically via window.__loadProgressTests().

import { createProgressTrack, TRACK_REASONS, TRACK_ICONS } from "./progress.js";

export function runProgressTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };

  // ── the task scenario ──
  const g = createProgressTrack({ playerCount: 2 });
  ok("2-player game starts on space 2", g.position === 2 && g.startSpace === 2);
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push(g.advance(TRACK_REASONS.CONSTRUCT).position);
  ok("3 advances land on space 5", seq.join(",") === "3,4,5" && g.position === 5);
  ok("no end reached yet", !g.endReached());

  // ── structure ──
  const d = createProgressTrack({ playerCount: 4 });
  ok("default track has 20 spaces", d.length === 20);
  ok("start space matches player count", d.startSpace === 4 && d.position === 4);
  ok("final space is the end", d.spaceAt(20).icon === TRACK_ICONS.END);
  ok("a mid-track space is plain", d.spaceAt(2).icon === null);

  // ── advance reasons ──
  const r = createProgressTrack({ playerCount: 1, spaces: [null, null, null, null, null, null, null, null, null, null] });
  const reasons = [
    r.advance(TRACK_REASONS.CONSTRUCT),
    r.advance(TRACK_REASONS.CRATE),
    r.advance(TRACK_REASONS.OBJECTIVE),
    r.advance(TRACK_REASONS.NO_INFLUENCE),
  ];
  ok("all four triggers advance the token", reasons.every(x => x.ok) && r.position === 5);
  ok("illegal trigger is rejected", !r.advance("build").ok && r.position === 5);

  // ── bonus icons on the default layout ──
  const b = createProgressTrack({ playerCount: 2 });
  let rep;
  for (let i = 0; i < 4; i++) rep = b.advance(TRACK_REASONS.CONSTRUCT);
  ok("landing on a reputation space grants 1 reputation", rep.position === 6 && rep.reputationGained && rep.icon === "reputation");
  let inc;
  for (let i = 0; i < 4; i++) inc = b.advance(TRACK_REASONS.CONSTRUCT);
  ok("income stays locked until the campaign unlocks it", inc.position === 10 && inc.incomeIgnored && !inc.incomeTriggered);

  const incOn = createProgressTrack({ playerCount: 2, incomeEnabled: true });
  let incLive;
  for (let i = 0; i < 8; i++) incLive = incOn.advance(TRACK_REASONS.CONSTRUCT);
  ok("with income unlocked, landing on an income space triggers income for all", incLive.incomeTriggered && !incLive.incomeIgnored && incLive.position === 10);
  ok("setIncomeEnabled toggles the lock", incOn.isIncomeEnabled() === true && incOn.setIncomeEnabled(false) === false && incOn.isIncomeEnabled() === false);

  // ── custom short track ──
  const c = createProgressTrack({ spaces: [null, "reputation", "income", "end"], startSpace: 1 });
  const a1 = c.advance(TRACK_REASONS.CONSTRUCT);
  ok("reputation bonus fires on the custom track", a1.ok && a1.position === 2 && a1.reputationGained);
  const a2 = c.advance(TRACK_REASONS.CRATE);
  ok("income space is ignored while locked", a2.position === 3 && a2.incomeIgnored);
  const a3 = c.advance(TRACK_REASONS.OBJECTIVE);
  ok("reaching the end space flags endReached with no bonus icon", a3.position === 4 && a3.endReached && a3.icon === null);
  const a4 = c.advance(TRACK_REASONS.NO_INFLUENCE);
  ok("advancing past the end is rejected", !a4.ok && a4.reason === "track_already_ended" && c.position === 4);

  // ── object-style space config ──
  const o = createProgressTrack({ spaces: [null, { icon: "income" }, "end"], startSpace: 1, incomeEnabled: true });
  ok("object-style spaces normalize", o.advance(TRACK_REASONS.CONSTRUCT).incomeTriggered === true);

  // ── validation ──
  ok("non-array track rejected", throws(() => createProgressTrack({ spaces: "abc" })));
  ok("too-short track rejected", throws(() => createProgressTrack({ spaces: [null] })));
  ok("unknown icon rejected", throws(() => createProgressTrack({ spaces: [null, "mystery", "end"] })));
  ok("start beyond the track rejected", throws(() => createProgressTrack({ playerCount: 21 })));
  ok("start space 0 rejected", throws(() => createProgressTrack({ spaces: [null, "end"], startSpace: 0 })));
  ok("non-integer start rejected", throws(() => createProgressTrack({ spaces: [null, "end"], startSpace: 1.5 })));

  // ── history & copies ──
  const h = createProgressTrack({ spaces: [null, "end"], startSpace: 1 });
  h.advance(TRACK_REASONS.CRATE);
  const hist = h.history();
  ok("history records reason, from, to, endReached",
    hist.length === 1 && hist[0].reason === "crate" && hist[0].from === 1 && hist[0].to === 2 && hist[0].endReached);
  hist[0].from = 99;
  ok("history is a detached copy", h.history()[0].from === 1);
  const sp = h.spaces();
  sp[0].icon = "hack";
  ok("spaces() is a detached copy", h.spaces()[0].icon === null);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "progress", pass, fail, results };
}
