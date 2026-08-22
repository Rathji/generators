/* ════════════════════════════════════════════════════════════════
   BGN DECK — shared SVG card engine (the "Standard Deck" API)
   ════════════════════════════════════════════════════════════════
   A self-contained playing-card renderer for Boardgame Network
   games. Load it in any template:
     <script src="https://user.uploads.dev/file/0a9d240fe01879d3602b7e8716b3ab02.js"></script>
   Then you get (all on window):
     standardDeck   → the 54-card pack ({id,suit,rank} + 2 jokers)
     buildDeck({suits, ranks, jokers}) → a fresh pack built from your
                 own suits/ranks/jokers (jokers 0-4; ids start at 0).
                 PACK_DEFAULTS holds the 52+2 default.
     renderCard(card[,opts]) → a .bgn-card element (SVG face + ornate
                 back, click-to-flip, hover-to-zoom). opts.hover:false
                 disables zoom; opts.faceDown starts flipped.
     renderCardBack() → just the ornate back element
     cardFaceSVG(card) → raw face as inline <svg> markup
     cardBackSVG()     → raw back as inline <svg> markup
     cardName(card)    → "Ace of Spades", "Red Joker", …
     suitColor(suit)   → "#b3122b" for red suits, else "#1b2030"
   Everything is also namespaced under window.bgnDeck. The .bgn-card
   CSS (sizing via --w, flip, hover-zoom, fan/grid/backspot layouts)
   is injected automatically — no stylesheet link needed.
   ════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
if(window.bgnDeck) return;  // already loaded once
var CARD_CSS = `.bgn-card{ --w:74px; width:var(--w); aspect-ratio:200/280; position:relative; flex:none;
  perspective:850px; cursor:zoom-in; will-change:transform, z-index;
  transition:transform .18s ease-out; user-select:none; }
.bgn-card-dim{ position:absolute; inset:0; transform-style:preserve-3d; transition:transform .5s cubic-bezier(.25,.7,.3,1); }
.bgn-card.flipped .bgn-card-dim{ transform:rotateY(180deg); }
.bgn-card-face, .bgn-card-back{ position:absolute; inset:0; border-radius:11px; overflow:hidden;
  backface-visibility:hidden; -webkit-backface-visibility:hidden;
  box-shadow:0 3px 9px rgba(0,0,0,.42), inset 0 0 0 1px rgba(0,0,0,.3);
  transition:box-shadow .18s ease-out; }
.bgn-card-back{ transform:rotateY(180deg); }
.bgn-card svg{ display:block; width:100%; height:100%; }
.bgn-card:not(.nohover):hover{ transform:scale(1.5); z-index:60; }
.bgn-card:not(.nohover):hover .bgn-card-face,
.bgn-card:not(.nohover):hover .bgn-card-back{ box-shadow:0 22px 48px rgba(0,0,0,.62), 0 0 28px rgba(212,175,55,.35); }
@media (hover:none){ .bgn-card:not(.nohover):hover{ transform:none; } }
.bgn-backspot{ display:flex; justify-content:center; padding:6px 0 4px; }
.bgn-backspot .bgn-card{ --w:124px; }
.bgn-fan{ display:flex; justify-content:center; align-items:flex-end; min-height:196px;
  padding:34px 8px 8px; overflow:visible; }
.bgn-fan .bgn-card{ --w:94px; }
.bgn-fan .bgn-card:not(:first-child){ margin-left:-50px; }
.bgn-fan .bgn-card:hover{ rotate:0deg; }
.bgn-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(64px,1fr)); gap:14px; justify-items:center; }
.bgn-grid .bgn-card{ --w:64px; }
@media (max-width:560px){ .bgn-grid{ grid-template-columns:repeat(auto-fill,minmax(52px,1fr)); gap:10px; } .bgn-grid .bgn-card{ --w:52px; } }`;
(function injectCss(){
  var st=document.createElement("style");
  st.id="bgn-deck-css"; st.textContent=CARD_CSS;
  if(document.head){ document.head.appendChild(st); }
  else if(document.addEventListener){ document.addEventListener("DOMContentLoaded",function(){ document.head.appendChild(st); }); }
})();

/* ══════════ the deck ══════════ */
const PACK_DEFAULTS = { suits:["spades","hearts","clubs","diamonds"], ranks:["A","2","3","4","5","6","7","8","9","10","J","Q","K"], jokers:2 };
function buildDeck(opts){
  opts = opts || {};
  const suits = (Array.isArray(opts.suits) && opts.suits.length) ? opts.suits.map(s=>String(s).toLowerCase()) : PACK_DEFAULTS.suits.slice();
  const ranks = (Array.isArray(opts.ranks) && opts.ranks.length) ? opts.ranks.map(String) : PACK_DEFAULTS.ranks.slice();
  let jokers = Number(opts.jokers);
  if(!Number.isFinite(jokers) || jokers < 0) jokers = PACK_DEFAULTS.jokers;
  const deck = [];
  let id = 0;
  for(const suit of suits) for(const rank of ranks) deck.push({ id:id++, suit, rank });
  const nJ = Math.min(4, Math.floor(jokers));
  for(let i=0;i<nJ;i++) deck.push({ id:id++, joker:true, color:(i%2===0)?"red":"black" });
  return deck;
}
const standardDeck = buildDeck(PACK_DEFAULTS);

