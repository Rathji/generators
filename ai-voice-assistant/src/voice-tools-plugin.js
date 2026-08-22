/* ============================================================
   voice-tools-plugin (vendored copy)
   Source: perchance.org/voice-tools-plugin (public generator)
   Vendored here as a plain-JS module because this workspace's
   main.pjs did not contain the plugin. It exposes the exact same
   API surface via window.__voiceToolsPluginApi.
   If the plugin is restored to main.pjs, this file is a no-op
   (makeVoiceTools() returns the already-set window API).
   Rebuild: extract makeVoiceTools() from the upstream generator's
   main.pjs and wrap it in the IIFE below.
   ============================================================ */
(function () {
  function makeVoiceTools() {
  if (window.__voiceToolsPluginApi) return window.__voiceToolsPluginApi;

  const hasSpeech = typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined";

  const settings = {
    rate: 1,
    pitch: 1,
    volume: 1,
    lang: null,
    voiceName: null,
  };

  let voicesCache = [];
  let voicesPromise = null;
  let currentJob = null;
  const queue = [];

  const vToPlain = (v) => ({
    name: v.name,
    lang: v.lang,
    default: !!v.default,
    localService: !!v.localService,
    voiceURI: v.voiceURI,
  });

  const getVoiceList = () => {
    try {
      return (window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : []) || [];
    } catch (e) {
      return [];
    }
  };

  const getNativeVoices = () => {
    if (!hasSpeech) return Promise.resolve([]);
    const direct = getVoiceList();
    if (direct.length) {
      voicesCache = direct;
      return Promise.resolve(direct.map(vToPlain));
    }
    if (!voicesPromise) {
      voicesPromise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          voicesCache = getVoiceList();
          resolve(voicesCache.map(vToPlain));
        }, 4000);
        const onChanged = () => {
          const list = getVoiceList();
          if (list.length) {
            clearTimeout(timer);
            window.speechSynthesis.removeEventListener("voiceschanged", onChanged);
            voicesCache = list;
            resolve(list.map(vToPlain));
          }
        };
        window.speechSynthesis.addEventListener("voiceschanged", onChanged);
      });
    }
    return voicesPromise;
  };
  getNativeVoices();

  // ---- cloud voices: streamed free from Google's translate TTS (no API key) ----
  // Played through <audio> elements, so no CORS is needed. Distinct real
  // English accents. rate & volume work; pitch is ignored (server-side voice).
  const CLOUD_VOICES = [
    { locale: "en-gb", lang: "en-GB", name: "British Lady", accent: "British" },
    { locale: "en-us", lang: "en-US", name: "American Lady", accent: "American" },
    { locale: "en-au", lang: "en-AU", name: "Australian Lady", accent: "Australian" },
    { locale: "en-ie", lang: "en-IE", name: "Irish Lady", accent: "Irish" },
    { locale: "en-in", lang: "en-IN", name: "Indian Lady", accent: "Indian" },
    { locale: "en-za", lang: "en-ZA", name: "South African Lady", accent: "South African" },
    { locale: "en-ca", lang: "en-CA", name: "Canadian Lady", accent: "Canadian" },
    { locale: "en-nz", lang: "en-NZ", name: "New Zealand Lady", accent: "New Zealand" },
  ];

  const cloudVoiceToPlain = (v) => ({
    name: v.name,
    lang: v.lang,
    accent: v.accent,
    locale: v.locale,
    source: "cloud",
  });

  const getCloudVoices = () => CLOUD_VOICES.map(cloudVoiceToPlain);

  const getVoices = () => getNativeVoices().then((list) => list.concat(getCloudVoices()));

  const findVoice = (sel) => {
    if (sel == null) return null;
    const list = getVoiceList();
    const nativeFind = (fn) => (list.length ? (list.find(fn) || null) : null);
    const cloudFind = (fn) => CLOUD_VOICES.find(fn) || null;
    if (typeof sel === "string") {
      const s = sel.toLowerCase();
      const n = nativeFind((v) => v.name.toLowerCase() === s) ||
        nativeFind((v) => v.name.toLowerCase().includes(s)) ||
        nativeFind((v) => (v.voiceURI || "").toLowerCase() === s) ||
        nativeFind((v) => (v.lang || "").toLowerCase() === s) ||
        nativeFind((v) => (v.lang || "").toLowerCase().startsWith(s));
      if (n) return { source: "native", plain: vToPlain(n), nativeVoice: n };
      const c = cloudFind((v) => v.name.toLowerCase() === s || v.accent.toLowerCase() === s || v.locale.toLowerCase() === s || v.lang.toLowerCase() === s);
      if (c) return { source: "cloud", plain: cloudVoiceToPlain(c) };
      return null;
    }
    if (typeof sel === "number") {
      const n = list[sel];
      if (n) return { source: "native", plain: vToPlain(n), nativeVoice: n };
      const c = CLOUD_VOICES[sel - list.length];
      if (c) return { source: "cloud", plain: cloudVoiceToPlain(c) };
      return null;
    }
    if (sel && typeof sel === "object") {
      if (sel.source === "cloud" || sel.locale) {
        const c = cloudFind((v) => (sel.name && v.name === sel.name) || (sel.locale && v.locale === sel.locale) || (sel.lang && v.lang === sel.lang));
        if (c) return { source: "cloud", plain: cloudVoiceToPlain(c) };
      }
      if (sel.name) {
        const s = String(sel.name).toLowerCase();
        const n = nativeFind((v) => v.name.toLowerCase() === s);
        if (n) return { source: "native", plain: vToPlain(n), nativeVoice: n };
        const c = cloudFind((v) => v.name.toLowerCase() === s);
        if (c) return { source: "cloud", plain: cloudVoiceToPlain(c) };
      }
      if (sel.lang) {
        const l = String(sel.lang).toLowerCase();
        const n = nativeFind((v) => (v.lang || "").toLowerCase().startsWith(l));
        if (n) return { source: "native", plain: vToPlain(n), nativeVoice: n };
        const c = cloudFind((v) => v.lang.toLowerCase() === l);
        if (c) return { source: "cloud", plain: cloudVoiceToPlain(c) };
      }
    }
    return null;
  };

  const pickDefaultVoice = () => {
    const list = getVoiceList();
    if (!list.length) return null;
    if (settings.voiceName) {
      const v = findVoice(settings.voiceName);
      if (v && v.source === "native") return v.nativeVoice;
    }
    const pref = String(settings.lang || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US");
    const prefLang = pref.split("-")[0].toLowerCase();
    const matches = list.filter((v) => v.lang && v.lang.toLowerCase().startsWith(prefLang));
    if (matches.length) {
      const exact = matches.find((v) => v.lang.toLowerCase() === pref.toLowerCase());
      return exact || matches[0];
    }
    return list.find((v) => v.default) || list[0];
  };

  const chunkText = (text) => {
    const MAX_CHUNK = 200;
    const sentences = [];
    for (const line of String(text).replace(/\r/g, "").split("\n")) {
      for (const part of line.split(/(?<=[.!?\u2026;])\s+/)) {
        const s = part.trim();
        if (s) sentences.push(s);
      }
    }
    const chunks = [];
    let cur = "";
    let curStart = 0;
    let pos = 0;
    const push = (t, start) => {
      chunks.push({ text: t, start });
      pos = start + t.length + 1;
    };
    for (const s of sentences) {
      if (s.length > MAX_CHUNK) {
        if (cur) { push(cur, curStart); cur = ""; }
        for (let i = 0; i < s.length; i += MAX_CHUNK) {
          const piece = s.slice(i, i + MAX_CHUNK).trim();
          push(piece, pos);
        }
      } else if (!cur) {
        cur = s;
        curStart = pos;
      } else if ((cur + " " + s).length <= MAX_CHUNK) {
        cur = cur + " " + s;
      } else {
        push(cur, curStart);
        cur = s;
        curStart = pos;
      }
    }
    if (cur) push(cur, curStart);
    const fullText = chunks.map((c) => c.text).join(" ");
    return { chunks, fullText };
  };

  const TITLE_ABBR = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof)\.$/i;
  const TERM = /\p{Sentence_Terminal}/u;

  const pullSentence = (buf) => {
    if (!buf) return null;
    let parts;
    try {
      parts = buf.split(/(?<=\p{Sentence_Terminal})/u);
    } catch (e) {
      parts = null;
    }
    if (parts && parts.length >= 2) {
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc += parts[i];
        if (!TITLE_ABBR.test(acc)) {
          return { sentence: acc.trim(), rest: parts.slice(i + 1).join("") };
        }
      }
      return null;
    }
    const m = buf.match(TERM);
    if (!m) return null;
    let end = m.index + 1;
    while (end < buf.length && TERM.test(buf[end])) end++;
    return { sentence: buf.slice(0, end).trim(), rest: buf.slice(end) };
  };

  const splitSentences = (text) => {
    const out = [];
    let rest = text;
    while (rest) {
      const pulled = pullSentence(rest);
      if (!pulled) {
        if (rest.trim()) out.push(rest.trim());
        break;
      }
      out.push(pulled.sentence);
      rest = pulled.rest;
    }
    return out;
  };

  const fire = (job, name, data) => {
    const cb = job.handlers["on" + name[0].toUpperCase() + name.slice(1)];
    if (typeof cb === "function") { try { cb(data); } catch (e) {} }
    const gcb = api["on" + name[0].toUpperCase() + name.slice(1)];
    if (typeof gcb === "function") { try { gcb(data); } catch (e) {} }
  };

  const processQueue = () => {
    if (!hasSpeech || currentJob || !queue.length) return;
    currentJob = queue.shift();
    const job = currentJob;
    fire(job, "start", job.stream
      ? { text: job.text, stream: true }
      : { text: job.fullText, chunks: job.chunks.length });
    if (job.delaySec > 0) {
      job.timer = setTimeout(() => {
        job.timer = null;
        if (job.alive) startJobSpeaking(job);
      }, job.delaySec * 1000);
    } else {
      startJobSpeaking(job);
    }
  };

  const startJobSpeaking = (job) => {
    if (!job.alive) return;
    const speakNext = () => {
      if (!job.alive) return;
      job.produce().then((chunk) => {
        if (!job.alive) return;
        if (chunk === null) {
          finishJob(job, { cancelled: false });
          return;
        }
        speakChunk(job, chunk, speakNext);
      }).catch((e) => {
        if (!job.alive) return;
        failJob(job, new Error("Failed to read text stream: " + e.message));
      });
    };
    speakNext();
  };

  const speakChunk = (job, chunk, onDone) => {
    let voiceDesc = null;
    if (job.opts.voice != null) {
      voiceDesc = findVoice(job.opts.voice);
    } else {
      const nv = pickDefaultVoice();
      if (nv) voiceDesc = { source: "native", plain: vToPlain(nv), nativeVoice: nv };
    }
    if (voiceDesc && voiceDesc.source === "cloud") {
      playCloudChunk(job, chunk, voiceDesc.plain, onDone);
      return;
    }
    let u;
    try {
      u = new SpeechSynthesisUtterance(chunk.text);
    } catch (e) {
      failJob(job, new Error("Could not create speech utterance: " + e.message));
      return;
    }
    u.rate = job.opts.rate != null ? job.opts.rate : (job.opts.speed != null ? job.opts.speed : settings.rate);
    u.pitch = job.opts.pitch != null ? job.opts.pitch : settings.pitch;
    u.volume = job.opts.volume != null ? job.opts.volume : settings.volume;
    const voice = voiceDesc ? voiceDesc.nativeVoice : null;
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || job.opts.lang || settings.lang ||
      (typeof navigator !== "undefined" ? navigator.language : "") || "en-US";
    u.onboundary = (ev) => {
      if (!job.alive) return;
      if (ev.name && ev.name !== "word") return;
      const rel = ev.charIndex || 0;
      const idx = chunk.start + rel;
      const m = /^\S+/.exec(chunk.text.slice(rel));
      const word = m ? m[0] : "";
      fire(job, "chunk", { textChunk: word, charIndex: idx, text: chunk.baseText || chunk.text });
    };
    u.onend = () => {
      if (!job.alive) return;
      job.spokenText += (job.spokenText ? " " : "") + chunk.text;
      onDone();
    };
    u.onerror = (ev) => {
      if (!job.alive) return;
      const errName = ev && ev.error;
      if (errName === "canceled" || errName === "interrupted") {
        finishJob(job, { cancelled: true });
      } else {
        failJob(job, new Error("Speech synthesis error: " + (errName || "unknown")));
      }
    };
    try {
      window.speechSynthesis.speak(u);
    } catch (e) {
      failJob(job, new Error("Could not start speech synthesis: " + e.message));
    }
  };

  const playCloudChunk = (job, chunk, voice, onDone) => {
    job.cloud = true;
    const sentences = splitSentences(chunk.text);
    if (!sentences.length) { onDone(); return; }
    let idx = 0;
    let offset = 0;
    const playNext = () => {
      if (!job.alive) return;
      if (idx >= sentences.length) {
        job.audio = null;
        onDone();
        return;
      }
      const sentence = sentences[idx++];
      const url = "https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
        encodeURIComponent(voice.locale) + "&q=" + encodeURIComponent(sentence);
      let audio;
      try {
        audio = new Audio(url);
      } catch (e) {
        failJob(job, new Error("Could not create audio for cloud voice: " + e.message));
        return;
      }
      audio.preload = "auto";
      audio.playbackRate = job.opts.rate != null ? job.opts.rate : (job.opts.speed != null ? job.opts.speed : settings.rate);
      audio.volume = job.opts.volume != null ? job.opts.volume : settings.volume;
      job.audio = audio;
      fire(job, "chunk", { textChunk: sentence, charIndex: chunk.start + offset, text: chunk.baseText || chunk.text });
      offset += sentence.length + 1;
      audio.addEventListener("ended", () => {
        if (!job.alive) return;
        job.spokenText += (job.spokenText ? " " : "") + sentence;
        playNext();
      }, { once: true });
      audio.addEventListener("error", () => {
        if (!job.alive) return;
        failJob(job, new Error("Failed to load cloud voice audio (is your browser online?)."));
      }, { once: true });
      audio.play().catch((e) => {
        if (!job.alive) return;
        const err = new Error("Cloud voices need a user interaction first (browser autoplay rule: " + e.name + ").");
        failJob(job, err);
      });
    };
    playNext();
  };

  const finishJob = (job, result) => {
    if (!job.alive) return;
    job.alive = false;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    if (currentJob === job) currentJob = null;
    if (job.stream) job.fullText = job.spokenText;
    const done = { text: job.fullText, cancelled: !!result.cancelled, spokenText: job.spokenText };
    fire(job, "end", done);
    job.resolve(done);
    processQueue();
  };

  const failJob = (job, err) => {
    if (!job.alive) return;
    job.alive = false;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    if (currentJob === job) currentJob = null;
    fire(job, "error", err);
    job.reject(err);
    processQueue();
  };

  const abortJob = (job) => {
    if (!job.alive) return { spokenText: job.spokenText };
    job.alive = false;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    if (job.audio) {
      try {
        job.audio.pause();
        job.audio.removeAttribute("src");
        job.audio.load();
      } catch (e) {}
      job.audio = null;
    }
    if (job.reader && typeof job.reader.cancel === "function") {
      try { job.reader.cancel(); } catch (e) {}
    }
    if (currentJob === job) {
      currentJob = null;
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (job.stream) job.fullText = job.spokenText;
    const result = { text: job.fullText, cancelled: true, spokenText: job.spokenText };
    fire(job, "end", result);
    job.resolve(result);
    processQueue();
    return result;
  };

  const createJob = (opts) => {
    if (!hasSpeech) {
      const err = new Error("Speech synthesis is not supported in this browser.");
      err.name = "NotSupportedError";
      return Promise.reject(err);
    }
    const hasText = typeof opts.text === "string" && opts.text.trim();
    if (!hasText && !opts.textStream) {
      return Promise.resolve({ text: "", cancelled: false, spokenText: "" });
    }
    let resolveFn, rejectFn;
    const p = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
    const job = {
      text: typeof opts.text === "string" ? opts.text : "",
      opts: opts,
      alive: true,
      fullText: "",
      spokenText: "",
      handlers: opts,
      delaySec: Math.max(0, opts.delay || 0),
      timer: null,
      chunks: null,
      ci: 0,
      stream: !!opts.textStream,
      pending: "",
      doneReading: false,
      reader: null,
      cloud: false,
      audio: null,
      resolve: resolveFn,
      reject: rejectFn,
    };
    if (opts.textStream) {
      try { job.reader = opts.textStream.getReader(); } catch (e) { job.reader = null; }
      job.produce = () => {
        const step = () => {
          if (!job.alive) return Promise.resolve(null);
          if (job.doneReading) {
            const rest = job.pending.trim();
            job.pending = "";
            return Promise.resolve(rest ? { text: rest, start: 0 } : null);
          }
          return job.reader.read().then(({ value, done }) => {
            if (!job.alive) return null;
            if (done) {
              job.doneReading = true;
              const rest = job.pending.trim();
              job.pending = "";
              return rest ? { text: rest, start: 0 } : null;
            }
            job.pending += value;
            const pulled = pullSentence(job.pending);
            if (pulled) {
              job.pending = pulled.rest;
              return { text: pulled.sentence, start: 0 };
            }
            if (job.pending.length > 400) {
              const piece = job.pending.slice(0, 200).trim();
              job.pending = job.pending.slice(200);
              return piece ? { text: piece, start: 0 } : step();
            }
            return step();
          });
        };
        return step();
      };
    } else {
      const { chunks, fullText } = chunkText(job.text);
      job.chunks = chunks;
      job.fullText = fullText;
      job.produce = () => {
        if (job.ci >= job.chunks.length) return Promise.resolve(null);
        const c = job.chunks[job.ci++];
        return Promise.resolve({ text: c.text, start: c.start, baseText: job.fullText });
      };
    }
    p.stop = () => {
      abortJob(job);
      return { spokenText: job.spokenText };
    };
    p.toString = () => "";
    queue.push(job);
    processQueue();
    return p;
  };

  const normalizeInput = (input, opts) => {
    if (input && typeof input === "object") {
      const obj = input;
      for (const k of ["text", "textStream", "voice", "pitch", "speed", "rate", "volume", "lang", "delay", "queue", "onStart", "onEnd", "onChunk", "onError"]) {
        if (obj[k] !== undefined && opts[k] === undefined) opts[k] = obj[k];
      }
    } else if (opts.text === undefined) {
      opts.text = input == null ? "" : String(input);
    }
    return opts;
  };

  const api = function (input, second, pitch, speed, delay) {
    let opts;
    if (input != null && typeof input !== "object" && typeof second === "string") {
      opts = { voice: second };
      if (pitch !== undefined) opts.pitch = pitch;
      if (speed !== undefined) opts.speed = speed;
      if (delay !== undefined) opts.delay = delay;
    } else {
      opts = (second && typeof second === "object") ? second : {};
    }
    opts = normalizeInput(input, opts);
    if (opts.queue !== true && (currentJob || queue.length)) api.stop();
    return createJob(opts);
  };

  api.speak = api;
  api.stop = api.cancel = () => {
    if (!hasSpeech) return;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    const jobs = [];
    if (currentJob) { jobs.push(currentJob); currentJob = null; }
    while (queue.length) jobs.push(queue.shift());
    for (const j of jobs) abortJob(j);
    processQueue();
  };

  let pauseTried = false;
  let pauseWorks = true;
  api.pause = () => {
    if (!hasSpeech) return;
    if (currentJob && currentJob.cloud) {
      if (currentJob.audio && !currentJob.audio.paused) {
        try { currentJob.audio.pause(); } catch (e) {}
      }
      return;
    }
    if (pauseTried && !pauseWorks) return;
    if (!window.speechSynthesis.speaking || window.speechSynthesis.paused) return;
    try { window.speechSynthesis.pause(); } catch (e) {}
    if (!pauseTried) {
      pauseTried = true;
      setTimeout(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          pauseWorks = false;
        }
      }, 300);
    }
  };
  api.resume = () => {
    if (!hasSpeech) return;
    if (currentJob && currentJob.cloud) {
      if (currentJob.audio && currentJob.audio.paused) {
        try { currentJob.audio.play().catch(() => {}); } catch (e) {}
      }
      return;
    }
    if (window.speechSynthesis.paused) {
      try { window.speechSynthesis.resume(); } catch (e) {}
    }
  };
  api.settings = settings;
  api.setVoice = (sel) => {
    const v = findVoice(sel);
    if (v) {
      settings.voiceName = v.plain.name;
      return v.plain;
    }
    settings.voiceName = typeof sel === "string" ? sel : null;
    return null;
  };
  api.getVoices = () => getVoices();
  api.getCloudVoices = () => getCloudVoices();
  api.supported = hasSpeech;
  Object.defineProperty(api, "voices", { get: () => getVoices() });
  Object.defineProperty(api, "pauseSupported", {
    get: () => (currentJob && currentJob.cloud) ? true : (!pauseTried || pauseWorks),
  });
  Object.defineProperty(api, "voice", {
    get: () => {
      const v = settings.voiceName ? findVoice(settings.voiceName) : null;
      return v ? v.plain : null;
    },
  });
  Object.defineProperty(api, "isSpeaking", { get: () => hasSpeech && !!currentJob });
  Object.defineProperty(api, "paused", {
    get: () => {
      if (!hasSpeech) return false;
      if (currentJob && currentJob.cloud) return currentJob.audio ? currentJob.audio.paused : false;
      return !!window.speechSynthesis.paused;
    },
  });
  Object.defineProperty(api, "queued", { get: () => queue.length });

  // ======================= SPEECH → TEXT (dictation) =======================
  const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
  const hasSTT = !!SR;

  let sttAlive = false;

  const listen = (opts) => {
    opts = opts || {};
    if (!hasSTT) {
      const err = new Error("Speech recognition is not supported in this browser. Try Chrome, Edge or Safari.");
      err.name = "NotSupportedError";
      return Promise.reject(err);
    }
    let resolveFn;
    const p = new Promise((resolve) => { resolveFn = resolve; });
    p.toString = () => "";
    const rec = new SR();
    rec.lang = opts.lang || settings.lang || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US";
    rec.continuous = opts.continuous !== false;
    rec.interimResults = opts.interim !== false;
    rec.maxAlternatives = 1;

    const fireListen = (name, data) => {
      const cb = opts["on" + name[0].toUpperCase() + name.slice(1)];
      if (typeof cb === "function") { try { cb(data); } catch (e) {} }
      const gcb = api["onListen" + name[0].toUpperCase() + name.slice(1)];
      if (typeof gcb === "function") { try { gcb(data); } catch (e) {} }
    };

    let finalText = "";
    let alive = true;

    rec.onstart = () => {
      sttAlive = true;
      fireListen("start", {});
    };
    rec.onresult = (ev) => {
      if (!alive) return;
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = res[0].transcript;
        if (res.isFinal) {
          const seg = t.trim();
          if (seg) finalText += (finalText ? " " : "") + seg;
          fireListen("final", { text: t, fullText: finalText });
        } else {
          interim += t;
        }
      }
      if (interim) fireListen("interim", { text: interim.trim(), fullText: (finalText ? finalText + " " : "") + interim.trim() });
    };
    rec.onerror = (ev) => {
      if (!alive) return;
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      fireListen("error", new Error("Speech recognition error: " + ev.error));
    };
    rec.onend = () => {
      if (!alive) return;
      alive = false;
      sttAlive = false;
      const res = { text: finalText, cancelled: false };
      fireListen("end", res);
      resolveFn(res);
    };

    p.stop = () => {
      if (!alive) return { text: finalText, cancelled: true };
      alive = false;
      sttAlive = false;
      try { rec.stop(); } catch (e) {}
      const res = { text: finalText, cancelled: true };
      fireListen("end", res);
      resolveFn(res);
      return res;
    };

    try {
      rec.start();
    } catch (e) {
      alive = false;
      const err = new Error("Could not start speech recognition: " + e.message);
      fireListen("error", err);
      return Promise.reject(err);
    }
    return p;
  };
  api.listen = listen;
  api.sttSupported = hasSTT;
  Object.defineProperty(api, "isListening", { get: () => sttAlive });

  if (hasSpeech) {
    window.addEventListener("pagehide", () => {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    });
  }

  window.__voiceToolsPluginApi = api;
  return api;
  }
  if (!window.__voiceToolsPluginApi) makeVoiceTools();
})();
