/* ════════════════════════════════════════════════════════════════════
   BATTLETECH · 3025 — src/bt.js
   A first-edition-style BattleTech miniatures wargame on the BGN hex
   framework. This file carries the 'Mech record sheets, weapon tables,
   and the combat engine: to-hit resolution, the front hit-location
   table, armor/internal damage with critical hits and transfer, heat
   (sinks, overheat penalties, shutdown, ammo explosions), pilot
   wounds, falls, and physical attacks. Pure data + logic — no DOM.
   The BGN table, movement economy and rendering live in index.html on
   top of src/hex.js / src/hexview.js.
   ════════════════════════════════════════════════════════════════════ */
"use strict";

const BT = {};

BT.TERRAIN = { clear:0, woods:1, rough:2, water:3, mountain:4 };

/* ── weapon tables (Intro-Tech 3025) ── */
BT.WEAPONS = {
  sl:   { name:"Small Laser",   heat:1,  dmg:3,  short:1, med:2,  long:3,  min:0, crits:1 },
  ml:   { name:"Medium Laser",  heat:3,  dmg:5,  short:3, med:6,  long:9,  min:0, crits:1 },
  ll:   { name:"Large Laser",   heat:8,  dmg:8,  short:5, med:10, long:15, min:0, crits:2 },
  ppc:  { name:"PPC",           heat:10, dmg:10, short:6, med:12, long:18, min:3, crits:3 },
  ac2:  { name:"AC/2",          heat:1,  dmg:2,  short:6, med:12, long:18, min:4, crits:1, ammo:45 },
  ac5:  { name:"AC/5",          heat:1,  dmg:5,  short:6, med:12, long:18, min:3, crits:4, ammo:20 },
  ac10: { name:"AC/10",         heat:3,  dmg:10, short:5, med:10, long:15, min:0, crits:7, ammo:10 },
  ac20: { name:"AC/20",         heat:7,  dmg:20, short:2, med:4,  long:6,  min:0, crits:10,ammo:5 },
  srm2: { name:"SRM 2",         heat:2,  missiles:2, mdm:2, short:3, med:6, long:9,  min:0, crits:1, ammo:50 },
  srm4: { name:"SRM 4",         heat:3,  missiles:4, mdm:2, short:3, med:6, long:9,  min:0, crits:1, ammo:25 },
  srm6: { name:"SRM 6",         heat:4,  missiles:6, mdm:2, short:3, med:6, long:9,  min:0, crits:2, ammo:15 },
  lrm5: { name:"LRM 5",         heat:2,  missiles:5, mdm:1, short:7, med:14, long:21, min:6, crits:1, ammo:24 },
  lrm10:{ name:"LRM 10",        heat:4,  missiles:10,mdm:1, short:7, med:14, long:21, min:6, crits:2, ammo:12 },
  lrm15:{ name:"LRM 15",        heat:5,  missiles:15,mdm:1, short:7, med:14, long:21, min:6, crits:3, ammo:8 },
  lrm20:{ name:"LRM 20",        heat:6,  missiles:20,mdm:1, short:7, med:14, long:21, min:6, crits:5, ammo:6 },
  mg:   { name:"Machine Gun",   heat:0,  dmg:2,  short:1, med:2,  long:3,  min:0, crits:1, ammo:200 },
  fl:   { name:"Flamer",        heat:3,  dmg:2,  short:1, med:2,  long:3,  min:0, crits:1, targetHeat:2 }
};

BT.LOCATIONS = ["hd","ct","lt","rt","la","ra","ll","rl"];
BT.LOC_FULL = { hd:"Head", ct:"Center Torso", lt:"Left Torso", rt:"Right Torso", la:"Left Arm", ra:"Right Arm", ll:"Left Leg", rl:"Right Leg" };
BT.LOC_SHORT = { hd:"HD", ct:"CT", lt:"LT", rt:"RT", la:"LA", ra:"RA", ll:"LL", rl:"RL" };
BT.TRANSFER = { la:"lt", ra:"rt", ll:"lt", rl:"rt", lt:"ct", rt:"ct" };

BT.HIT_TABLE = { 2:"ct",3:"ra",4:"ra",5:"la",6:"la",7:"lt",8:"ct",9:"rt",10:"rt",11:"ll",12:"rl" };
BT.PUNCH_TABLE = { 2:"ct",3:"ra",4:"ra",5:"la",6:"la",7:"lt",8:"ct",9:"rt",10:"rt",11:"la",12:"ra" };
BT.KICK_TABLE = { 2:"ll",3:"ll",4:"ll",5:"ll",6:"ll",7:"rl",8:"rl",9:"rl",10:"rl",11:"rl",12:"rl" };

BT.roll2d6 = function(){ return (1 + Math.floor(Math.random()*6)) + (1 + Math.floor(Math.random()*6)); };

// chance (percent) of 2d6 >= tn, honouring the natural 2 miss / natural 12 hit
BT.hitChance = function(tn){
  let c = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    const s = a + b;
    if (s === 2) continue;
    if (s === 12 || s >= tn) c++;
  }
  return Math.round(c / 36 * 100);
};

// cluster-hit tables (indexed by d6)
BT.CLUSTER = {
  2: [1,1,1,2,2,2],
  4: [3,3,3,4,4,4],
  5: [1,1,3,3,5,5],
  6: [4,4,5,5,5,6],
  10:[2,4,6,6,8,10],
  15:[5,7,9,11,13,15],
  20:[6,8,10,12,16,20]
};
BT.clusterHits = function(n){
  const t = BT.CLUSTER[n];
  if (t) return t[Math.floor(Math.random()*6)];
  return Math.min(n, Math.max(1, Math.ceil(n * (0.55 + Math.random()*0.3))));
};

BT.classOf = function(tons){ return tons < 40 ? "Light" : tons < 60 ? "Medium" : tons < 80 ? "Heavy" : "Assault"; };
BT.classGlyph = function(tons){ return tons < 40 ? "L" : tons < 60 ? "M" : tons < 80 ? "H" : "A"; };

/* ── 'Mech record sheets (Intro-Tech). Armor is a single front value
   per location (rear armour simplified out); weapons list {t, loc, n}.
   Ammo bins are auto-created in the weapon's location and heat sinks
   are distributed CT → LT/RT → legs → arms by the build code. ── */