function suitColor(suit){ return (suit==="hearts"||suit==="diamonds") ? "#b3122b" : "#1b2030"; }
function suitName(suit){ return suit[0].toUpperCase()+suit.slice(1); }
function cardName(card){
  if(card.joker) return (card.color==="red"?"Red":"Black")+" Joker";
  return card.rank+" of "+suitName(card.suit);
}

/* ══════════ suit glyphs (drawn once, reused everywhere) ══════════
   Shapes from https://sean.brunnock.com/SVG/suits.html — centered on origin. */
function suitShapes(suit){
  switch(suit){
    case "hearts":   return '<path d="M0-22.2L24.75 2.5 0 27.3-24.75 2.5Z"/><circle cx="12.4" cy="-9.8" r="17.5"/><circle cx="-12.4" cy="-9.8" r="17.5"/>';
    case "diamonds": return '<path d="M0-32.5L28.3 0 0 32.5-28.3 0Z"/>';
    case "spades":   return '<path d="M0-29.2L21.2-8 0 13.2-21.2-8Z"/><circle cx="10.6" cy="2.6" r="15"/><circle cx="-10.6" cy="2.6" r="15"/><path d="M0-1Q0 19-10 29H10Q0 19 0-1Z"/>';
    case "clubs":    return '<circle cx="-12" cy="5" r="14"/><circle cx="0" cy="-15" r="14"/><circle cx="12" cy="5" r="14"/><path d="M0 0Q0 20-10 30H10Q0 20 0 0Z"/>';
  }
  return "";
}
function suitMarkup(suit, fill, outlineW){
  const o = outlineW||0;
  if(!o) return `<g fill="${fill}">${suitShapes(suit)}</g>`;
  return `<g fill="rgba(251,246,231,.92)" stroke="rgba(251,246,231,.92)" stroke-width="${o*2}" stroke-linejoin="round" stroke-linecap="round">${suitShapes(suit)}</g>
    <g fill="${fill}">${suitShapes(suit)}</g>`;
}

