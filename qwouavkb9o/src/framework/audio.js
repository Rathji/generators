// Audio system using real MP3 files from Kaetram-Open for music and SFX
// Music URLs (uploaded to perchance file host)
const MUSIC_URLS = {
  village: "https://user.uploads.dev/file/67bcb85a35af97d779654be6c4063915.mp3",
  forest: "https://user.uploads.dev/file/e32f2c4fccda8220d159dee4884b18ed.mp3",
  beach: "https://user.uploads.dev/file/77a455b5bc30014645a5fb7ac18aad45.mp3",
  cave: "https://user.uploads.dev/file/cd1d17e2a5acff07eef1ff141cca9b0e.mp3",
  desert: "https://user.uploads.dev/file/831452d46ed236948976b1a35cb9af70.mp3",
  lavaland: "https://user.uploads.dev/file/b515814cebd01552a93aada07fedb51f.mp3",
  boss: "https://user.uploads.dev/file/5f423b487ad981dec29ca6bbe035cbcc.mp3",
};

// SFX URLs
const SFX_URLS = {
  hit1: "https://user.uploads.dev/file/8c3c100bd3a4171c3a54c1730d0f79eb.mp3",
  hit2: "https://user.uploads.dev/file/655ffc301cf9540c201d69a0075823a6.mp3",
  hurt: "https://user.uploads.dev/file/3be51741014fb9c6c5cecce60b3fd7d5.mp3",
  heal: "https://user.uploads.dev/file/df91fe81d22744f8751efb1d387d25fc.mp3",
  loot: "https://user.uploads.dev/file/4b504c9e73395d3a088bcea4834fc89b.mp3",
  death: "https://user.uploads.dev/file/679f6829de42649ab3cf076ad26c30aa.mp3",
  revive: "https://user.uploads.dev/file/9119c2b9e36cf3cf8dd4c4c67501269d.mp3",
  achievement: "https://user.uploads.dev/file/7e8b0bde45beacb4b110254c9ac56528.mp3",
  teleport: "https://user.uploads.dev/file/6af73aafd7f307a6fc1a3dfdc8a4f9bb.mp3",
  chest: "https://user.uploads.dev/file/f9674c4711e71dee7630f24f32055ce3.mp3",
  kill1: "https://user.uploads.dev/file/75715c246479bb5973122bae782e9b6d.mp3",
  kill2: "https://user.uploads.dev/file/27a21511b5e03905261506a4c86b96e0.mp3",
  noloot: "https://user.uploads.dev/file/1161f33f0c8a9e36ca7624be69d33671.mp3",
  firefox: "https://user.uploads.dev/file/0c263e6ba4aee912390372d3ae939ede.mp3",
  npc: "https://user.uploads.dev/file/448e9be69297fcd7f1302df715bafd79.mp3",
  chat: "https://user.uploads.dev/file/bca2b3a520c01ecdcaf9273655b05f2c.mp3",
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.currentMusic = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.currentArea = null;
    this.sfxBufferCache = {};
    this.musicBufferCache = {};
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.4;
      this.sfxGain.connect(this.ctx.destination);
    } catch(e) { this.enabled = false; }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  async _loadBuffer(url) {
    if (this.sfxBufferCache[url]) return this.sfxBufferCache[url];
    try {
      const resp = await fetch(url);
      const ab = await resp.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(ab);
      this.sfxBufferCache[url] = buf;
      return buf;
    } catch(e) { return null; }
  }

  async _loadMusicBuffer(url) {
    if (this.musicBufferCache[url]) return this.musicBufferCache[url];
    try {
      const resp = await fetch(url);
      const ab = await resp.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(ab);
      this.musicBufferCache[url] = buf;
      return buf;
    } catch(e) { return null; }
  }

  playSound(name) {
    if (!this.enabled || !this.ctx) return;
    const url = SFX_URLS[name];
    if (!url) return;
    this._loadBuffer(url).then(buf => {
      if (!buf || !this.enabled) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.sfxGain);
      src.start(0);
    });
  }

  updateMusic(areas, playerX, playerY) {
    if (!this.enabled || !this.ctx) return;
    let newArea = null;
    if (areas) {
      for (const area of areas) {
        if (playerX >= area.x && playerX < area.x + area.w &&
            playerY >= area.y && playerY < area.y + area.h) {
          newArea = area.id;
          break;
        }
      }
    }
    if (newArea !== this.currentArea) {
      this.currentArea = newArea;
      this.playMusic(newArea);
    }
  }

  playMusic(name) {
    if (this.currentMusic) {
      try { this.currentMusic.stop(); } catch(e){}
      this.currentMusic = null;
    }
    if (!name || !this.enabled || !this.ctx) return;
    const url = MUSIC_URLS[name];
    if (!url) return;

    this._loadMusicBuffer(url).then(buf => {
      if (!buf || !this.enabled || this.currentArea !== name) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start(0);
      this.currentMusic = src;

      src.onended = () => {
        if (this.currentMusic === src) this.currentMusic = null;
      };
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && this.currentMusic) {
      try { this.currentMusic.stop(); } catch(e){}
      this.currentMusic = null;
    }
  }
}