BT.MECHS = {
  locust: {
    id:"locust", type:"LCT-1V", name:"Locust", tons:20, walk:8, run:12, jump:0, hs:10,
    armor:{hd:8,ct:21,lt:15,rt:15,la:10,ra:10,ll:14,rl:14},
    structure:{hd:3,ct:13,lt:10,rt:10,la:7,ra:7,ll:7,rl:7},
    weapons:[{t:"ml",loc:"ct",n:2}]
  },
  jenner: {
    id:"jenner", type:"JR7-D", name:"Jenner", tons:35, walk:6, run:9, jump:6, hs:10,
    armor:{hd:8,ct:20,lt:14,rt:14,la:12,ra:12,ll:13,rl:13},
    structure:{hd:3,ct:15,lt:11,rt:11,la:8,ra:8,ll:8,rl:8},
    weapons:[{t:"ml",loc:"ra",n:2},{t:"ml",loc:"la",n:2},{t:"srm4",loc:"lt",n:1}]
  },
  phoenixhawk: {
    id:"phoenixhawk", type:"PXH-1", name:"Phoenix Hawk", tons:45, walk:6, run:9, jump:6, hs:12,
    armor:{hd:9,ct:22,lt:16,rt:16,la:15,ra:15,ll:18,rl:18},
    structure:{hd:3,ct:16,lt:12,rt:12,la:9,ra:9,ll:9,rl:9},
    weapons:[{t:"ll",loc:"ra",n:1},{t:"ml",loc:"la",n:2},{t:"mg",loc:"lt",n:1},{t:"mg",loc:"rt",n:1}]
  },
  shadowhawk: {
    id:"shadowhawk", type:"SHD-2H", name:"Shadow Hawk", tons:55, walk:5, run:8, jump:5, hs:10,
    armor:{hd:9,ct:24,lt:18,rt:18,la:17,ra:17,ll:20,rl:20},
    structure:{hd:3,ct:18,lt:13,rt:13,la:10,ra:10,ll:10,rl:10},
    weapons:[{t:"ac5",loc:"rt",n:1},{t:"lrm5",loc:"lt",n:1},{t:"srm2",loc:"rt",n:1},{t:"ml",loc:"ct",n:1}]
  },
  thunderbolt: {
    id:"thunderbolt", type:"TDR-5S", name:"Thunderbolt", tons:65, walk:4, run:6, jump:0, hs:15,
    armor:{hd:9,ct:29,lt:20,rt:20,la:20,ra:20,ll:23,rl:23},
    structure:{hd:3,ct:19,lt:14,rt:14,la:11,ra:11,ll:11,rl:11},
    weapons:[{t:"lrm15",loc:"lt",n:1},{t:"ll",loc:"rt",n:1},{t:"ml",loc:"ra",n:1},{t:"ml",loc:"la",n:1},{t:"ml",loc:"ct",n:1},{t:"srm2",loc:"ra",n:1},{t:"mg",loc:"ra",n:1},{t:"fl",loc:"la",n:1}]
  },
  warhammer: {
    id:"warhammer", type:"WHM-6R", name:"Warhammer", tons:70, walk:4, run:6, jump:0, hs:18,
    armor:{hd:9,ct:28,lt:20,rt:20,la:15,ra:15,ll:20,rl:20},
    structure:{hd:3,ct:19,lt:15,rt:15,la:11,ra:11,ll:11,rl:11},
    weapons:[{t:"ppc",loc:"ra",n:1},{t:"ppc",loc:"la",n:1},{t:"ml",loc:"ra",n:1},{t:"ml",loc:"la",n:1},{t:"srm6",loc:"lt",n:1},{t:"srm6",loc:"rt",n:1},{t:"mg",loc:"ra",n:1},{t:"fl",loc:"la",n:1}]
  },
  awesome: {
    id:"awesome", type:"AWS-8Q", name:"Awesome", tons:80, walk:3, run:5, jump:0, hs:30,
    armor:{hd:9,ct:31,lt:22,rt:22,la:22,ra:22,ll:24,rl:24},
    structure:{hd:3,ct:21,lt:16,rt:16,la:12,ra:12,ll:12,rl:12},
    weapons:[{t:"ppc",loc:"ra",n:1},{t:"ppc",loc:"rt",n:1},{t:"ppc",loc:"la",n:1},{t:"sl",loc:"ct",n:1}]
  },
  atlas: {
    id:"atlas", type:"AS7-D", name:"Atlas", tons:100, walk:3, run:5, jump:0, hs:15,
    armor:{hd:9,ct:36,lt:19,rt:19,la:24,ra:24,ll:28,rl:28},
    structure:{hd:3,ct:23,lt:17,rt:17,la:14,ra:14,ll:14,rl:14},
    weapons:[{t:"ac20",loc:"rt",n:1},{t:"lrm20",loc:"lt",n:1},{t:"ml",loc:"la",n:2},{t:"ml",loc:"ct",n:2},{t:"srm4",loc:"lt",n:1},{t:"srm4",loc:"rt",n:1}]
  }
};

/* ── scenarios: both sides field the same lance (mirror) ── */
BT.SCENARIOS = [
  { id:0, name:"Fast Skirmish",      mechs:["locust","jenner"] },
  { id:1, name:"Patrol Action",      mechs:["locust","jenner","phoenixhawk"] },
  { id:2, name:"Assault Lance",      mechs:["shadowhawk","thunderbolt","warhammer"] },
  { id:3, name:"Duel of the Giants", mechs:["awesome","atlas","warhammer"] }
];

/* ── factions (display identity; gameplay is symmetric for now) ── */
BT.FACTIONS = {
  host: {
    name: "House Aurelius", color: "#e8452c",
    logo: '<svg viewBox="0 0 32 32" width="26" height="26"><g fill="#e8452c" stroke="#ff9d7a" stroke-width=".9"><circle cx="16" cy="16" r="7.5"/><path d="M16 1.5 L18 10.5 L14 10.5 Z"/><path d="M16 30.5 L14 21.5 L18 21.5 Z"/><path d="M1.5 16 L10.5 14 L10.5 18 Z"/><path d="M30.5 16 L21.5 18 L21.5 14 Z"/><path d="M5.5 5.5 L12.8 10.2 L10.9 12.6 Z"/><path d="M26.5 26.5 L19.2 21.8 L21.1 19.4 Z"/><path d="M26.5 5.5 L21.2 12.8 L18.8 10.9 Z"/><path d="M5.5 26.5 L12.8 21.2 L15.2 23.1 Z"/></g></svg>'
  },
  guest: {
    name: "House Kestrel", color: "#3d7dd8",
    logo: '<svg viewBox="0 0 32 32" width="26" height="26"><path d="M21.5 4.5 A 12 12 0 1 0 21.5 27.5 A 9.6 9.6 0 1 1 21.5 4.5 Z" fill="#3d7dd8" stroke="#9cc6ff" stroke-width=".9"/><path d="M14 9 L15.9 14.4 L21.6 14.9 L17.2 18.4 L18.7 23.9 L14 20.7 L9.3 23.9 L10.8 18.4 L6.4 14.9 L12.1 14.4 Z" fill="#d9eaff" stroke="#0a0c11" stroke-width=".7"/></svg>'
  }
};
BT.PILOTS = {
  host: ["Marcus Voss", "Lena Kessler", "Rico Delgado", "Tamsin Hale", "Jae-Won Park", "Freya Anders", "Dmitri Antonov", "Sera Noor"],
  guest: ["Viktor Renner", "Alia Singh", "Serena Blackwood", "Hiroshi Mori", "Katarina Weiss", "Malik Osei", "Ingrid Falk", "Tomás Reyes"]
};

/* ── top-down 'Mech silhouettes (fill="currentColor" tints to the
   owner's faction color). One graphic per 'Mech type. ── */
