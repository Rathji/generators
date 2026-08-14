// ============================================================================
//  src/forge.js — the character creator UI + logic
//  ----------------------------------------------------------------------------
//  Builds the pickers (species / style / gender / role) and the card-field
//  rows, wires every ⚡ ROLL and ✦ AI button, the avatar generator, the
//  SillyTavern export/import, the TEST DRIVE live chat, and localStorage
//  autosave of the draft. Uses root.generateText / root.generateImage.
//  ============================================================================

import {
  buildCardV3, normalizeCard, exportCardJson, exportCardPng,
  importCardFile, toSquarePngDataUrl,
} from './card.js';

const root = window.root;

// Perchance nodes expose `.evaluateItem` as an auto-evaluating getter (it
// returns the evaluated string, not a function), and plain strings/objects
// have no such property — so probe with `in`, not `typeof`.
const ev = (n) => {
  if (n == null) return n;
  if (typeof n === 'object' && 'evaluateItem' in n) return n.evaluateItem;
  return n;
};

const $ = (id) => document.getElementById(id);

const GENDERS = ['Any', 'Female', 'Male', 'Non-Binary'];

// Flat list used for stats / draft-sanitize / lookups.
const FIELDS = [
  { key: 'name', label: 'NAME', kind: 'input', rnd: true, ph: 'e.g. Nova-7' },
  { key: 'description', label: 'DESCRIPTION', kind: 'textarea', rows: 4, rnd: true, ph: 'Appearance, then backstory…' },
  { key: 'personality', label: 'PERSONALITY', kind: 'textarea', rows: 2, rnd: true },
  { key: 'scenario', label: 'SCENARIO', kind: 'textarea', rows: 2, rnd: true },
  { key: 'first_mes', label: 'FIRST MESSAGE', kind: 'textarea', rows: 3, rnd: true },
  { key: 'mes_example', label: 'EXAMPLE DIALOGUE', kind: 'textarea', rows: 4 },
  { key: 'system_prompt', label: 'SYSTEM PROMPT', kind: 'textarea', rows: 2, rnd: true, adv: true },
  { key: 'post_history_instructions', label: 'POST-HISTORY', kind: 'textarea', rows: 2, adv: true },
  { key: 'creator_notes', label: 'CREATOR NOTES', kind: 'textarea', rows: 2, rnd: true, adv: true },
  { key: 'alternate_greetings', label: 'ALT GREETINGS (one per line)', kind: 'textarea', rows: 3, adv: true },
  { key: 'tags', label: 'TAGS (comma separated)', kind: 'input', rnd: true, adv: true },
];

// Layout: groups render as 1- or 2-column grids so the forge fits on screen.
const FIELD_GROUPS = [
  [{ key: 'name', label: 'NAME', kind: 'input', rnd: true, ph: 'e.g. Nova-7' }],
  [{ key: 'description', label: 'DESCRIPTION', kind: 'textarea', rows: 3, rnd: true, ph: 'Appearance, then backstory…' }],
  [
    { key: 'personality', label: 'PERSONALITY', kind: 'textarea', rows: 2, rnd: true },
    { key: 'scenario', label: 'SCENARIO', kind: 'textarea', rows: 2, rnd: true },
  ],
  [
    { key: 'first_mes', label: 'FIRST MESSAGE', kind: 'textarea', rows: 2, rnd: true },
    { key: 'mes_example', label: 'EXAMPLE DIALOGUE', kind: 'textarea', rows: 2 },
  ],
];

const ADV_GROUPS = [
  [
    { key: 'system_prompt', label: 'SYSTEM PROMPT', kind: 'textarea', rows: 2, rnd: true },
    { key: 'post_history_instructions', label: 'POST-HISTORY', kind: 'textarea', rows: 2 },
  ],
  [
    { key: 'creator_notes', label: 'CREATOR NOTES', kind: 'textarea', rows: 2, rnd: true },
    { key: 'alternate_greetings', label: 'ALT GREETINGS (one per line)', kind: 'textarea', rows: 2 },
  ],
  [{ key: 'tags', label: 'TAGS (comma separated)', kind: 'input', rnd: true }],
];

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const state = {
  vibe: '',
  content: 'sfw',
  name: '', species: '', style: '', gender: '', role: '',
  description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
  system_prompt: '', post_history_instructions: '', creator_notes: '',
  alternate_greetings: '', tags: '',
  avatar: null,
};

const controls = {};          // field key -> input/textarea element
const pickers = {
  species: { el: $('speciesGrid'), map: {}, items: null },
  style:   { el: $('styleGrid'),   map: {}, items: null },
  gender:  { el: $('genderGrid'),  map: {}, items: GENDERS.map(g => ({ slug: g, label: g })) },
  role:    { el: $('roleGrid'),    map: {}, items: null },
};

