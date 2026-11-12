import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spell, KEYS, homeBoxFret, parseProgression, fits, foreverNotes, chordName, makeChord, whyLine, skyShape, accentsFor, degreePc,
} from '../theory.js';
import { midiAt, playZone, tabText } from '../fretboard.js';
import { makeContext, GENERATORS, finalize, generateIdeas, varyLine } from '../lines.js';

const S = ['e', 'B', 'G'];
const strName = (s) => ['E', 'A', 'D', 'G', 'B', 'e'][s];
const frets = (line) => line.slots.map((s) => s.events[0].notes.map((n) => `${n.name}(${strName(n.pos.string)}${n.pos.fret})`).join('+'));

// ---------- spec test cases ----------

test('Home Box: key A starts at fret 2, key F at fret 10', () => {
  assert.equal(homeBoxFret('A'), 2);
  assert.equal(homeBoxFret('F'), 10);
});

test('Key F, 1–5–6m–4, Stepping line going down: A(e17) G(e15) F(e13) D(B15), 3–2–1–6', () => {
  const ctx = makeContext({ key: 'F', progression: '1 5 6m 4', feel: 'rest', intensity: 2 });
  const line = finalize(ctx, GENERATORS.stepping(ctx, 0, { dir: 'down' }));
  assert.deepEqual(frets(line), ['A(e17)', 'G(e15)', 'F(e13)', 'D(B15)']);
  assert.equal(line.numbers, '3 – 2 – 1 – 6');
  assert.equal(line.names, 'A – G – F – D');
});

test('Key F, 1–4–6m–5, Hymn 6ths climbing: 5/5, 7/6, 10/10, 12/12 (G fret / e fret)', () => {
  const ctx = makeContext({ key: 'F', progression: '1 4 6m 5', feel: 'hope', intensity: 4 });
  const line = finalize(ctx, GENERATORS.hymnClimb(ctx, 0));
  const pairs = line.slots.map((s) => {
    const n = s.events[0].notes;
    const g = n.find((x) => x.pos.string === 3).pos.fret;
    const e = n.find((x) => x.pos.string === 5).pos.fret;
    return `${g}/${e}`;
  });
  assert.deepEqual(pairs, ['5/5', '7/6', '10/10', '12/12']);
});

test('Key F, Forever Note: C at fret 13 on the B string', () => {
  const ctx = makeContext({ key: 'F', progression: '1 5 6m 4', feel: 'rest', intensity: 1 });
  const line = finalize(ctx, GENERATORS.forever(ctx, 0));
  const n = line.slots[0].events[0].notes[0];
  assert.equal(n.name, 'C');
  assert.equal(n.deg, '5');
  assert.equal(n.pos.string, 4);
  assert.equal(n.pos.fret, 13);
  assert.ok(line.slots.every((s) => s.events[0].notes[0].pos.fret === 13 && s.events[0].notes[0].pos.string === 4));
});

test('Key A: the 5 is E and the 2 is B, both pass the Forever check over A, D, E, F#m', () => {
  assert.equal(spell('A', '5'), 'E');
  assert.equal(spell('A', '2'), 'B');
  const { chords } = parseProgression('A', 'A D E F#m');
  assert.deepEqual(chords.map((c) => chordName('A', c)), ['A', 'D', 'E', 'F#m']);
  for (const c of chords) {
    assert.ok(fits('5', c), '5 over ' + c.label);
    assert.ok(fits('2', c), '2 over ' + c.label);
  }
  assert.deepEqual(foreverNotes(chords).slice(0, 2), ['5', '2']);
});

test('Chord names "F C Dm Bb" in key F convert to 1 5 6m 4', () => {
  const p = parseProgression('F', 'F C Dm Bb');
  assert.equal(p.numbers, '1 5 6m 4');
  assert.equal(p.format, 'names');
});

// ---------- extra coverage ----------