BT.MECH_SVG = {
  locust:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="3" rx="7" ry="5" fill="rgba(0,0,0,.28)"/>' +
    '<path d="M-3,-7.5 L3,-7.5 L4.2,0 L2.8,8.5 L-2.8,8.5 L-4.2,0 Z" fill="currentColor"/>' +
    '<path d="M-1.5,-7.5 L1.5,-7.5 L2.1,0 L1.4,8.5 L-1.4,8.5 L-2.1,0 Z" fill="#fff" opacity=".12"/>' +
    '<path d="M-1.9,-10.8 L1.9,-10.8 L1.9,-7.5 L-1.9,-7.5 Z" fill="currentColor"/>' +
    '<rect x="-1" y="-10.3" width="2" height="1.5" rx=".75" fill="#9fe8ff"/>' +
    '<path d="M-3.4,-5.5 L-6.6,-2.4 L-6.1,-1.5 L-3.2,-4.2 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M3.4,-5.5 L6.6,-2.4 L6.1,-1.5 L3.2,-4.2 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-2.4,8 L-4.8,12.6 L-5.6,12.1 L-3.2,8.2 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M2.4,8 L4.8,12.6 L5.6,12.1 L3.2,8.2 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.6,8 L0.6,8 L0.6,11.8 L-0.6,11.8 Z" fill="currentColor" opacity=".7"/></g>',
  jenner:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="3" rx="7.5" ry="5.5" fill="rgba(0,0,0,.28)"/>' +
    '<path d="M-3.2,-7 L3.2,-7 L3.9,1.5 L2.5,9 L-2.5,9 L-3.9,1.5 Z" fill="currentColor"/>' +
    '<path d="M-1.7,-7 L1.7,-7 L2,1.5 L1.3,9 L-1.3,9 L-2,1.5 Z" fill="#fff" opacity=".12"/>' +
    '<ellipse cx="-4.1" cy="-1.2" rx="2.3" ry="3" fill="currentColor"/>' +
    '<ellipse cx="4.1" cy="-1.2" rx="2.3" ry="3" fill="currentColor"/>' +
    '<circle cx="-4.1" cy="-3.2" r=".75" fill="#ffb08a"/>' +
    '<circle cx="4.1" cy="-3.2" r=".75" fill="#ffb08a"/>' +
    '<path d="M-1.9,-10.2 L1.9,-10.2 L1.9,-7 L-1.9,-7 Z" fill="currentColor"/>' +
    '<rect x="-1" y="-9.7" width="2" height="1.4" rx=".7" fill="#9fe8ff"/>' +
    '<path d="M-2.6,8.2 L-4.9,12.8 L-5.7,12.2 L-3.4,8.5 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M2.6,8.2 L4.9,12.8 L5.7,12.2 L3.4,8.5 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.6,8.4 L0.6,8.4 L0.6,12 L-0.6,12 Z" fill="currentColor" opacity=".7"/></g>',
  phoenixhawk:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="2.5" rx="8.5" ry="5" fill="rgba(0,0,0,.28)"/>' +
    '<path d="M-3.4,-6.5 L3.4,-6.5 L4.6,0 L2.1,6 L-2.1,6 L-4.6,0 Z" fill="currentColor"/>' +
    '<path d="M-4.2,-2.6 L-9,0.4 L-8.5,1.9 L-3.6,0.7 Z" fill="currentColor" opacity=".9"/>' +
    '<path d="M4.2,-2.6 L9,0.4 L8.5,1.9 L3.6,0.7 Z" fill="currentColor" opacity=".9"/>' +
    '<path d="M-1.7,-6.5 L1.7,-6.5 L2.3,0 L1.05,6 L-1.05,6 L-2.3,0 Z" fill="#fff" opacity=".12"/>' +
    '<path d="M-1.9,-9.6 L1.9,-9.6 L1.9,-6.5 L-1.9,-6.5 Z" fill="currentColor"/>' +
    '<rect x="-1" y="-9.1" width="2" height="1.4" rx=".7" fill="#9fe8ff"/>' +
    '<path d="M-3.8,-5 L-6.4,-1 L-5.8,-0.4 L-3.2,-3.5 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M3.8,-5 L6.4,-1 L5.8,-0.4 L3.2,-3.5 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-1.7,5.5 L-4,10.2 L-4.8,9.6 L-2.6,5.8 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M1.7,5.5 L4,10.2 L4.8,9.6 L2.6,5.8 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.6,5.8 L0.6,5.8 L0.6,10 L-0.6,10 Z" fill="currentColor" opacity=".7"/></g>',
  shadowhawk:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="2.5" rx="8" ry="5.5" fill="rgba(0,0,0,.28)"/>' +
    '<path d="M-4.4,-5.2 L4.4,-5.2 L5,3.4 L-5,3.4 Z" fill="currentColor"/>' +
    '<path d="M-2.3,-5.2 L2.3,-5.2 L2.6,3.4 L-2.6,3.4 Z" fill="#fff" opacity=".12"/>' +
    '<rect x="3.5" y="-4.6" width="3" height="2.4" rx="1" fill="currentColor"/>' +
    '<circle cx="5.2" cy="-3.4" r=".7" fill="#ffb08a"/>' +
    '<path d="M-1.9,-8 L1.9,-8 L1.9,-5.2 L-1.9,-5.2 Z" fill="currentColor"/>' +
    '<rect x="-1" y="-7.5" width="2" height="1.3" rx=".65" fill="#9fe8ff"/>' +
    '<path d="M-4.4,-2.8 L-6.9,0.5 L-6.3,1.4 L-3.9,1.4 L-3.5,-0.5 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M4.4,2 L6.7,5.2 L6,5.9 L4.1,3.5 Z" fill="currentColor" opacity=".8"/>' +
    '<path d="M-3,3 L-5,7.5 L-5.8,6.9 L-3.8,3.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M3,3 L5,7.5 L5.8,6.9 L3.8,3.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.6,3.2 L0.6,3.2 L0.6,7.2 L-0.6,7.2 Z" fill="currentColor" opacity=".7"/></g>',
  thunderbolt:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="3" rx="8.5" ry="6" fill="rgba(0,0,0,.28)"/>' +
    '<path d="M-5.4,-6 L5.4,-6 L6.2,4.4 L-6.2,4.4 Z" fill="currentColor"/>' +
    '<rect x="-7.5" y="-4.8" width="3.3" height="3.2" rx="1" fill="currentColor"/>' +
    '<rect x="-7.15" y="-4.1" width="2.6" height="1.7" fill="#ffb08a" opacity=".9"/>' +
    '<rect x="-7.15" y="-1.9" width="2.6" height="1.7" fill="#ffb08a" opacity=".9"/>' +
    '<path d="M-2.7,-6 L2.7,-6 L3.1,4.4 L-3.1,4.4 Z" fill="#fff" opacity=".12"/>' +
    '<path d="M-2.1,-9 L2.1,-9 L2.1,-6 L-2.1,-6 Z" fill="currentColor"/>' +
    '<rect x="-1.05" y="-8.5" width="2.1" height="1.4" rx=".7" fill="#9fe8ff"/>' +
    '<path d="M-5.1,-2.8 L-8,0.8 L-7.2,1.8 L-4.5,0.6 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M5.1,-2.8 L8,0.8 L7.2,1.8 L4.5,0.6 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-3.6,4 L-5.8,9.2 L-6.6,8.6 L-4.6,4.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M3.6,4 L5.8,9.2 L6.6,8.6 L4.6,4.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.7,4.4 L0.7,4.4 L0.7,8.8 L-0.7,8.8 Z" fill="currentColor" opacity=".7"/></g>',
  warhammer:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="3" rx="9" ry="6" fill="rgba(0,0,0,.28)"/>' +
    '<path d="M-4.6,-6 L4.6,-6 L5.2,4.4 L-5.2,4.4 Z" fill="currentColor"/>' +
    '<rect x="-7.7" y="-4.6" width="3.5" height="3.6" rx="1.2" fill="currentColor"/>' +
    '<rect x="4.2" y="-4.6" width="3.5" height="3.6" rx="1.2" fill="currentColor"/>' +
    '<circle cx="-5.95" cy="-3.7" r=".8" fill="#ffb08a"/>' +
    '<circle cx="5.95" cy="-3.7" r=".8" fill="#ffb08a"/>' +
    '<path d="M-2.3,-6 L2.3,-6 L2.6,4.4 L-2.6,4.4 Z" fill="#fff" opacity=".12"/>' +
    '<path d="M-2.1,-9.2 L2.1,-9.2 L2.1,-6 L-2.1,-6 Z" fill="currentColor"/>' +
    '<rect x="-1.05" y="-8.7" width="2.1" height="1.4" rx=".7" fill="#9fe8ff"/>' +
    '<path d="M-4.4,-2 L-6.9,1.4 L-6.1,2.2 L-3.9,1 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M4.4,-2 L6.9,1.4 L6.1,2.2 L3.9,1 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-3.4,4 L-5.6,9.2 L-6.4,8.6 L-4.4,4.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M3.4,4 L5.6,9.2 L6.4,8.6 L4.4,4.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.7,4.4 L0.7,4.4 L0.7,8.8 L-0.7,8.8 Z" fill="currentColor" opacity=".7"/></g>',
  awesome:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="3" rx="9.5" ry="6" fill="rgba(0,0,0,.28)"/>' +
    '<path d="M-5.8,-5.5 L5.8,-5.5 L6.4,4.4 L-6.4,4.4 Z" fill="currentColor"/>' +
    '<rect x="-8.2" y="-4.2" width="3.3" height="3.1" rx="1" fill="currentColor"/>' +
    '<rect x="4.9" y="-4.2" width="3.3" height="3.1" rx="1" fill="currentColor"/>' +
    '<rect x="-1.65" y="-5.2" width="3.3" height="3.1" rx="1" fill="currentColor"/>' +
    '<circle cx="-6.55" cy="-3" r=".7" fill="#ffb08a"/>' +
    '<circle cx="6.55" cy="-3" r=".7" fill="#ffb08a"/>' +
    '<circle cx="0" cy="-4" r=".7" fill="#ffb08a"/>' +
    '<path d="M-2.9,-5.5 L2.9,-5.5 L3.2,4.4 L-3.2,4.4 Z" fill="#fff" opacity=".12"/>' +
    '<path d="M-1.7,-8.6 L1.7,-8.6 L1.7,-5.5 L-1.7,-5.5 Z" fill="currentColor"/>' +
    '<rect x="-0.85" y="-8.2" width="1.7" height="1.2" rx=".6" fill="#9fe8ff"/>' +
    '<path d="M-5.6,-3 L-8.3,0.6 L-7.5,1.5 L-5,0.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M5.6,-3 L8.3,0.6 L7.5,1.5 L5,0.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-4,4 L-6.2,9 L-7,8.4 L-5,4.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M4,4 L6.2,9 L7,8.4 L5,4.4 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.7,4.4 L0.7,4.4 L0.7,8.6 L-0.7,8.6 Z" fill="currentColor" opacity=".7"/></g>',
  atlas:
    '<g stroke="#0a0c11" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">' +
    '<ellipse cx="0" cy="3" rx="10" ry="7" fill="rgba(0,0,0,.3)"/>' +
    '<path d="M-6.8,-6 L6.8,-6 L7.6,6 L-7.6,6 Z" fill="currentColor"/>' +
    '<rect x="-8.8" y="-4.2" width="3.7" height="4.6" rx="1.4" fill="currentColor"/>' +
    '<rect x="5.1" y="-4.2" width="3.7" height="4.6" rx="1.4" fill="currentColor"/>' +
    '<path d="M-3.4,-6 L3.4,-6 L3.8,6 L-3.8,6 Z" fill="#fff" opacity=".12"/>' +
    '<path d="M-2.9,-10.2 L2.9,-10.2 L2.9,-6 L-2.9,-6 Z" fill="currentColor"/>' +
    '<rect x="-1.45" y="-9.7" width="2.9" height="2" rx="1" fill="#9fe8ff"/>' +
    '<rect x="-2.5" y="-7.3" width="1.1" height="1.2" fill="#0a0c11"/>' +
    '<rect x="1.4" y="-7.3" width="1.1" height="1.2" fill="#0a0c11"/>' +
    '<path d="M-6.4,-2.6 L-9.3,1 L-8.5,2 L-5.8,0.8 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M6.4,-2.6 L9.3,1 L8.5,2 L5.8,0.8 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-4.6,5 L-6.8,11 L-7.7,10.3 L-5.7,5.5 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M4.6,5 L6.8,11 L7.7,10.3 L5.7,5.5 Z" fill="currentColor" opacity=".85"/>' +
    '<path d="M-0.8,5.6 L0.8,5.6 L0.8,10.4 L-0.8,10.4 Z" fill="currentColor" opacity=".7"/></g>'
};

