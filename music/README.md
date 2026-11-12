# Lead Lines · Worship lead guitar line generator

Live at **https://j3prep.com/music/**. Static site, plain JavaScript, no dependencies, no build step.
Cloudflare Pages deploys it when `main` is pushed.

## What it does
- **Lines**: pick a key, a progression (numbers like `1 5 6m 4` or chord names like `F C Dm Bb`, slash and sus chords too),
  a feel, an intensity (1–5), who's playing and a capo. Get 3–5 lead line ideas in Nashville numbers, note names and tab,
  with a "why it works" line per note, technique tips, and a fretboard per chord. Lock the bars you love and Vary the rest.
- **Neck**: every note in the key with its number. Sky Shape, Home Box, pentatonic only, chord tones.
- **Practice**: tap tempo, 4/4 or 6/8, a piano or pad playing whole-note chords, a guide line, a moving cursor,
  and a mic Listen mode that turns green when you hit the note.
- **Train**: Find the number on the neck; name the number by ear.
- **Saved**: setlist songs, favorite lines (they steer future ideas), optional AI key.
- **Stage mode**: huge numbers, swipe between ideas, screen stays awake. Works offline once loaded.

## Files
| File | Role |
|---|---|
| `theory.js` | Keys, spelling, chord parsing, chord tones, colors, accents, intensity rules |
| `fretboard.js` | Positions, playing zones, least-movement fingering, tab text |
| `lines.js` | The line generators, finalize, ideas, lock-aware variations |
| `board.js` | SVG fretboard (vertical on phones, horizontal on wide screens) |
| `audio.js` | Web Audio piano/pad/guide voice, scheduler, tap tempo, pitch detection |
| `ai.js` | Optional "More with AI" (Claude, your own key, every note re-checked by the rules) |
| `app.js` | UI state and rendering |
| `sw.js` | Offline cache. Bump `VERSION` when shipping changes. |

## Tests
```
node --test
```
Runs from this folder. Covers every spec test case plus spelling, parsing, accents, capo, locking and all 12 keys × 5 intensities × 6 feels.
