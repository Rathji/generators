// ============================================================================
//  src/card.js — SillyTavern-compatible character cards (CharCard V3)
//  ----------------------------------------------------------------------------
//  • buildCardV3()  — turn forge state into a V3 card object
//  • exportCardJson(card)  — download the card as .json
//  • exportCardPng(card, avatarUrl)  — download the card as a .png with the
//    card JSON embedded in a tEXt chunk (keyword "chara"), the format
//    SillyTavern and other character-card players import.
//  • importCardFile(file)  — read a .png or .json card back into
//    { card, avatarUrl }.
//
//  PNG convention (matches SillyTavern's own import/export):
//      tEXt chunk, keyword "chara"
//      text = base64( zlib-deflate( JSON.stringify(card) ) )
//  pako's deflate() produces the zlib wrapper SillyTavern expects.
//  ============================================================================

import { deflate, inflate } from 'https://esm.sh/pako@2.1.0';

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function sanitize(name) {
  const s = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
  return s || 'vgn_character';
}

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
}

// ---------------------------------------------------------------------------
// card build
// ---------------------------------------------------------------------------

export function buildCardV3({
  name, description, personality, scenario, first_mes, mes_example,
  creator_notes, system_prompt, post_history_instructions,
  alternate_greetings = [], tags = [], vgn = {},
}) {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: str(name) || 'Unnamed Character',
      description: str(description),
      personality: str(personality),
      scenario: str(scenario),
      first_mes: str(first_mes),
      mes_example: str(mes_example),
      creator_notes: str(creator_notes),
      system_prompt: str(system_prompt),
      post_history_instructions: str(post_history_instructions),
      alternate_greetings: Array.isArray(alternate_greetings) ? alternate_greetings.map(str) : [],
      character_book: null,
      tags: Array.isArray(tags) ? tags.map(str) : [],
      creator: 'VGN CHARACTER FORGE',
      character_version: '1.0',
      extensions: {
        vgn: {
          species: str(vgn.species),
          speciesSlug: str(vgn.speciesSlug),
          artStyle: str(vgn.artStyle),
          styleSlug: str(vgn.styleSlug),
          role: str(vgn.role),
          gender: str(vgn.gender),
          contentLevel: ['sfw', 'pg13', 'nsfw'].includes(vgn.contentLevel) ? vgn.contentLevel : undefined,
          network: 'vgn-video-game-network',
        },
      },
    },
  };
}

// Accept a parsed JSON card (V3 or flat V2) and normalize it to V3.
export function normalizeCard(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const d = obj.data && typeof obj.data === 'object' ? obj.data : obj;
  if (!d.name && !d.description) return null;
  const e = (d.extensions && typeof d.extensions === 'object') ? d.extensions : {};
  const vgn = (e.vgn && typeof e.vgn === 'object') ? e.vgn : {};
  return buildCardV3({
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creator_notes: d.creator_notes,
    system_prompt: d.system_prompt,
    post_history_instructions: d.post_history_instructions,
    alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings : [],
    tags: Array.isArray(d.tags) ? d.tags : [],
    vgn: {
      species: vgn.species,
      speciesSlug: vgn.speciesSlug,
      artStyle: vgn.artStyle,
      styleSlug: vgn.styleSlug,
      role: vgn.role,
      gender: vgn.gender,
      contentLevel: vgn.contentLevel,
    },
  });
}

// ---------------------------------------------------------------------------
// PNG tEXt chunk embedding / extraction
// ---------------------------------------------------------------------------

function makeTextChunk(keyword, text) {
  const k = new TextEncoder().encode(keyword);
  const t = new TextEncoder().encode(text);
  const data = new Uint8Array(k.length + 1 + t.length);
  data.set(k, 0);
  data[k.length] = 0;
  data.set(t, k.length + 1);

  const type = new TextEncoder().encode('tEXt');
  const crcIn = new Uint8Array(type.length + data.length);
  crcIn.set(type, 0);
  crcIn.set(data, type.length);

  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(type, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(crcIn));
  return out;
}

// Insert a chunk before the IEND chunk. Returns null if no IEND found.
function insertBeforeIEND(png, chunk) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let iend = -1;
  while (pos + 8 <= png.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    if (type === 'IEND') { iend = pos; break; }
    pos += 12 + len;
  }
  if (iend < 0) return null;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(png.subarray(iend), iend + chunk.length);
  return out;
}

