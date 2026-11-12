// Line generators. Each builds a skeleton (degrees + MIDI per event), then finalize() fingers it,
// writes the "why it works" lines, numbers, note names and tab.

import {
  spell, pretty, degreePc, degreeSemis, keyPc, fits, roleOf, foreverNotes, whyLine, accentsFor,
  accentChord, feelById, INTENSITY, DIATONIC, PENTATONIC, chordName, parseProgression, makeChord,
} from './theory.js';
import { playZone, fingerLine, midisInRange, tabText, positions } from './fretboard.js';

export function rng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the generation context from user settings. */
export function makeContext(s) {
  const key = s.key || 'F';
  const chords = s.chords || parseProgression(key, s.progression || '1 5 6m 4').chords;
  const band = s.band || { vocal: 'male', keys: 'pads', acoustic: true, bass: true };
  const capo = s.capo || 0;
  const zone = playZone(band, capo);
  return {
    key, chords, band, capo, zone,
    feel: s.feel || 'rest',
    intensity: s.intensity || 2,
    keysMelody: band.keys === 'melody',
  };
}

// ---------- helpers ----------

const pcOf = (ctx, deg) => degreePc(ctx.key, deg);
const midiCands = (ctx, deg, lo, hi) => midisInRange(pcOf(ctx, deg), lo, hi);
const heldDegrees = (chord) => ['1', '2', '3', '4', '5', '6', '7', 'b7', 'b6', 'b3', '#4', 'b2'].filter((d) => fits(d, chord));
const toneDegrees = (chord) => chord.tones.slice();

function note(deg, midi, extra = {}) {
  return { deg, midi, ...extra };
}

function slot(i, chord, events, extra = {}) {
  return { chordIndex: i, chord, events, ...extra };
}

function ev(at, len, notes, extra = {}) {
  return { at, len, notes, ...extra };
}

/** Choose the next note: nearest fitting degree strictly in a direction from prev. */
function stepTo(ctx, chord, prev, dir, { tonesOnly = false, lo, hi, r = null, colorCost = 0.6 } = {}) {
  const degs = tonesOnly ? toneDegrees(chord) : heldDegrees(chord);
  let cands = [];
  for (const d of degs) for (const m of midiCands(ctx, d, lo, hi)) cands.push({ deg: d, midi: m, role: roleOf(d, chord) });
  const dirOk = (c) => (dir === 'down' ? c.midi < prev : dir === 'up' ? c.midi > prev : true);
  let pool = cands.filter(dirOk);
  if (!pool.length) pool = cands.filter((c) => c.midi !== prev);
  if (!pool.length) return null;
  const score = (c) => Math.abs(c.midi - prev) + (c.role === 'tone' ? 0 : colorCost) + (r ? r() * 2.5 : 0);
  pool.sort((a, b) => score(a) - score(b));
  return pool[0];
}

function startNote(ctx, chord, dir, variant, { tonesOnly = true, lo, hi } = {}) {
  const degs = tonesOnly ? toneDegrees(chord) : heldDegrees(chord);
  const cands = [];
  for (const d of degs) for (const m of midiCands(ctx, d, lo, hi)) cands.push({ deg: d, midi: m });
  cands.sort((a, b) => (dir === 'down' ? b.midi - a.midi : a.midi - b.midi));
  return cands[variant % Math.min(3, cands.length)] || cands[0];
}

// ---------- generators ----------

const GEN = {};

GEN.forever = (ctx, v = 0, opts = {}) => {
  const degs = foreverNotes(ctx.chords);
  if (!degs.length) return null;
  const deg = degs[v % degs.length];
  const octaveShift = Math.floor(v / degs.length) % 2;
  const cands = midiCands(ctx, deg, ctx.zone.lo, ctx.zone.hi + 3);
  if (!cands.length) return null;
  // best octave: the one that sits closest to the middle of the window
  const mid = (ctx.zone.lo + ctx.zone.hi) / 2;
  cands.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  const midi = cands[Math.min(octaveShift, cands.length - 1)];
  const tie = opts.tie || ctx.intensity === 1;
  return {
    type: opts.type || 'forever',
    name: opts.name || 'Forever Note',
    when: opts.when || (deg === '5'
      ? 'One note that fits every chord. Swell it in and let the song move underneath it.'
      : `The ${deg} fits every chord here. Hold it and let the harmony change around you.`),
    tips: tie ? ['Swell in with the volume knob', 'Hold across all the chords', 'Let it fade to silence'] : ['Swell in on each chord', 'Slow, wide vibrato', 'Let it ring'],
    slots: ctx.chords.map((c, i) => slot(i, c, [ev(0, 1, [note(deg, midi, { tie: tie && i > 0, swell: true })])])),
  };
};

