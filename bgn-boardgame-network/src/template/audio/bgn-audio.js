/* ═══════════════════════════════════════════════════════════════════
   BGN AUDIO SYSTEM — shared sound + music for Boardgame Network
   templates. Single file, zero dependencies, no external assets.

   HOW TO ADD IT TO A GENERATOR
   ────────────────────────────
   Paste these two lines near the top of index.html (right after the
   BGN stylesheet <link>):

     <script>window.BGN_AUDIO = { music: "https://user.uploads.dev/file/<theme>.mp3" };</script>
     <script src="https://user.uploads.dev/file/<bgn-audio>.js"></script>

   That's it for background music + a mute/volume toggle + automatic
   click sounds on every button. To hook up game events, call:

     BGN.sfx.play("win")          // or "lose", "turn", "deal", "flip",
                                  // "place", "discard", "dice", "draw",
                                  // "chip", "coin", "boom", "warn",
                                  // "hint", "step", "error", "tada"
     BGN.music.play(url)          // swap theme mid-game (crossfades)

   Or just add data-sfx="name" to any element and it plays that sound
   when clicked.

   CONFIG (window.BGN_AUDIO, all optional):
     music     string  URL of a looping background track
     vol       number  starting volume 0..1 (default 0.5)
     muted     bool    start muted (default: saved preference)
     noButton  bool    skip the mute/volume button (default false)
     theme     string  "dark" (default) or "light" button styling

   The mute state + volume are remembered per generator (localStorage).
   Music starts on the first user gesture (browser autoplay rules).

   Source of truth: the hub generator's src/template/audio/bgn-audio.js.
   Re-upload it (upload_file) if you change it, and bump the URL in the
   templates that link it.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  "use strict";

  var CFG = window.BGN_AUDIO || {};

  /* ── state ─────────────────────────────────────────────── */
  var storeKey = "bgn-audio-pref";
  var pref = { muted:false, vol:0.5 };
  try {
    var raw = localStorage.getItem(storeKey);
    if (raw) { var p = JSON.parse(raw); if (p && typeof p === "object") pref = { muted:!!p.muted, vol:isFinite(+p.vol)?Math.max(0,Math.min(1,+p.vol)):0.5 }; }
  } catch(e){}
  var muted = pref.muted;
  var volume = CFG.vol!=null ? Math.max(0,Math.min(1,+CFG.vol)) : pref.vol;

  function savePref(){ try{ localStorage.setItem(storeKey, JSON.stringify({muted:muted, vol:volume})); }catch(e){} }

  /* ── audio context (created lazily; resumed on first gesture) ── */
  var actx = null;
  var master = null;
  function ac(){
    if(!actx){
      try{ actx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
      try{
        master = actx.createGain();
        master.gain.value = 1;
        master.connect(actx.destination);
        if(CFG.debug && window.AnalyserNode){
          var an = actx.createAnalyser();
          an.fftSize = 512;
          master.connect(an);
          _dbgAnalyser = an;
        }
      }catch(e){}
    }
    if(actx && actx.state === "suspended"){ try{ actx.resume(); }catch(e){} }
    return actx;
  }
  var _dbgAnalyser = null;
  function dbgLevel(){
    if(!_dbgAnalyser) return -1;
    var d = new Uint8Array(_dbgAnalyser.frequencyBinCount);
    _dbgAnalyser.getByteFrequencyData(d);
    var s = 0; for(var i=0;i<d.length;i++) s += d[i];
    return s / d.length;
  }
  function nowT(){ return actx ? actx.currentTime : 0; }
  function volPeak(p){ return (p==null?0.2:p) * volume * 0.85; }

  /* ── synth helpers ── */
  function tone(freq, dur, o){
    o = o||{};
    if(!ac() || muted) return;
    var t0 = nowT() + (o.delay||0);
    var osc = actx.createOscillator();
    osc.type = o.type||"sine";
    osc.frequency.setValueAtTime(Math.max(1,freq), t0);
    if(o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1,o.glideTo), t0+dur);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(volPeak(o.peak), t0+0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0+dur+0.04);
  }
  function noise(dur, o){
    o = o||{};
    if(!ac() || muted) return;
    var t0 = nowT() + (o.delay||0);
    var len = Math.max(1, Math.floor(actx.sampleRate*dur));
    var buf = actx.createBuffer(1, len, actx.sampleRate);
    var d = buf.getChannelData(0);
    for(var i=0;i<len;i++) d[i] = Math.random()*2-1;
    var src = actx.createBufferSource(); src.buffer = buf;
    var f = actx.createBiquadFilter();
    f.type = o.type||"bandpass";
    f.frequency.setValueAtTime(o.freq||2000, t0);
    if(o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(1,o.freqEnd), t0+dur);
    f.Q.value = o.q==null?1:o.q;
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(volPeak(o.peak), t0+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0+dur+0.05);
  }

  /* ── the sound set ─────────────────────────────────────── */
  var SFX = {
    click:    function(){ tone(1500,0.05,{type:"triangle",glideTo:1000,peak:0.22}); },
    flip:     function(){
      noise(0.05,{freq:900,freqEnd:3400,peak:0.28,q:1.3});
      noise(0.045,{freq:2600,freqEnd:5200,peak:0.2,q:1.6,delay:0.05});
      tone(720,0.045,{type:"triangle",glideTo:900,peak:0.14,delay:0.05});
    },
    deal:     function(){
      for(var i=0;i<3;i++) noise(0.05,{freq:700+i*700,freqEnd:5000,peak:0.22,q:1.2,delay:i*0.05});
      tone(990,0.09,{type:"sine",peak:0.2,delay:0.16});
      tone(1480,0.1,{type:"sine",peak:0.15,delay:0.23});
    },
    place:    function(){
      tone(260,0.09,{type:"sine",glideTo:150,peak:0.34});
      noise(0.05,{freq:1600,freqEnd:700,peak:0.16,q:0.8});
    },
    dice:     function(){
      for(var i=0;i<3;i++) noise(0.04,{freq:420+Math.random()*900,peak:0.3,q:0.9,delay:i*0.07});
      tone(540,0.08,{type:"triangle",peak:0.22,delay:0.22});
    },
    draw:     function(){
      tone(880,0.07,{type:"triangle",peak:0.22});
      tone(1318,0.1,{type:"triangle",peak:0.18,delay:0.06});
    },
    discard:  function(){
      tone(760,0.07,{type:"triangle",glideTo:320,peak:0.22});
      noise(0.05,{freq:2400,freqEnd:900,peak:0.16,q:1.1,delay:0.02});
    },
    chip:     function(){
      tone(2110,0.11,{type:"triangle",peak:0.26});
      tone(3180,0.1,{type:"triangle",peak:0.14,delay:0.006});
      tone(1055,0.16,{type:"sine",peak:0.12,delay:0.012});
    },
    coin:     function(){ SFX.chip(); },
    turn:     function(){
      tone(660,0.09,{type:"sine",peak:0.24});
      tone(990,0.12,{type:"sine",peak:0.2,delay:0.09});
    },
    step:     function(){ tone(320,0.05,{type:"triangle",peak:0.2}); },
    hint:     function(){
      tone(1175,0.06,{type:"triangle",peak:0.2});
      tone(1480,0.07,{type:"triangle",peak:0.16,delay:0.06});
      tone(1760,0.1,{type:"triangle",peak:0.13,delay:0.12});
    },
    warn:     function(){
      tone(520,0.15,{type:"square",peak:0.12});
      tone(520,0.15,{type:"square",peak:0.12,delay:0.19});
      tone(390,0.2,{type:"square",peak:0.1,delay:0.38});
    },
    boom:     function(){
      noise(0.55,{type:"lowpass",freq:850,freqEnd:90,peak:0.6,q:0.7});
      tone(130,0.5,{type:"sine",glideTo:38,peak:0.5});
    },
    error:    function(){
      tone(180,0.1,{type:"square",peak:0.13});
      tone(120,0.16,{type:"square",peak:0.11,delay:0.09});
    },
    win:      function(){
      var seq=[[523,0],[659,0.1],[784,0.2],[1047,0.3]];
      for(var i=0;i<seq.length;i++) tone(seq[i][0],0.22,{type:"triangle",peak:0.22,delay:seq[i][1]});
      noise(0.5,{freq:5000,peak:0.06,q:2,delay:0.3});
    },
    lose:     function(){
      var seq=[[392,0],[330,0.16],[262,0.32],[196,0.48]];
      for(var i=0;i<seq.length;i++) tone(seq[i][0],0.24,{type:"triangle",peak:0.18,delay:seq[i][1]});
    },
    draw2:    function(){
      tone(660,0.14,{type:"triangle",peak:0.2});
      tone(660,0.18,{type:"triangle",peak:0.16,delay:0.14});
    },
    tada:     function(){
      SFX.win();
      tone(1318,0.3,{type:"sine",peak:0.15,delay:0.38});
    }
  };

  /* ── public sfx api ── */
  var api = {
    play: function(name){
      if(muted) return;
      if(typeof name === "function"){ name(); return; }
      var fn = SFX[name];
      if(fn) fn(); else if(SFX.click) SFX.click();
    },
    volume: function(v){
      if(v!=null){ volume = Math.max(0,Math.min(1,+v)); savePref(); if(music.el) music.el.volume = volume; return volume; }
      return volume;
    },
    _tone: tone, _noise: noise
  };
  Object.defineProperty(api,"muted",{ get:function(){return muted;}, set:function(v){ setMuted(!!v); }, configurable:true });

  /* ── music player ──────────────────────────────────────── */
  var music = {
    el: null, url: null, everStarted: false, fadeTimer: null
  };
  function fadeTo(a, target, dur){
    if(a._fade) clearInterval(a._fade);
    var t0 = Date.now(), from = a.volume;
    a._fade = setInterval(function(){
      var k = Math.min(1,(Date.now()-t0)/dur);
      a.volume = from + (target-from)*k;
      if(k>=1){ clearInterval(a._fade); a._fade=null; }
    }, 40);
  }
  function startMusic(url){
    if(!url) return;
    if(muted) { music.url = url; return; }
    if(music.el && music.el.src.indexOf(url) !== -1 && !music.el.paused) { music.url = url; return; }
    if(music.el){ try{ music.el.pause(); music.el.src = ""; }catch(e){} music.el = null; }
    try{ var a = new Audio(url); }catch(e){ return; }
    a.loop = true; a.preload = "auto"; a.volume = 0;
    music.el = a; music.url = url;
    var pr = a.play();
    if(pr && pr.then) pr.then(function(){ music.everStarted = true; }, function(){});
    fadeTo(a, volume, 700);
  }
  function stopMusic(){
    var a = music.el;
    if(!a) return;
    fadeTo(a, 0, 400);
    setTimeout(function(){ try{ a.pause(); }catch(e){} }, 450);
  }
  music.play = function(url){
    if(muted){ music.url = url; return; }
    startMusic(url);
  };
  music.pause = stopMusic;
  music.setVolume = function(v){ volume = Math.max(0,Math.min(1,+v)); savePref(); if(music.el) music.el.volume = volume; };
  music.isPlaying = function(){ return !!(music.el && !music.el.paused && music.everStarted); };

  /* ── mute/unmute ── */
  function setMuted(m){
    if(muted === m) return;
    muted = m;
    savePref();
    if(m){ stopMusic(); }
    else {
      ac();
      if(CFG.music || music.url) startMusic(music.url || CFG.music);
    }
    updateButton();
  }

  /* ── first-gesture autoplay kick ── */
  function onGesture(){
    ac();
    if(!muted && (CFG.music || music.url) && !music.everStarted) startMusic(music.url || CFG.music);
    detachGesture();
  }
  function attachGesture(){
    document.addEventListener("pointerdown", onGesture, {passive:true});
    document.addEventListener("touchstart", onGesture, {passive:true});
    document.addEventListener("keydown", onGesture, {passive:true});
  }
  function detachGesture(){
    document.removeEventListener("pointerdown", onGesture);
    document.removeEventListener("touchstart", onGesture);
    document.removeEventListener("keydown", onGesture);
  }

  /* ── auto-wired clicks: buttons + data-sfx + cards ── */
  document.addEventListener("click", function(e){
    var t = e.target;
    while(t && t !== document){
      var tag = t.tagName ? t.tagName.toLowerCase() : "";
      if(t.getAttribute && t.getAttribute("data-sfx")){ var n=t.getAttribute("data-sfx"); api.play(n); return; }
      if(tag === "button" || (t.getAttribute && t.getAttribute("role") === "button")){ api.play("click"); return; }
      if(t.classList && t.classList.contains("bgn-card")){ api.play("flip"); return; }
      t = t.parentNode;
    }
  }, true);

  /* ── sound toggle button ── */
  var btn = null, volBar = null;
  var BTN_CSS = [
    "#bgnAudioBtn{position:fixed;left:14px;bottom:14px;z-index:9990;width:42px;height:42px;border-radius:50%;",
    "border:1px solid rgba(212,175,55,.5);background:linear-gradient(150deg,#1a1630,#0e0b1a);color:#e7c96a;",
    "cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.55);",
    "transition:transform .15s ease,box-shadow .15s ease;font-size:1.05rem;padding:0;line-height:1;}",
    "#bgnAudioBtn:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.65),0 0 14px rgba(212,175,55,.28);}",
    "#bgnAudioBtn.muted{opacity:.72;color:#8a8298;}",
    "#bgnAudioBtn:focus{outline:2px solid rgba(212,175,55,.6);outline-offset:2px;}",
    "#bgnAudioVol{position:fixed;left:14px;bottom:62px;z-index:9989;display:flex;align-items:center;gap:8px;",
    "background:rgba(14,11,26,.94);border:1px solid rgba(212,175,55,.35);border-radius:999px;padding:8px 12px;",
    "opacity:0;pointer-events:none;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;}",
    "#bgnAudioVol.show{opacity:1;pointer-events:auto;transform:none;}",
    "#bgnAudioVol input[type=range]{width:92px;accent-color:#d4af37;cursor:pointer;}",
    "#bgnAudioVol span{color:#a49bb4;font-size:.72rem;letter-spacing:.08em;min-width:30px;text-align:center;}",
    "@media (max-width:560px){#bgnAudioBtn{width:38px;height:38px;font-size:.95rem;left:10px;bottom:10px;}",
    "#bgnAudioVol{left:10px;bottom:54px;}}"
  ].join("\n");
  function iconHtml(){
    return muted
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';
  }
  function updateButton(){
    if(!btn) return;
    btn.innerHTML = iconHtml();
    btn.classList.toggle("muted", muted);
    btn.title = muted ? "Sound off — click to unmute" : "Sound on — click to mute";
    if(volBar){
      volBar.querySelector("input").value = Math.round(volume*100);
      volBar.querySelector("span").textContent = Math.round(volume*100)+"%";
    }
  }
  function buildButton(){
    if(CFG.noButton || document.getElementById("bgnAudioBtn")) return;
    var st = document.createElement("style");
    st.id = "bgnAudioCss";
    st.textContent = BTN_CSS;
    document.head.appendChild(st);
    btn = document.createElement("button");
    btn.id = "bgnAudioBtn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Toggle sound");
    volBar = document.createElement("div");
    volBar.id = "bgnAudioVol";
    volBar.innerHTML = '<input type="range" min="0" max="100" value="'+(Math.round(volume*100))+'"><span>'+(Math.round(volume*100))+'%</span>';
    var range = volBar.querySelector("input");
    range.addEventListener("input", function(){ api.volume(+this.value/100); });
    btn.addEventListener("click", function(e){ e.stopPropagation(); setMuted(!muted); api.play("click"); });
    btn.addEventListener("mouseenter", function(){ volBar.classList.add("show"); });
    btn.addEventListener("mouseleave", function(){ volBar.classList.remove("show"); });
    btn.addEventListener("focus", function(){ volBar.classList.add("show"); });
    btn.addEventListener("blur", function(){ volBar.classList.remove("show"); });
    document.body.appendChild(volBar);
    document.body.appendChild(btn);
    updateButton();
  }

  /* ── expose ── */
  window.BGN = window.BGN || {};
  window.BGN.sfx = api;
  window.BGN.music = music;
  window.BGN.audio = { sfx:api, music:music, toggle:function(){ setMuted(!muted); } };
  window.BGN._dbgLevel = dbgLevel;
  Object.defineProperty(window.BGN.audio,"muted",{ get:function(){return muted;}, set:function(v){ setMuted(!!v); }, configurable:true });

  /* ── boot ── */
  function boot(){
    if(CFG.music && !muted) startMusic(CFG.music);
    buildButton();
    attachGesture();
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