/* ══════════ shared SVG defs (gradients, shadow) ══════════ */
const DEFS = `
  <defs>
    <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbeec0"/><stop offset=".45" stop-color="#e7c96a"/>
      <stop offset=".7" stop-color="#d4af37"/><stop offset="1" stop-color="#8f721d"/>
    </linearGradient>
    <linearGradient id="faceGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdfaf1"/><stop offset="1" stop-color="#efe7d3"/>
    </linearGradient>
    <radialGradient id="faceVin" cx="50%" cy="42%" r="74%">
      <stop offset=".68" stop-color="rgba(70,48,18,0)"/><stop offset="1" stop-color="rgba(70,48,18,.18)"/>
    </radialGradient>
    <radialGradient id="backGrad" cx="50%" cy="40%" r="82%">
      <stop offset="0" stop-color="#2a2347"/><stop offset=".55" stop-color="#181226"/><stop offset="1" stop-color="#0b0914"/>
    </radialGradient>
    <radialGradient id="medGrad" cx="50%" cy="36%" r="76%">
      <stop offset="0" stop-color="#302753"/><stop offset="1" stop-color="#100d1e"/>
    </radialGradient>
    <linearGradient id="courtGradRed" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7c1230"/><stop offset="1" stop-color="#450718"/>
    </linearGradient>
    <linearGradient id="courtGradDark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1f2542"/><stop offset="1" stop-color="#0f1220"/>
    </linearGradient>
    <pattern id="latticePat" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0L20 20M20 0L0 20" stroke="rgba(212,175,55,.13)" stroke-width="1.1" fill="none"/>
      <circle cx="10" cy="10" r="1" fill="rgba(212,175,55,.18)"/>
    </pattern>
    <filter id="softSh" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1.4" stdDeviation="1.6" flood-color="rgba(0,0,0,.38)"/>
    </filter>
  </defs>`;

const STAR = '<path d="M0-11l4.6 3.2-.9 5.6 3.7 4.3-4.4 3.5-.4 5.6L0 8l-2.6 3.2-.4-5.6-4.4-3.5 3.7-4.3-.9-5.6L0-11z"/>';

/* ══════════ pip layouts for numbered ranks ══════════ */
const PIP = {
  "2": [[100,95],[100,185]],
  "3": [[100,80],[100,140],[100,200]],
  "4": [[70,85],[130,85],[70,195],[130,195]],
  "5": [[70,80],[130,80],[100,140],[70,200],[130,200]],
  "6": [[70,80],[130,80],[70,140],[130,140],[70,200],[130,200]],
  "7": [[100,64],[70,100],[130,100],[70,160],[130,160],[70,220],[130,220]],
  "8": [[70,70],[130,70],[70,118],[130,118],[70,166],[130,166],[70,214],[130,214]],
  "9": [[70,62],[130,62],[70,114],[130,114],[100,140],[70,166],[130,166],[70,218],[130,218]],
  "10":[[70,62],[130,62],[70,114],[130,114],[84,140],[116,140],[70,166],[130,166],[70,218],[130,218]]
};

