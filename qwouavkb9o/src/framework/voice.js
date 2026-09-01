// DECtalk voice synthesis for BrowserQuest
// Reuses the DEKTalker from multiplayer-minecraft-with-voice-chat

const DT_WASM_URL = 'https://user.uploads.dev/file/dff30af93ca4f04966dfdea58366e7d4.wasm';
const DT_JS_URL = 'https://user.uploads.dev/file/96108bf67e8cba9eda7e19270b3085f7.js';
const DT_SAMPLE_RATE = 11025;

export const VOICE_LIST = [
  {id:0, name:'Paul', cmd:'[:name paul]'},
  {id:1, name:'Betty', cmd:'[:name betty]'},
  {id:2, name:'Harry', cmd:'[:name harry]'},
  {id:3, name:'Frank', cmd:'[:name frank]'},
  {id:4, name:'Dennis', cmd:'[:name dennis]'},
  {id:5, name:'Kit', cmd:'[:name kit]'},
  {id:6, name:'Ursula', cmd:'[:name ursula]'},
  {id:7, name:'Rita', cmd:'[:name rita]'},
  {id:8, name:'Wendy', cmd:'[:name wendy]'},
  {id:9, name:'Deep Paul', cmd:'[:name paul][:dv ap 80 pr 20]'},
  {id:10, name:'Hyper Betty', cmd:'[:name betty][:rate 300]'},
  {id:11, name:'Whisper Harry', cmd:'[:name harry][:dv br 80 ri 20]'},
  {id:12, name:'Giant Frank', cmd:'[:name frank][:dv hs 20 ap 60]'},
  {id:13, name:'Chipmunk Kit', cmd:'[:name kit][:dv ap 250 pr 150][:rate 250]'},
  {id:14, name:'Robo Dennis', cmd:'[:name dennis][:dv la 100 ri 0 br 0]'},
  {id:15, name:'Elderly Ursula', cmd:'[:name ursula][:rate 120][:dv ap 200 pr 15]'},
  {id:16, name:'Squeaky Rita', cmd:'[:name rita][:dv ap 280 pr 100]'},
  {id:17, name:'Valley Wendy', cmd:'[:name wendy][:rate 220][:dv pr 120]'},
  {id:18, name:'Drawl Paul', cmd:'[:name paul][:rate 100][:dv pr 40]'},
  {id:19, name:'Breathy Betty', cmd:'[:name betty][:dv br 60 ri 80]'},
  {id:20, name:'Gruff Harry', cmd:'[:name harry][:dv ap 90 pr 30 ri 70 la 30]'},
  {id:21, name:'Booming Frank', cmd:'[:name frank][:dv lo 90 gv 95][:rate 160]'},
  {id:22, name:'Nasal Dennis', cmd:'[:name dennis][:dv hr 80 hs 35]'},
  {id:23, name:'Sweet Kit', cmd:'[:name kit][:dv br 30 ri 70 ap 180]'},
  {id:24, name:'Stern Ursula', cmd:'[:name ursula][:dv pr 10 la 40][:rate 150]'},
  {id:25, name:'Bubbly Rita', cmd:'[:name rita][:rate 240][:dv pr 130 ri 80]'},
  {id:26, name:'Echo Wendy', cmd:'[:name wendy][:dv la 60 sm 30]'},
  {id:27, name:'Cowboy Paul', cmd:'[:name paul][:rate 130][:dv pr 50 ap 95]'},
  {id:28, name:'Professor Harry', cmd:'[:name harry][:rate 140][:dv ap 110 pr 35 ri 60]'},
  {id:29, name:'Monster', cmd:'[:name frank][:dv ap 55 pr 10 hs 15 lo 95 gv 90][:rate 100]'},
  {id:30, name:'Demon', cmd:'[:name frank][:dv ap 50 pr 5 hs 10 la 80 ri 90][:rate 90]'},
  {id:31, name:'Ghost', cmd:'[:name wendy][:dv br 100 ri 10 ap 200 pr 5][:rate 80]'},
  {id:32, name:'Alien', cmd:'[:name kit][:dv ap 300 pr 200 hs 80 f5 5500][:rate 200]'},
  {id:33, name:'Robot Mk2', cmd:'[:name dennis][:dv la 100 ri 0 br 0 sm 0 pr 0][:rate 180]'},
  {id:34, name:'Cyborg', cmd:'[:name harry][:dv la 70 ri 20 br 5][:rate 160]'},
  {id:35, name:'AI Assistant', cmd:'[:name paul][:dv ap 100 pr 30 br 10 sm 70][:rate 170]'},
  {id:36, name:'News Anchor', cmd:'[:name betty][:dv pr 20 br 10][:rate 190]'},
  {id:37, name:'Sportscaster', cmd:'[:name paul][:rate 280][:dv pr 80]'},
  {id:38, name:'Radio DJ', cmd:'[:name harry][:rate 220][:dv br 20 ri 80 pr 90]'},
  {id:39, name:'Auctioneer', cmd:'[:name paul][:rate 400][:dv pr 60]'},
  {id:40, name:'Whisper', cmd:'[:name wendy][:dv br 100 ri 5 ap 150][:rate 100][:volume 50]'},
  {id:41, name:'Mumble', cmd:'[:name frank][:rate 80][:dv pr 10 br 40 la 50]'},
  {id:42, name:'Shouter', cmd:'[:name paul][:dv lo 100 gv 100 ri 90][:rate 200][:volume 100]'},
  {id:43, name:'Singer', cmd:'[:name betty][:dv pr 150 ri 90 br 20][:rate 150]'},
  {id:44, name:'Opera', cmd:'[:name ursula][:dv ap 220 pr 200 ri 95 br 5][:rate 120]'},
  {id:45, name:'Rapper', cmd:'[:name dennis][:rate 350][:dv pr 40 ri 60]'},
  {id:46, name:'Jazz Cat', cmd:'[:name kit][:rate 160][:dv br 40 ri 80 pr 100]'},
  {id:47, name:'Rock Star', cmd:'[:name harry][:rate 200][:dv la 40 ri 80 br 30]'},
  {id:48, name:'Club Kid', cmd:'[:name rita][:rate 300][:dv pr 150 ap 250]'},
  {id:49, name:'Disco Diva', cmd:'[:name wendy][:rate 260][:dv pr 140 ri 90 br 20]'},
  {id:50, name:'Punk', cmd:'[:name frank][:rate 280][:dv la 80 ri 30 pr 20]'},
  {id:51, name:'Metal', cmd:'[:name frank][:dv ap 60 pr 10 la 90 ri 80 gv 95][:rate 200]'},
  {id:52, name:'Lo-Fi', cmd:'[:name dennis][:rate 120][:dv br 50 ri 30 sm 80]'},
  {id:53, name:'Vaporwave', cmd:'[:name ursula][:rate 90][:dv pr 80 br 40 sm 90 ap 160]'},
  {id:54, name:'Synthwave', cmd:'[:name kit][:rate 140][:dv la 50 ri 60 f5 5000]'},
  {id:55, name:'Chiptune', cmd:'[:name kit][:dv ap 300 pr 200 ri 0 br 0][:rate 250]'},
  {id:56, name:'Glitch', cmd:'[:name dennis][:dv la 100 ri 0 sm 0][:rate 300]'},
  {id:57, name:'Static', cmd:'[:name harry][:dv br 80 ri 10 la 60][:rate 200]'},
  {id:58, name:'Drone', cmd:'[:name frank][:dv ap 55 pr 0 ri 0 br 0][:rate 75]'},
  {id:59, name:'Cathedral', cmd:'[:name ursula][:dv ap 180 pr 150 br 10 sm 90 hs 40][:rate 90]'},
  {id:60, name:'Cave Echo', cmd:'[:name paul][:dv la 80 sm 50 br 20][:rate 110]'},
  {id:61, name:'Stadium', cmd:'[:name harry][:dv lo 95 gv 90 la 50][:rate 180]'},
  {id:62, name:'Telephone', cmd:'[:name betty][:dv f4 3500 f5 4000 br 0][:rate 200]'},
  {id:63, name:'Megaphone', cmd:'[:name paul][:dv lo 95 gv 95 br 5][:rate 220]'},
  {id:64, name:'Walkie Talkie', cmd:'[:name frank][:dv f4 3000 br 10 ri 40][:rate 170]'},
  {id:65, name:'Old Radio', cmd:'[:name dennis][:dv br 30 ri 50 f4 2800][:rate 150]'},
  {id:66, name:'Vinyl', cmd:'[:name rita][:dv br 40 ri 60 sm 40][:rate 140]'},
  {id:67, name:'Gramophone', cmd:'[:name wendy][:dv br 50 ri 40 f4 2500][:rate 130]'},
  {id:68, name:'Mega Slow', cmd:'[:name paul][:rate 75][:dv pr 20 ap 90]'},
  {id:69, name:'Super Fast', cmd:'[:name betty][:rate 500][:dv pr 80]'},
  {id:70, name:'Turbo', cmd:'[:name kit][:rate 600][:dv pr 100 ap 250]'},
  {id:71, name:'Sloth', cmd:'[:name frank][:rate 60][:dv pr 5 ap 70]'},
  {id:72, name:'Speed Demon', cmd:'[:name rita][:rate 550][:dv pr 120]'},
  {id:73, name:'Hyperactive', cmd:'[:name wendy][:rate 450][:dv pr 140 ri 80]'},
  {id:74, name:'Zen Master', cmd:'[:name ursula][:rate 90][:dv pr 10 br 20 sm 80 ap 160]'},
  {id:75, name:'Meditation', cmd:'[:name kit][:rate 85][:dv pr 5 br 30 ri 50 ap 170]'},
  {id:76, name:'Hypnotist', cmd:'[:name dennis][:rate 95][:dv pr 8 la 40 sm 70]'},
  {id:77, name:'Sleepy', cmd:'[:name harry][:rate 85][:dv br 40 la 30 pr 15]'},
  {id:78, name:'Dreamy', cmd:'[:name wendy][:rate 100][:dv br 50 ri 40 sm 80]'},
  {id:79, name:'Drowsy', cmd:'[:name betty][:rate 80][:dv br 60 pr 10 la 20]'},
  {id:80, name:'Hyper Kid', cmd:'[:name kit][:rate 400][:dv pr 180 ap 280]'},
  {id:81, name:'Energizer', cmd:'[:name paul][:rate 350][:dv pr 100 ri 80]'},
  {id:82, name:'Manic', cmd:'[:name rita][:rate 480][:dv pr 160 ri 90]'},
  {id:83, name:'Frenzy', cmd:'[:name dennis][:rate 520][:dv pr 80 la 50]'},
  {id:84, name:'Cartoon', cmd:'[:name kit][:dv ap 320 pr 250 ri 90][:rate 300]'},
  {id:85, name:'Anime Girl', cmd:'[:name betty][:dv ap 260 pr 180 ri 90 br 10][:rate 260]'},
  {id:86, name:'Villain', cmd:'[:name frank][:dv ap 70 pr 15 la 70 ri 80 hs 25][:rate 120]'},
  {id:87, name:'Hero', cmd:'[:name paul][:dv ap 105 pr 60 ri 80 lo 85 gv 85][:rate 170]'},
  {id:88, name:'Sidekick', cmd:'[:name dennis][:dv pr 80 ri 70][:rate 200]'},
  {id:89, name:'Narrator', cmd:'[:name harry][:dv ap 100 pr 25 br 10 sm 60][:rate 160]'},
  {id:90, name:'Fairytale', cmd:'[:name ursula][:dv pr 90 ri 60 br 20 sm 70][:rate 140]'},
  {id:91, name:'Noir', cmd:'[:name frank][:rate 110][:dv br 20 la 40 pr 15]'},
  {id:92, name:'Commercial', cmd:'[:name betty][:rate 210][:dv pr 100 ri 80]'},
  {id:93, name:'Infomercial', cmd:'[:name paul][:rate 240][:dv pr 120 ri 60]'},
  {id:94, name:'Game Show', cmd:'[:name rita][:rate 260][:dv pr 130 ri 90]'},
  {id:95, name:'Sports', cmd:'[:name harry][:rate 290][:dv pr 90 ri 80 lo 80]'},
  {id:96, name:'Debate', cmd:'[:name dennis][:rate 180][:dv pr 30 la 20]'},
  {id:97, name:'Lecture', cmd:'[:name ursula][:rate 150][:dv pr 20 br 5 sm 50]'},
  {id:98, name:'Bedtime Story', cmd:'[:name wendy][:rate 100][:dv pr 30 br 40 ri 50 sm 60]'},
  {id:99, name:'ASMR', cmd:'[:name kit][:rate 90][:dv br 70 ri 30 pr 20][:volume 60]'},
  {id:100, name:'Podcast', cmd:'[:name paul][:rate 165][:dv pr 40 br 10 sm 50]'},
  {id:101, name:'Audiobook', cmd:'[:name betty][:rate 155][:dv pr 35 br 5 sm 55]'},
  {id:102, name:'Documentary', cmd:'[:name harry][:rate 145][:dv pr 25 br 5 sm 60]'},
  {id:103, name:'Weather', cmd:'[:name ursula][:rate 175][:dv pr 30 br 5]'},
  {id:104, name:'Traffic', cmd:'[:name dennis][:rate 200][:dv pr 50]'},
  {id:105, name:'Excited', cmd:'[:name rita][:rate 250][:dv pr 140 ri 90 ap 200]'},
  {id:106, name:'Bored', cmd:'[:name frank][:rate 120][:dv pr 5 la 20 br 30]'},
  {id:107, name:'Sad', cmd:'[:name wendy][:rate 100][:dv pr 10 br 40 la 30 ap 130]'},
  {id:108, name:'Happy', cmd:'[:name betty][:rate 220][:dv pr 120 ri 80 ap 190]'},
  {id:109, name:'Angry', cmd:'[:name paul][:rate 240][:dv pr 20 la 80 ri 90 lo 90]'},
  {id:110, name:'Scared', cmd:'[:name kit][:rate 300][:dv pr 150 br 60 ap 280]'},
  {id:111, name:'Mysterious', cmd:'[:name harry][:rate 110][:dv pr 15 la 50 br 20 hs 35]'},
  {id:112, name:'Seductive', cmd:'[:name ursula][:rate 130][:dv br 50 ri 60 pr 80 ap 170]'},
  {id:113, name:'Flirty', cmd:'[:name rita][:rate 180][:dv br 40 ri 70 pr 100 ap 200]'},
  {id:114, name:'Sarcastic', cmd:'[:name dennis][:rate 160][:dv pr 60 la 40 ri 50]'},
  {id:115, name:'Dramatic', cmd:'[:name frank][:rate 130][:dv pr 100 ri 80 la 60]'},
  {id:116, name:'Theatrical', cmd:'[:name wendy][:rate 140][:dv pr 130 ri 90 br 10]'},
  {id:117, name:'Shakespearean', cmd:'[:name ursula][:rate 120][:dv pr 120 ri 85 br 5 sm 40]'},
  {id:118, name:'Pirate', cmd:'[:name harry][:rate 130][:dv ap 85 pr 40 ri 70 la 50 hs 30]'},
  {id:119, name:'Knight', cmd:'[:name paul][:rate 140][:dv ap 90 pr 30 ri 60 lo 80 gv 80]'},
  {id:120, name:'Wizard', cmd:'[:name frank][:rate 110][:dv ap 80 pr 20 la 60 br 20 hs 25]'},
  {id:121, name:'Dragon', cmd:'[:name frank][:dv ap 45 pr 5 hs 10 la 90 ri 95 gv 100][:rate 85]'},
  {id:122, name:'Elf', cmd:'[:name kit][:rate 200][:dv ap 240 pr 160 ri 80 br 10]'},
  {id:123, name:'Dwarf', cmd:'[:name frank][:rate 120][:dv ap 75 pr 25 ri 60 hs 30]'},
  {id:124, name:'Orc', cmd:'[:name harry][:dv ap 60 pr 10 hs 15 la 80 ri 85][:rate 100]'},
  {id:125, name:'Fairy', cmd:'[:name betty][:dv ap 280 pr 180 ri 90 br 20][:rate 280]'},
  {id:126, name:'King', cmd:'[:name paul][:dv ap 95 pr 40 ri 70 lo 90 gv 85][:rate 130]'},
  {id:127, name:'Queen', cmd:'[:name ursula][:dv ap 175 pr 100 ri 75 br 10][:rate 140]'},
  {id:128, name:'Jester', cmd:'[:name kit][:rate 300][:dv pr 180 ri 90 ap 260]'},
];