GEN.pedalSwell = (ctx, v = 0) => GEN.forever(ctx, v, {
  type: 'pedalSwell', tie: true, name: 'Pedal Swell',
  when: 'Keys has the melody: one pedal tone, swelled once and held under everything.',
});

GEN.stepping = (ctx, v = 0, opts = {}) => {
  const dir = opts.dir || feelById(ctx.feel).dir;
  const r = v ? rng(v * 31 + 7) : null;
  const { lo, hi } = ctx.zone;
  const first = startNote(ctx, ctx.chords[0], dir, v, { lo, hi });
  if (!first) return null;
  const notes = [first];
  for (let i = 1; i < ctx.chords.length; i++) {
    const n = stepTo(ctx, ctx.chords[i], notes[i - 1].midi, dir, { lo: lo - 5, hi: hi + 3, r });
    if (!n) return null;
    notes.push(n);
  }
  return {
    type: opts.type || 'stepping',
    name: opts.name || (dir === 'down' ? 'Stepping Line (down)' : 'Stepping Line (up)'),
    when: opts.when || (dir === 'down'
      ? 'One long note per chord, each a step lower. It settles the room.'
      : 'One long note per chord, each a step higher. It lifts the room.'),
    tips: ['Swell in on each chord change', 'Slow, wide vibrato', 'Let each note ring into the next'],
    slots: ctx.chords.map((c, i) => slot(i, c, [ev(0, 1, [note(notes[i].deg, notes[i].midi, { swell: true })])])),
  };
};

GEN.sigh = (ctx, v = 0) => {
  const dir = v % 2 ? 'up' : 'down';
  const r = v > 1 ? rng(v * 17 + 3) : null;
  const { lo, hi } = ctx.zone;
  const first = startNote(ctx, ctx.chords[0], dir, Math.floor(v / 2), { lo, hi });
  if (!first) return null;
  const targets = [first];
  for (let i = 1; i < ctx.chords.length; i++) {
    const n = stepTo(ctx, ctx.chords[i], targets[i - 1].midi, dir, { tonesOnly: true, lo: lo - 3, hi: hi + 2, r });
    if (!n) return null;
    targets.push(n);
  }
  const slots = ctx.chords.map((c, i) => {
    const t = targets[i];
    const idx = DIATONIC.indexOf(t.deg);
    if (idx < 0) return slot(i, c, [ev(0, 1, [note(t.deg, t.midi)])]);
    const fromDeg = DIATONIC[(idx + 6) % 7];
    const gap = (((degreeSemis(t.deg) - degreeSemis(fromDeg)) % 12) + 12) % 12;
    return slot(i, c, [ev(0, 1, [note(t.deg, t.midi, { slideFrom: { deg: fromDeg, midi: t.midi - gap } })])]);
  });
  return {
    type: 'sigh', name: 'Sigh Up',
    when: 'On each chord, slide up a step into a chord tone. It sounds like a breath out.',
    tips: ['Slide in slowly from the step below', 'Land and add slow vibrato', 'Soft attack, roll the volume in'],
    slots,
  };
};

function hymnPairs(ctx, chord) {
  const pairs = [];
  for (const lowDeg of chord.tones) {
    const i = DIATONIC.indexOf(lowDeg);
    if (i < 0) continue;
    const upDeg = DIATONIC[(i + 5) % 7];
    if (!chord.tones.includes(upDeg)) continue;
    const gap = (((degreeSemis(upDeg) - degreeSemis(lowDeg)) % 12) + 12) % 12; // 8 or 9
    for (let gf = Math.max(0, ctx.capo); gf <= 22; gf++) {
      const low = 55 + gf;
      if (((low % 12) + 12) % 12 !== pcOf(ctx, lowDeg)) continue;
      const up = low + gap;
      const ef = up - 64;
      if (ef < ctx.capo || ef > 22) continue;
      pairs.push({ lowDeg, upDeg, low, up, gf, ef });
    }
  }
  return pairs.sort((a, b) => a.low - b.low);
}

