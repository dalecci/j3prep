// Theory engine: keys, spelling, chord parsing, chord tones, colors, accents.
// Pure functions, no DOM. Rules, not AI.

export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_PC = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Scale degree -> semitones above the root.
export const DEGREE_SEMIS = {
  '1': 0, 'b2': 1, '2': 2, 'b3': 3, '3': 4, '4': 5, '#4': 6,
  '5': 7, 'b6': 8, '6': 9, 'b7': 10, '7': 11,
};
const SEMI_DEGREE = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

export const PENTATONIC = ['1', '2', '3', '5', '6'];       // always-right notes
export const TENSION = ['4', '7'];                          // tension notes
export const DIATONIC = ['1', '2', '3', '4', '5', '6', '7'];

const mod12 = (n) => ((n % 12) + 12) % 12;

export function keyPc(key) {
  if (!(key in KEY_PC)) throw new Error('Unknown key ' + key);
  return KEY_PC[key];
}

export function degreeSemis(deg) {
  if (!(deg in DEGREE_SEMIS)) throw new Error('Unknown degree ' + deg);
  return DEGREE_SEMIS[deg];
}

export function semisToDegree(semis) {
  return SEMI_DEGREE[mod12(semis)];
}

/** Pitch class (0-11) of a scale degree in a key. */
export function degreePc(key, deg) {
  return mod12(keyPc(key) + degreeSemis(deg));
}