let audio = null;
let draftKey = 'vgn-character-forge-draft';
let busyCount = 0;
let statusTimer = null;
let saveTimer = null;

// ---------------------------------------------------------------------------
// AI prompt scaffolding
// ---------------------------------------------------------------------------

const CORE = `You are FORGE-CORE, the character-design AI inside VGN CHARACTER FORGE, a retro arcade video-game network. You design game characters for VGN games, network avatars, and chat. You write like a top game character designer — vivid, concrete, in-universe. Always respond in plain text, no markdown.`;

function getSpecies() {
  const it = pickers.species.items.find(i => i.slug === state.species) || pickers.species.items[0];
  return it || { slug: 'human', label: 'Human', img: '', flavor: '' };
}
function getStyle() {
  const it = pickers.style.items.find(i => i.slug === state.style) || pickers.style.items[0];
  return it || { slug: 'pixel', label: 'Pixel Art', img: '' };
}

function briefText() {
  const s = getSpecies();
  const st = getStyle();
  const lines = [];
  if (state.vibe.trim()) lines.push(`Vibe / concept: ${state.vibe.trim()}`);
  lines.push(`Species: ${s.label} — ${s.flavor}`);
  lines.push(`Art style: ${st.label} (${st.img})`);
  if (state.gender) lines.push(`Gender: ${state.gender}`);
  if (state.role) lines.push(`Role / class: ${state.role}`);
  if (state.name.trim()) lines.push(`Name: ${state.name.trim()}`);
  if (state.personality.trim()) lines.push(`Personality notes: ${state.personality.trim()}`);
  if (state.description.trim()) lines.push(`Current description: ${state.description.trim().slice(0, 220)}`);
  return lines.join('\n');
}

function buildInstruction(task) {
  const rule = CONTENT[state.content].txt;
  return `${CORE}\n\nCHARACTER BRIEF:\n${briefText()}\n\nContent rule: ${rule}\n\nTASK: ${task}`;
}

// Content filter: gating text, images and chat, and the rating stamped on
// the exported card.
const CONTENT = {
  sfw: {
    label: 'SFW',
    txt: 'SFW — strictly family-friendly. No sexual content, no suggestive language, no graphic violence or gore.',
    img: 'fully clothed, tasteful, family-friendly, wholesome',
    neg: 'NSFW, nudity, suggestive, sexual, gore, blood, graphic violence',
    hint: 'FAMILY-FRIENDLY — no sexual or graphic content.',
    tag: 'sfw',
  },
  pg13: {
    label: 'PG13',
    txt: 'PG13 — light flirtation, innuendo and mild peril allowed, but keep it tasteful and non-explicit. No explicit sexual content, no graphic gore.',
    img: 'tasteful, suggestive but non-explicit, fully clothed',
    neg: 'explicit nudity, pornographic, gore, extreme violence',
    hint: 'LIGHT MATURE — suggestive, never explicit.',
    tag: 'pg13',
  },
  nsfw: {
    label: 'NSFW',
    txt: 'NSFW — adult content allowed. Keep it well-written and consensual; no minors, no non-consent, no gratuitous gore.',
    img: 'mature, sensual, adult',
    neg: 'minors, non-consensual, gore, extreme violence',
    hint: 'ADULT — mature content allowed.',
    tag: 'nsfw',
  },
};

const ALL_TASK = `Create this character completely. Respond with ONLY a raw JSON object — no markdown, no commentary — with exactly these keys: name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings, tags.
Rules:
- description: 2 short paragraphs — appearance matching the art style and species first, then a backstory hook.
- personality: 2-3 sentences.
- scenario: 1-2 sentences about where and how the player meets them.
- first_mes: 1-3 sentences spoken in-character to the player.
- mes_example: one <START> block with two {{char}}/{{user}} exchanges.
- creator_notes: 2-3 practical sentences for whoever runs the card.
- system_prompt: a system-level roleplay prompt for this card.
- post_history_instructions: one line of ongoing guidance.
- alternate_greetings: an array of 2 alternative first messages.
- tags: an array of 5-8 lowercase keywords.
- Escape all quotes properly for JSON. Obey the Content rule above.`;