// On-screen scale per 'Mech (× the -12..12 design space): each sprite is
// scaled so its biggest dimension almost touches the hex edge (apothem
// ≈ 25.98 for hexSize 30). Largest silhouettes (Atlas legs, Locust legs)
// hit the target exactly; wide ones come up a little short.
BT.MECH_SCALE = {
  locust: 1.94, jenner: 1.91, phoenixhawk: 2.40,
  shadowhawk: 3.06, thunderbolt: 2.66, warhammer: 2.66,
  awesome: 2.58, atlas: 2.23
};

/* ── MegaMek mech sprites ──────────────────────────────────────────
   Classic top-down BattleMech sprites from the open-source MegaMek
   data set (https://github.com/MegaMek/mm-data,
   data/images/units/meks/*.png, GPL-2.0). Each is pre-tinted per
   side here in src/sprites/meks/<host|guest>/ and cropped to its
   visible content (cw×ch in source px). `fit` is the longest-axis
   target in hex world units — the hex apothem is ≈26 units at
   hexSize 30, so 42–48.5 fills the hex. BT.MECH_SVG + BT.MECH_SCALE
   remain as a fallback for any spec without a sprite. */
BT.SPRITE = {
  locust:      { host: "src/sprites/meks/host/Locust.png",      guest: "src/sprites/meks/guest/Locust.png",      cw: 35, ch: 38, fit: 45 },
  jenner:      { host: "src/sprites/meks/host/Jenner.png",      guest: "src/sprites/meks/guest/Jenner.png",      cw: 45, ch: 44, fit: 47 },
  phoenixhawk: { host: "src/sprites/meks/host/PhoenixHawk.png", guest: "src/sprites/meks/guest/PhoenixHawk.png", cw: 49, ch: 43, fit: 48 },
  shadowhawk:  { host: "src/sprites/meks/host/Shadowhawk.png",  guest: "src/sprites/meks/guest/Shadowhawk.png",  cw: 52, ch: 40, fit: 49 },
  thunderbolt: { host: "src/sprites/meks/host/Thunderbolt.png", guest: "src/sprites/meks/guest/Thunderbolt.png", cw: 59, ch: 51, fit: 49.5 },
  warhammer:   { host: "src/sprites/meks/host/Warhammer.png",   guest: "src/sprites/meks/guest/Warhammer.png",   cw: 57, ch: 49, fit: 50 },
  awesome:     { host: "src/sprites/meks/host/Awesome.png",     guest: "src/sprites/meks/guest/Awesome.png",     cw: 69, ch: 48, fit: 50 },
  atlas:       { host: "src/sprites/meks/host/Atlas.png",       guest: "src/sprites/meks/guest/Atlas.png",       cw: 71, ch: 52, fit: 50 }
};