GEN.hymn = (ctx, v = 0, opts = {}) => {
  const mode = opts.mode || 'near';
  const all = ctx.chords.map((c) => hymnPairs(ctx, c));
  if (all.some((p) => !p.length)) return null;
  const minF = Math.max(5, ctx.capo + 1);
  const chosen = [];
  if (mode === 'climb') {
    const start = all[0].filter((p) => p.gf >= minF);
    let cur = start[v % Math.min(2, start.length)] || start[0];
    if (!cur) return null;
    chosen.push(cur);
    for (let i = 1; i < all.length; i++) {
      // nearest pair above (within a 5th); else hold the same pair if it still fits; else the nearest above
      let next = all[i].find((p) => p.low > cur.low && p.low - cur.low <= 7 && p.gf <= 19)
        || all[i].find((p) => p.low === cur.low)
        || all[i].find((p) => p.low > cur.low && p.gf <= 19)
        || all[i].find((p) => p.gf >= minF);
      if (!next) return null;
      chosen.push(next);
      cur = next;
    }
  } else {
    const center = (ctx.zone.win[0] + ctx.zone.win[1]) / 2 + (v % 3 === 1 ? -4 : v % 3 === 2 ? 3 : 0);
    const start = all[0].slice().sort((a, b) => Math.abs(a.gf - center) - Math.abs(b.gf - center))[0];
    chosen.push(start);
    for (let i = 1; i < all.length; i++) {
      const prev = chosen[i - 1];
      const next = all[i].slice().sort((a, b) => Math.abs(a.gf - prev.gf) - Math.abs(b.gf - prev.gf) || b.low - a.low)[0];
      chosen.push(next);
    }
  }
  return {
    type: mode === 'climb' ? 'hymnClimb' : 'hymn',
    name: mode === 'climb' ? 'Hymn 6ths (climbing)' : 'Hymn 6ths',
    when: mode === 'climb'
      ? 'Two-note 6ths that climb up the neck with every chord. Builds without getting louder.'
      : 'Two-note 6ths on the G and high E strings. Sounds like a hymn harmony part.',
    tips: ['Pick the G string, fingerpick the high E', 'Mute the B string with the side of your finger', 'Slide between shapes'],
    fixedStrings: [3, 5],
    slots: ctx.chords.map((c, i) => slot(i, c, [ev(0, 1, [note(chosen[i].lowDeg, chosen[i].low), note(chosen[i].upDeg, chosen[i].up)], { mute: [4] })])),
  };
};
GEN.hymnClimb = (ctx, v = 0) => GEN.hymn(ctx, v, { mode: 'climb' });

GEN.accent = (ctx, v = 0) => {
  const accents = accentsFor(ctx.feel, ctx.chords);
  if (!accents.length) return null;
  const acc = accents[v % accents.length];
  const base = GEN.forever(ctx, 0) || GEN.stepping(ctx, 0);
  if (!base) return null;
  const slots = base.slots.map((s) => ({ ...s, events: s.events.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n, tie: false })) })) }));
  const baseMidi = slots[acc.at].events[0].notes[0].midi;
  const nearest = (deg, target) => midiCands(ctx, deg, target - 7, target + 7).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  const chordAt = ctx.chords[acc.at];
  const explainChord = accentChord(acc, chordAt);
  let tensionMidi;
  if (acc.run) {
    // rising 5-6-1-2 pickup, quarter notes, then land on 3
    let m = nearest(acc.run[0], baseMidi - 4);
    const events = acc.run.map((d, k) => {
      if (k > 0) m = midisInRange(pcOf(ctx, d), m + 1, m + 12)[0];
      return ev(k * 0.25, 0.25, [note(d, m, { passing: !fits(d, chordAt) })]);
    });
    tensionMidi = m;
    slots[acc.at] = slot(acc.at, chordAt, events, { accent: true });
  } else {
    tensionMidi = nearest(acc.deg, baseMidi);
    slots[acc.at] = slot(acc.at, chordAt, [ev(0, 1, [note(acc.deg, tensionMidi, { tension: true, soft: true, swell: true })])], { accent: true, explainChord });
  }
  if (!acc.hold) {
    const resMidi = nearest(acc.resolve, tensionMidi);
    slots[acc.resolveAt] = slot(acc.resolveAt, ctx.chords[acc.resolveAt], [ev(0, 1, [note(acc.resolve, resMidi, { resolution: true })])], { resolves: true });
  }
  return {
    type: 'accent',
    name: `Accent: ${feelById(ctx.feel).name.split(' / ')[0]}`,
    when: acc.text + '. Use it once, then go back to forever notes.',
    tips: acc.run ? ['Pick each note of the run lightly', 'Land on the 3 with a big, slow vibrato'] : ['Tension note: long and soft', 'Resolve exactly on the chord change', 'Swell in, no hard pick attack'],
    warn: acc.rehearse ? 'Rehearse with keys first: they need to play the 4 chord as 4m.' : null,
    slots,
  };
};