test('Spelling: flat keys use flats, sharp keys use sharps', () => {
  assert.deepEqual(['1', '2', '3', '4', '5', '6', '7'].map((d) => spell('F', d)), ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);
  assert.deepEqual(['1', '2', '3', '4', '5', '6', '7'].map((d) => spell('Eb', d)), ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D']);
  assert.deepEqual(['1', '2', '3', '4', '5', '6', '7'].map((d) => spell('B', d)), ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#']);
  assert.deepEqual(['1', '2', '3', '4', '5', '6', '7'].map((d) => spell('Db', d)), ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C']);
  assert.equal(spell('F', 'b7'), 'Eb');
  assert.equal(spell('G', 'b6'), 'Eb');
  for (const k of KEYS) {
    const names = ['1', '2', '3', '4', '5', '6', '7'].map((d) => spell(k, d));
    assert.equal(new Set(names.map((n) => n[0])).size, 7, 'each letter once in ' + k);
  }
});

test('Progression parsing: numbers, dashes, slash and sus chords', () => {
  assert.equal(parseProgression('G', '1–5–6m–4').numbers, '1 5 6m 4');
  assert.equal(parseProgression('G', '1-5-6m-4').numbers, '1 5 6m 4');
  assert.equal(parseProgression('G', '1 5 6 4').numbers, '1 5 6m 4');
  assert.equal(parseProgression('G', '1/3 4sus 5sus 6-').numbers, '1/3 4sus 5sus 6m');
  assert.equal(parseProgression('G', 'G/B Csus D Em7').numbers, '1/3 4sus 5 6m7');
  assert.equal(parseProgression('D', 'D A Bm G').numbers, '1 5 6m 4');
  assert.equal(parseProgression('Bb', 'Bb Gm Eb F').numbers, '1 6m 4 5');
  assert.equal(parseProgression('C', 'C Bb F').numbers, '1 b7 4');
  const sus = parseProgression('F', '5sus').chords[0];
  assert.deepEqual(sus.tones, ['5', '1', '2']);
  assert.throws(() => parseProgression('C', 'hello'));
  assert.throws(() => parseProgression('C', ''));
});

test('Chord tones per scale degree match the spec', () => {
  const t = (txt) => parseProgression('C', txt).chords[0].tones;
  assert.deepEqual(t('1'), ['1', '3', '5']);
  assert.deepEqual(t('2m'), ['2', '4', '6']);
  assert.deepEqual(t('3m'), ['3', '5', '7']);
  assert.deepEqual(t('4'), ['4', '6', '1']);
  assert.deepEqual(t('5'), ['5', '7', '2']);
  assert.deepEqual(t('6m'), ['6', '1', '3']);
});

test('Forever notes: 3 fits 1, 4, 6m but not the 5 chord', () => {
  const [c1, c4, c5, c6] = parseProgression('C', '1 4 5 6m').chords;
  assert.ok(fits('3', c1) && fits('3', c4) && fits('3', c6));
  assert.ok(!fits('3', c5));
  // tension notes never count as forever notes
  assert.ok(!fits('7', c4));
  assert.ok(!fits('4', c1));
});

test('Why it works: "C over Bb = the 9th"', () => {
  const bb = makeChord('4');
  assert.match(whyLine('F', '5', bb), /^C over Bb = the 9th/);
});

test('Sky Shape in F: root F on the B string at fret 6, numbers line up', () => {
  const shape = skyShape('F');
  for (const p of shape) {
    const pc = ((midiAt(p.string, p.fret) % 12) + 12) % 12;
    assert.equal(pc, degreePc('F', p.deg), `string ${p.string} fret ${p.fret} should be ${p.deg}`);
  }
});

test('Accents: one per line, tension resolves on the chord change', () => {
  const ctx = makeContext({ key: 'F', progression: '1 5 6m 4', feel: 'lament', intensity: 3 });
  const line = finalize(ctx, GENERATORS.accent(ctx, 0));
  const tensions = line.slots.flatMap((s) => s.events.flatMap((e) => e.notes.filter((n) => n.tension)));
  assert.equal(tensions.length, 1);
  const at = line.slots.findIndex((s) => s.accent);
  const res = line.slots.findIndex((s) => s.resolves);
  assert.equal(res, (at + 1) % line.slots.length);
  assert.equal(accentsFor('rest', ctx.chords).length, 0);
  assert.equal(accentsFor('intimate', ctx.chords).length, 0);
});

test('Every intensity and feel gives 3–5 ideas in every key', () => {
  for (const key of KEYS) for (const intensity of [1, 2, 3, 4, 5]) for (const feel of ['rest', 'awe', 'lament', 'declaration', 'intimate', 'hope']) {
    const ideas = generateIdeas({ key, progression: '1 5 6m 4', feel, intensity });
    assert.ok(ideas.length >= 3 && ideas.length <= 5, `${key} i${intensity} ${feel}: ${ideas.length}`);
    for (const l of ideas) for (const s of l.slots) for (const e of s.events) for (const n of e.notes) {
      assert.ok(n.pos && n.pos.fret >= 0 && n.pos.fret <= 22, 'positioned');
    }
  }
});

test('Keys has the melody: only pedal tones, swells and answers, higher up', () => {
  const ideas = generateIdeas({ key: 'G', progression: '1 4 6m 5', feel: 'rest', intensity: 4, band: { vocal: 'male', keys: 'melody' } });
  assert.ok(ideas.every((l) => ['forever', 'pedalSwell', 'echo'].includes(l.type)));
  assert.ok(ideas.every((l) => l.slots.every((s) => s.events.every((e) => e.notes.every((n) => n.midi >= 67)))));
  assert.equal(playZone({ keys: 'melody' }).win[0], 12);
});

test('Capo: tab frets are relative to the capo', () => {
  const ctx = makeContext({ key: 'A', progression: '1 5 6m 4', capo: 2, intensity: 2 });
  const line = finalize(ctx, GENERATORS.forever(ctx, 0));
  const n = line.slots[0].events[0].notes[0];
  assert.equal(n.pos.rel, n.pos.fret - 2);
  assert.match(line.tab, new RegExp(`\\|--${n.pos.rel}`));
});

test('Tab text format', () => {
  const t = tabText([{ events: [{ at: 0, notes: [{ string: 5, rel: 17, vib: true }] }] }, { events: [{ at: 0, notes: [{ string: 5, rel: 15, vib: true }] }] }]);
  assert.equal(t.split('\n')[0], 'e |--17~~~--|--15~~~--|');
});

test('Locking: varying a line keeps locked bars exactly', () => {
  const s = { key: 'F', progression: '1 5 6m 4', feel: 'rest', intensity: 2 };
  const ctx = makeContext(s);
  const line = finalize(ctx, GENERATORS.stepping(ctx, 0));
  const v = varyLine(ctx, line, [0, 2], 3);
  assert.ok(v);
  assert.equal(v.slots[0].events[0].notes[0].midi, line.slots[0].events[0].notes[0].midi);
  assert.equal(v.slots[2].events[0].notes[0].midi, line.slots[2].events[0].notes[0].midi);
  assert.notEqual(v.signature, line.signature);
});