/* ════════════════════════════════════════════════════════════════════
   BT.Mech — one 'Mech's live record sheet.
   Serialization: the full object survives JSON.stringify (methods live
   on the prototype); BT.Mech.fromPlain rebuilds it after a restore.
   ════════════════════════════════════════════════════════════════════ */
BT.Mech = class Mech {
  constructor(spec, side, idx) {
    this.spec = spec.id;
    this.type = spec.type;
    this.name = spec.name;
    this.tons = spec.tons;
    this.walk = spec.walk;
    this.run = spec.run;
    this.jump = spec.jump;
    this.hs = spec.hs;                 // heat sinks currently functional
    this.hsMax = spec.hs;
    this.armor = Object.assign({}, spec.armor);
    this.structure = Object.assign({}, spec.structure);
    this.heat = 0;
    this.engineCrits = 0;
    this.gyroCrits = 0;
    this.sensorsCrit = false;
    this.armActCrits = { la:0, ra:0 };
    this.prone = false;
    this.shutdown = false;
    this.destroyed = false;
    this.pilotHp = 3;
    this.pilotOut = false;
    this.movedThisTurn = false;
    this.moveMode = null;              // walk | run | jump | stand
    this.hexesMoved = 0;
    this.lastMove = null;              // {mode, hexes} → target movement mod
    this.meleeDone = false;
    this.side = side;
    this.idx = idx;
    this.pilot = (BT.PILOTS[side] && BT.PILOTS[side][idx % BT.PILOTS[side].length]) || "Unknown";
    this.tokenId = null;
    this.q = 0; this.r = 0;

    this.weapons = [];
    let wid = 0;
    for (const w of spec.weapons) {
      const wt = BT.WEAPONS[w.t];
      for (let i = 0; i < w.n; i++) {
        this.weapons.push({
          id: "w" + (wid++), t: w.t, name: wt.name, loc: w.loc,
          destroyed: false, fired: false,
          ammo: wt.ammo != null ? wt.ammo : null,
          ammoMax: wt.ammo != null ? wt.ammo : null
        });
      }
    }

    // critical-hit slots per location
    this.crits = {};
    for (const loc of BT.LOCATIONS) this.crits[loc] = [];
    this._addCrits("ct", [{k:"engine",n:3},{k:"gyro",n:2}]);
    for (const wp of this.weapons) {
      this._addCrits(wp.loc, [{k:"w", w:wp.id, n:BT.WEAPONS[wp.t].crits}]);
      if (wp.ammo != null) this._addCrits(wp.loc, [{k:"ammo", w:wp.id, n:1}]);
    }
    let jj = spec.jump;
    const jjLocs = ["ct","lt","rt","ll","rl"];
    for (let i = 0; i < jjLocs.length && jj > 0; i++) { this._addCrits(jjLocs[i], [{k:"jj",n:1}]); jj--; }
    let rem = spec.hs;
    for (const loc of ["ct","lt","rt","ll","rl","la","ra"]) {
      if (rem <= 0) break;
      const n = Math.min(rem, this._freeSlots(loc));
      if (n > 0) { this._addCrits(loc, [{k:"hs",n:n}]); rem -= n; }
    }
    this._addCrits("la", [{k:"act",n:2}]);
    this._addCrits("ra", [{k:"act",n:2}]);
    this._addCrits("ll", [{k:"act",n:2},{k:"foot",n:1}]);
    this._addCrits("rl", [{k:"act",n:2},{k:"foot",n:1}]);
    this._addCrits("hd", [{k:"cockpit",n:1},{k:"sensors",n:1},{k:"ls",n:1}]);

    this.slotList = {};   // loc -> flat [{k,w}] (one entry per crit slot)
    for (const loc of BT.LOCATIONS) {
      const arr = [];
      for (const it of this.crits[loc]) for (let i = 0; i < it.n; i++) arr.push({ k: it.k, w: it.w });
      this.slotList[loc] = arr;
    }
    this.critDamage = {};             // loc -> {slotIndex:true}
    this.legCrits = { ll:0, rl:0 };
  }
  _addCrits(loc, items){ for (const it of items) this.crits[loc].push(it); }
  _freeSlots(loc){
    const cap = { hd:3, ct:12, lt:12, rt:12, la:8, ra:8, ll:6, rl:6 }[loc] || 6;
    let used = 0;
    for (const it of this.crits[loc]) used += it.n;
    return Math.max(0, cap - used);
  }
  weaponById(id){ for (const w of this.weapons) if (w.id === id) return w; return null; }

  heatMod(){
    const h = this.heat;
    if (h >= 15) return 5;
    if (h >= 12) return 4;
    if (h >= 10) return 3;
    if (h >= 8) return 2;
    if (h >= 5) return 1;
    return 0;
  }
  moveMod(){
    const lm = this.lastMove;
    if (this.prone || this.shutdown || this.pilotOut || !lm || !lm.mode || !lm.hexes) return 0;
    if (lm.mode === "walk") return 1;
    if (lm.mode === "run") return 2;
    if (lm.mode === "jump") return 3;
    return 0;
  }
  // to-hit mod from movement taken THIS turn (applies to own shots)
  currentMoveMod(){
    if (!this.movedThisTurn || !this.moveMode || this.prone || this.shutdown || this.pilotOut) return 0;
    if (this.moveMode === "walk") return 1;
    if (this.moveMode === "run") return 2;
    if (this.moveMode === "jump") return 3;
    return 0;
  }

  toPlain(){
    return {
      spec:this.spec, side:this.side, idx:this.idx,
      heat:this.heat, engineCrits:this.engineCrits, gyroCrits:this.gyroCrits,
      sensorsCrit:this.sensorsCrit, armActCrits:this.armActCrits,
      prone:this.prone, shutdown:this.shutdown, destroyed:this.destroyed,
      pilotHp:this.pilotHp, pilotOut:this.pilotOut,
      movedThisTurn:this.movedThisTurn, moveMode:this.moveMode, hexesMoved:this.hexesMoved,
      lastMove:this.lastMove, meleeDone:this.meleeDone,
      hs:this.hs, jump:this.jump, armor:this.armor, structure:this.structure,
      legCrits:this.legCrits, critDamage:this.critDamage,
      weapons:this.weapons.map(w => ({ id:w.id, t:w.t, loc:w.loc, destroyed:w.destroyed, fired:w.fired, ammo:w.ammo }))
    };
  }
  static fromPlain(o){
    const m = new BT.Mech(BT.MECHS[o.spec], o.side, o.idx);
    m.heat=o.heat; m.engineCrits=o.engineCrits; m.gyroCrits=o.gyroCrits;
    m.sensorsCrit=!!o.sensorsCrit; m.armActCrits=Object.assign({la:0,ra:0},o.armActCrits);
    m.prone=!!o.prone; m.shutdown=!!o.shutdown; m.destroyed=!!o.destroyed;
    m.pilotHp=o.pilotHp; m.pilotOut=!!o.pilotOut;
    m.movedThisTurn=!!o.movedThisTurn; m.moveMode=o.moveMode||null; m.hexesMoved=o.hexesMoved||0;
    m.lastMove=o.lastMove||null; m.meleeDone=!!o.meleeDone;
    m.hs=o.hs; m.jump=o.jump;
    m.armor=Object.assign({},o.armor); m.structure=Object.assign({},o.structure);
    m.legCrits=Object.assign({ll:0,rl:0},o.legCrits);
    m.critDamage=JSON.parse(JSON.stringify(o.critDamage||{}));
    for (const w of (o.weapons||[])) {
      const wp = m.weapons.find(x => x.id === w.id);
      if (wp){ wp.destroyed=!!w.destroyed; wp.fired=!!w.fired; wp.ammo=w.ammo; }
    }
    for (const loc in m.critDamage) for (const si in m.critDamage[loc]) if (m.critDamage[loc][si]) (m.critDamage[loc])[si]=true;
    return m;
  }
};