const PENT_ORDER = ['1', '2', '3', '5', '6'];
function pentNeighbor(ctx, midi, steps) {
  // walk the major pentatonic up/down by n steps from a midi note
  const pcs = PENT_ORDER.map((d) => pcOf(ctx, d));
  let m = midi;
  const dir = Math.sign(steps);
  for (let k = 0; k < Math.abs(steps); k++) {
    do { m += dir; } while (!pcs.includes(((m % 12) + 12) % 12));
  }
  return m;
}
const MOTIFS = [[-2, -1, 0], [2, 1, 0], [-1, 1, 0], [1, -1, 0]];

GEN.echo = (ctx, v = 0) => {
  const motif = MOTIFS[v % MOTIFS.length];
  const { lo, hi } = ctx.zone;
  const lift = ctx.keysMelody ? 0 : 0;
  let prev = null;
  const slots = ctx.chords.map((c, i) => {
    const tones = toneDegrees(c).filter((d) => PENTATONIC.includes(d));
    const anchorDegs = tones.length ? tones : toneDegrees(c);
    let best = null;
    for (const d of anchorDegs) for (const m of midiCands(ctx, d, lo + 2 + lift, hi - 2)) {
      const sc = prev == null ? Math.abs(m - (lo + hi) / 2) : Math.abs(m - prev);
      if (!best || sc < best.sc) best = { deg: d, midi: m, sc };
    }
    if (!best) return null;
    prev = best.midi;
    const midis = motif.map((s) => pentNeighbor(ctx, best.midi, s));
    const notes = midis.map((m) => {
      const deg = PENT_ORDER.find((d) => pcOf(ctx, d) === ((m % 12) + 12) % 12) || best.deg;
      return note(deg, m);
    });
    return slot(i, c, [
      ev(0.5, 0.125, [notes[0]]), ev(0.625, 0.125, [notes[1]]), ev(0.75, 0.25, [{ ...notes[2], deg: best.deg, midi: best.midi }]),
    ], { gapOnly: true });
  });
  if (slots.some((s) => !s)) return null;
  return {
    type: 'echo',
    name: ctx.keysMelody ? 'Answer Phrase' : 'Echo Motif',
    when: ctx.keysMelody
      ? 'A tiny 3-note answer, up high, only after the keys finish a phrase. Never overlap them.'
      : 'A 3-note motif in the gaps, after the leader sings a line. Silence while they sing.',
    tips: ['Only play in the gaps', 'Same shape every time, so it feels like a hook', 'Let the last note ring'],
    slots,
  };
};

GEN.rising = (ctx, v = 0) => {
  const r = v ? rng(v * 13 + 5) : null;
  const lo = ctx.zone.lo - 3, hi = ctx.zone.hi + 3;
  const first = startNote(ctx, ctx.chords[0], 'up', v, { lo, hi: lo + 12 });
  if (!first) return null;
  let prev = first.midi;
  const slots = ctx.chords.map((c, i) => {
    const a = i === 0 ? first : stepTo(ctx, c, prev, 'up', { tonesOnly: true, lo, hi, r });
    if (!a) return null;
    const b = stepTo(ctx, c, a.midi, 'up', { tonesOnly: true, lo, hi: hi + 5, r });
    if (!b) return null;
    prev = a.midi;
    return slot(i, c, [ev(0, 0.5, [note(a.deg, a.midi)]), ev(0.5, 0.5, [note(b.deg, b.midi)])]);
  });
  if (slots.some((s) => !s)) return null;
  return {
    type: 'rising', name: 'Rising Line',
    when: 'Two chord tones per chord, always climbing. Use it as the room builds.',
    tips: ['Slide up into the second note', 'Vibrato on the top note', 'Grow the volume with each chord'],
    slots,
  };
};