/* ══════════ card face builders ══════════ */
function cornerIndex(rank, suit, x, y, rot){
  const col = suitColor(suit);
  const fs = String(rank).length>1 ? 30 : 34;
  return `<g transform="translate(${x} ${y})${rot?" rotate(180)":""}">
    <text y="0" font-size="${fs}" font-weight="700" text-anchor="start"
      font-family="Georgia,'Times New Roman',serif" fill="${col}">${rank}</text>
    <g transform="translate(0 ${fs>30?12:14}) scale(.38)" fill="${col}">${suitShapes(suit)}</g>
  </g>`;
}
function pipArt(rank, suit){
  const col = suitColor(suit);
  const sc = rank<=6 ? .55 : rank<=8 ? .5 : rank===10 ? .45 : .48;
  return (PIP[rank]||[]).map((p)=>{
    return `<g transform="translate(${p[0]} ${p[1]}) scale(${sc})" fill="${col}" filter="url(#softSh)">${suitShapes(suit)}</g>`;
  }).join("");
}
function aceArt(suit){
  const col = suitColor(suit);
  const ty = {spades:140, hearts:140, clubs:138.5, diamonds:140}[suit] || 140;
  const bl = {hearts:152, diamonds:152, spades:165, clubs:165}[suit] || 165;
  return `<g transform="translate(100 ${ty})" filter="url(#softSh)">
    <g transform="scale(3)">${suitMarkup(suit, col, 3.5)}</g>
  </g>
  <text x="100" y="${bl}" font-size="70" font-weight="900" text-anchor="middle"
    font-family="Georgia,'Times New Roman',serif" fill="#fffdf5"
    stroke="#fffdf5" stroke-width="6">A</text>`;
}
function crownMarkup(){
  return `<g fill="url(#goldGrad)">
    <path d="M-20 8L-26-14L-9-2L0-20L9-2L26-14L20 8Z"/>
    <rect x="-20" y="8" width="40" height="5" rx="1.5"/>
    <circle cx="-26" cy="-14" r="2.4"/>
    <circle cx="0" cy="-20" r="2.4"/>
    <circle cx="26" cy="-14" r="2.4"/>
  </g>`;
}
function courtArt(rank, suit){
  const col = suitColor(suit);
  const bl = {hearts:152, diamonds:152, spades:165, clubs:165}[suit] || 165;
  return `<g transform="translate(100 44)" filter="url(#softSh)">${crownMarkup()}</g>
    <g transform="translate(100 150)" filter="url(#softSh)">
      <g transform="scale(2.7)">${suitMarkup(suit, col, 3)}</g>
    </g>
    <text x="100" y="${bl}" font-size="70" font-weight="900" text-anchor="middle"
      font-family="Georgia,'Times New Roman',serif" fill="#fffdf5"
      stroke="#fffdf5" stroke-width="6">${rank}</text>`;
}
function jokerArt(card){
  const col = card.color==="red" ? "#b3122b" : "#1b2030";
  return `<g transform="translate(17 30)"><text y="0" font-size="25" font-weight="700" fill="${col}">★</text></g>
    <g transform="translate(183 250) rotate(180)"><text y="0" font-size="25" font-weight="700" fill="${col}">★</text></g>
    <g transform="translate(100 140)" filter="url(#softSh)">
      <rect x="-52" y="-52" width="104" height="104" transform="rotate(45)" fill="none" stroke="#d4af37" stroke-width="2.2"/>
      <rect x="-44" y="-44" width="88" height="88" transform="rotate(45)" fill="rgba(212,175,55,.07)"/>
      <text y="-24" font-size="26" font-weight="700" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" fill="${col}">JOKER</text>
      <g transform="translate(0 2) scale(1.45)" fill="url(#goldGrad)">${STAR}</g>
      <text y="38" font-size="13" letter-spacing="3" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" fill="${col}">JOKER</text>
    </g>`;
}

function cardFaceSVG(card){
  if(card.joker) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280" role="img" aria-label="${cardName(card)}">${DEFS}
    <rect width="200" height="280" fill="url(#faceGrad)"/>
    <rect width="200" height="280" fill="url(#faceVin)"/>
    <rect x="6" y="6" width="188" height="268" rx="11" fill="none" stroke="#d4af37" stroke-width="2.6"/>
    <rect x="10.5" y="10.5" width="179" height="259" rx="8" fill="none" stroke="rgba(30,25,45,.35)" stroke-width="1.4" opacity=".55"/>
    ${jokerArt(card)}
  </svg>`;
  const rank = String(card.rank), suit = card.suit;
  let art;
  if(rank==="A") art = aceArt(suit);
  else if(rank==="J"||rank==="Q"||rank==="K") art = courtArt(rank,suit);
  else art = pipArt(rank,suit);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280" role="img" aria-label="${cardName(card)}">${DEFS}
    <rect width="200" height="280" fill="url(#faceGrad)"/>
    <rect width="200" height="280" fill="url(#faceVin)"/>
    <rect x="6" y="6" width="188" height="268" rx="11" fill="none" stroke="#d4af37" stroke-width="2.6"/>
    <rect x="10.5" y="10.5" width="179" height="259" rx="8" fill="none" stroke="rgba(30,25,45,.35)" stroke-width="1.4" opacity=".55"/>
    ${cornerIndex(rank,suit,19,34)}
    ${cornerIndex(rank,suit,181,246,true)}
    ${art}
  </svg>`;
}