/* ════════════════════════════════════════════════════════════════════
   combat engine — BT.* functions operate on (game, mech, ev)
   where `ev` is a {hits:[]} log accumulator the UI drains into the
   turn log.
   ════════════════════════════════════════════════════════════════════ */

BT.isWoods = function(cell){ return cell && cell.terrain === BT.TERRAIN.woods; };

// Line of sight + intervening woods count between two hexes.
// Mountain blocks; a ridge at or above the higher observer blocks;
// woods never fully block (they add to-hit modifiers instead).
BT.los = function(game, a, b){
  const board = game.board;
  const line = board.line(a, b);
  const ea = board.elevationOf(a[0], a[1]), eb = board.elevationOf(b[0], b[1]);
  const high = Math.max(ea, eb);
  let woods = 0, blocked = false;
  for (let i = 1; i < line.length - 1; i++) {
    const c = board.cell(line[i][0], line[i][1]);
    if (!c) continue;
    if (c.terrain === BT.TERRAIN.mountain) blocked = true;
    if (c.terrain === BT.TERRAIN.woods) woods++;
    if ((c.elevation || 0) >= high) blocked = true;
  }
  return { los: !blocked, woods };
};

BT.rangeBracket = function(dist, base){
  if (dist <= base.short) return "short";
  if (dist <= base.med) return "medium";
  if (dist <= base.long) return "long";
  return "out";
};
BT.rangeMod = function(b){
  if (b === "short") return 0;
  if (b === "medium") return 2;
  if (b === "long") return 4;
  return 99;
};

// To-hit number for a weapon shot. Returns null if out of range.
BT.hitTN = function(game, atk, def, wp, base, dist, losInfo){
  let tn = 4;   // gunnery
  tn += atk.currentMoveMod();
  tn += def.moveMod();
  if (def.prone) tn += 1;
  const b = BT.rangeBracket(dist, base);
  if (b === "out") return null;
  tn += BT.rangeMod(b);
  if (base.min && dist < base.min) tn += (base.min - dist);  // minimum range
  let wm = losInfo ? losInfo.woods : 0;
  if (wm === 0 && dist > 1 && BT.isWoods(game.board.cell(def.q, def.r))) wm = 1;
  if (dist === 1) wm = 0;                                   // adjacent: no cover bonus
  tn += Math.min(2, wm);
  tn += atk.heatMod();
  tn += atk.gyroCrits;
  if (atk.sensorsCrit) tn += 1;
  if (wp.loc === "la" && atk.armActCrits.la) tn += atk.armActCrits.la;
  if (wp.loc === "ra" && atk.armActCrits.ra) tn += atk.armActCrits.ra;
  return tn;
};

BT.rollHit = function(tn){
  const roll = BT.roll2d6();
  const hit = roll >= 12 ? true : roll <= 2 ? false : roll >= tn;
  return { roll, hit };
};

BT.destroyMech = function(game, mech, cause, ev){
  if (mech.destroyed) return;
  mech.destroyed = true;
  const causeTxt = cause === "cockpit" ? "the cockpit is breached, the pilot is dead"
    : cause === "engine" ? "the fusion engine is destroyed"
    : cause === "head" ? "the head is destroyed"
    : cause === "ct" ? "the center torso is destroyed"
    : "destroyed";
  ev.hits.push(mech.name + " is DESTROYED — " + causeTxt + "!");
  const token = game.tokenById(mech.tokenId);
  if (token) game.removeToken(token);
};

BT.pilotOut = function(game, mech, ev){
  if (mech.pilotOut) return;
  mech.pilotOut = true;
  ev.hits.push(mech.name + "'s pilot is KNOCKED OUT!");
  BT.fall(game, mech, "pilot knocked out", ev);
};

BT.fall = function(game, mech, reason, ev){
  if (mech.prone) return;
  mech.prone = true;
  ev.hits.push(mech.name + " falls over (" + reason + ")!");
  const dmg = Math.floor(mech.tons / 10);
  if (dmg > 0) {
    const loc = BT.HIT_TABLE[BT.roll2d6()];
    ev.hits.push("  Fall damage: " + dmg + " to the " + BT.LOC_FULL[loc] + ".");
    BT.applyDamage(game, mech, loc, dmg, ev);
  }
  if (BT.roll2d6() >= 10) {
    mech.pilotHp--;
    ev.hits.push("  The pilot takes a wound from the fall (" + Math.max(0, mech.pilotHp) + " left).");
    if (mech.pilotHp <= 0) BT.pilotOut(game, mech, ev);
  }
};

BT.ammoExplosion = function(game, mech, loc, wId, ev){
  const wp = mech.weaponById(wId);
  if (!wp || wp.ammo == null) return;
  const base = BT.WEAPONS[wp.t];
  const volley = base.missiles ? base.missiles * base.mdm : base.dmg;
  const magnitude = Math.min(2 * mech.tons, volley * wp.ammoMax);
  ev.hits.push("AMMO EXPLOSION! The " + wp.name + " bin in the " + BT.LOC_FULL[loc] + " detonates for " + magnitude + " damage!");
  wp.ammo = 0;
  if (loc === "ct" || loc === "hd") BT.applyDamage(game, mech, loc, magnitude, ev);
  else BT.destroyLocation(game, mech, loc, ev, magnitude);
};