let dtModule = null;
let dtReady = false;
let wtAudioCtx = null;

export let voiceEnabled = true;
export let voiceVolume = 0.5;

try {
  const v = parseInt(localStorage.getItem('bq_voice_enabled'));
  if (!isNaN(v)) voiceEnabled = v !== 0;
} catch (e) {}
try {
  const vol = parseFloat(localStorage.getItem('bq_voice_volume'));
  if (!isNaN(vol)) voiceVolume = Math.max(0, Math.min(1, vol));
} catch (e) {}

export function setVoiceEnabled(v) { voiceEnabled = v; try { localStorage.setItem('bq_voice_enabled', v ? '1' : '0'); } catch(e){} }
export function setVoiceVolume(v) { voiceVolume = Math.max(0, Math.min(1, v)); try { localStorage.setItem('bq_voice_volume', String(voiceVolume)); } catch(e){} }

function voicePrefixFor(voiceId) {
  if (voiceId === 255) return '';
  const v = VOICE_LIST.find(v => v.id === voiceId);
  return v ? v.cmd + ' ' : '';
}

async function initDECtalk() {
  try {
    const mod = await import(DT_JS_URL);
    const DECtalkMini = mod.default;
    const m = await DECtalkMini({ locateFile: () => DT_WASM_URL });
    m._tts_init();
    m._dt_speak = m.cwrap('tts_speak', 'number', ['string', 'number']);
    m._dt_get_buffer = m.cwrap('tts_get_buffer', 'number', []);
    m._dt_get_buffer_length = m.cwrap('tts_get_buffer_length', 'number', []);
    m._dt_reset = m.cwrap('tts_reset', 'number', []);
    dtModule = m;
    dtReady = true;
  } catch (e) { console.warn('DECtalk load failed', e); }
}