GEN.octaves = (ctx, v = 0) => {
  // stepping line on the G string doubled on the high E (G fret f, e fret f+3), B string muted
  const r = v ? rng(v * 19 + 11) : null;
  const lo = 55 + Math.max(5, ctx.capo + 1), hi = 55 + 15;
  const first = startNote(ctx, ctx.chords[0], 'up', v, { lo, hi: lo + 7 });
  if (!first) return null;
  const lows = [first];
  for (let i = 1; i < ctx.chords.length; i++) {
    const n = stepTo(ctx, ctx.chords[i], lows[i - 1].midi, 'up', { tonesOnly: true, lo, hi, r });
    if (!n) return null;
    lows.push(n);
  }
  return {
    type: 'octaves', name: 'Octaves',
    when: 'Each note doubled an octave up. Big and clear without being busy.',
    tips: ['G string + high E string, 3 frets apart', 'Mute the B string with your first finger', 'Slide into each octave'],
    fixedStrings: [3, 5],
    slots: ctx.chords.map((c, i) => slot(i, c, [ev(0, 1, [note(lows[i].deg, lows[i].midi), note(lows[i].deg, lows[i].midi + 12)], { mute: [4] })])),
  };
};

GEN.phrase = (ctx, v = 0) => {
  const r = rng(v * 23 + 1);
  const { lo, hi } = ctx.zone;
  const longs = [];
  let prev = startNote(ctx, ctx.chords[0], 'up', v, { lo, hi: lo + 10 });
  if (!prev) return null;
  longs.push(prev);
  for (let i = 1; i < ctx.chords.length; i++) {
    const n = stepTo(ctx, ctx.chords[i], prev.midi, i % 2 ? 'up' : 'any', { tonesOnly: true, lo, hi, r });
    if (!n) return null;
    longs.push(n);
    prev = n;
  }
  const slots = ctx.chords.map((c, i) => {
    const events = [ev(0, i % 2 === 0 ? 0.5 : 1, [note(longs[i].deg, longs[i].midi)])];
    const nextTarget = longs[(i + 1) % longs.length];
    if (i % 2 === 0) {
      // 3 pentatonic notes walking up into the next chord's note
      const m3 = pentNeighbor(ctx, nextTarget.midi, -1);
      const m2 = pentNeighbor(ctx, nextTarget.midi, -2);
      const m1 = pentNeighbor(ctx, nextTarget.midi, -3);
      [m1, m2, m3].forEach((m, k) => {
        const deg = PENT_ORDER.find((d) => pcOf(ctx, d) === ((m % 12) + 12) % 12);
        events.push(ev(0.5 + k * 0.125, 0.125, [note(deg, m, { passing: !fits(deg, c) })]));
      });
    }
    return slot(i, c, events);
  });
  return {
    type: 'phrase', name: 'Two-Bar Phrase',
    when: 'A long note, then a short pentatonic pickup into the next chord, every 2 bars.',
    tips: ['Pickup notes light and even', 'Land on the long note with vibrato', 'Leave the other bar mostly open'],
    slots,
  };
};

GEN.topline = (ctx, v = 0) => {
  const r = v ? rng(v * 29 + 3) : null;
  const hi = ctx.zone.hi + 3, lo = ctx.zone.hi - 9;
  const first = startNote(ctx, ctx.chords[0], 'down', v, { lo, hi });
  if (!first) return null;
  const notes = [first];
  for (let i = 1; i < ctx.chords.length; i++) {
    const n = stepTo(ctx, ctx.chords[i], notes[i - 1].midi, 'any', { lo, hi, r, colorCost: 0.3 });
    if (!n) return null;
    notes.push(n);
  }
  return {
    type: 'topline', name: 'Sustained Top Line',
    when: 'The peak: hold the highest notes over the band. Or double the melody an octave up.',
    tips: ['Bring the volume up, add drive if you have it', 'Big, wide vibrato', 'Hold every note the full bar'],
    slots: ctx.chords.map((c, i) => slot(i, c, [ev(0, 1, [note(notes[i].deg, notes[i].midi)])])),
  };
};

