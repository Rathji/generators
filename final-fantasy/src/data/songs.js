// Task #221: Chiptune soundtrack data — tracker-style songs for the music
// engine (Task #222). Each voice is a string of row tokens separated by
// whitespace; '|' is an ignored bar separator for readability. Tokens:
//   C4, G#3, Ab2   — a note (letter, optional #/b, octave 2-6)
//   r              — rest
//   K S H C        — drums on the noise voice (kick / snare / hat / crash)
//   *n             — optional duration suffix: hold the token for n rows
//                    (default 1). rowsPerBar rows make one 4/4 bar.
//
// Voices may be omitted (silence). Every song must have equal row counts
// across its voices.

export const SONGS = {
  menu: {
    name: "Main Theme",
    tempo: 84,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 128,
    loop: true,
    volume: 0.9,
    voices: {
      // Gentle broken-chord arpeggio, C major.
      tri: `
        | C4*2 E4*2 G4*2 C5*2 E4*2 G4*2 C5*2 G4*2
        | A3*2 C4*2 E4*2 A4*2 C4*2 E4*2 A4*2 E4*2
        | F3*2 A3*2 C4*2 F4*2 A3*2 C4*2 F4*2 C4*2
        | G3*2 B3*2 D4*2 G4*2 B3*2 D4*2 G4*2 D4*2
        | C4*2 E4*2 G4*2 C5*2 E4*2 G4*2 C5*2 G4*2
        | A3*2 C4*2 E4*2 A4*2 C4*2 E4*2 A4*2 E4*2
        | F3*2 A3*2 C4*2 F4*2 A3*2 C4*2 F4*2 C4*2
        | G3*2 B3*2 D4*2 G4*2 B3*2 D4*2 G4*2 D4*2
      `,
      // Soft lead.
      pulse1: `
        | E4*4 G4*4 C5*4 r*4
        | C5*4 A4*4 G4*4 r*4
        | A4*4 C5*4 A4*4 r*4
        | G4*4 B4*4 D5*4 r*4
        | E5*4 D5*4 C5*4 r*4
        | C5*4 A4*4 E4*4 r*4
        | F4*4 A4*4 C5*4 r*4
        | B4*4 G4*4 E4*4 r*4
      `,
      // Warm root-fifth pads.
      pulse2: `
        | C3*8 G3*8 | A2*8 E3*8 | F2*8 C3*8 | G2*8 D3*8
        | C3*8 G3*8 | A2*8 E3*8 | F2*8 C3*8 | G2*8 D3*8
      `,
    },
  },

  town: {
    name: "Town",
    tempo: 100,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 128,
    loop: true,
    volume: 0.9,
    voices: {
      // Light triangle flute-like lead.
      tri: `
        | E5*4 D5*2 C5*2 A4*4 r*4
        | F5*4 E5*4 D5*4 C5*4
        | D5*4 r*4 B4*4 r*4
        | E5*4 D5*4 C5*4 r*4
        | C5*4 A4*2 G4*2 E4*4 r*4
        | A4*4 C5*4 E4*4 r*4
        | G4*4 B4*4 D5*4 r*4
        | C5*4 r*4 G4*4 r*4
      `,
      // Inner harmony.
      pulse1: `
        | E4*8 C4*8 | A4*8 F4*8 | B4*8 D4*8 | G4*8 C4*8
        | A4*8 E4*8 | F4*8 C4*8 | G4*8 B3*8 | E4*8 G4*8
      `,
      // Walking bass.
      pulse2: `
        | C3*8 C3*8 | F3*8 F3*8 | G3*8 G3*8 | C3*8 C3*8
        | A2*8 A2*8 | F3*8 F3*8 | G3*8 G3*8 | C3*8 C3*8
      `,
    },
  },

  overworld: {
    name: "Overworld",
    tempo: 128,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 128,
    loop: true,
    volume: 0.9,
    voices: {
      // Catchy lead, A minor.
      pulse1: `
        | A4*2 C5*2 E5*2 C5*2 A4*2 C5*2 E5*2 C5*2
        | F4*2 A4*2 C5*2 A4*2 F4*2 A4*2 C5*2 A4*2
        | E5*2 r*2 E5*2 r*2 G5*2 r*2 E5*2 r*2
        | D5*2 r*2 D5*2 r*2 B4*2 r*2 D5*2 r*2
        | A4*2 C5*2 E5*2 C5*2 A4*4 r*4
        | F4*2 A4*2 C5*2 A4*2 F4*4 r*4
        | G4*2 B4*2 D5*2 B4*2 G4*4 r*4
        | E4*2 G4*2 B4*2 G4*2 E4*4 r*4
      `,
      // Arpeggio wash.
      tri: `
        | A3*2 C4*2 E4*2 A4*2 C4*2 E4*2 A4*2 E4*2
        | F3*2 A3*2 C4*2 F4*2 A3*2 C4*2 F4*2 C4*2
        | C4*2 E4*2 G4*2 C5*2 E4*2 G4*2 C5*2 G4*2
        | G3*2 B3*2 D4*2 G4*2 B3*2 D4*2 G4*2 D4*2
        | A3*2 C4*2 E4*2 A4*2 C4*2 E4*2 A4*2 E4*2
        | F3*2 A3*2 C4*2 F4*2 A3*2 C4*2 F4*2 C4*2
        | C4*2 E4*2 G4*2 C5*2 E4*2 G4*2 C5*2 G4*2
        | G3*2 B3*2 D4*2 G4*2 B3*2 D4*2 G4*2 D4*2
      `,
      // Pulsing root-fifth bass.
      pulse2: `
        | A2*2 E2*2 A2*2 E2*2 A2*2 E2*2 A2*2 E2*2
        | F2*2 C3*2 F2*2 C3*2 F2*2 C3*2 F2*2 C3*2
        | C3*2 G2*2 C3*2 G2*2 C3*2 G2*2 C3*2 G2*2
        | G2*2 D3*2 G2*2 D3*2 G2*2 D3*2 G2*2 D3*2
        | A2*2 E2*2 A2*2 E2*2 A2*2 E2*2 A2*2 E2*2
        | F2*2 C3*2 F2*2 C3*2 F2*2 C3*2 F2*2 C3*2
        | C3*2 G2*2 C3*2 G2*2 C3*2 G2*2 C3*2 G2*2
        | G2*2 D3*2 G2*2 D3*2 G2*2 D3*2 G2*2 D3*2
      `,
      // Four-on-the-floor kit.
      noise: `
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
      `,
    },
  },

  dungeon: {
    name: "Dungeon",
    tempo: 88,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 128,
    loop: true,
    volume: 0.85,
    voices: {
      // Eerie sparse melody.
      tri: `
        | A4*4 r*4 A4*2 r*6
        | G4*4 r*4 G4*2 r*6
        | F4*4 r*4 E4*2 r*6
        | E4*4 r*4 D4*2 r*6
        | D4*4 r*4 C4*2 r*6
        | C4*4 r*4 D4*2 r*6
        | E4*4 r*4 F4*2 r*6
        | E4*4 r*4 E4*2 r*6
      `,
      // High shimmer.
      pulse1: `
        | r*16 | r*16 | r*16 | r*16
        | E5*8 r*8 | r*16 | D5*8 r*8 | r*16
      `,
      // Low drone.
      pulse2: `
        | A2*8 A2*8 | A2*8 A2*8 | F2*8 F2*8 | E2*8 E2*8
        | D2*8 D2*8 | C2*8 C2*8 | E2*8 E2*8 | E2*8 A2*8
      `,
      // Sparse heartbeat.
      noise: `
        | K*2 r*14 | r*16 | r*16 | r*16
        | r*16 | r*16 | r*16 | K*2 r*6 K*2 r*6
      `,
    },
  },

  battle: {
    name: "Battle",
    tempo: 152,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 128,
    loop: true,
    volume: 0.9,
    voices: {
      // Driving sixteenth-note lead.
      pulse1: `
        | A4 A4 G4 A4 B4 A4 G4 E4 A4 A4 G4 A4 B4 A4 C5 B4
        | A4 A4 G4 A4 B4 A4 G4 E4 A4 A4 C5 B4 A4 G4 E4 r
        | F4 F4 E4 F4 G4 F4 E4 C4 F4 F4 E4 F4 G4 F4 A4 G4
        | G4 G4 F4 G4 A4 G4 F4 D4 G4 G4 A4 B4 C5 B4 A4 G4
        | A4 A4 G4 A4 B4 A4 G4 E4 A4 A4 G4 A4 B4 A4 C5 B4
        | A4 A4 G4 A4 B4 A4 G4 E4 A4 A4 C5 B4 A4 G4 E4 r
        | F4 F4 A4 A4 C5 C5 A4 A4 F4 F4 A4 A4 C5 B4 A4 G4
        | E4 E4 G4 G4 B4 B4 E5 D5 C5 B4 A4 G4 A4 G4 E4 r
      `,
      // Root-fifth chug.
      pulse2: `
        | A2*2 E2*2 A2*2 E2*2 A2*2 E2*2 A2*2 E2*2
        | A2*2 E2*2 A2*2 E2*2 A2*2 E2*2 A2*2 E2*2
        | F2*2 C3*2 F2*2 C3*2 F2*2 C3*2 F2*2 C3*2
        | G2*2 D3*2 G2*2 D3*2 G2*2 D3*2 G2*2 D3*2
        | A2*2 E2*2 A2*2 E2*2 A2*2 E2*2 A2*2 E2*2
        | A2*2 E2*2 A2*2 E2*2 A2*2 E2*2 A2*2 E2*2
        | F2*2 C3*2 F2*2 C3*2 F2*2 C3*2 F2*2 C3*2
        | G2*2 D3*2 G2*2 D3*2 E2*2 E2*2 E2*2 E2*2
      `,
      // Chord stab wash.
      tri: `
        | A3*2 C4*2 E4*2 C4*2 A3*2 C4*2 E4*2 C4*2
        | A3*2 C4*2 E4*2 C4*2 A3*2 C4*2 E4*2 C4*2
        | F3*2 A3*2 C4*2 A3*2 F3*2 A3*2 C4*2 A3*2
        | G3*2 B3*2 D4*2 B3*2 G3*2 B3*2 D4*2 B3*2
        | A3*2 C4*2 E4*2 C4*2 A3*2 C4*2 E4*2 C4*2
        | A3*2 C4*2 E4*2 C4*2 A3*2 C4*2 E4*2 C4*2
        | F3*2 A3*2 C4*2 A3*2 F3*2 A3*2 C4*2 A3*2
        | G3*2 B3*2 D4*2 B3*2 E3*2 E3*2 E3*2 E3*2
      `,
      noise: `
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
      `,
    },
  },

  boss: {
    name: "Boss Battle",
    tempo: 158,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 128,
    loop: true,
    volume: 0.9,
    voices: {
      // Menacing chromatic-turn lead, E harmonic minor.
      pulse1: `
        | E4*2 E4*2 D#4*2 E4*2 B3*2 E4*2 D#4*2 E4*2
        | E4*2 E4*2 D#4*2 E4*2 B3*2 D#4*2 E4*2 r*2
        | C4*2 C4*2 B3*2 C4*2 G3*2 C4*2 B3*2 C4*2
        | D4*2 D4*2 C#4*2 D4*2 A3*2 D4*2 C#4*2 D4*2
        | E4*2 E4*2 D#4*2 E4*2 B3*2 E4*2 D#4*2 E4*2
        | E4*2 E4*2 D#4*2 E4*2 B3*2 D#4*2 E4*2 r*2
        | C4*2 C4*2 B3*2 C4*2 G3*2 C4*2 B3*2 C4*2
        | D4*2 D4*2 C#4*2 D4*2 A3*2 D4*2 C#4*2 D4*2
      `,
      // Pounding bass.
      pulse2: `
        | E2*2 E2*2 E2*2 E2*2 E2*2 E2*2 B2*2 E2*2
        | E2*2 E2*2 E2*2 E2*2 E2*2 E2*2 B2*2 E2*2
        | C2*2 C2*2 C2*2 C2*2 C2*2 C2*2 G2*2 C2*2
        | D2*2 D2*2 D2*2 D2*2 D2*2 D2*2 A2*2 D2*2
        | E2*2 E2*2 E2*2 E2*2 E2*2 E2*2 B2*2 E2*2
        | E2*2 E2*2 E2*2 E2*2 E2*2 E2*2 B2*2 E2*2
        | C2*2 C2*2 C2*2 C2*2 C2*2 C2*2 G2*2 C2*2
        | D2*2 D2*2 D2*2 D2*2 D2*2 D2*2 A2*2 D2*2
      `,
      // Low ominous sustain.
      tri: `
        | E3*8 E3*8 | E3*8 E3*8 | C3*8 C3*8 | D3*8 D3*8
        | E3*8 E3*8 | E3*8 E3*8 | C3*8 C3*8 | D3*8 D3*8
      `,
      noise: `
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
        | K r H r S r H r K r H r S r H r
      `,
    },
  },

  victory: {
    name: "Victory Fanfare",
    tempo: 120,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 32,
    loop: false,
    volume: 1,
    voices: {
      pulse1: `
        | C5*2 E5*2 G5*2 C6*2 E6*4 r*4
        | G4*2 B4*2 D5*2 G5*2 B5*4 r*4
      `,
      pulse2: `
        | C3*8 G3*8
        | G3*8 D4*8
      `,
      tri: `
        | C4*16
        | G4*16
      `,
      noise: `
        | K*2 r*6 K*2 r*6
        | K*2 r*6 K*2 r*6
      `,
    },
  },

  gameover: {
    name: "Requiem",
    tempo: 72,
    rowsPerBar: 16,
    loopFrom: 0,
    loopTo: 64,
    loop: false,
    volume: 0.9,
    voices: {
      pulse1: `
        | A4*8 G4*8
        | F4*8 E4*8
        | D4*8 C4*8
        | E4*16
      `,
      pulse2: `
        | A2*16
        | A2*8 F2*8
        | D2*8 C2*8
        | E2*16
      `,
      tri: `
        | A3*16
        | F3*16
        | D3*16
        | E3*16
      `,
    },
  },
};

export const SONGS_LABELS = Object.fromEntries(Object.entries(SONGS).map(([id, s]) => [id, s.name]));
