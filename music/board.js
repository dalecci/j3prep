// SVG fretboard renderer. Horizontal (tab view) or vertical (phone portrait).
import { TUNING } from './fretboard.js';
import { keyPc, semisToDegree, spell, pretty, DIATONIC, PENTATONIC, roleOf } from './theory.js';

const NS = 'http://www.w3.org/2000/svg';
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

/**
 * opts: {
 *   key, capo, orientation 'h'|'v', range [f0,f1], labels 'numbers'|'notes'|'both',
 *   mode 'neck'|'lines'|'mini', zone, chord, line:[{string,fret,deg,name,order,tension,dyad}],
 *   sky:[{string,fret}], box:fret, current:{string,fret}|null, onNote(string,fret,deg), quiz:boolean
 * }
 */
export function boardSVG(opts) {
  const o = { orientation: 'h', range: [0, 17], labels: 'numbers', mode: 'neck', capo: 0, ...opts };
  const v = o.orientation === 'v';
  const mini = o.mode === 'mini';
  const [f0, f1] = o.range;
  const sp = mini ? 20 : v ? 52 : 34;           // string spacing
  const base = mini ? 38 : v ? 54 : 62;         // first fret length
  const r = mini ? 8.5 : v ? 17 : 13.5;         // dot radius
  const openW = f0 === 0 ? (mini ? 22 : v ? 40 : 42) : 0;
  const pad = mini ? 10 : 26;
  const edge = mini ? 8 : v ? 30 : 30;          // space for fret numbers
  // fret wire positions along the neck axis
  const wires = {};
  let a = pad + openW + (v ? edge * 0.4 : edge);
  const startWire = f0 === 0 ? 0 : f0 - 1;
  wires[startWire] = a;
  for (let n = startWire + 1; n <= f1; n++) { a += base * Math.pow(0.968, n - 1) * (mini ? 0.9 : 1); wires[n] = a; }
  const length = a + pad;
  const cross = sp * 5 + pad * 2 + (v ? 0 : 0);
  const W = v ? cross + edge : length;
  const H = v ? length : cross + edge;
  const along = (fret) => (fret === 0 ? wires[0] - openW / 2 : (wires[fret - 1] + wires[fret]) / 2);
  const crossPos = (s) => (v ? edge + pad + s * sp : pad + (5 - s) * sp);
  const xy = (s, fret) => (v ? [crossPos(s), along(fret)] : [along(fret), crossPos(s)]);
  const kp = keyPc(o.key);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: `board ${v ? 'is-v' : 'is-h'} ${mini ? 'is-mini' : ''} mode-${o.mode}`, role: 'img' });
  svg.setAttribute('aria-label', `Fretboard in ${o.key}`);
  const defs = el('defs');
  defs.innerHTML = `
    <linearGradient id="wood${v ? 'v' : 'h'}" x1="0" y1="0" x2="${v ? 1 : 0}" y2="${v ? 0 : 1}">
      <stop offset="0" stop-color="var(--wood-1)"/><stop offset=".5" stop-color="var(--wood-2)"/><stop offset="1" stop-color="var(--wood-1)"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  svg.appendChild(defs);

  // neck
  const n0 = wires[startWire], n1 = wires[f1];
  const top = crossPos(v ? 0 : 5) - sp * 0.55, bot = crossPos(v ? 5 : 0) + sp * 0.55;
  svg.appendChild(rect(v, n0, n1, top, bot, { fill: `url(#wood${v ? 'v' : 'h'})`, rx: 6, class: 'neck' }));

  // inlays
  for (let f = Math.max(1, f0); f <= f1; f++) {
    const m = along(f);
    const c = (crossPos(0) + crossPos(5)) / 2;
    if (f % 12 === 0) {
      [crossPos(1) + (crossPos(2) - crossPos(1)) / 2, crossPos(3) + (crossPos(4) - crossPos(3)) / 2].forEach((cc) => svg.appendChild(circle(v ? cc : m, v ? m : cc, mini ? 2.6 : 5, { class: 'inlay' })));
    } else if (INLAYS.includes(f)) {
      svg.appendChild(circle(v ? c : m, v ? m : c, mini ? 2.6 : 5, { class: 'inlay' }));
    }
  }

  // zone (where you SHOULD play)
  if (o.zone && o.mode !== 'neck') {
    const zs = o.zone.strings;
    const lo = Math.max(o.zone.win[0], f0 === 0 ? 1 : f0), hi = Math.min(o.zone.win[1], f1);
    if (hi >= lo) {
      const c1 = crossPos(Math.min(...zs)), c2 = crossPos(Math.max(...zs));
      const z = rect(v, wires[lo - 1] ?? wires[startWire], wires[hi], Math.min(c1, c2) - sp * 0.48, Math.max(c1, c2) + sp * 0.48, { class: 'zone', rx: 10 });
      svg.appendChild(z);
      if (!mini) {
        const z0 = wires[lo - 1] ?? wires[startWire];
        const [tx, ty] = v ? [Math.max(c1, c2) + sp * 0.48 - 6, z0 + 12] : [wires[hi] - 6, Math.max(c1, c2) + sp * 0.48 - 5];
        svg.appendChild(text(tx, ty, 'PLAY HERE', { class: 'zone-label', 'text-anchor': 'end' }));
      }
    }
  }

  // home box + sky shape outlines
  if (o.box != null && !mini) {
    const b = o.box;
    if (b + 3 <= f1 && b >= f0) {
      const s1 = wires[Math.max(b - 1, startWire)] ?? wires[startWire];
      svg.appendChild(rect(v, b === 0 ? wires[0] - openW : s1, wires[Math.min(b + 3, f1)], top + 3, bot - 3, { class: 'shape-box', rx: 12 }));
    }
  }
  if (o.sky && !mini) {
    const fr = o.sky.map((p) => p.fret);
    const lo = Math.min(...fr), hi = Math.max(...fr);
    if (lo >= Math.max(f0, 1) && hi <= f1) {
      svg.appendChild(rect(v, wires[lo - 1], wires[hi], Math.min(crossPos(3), crossPos(5)) - sp * 0.5, Math.max(crossPos(3), crossPos(5)) + sp * 0.5, { class: 'shape-sky', rx: 12 }));
    }
  }

  // frets + nut
  for (let n = startWire; n <= f1; n++) {
    const isNut = n === 0;
    svg.appendChild(line(v, wires[n], top, bot, { class: isNut ? 'nut' : 'fret' }));
  }
  // capo
  if (o.capo > 0 && o.capo >= f0 && o.capo <= f1) {
    const m = wires[o.capo] - (mini ? 5 : 9);
    svg.appendChild(rect(v, m - (mini ? 3 : 6), m + (mini ? 3 : 6), top - 4, bot + 4, { class: 'capo', rx: 4 }));
  }
  // strings
  for (let s = 0; s < 6; s++) {
    const c = crossPos(s);
    svg.appendChild(line(v, f0 === 0 ? wires[0] - openW : n0, n1, c, c, { class: 'string', 'stroke-width': mini ? 0.6 + (5 - s) * 0.18 : 0.9 + (5 - s) * 0.35, swap: true }));
  }
  // fret numbers (relative to capo)
  if (!mini) {
    for (let f = Math.max(f0, 1); f <= f1; f++) {
      const rel = f - o.capo;
      if (rel < 0) continue;
      const strong = [3, 5, 7, 9, 12, 15, 17, 19, 21].includes(f);
      const [tx, ty] = v ? [edge * 0.55, along(f) + 4] : [along(f), H - 8];
      svg.appendChild(text(tx, ty, String(rel), { class: 'fretnum' + (strong ? ' strong' : ''), 'text-anchor': 'middle' }));
    }
  }

  // path for the line
  const lineNotes = o.line || [];
  if (lineNotes.length > 1 && !mini) {
    const pts = [];
    const seen = new Set();
    lineNotes.filter((n) => !n.dyadTop).sort((a, b) => a.order - b.order).forEach((n) => { const k = n.string + ':' + n.fret; if (!seen.has(k)) { seen.add(k); pts.push(xy(n.string, n.fret)); } });
    if (pts.length > 1) {
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const bend = v ? [mx + 18, my] : [mx, my - 16];
        d += ` Q${bend[0]},${bend[1]} ${x1},${y1}`;
      }
      svg.appendChild(el('path', { d, class: 'path' }));
    }
  }

  // note dots
  const lineAt = new Map();
  lineNotes.forEach((n) => { const k = n.string + ':' + n.fret; if (!lineAt.has(k)) lineAt.set(k, []); lineAt.get(k).push(n); });
  const dots = el('g', { class: 'dots' });
  for (let s = 0; s < 6; s++) {
    for (let f = f0; f <= f1; f++) {
      if (f < o.capo) continue;
      const midi = TUNING[s] + f;
      const deg = semisToDegree(midi - kp);
      const k = s + ':' + f;
      const onLine = lineAt.get(k);
      const role = o.chord ? roleOf(deg, o.chord) : null;
      const diatonic = DIATONIC.includes(deg);
      if (!diatonic && !onLine && !(role && role !== 'outside')) continue;
      if (o.only && !o.only.has(deg) && !onLine && !(role === 'tone')) continue;
      const inZone = o.zone ? o.zone.strings.includes(s) && f >= o.zone.win[0] && f <= o.zone.win[1] : true;
      const cls = ['dot'];
      if (deg === '1') cls.push('root');
      if (PENTATONIC.includes(deg)) cls.push('pent'); else cls.push('tense');
      if (role === 'tone') cls.push('tone');
      else if (role === 'color') cls.push('color');
      else if (role === 'tension') cls.push('tension');
      if (o.mode !== 'neck' && !inZone) cls.push('out');
      if (o.zone && inZone) cls.push('in');
      if (onLine) cls.push('play');
      if (onLine && onLine.some((n) => n.tension)) cls.push('ptension');
      if (o.current && o.current.some?.((c) => c.string === s && c.fret === f)) cls.push('now');
      if (o.skySet && o.skySet.has(k)) cls.push('sky');
      if (o.boxSet && o.boxSet.has(k)) cls.push('box');
      if (o.mode === 'lines' && lineNotes.length && !onLine) cls.push('dim');
      if (o.quiz) cls.push('quiz');
      const [x, y] = xy(s, f);
      const g = el('g', { class: cls.join(' '), transform: `translate(${x},${y})`, 'data-s': s, 'data-f': f, 'data-deg': deg });
      const rr = onLine ? r * 1.12 : role === 'tone' || o.mode === 'neck' ? r : r * 0.82;
      if (onLine) g.appendChild(circle(0, 0, rr + 5, { class: 'halo' }));
      g.appendChild(circle(0, 0, rr, { class: 'disc' }));
      if (!o.quiz) {
        const name = spell(o.key, deg);
        const lab = o.labels === 'notes' ? pretty(name) : pretty(deg);
        g.appendChild(text(0, o.labels === 'both' && !mini ? -1 : (mini ? 3 : 4.5), lab, { class: 'lab', 'text-anchor': 'middle' }));
        if (o.labels === 'both' && !mini) g.appendChild(text(0, rr * 0.72, pretty(name), { class: 'sub', 'text-anchor': 'middle' }));
      }
      if (onLine && !mini) {
        const orders = [...new Set(onLine.map((n) => n.order))].sort((a, b) => a - b);
        const label = orders.length > 2 ? `${orders[0] + 1}–${orders[orders.length - 1] + 1}` : orders.map((x) => x + 1).join(',');
        const bw = Math.max(17, label.length * 5.6 + 8);
        const badge = el('g', { class: 'badge', transform: `translate(${rr * 0.85},${-rr * 0.85})` });
        badge.appendChild(el('rect', { x: -bw / 2, y: -8.5, width: bw, height: 17, rx: 8.5 }));
        badge.appendChild(text(0, 3.5, label, { 'text-anchor': 'middle' }));
        g.appendChild(badge);
      }
      if (o.onNote) g.addEventListener('click', () => o.onNote(s, f, deg));
      dots.appendChild(g);
    }
  }
  svg.appendChild(dots);
  return svg;
}