export const GENERATORS = GEN;

// ---------- finalize ----------

const evLabel = (e, field) => {
  if (!e.notes.length) return '·';
  if (e.notes.length > 1) return e.notes.map((n) => n[field]).join('+');
  const n = e.notes[0];
  const from = n.slideFrom ? n.slideFrom[field] + '>' : '';
  return from + n[field];
};

/** Turn a skeleton into a full line: fingering, why, numbers, names, tab. */
export function finalize(ctx, line) {
  if (!line) return null;
  const groups = [];
  const refs = [];
  line.slots.forEach((s) => s.events.forEach((e) => { groups.push(e.notes.map((n) => n.midi)); refs.push(e); }));
  const fixed = line.fixedStrings ? groups.map(() => line.fixedStrings) : [];
  const fing = fingerLine(groups, ctx.zone, { capo: ctx.capo, fixed });
  if (!fing) return null;
  refs.forEach((e, i) => {
    e.notes.forEach((n, j) => {
      n.pos = fing[i][j];
      n.name = spell(ctx.key, n.deg);
      n.vib = e.len >= 0.5 && !n.tie;
      if (n.slideFrom) {
        n.slideFrom.name = spell(ctx.key, n.slideFrom.deg);
        const f = n.pos.fret - (n.midi - n.slideFrom.midi);
        n.slideFrom.pos = f >= ctx.capo ? { string: n.pos.string, fret: f, rel: f - ctx.capo } : null;
      }
    });
  });
  // why it works
  const why = [];
  const seen = new Set();
  line.slots.forEach((s) => {
    const chord = s.explainChord || s.chord;
    s.events.forEach((e) => e.notes.forEach((n) => {
      const k = n.deg + '|' + s.chordIndex;
      if (seen.has(k)) return;
      seen.add(k);
      let txt = whyLine(ctx.key, n.deg, chord);
      if (n.tension) {
        const res = line.slots.find((x) => x.resolves);
        txt = whyLine(ctx.key, n.deg, chord).replace('Long and soft, then resolve.', res ? `Long and soft, then resolve to ${res.events[0].notes[0].name} on ${chordName(ctx.key, res.chord)}.` : 'Long and soft. Just hold it.');
      } else if (n.resolution) {
        txt = 'Resolution: ' + txt;
      } else if (n.slideFrom) {
        txt = `Slide ${n.slideFrom.name} → ${n.name}: ` + txt;
      } else if (n.passing) {
        txt = whyLine(ctx.key, n.deg, chord);
      }
      why.push({ chordIndex: s.chordIndex, deg: n.deg, role: n.tension ? 'tension' : roleOf(n.deg, chord), text: txt });
    }));
  });
  line.why = why;
  line.numbers = line.slots.map((s) => (s.events.length ? s.events.map((e) => (e.notes[0]?.tie ? '(' + evLabel(e, 'deg') + ')' : evLabel(e, 'deg'))).join(' ') : '·')).join(' – ');
  line.names = line.slots.map((s) => (s.events.length ? s.events.map((e) => evLabel(e, 'name')).join(' ') : '·')).join(' – ');
  line.tab = tabText(line.slots.map((s) => ({
    events: s.events.map((e) => ({
      at: e.at,
      mute: e.mute,
      notes: e.notes.map((n) => ({ string: n.pos.string, rel: n.tie ? `(${n.pos.rel})` : n.pos.rel, slideFrom: n.slideFrom?.pos?.rel, vib: n.vib })),
    })),
  })));
  line.chordNames = line.slots.map((s) => chordName(ctx.key, s.explainChord || s.chord));
  line.signature = line.type + ':' + line.slots.map((s) => s.events.map((e) => e.notes.map((n) => n.midi + '@' + n.pos.string).join(',')).join(';')).join('|');
  line.id = line.signature;
  return line;
}

// ---------- ideas ----------