let initPromise = null;
export function ensureVoiceReady() {
  if (!initPromise) initPromise = initDECtalk();
  return initPromise;
}

function ensureWtAudio() {
  if (!wtAudioCtx) {
    try { wtAudioCtx = new AudioContext({ sampleRate: DT_SAMPLE_RATE }); }
    catch (e) { wtAudioCtx = new AudioContext(); }
  }
  if (wtAudioCtx.state === 'suspended') wtAudioCtx.resume();
}

function prepareDectalkText(text) {
  const hasPhonemes = /\[[:a-zA-Z_]*<\d+,\s*\d+>/.test(text);
  let processed = text;
  if (hasPhonemes) {
    processed = processed.replace(/\[_<\d+,\s*\d+>\]/g, ' ');
    if (!/\[:phoneme/.test(processed)) {
      processed = '[:phoneme arpabet speak on]' + processed;
    }
  }
  return processed;
}

export function speakText(text, voiceId, volume, pan) {
  if (!voiceEnabled || !dtReady || !dtModule) return;
  ensureWtAudio();
  const actx = wtAudioCtx;
  dtModule._dt_reset();
  const prefix = voiceId === 255 ? '' : voicePrefixFor(voiceId);
  const prepared = prepareDectalkText(prefix + text);
  let err;
  try { err = dtModule._dt_speak(prepared, 1); }
  catch (e) { return; }
  if (err !== 0) return;
  const len = dtModule._dt_get_buffer_length();
  const bufPtr = dtModule._dt_get_buffer();
  if (len <= 0 || bufPtr === 0) return;
  const int16 = new Int16Array(dtModule.HEAP16.buffer, bufPtr, len);
  const audioBuffer = actx.createBuffer(1, len, DT_SAMPLE_RATE);
  const f32 = audioBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) f32[i] = int16[i] / 32768.0;
  const src = actx.createBufferSource();
  src.buffer = audioBuffer;
  const gain = actx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, (volume ?? 1) * voiceVolume));
  src.connect(gain);
  if (pan !== undefined && actx.createStereoPanner) {
    const panner = actx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    panner.connect(actx.destination);
  } else {
    gain.connect(actx.destination);
  }
  src.start();
}