/** Correct note spelling for a degree in a key, ASCII (e.g. "Bb", "F#"). */
export function spell(key, deg) {
  const num = parseInt(deg.replace(/[#b]/g, ''), 10);
  const letterIdx = (LETTERS.indexOf(key[0]) + num - 1) % 7;
  const letter = LETTERS[letterIdx];
  const diff = mod12(degreePc(key, deg) - LETTER_PC[letter]);
  const acc = { 0: '', 1: '#', 2: '##', 11: 'b', 10: 'bb' }[diff];
  return letter + acc;
}

/** Pretty print an ASCII note or chord name with real flat/sharp glyphs. */
export function pretty(s) {
  return String(s).replace(/([A-G1-7])##/g, '$1𝄪').replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯')
    .replace(/(^|[^A-Za-z])b(?=[1-7])/g, '$1♭').replace(/(^|[^A-Za-z])#(?=[1-7])/g, '$1♯');
}

/** Note name for a MIDI number, spelled in the key (falls back to key's flat/sharp preference). */
export function midiName(key, midi) {
  return spell(key, semisToDegree(midi - keyPc(key)));
}

export function midiDegree(key, midi) {
  return semisToDegree(midi - keyPc(key));
}

// ---------- chords ----------

const QUALITY_INTERVALS = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7],
};
const DIATONIC_QUALITY = { '1': 'maj', '2': 'min', '3': 'min', '4': 'maj', '5': 'maj', '6': 'min', '7': 'dim' };

/** Build a chord object from a key-relative root degree. */
export function makeChord(root, quality, bass = null, ext = '') {
  quality = quality || DIATONIC_QUALITY[root] || 'maj';
  const rootSemis = degreeSemis(root);
  const tones = QUALITY_INTERVALS[quality].map((i) => semisToDegree(rootSemis + i));
  if (bass && !tones.includes(bass)) tones.push(bass);
  return { root, quality, bass, ext, tones, label: chordLabel({ root, quality, bass, ext }) };
}

/** Nashville label, e.g. "6m", "4sus", "1/3". */
export function chordLabel({ root, quality, bass, ext }) {
  let q = '';
  const diatonic = DIATONIC_QUALITY[root];
  if (quality === 'min') q = 'm';
  else if (quality === 'maj') q = diatonic === 'min' || diatonic === 'dim' ? 'maj' : '';
  else if (quality === 'dim') q = '°';
  else if (quality === 'aug') q = '+';
  else if (quality === 'sus4') q = 'sus';
  else if (quality === 'sus2') q = 'sus2';
  return root + q + (ext || '') + (bass ? '/' + bass : '');
}

/** Chord name in a key, e.g. "Dm", "Bb", "C/E" (ASCII). */
export function chordName(key, chord) {
  const q = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus4: 'sus', sus2: 'sus2' }[chord.quality];
  return spell(key, chord.root) + q + (chord.ext || '') + (chord.bass ? '/' + spell(key, chord.bass) : '');
}

function parseQuality(rest) {
  // returns { quality, ext } from a suffix such as "m", "-", "sus", "sus2", "maj7", "m7", "2", "add9"
  let s = rest.trim();
  let quality = null;
  let ext = '';
  if (/^(maj|M)(?![a-z])/.test(s) && !/^maj7|^maj9/.test(s)) { quality = 'maj'; s = s.replace(/^(maj|M)/, ''); }
  if (/^(min|m(?!aj)|-)/.test(s)) { quality = 'min'; s = s.replace(/^(min|m|-)/, ''); }
  else if (/^(dim|°|o(?![a-z]))/.test(s)) { quality = 'dim'; s = s.replace(/^(dim|°|o)/, ''); }
  else if (/^(aug|\+)/.test(s)) { quality = 'aug'; s = s.replace(/^(aug|\+)/, ''); }
  if (/sus\s*2/.test(s)) { quality = 'sus2'; s = s.replace(/sus\s*2/, ''); }
  else if (/sus\s*4?/.test(s)) { quality = 'sus4'; s = s.replace(/sus\s*4?/, ''); }
  if (s === '2' && quality === null) { quality = 'sus2'; s = ''; }
  ext = s.replace(/[()]/g, '');
  if (ext && !/^(maj7|maj9|7|9|11|13|6|add9|add2|add4|add11|5)$/.test(ext)) throw new Error('bad suffix');
  return { quality, ext };
}

function parseDegreeToken(tok) {
  const m = tok.match(/^([b#♭♯]?)([1-7])(.*)$/);
  if (!m) return null;
  const acc = m[1].replace('♭', 'b').replace('♯', '#');
  let root = acc + m[2];
  if (!(root in DEGREE_SEMIS)) root = semisToDegree(degreeSemis(m[2]) + (acc === 'b' ? -1 : 1));
  return { root, rest: m[3] };
}

function parseNameRoot(key, tok) {
  const m = tok.match(/^([A-Ga-g])([#b♯♭]?)(.*)$/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2].replace('♭', 'b').replace('♯', '#');
  const pc = mod12(LETTER_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0));
  return { root: semisToDegree(pc - keyPc(key)), rest: m[3] };
}

function looksLikeName(tok) {
  return /^[A-G]/.test(tok) || (/^[a-g]/.test(tok) && !/^b[1-7]/.test(tok));
}

/** Parse one chord token (number or chord name) in a key. */
export function parseChord(key, token) {
  const tok = token.trim();
  const [main, bassTok] = tok.split('/');
  const isName = looksLikeName(main);
  const head = isName ? parseNameRoot(key, main) : parseDegreeToken(main);
  if (!head) throw new Error(`Can't read "${token}"`);
  let q;
  try { q = parseQuality(head.rest); } catch { throw new Error(`Can't read "${token}"`); }
  let bass = null;
  if (bassTok) {
    const b = looksLikeName(bassTok) ? parseNameRoot(key, bassTok) : parseDegreeToken(bassTok);
    if (!b || b.rest) throw new Error(`Can't read bass note in "${token}"`);
    bass = b.root;
  }
  let quality = q.quality;
  if (!quality) quality = isName ? 'maj' : DIATONIC_QUALITY[head.root] || 'maj';
  return makeChord(head.root, quality, bass, q.ext);
}

/** Split a progression string into tokens: "1 5 6m 4", "F C Dm Bb", "1–5–6m–4", "1-5-6m-4". */
export function tokenize(text) {
  return String(text)
    .split(/[\s,|–—]+|-(?=[0-9A-Gb#♭♯])/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Parse a whole progression; returns { chords, numbers, format } or throws with a friendly message. */
export function parseProgression(key, text) {
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error('Enter some chords, e.g. 1 5 6m 4 or F C Dm Bb');
  if (tokens.length > 16) throw new Error('Keep it to 16 chords or fewer');
  const chords = tokens.map((t) => parseChord(key, t));
  const names = tokens.map(looksLikeName);
  const format = names.every(Boolean) ? 'names' : names.some(Boolean) ? 'mixed' : 'numbers';
  return { chords, numbers: chords.map((c) => c.label).join(' '), format };
}

export const PRESETS = [
  { id: 'p1', label: '1–5–6m–4', text: '1 5 6m 4' },
  { id: 'p2', label: '1–4–6m–5', text: '1 4 6m 5' },
  { id: 'p3', label: '6m–4–1–5', text: '6m 4 1 5' },
  { id: 'p4', label: '1–4 vamp', text: '1 4' },
  { id: 'p5', label: '4–5–6m', text: '4 5 6m' },
];

// ---------- colors, intervals, fit ----------

// Allowed non-chord tones per chord (by diatonic root + quality), with how they feel.
// tension: true means a 4 or 7 that must be long, soft, and resolve on the chord change.
const COLOR_TABLE = {
  '1:maj': [
    { deg: '2', feel: 'open, waiting' },
    { deg: '6', feel: 'sweet' },
    { deg: '4', feel: 'ache (sus)', resolve: '3', tension: true },
    { deg: '7', feel: 'longing', resolve: '1', tension: true },
  ],
  '4:maj': [
    { deg: '5', feel: 'the 9th, lifts' },
    { deg: '3', feel: 'maj7, tender' },
    { deg: '2', feel: 'the 6th, warm' },
    { deg: '7', feel: 'wonder (Lydian)', resolve: '1', tension: true },
  ],
  '5:maj': [
    { deg: '1', feel: 'sus, suspended' },
    { deg: '4', feel: 'pull home (Mixolydian)', resolve: '3', tension: true },
  ],
  '6:min': [
    { deg: '5', feel: 'm7, soft' },
    { deg: '7', feel: 'the 9th, wistful' },
    { deg: '2', feel: 'the 11th, open' },
    { deg: '4', feel: 'lament', resolve: '3', tension: true },
  ],
  '2:min': [
    { deg: '1', feel: 'm7, soft' },
    { deg: '5', feel: 'the 11th, open' },
  ],
  '3:min': [
    { deg: '2', feel: 'm7, soft' },
    { deg: '6', feel: 'the 11th, open' },
  ],
  '4:min': [
    { deg: '5', feel: 'the 9th, dark lift' },
  ],
  'b7:maj': [
    { deg: '1', feel: 'the 9th, bright' },
    { deg: '5', feel: 'the 6th, warm' },
  ],
  'b6:maj': [
    { deg: 'b7', feel: 'the 9th, cinematic' },
    { deg: '5', feel: 'maj7, glowing' },
  ],
};

/** Colors for a chord (non-chord tones that are allowed over it). */
export function colorsFor(chord) {
  let quality = chord.quality;
  let list;
  if (quality === 'sus4' || quality === 'sus2') {
    const baseQ = DIATONIC_QUALITY[chord.root] || 'maj';
    list = COLOR_TABLE[chord.root + ':' + baseQ] || [];
    const third = semisToDegree(degreeSemis(chord.root) + (baseQ === 'min' ? 3 : 4));
    list = list.filter((c) => c.deg !== third);
  } else {
    list = COLOR_TABLE[chord.root + ':' + quality] || [];
  }
  return list.filter((c) => !chord.tones.includes(c.deg)).map((c) => ({ ...c, tension: !!c.tension }));
}

const INTERVAL_TONE = { 0: 'the root', 3: 'the minor 3rd', 4: 'the 3rd', 5: 'the 4th (sus)', 2: 'the 2nd (sus)', 6: 'the b5', 7: 'the 5th', 8: 'the #5' };
const INTERVAL_EXT = { 1: 'the b9', 2: 'the 9th', 3: 'the #9', 4: 'the 3rd', 5: 'the 11th', 6: 'the #11', 7: 'the 5th', 8: 'the b6', 9: 'the 6th', 10: 'the b7', 11: 'the maj7', 0: 'the root' };

/** Interval name of a degree over a chord, e.g. "the 9th". */
export function intervalName(deg, chord) {
  const semis = mod12(degreeSemis(deg) - degreeSemis(chord.root));
  if (chord.tones.includes(deg)) {
    if (chord.bass === deg && !QUALITY_INTERVALS[chord.quality].includes(semis)) return 'the bass note';
    return INTERVAL_TONE[semis] || INTERVAL_EXT[semis];
  }
  if (chord.quality === 'min' && semis === 10) return 'the m7';
  return INTERVAL_EXT[semis];
}

/** Role of a degree over a chord: 'tone' | 'color' | 'tension' | 'outside'. */
export function roleOf(deg, chord) {
  if (chord.tones.includes(deg)) return 'tone';
  const c = colorsFor(chord).find((x) => x.deg === deg);
  if (!c) return 'outside';
  return c.tension ? 'tension' : 'color';
}

/** A note fits (for held notes) if it's a chord tone or a non-tension color. */
export function fits(deg, chord) {
  const r = roleOf(deg, chord);
  return r === 'tone' || r === 'color';
}

/** Forever-note candidates in the order to try: 5, then 2, then 3. */
export function foreverNotes(chords) {
  return ['5', '2', '3'].filter((d) => chords.every((c) => fits(d, c)));
}

/** "C over Bb = the 9th, lifts" style explanation. */
export function whyLine(key, deg, chord) {
  const note = spell(key, deg);
  const name = chordName(key, chord);
  const role = roleOf(deg, chord);
  const iv = intervalName(deg, chord);
  if (role === 'tone') return `${note} over ${name} = ${iv}, a chord tone. Always safe.`;
  const c = colorsFor(chord).find((x) => x.deg === deg);
  if (role === 'color') return `${note} over ${name} = ${iv}: ${c.feel}.`;
  if (role === 'tension') return `${note} over ${name} = ${iv}: ${c.feel}. Long and soft, then resolve.`;
  return `${note} over ${name} = ${iv}: a passing note. Keep it short.`;
}

// ---------- feels and accents ----------

export const FEELS = [
  { id: 'rest', name: 'Rest / Peace', dir: 'down', blurb: 'No tension. Forever notes, lots of space.' },
  { id: 'awe', name: 'Awe / Wonder', dir: 'up', blurb: 'The 7 over the 4 chord: Lydian wonder.' },
  { id: 'lament', name: 'Surrender / Lament', dir: 'down', blurb: 'The 4 over 6m, sighing down to the 3.' },
  { id: 'declaration', name: 'Declaration / Victory', dir: 'up', blurb: 'Pull home with the 4 over the 5 chord.' },
  { id: 'intimate', name: 'Intimate / Prayer', dir: 'down', blurb: 'No tension. Barely there. Forever notes.' },
  { id: 'hope', name: 'Hope / Building', dir: 'up', blurb: 'Rising chord tones that land on the 3.' },
];

export function feelById(id) {
  return FEELS.find((f) => f.id === id) || FEELS[0];
}

/**
 * Accent options for a feel over a progression. Each:
 * { at: chordIndex, deg, resolve, resolveAt, overChord?, note, rehearse? , hold? , run? }
 */
export function accentsFor(feelId, chords) {
  const out = [];
  const n = chords.length;
  const next = (i) => (i + 1) % n;
  const is = (c, root, q) => c.root === root && (!q || c.quality === q || (q === 'maj' && c.quality.startsWith('sus')));
  chords.forEach((c, i) => {
    const nc = chords[next(i)];
    if (feelId === 'awe' && is(c, '4', 'maj')) {
      if (n > 1 && fits('1', nc)) out.push({ at: i, deg: '7', resolve: '1', resolveAt: next(i), text: '7 over the 4 chord → resolve to 1' });
      out.push({ at: i, deg: '7', hold: true, text: '7 over the 4 chord, just hold it and let it float' });
    }
    if (feelId === 'lament') {
      if (is(c, '6', 'min') && n > 1 && fits('3', nc)) out.push({ at: i, deg: '4', resolve: '3', resolveAt: next(i), text: '4 over 6m → resolve to 3' });
      if (is(c, '4', 'maj') && n > 1 && fits('5', nc)) out.push({ at: i, deg: 'b6', resolve: '5', resolveAt: next(i), borrowed: true, rehearse: true, text: 'Borrowed b6 over the 4 chord (as 4m) → resolve to 5. Rehearse with keys first.' });
    }
    if (feelId === 'declaration') {
      if (is(c, '5', 'maj') && n > 1 && fits('3', nc)) out.push({ at: i, deg: '4', resolve: '3', resolveAt: next(i), text: nc.root === '1' ? '4 over the 5 chord → resolve to 3 when the 1 returns' : '4 over the 5 chord → resolve to 3 on the next chord', prefer: nc.root === '1' });
      if (is(c, '1', 'maj') && n > 1 && nc.root === '4') out.push({ at: i, deg: 'b7', resolve: '6', resolveAt: next(i), borrowed: true, text: 'b7 over the 1 chord → resolve to 6 on the 4 chord' });
    }
  });
  if (feelId === 'hope') {
    // rising pickup run 5–6–1–2 into a 3 on a chord where 3 fits (prefer the 1 chord)
    let land = chords.findIndex((c) => c.root === '1' && fits('3', c));
    if (land < 0) land = chords.findIndex((c) => fits('3', c));
    if (land >= 0 && n > 1) {
      const runAt = (land - 1 + n) % n;
      out.push({ at: runAt, run: ['5', '6', '1', '2'], deg: '2', resolve: '3', resolveAt: land, text: 'Rising 5–6–1–2 pickup that lands on the 3' });
    }
  }
  out.sort((a, b) => (b.prefer ? 1 : 0) - (a.prefer ? 1 : 0));
  return out;
}

/** Chord used to explain an accent note (b6 over 4 means the chord becomes 4m). */
export function accentChord(acc, chord) {
  if (acc.deg === 'b6' && chord.root === '4') return makeChord('4', 'min');
  return chord;
}

// ---------- intensity ----------

export const INTENSITY = {
  1: { name: 'Intimate / prayer', notes: 'Swells or silence. 0–1 notes per 4 bars.', gens: ['forever'] },
  2: { name: 'Low spontaneous singing', notes: '1–3 notes per 4 bars.', gens: ['forever', 'stepping', 'sigh', 'accent'] },
  3: { name: 'Room singing / opening up', notes: 'One long note per chord.', gens: ['stepping', 'hymn', 'echo', 'accent', 'forever', 'sigh'] },
  4: { name: 'Building', notes: 'A short phrase every 2 bars. Rising lines, climbing 6ths, octaves.', gens: ['rising', 'hymnClimb', 'octaves', 'phrase', 'accent'] },
  5: { name: 'Peak', notes: 'Double the melody or hold a sustained top line.', gens: ['topline', 'octaves', 'hymnClimb', 'rising'] },
};

/** Home Box: minor pentatonic box starting 3 frets below the root on the low E string. */
export function homeBoxFret(key) {
  let f = mod12(keyPc(key) - 4) - 3;
  if (f < 0) f += 12;
  return f;
}

/** Root fret on the B string for the Sky Shape, picked so the shape sits nearest frets 10–17. */
export function skyRootFret(key) {
  const r = mod12(keyPc(key) - 11);
  const options = [r, r + 12].filter((R) => R >= 1 && R + 5 <= 22);
  return options.sort((a, b) => Math.abs(a + 2 - 13.5) - Math.abs(b + 2 - 13.5))[0];
}

/** Sky Shape positions: [{string, fret, deg}] around R on the B string. */
export function skyShape(key) {
  const R = skyRootFret(key);
  return [
    { string: 5, fret: R - 1, deg: '3' }, { string: 5, fret: R, deg: '4' }, { string: 5, fret: R + 2, deg: '5' }, { string: 5, fret: R + 4, deg: '6' },
    { string: 4, fret: R, deg: '1' }, { string: 4, fret: R + 2, deg: '2' }, { string: 4, fret: R + 4, deg: '3' }, { string: 4, fret: R + 5, deg: '4' },
    { string: 3, fret: R - 1, deg: '5' }, { string: 3, fret: R + 1, deg: '6' }, { string: 3, fret: R + 3, deg: '7' }, { string: 3, fret: R + 4, deg: '1' },
  ];
}