const FIELD_TASKS = {
  name: `Suggest a memorable video-game character name that fits the brief. Respond with ONLY the name — no quotes, no explanation.`,
  description: `Write the DESCRIPTION field for this character card: two short paragraphs — first their appearance (matching the art style and species), then a backstory hook. Respond with ONLY the description text.`,
  personality: `Write the PERSONALITY field: 2-3 sentences capturing how this character thinks, talks and reacts. Respond with ONLY that.`,
  scenario: `Write the SCENARIO field: 1-2 sentences setting where and how the player first meets this character. Respond with ONLY that.`,
  first_mes: `Write the character's FIRST MESSAGE: 1-3 sentences spoken directly in-character to the player as their opening line. Respond with ONLY the message.`,
  mes_example: `Write EXAMPLE DIALOGUE for this card using {{char}} for the character and {{user}} for the player. Format it as one <START> block followed by two exchanges:
<START>
{{user}}: ...
{{char}}: ...
Respond with ONLY the formatted block.`,
  system_prompt: `Write the SYSTEM PROMPT for a roleplay chat with this character: 2-3 sentences of system-level instruction that keeps the chat in character and on-theme. Respond with ONLY the prompt.`,
  post_history_instructions: `Write ONE line of POST-HISTORY INSTRUCTIONS for this character card: a small ongoing guidance note for the chat model. Respond with ONLY that line.`,
  creator_notes: `Write the CREATOR NOTES for this card: 2-3 practical sentences for whoever runs it (how to play this character, quirks to keep). Respond with ONLY the notes.`,
  alternate_greetings: `Write 3 alternative opening lines this character might say to the player, one per line, each in-character and distinct from the first message. Respond with ONLY the 3 lines.`,
  tags: `List 6-9 lowercase keyword tags for this character. Respond with ONLY a comma-separated list, no explanation.`,
};

// ---------------------------------------------------------------------------
// busy / status
// ---------------------------------------------------------------------------

function busy(on, title, sub) {
  const overlay = $('busyOverlay');
  if (on) {
    busyCount++;
    $('busyTitle').textContent = title || 'FORGE-CORE BUSY';
    $('busySub').textContent = sub || 'GENERATING…';
    overlay.classList.add('show');
  } else {
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) overlay.classList.remove('show');
  }
}

function setStatus(msg, isError) {
  const el = $('statusEl');
  el.textContent = msg;
  el.style.color = isError ? 'var(--clr-red)' : 'var(--clr-gold)';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, isError ? 7000 : 5000);
}

// ---------------------------------------------------------------------------
// DOM building
// ---------------------------------------------------------------------------

function buildChips(ctn, items, map, onPick, toggle) {
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = it.label;
    b.addEventListener('click', () => onPick(it.slug, toggle));
    map[it.slug] = b;
    ctn.appendChild(b);
  }
}

function buildFieldRow(f) {
  const row = document.createElement('div');
  row.className = 'field-row';

  const head = document.createElement('div');
  head.className = 'field-head';
  const label = document.createElement('label');
  label.textContent = f.label;
  head.appendChild(label);

  const btns = document.createElement('div');
  btns.className = 'field-btns';
  const ai = document.createElement('button');
  ai.type = 'button';
  ai.className = 'mini ai';
  ai.title = 'AI-generate this field';
  ai.textContent = '✦ AI';
  ai.addEventListener('click', () => { if (audio) audio.sfx('select'); generateField(f.key); });
  btns.appendChild(ai);
  if (f.rnd) {
    const rnd = document.createElement('button');
    rnd.type = 'button';
    rnd.className = 'mini rnd';
    rnd.title = 'Random roll';
    rnd.textContent = '⚡ ROLL';
    rnd.addEventListener('click', () => { if (audio) audio.sfx('move'); rollField(f.key); });
    btns.appendChild(rnd);
  }
  head.appendChild(btns);
  row.appendChild(head);

  const ctl = document.createElement(f.kind);
  ctl.className = 'field';
  if (f.kind === 'textarea') { ctl.rows = f.rows; ctl.wrap = 'soft'; }
  if (f.ph) ctl.placeholder = f.ph;
  ctl.addEventListener('input', () => {
    state[f.key] = ctl.value;
    if (f.key === 'name') refreshAvatarName();
    refreshStats();
    autosave();
  });
  row.appendChild(ctl);
  controls[f.key] = ctl;
  return row;
}

// ---------------------------------------------------------------------------
// picker / field setters
// ---------------------------------------------------------------------------

function pick(name, slug, toggle) {
  const p = pickers[name];
  if (toggle && state[name] === slug) slug = '';
  state[name] = slug;
  for (const k in p.map) p.map[k].classList.toggle('sel', k === slug);
  refreshAvatarName();
  autosave();
}

// Content filter: SFW / PG13 / NSFW. One setter drives the chip highlight,
// the hint line, and (via the CONTENT rules) every AI prompt downstream.
//
// NSFW is gated behind USER_VALIDATED (default true — open). A future
// validation flow can lock it at runtime by calling setUserValidated(false):
// the NSFW chip is then disabled and any NSFW state downgrades to PG13.
const cfgVal = (name, fallback) => {
  const v = root.config && root.config[name];
  if (v == null) return fallback;
  const s = (typeof v === 'object' && v !== null && 'evaluateItem' in v) ? v.evaluateItem : v;
  return s === '' || s == null ? fallback : s;
};
let USER_VALIDATED = cfgVal('userValidated', true) !== false;