// Extract all text chunks (tEXt / zTXt / iTXt) as [{kw, txt}].
function readTextChunks(png) {
  const out = [];
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const td = new TextDecoder();
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      let z = 0;
      while (z < data.length && data[z] !== 0) z++;
      const kw = td.decode(data.subarray(0, z));
      let txt = null;
      try {
        if (type === 'tEXt') {
          txt = td.decode(data.subarray(z + 1));
        } else if (type === 'zTXt') {
          txt = inflate(data.subarray(z + 2), { to: 'string' });
        } else { // iTXt
          let p = z + 1;
          const compFlag = data[p]; p += 2; // flag + method bytes
          while (p < data.length && data[p] !== 0) p++; p++; // language tag
          while (p < data.length && data[p] !== 0) p++; p++; // translated keyword
          const raw = data.subarray(p);
          txt = compFlag === 1 ? inflate(raw, { to: 'string' }) : td.decode(raw);
        }
      } catch { txt = null; }
      if (txt != null) out.push({ kw, txt });
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return out;
}

// Try to parse a text-chunk value into a card. SillyTavern stores base64 of
// deflated JSON; a couple of other tools store the JSON more directly, so
// try base64-deflate first, then raw deflate, then plain JSON.
function cardFromChunkText(txt) {
  const attempts = [];
  try { attempts.push(base64ToBytes(txt)); } catch { /* no-op */ }
  attempts.push(new TextEncoder().encode(txt));
  for (const bytes of attempts) {
    let json = null;
    try { json = inflate(bytes, { to: 'string' }); } catch { /* no-op */ }
    if (!json) {
      try { json = td_decode(bytes); } catch { /* no-op */ }
    }
    if (!json) continue;
    try {
      const card = normalizeCard(JSON.parse(json));
      if (card) return card;
    } catch { /* try next */ }
  }
  return null;
}

const td_decode = (bytes) => {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
};

// ---------------------------------------------------------------------------
// exports / imports
// ---------------------------------------------------------------------------

export function exportCardJson(card) {
  const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
  download(sanitize(card.data.name) + '.json', blob);
}

export async function exportCardPng(card, avatarUrl) {
  const json = JSON.stringify(card);
  const deflated = deflate(json, { level: 6 });
  const chunk = makeTextChunk('chara', bytesToBase64(deflated));
  const png = avatarUrl ? await dataUrlToBytes(avatarUrl) : await placeholderPngBytes();
  const merged = insertBeforeIEND(png, chunk);
  if (!merged) throw new Error('Could not embed card into PNG.');
  const blob = new Blob([merged], { type: 'image/png' });
  download(sanitize(card.data.name) + '.png', blob);
}

export async function importCardFile(file) {
  let card = null;
  let avatarUrl = null;
  if (/\.json$/i.test(file.name)) {
    const txt = await file.text();
    card = normalizeCard(JSON.parse(txt));
    if (!card) throw new Error('Not a valid character card JSON.');
  } else {
    const buf = new Uint8Array(await file.arrayBuffer());
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
    if (isPng) {
      avatarUrl = 'data:image/png;base64,' + bytesToBase64(buf);
      for (const { kw, txt } of readTextChunks(buf)) {
        if (kw.toLowerCase() !== 'chara') continue;
        const parsed = cardFromChunkText(txt);
        if (parsed) { card = parsed; break; }
      }
      if (!card) throw new Error('No character card found in this PNG.');
    } else {
      const txt = new TextDecoder().decode(buf);
      card = normalizeCard(JSON.parse(txt));
      if (!card) throw new Error('Not a valid character card file.');
    }
  }
  return { card, avatarUrl };
}

// ---------------------------------------------------------------------------
// helpers used by the forge
// ---------------------------------------------------------------------------

async function dataUrlToBytes(url) {
  const res = await fetch(url);
  return new Uint8Array(await res.arrayBuffer());
}

// A minimal 512x512 placeholder "no avatar yet" PNG so card export always works.
export async function placeholderPngBytes() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#120a28');
  grad.addColorStop(1, '#05010f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(255,45,149,0.6)';
  g.lineWidth = 6;
  g.strokeRect(12, 12, 488, 488);
  g.fillStyle = '#2de1ff';
  g.font = 'bold 60px monospace';
  g.textAlign = 'center';
  g.fillText('VGN', 256, 240);
  g.fillStyle = '#9f96c9';
  g.font = '30px monospace';
  g.fillText('CHARACTER FORGE', 256, 300);
  g.fillStyle = '#ffd23e';
  g.font = 'bold 26px monospace';
  g.fillText('NO AVATAR — GENERATE ONE', 256, 360);
  const url = c.toDataURL('image/png');
  return dataUrlToBytes(url);
}

// Re-encode any image data URL as a square 512x512 PNG (so embedded avatars
// are always PNG bytes, regardless of the source format).
export function toSquarePngDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 512;
      const g = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 512, 512);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not read avatar image.'));
    img.src = url;
  });
}