/** Which generators to use for this context, in order. */
export function generatorsFor(ctx) {
  if (ctx.keysMelody) return ['forever', 'pedalSwell', 'echo'];
  return INTENSITY[ctx.intensity]?.gens || INTENSITY[2].gens;
}

/**
 * 3–5 line ideas. round 0 = the canonical ideas, round > 0 = fresh variations ("Another idea").
 * taste: { [type]: weight } from hearts, used to rank.
 */
export function generateIdeas(settings, { round = 0, taste = {}, max = 5 } = {}) {
  const ctx = settings.zone ? settings : makeContext(settings);
  let gens = generatorsFor(ctx).slice();
  if (round === 0) gens.sort((a, b) => (gens.indexOf(a) - (taste[a] || 0) * 0.7) - (gens.indexOf(b) - (taste[b] || 0) * 0.7));
  const out = [];
  const seen = new Set();
  const tryAdd = (g, v, extra) => {
    if (out.length >= max) return;
    let raw;
    try { raw = extra ? GEN[g](ctx, v, extra) : GEN[g](ctx, v); } catch { raw = null; }
    const line = finalize(ctx, raw);
    if (!line || seen.has(line.signature)) return;
    seen.add(line.signature);
    out.push(line);
  };
  gens.forEach((g, i) => tryAdd(g, round + (round ? i : 0)));
  // top up to at least 3 with variants
  for (let v = round + 1; out.length < 3 && v < round + 12; v++) {
    for (const g of gens) { tryAdd(g, v); if (out.length >= 3) break; }
    if (!ctx.keysMelody && ctx.intensity > 1) {
      const dir = feelById(ctx.feel).dir === 'down' ? 'up' : 'down';
      tryAdd('stepping', v, { dir });
    }
  }
  return out;
}

/**
 * Regenerate a line, keeping locked slots (by chord index) exactly as they are.
 * Tries many variants of the same generator and keeps the smoothest fit around the locked notes.
 */
export function varyLine(settings, line, locks = [], seed = 1) {
  const ctx = settings.zone ? settings : makeContext(settings);
  const gen = GEN[line.type] || GEN.stepping;
  const lockSet = new Set(locks);
  const lockedAccent = line.slots.some((s, i) => lockSet.has(i) && (s.accent || s.resolves));
  const r = rng(seed * 97 + 13);
  let best = null;
  for (let v = 1; v <= 40; v++) {
    let cand;
    try { cand = gen(ctx, seed * 7 + v); } catch { cand = null; }
    if (!cand) continue;
    if (lockedAccent && cand.slots.some((s, i) => !lockSet.has(i) && (s.accent || s.resolves))) continue;
    const slots = cand.slots.map((s, i) => (lockSet.has(i) ? clone(line.slots[i]) : s));
    let cost = 0;
    let changed = 0;
    for (let i = 0; i < slots.length; i++) {
      const a = lastMidi(slots[i]);
      const b = firstMidi(slots[(i + 1) % slots.length]);
      if (lockSet.has(i) || lockSet.has((i + 1) % slots.length)) cost += Math.abs(a - b);
      if (!lockSet.has(i) && sig(slots[i]) !== sig(line.slots[i])) changed++;
    }
    if (!changed) continue;
    cost += r() * 4 - changed * 0.5;
    if (!best || cost < best.cost) best = { cost, cand: { ...cand, slots } };
  }
  if (!best) return null;
  const out = finalize(ctx, stripPositions(best.cand));
  return out;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const sig = (s) => s.events.map((e) => e.notes.map((n) => n.midi).join(',')).join(';');
const firstMidi = (s) => s.events[0]?.notes[0]?.midi ?? 0;
const lastMidi = (s) => { const e = s.events[s.events.length - 1]; return e?.notes[0]?.midi ?? 0; };
function stripPositions(line) {
  const l = clone(line);
  l.slots.forEach((s) => s.events.forEach((e) => e.notes.forEach((n) => { delete n.pos; if (n.slideFrom) delete n.slideFrom.pos; })));
  return l;
}

/** Text guidance for the current intensity (shown with every result). */
export function intensityGuide(intensity) {
  const g = INTENSITY[intensity] || INTENSITY[2];
  return { level: intensity, ...g };
}

export { pretty };