const contentChips = {};
function syncNsfwGate() {
  const chip = contentChips.nsfw;
  if (!chip) return;
  const locked = !USER_VALIDATED;
  chip.disabled = locked;
  chip.classList.toggle('locked', locked);
  chip.title = locked ? 'LOCKED — requires USER_VALIDATED' : 'NSFW — adult content allowed';
  chip.textContent = locked ? 'NSFW 🔒' : 'NSFW';
}

// Runtime hook for a future validation flow (also exposed on window).
function setUserValidated(v) {
  USER_VALIDATED = !!v;
  syncNsfwGate();
  if (state.content === 'nsfw' && !USER_VALIDATED) {
    setContent('pg13');
    setStatus('NSFW LOCKED — content downgraded to PG13.');
  }
}

function setContent(lvl, silent) {
  if (!CONTENT[lvl]) lvl = 'sfw';
  if (lvl === 'nsfw' && !USER_VALIDATED) lvl = 'pg13';
  state.content = lvl;
  for (const k in contentChips) contentChips[k].classList.toggle('sel', k === lvl);
  const hint = $('contentHintEl');
  hint.textContent = CONTENT[lvl].hint;
  hint.style.color = lvl === 'sfw' ? 'var(--clr-green)'
    : lvl === 'pg13' ? 'var(--clr-gold)'
    : 'var(--clr-magenta)';
  if (!silent) {
    if (audio) audio.sfx('select');
    setStatus('CONTENT FILTER: ' + CONTENT[lvl].label + ' — ' + CONTENT[lvl].hint);
    autosave();
  }
}

function setField(key, value) {
  state[key] = value;
  if (controls[key]) controls[key].value = value;
  if (key === 'name') refreshAvatarName();
  refreshStats();
}

function refreshAvatarName() {
  const s = getSpecies();
  const st = getStyle();
  $('avatarNameEl').textContent = state.name.trim() || '—';
  $('avatarSubEl').textContent = `${s.label} · ${st.label}`;
}

function refreshStats() {
  const filled = FIELDS.filter(f => (state[f.key] || '').trim()).length;
  $('forgeStatsEl').textContent = `CARD ${Math.round((filled / FIELDS.length) * 100)}% COMPLETE`;
}

// ---------------------------------------------------------------------------
// rolls (⚡) — instant perchance-powered ideas
// ---------------------------------------------------------------------------

function rollField(key) {
  switch (key) {
    case 'name': setField('name', ev(root.randomName)); break;
    case 'personality':
      setField('personality', root.trait.selectMany(3).map(t => ev(t)).join(', '));
      break;
    case 'scenario': setField('scenario', ev(root.randomScenario)); break;
    case 'first_mes': {
      const name = state.name.trim() || ev(root.randomName);
      if (!state.name.trim()) setField('name', name);
      setField('first_mes', ev(root.firstMesTpl).replace(/\{name\}/g, name));
      break;
    }
    case 'description': setField('description', buildRandomDescription()); break;
    case 'tags': {
      const s = getSpecies();
      const st = getStyle();
      const parts = ['vgn', s.label.toLowerCase(), st.label.toLowerCase(), CONTENT[state.content].tag];
      if (state.role) parts.push(state.role.toLowerCase());
      setField('tags', parts.join(', '));
      break;
    }
    case 'system_prompt': {
      const s = getSpecies();
      const name = state.name.trim() || 'the character';
      setField('system_prompt',
        `You are ${name}, a ${s.label} ${state.role || 'character'} on the VGN video-game network. Stay in character at all times: be vivid, concise and true to the card below.`);
      break;
    }
    case 'creator_notes':
      setField('creator_notes',
        'Forged in VGN CHARACTER FORGE. This card works as a game NPC, a network avatar, or a chat companion. Adjust tone freely.');
      break;
    default: break;
  }
  if (audio) audio.sfx('select');
  autosave();
}

function buildRandomDescription() {
  const s = getSpecies();
  const st = getStyle();
  const name = state.name.trim() || 'This character';
  const gender = state.gender && state.gender !== 'Any' ? state.gender.toLowerCase() + ' ' : '';
  const traits = state.personality.trim() || 'no-nonsense';
  const roleWord = state.role ? ` ${state.role}` : ' adventurer';
  return `${name} is a ${gender}${s.label.toLowerCase()}${roleWord} rendered in ${st.label}. ${s.flavor} Appearance: ${s.img}, ${st.img}. Personality: ${traits}.`;
}