BT.destroyArm = function(game, mech, armLoc, ev){
  if (mech.structure[armLoc] <= 0 && mech.armor[armLoc] <= 0) return;
  ev.hits.push("The " + BT.LOC_FULL[armLoc] + " is blown off!");
  mech.armor[armLoc] = 0; mech.structure[armLoc] = 0;
  for (const wp of mech.weapons) if (wp.loc === armLoc) wp.destroyed = true;
};

BT.destroyLeg = function(game, mech, legLoc, ev){
  if (mech.legCrits[legLoc] >= 3) return;
  mech.legCrits[legLoc] = 3;
  ev.hits.push("The " + BT.LOC_FULL[legLoc] + " is destroyed!");
  mech.walk = Math.max(0, Math.floor(mech.walk / 2));
  mech.run = Math.max(0, Math.floor(mech.run / 2));
  BT.fall(game, mech, "leg destroyed", ev);
};

// A location collapses: its gear is lost, ammo explodes, side torso
// takes the arm with it, and excess damage transfers inward.
BT.destroyLocation = function(game, mech, loc, ev, dmg){
  if (mech.structure[loc] < 0) return;   // already destroyed this turn
  mech.structure[loc] = -1;              // mark destroyed (sentinel)
  mech.armor[loc] = 0;
  ev.hits.push("The " + BT.LOC_FULL[loc] + " is destroyed!");
  for (const wp of mech.weapons) {
    if (wp.loc !== loc) continue;
    if (wp.ammo != null && wp.ammo > 0) BT.ammoExplosion(game, mech, loc, wp.id, ev);
    wp.destroyed = true;
  }
  if (loc === "lt") BT.destroyArm(game, mech, "la", ev);
  if (loc === "rt") BT.destroyArm(game, mech, "ra", ev);
  if (loc === "ll" || loc === "rl") BT.destroyLeg(game, mech, loc, ev);
  if (loc === "ct") BT.destroyMech(game, mech, "ct", ev);
  else if (loc === "hd") BT.destroyMech(game, mech, "head", ev);
  else if (dmg) BT.applyDamage(game, mech, BT.TRANSFER[loc], dmg, ev);
};

BT.slotEffect = function(game, mech, loc, slot, ev){
  switch (slot.k) {
    case "hs":
      mech.hs = Math.max(0, mech.hs - 1);
      ev.hits.push("  A heat sink in the " + BT.LOC_FULL[loc] + " is destroyed (dissipation " + mech.hs + ").");
      break;
    case "jj":
      mech.jump = Math.max(0, mech.jump - 1);
      ev.hits.push("  A jump jet is destroyed (jump MP " + mech.jump + ").");
      break;
    case "w": {
      const wp = mech.weaponById(slot.w);
      if (wp && !wp.destroyed) { wp.destroyed = true; ev.hits.push("  The " + wp.name + " in the " + BT.LOC_FULL[loc] + " is destroyed!"); }
      break;
    }
    case "ammo":
      BT.ammoExplosion(game, mech, loc, slot.w, ev);
      break;
    case "engine":
      mech.engineCrits++;
      ev.hits.push("  Engine critical (" + mech.engineCrits + "/3) — +5 heat every turn!");
      if (mech.engineCrits >= 3) BT.destroyMech(game, mech, "engine", ev);
      break;
    case "gyro":
      mech.gyroCrits++;
      ev.hits.push("  Gyro critical (" + mech.gyroCrits + "/2) — +1 to-hit!");
      if (mech.gyroCrits >= 2) BT.fall(game, mech, "gyro destroyed", ev);
      break;
    case "act":
      if (loc === "la" || loc === "ra") {
        mech.armActCrits[loc]++;
        ev.hits.push("  " + BT.LOC_FULL[loc] + " actuator damaged — its weapons are +" + mech.armActCrits[loc] + " to-hit.");
      } else {
        mech.legCrits[loc] = (mech.legCrits[loc] || 0) + 1;
        ev.hits.push("  Leg actuator damaged in the " + BT.LOC_FULL[loc] + " (" + mech.legCrits[loc] + "/3).");
        if (mech.legCrits[loc] >= 3) BT.destroyLeg(game, mech, loc, ev);
      }
      break;
    case "foot":
      mech.legCrits[loc] = (mech.legCrits[loc] || 0) + 1;
      ev.hits.push("  Foot actuator damaged in the " + BT.LOC_FULL[loc] + " (" + mech.legCrits[loc] + "/3).");
      if (mech.legCrits[loc] >= 3) BT.destroyLeg(game, mech, loc, ev);
      break;
    case "sensors":
      mech.sensorsCrit = true;
      ev.hits.push("  Sensors knocked out — +1 to-hit!");
      break;
    case "ls":
      mech.pilotHp--;
      ev.hits.push("  Life support hit — the pilot takes a wound (" + Math.max(0, mech.pilotHp) + " left)!");
      if (mech.pilotHp <= 0) BT.pilotOut(game, mech, ev);
      break;
    case "cockpit":
      BT.destroyMech(game, mech, "cockpit", ev);
      break;
    default:
      ev.hits.push("  The " + BT.LOC_FULL[loc] + " takes a structural hit.");
  }
};

BT.rollCrits = function(game, mech, loc, ev){
  const roll = BT.roll2d6();
  if (roll < 8) return;
  const n = roll === 12 ? 3 : roll >= 10 ? 2 : 1;
  ev.hits.push("  Critical hit check " + roll + " → " + n + " critical" + (n > 1 ? "s" : "") + "!");
  for (let i = 0; i < n; i++) {
    const list = mech.slotList[loc];
    const dmg = mech.critDamage[loc] || {};
    const avail = [];
    for (let si = 0; si < list.length; si++) if (!dmg[si]) avail.push(si);
    if (!avail.length) { ev.hits.push("  No slots left in the " + BT.LOC_FULL[loc] + "."); return; }
    const si = avail[Math.floor(Math.random() * avail.length)];
    (mech.critDamage[loc] = mech.critDamage[loc] || {})[si] = true;
    BT.slotEffect(game, mech, loc, list[si], ev);
  }
};

