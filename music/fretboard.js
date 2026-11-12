// Fretboard math: positions, playing zones, least-movement fingering, tab text.

export const TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4 (index 0 = low E)
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
export const MAX_FRET = 22;

/** Every place a MIDI note can be played, given a capo (frets are absolute; rel = relative to capo). */
export function positions(midi, { capo = 0, strings = [0, 1, 2, 3, 4, 5] } = {}) {
  const out = [];
  for (const s of strings) {
    const fret = midi - TUNING[s];
    if (fret >= capo && fret <= MAX_FRET) out.push({ string: s, fret, rel: fret - capo });
  }
  return out;
}

export function midiAt(string, fret) {
  return TUNING[string] + fret;
}

/**
 * The playing zone: where you SHOULD play, based on who else is playing.
 * band: { vocal: 'off'|'male'|'female', keys: 'off'|'pads'|'melody', acoustic: bool, bass: bool }
 * Returns { win:[lo,hi] preferred absolute frets, fallback:[lo,hi], strings:[...], lo, hi (MIDI), why:[...] }
 */
export function playZone(band = {}, capo = 0) {
  const vocal = band.vocal ?? 'male';
  const keys = band.keys ?? 'pads';
  let win = [10, 17];
  let fallback = [5, 12];
  let strings = [3, 4, 5];
  const why = [];
  if (keys === 'melody') {
    win = [12, 19];
    fallback = [10, 15];
    why.push('Keys has the melody: stay at fret 12 and up, pedal tones and answers only.');
  } else if (vocal === 'female') {
    win = [12, 19];
    why.push('A female voice sits higher: float above her, frets 12 and up.');
  } else if (vocal === 'off' && keys === 'off') {
    win = [5, 15];
    fallback = [3, 12];
    strings = [2, 3, 4, 5];
    why.push('No vocal, no keys: you are the melody. The middle of the neck is yours.');
  } else if (vocal === 'off') {
    win = [7, 17];
    strings = [2, 3, 4, 5];
    why.push('No vocal: you can carry the melody. Come down into the mid register.');
  } else {
    why.push('Above the singer and the keys: G, B and high E strings, frets 10 to 17.');
  }
  if (keys === 'off' && vocal !== 'off') why.push('No keys: hymn 6ths and dyads help fill the harmony.');
  if (band.acoustic === false && keys === 'off') why.push('No acoustic or keys: let notes ring, you are part of the bed.');
  if (band.bass === false) why.push('No bass: avoid the low strings so the low end stays clean.');
  // capo pushes everything up: keep the window at least a few frets above the capo
  if (capo > 0) {
    win = [Math.max(win[0], capo + 1), Math.max(win[1], capo + 8)];
    fallback = [Math.max(fallback[0], capo + 1), Math.max(fallback[1], capo + 6)];
  }
  const lo = Math.min(...strings.map((s) => TUNING[s] + win[0]));
  const hi = Math.max(...strings.map((s) => TUNING[s] + win[1]));
  return { win, fallback, strings, lo, hi, why };
}

/** Cost of playing at a fret given the zone (lower is better). */
export function fretCost(fret, string, zone, capo = 0) {
  const [a, b] = zone.win;
  const center = (a + b) / 2;
  let c = 0.3 * Math.abs(fret - center);
  if (fret < a || fret > b) {
    const [fa, fb] = zone.fallback;
    if (fret >= fa && fret <= fb) c += 4;
    else if (fret > b && fret <= b + 3) c += 6;
    else if (fret >= 1 && fret <= 5 && capo >= 3) c += 6;
    else c += 10;
  }
  if (!zone.strings.includes(string)) c += 6;
  return c;
}

/**
 * Least-hand-movement fingering for a sequence of note groups.
 * groups: array of arrays of MIDI notes (a group is played together, e.g. a 6th dyad).
 * opts.fixed: array of per-group forced string lists (e.g. [[3,5]] for G+e dyads).
 * Returns array of arrays of {string, fret, rel}.
 */
