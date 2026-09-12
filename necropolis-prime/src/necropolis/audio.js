// =====================================================================
//  Soundtrack — three looping tracks crossfaded by game state.
//  The MP3s are hosted uploads (generated for this project); they do
//  not live in src/ because they exceed the practical repo size here.
//  To rebuild: generate_music with the prompts in README.md, upload,
//  and replace the URLs below. See src/README.md.
// =====================================================================
const TRACKS = {
  menu:    "https://user.uploads.dev/file/fec9a0872e7051ea99b3ebbfdda00847.mp3",
  explore: "https://user.uploads.dev/file/58d55088569cc6b08f8f2488fffe58f5.mp3",
  sanctum: "https://user.uploads.dev/file/6ba1ecdbea1db9f2741379c6acf50aeb.mp3",
};

export class Soundtrack {
  constructor({ volume = 0.45 } = {}){
    this.volume = volume;
    this.muted = false;
    this.target = null;
    this.started = false;
    this.tracks = {};
    for (const k in TRACKS){
      const a = new Audio();
      a.src = TRACKS[k];
      a.loop = true;
      a.preload = "auto";
      a.volume = 0;
      this.tracks[k] = a;
    }
    this._timer = setInterval(() => this._tick(), 50);
  }

  _tick(){
    const step = 0.02;
    for (const k in this.tracks){
      const a = this.tracks[k];
      const want = (!this.muted && k === this.target) ? this.volume : 0;
      if (a.volume < want) a.volume = Math.min(want, a.volume + step);
      else if (a.volume > want) a.volume = Math.max(want, a.volume - step);
      if (a.volume <= 0.001 && k !== this.target && !a.paused) a.pause();
    }
  }

  play(key){
    if (!this.tracks[key] || this.target === key) return;
    this.target = key;
    const a = this.tracks[key];
    if (a.paused){
      try { if (a.ended || a.currentTime > 0.2) a.currentTime = 0; } catch (e) {}
      a.play().catch(() => {});
    }
  }

  // call from a user gesture to satisfy autoplay policy
  resume(){
    const a = this.tracks[this.target];
    if (a && a.paused) a.play().catch(() => {});
    this.started = true;
  }

  toggleMute(){
    this.muted = !this.muted;
    return this.muted;
  }
}