// Apply `dmg` points to a hit location, handling armor → structure →
// crits → transfer when a location is destroyed.
BT.applyDamage = function(game, mech, loc, dmg, ev){
  let remaining = dmg;
  while (remaining > 0 && !mech.destroyed) {
    if (mech.structure[loc] <= 0) {
      const next = BT.TRANSFER[loc];
      if (!next) {
        if (loc === "hd") BT.destroyMech(game, mech, "head", ev);
        break;
      }
      ev.hits.push("  Damage transfers from the " + BT.LOC_FULL[loc] + " to the " + BT.LOC_FULL[next] + ".");
      loc = next;
      continue;
    }
    if (mech.armor[loc] > 0) {
      const absorbed = Math.min(mech.armor[loc], remaining);
      mech.armor[loc] -= absorbed;
      remaining -= absorbed;
      ev.hits.push("  " + absorbed + " dmg to " + BT.LOC_FULL[loc] + " armor (" + mech.armor[loc] + " left).");
    } else {
      const absorbed = Math.min(mech.structure[loc], remaining);
      mech.structure[loc] -= absorbed;
      remaining -= absorbed;
      ev.hits.push("  " + absorbed + " dmg to " + BT.LOC_FULL[loc] + " internal structure (" + mech.structure[loc] + " left).");
      if (loc === "hd") {
        mech.pilotHp--;
        ev.hits.push("  Head hit! The pilot takes a wound (" + Math.max(0, mech.pilotHp) + " left).");
        if (mech.pilotHp <= 0) BT.pilotOut(game, mech, ev);
      }
      BT.rollCrits(game, mech, loc, ev);
      if (mech.structure[loc] <= 0) BT.destroyLocation(game, mech, loc, ev);
    }
  }
  return ev;
};

BT.fireWeapon = function(game, atkMech, wp, defMech, ev){
  if (wp.fired) {
    ev.hits.push(wp.name + " has already fired this turn.");
    return ev;
  }
  const dist = game.board.distance([atkMech.q, atkMech.r], [defMech.q, defMech.r]);
  const warc = BT.weaponArc(wp);
  const arc = BT.arcOf(game, game.tokenById(atkMech.tokenId), game.tokenById(defMech.tokenId));
  if (arc && arc !== warc) {
    const side = arc === "la" ? "to the left" : arc === "ra" ? "to the right" : "in front";
    ev.hits.push(wp.name + " (" + BT.ARC_FULL[warc] + ") can't reach a target " + side + ".");
    return ev;
  }
  const losInfo = BT.los(game, [atkMech.q, atkMech.r], [defMech.q, defMech.r]);
  const base = BT.WEAPONS[wp.t];
  const tn = BT.hitTN(game, atkMech, defMech, wp, base, dist, losInfo);
  if (tn == null) { ev.hits.push(wp.name + " is out of range (" + dist + " hexes)."); return ev; }
  const b = BT.rangeBracket(dist, base);
  const r = BT.rollHit(tn);
  wp.fired = true;
  atkMech.heat += base.heat;
  if (wp.ammo != null) wp.ammo = Math.max(0, wp.ammo - 1);
  ev.hits.push(wp.name + " at " + dist + " hexes (" + b + " range, need " + tn + ", rolled " + r.roll + ") → " + (r.hit ? "HIT!" : "miss."));
  if (!r.hit) return ev;
  if (base.missiles) {
    const hits = BT.clusterHits(base.missiles);
    ev.hits.push("  Cluster roll: " + hits + " of " + base.missiles + " missiles strike.");
    for (let i = 0; i < hits; i++) {
      if (defMech.destroyed) break;
      const loc = BT.HIT_TABLE[BT.roll2d6()];
      BT.applyDamage(game, defMech, loc, base.mdm, ev);
    }
  } else {
    const loc = BT.HIT_TABLE[BT.roll2d6()];
    BT.applyDamage(game, defMech, loc, base.dmg, ev);
  }
  if (base.targetHeat) { defMech.heat += base.targetHeat; ev.hits.push("  The flamer dumps " + base.targetHeat + " heat on the target!"); }
  return ev;
};

BT.physical = function(game, atkMech, defMech, kind, ev){
  let tn = 4 + atkMech.currentMoveMod() + defMech.moveMod();
  if (defMech.prone) tn += 1;
  const r = BT.rollHit(tn);
  atkMech.meleeDone = true;
  atkMech.heat += 1;
  ev.hits.push(kind.charAt(0).toUpperCase() + kind.slice(1) + " (need " + tn + ", rolled " + r.roll + ") → " + (r.hit ? "HIT!" : "miss."));
  if (!r.hit) return ev;
  const table = kind === "kick" ? BT.KICK_TABLE : BT.PUNCH_TABLE;
  const dmg = kind === "kick" ? Math.ceil(atkMech.tons / 5) : Math.ceil(atkMech.tons / 10);
  const loc = table[BT.roll2d6()];
  ev.hits.push("  " + dmg + " damage to the " + BT.LOC_FULL[loc] + ".");
  BT.applyDamage(game, defMech, loc, dmg, ev);
  return ev;
};

window.BT = BT;
/* ════════════════════════════════════════════════════════════════════
   firing arcs — every weapon mount has an arc, and a 'Mech can only
   fire a weapon if its target lies inside that arc:
     Torso (CT/LT/RT/HD) → the front 120° wedge centred on facing
     Left Arm            → the 120° wedge on the 'Mech's left
     Right Arm           → the 120° wedge on the 'Mech's right
   Angles are "compass" degrees (0=north, 90=east, clockwise). The
   token's .facing is the compass direction its nose points.
   ════════════════════════════════════════════════════════════════════ */
BT.LOC_ARC = { hd:"torso", ct:"torso", lt:"torso", rt:"torso", la:"la", ra:"ra" };
BT.ARC_FULL = { torso:"Torso", la:"Left Arm", ra:"Right Arm" };
BT.MAX_RANGE = Object.keys(BT.WEAPONS).reduce((mx, k) => Math.max(mx, BT.WEAPONS[k].long || 0), 0);

BT.weaponArc = function(wp){ return BT.LOC_ARC[wp && wp.loc] || "torso"; };

// Compass bearing (0=north, 90=east, clockwise) of board cell b as
// seen from board cell a.
BT.bearing = function(board, a, b){
  const [ax, ay] = HexMath.toPixel(a[0], a[1], 1);
  const [bx, by] = HexMath.toPixel(b[0], b[1], 1);
  const ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
  return (ang + 450) % 360;          // math angle → compass
};

// Which arc a target bearing lies in for a given facing.
BT.arcFor = function(facing, bearing){
  let rel = (bearing - facing) % 360;
  if (rel > 180) rel -= 360;
  if (rel < -180) rel += 360;
  if (rel >= -60 && rel <= 60) return "torso";
  return rel > 0 ? "ra" : "la";
};

// Arc of target token relative to attacker token (facing-aware).
BT.arcOf = function(game, atkTok, defTok){
  if (!atkTok || !defTok) return null;
  const b = BT.bearing(game.board, [atkTok.q, atkTok.r], [defTok.q, defTok.r]);
  return BT.arcFor(BT.effFacing(atkTok), b);
};

// Torso direction: legs-facing plus any torso twist (±60°, one hex-face).
// Legs stay put on the board; the torso's weapons/arcs point this way.
BT.effFacing = function(tok){
  return ((((tok.facing || 0) + (tok.twist || 0) * 60) % 360) + 360) % 360;
};

// Round a compass bearing to the nearest 60° hex facing.
BT.snapFacing = function(angle){
  return ((Math.round(angle / 60) * 60) % 360 + 360) % 360;
};

BT.FACING_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
BT.facingName = function(angle){
  const i = Math.round(((angle % 360 + 360) % 360) / 45) % 8;
  return BT.FACING_NAMES[i];
};