export function fingerLine(groups, zone, { capo = 0, fixed = [] } = {}) {
  const strings = [0, 1, 2, 3, 4, 5];
  const options = groups.map((notes, gi) => {
    const forced = fixed[gi];
    if (forced) {
      const combo = notes.map((m, i) => {
        const p = positions(m, { capo, strings: [forced[i]] })[0];
        return p;
      });
      return combo.every(Boolean) ? [combo] : [];
    }
    if (notes.length === 1) return positions(notes[0], { capo, strings }).map((p) => [p]);
    // multi-note: choose distinct strings, all combos (small)
    const per = notes.map((m) => positions(m, { capo, strings }));
    const combos = [];
    const rec = (i, acc) => {
      if (i === per.length) { combos.push(acc.slice()); return; }
      for (const p of per[i]) if (!acc.some((q) => q.string === p.string)) { acc.push(p); rec(i + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return combos.filter((c) => Math.max(...c.map((p) => p.fret)) - Math.min(...c.map((p) => p.fret)) <= 4);
  });
  if (options.some((o) => !o.length)) return null;
  const node = (combo) => combo.reduce((s, p) => s + fretCost(p.fret, p.string, zone, capo), 0) / combo.length;
  const avgFret = (combo) => combo.reduce((s, p) => s + p.fret, 0) / combo.length;
  const avgStr = (combo) => combo.reduce((s, p) => s + p.string, 0) / combo.length;
  const edge = (a, b) => Math.abs(avgFret(a) - avgFret(b)) + 0.5 * Math.abs(avgStr(a) - avgStr(b));
  // Viterbi
  let prev = options[0].map((c) => ({ cost: node(c), back: -1 }));
  const trail = [prev];
  for (let g = 1; g < options.length; g++) {
    const cur = options[g].map((c) => {
      let best = Infinity, back = -1;
      options[g - 1].forEach((pc, j) => {
        const v = prev[j].cost + edge(pc, c);
        if (v < best) { best = v; back = j; }
      });
      return { cost: best + node(c), back };
    });
    trail.push(cur);
    prev = cur;
  }
  let idx = prev.reduce((bi, x, i, arr) => (x.cost < arr[bi].cost ? i : bi), 0);
  const result = [];
  for (let g = options.length - 1; g >= 0; g--) {
    result.unshift(options[g][idx]);
    idx = trail[g][idx].back;
  }
  return result;
}

/** Best single position for one note (no context). */
export function bestPosition(midi, zone, capo = 0) {
  const r = fingerLine([[midi]], zone, { capo });
  return r ? r[0][0] : null;
}

/** MIDI candidates of a pitch class inside [lo, hi]. */
export function midisInRange(pc, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === pc) out.push(m);
  return out;
}

/**
 * ASCII tab, one box per chord. Each slot: { events: [{ at (0..1), notes:[{string, rel, slideFrom?:rel, vib?:bool, mute?:[strings]}] }] }
 * Strings shown: always e, B, G, plus any lower strings used.
 */
export function tabText(slots, { width = 9 } = {}) {
  const used = new Set([3, 4, 5]);
  slots.forEach((s) => s.events.forEach((e) => e.notes.forEach((n) => used.add(n.string))));
  const rows = [...used].sort((a, b) => b - a);
  const lines = rows.map((s) => STRING_NAMES[s] + ' |');
  const tokOf = (n) => (n.slideFrom != null ? n.slideFrom + '/' : '') + n.rel + (n.vib ? '~~~' : '');
  slots.forEach((slot) => {
    const busy = slot.events.length;
    const span = busy > 1 ? busy * 4 + 4 : width - 4;
    // place each event by its time, but never closer than one dash after the previous token
    let nextFree = 2;
    const placed = slot.events.map((ev) => {
      const len = Math.max(1, ...ev.notes.map((n) => tokOf(n).length));
      const col = Math.max(nextFree, 2 + Math.round(ev.at * span));
      nextFree = col + len + 1;
      return { ev, col };
    });
    const w = Math.max(width, nextFree + 1);
    const cells = rows.map(() => Array(w).fill('-'));
    placed.forEach(({ ev, col }) => {
      ev.notes.forEach((n) => put(cells[rows.indexOf(n.string)], col, tokOf(n)));
      (ev.mute || []).forEach((s) => { const r = rows.indexOf(s); if (r >= 0) put(cells[r], col, 'x'); });
    });
    cells.forEach((c, i) => { lines[i] += c.join('') + '|'; });
  });
  return lines.join('\n');
}

function put(cells, col, tok) {
  for (let i = 0; i < tok.length && col + i < cells.length; i++) cells[col + i] = tok[i];
}