/* ══════════ card back ══════════ */
function cornerMarkup(x,y,flip){
  return `<g transform="translate(${x} ${y})${flip?" rotate(180)":""}">
    <rect x="-9" y="-9" width="18" height="18" transform="rotate(45)" fill="none" stroke="rgba(212,175,55,.75)" stroke-width="1.3"/>
    <rect x="-4" y="-4" width="8" height="8" transform="rotate(45)" fill="rgba(212,175,55,.55)"/>
  </g>`;
}
let __backCache = null;
function cardBackSVG(){
  if(__backCache) return __backCache;
  let dots = "";
  for(let i=0;i<12;i++){
    const a = i*Math.PI/6;
    dots += `<circle cx="${(100+66*Math.cos(a)).toFixed(2)}" cy="${(140+66*Math.sin(a)).toFixed(2)}" r="2.4" fill="rgba(212,175,55,.6)"/>`;
  }
  __backCache = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280" role="img" aria-label="Card back">${DEFS}
    <rect width="200" height="280" fill="url(#backGrad)"/>
    <rect width="200" height="280" fill="url(#latticePat)"/>
    <rect x="5" y="5" width="190" height="270" rx="12" fill="none" stroke="url(#goldGrad)" stroke-width="2.4"/>
    <rect x="10" y="10" width="180" height="260" rx="9" fill="none" stroke="rgba(212,175,55,.5)" stroke-width="1"/>
    ${cornerMarkup(26,34)}
    ${cornerMarkup(174,34)}
    ${cornerMarkup(26,246,true)}
    ${cornerMarkup(174,246,true)}
    <circle cx="100" cy="140" r="60" fill="url(#medGrad)" stroke="#d4af37" stroke-width="2.4"/>
    <circle cx="100" cy="140" r="53" fill="none" stroke="rgba(212,175,55,.5)" stroke-width="1"/>
    <circle cx="100" cy="140" r="44" fill="none" stroke="rgba(212,175,55,.28)" stroke-width="1" stroke-dasharray="3 4"/>
    ${dots}
    <g transform="translate(100 140) scale(1.7)" filter="url(#softSh)"><g fill="url(#goldGrad)">${STAR}</g></g>
  </svg>`;
  return __backCache;
}

/* ══════════ DOM builders ══════════ */
function renderCard(card, opts){
  opts = opts||{};
  const el = document.createElement("div");
  el.className = "bgn-card";
  if(opts.hover===false) el.classList.add("nohover");
  const dim = document.createElement("div");
  dim.className = "bgn-card-dim";
  const face = document.createElement("div");
  face.className = "bgn-card-face";
  face.innerHTML = cardFaceSVG(card);
  const back = document.createElement("div");
  back.className = "bgn-card-back";
  back.innerHTML = cardBackSVG();
  dim.appendChild(face);
  dim.appendChild(back);
  el.appendChild(dim);
  el.title = cardName(card)+" · click to flip";
  el.addEventListener("click", function(){ el.classList.toggle("flipped"); });
  if(opts.faceDown) el.classList.add("flipped");
  return el;
}
function renderCardBack(){
  const el = document.createElement("div");
  el.className = "bgn-card nohover flipped";
  const dim = document.createElement("div");
  dim.className = "bgn-card-dim";
  const face = document.createElement("div");
  face.className = "bgn-card-face";
  face.innerHTML = cardBackSVG();
  const back = document.createElement("div");
  back.className = "bgn-card-back";
  back.innerHTML = cardBackSVG();
  dim.appendChild(face);
  dim.appendChild(back);
  el.appendChild(dim);
  el.title = "Card back";
  return el;
}

/* ══════════ expose the API for game builders ══════════ */
window.standardDeck = standardDeck;
window.renderCard = renderCard;
window.renderCardBack = renderCardBack;
window.cardBackSVG = cardBackSVG;
window.cardName = cardName;
window.buildDeck = buildDeck;
window.PACK_DEFAULTS = PACK_DEFAULTS;
if(window.root) window.root.standardDeck = standardDeck;

window.bgnDeck = {
  standardDeck: standardDeck,
  PACK_DEFAULTS: PACK_DEFAULTS,
  buildDeck: buildDeck,
  suitColor: suitColor, suitName: suitName, cardName: cardName,
  cardFaceSVG: cardFaceSVG, cardBackSVG: cardBackSVG,
  renderCard: renderCard, renderCardBack: renderCardBack
};
})();