function el(name, attrs = {}) {
  const e = document.createElementNS(NS, name);
  for (const [k, val] of Object.entries(attrs)) if (val != null && k !== 'swap') e.setAttribute(k, val);
  return e;
}
function circle(cx, cy, r, attrs) { return el('circle', { cx, cy, r, ...attrs }); }
function text(x, y, t, attrs) { const e = el('text', { x, y, ...attrs }); e.textContent = t; return e; }
// rect spanning [a0,a1] along the neck and [c0,c1] across it
function rect(v, a0, a1, c0, c1, attrs) {
  const [x, y, w, h] = v ? [c0, a0, c1 - c0, a1 - a0] : [a0, c0, a1 - a0, c1 - c0];
  return el('rect', { x, y, width: Math.max(0, w), height: Math.max(0, h), ...attrs });
}
// a fret (across the neck at position a) or a string (along the neck at cross position c)
function line(v, p, q0, q1, attrs) {
  if (attrs.swap) {
    // string: from neck position p to q0, at cross position q1
    const [x1, y1, x2, y2] = v ? [q1, p, q1, q0] : [p, q1, q0, q1];
    return el('line', { x1, y1, x2, y2, ...attrs });
  }
  const [x1, y1, x2, y2] = v ? [q0, p, q1, p] : [p, q0, p, q1];
  return el('line', { x1, y1, x2, y2, ...attrs });
}