function randomize() {
  const sp = root.species.selectOne;
  const st = root.artStyle.selectOne;
  pick('species', ev(sp.slug));
  pick('style', ev(st.slug));
  pick('gender', GENDERS[Math.floor(Math.random() * GENDERS.length)]);
  const roleItem = root.role.selectOne;
  pick('role', ev(roleItem));

  const name = ev(root.randomName);
  setField('name', name);
  setField('personality', root.trait.selectMany(3).map(t => ev(t)).join(', '));
  setField('scenario', ev(root.randomScenario));
  setField('first_mes', ev(root.firstMesTpl).replace(/\{name\}/g, name));
  setField('description', buildRandomDescription());
  const s = getSpecies();
  const st2 = getStyle();
  setField('tags', `vgn, ${s.label.toLowerCase()}, ${st2.label.toLowerCase()}, ${CONTENT[state.content].tag}, ${ev(roleItem).toLowerCase()}`);
  setField('creator_notes', 'Forged in VGN CHARACTER FORGE. Works as a game NPC, network avatar, or chat companion.');
  if (audio) audio.sfx('start');
  setStatus('⚡ RANDOM CONCEPT ROLLED — refine with ✦ AI or edit by hand.');
  autosave();
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

function extractJson(text) {
  text = String(text).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

async function generateField(key) {
  const task = FIELD_TASKS[key];
  if (!task) return;
  const f = FIELDS.find(x => x.key === key);
  busy(true, 'FORGE-CORE WRITING…', f.label);
  try {
    const ctl = controls[key];
    let buf = '';
    const res = await root.generateText({
      instruction: buildInstruction(task),
      onChunk: (d) => {
        buf += d.textChunk;
        if (ctl && !d.isFromStartWith) ctl.value = buf;
      },
    });
    let val = buf || (res && res.text) || '';
    if (key === 'name') val = val.replace(/^["'\s]+|["'\s]+$/g, '');
    if (key === 'tags') val = val.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean).join(', ');
    if (key === 'alternate_greetings') {
      val = val.split('\n').map(s => s.trim().replace(/^[-*\d.\s]+/, '')).filter(Boolean).join('\n');
    }
    setField(key, val);
    if (audio) audio.sfx('coin');
    setStatus(`✦ ${f.label} generated.`);
  } catch (e) {
    setStatus('AI ERROR: ' + (e && e.message ? e.message : e), true);
  } finally {
    busy(false);
  }
}

async function generateAll() {
  busy(true, 'FORGE-CORE SYNTHESIZING CHARACTER…', 'this can take up to a minute');
  try {
    const res = await root.generateText({ instruction: buildInstruction(ALL_TASK) });
    const obj = extractJson(res.text || res);
    const set = (k, v) => { if (v != null) setField(k, v); };
    set('name', obj.name);
    set('description', obj.description);
    set('personality', obj.personality);
    set('scenario', obj.scenario);
    set('first_mes', obj.first_mes);
    set('mes_example', obj.mes_example);
    set('creator_notes', obj.creator_notes);
    set('system_prompt', obj.system_prompt);
    set('post_history_instructions', obj.post_history_instructions);
    if (Array.isArray(obj.tags)) set('tags', obj.tags.join(', '));
    if (Array.isArray(obj.alternate_greetings)) {
      set('alternate_greetings', obj.alternate_greetings.join('\n'));
    }
    if (audio) audio.sfx('start');
    setStatus('✦ CHARACTER FORGED — now generate an avatar and export.');
  } catch (e) {
    setStatus('AI ERROR: ' + (e && e.message ? e.message : e), true);
  } finally {
    busy(false);
  }
}

// ---------------------------------------------------------------------------
// avatar
// ---------------------------------------------------------------------------

function avatarPrompt() {
  const s = getSpecies();
  const st = getStyle();
  const parts = [st.img, s.img, CONTENT[state.content].img];
  const who = [];
  if (state.gender && state.gender !== 'Any') who.push(state.gender.toLowerCase());
  who.push(s.label.toLowerCase());
  if (state.role) who.push(state.role.toLowerCase());
  parts.push(who.join(' '));
  const hint = (state.description || state.vibe || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  if (hint) parts.push(hint);
  parts.push('video game character portrait avatar, head and shoulders, centered, square composition, bold colors, dark retro arcade backdrop, high quality, detailed');
  return parts.join(', ');
}

async function generateAvatar() {
  busy(true, 'RENDERING AVATAR…', 'synthesizing the character select portrait');
  try {
    const res = await root.generateImage({
      prompt: avatarPrompt(),
      resolution: '512x512',
      hideGalleryButtons: true,
      negativePrompt: CONTENT[state.content].neg + ', text, watermark, blurry, low quality, extra limbs, deformed hands, cropped face',
    });
    const url = await toSquarePngDataUrl(res.dataUrl);
    state.avatar = url;
    $('avatarImg').src = url;
    $('avatarFrame').classList.remove('empty');
    if (audio) audio.sfx('coin');
    setStatus('✦ AVATAR READY.');
  } catch (e) {
    setStatus('IMAGE ERROR: ' + (e && e.message ? e.message : e), true);
  } finally {
    busy(false);
  }
}

function clearAvatar() {
  state.avatar = null;
  $('avatarImg').src = '';
  $('avatarFrame').classList.add('empty');
  autosave();
}

// ---------------------------------------------------------------------------
// SillyTavern export / import
// ---------------------------------------------------------------------------

function card() {
  const s = getSpecies();
  const st = getStyle();
  // state.content is downgraded by setContent whenever the gate is locked,
  // but guard here too so a stamped card can never say NSFW while locked.
  const lvl = (state.content === 'nsfw' && !USER_VALIDATED) ? 'pg13' : state.content;
  let tags = state.tags.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
  const contentTag = CONTENT[lvl].tag;
  if (!tags.includes(contentTag)) tags = [...tags, contentTag];
  return buildCardV3({
    name: state.name.trim() || 'Unnamed Character',
    description: state.description.trim(),
    personality: state.personality.trim(),
    scenario: state.scenario.trim(),
    first_mes: state.first_mes.trim(),
    mes_example: state.mes_example.trim(),
    creator_notes: state.creator_notes.trim(),
    system_prompt: state.system_prompt.trim(),
    post_history_instructions: state.post_history_instructions.trim(),
    alternate_greetings: state.alternate_greetings.split('\n').map(s => s.trim()).filter(Boolean),
    tags,
    vgn: {
      species: s.label,
      speciesSlug: s.slug,
      artStyle: st.label,
      styleSlug: st.slug,
      role: state.role,
      gender: state.gender,
      contentLevel: lvl,
    },
  });
}

function exportJson() {
  try {
    exportCardJson(card());
    if (audio) audio.sfx('coin');
    setStatus('CARD EXPORTED (.json).');
  } catch (e) { setStatus('EXPORT ERROR: ' + e.message, true); }
}

async function exportPng() {
  busy(true, 'PACKAGING CARD…', 'embedding card data into the avatar PNG');
  try {
    await exportCardPng(card(), state.avatar);
    if (audio) audio.sfx('coin');
    setStatus('CARD EXPORTED (.png — SillyTavern importable).');
  } catch (e) {
    setStatus('EXPORT ERROR: ' + e.message, true);
  } finally {
    busy(false);
  }
}

function fillFromCard(card) {
  const d = card.data;
  setField('name', d.name);
  setField('description', d.description);
  setField('personality', d.personality);
  setField('scenario', d.scenario);
  setField('first_mes', d.first_mes);
  setField('mes_example', d.mes_example);
  setField('system_prompt', d.system_prompt);
  setField('post_history_instructions', d.post_history_instructions);
  setField('creator_notes', d.creator_notes);
  setField('alternate_greetings', (d.alternate_greetings || []).join('\n'));
  setField('tags', (d.tags || []).join(', '));
  const v = d.extensions && d.extensions.vgn;
  if (v) {
    if (v.speciesSlug && pickers.species.map[v.speciesSlug]) pick('species', v.speciesSlug);
    if (v.styleSlug && pickers.style.map[v.styleSlug]) pick('style', v.styleSlug);
    if (v.role && pickers.role.map[v.role]) pick('role', v.role);
    if (v.gender && pickers.gender.map[v.gender]) pick('gender', v.gender);
  }
  // Detect the card's content rating — from the extension, else from tags.
  let lvl = v && CONTENT[v.contentLevel] ? v.contentLevel : null;
  if (!lvl) {
    const t = (d.tags || []).map(x => String(x).toLowerCase());
    lvl = t.includes('nsfw') ? 'nsfw' : t.includes('pg13') ? 'pg13' : 'sfw';
  }
  setContent(lvl, true);
  setStatus('IMPORTED CARD RATED ' + CONTENT[lvl].label.toUpperCase() + ' — filter set.');
}

async function importFile(file) {
  busy(true, 'DECODING CHARACTER CARD…');
  try {
    const { card, avatarUrl } = await importCardFile(file);
    fillFromCard(card);
    if (avatarUrl) {
      state.avatar = avatarUrl;
      $('avatarImg').src = avatarUrl;
      $('avatarFrame').classList.remove('empty');
    } else {
      clearAvatar();
    }
    if (audio) audio.sfx('start');
    setStatus('CARD IMPORTED.');
  } catch (e) {
    setStatus('IMPORT FAILED: ' + (e && e.message ? e.message : e), true);
  } finally {
    busy(false);
  }
}

// ---------------------------------------------------------------------------
// TEST DRIVE — live AI chat with the card
// ---------------------------------------------------------------------------

const driveLog = [];   // { role: 'player'|'char', text, typing }

function drivePrompt() {
  const c = card().data;
  const block = [
    `Name: ${c.name}`,
    `Description: ${c.description}`,
    `Personality: ${c.personality}`,
    `Scenario: ${c.scenario}`,
    `System prompt: ${c.system_prompt}`,
  ].join('\n');
  const convo = driveLog.filter(m => !m.typing)
    .map(m => (m.role === 'player' ? 'Player' : 'Character') + ': ' + m.text).join('\n');
  return `You are ${c.name}, a character on the VGN video-game network. This is a test-drive chat to check whether the card works. Stay fully in character.\n<CARD>\n${block}\n</CARD>\nContent rule: ${CONTENT[state.content].txt}\n<CONVERSATION>\n${convo}\n</CONVERSATION>\nTASK: Reply as ${c.name} with a short, vivid, in-character message (1-3 sentences).`;
}

function renderDrive() {
  const logEl = $('driveLogEl');
  logEl.innerHTML = '';
  for (const m of driveLog) {
    const div = document.createElement('div');
    div.className = 'drive-msg ' + (m.role === 'player' ? 'player' : 'char');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = m.role === 'player' ? 'YOU' : (card().data.name || 'CHAR').toUpperCase();
    div.appendChild(who);
    const txt = document.createElement('span');
    txt.className = 'drive-text';
    txt.textContent = m.typing ? '…' : m.text;
    div.appendChild(txt);
    if (m.typing) div.classList.add('typing');
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function testDriveOpen() {
  const c = card().data;
  driveLog.length = 0;
  driveLog.push({ role: 'char', text: c.first_mes || `Hi! I'm ${c.name}.` });
  renderDrive();
  $('driveOverlay').classList.add('show');
  $('driveInput').focus();
  if (audio) audio.sfx('select');
}

function testDriveClose() {
  $('driveOverlay').classList.remove('show');
}

async function driveSend() {
  const input = $('driveInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  driveLog.push({ role: 'player', text: msg });
  driveLog.push({ role: 'char', text: '', typing: true });
  renderDrive();
  const name = card().data.name;
  const pending = driveLog[driveLog.length - 1];
  try {
    const res = await root.generateText({
      instruction: drivePrompt(),
      startWith: name + ': ',
      stopSequences: ['\nPlayer:'],
      onChunk: (d) => {
        if (pending.typing) {
          pending.typing = false;
        }
        pending.text = (d.fullTextSoFar || '').replace(/^[^:]+:\s*/, '');
        renderDrive();
      },
    });
    pending.typing = false;
    const clean = ((res && res.text) || '').replace(/^[^:]+:\s*/, '').trim();
    pending.text = clean;
    renderDrive();
  } catch (e) {
    pending.typing = false;
    pending.text = '[connection error — try again]';
    renderDrive();
  }
}

// ---------------------------------------------------------------------------
// draft autosave / restore
// ---------------------------------------------------------------------------

function saveDraft() {
  try { localStorage.setItem(draftKey, JSON.stringify({ v: 1, state })); } catch { /* quota */ }
}

function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 400);
}

function loadDraft() {
  let raw = null;
  try { raw = localStorage.getItem(draftKey); } catch { /* no-op */ }
  if (!raw) return;
  let d = null;
  try { d = JSON.parse(raw); } catch { /* no-op */ }
  if (!d || !d.state) return;
  Object.assign(state, d.state);
  for (const f of FIELDS) {
    const v = state[f.key];
    state[f.key] = typeof v === 'string' ? v : '';
  }
  state.vibe = typeof state.vibe === 'string' ? state.vibe : '';
  if (!CONTENT[state.content]) state.content = 'sfw';
  if (typeof state.avatar !== 'string') state.avatar = null;
  $('vibeInput').value = state.vibe || '';
  for (const f of FIELDS) if (controls[f.key]) controls[f.key].value = state[f.key] || '';
  if (state.species && pickers.species.map[state.species]) pick('species', state.species);
  if (state.style && pickers.style.map[state.style]) pick('style', state.style);
  if (state.gender && pickers.gender.map[state.gender]) pick('gender', state.gender);
  if (state.role && pickers.role.map[state.role]) pick('role', state.role);
  if (state.avatar) {
    $('avatarImg').src = state.avatar;
    $('avatarFrame').classList.remove('empty');
  }
  // Restored content must pass the gate; setContent re-syncs the chips too.
  if (state.content === 'nsfw' && !USER_VALIDATED) state.content = 'pg13';
  setContent(state.content, true);
  refreshAvatarName();
  refreshStats();
}

function newCharacter() {
  const keep = state.vibe;
  Object.assign(state, {
    vibe: keep, name: '', species: state.species, style: state.style,
    gender: state.gender, role: state.role,
    description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
    system_prompt: '', post_history_instructions: '', creator_notes: '',
    alternate_greetings: '', tags: '', avatar: null,
  });
  for (const f of FIELDS) if (controls[f.key]) controls[f.key].value = '';
  $('avatarImg').src = '';
  $('avatarFrame').classList.add('empty');
  refreshAvatarName();
  refreshStats();
  saveDraft();
  if (audio) audio.sfx('select');
  setStatus('NEW SLOT READY.');
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export function initForge({ audio: audioRef, draftKey: key }) {
  audio = audioRef || null;
  if (key) draftKey = key;

  // pickers
  pickers.species.items = root.species.selectAll.map(n => ({
    slug: ev(n.slug), label: ev(n.label), img: ev(n.img), flavor: ev(n.flavor),
  }));
  pickers.style.items = root.artStyle.selectAll.map(n => ({
    slug: ev(n.slug), label: ev(n.label), img: ev(n.img),
  }));
  pickers.role.items = root.role.selectAll.map(n => ({ slug: ev(n), label: ev(n) }));

  buildChips(pickers.species.el, pickers.species.items, pickers.species.map,
    (slug) => pick('species', slug));
  buildChips(pickers.style.el, pickers.style.items, pickers.style.map,
    (slug) => pick('style', slug));
  buildChips(pickers.gender.el, pickers.gender.items, pickers.gender.map,
    (slug) => pick('gender', slug, true), true);
  buildChips(pickers.role.el, pickers.role.items, pickers.role.map,
    (slug) => pick('role', slug, true), true);

  // content filter chips (SFW / PG13 / NSFW)
  for (const b of document.querySelectorAll('#contentGrid .chip')) {
    contentChips[b.dataset.level] = b;
    b.addEventListener('click', () => setContent(b.dataset.level));
  }
  syncNsfwGate();

  // defaults
  if (!state.species) state.species = pickers.species.items[0].slug;
  if (!state.style) state.style = pickers.style.items[0].slug;
  if (!state.gender) state.gender = 'Any';
  setContent(state.content, true);

  // fields (built from layout groups so short fields sit side by side)
  const fieldsCtn = $('fieldsCtn');
  for (const group of FIELD_GROUPS) {
    const grid = document.createElement('div');
    grid.className = 'field-grid' + (group.length > 1 ? ' cols2' : '');
    for (const f of group) grid.appendChild(buildFieldRow(f));
    fieldsCtn.appendChild(grid);
  }
  const adv = document.createElement('details');
  adv.className = 'adv';
  const sum = document.createElement('summary');
  sum.textContent = 'ADVANCED CARD FIELDS (optional)';
  adv.appendChild(sum);
  for (const group of ADV_GROUPS) {
    const grid = document.createElement('div');
    grid.className = 'field-grid' + (group.length > 1 ? ' cols2' : '');
    for (const f of group) grid.appendChild(buildFieldRow(f));
    adv.appendChild(grid);
  }
  fieldsCtn.appendChild(adv);

  // vibe input
  $('vibeInput').addEventListener('input', () => { state.vibe = $('vibeInput').value; autosave(); });

  // buttons
  $('forgeAllBtn').addEventListener('click', () => { if (audio) audio.sfx('select'); generateAll(); });
  $('randomizeBtn').addEventListener('click', randomize);
  $('genAvatarBtn').addEventListener('click', () => { if (audio) audio.sfx('select'); generateAvatar(); });
  $('clearAvatarBtn').addEventListener('click', clearAvatar);
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('exportPngBtn').addEventListener('click', exportPng);
  $('newBtn').addEventListener('click', newCharacter);
  $('testDriveBtn').addEventListener('click', testDriveOpen);
  $('driveCloseBtn').addEventListener('click', testDriveClose);
  $('driveSendBtn').addEventListener('click', driveSend);
  $('driveInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') driveSend(); });
  const importInput = $('importInput');
  $('importBtn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const f = importInput.files[0];
    if (f) importFile(f);
    importInput.value = '';
  });

  // restore draft
  loadDraft();
  refreshAvatarName();
  refreshStats();
  setStatus('FORGE READY — pick a species & style, or type a vibe and hit ✦ FORGE ALL.');

  // expose for tests/debug
  window.__forge = {
    state, randomize, generateAll, generateAvatar, card, exportJson, exportPng,
    rollField, generateField, testDriveOpen, setUserValidated,
  };

  // Runtime hook for a future validation flow: window.setUserValidated(false)
  // locks NSFW; window.setUserValidated(true) re-opens it. Also exposes the
  // current value via window.USER_VALIDATED (read-only getter).
  window.setUserValidated = setUserValidated;
  Object.defineProperty(window, 'USER_VALIDATED', { get: () => USER_VALIDATED, configurable: true });

  return { state, card, randomize, generateAll, generateAvatar, exportJson, exportPng, setUserValidated };
}
