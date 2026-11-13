// Lead Lines app: state, rendering, interactions.
import {
  KEYS, PRESETS, FEELS, INTENSITY, DIATONIC, PENTATONIC, parseProgression, spell, pretty, chordName,
  homeBoxFret, skyShape, skyRootFret, keyPc, degreeSemis, makeChord, feelById,
} from './theory.js';
import { TUNING, STRING_NAMES, playZone } from './fretboard.js';
import { generateIdeas, varyLine, makeContext, intensityGuide } from './lines.js';
import { boardSVG } from './board.js';
import { createPlayer, createTapTempo, pluck, drone, tone, createListener, unlockAudio } from './audio.js';
import { aiIdeas, hasKey } from './ai.js';

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const DEFAULTS = {
  key: 'F', progression: '1 5 6m 4', feel: 'rest', intensity: 2, capo: 0,
  band: { vocal: 'male', keys: 'pads', acoustic: true, bass: true },
  labels: 'numbers', sky: false, box: false, pentOnly: false, lefty: false,
  bpm: 68, meter: '4/4', sound: 'piano', guide: true, click: false, countIn: true,
  view: 'home', drill: 'find', cardTab: 'neck',
};
const saved = store.get('wll.settings', {});
const S = { ...DEFAULTS, ...saved, band: { ...DEFAULTS.band, ...(saved.band || {}) } };
if (!KEYS.includes(S.key)) S.key = 'F';
const saveSettings = () => store.set('wll.settings', S);

const ui = {
  chords: [], parseError: null, format: 'numbers',
  ideas: [], round: 0, sel: null, locks: {}, lockMode: null, history: [],
  boardChord: null, neckChord: null, helpFor: null, bandCustom: false,
  playingId: null, practiceId: null,
  stageOpen: false, stageIdx: 0, stageChord: 0, wake: null,
  aiBusy: false, listenStop: null,
  drill: null, setEdit: false, homeTyping: false, setupOpen: false,
};

const player = createPlayer();
const tapTempo = createTapTempo();

// ---------- words ----------
const FEEL_SHORT = { rest: 'Rest', awe: 'Awe', lament: 'Lament', declaration: 'Victory', intimate: 'Prayer', hope: 'Hope' };
const FEEL_COLORS = { rest: '#7FE7F2', awe: '#BFA8FF', lament: '#9DB4FF', declaration: '#E6C16E', intimate: '#FFB4C8', hope: '#7DE3A4' };
const LEVEL_WORD = { 1: 'Hush', 2: 'Low', 3: 'Room', 4: 'Build', 5: 'Peak' };
const BAND_PRESETS = [
  { id: 'full', label: 'Full band', band: { vocal: 'male', keys: 'pads', acoustic: true, bass: true } },
  { id: 'keys', label: 'Vocal + keys', band: { vocal: 'male', keys: 'pads', acoustic: false, bass: false } },
  { id: 'solo', label: 'Vocal + me', band: { vocal: 'male', keys: 'off', acoustic: false, bass: false } },
  { id: 'inst', label: 'No vocal', band: { vocal: 'off', keys: 'pads', acoustic: true, bass: true } },
];
const GLOSSARY = {
  forever: 'One note held under every chord. It fits them all, so it can never be wrong. The most worshipful choice.',
  pedalSwell: 'A forever note swelled in once and held. Perfect when the keys player has the melody.',
  stepping: 'One long note per chord. Each moves to the nearest note that fits the next chord.',
  sigh: 'On every chord, slide up from the step below into a chord tone. It sounds like a breath out.',
  hymn: 'Two notes a 6th apart on the G and high E strings, with the B string muted. Sounds like a choir harmony.',
  hymnClimb: 'Hymn 6ths that move up the neck with each chord. It builds without getting louder.',
  accent: 'Mostly forever notes, plus one tension note that resolves on the chord change. One moment of color.',
  echo: 'A tiny 3-note motif you repeat in the gaps after the leader sings a line.',
  rising: 'Two chord tones per chord, always climbing. For when the room is building.',
  octaves: 'The same note on the G and high E strings, 3 frets apart. Big and clear without being busy.',
  phrase: 'A long note, then a quick pickup into the next chord, every 2 bars.',
  topline: 'The highest notes, held over the whole band at the peak.',
  ai: 'Written by AI, then every note checked by the same theory rules as the other ideas.',
};
const sameBand = (a, b) => ['vocal', 'keys', 'acoustic', 'bass'].every((k) => a[k] === b[k]);
const bandPresetId = (b) => BAND_PRESETS.find((p) => sameBand(p.band, b))?.id || null;
const bandLabel = (b) => BAND_PRESETS.find((p) => p.id === bandPresetId(b))?.label || 'Custom band';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const narrow = () => window.innerWidth < 640;
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
const taste = () => store.get('wll.taste', {});
const favs = () => store.get('wll.favs', []);
const favId = (lineId) => `${S.key}|${S.capo}|${lineId}`;
const isFav = (id) => favs().some((f) => f.id === favId(id));
const ctx = () => makeContext({ key: S.key, chords: ui.chords, feel: S.feel, intensity: S.intensity, capo: S.capo, band: S.band });
const selectedLine = () => ui.ideas.find((l) => l.id === ui.sel) || null;
const lineById = (id) => ui.ideas.find((l) => l.id === id) || favs().find((f) => f.line.id === id)?.line || null;
const progNumbers = () => ui.chords.map((c) => c.label).join(' ');

// ---------- progression ----------
function parse() {
  try {
    const p = parseProgression(S.key, S.progression);
    ui.chords = p.chords;
    ui.format = p.format;
    ui.parseError = null;
  } catch (e) {
    ui.parseError = e.message;
  }
}

function commitProgression() {
  if (ui.parseError) return;
  if (ui.format !== 'numbers') {
    const numbers = progNumbers();
    toast(`Saved as numbers: ${numbers}`);
    S.progression = numbers;
    ui.format = 'numbers';
  }
  const rec = store.get('wll.recent', []).filter((r) => r !== S.progression);
  if (!PRESETS.some((p) => p.text === S.progression)) rec.unshift(S.progression);
  store.set('wll.recent', rec.slice(0, 6));
  saveSettings();
}

/** Settings changed: fresh ideas, clear the Back history. */
function settingsChanged() {
  ui.round = 0;
  ui.history = [];
  saveSettings();
  regenerate({ keepSel: false });
}

// ---------- ideas ----------
const ctxKey = () => [S.key, S.capo, progNumbers(), S.feel, S.intensity, JSON.stringify(S.band)].join('|');
function regenerate({ keepSel = true } = {}) {
  if (ui.parseError || !ui.chords.length) { ui.ideas = []; if (S.view === 'lines') renderLines(); return; }
  const prevSel = ui.sel;
  const k = ctxKey();
  const pinned = ui.ideas.filter((l) => l.type === 'ai' && l.ctxKey === k);
  ui.ideas = [...pinned, ...generateIdeas(ctx(), { round: ui.round, taste: taste() })];
  ui.ideas.forEach((l) => { l.ctxKey = l.ctxKey || k; });
  ui.sel = keepSel && ui.ideas.some((l) => l.id === prevSel) ? prevSel : ui.ideas[0]?.id || null;
  if (ui.boardChord != null && ui.boardChord >= ui.chords.length) ui.boardChord = null;
  if (S.view === 'lines') renderLines();
  if (S.view === 'practice') renderPractice();
  if (ui.stageOpen) renderStage();
}

function rememberLast(line) {
  if (!line) return;
  store.set('wll.last', { line, name: line.name, numbers: line.numbers, key: S.key, progression: progNumbers(), capo: S.capo, feel: S.feel, intensity: S.intensity, band: { ...S.band } });
}

function loadSnapshot(snap, line = null) {
  Object.assign(S, { key: snap.key, progression: snap.progression, capo: snap.capo || 0, feel: snap.feel || S.feel, intensity: snap.intensity || S.intensity });
  if (snap.band) S.band = { ...S.band, ...snap.band };
  parse();
  ui.round = 0; ui.history = [];
  saveSettings();
  regenerate({ keepSel: false });
  if (line) {
    line.ctxKey = ctxKey();
    ui.ideas = [line, ...ui.ideas.filter((l) => l.id !== line.id)].slice(0, 6);
    ui.sel = line.id;
  }
}

// ---------- shared pickers ----------
function keyButtons(container, cls = '') {
  container.innerHTML = KEYS.map((k) => `<button class="${cls}" role="radio" aria-checked="${k === S.key}" data-key="${k}">${pretty(k)}</button>`).join('');
}
function onKeyPick(e) {
  const b = e.target.closest('[data-key]');
  if (!b || b.dataset.key === S.key) return;
  S.key = b.dataset.key;
  parse();
  settingsChanged();
  renderChrome();
  if (S.view === 'home') renderHome();
  if (S.view === 'lines') renderSetup();
  if (S.view === 'neck') renderNeck();
}

function renderChrome() {
  $('#keyPillName').textContent = pretty(S.key);
}

function parsedHTML() {
  if (ui.parseError) return `<span class="err">${esc(ui.parseError)}</span>`;
  return ui.chords.map((c) => `<span class="pc"><b>${pretty(c.label)}</b><small>${pretty(chordName(S.key, c))}</small></span>`).join('')
    + (ui.format !== 'numbers' ? `<span class="fmt">read as chord names</span>` : '');
}

// ---------- HOME ----------
function renderHome() {
  $('#intro').hidden = !!store.get('wll.seenIntro', false);
  const h = new Date().getHours();
  $('#greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  keyButtons($('#homeKeys'), 'keychip');
  const selKey = $('#homeKeys [aria-checked="true"]');
  if (selKey) requestAnimationFrame(() => {
    const row = $('#homeKeys');
    const r = row.getBoundingClientRect(), k = selKey.getBoundingClientRect();
    row.style.scrollBehavior = 'auto';
    row.scrollLeft += k.left - r.left - r.width / 2 + k.width / 2;
    row.style.scrollBehavior = '';
  });
  const rec = store.get('wll.recent', []).slice(0, 2);
  const opts = [...PRESETS.map((p) => ({ text: p.text, label: p.label })), ...rec.map((r) => ({ text: r, label: pretty(r) }))];
  const onPreset = opts.some((o) => o.text === S.progression);
  $('#homeProg').innerHTML = opts.map((o) => `<button class="chip" aria-pressed="${o.text === S.progression && !ui.homeTyping}" data-prog="${esc(o.text)}">${esc(o.label)}</button>`).join('')
    + `<button class="chip" aria-pressed="${ui.homeTyping || !onPreset}" data-type="1">${!onPreset && !ui.homeTyping ? esc(pretty(S.progression)) : 'Type your own…'}</button>`;
  $('#homeProgInputWrap').hidden = !ui.homeTyping;
  const inp = $('#homeProgInput');
  if (document.activeElement !== inp) inp.value = S.progression;
  $('#homeParsed').innerHTML = parsedHTML();
  $('#homeFeel').innerHTML = FEELS.map((f) => `<button role="radio" aria-checked="${f.id === S.feel}" data-feel="${f.id}" style="--feel-c:${FEEL_COLORS[f.id]}">${FEEL_SHORT[f.id]}</button>`).join('');
  renderSet();
  const last = store.get('wll.last', null);
  const res = $('#resume');
  res.hidden = !last;
  if (last) res.innerHTML = `<span class="resume-text"><small>Pick up where you left off</small><b>${esc(last.name)}</b><em>${esc(pretty(last.numbers))} · Key ${pretty(last.key)}</em></span><span class="resume-play" aria-hidden="true">▶</span>`;
  renderFavs();
}

function renderSet() {
  const songs = store.get('wll.songs', []);
  $('#setEdit').hidden = !songs.length;
  $('#setEdit').textContent = ui.setEdit ? 'Done' : 'Edit';
  $('#homeSet').innerHTML = songs.length ? songs.map((s, i) => `<li>
      <button class="set-item" data-song="${i}"><span class="num">${i + 1}</span><span class="grow"><b>${esc(s.name)}</b><small>Key ${pretty(s.key)}${s.capo ? ' · capo ' + s.capo : ''} · ${esc(pretty(s.progression))} · ${esc(FEEL_SHORT[s.feel] || '')}</small></span><span class="go" aria-hidden="true">›</span></button>
      ${ui.setEdit ? `<span class="set-edit"><button class="iconbtn" data-up="${i}" aria-label="Move up">↑</button><button class="iconbtn" data-delsong="${i}" aria-label="Delete ${esc(s.name)}">✕</button></span>` : ''}
    </li>`).join('') : '<li class="empty">Save tonight’s songs here, then load each one with a single tap.</li>';
}

function renderFavs() {
  const list = favs();
  $('#favs').innerHTML = list.length ? list.slice(0, 12).map((f, i) => `<li><div class="grow" data-fav="${i}"><b>${esc(f.name)}</b><small>${esc(pretty(f.numbers))} · Key ${pretty(f.key)} · ${esc(pretty(f.progression))}</small></div><button class="iconbtn" data-delfav="${i}" aria-label="Delete">✕</button></li>`).join('')
    : '<li class="empty">Tap ♡ on any line to keep it here. New ideas will lean toward what you love.</li>';
}

function bindHome() {
  $('#introClose').onclick = () => { store.set('wll.seenIntro', true); $('#intro').hidden = true; };
  $('#homeKeys').onclick = onKeyPick;
  $('#homeProg').onclick = (e) => {
    const b = e.target.closest('[data-prog],[data-type]');
    if (!b) return;
    if (b.dataset.type) { ui.homeTyping = true; renderHome(); $('#homeProgInput').focus(); return; }
    ui.homeTyping = false;
    S.progression = b.dataset.prog; parse(); settingsChanged(); renderHome();
  };
  const inp = $('#homeProgInput');
  inp.addEventListener('input', () => { S.progression = inp.value; parse(); $('#homeParsed').innerHTML = parsedHTML(); });
  inp.addEventListener('change', () => { if (!ui.parseError) { commitProgression(); settingsChanged(); } });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); $('#goLines').click(); } });
  $('#homeFeel').onclick = (e) => {
    const b = e.target.closest('[data-feel]'); if (!b) return;
    S.feel = b.dataset.feel; settingsChanged(); renderHome();
  };
  $('#goLines').onclick = () => {
    if (ui.parseError) { toast('Check the chords first'); ui.homeTyping = true; renderHome(); return; }
    commitProgression();
    ui.homeTyping = false;
    if (!ui.ideas.length || ui.ideas[0].ctxKey !== ctxKey()) settingsChanged();
    ui.setupOpen = false;
    store.set('wll.seenIntro', true);
    go('lines');
  };
  $('#setEdit').onclick = () => { ui.setEdit = !ui.setEdit; renderSet(); };
  $('#homeSet').onclick = (e) => {
    const songs = store.get('wll.songs', []);
    const del = e.target.closest('[data-delsong]');
    const up = e.target.closest('[data-up]');
    const load = e.target.closest('[data-song]');
    if (del) { songs.splice(+del.dataset.delsong, 1); store.set('wll.songs', songs); if (!songs.length) ui.setEdit = false; renderSet(); return; }
    if (up) { const i = +up.dataset.up; if (i > 0) { [songs[i - 1], songs[i]] = [songs[i], songs[i - 1]]; store.set('wll.songs', songs); renderSet(); } return; }
    if (load && !ui.setEdit) {
      const s = songs[+load.dataset.song];
      loadSnapshot(s);
      renderChrome();
      go('lines');
      toast(`${s.name} · Key ${pretty(s.key)}`);
    }
  };
  $('#songForm').onsubmit = (e) => {
    e.preventDefault();
    if (ui.parseError) return toast('Check the chords first');
    const name = $('#songName').value.trim();
    if (!name) return;
    const songs = store.get('wll.songs', []);
    songs.push({ name, key: S.key, progression: progNumbers(), capo: S.capo, feel: S.feel, intensity: S.intensity, band: { ...S.band } });
    store.set('wll.songs', songs);
    $('#songName').value = '';
    renderSet();
    toast(`Saved “${name}”`);
  };
  $('#resume').onclick = () => {
    const last = store.get('wll.last', null);
    if (!last) return;
    loadSnapshot(last, last.line);
    renderChrome();
    go('lines');
  };
  $('#tileStage').onclick = () => { if (!ui.ideas.length) regenerate(); openStage(Math.max(0, ui.ideas.findIndex((l) => l.id === ui.sel))); };
  $('#favs').onclick = (e) => {
    const del = e.target.closest('[data-delfav]');
    const load = e.target.closest('[data-fav]');
    const list = favs();
    if (del) { list.splice(+del.dataset.delfav, 1); store.set('wll.favs', list); renderFavs(); return; }
    if (load) {
      const f = list[+load.dataset.fav];
      loadSnapshot(f, f.line);
      renderChrome();
      go('lines');
    }
  };
}

// ---------- LINES: setup ----------
function renderSetup() {
  renderChrome();
  const feel = feelById(S.feel);
  $('#setupSummary').innerHTML = `<span class="k">${pretty(S.key)}</span><span class="p">${esc(ui.parseError ? S.progression : ui.chords.map((c) => pretty(c.label)).join(' '))}</span><span class="f">${esc(FEEL_SHORT[feel.id])} · ${LEVEL_WORD[S.intensity]} · ${esc(bandLabel(S.band))}${S.capo ? ' · Capo ' + S.capo : ''}</span>`;
  $('#setupToggle').setAttribute('aria-expanded', ui.setupOpen);
  $('#setupBody').hidden = !ui.setupOpen;
  if (!ui.setupOpen) return;
  keyButtons($('#keyGrid'));
  $('#presets').innerHTML = PRESETS.map((p) => `<button class="chip" aria-pressed="${p.text === S.progression}" data-prog="${p.text}">${p.label}</button>`).join('');
  const inp = $('#progInput');
  if (document.activeElement !== inp) inp.value = S.progression;
  const rec = store.get('wll.recent', []);
  $('#recents').innerHTML = rec.length ? `<span class="label" style="align-self:center">Recent</span>` + rec.map((r) => `<button class="chip" data-prog="${esc(r)}">${esc(pretty(r))}</button>`).join('') : '';
  $('#parsed').innerHTML = parsedHTML();
  $('#feelGrid').innerHTML = FEELS.map((f) => {
    const c = FEEL_COLORS[f.id];
    return `<button class="feel" role="radio" aria-checked="${f.id === S.feel}" data-feel="${f.id}" style="--feel-c:${c};--feel-glow:radial-gradient(120% 140% at 0% 0%, ${c}33, transparent 60%)"><b>${f.name}</b><small>${f.blurb}</small></button>`;
  }).join('');
  $('#intensity').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${n === S.intensity}" data-int="${n}" aria-label="${n}: ${INTENSITY[n].name}"><b>${n}</b><span>${LEVEL_WORD[n]}</span></button>`).join('')
    + `<p class="int-caption">${INTENSITY[S.intensity].name}. ${INTENSITY[S.intensity].notes}</p>`;
  const presetId = bandPresetId(S.band);
  const custom = ui.bandCustom || !presetId;
  const seg = (name, val, opts) => `<div class="seg" role="radiogroup" aria-label="${name}">${opts.map(([v, l]) => `<button role="radio" aria-checked="${v === val}" data-band="${name}" data-val="${v}">${l}</button>`).join('')}</div>`;
  const tog = (name, label, on) => `<button class="toggle" role="switch" aria-checked="${on}" data-bandtog="${name}"><i></i>${label}</button>`;
  $('#band').innerHTML = `
    <div class="chips">${BAND_PRESETS.map((p) => `<button class="chip" aria-pressed="${p.id === presetId && !ui.bandCustom}" data-bandpreset="${p.id}">${p.label}</button>`).join('')}<button class="chip" aria-pressed="${custom}" data-bandcustom="1">Custom…</button></div>
    ${custom ? `
    <div class="band-row"><span>Vocal</span>${seg('vocal', S.band.vocal, [['off', 'None'], ['male', 'Male'], ['female', 'Female']])}</div>
    <div class="band-row"><span>Keys</span>${seg('keys', S.band.keys, [['off', 'None'], ['pads', 'Pads'], ['melody', 'Has melody']])}</div>
    <div class="band-row"><span>Also</span><div class="toggles">${tog('acoustic', 'Acoustic', S.band.acoustic)}${tog('bass', 'Bass', S.band.bass)}</div></div>` : ''}
    <div class="band-row"><span>Capo</span><div class="stepper"><button class="iconbtn" data-capo="-1" aria-label="Capo down">−</button><b>${S.capo}</b><button class="iconbtn" data-capo="1" aria-label="Capo up">+</button></div></div>`;
}

function bindSetup() {
  $('#setupToggle').onclick = () => { ui.setupOpen = !ui.setupOpen; renderSetup(); };
  $('#setupDone').onclick = () => { ui.setupOpen = false; renderSetup(); $('#ideas').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('#keyPill').onclick = () => { go('lines'); ui.setupOpen = true; renderSetup(); $('#keyGrid').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('#keyGrid').onclick = onKeyPick;
  $('#presets').onclick = $('#recents').onclick = (e) => {
    const b = e.target.closest('[data-prog]');
    if (!b) return;
    S.progression = b.dataset.prog; parse(); settingsChanged(); renderSetup();
  };
  let deb = 0;
  const inp = $('#progInput');
  inp.addEventListener('input', () => {
    S.progression = inp.value;
    parse();
    $('#parsed').innerHTML = parsedHTML();
    clearTimeout(deb);
    deb = setTimeout(() => { if (!ui.parseError) settingsChanged(); }, 400);
  });
  inp.addEventListener('change', () => { commitProgression(); renderSetup(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  $('#feelGrid').onclick = (e) => { const b = e.target.closest('[data-feel]'); if (!b) return; S.feel = b.dataset.feel; settingsChanged(); renderSetup(); };
  $('#intensity').onclick = (e) => { const b = e.target.closest('[data-int]'); if (!b) return; S.intensity = +b.dataset.int; settingsChanged(); renderSetup(); };
  $('#band').onclick = (e) => {
    const pre = e.target.closest('[data-bandpreset]');
    const cus = e.target.closest('[data-bandcustom]');
    const seg = e.target.closest('[data-band]');
    const tog = e.target.closest('[data-bandtog]');
    const cap = e.target.closest('[data-capo]');
    if (cus) { ui.bandCustom = !ui.bandCustom; renderSetup(); return; }
    if (pre) { S.band = { ...BAND_PRESETS.find((p) => p.id === pre.dataset.bandpreset).band }; ui.bandCustom = false; }
    else if (seg) S.band[seg.dataset.band] = seg.dataset.val;
    else if (tog) S.band[tog.dataset.bandtog] = !S.band[tog.dataset.bandtog];
    else if (cap) S.capo = Math.max(0, Math.min(7, S.capo + +cap.dataset.capo));
    else return;
    settingsChanged(); renderSetup();
  };
}

// ---------- LINES: ideas ----------
function lineNotesFor(line, onlyChord = null) {
  const out = [];
  let order = 0;
  line.slots.forEach((s, si) => s.events.forEach((e) => {
    if (onlyChord == null || onlyChord === si) {
      e.notes.forEach((n, j) => { if (n.pos && !n.tie) out.push({ string: n.pos.string, fret: n.pos.fret, deg: n.deg, order, dyadTop: j > 0, midi: n.midi, tension: !!n.tension }); });
    }
    order++;
  }));
  return out;
}

function boardRange(line, zone, pad = 2) {
  const frets = line ? lineNotesFor(line).map((n) => n.fret) : [];
  let lo = Math.min(zone.win[0], ...frets) - pad;
  let hi = Math.max(zone.win[1], ...frets) + pad;
  lo = Math.max(0, lo, S.capo || 0);
  hi = Math.min(22, Math.max(hi, lo + 9));
  return [lo, hi];
}

function renderLinesBoard() {
  const wrap = $('#linesBoard');
  if (!wrap) return;
  const line = selectedLine();
  const c = ctx();
  const chord = ui.boardChord != null ? (line?.slots[ui.boardChord]?.explainChord || ui.chords[ui.boardChord]) : null;
  const svg = boardSVG({
    key: S.key, capo: S.capo, orientation: narrow() ? 'v' : 'h', range: boardRange(line, c.zone), lefty: S.lefty,
    labels: S.labels, mode: 'lines', zone: c.zone, chord,
    line: line ? lineNotesFor(line, ui.boardChord) : [],
    current: ui.current,
    onNote: (s, f) => pluck(TUNING[s] + f),
  });
  wrap.replaceChildren(svg);
  if (!narrow()) {
    const z = svg.querySelector('.zone');
    if (z) wrap.scrollLeft = Math.max(0, z.getBBox().x * (svg.clientWidth / svg.viewBox.baseVal.width) - 30);
  }
}

function renderGuide() {
  const g = intensityGuide(S.intensity);
  const z = playZone(S.band, S.capo);
  $('#guideBanner').innerHTML = `<div class="lvl">${g.level}</div><b>${g.name}</b><p>${g.notes}</p><p class="zone-why">${esc(z.why[0] || '')}</p>`;
}

function slotParts(s, stage = false) {
  const evs = s.events;
  if (!evs.length) return { num: '·', nm: 'rest', fr: '' };
  if (evs.length > 1) {
    return {
      num: evs.map((e) => pretty(e.notes[0].deg)).join(' '),
      nm: evs.map((e) => pretty(e.notes[0].name)).join(' '),
      fr: evs.map((e) => STRING_NAMES[e.notes[0].pos.string] + e.notes[0].pos.rel).join(' '),
      multi: true,
    };
  }
  const ns = evs[0].notes;
  if (ns.length > 1) {
    const [lo, hi] = ns;
    return {
      num: stage ? `${pretty(hi.deg)}<small class="over">/</small>${pretty(lo.deg)}` : `<span>${pretty(hi.deg)}</span><span>${pretty(lo.deg)}</span>`,
      nm: `${pretty(hi.name)}+${pretty(lo.name)}`,
      fr: ns.map((n) => STRING_NAMES[n.pos.string] + n.pos.rel).reverse().join(' '),
      dyad: true,
    };
  }
  const n = ns[0];
  return {
    num: (n.slideFrom ? pretty(n.slideFrom.deg) + '<span class="arrow">›</span>' : '') + (n.tie ? `(${pretty(n.deg)})` : pretty(n.deg)),
    nm: (n.slideFrom ? pretty(n.slideFrom.name) + '›' : '') + pretty(n.name),
    fr: STRING_NAMES[n.pos.string] + (n.slideFrom?.pos ? n.slideFrom.pos.rel + '/' : '') + n.pos.rel,
  };
}

function slotHTML(line, s, si, { stage = false, locks = null, now = false } = {}) {
  const chord = s.explainChord || s.chord;
  const cls = [stage ? 'stage-slot' : 'slot'];
  if (s.events.some((e) => e.notes.some((n) => n.tension))) cls.push('tension');
  if (s.events.some((e) => e.notes.some((n) => n.resolution))) cls.push('resolve');
  if (locks && locks.has(si)) cls.push('locked');
  if (now) cls.push('now');
  const p = slotParts(s, stage);
  return `<div class="${cls.join(' ')}" data-slot="${si}"><span class="c">${pretty(chordName(S.key, chord))}<em>${pretty(chord.label)}</em></span><span class="n ${p.multi ? 'multi' : ''} ${p.dyad && !stage ? 'dyad' : ''}">${p.num}</span><span class="nm">${p.nm}</span><span class="fr">${p.fr}</span></div>`;
}

function tabHTML(line, nowIdx = -1) {
  const rows = line.tab.split('\n').map((r) => r.split('|'));
  const names = rows.map((r) => r[0]);
  const cols = rows[0].length - 2;
  let html = `<pre class="tnames"><span class="tchord">.</span>${names.map((n) => n + '|').join('\n')}</pre>`;
  for (let c = 1; c <= cols; c++) {
    const body = rows.map((r) => esc(r[c]).replace(/(\d+)/g, '<b>$1</b>') + '|').join('\n');
    const ch = line.chordNames?.[c - 1] || '';
    html += `<pre class="tcol ${c - 1 === nowIdx ? 'now' : ''}" data-col="${c - 1}"><span class="tchord">${esc(pretty(ch))}</span>${body}</pre>`;
  }
  return `<div class="tab" aria-label="Tab">${html}</div>`;
}

function minisHTML(line) {
  return line.slots.map((s, i) => `<div class="mini" data-mini="${i}"><div class="t">${pretty(line.chordNames[i])}</div></div>`).join('');
}

function fillMinis(card, line) {
  const c = ctx();
  $$('.mini', card).forEach((m) => {
    const i = +m.dataset.mini;
    const notes = lineNotesFor(line, i);
    const frets = notes.map((n) => n.fret);
    let lo = frets.length ? Math.min(...frets) - 1 : c.zone.win[0];
    lo = Math.max(lo, S.capo, 0);
    const hi = Math.min(22, Math.max(lo + 4, (frets.length ? Math.max(...frets) : lo) + 1));
    const svg = boardSVG({ key: S.key, capo: S.capo, orientation: 'v', range: [lo, hi], mode: 'mini', lefty: S.lefty, chord: line.slots[i].explainChord || line.slots[i].chord, line: notes, labels: 'numbers' });
    const label = document.createElement('div');
    label.className = 't';
    label.style.fontWeight = '500';
    label.textContent = lo > 0 ? `fret ${lo - S.capo}` : 'open';
    m.append(svg, label);
  });
}

const CARD_TABS = [['neck', 'Neck'], ['tab', 'Tab'], ['why', 'Why'], ['tips', 'How']];

function panelHTML(line) {
  const t = S.cardTab;
  if (t === 'neck') {
    const chips = [`<button class="chip ${ui.boardChord == null ? 'on' : ''}" data-bchord="all">Whole line</button>`]
      .concat(ui.chords.map((ch, i) => `<button class="chip ${ui.boardChord === i ? 'on' : ''}" data-bchord="${i}"><b>${pretty(chordName(S.key, line.slots[i]?.explainChord || ch))}</b> <small>${pretty(ch.label)}</small></button>`));
    const chord = ui.boardChord != null;
    return `<div class="chips chordchips scroll">${chips.join('')}</div>
      <div class="legend"><span><i class="lg-play"></i>Play this</span>${chord ? '<span><i class="lg-tone"></i>Chord tone</span><span><i class="lg-color"></i>Color</span><span><i class="lg-tension"></i>Tension</span>' : ''}<span><i class="lg-zone"></i>Play here</span>
        <span class="seg mini-seg" role="radiogroup" aria-label="Labels">${[['numbers', '1 2 3'], ['notes', 'C D E'], ['both', 'Both']].map(([v, l]) => `<button role="radio" aria-checked="${S.labels === v}" data-labels="${v}">${l}</button>`).join('')}</span></div>
      <div class="board-wrap" id="linesBoard"></div>
      <div class="sub-h">Each chord up close</div><div class="minis">${minisHTML(line)}</div>`;
  }
  if (t === 'tab') return `<div class="sub-h">Tab${S.capo ? ` · frets counted from capo ${S.capo}` : ''} · ~ vibrato · / slide</div>${tabHTML(line)}`;
  if (t === 'why') return `<ul class="why">${line.why.map((w) => `<li class="r-${w.role}"><span class="wd">${pretty(w.deg)}</span><span>${esc(pretty(w.text))}</span></li>`).join('')}</ul>`;
  return `<div class="tips">${line.tips.map((tip) => `<span>${esc(tip)}</span>`).join('')}</div><p class="muted small" style="margin:10px 0 0">${esc(INTENSITY[S.intensity].notes)} Play in the leader's breaths.</p>`;
}

function ideaHTML(line, i) {
  const sel = line.id === ui.sel;
  const locks = ui.locks[line.id] || new Set();
  const lockMode = ui.lockMode === line.id;
  const tag = [`Idea ${i + 1}`, line.type === 'ai' ? 'AI, rule-checked' : null, line.slots.some((s) => s.accent) ? 'One accent' : null].filter(Boolean).join(' · ');
  const playing = ui.playingId === line.id;
  const gloss = GLOSSARY[line.type];
  return `<article class="idea ${sel ? 'sel' : ''} ${lockMode ? 'lockmode' : ''}" data-id="${esc(line.id)}" tabindex="0">
    <div class="idea-head">
      <div>
        <div class="idea-tag">${tag}</div>
        <h3>${esc(line.name)}${gloss ? ` <button class="help" data-act="help" aria-label="What is ${esc(line.name)}?" aria-expanded="${ui.helpFor === line.id}">?</button>` : ''}</h3>
        ${sel ? `<p class="when">${esc(line.when)}</p>` : ''}
      </div>
      <div class="idea-actions">
        <button class="iconbtn ${playing ? 'on' : ''}" data-act="play" aria-label="${playing ? 'Stop' : 'Play this line'}">${playing ? '■' : '▶'}</button>
        <button class="iconbtn heart ${isFav(line.id) ? 'on' : ''}" data-act="fav" aria-label="Save to favorites">${isFav(line.id) ? '♥' : '♡'}</button>
      </div>
    </div>
    ${ui.helpFor === line.id && gloss ? `<p class="gloss">${esc(gloss)}</p>` : ''}
    <div class="strip">${line.slots.map((s, si) => slotHTML(line, s, si, { locks })).join('')}</div>
    ${sel ? `<div class="idea-more">
      ${line.warn ? `<div class="warn">⚠ ${esc(line.warn)}</div>` : ''}
      ${lockMode ? `<div class="lock-hint">Tap the bars you love to lock them, then tap Vary. Locked bars stay; the rest is rewritten.</div>` : ''}
      <div class="card-tabs seg" role="tablist">${CARD_TABS.map(([v, l]) => `<button role="tab" aria-selected="${S.cardTab === v}" aria-checked="${S.cardTab === v}" data-ctab="${v}">${l}</button>`).join('')}</div>
      <div class="panel">${panelHTML(line)}</div>
      <div class="row-actions">
        <button class="btn ${lockMode ? 'primary' : ''}" data-act="lock">🔒 ${lockMode ? 'Done' : 'Lock'}</button>
        <button class="btn" data-act="vary">↻ Vary${locks.size ? ` (${locks.size}🔒)` : ''}</button>
        <button class="btn" data-act="practice">Practice</button>
        <button class="btn" data-act="stage">Stage</button>
      </div>
    </div>` : '<div class="tap-hint">Tap to open</div>'}
  </article>`;
}

function renderIdeas() {
  const box = $('#ideas');
  $('#backBtn').hidden = !ui.history.length;
  if (ui.parseError) { box.innerHTML = `<div class="card muted">Fix the chords above to see ideas.</div>`; return; }
  if (!ui.ideas.length) { box.innerHTML = `<div class="card muted">No ideas fit these settings. Try another moment or set of chords.</div>`; return; }
  box.innerHTML = ui.ideas.map(ideaHTML).join('');
  const selCard = box.querySelector('.idea.sel');
  if (selCard && S.cardTab === 'neck') { renderLinesBoard(); fillMinis(selCard, selectedLine()); }
}

function renderLines() {
  renderSetup();
  renderGuide();
  renderIdeas();
}

function bindLines() {
  $('#anotherBtn').onclick = () => {
    ui.history.push({ ideas: ui.ideas, sel: ui.sel, round: ui.round });
    if (ui.history.length > 12) ui.history.shift();
    ui.round++;
    regenerate({ keepSel: false });
    toast('Fresh ideas · Back brings the last ones back');
  };
  $('#backBtn').onclick = () => {
    const prev = ui.history.pop();
    if (!prev) return;
    Object.assign(ui, { ideas: prev.ideas, sel: prev.sel, round: prev.round });
    renderLines();
  };
  $('#aiBtn').onclick = askAI;
  $('#ideas').addEventListener('click', onIdeaClick);
  $('#ideas').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('idea')) onIdeaClick(e); });
}

function onIdeaClick(e) {
  const card = e.target.closest('.idea');
  if (!card) return;
  const id = card.dataset.id;
  const line = ui.ideas.find((l) => l.id === id);
  if (!line) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  const slotEl = e.target.closest('[data-slot]');
  const ctab = e.target.closest('[data-ctab]');
  const bchord = e.target.closest('[data-bchord]');
  const labels = e.target.closest('[data-labels]');
  if (!act && slotEl && ui.lockMode === id) {
    const set = ui.locks[id] || (ui.locks[id] = new Set());
    const si = +slotEl.dataset.slot;
    set.has(si) ? set.delete(si) : set.add(si);
    slotEl.classList.toggle('locked', set.has(si));
    const vary = card.querySelector('[data-act="vary"]');
    if (vary) vary.textContent = `↻ Vary${set.size ? ` (${set.size}🔒)` : ''}`;
    return;
  }
  if (ctab) { S.cardTab = ctab.dataset.ctab; saveSettings(); return renderIdeas(); }
  if (bchord) { ui.boardChord = bchord.dataset.bchord === 'all' ? null : +bchord.dataset.bchord; return renderIdeas(); }
  if (labels) { S.labels = labels.dataset.labels; saveSettings(); return renderIdeas(); }
  if (act === 'help') { ui.helpFor = ui.helpFor === id ? null : id; return renderIdeas(); }
  if (act === 'play') return togglePlay(line, 'card');
  if (act === 'fav') return toggleFav(line);
  if (act === 'lock') { ui.lockMode = ui.lockMode === id ? null : id; return renderIdeas(); }
  if (act === 'vary') return vary(line);
  if (act === 'practice') { ui.practiceId = id; return go('practice'); }
  if (act === 'stage') return openStage(ui.ideas.indexOf(line));
  if (e.target.closest('.idea-more')) return;
  if (ui.sel !== id) {
    ui.sel = id;
    ui.boardChord = null;
    rememberLast(line);
    renderIdeas();
    requestAnimationFrame(() => $('.idea.sel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } else if (slotEl && S.cardTab === 'neck') {
    ui.boardChord = ui.boardChord === +slotEl.dataset.slot ? null : +slotEl.dataset.slot;
    renderIdeas();
  }
}

async function vary(line) {
  const locks = [...(ui.locks[line.id] || [])];
  const c = ctx();
  let next = null;
  if (line.type === 'ai' && hasKey(store.get('wll.aikey', ''))) {
    try {
      setAiStatus('Asking for a variation that keeps your locked bars…');
      const res = await aiIdeas(c, store.get('wll.aikey', ''), { locks, line, favorites: favs() });
      next = res[0];
      setAiStatus('');
    } catch (err) { setAiStatus(err.message, true); return; }
  } else {
    next = varyLine(c, line, locks, Math.floor(Math.random() * 1e6));
  }
  if (!next) { toast('No other variation fits here. Unlock a bar and try again.'); return; }
  next.ctxKey = line.ctxKey;
  const idx = ui.ideas.findIndex((l) => l.id === line.id);
  ui.ideas[idx] = next;
  ui.locks[next.id] = new Set(locks);
  if (ui.lockMode === line.id) ui.lockMode = next.id;
  ui.sel = next.id;
  rememberLast(next);
  renderIdeas();
  toast(locks.length ? `Kept ${locks.length} bar${locks.length > 1 ? 's' : ''}, rewrote the rest` : 'New variation');
}

function toggleFav(line) {
  const list = favs();
  const id = favId(line.id);
  const i = list.findIndex((f) => f.id === id);
  const t = taste();
  if (i >= 0) {
    list.splice(i, 1);
    t[line.type] = Math.max(0, (t[line.type] || 0) - 1);
    toast('Removed from favorites');
  } else {
    list.unshift({
      id, name: line.name, numbers: line.numbers, names: line.names, type: line.type,
      key: S.key, progression: progNumbers(), feel: S.feel, intensity: S.intensity, capo: S.capo, band: { ...S.band },
      line, savedAt: Date.now(),
    });
    t[line.type] = (t[line.type] || 0) + 1;
    toast('Saved. New ideas will lean this way.');
  }
  store.set('wll.favs', list.slice(0, 200));
  store.set('wll.taste', t);
  renderIdeas();
}

function setAiStatus(msg, err = false) {
  const el = $('#aiStatus');
  el.textContent = msg;
  el.classList.toggle('err', err);
}

async function askAI() {
  const key = store.get('wll.aikey', '');
  if (!hasKey(key)) {
    toast('Add your AI key in Settings first');
    go('settings');
    setTimeout(() => $('#aiKey').focus(), 300);
    return;
  }
  if (ui.aiBusy || ui.parseError) return;
  ui.aiBusy = true;
  const btn = $('#aiBtn');
  btn.disabled = true;
  btn.innerHTML = '<span>✦</span> Thinking…';
  setAiStatus('Writing new lines, then checking every note against the theory rules…');
  try {
    const sel = selectedLine();
    const locks = sel ? [...(ui.locks[sel.id] || [])] : [];
    const res = await aiIdeas(ctx(), key, { favorites: favs(), locks, line: locks.length ? sel : null });
    const k = ctxKey();
    res.forEach((l) => { l.ctxKey = k; });
    const fresh = res.filter((l) => !ui.ideas.some((x) => x.id === l.id));
    ui.history.push({ ideas: ui.ideas, sel: ui.sel, round: ui.round });
    ui.ideas = [...fresh, ...ui.ideas].slice(0, 9);
    ui.sel = fresh[0]?.id || ui.sel;
    renderLines();
    setAiStatus(`${fresh.length} AI idea${fresh.length === 1 ? '' : 's'} passed the rules.`);
    $('#ideas').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setAiStatus(err.message || 'AI request failed', true);
  } finally {
    ui.aiBusy = false;
    btn.disabled = false;
    btn.innerHTML = '<span>✦</span> AI';
  }
}

// ---------- playback ----------
function togglePlay(line, from) {
  if (player.playing && ui.playingId === (line?.id ?? 'chords')) { stopPlay(); return; }
  startPlay(line, from);
}

function startPlay(line, from) {
  if (ui.listenStop && from !== 'practice') stopListening();
  player.start({
    key: S.key, chords: ui.chords, line, bpm: S.bpm, meter: S.meter, sound: S.sound,
    guide: from === 'practice' ? S.guide && !ui.listenStop && !!line : !!line,
    click: from === 'practice' ? S.click : false,
    countIn: from === 'practice' ? S.countIn : false,
  });
  ui.playingId = line?.id ?? 'chords';
  ui.playFrom = from;
  ui.lastNowKey = '';
  ui.lastChord = -1;
  if (line) rememberLast(line);
  syncPlayButtons();
  if (from === 'card') renderIdeas();
  requestAnimationFrame(tickUI);
}

function stopPlay() {
  player.stop();
  ui.playingId = null;
  ui.current = null;
  syncPlayButtons();
  $$('.slot.now, .tcol.now').forEach((x) => x.classList.remove('now'));
  $$('#beats i').forEach((i) => i.classList.remove('on', 'count'));
  if (S.view === 'lines') renderIdeas();
  if (S.view === 'practice') renderPracticeBoard();
}

function syncPlayButtons() {
  const on = player.playing;
  $('#playBtn').classList.toggle('playing', on && ui.playFrom === 'practice');
  $('#stagePlay').classList.toggle('playing', on && ui.playFrom === 'stage');
}

function eventAt(slot, frac) {
  if (!slot) return null;
  let cur = null;
  slot.events.forEach((e, i) => { if (frac + 0.001 >= e.at) cur = { e, i }; });
  return cur;
}

function markNow(sel, current) {
  const root = $(sel);
  if (!root) return;
  root.querySelectorAll('.dot.now').forEach((d) => d.classList.remove('now'));
  (current || []).forEach((c) => root.querySelector(`.dot[data-s="${c.string}"][data-f="${c.fret}"]`)?.classList.add('now'));
}

function tickUI() {
  if (!player.playing) return;
  const pos = player.position();
  if (pos) {
    const line = lineById(ui.playingId);
    const ticks = S.meter === '6/8' ? 6 : 4;
    const beatIdx = Math.floor((pos.counting ? Math.max(0, pos.frac) : pos.frac) * ticks);
    $$('#beats i').forEach((d, i) => { d.classList.toggle('on', i === beatIdx && !pos.counting); d.classList.toggle('count', pos.counting && i <= beatIdx); });
    if (!pos.counting) {
      const ci = pos.chordIndex;
      const slot = line?.slots[ci];
      const ev = eventAt(slot, pos.frac);
      const nowKey = ci + ':' + (ev?.i ?? -1);
      if (nowKey !== ui.lastNowKey) {
        ui.lastNowKey = nowKey;
        const notes = ev ? ev.e.notes : [];
        ui.current = notes.filter((n) => n.pos).map((n) => ({ string: n.pos.string, fret: n.pos.fret }));
        ui.targets = notes.map((n) => n.midi);
        $$('.slot.now').forEach((x) => x.classList.remove('now'));
        $$(`.idea[data-id="${CSS.escape(ui.playingId)}"] [data-slot="${ci}"]`).forEach((x) => x.classList.add('now'));
        $$('#practiceTab .tcol').forEach((x) => x.classList.toggle('now', +x.dataset.col === ci));
        updateNow(ci, notes);
        if (S.view === 'practice' && ci !== ui.lastChord) renderPracticeBoard();
        if (ui.stageOpen && ui.playFrom === 'stage' && ci !== ui.stageChord) { ui.stageChord = ci; renderStage(); }
        ui.lastChord = ci;
        markNow(S.view === 'practice' ? '#practiceBoard' : '#linesBoard', ui.current);
      }
    } else {
      $('#nowChord').textContent = 'Count…';
    }
  }
  requestAnimationFrame(tickUI);
}

function updateNow(ci, notes) {
  const chord = ui.chords[ci];
  if (!chord) return;
  $('#nowChord').textContent = pretty(chordName(S.key, chord));
  $('#nowNum').textContent = notes.length ? notes.map((n) => pretty(n.deg)).join('+') : '';
  $('#nowNote').innerHTML = notes.length ? notes.map((n) => `${pretty(n.name)} <small>${n.pos ? STRING_NAMES[n.pos.string] + n.pos.rel : ''}</small>`).join('<br>') : `<small>${pretty(chord.label)}</small>`;
}

// ---------- NECK ----------
function renderNeck() {
  $('#neckKey').textContent = pretty(S.key);
  keyButtons($('#neckKeyGrid'));
  $('#labelSeg').innerHTML = [['numbers', 'Numbers'], ['notes', 'Notes'], ['both', 'Both']].map(([v, l]) => `<button role="radio" aria-checked="${S.labels === v}" data-labels="${v}">${l}</button>`).join('');
  const tog = (k, l) => `<button class="toggle" role="switch" aria-checked="${!!S[k]}" data-ntog="${k}"><i></i>${l}</button>`;
  $('#neckToggles').innerHTML = tog('sky', 'Sky Shape') + tog('box', 'Home Box') + tog('pentOnly', 'Pentatonic only');
  $('#neckChords').innerHTML = [`<button class="chip ${ui.neckChord == null ? 'on' : ''}" data-nchord="none">No chord</button>`]
    .concat(ui.chords.map((c, i) => `<button class="chip ${ui.neckChord === i ? 'on' : ''}" data-nchord="${i}"><b>${pretty(chordName(S.key, c))}</b> <small>${pretty(c.label)}</small></button>`)).join('');
  const box = homeBoxFret(S.key);
  const R = skyRootFret(S.key);
  const relBox = box - S.capo;
  $('#shapeFacts').innerHTML = `
    <div><span class="sw" style="background:var(--violet)"></span><b>Home Box</b> (minor pentatonic box) starts at <b>fret ${box}</b>${S.capo ? ` (fret ${relBox >= 0 ? relBox : relBox + 12} above the capo)` : ''} on the low E string.</div>
    <div><span class="sw" style="background:var(--cyan)"></span><b>Sky Shape</b>: the 1 sits on the B string at <b>fret ${R}</b>${S.capo ? ` (${R - S.capo} above the capo)` : ''}. A compact, singing shape on the top three strings.</div>`;
  renderNeckBoard();
}

function renderNeckBoard() {
  const v = narrow();
  const box = homeBoxFret(S.key);
  const sky = skyShape(S.key);
  const boxSet = new Set();
  if (S.box) for (let s = 0; s < 6; s++) for (let f = box; f <= box + 3; f++) {
    const deg = DIATONIC[[0, 2, 4, 5, 7, 9, 11].indexOf(((TUNING[s] + f - keyPc(S.key)) % 12 + 12) % 12)];
    if (PENTATONIC.includes(deg)) boxSet.add(s + ':' + f);
  }
  const skySet = new Set(S.sky ? sky.map((p) => p.string + ':' + p.fret) : []);
  const svg = boardSVG({
    key: S.key, capo: S.capo, orientation: v ? 'v' : 'h', range: [0, v ? 17 : 22], labels: S.labels, mode: 'neck', lefty: S.lefty,
    chord: ui.neckChord != null ? ui.chords[ui.neckChord] : null,
    box: S.box ? box : null, sky: S.sky ? sky : null, boxSet, skySet,
    only: S.pentOnly ? new Set(PENTATONIC) : null,
    onNote: (s, f) => pluck(TUNING[s] + f),
  });
  $('#neckBoard').replaceChildren(svg);
}

function bindNeck() {
  $('#neckKeyGrid').onclick = onKeyPick;
  $('#labelSeg').onclick = (e) => { const b = e.target.closest('[data-labels]'); if (!b) return; S.labels = b.dataset.labels; saveSettings(); renderNeck(); };
  $('#neckToggles').onclick = (e) => { const b = e.target.closest('[data-ntog]'); if (!b) return; S[b.dataset.ntog] = !S[b.dataset.ntog]; saveSettings(); renderNeck(); };
  $('#neckChords').onclick = (e) => { const b = e.target.closest('[data-nchord]'); if (!b) return; ui.neckChord = b.dataset.nchord === 'none' ? null : +b.dataset.nchord; renderNeck(); };
}

// ---------- PRACTICE ----------
function practiceLine() {
  if (ui.practiceId === 'chords') return null;
  return lineById(ui.practiceId) || selectedLine();
}

function renderPractice() {
  const line = practiceLine();
  const opts = [`<option value="chords">Chords only (no guide line)</option>`]
    .concat(ui.ideas.map((l, i) => `<option value="${esc(l.id)}">Idea ${i + 1}: ${esc(l.name)} · ${esc(pretty(l.numbers))}</option>`))
    .concat(favs().filter((f) => f.key === S.key && f.capo === S.capo && f.progression === progNumbers()).map((f) => `<option value="${esc(f.line.id)}">♥ ${esc(f.name)} · ${esc(pretty(f.numbers))}</option>`));
  const sel = $('#practiceLine');
  sel.innerHTML = opts.join('');
  sel.value = line ? line.id : 'chords';
  $('#bpmVal').textContent = S.bpm;
  $('#bpmUnit').textContent = S.meter === '6/8' ? 'BPM ♩.' : 'BPM ♩';
  $('#meterSeg').innerHTML = ['4/4', '6/8'].map((m) => `<button role="radio" aria-checked="${S.meter === m}" data-meter="${m}">${m}</button>`).join('');
  $('#soundSeg').innerHTML = [['piano', 'Piano'], ['pad', 'Pad']].map(([v, l]) => `<button role="radio" aria-checked="${S.sound === v}" data-sound="${v}">${l}</button>`).join('');
  const tog = (k, l, on) => `<button class="toggle" role="switch" aria-checked="${on}" data-ptog="${k}"><i></i>${l}</button>`;
  $('#practiceToggles').innerHTML = tog('guide', 'Guide note', S.guide) + tog('click', 'Click', S.click) + tog('countIn', 'Count-in', S.countIn) + tog('listen', '🎤 Listen', !!ui.listenStop);
  const ticks = S.meter === '6/8' ? 6 : 4;
  $('#beats').innerHTML = Array.from({ length: ticks }, () => '<i></i>').join('');
  $('#practiceTab').innerHTML = line ? tabHTML(line) : '<p class="muted">Pick a line above to see its tab. Chords only is great for improvising: try the numbers on the neck.</p>';
  if (!player.playing) updateNow(0, line?.slots[0]?.events[0]?.notes || []);
  $('#micMeter').hidden = !ui.listenStop;
  renderPracticeBoard();
}

function renderPracticeBoard() {
  const line = practiceLine();
  const c = ctx();
  const ci = player.playing && ui.playFrom === 'practice' ? (player.position()?.chordIndex ?? 0) : null;
  const svg = boardSVG({
    key: S.key, capo: S.capo, orientation: narrow() ? 'v' : 'h', range: boardRange(line, c.zone), lefty: S.lefty,
    labels: S.labels, mode: 'lines', zone: c.zone,
    chord: ci != null && ci >= 0 ? ui.chords[ci] : null,
    line: line ? lineNotesFor(line) : [], current: ui.current,
    onNote: (s, f) => pluck(TUNING[s] + f),
  });
  $('#practiceBoard').replaceChildren(svg);
}

function bindPractice() {
  $('#practiceLine').onchange = (e) => { ui.practiceId = e.target.value; if (player.playing) stopPlay(); renderPractice(); };
  $('#playBtn').onclick = () => {
    if (player.playing && ui.playFrom === 'practice') return stopPlay();
    const line = practiceLine();
    startPlay(line, 'practice');
    if (!line) ui.playingId = 'chords';
  };
  const setBpm = (b) => {
    S.bpm = Math.max(40, Math.min(160, b));
    $('#bpmVal').textContent = S.bpm;
    saveSettings();
    restartIfPlaying();
  };
  $('#bpmDown').onclick = () => setBpm(S.bpm - 2);
  $('#bpmUp').onclick = () => setBpm(S.bpm + 2);
  $('#tapBtn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const t = $('#tapBtn');
    t.classList.add('hit'); setTimeout(() => t.classList.remove('hit'), 90);
    const b = tapTempo();
    if (b) { S.bpm = b; $('#bpmVal').textContent = b; saveSettings(); clearTimeout(ui.tapDeb); ui.tapDeb = setTimeout(() => setBpm(S.bpm), 900); }
  });
  $('#meterSeg').onclick = (e) => { const b = e.target.closest('[data-meter]'); if (!b) return; S.meter = b.dataset.meter; saveSettings(); restartIfPlaying(); renderPractice(); };
  $('#soundSeg').onclick = (e) => { const b = e.target.closest('[data-sound]'); if (!b) return; S.sound = b.dataset.sound; saveSettings(); restartIfPlaying(); renderPractice(); };
  $('#practiceToggles').onclick = async (e) => {
    const b = e.target.closest('[data-ptog]'); if (!b) return;
    const k = b.dataset.ptog;
    if (k === 'listen') { ui.listenStop ? stopListening() : await startListening(); renderPractice(); return; }
    S[k] = !S[k]; saveSettings(); restartIfPlaying(); renderPractice();
  };
}

function restartIfPlaying() {
  if (player.playing) startPlay(lineById(ui.playingId), ui.playFrom);
}

async function startListening() {
  try {
    ui.listenStop = await createListener((m) => onPitch(m));
    toast('Listening. The guide note is muted so the mic hears only you.');
    restartIfPlaying();
  } catch {
    toast('Microphone not available. Allow mic access to use Listen.');
    ui.listenStop = null;
  }
}
function stopListening() {
  ui.listenStop?.();
  ui.listenStop = null;
  restartIfPlaying();
}

let lastMicPaint = 0;
function onPitch(m) {
  const now = performance.now();
  if (now - lastMicPaint < 60) return;
  lastMicPaint = now;
  const ring = $('#micRing');
  if (!ring) return;
  if (m == null) { ring.className = 'mic-ring'; $('#micNote').textContent = '–'; $('#micCents').textContent = ''; return; }
  const rounded = Math.round(m);
  const deg = DIATONIC.find((d) => (keyPc(S.key) + degreeSemis(d)) % 12 === ((rounded % 12) + 12) % 12);
  $('#micNote').textContent = deg ? pretty(deg) : '♪';
  const targets = ui.targets || [];
  if (!player.playing || !targets.length) {
    ring.className = 'mic-ring';
    $('#micCents').textContent = pretty(spellMidi(rounded));
    $('#micMsg').textContent = player.playing ? 'Rest here. Silence is part of the line.' : 'Press play, then play the highlighted note.';
    return;
  }
  const best = targets.map((t) => ({ t, d: (m - t) * 100 })).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
  const samePc = targets.some((t) => ((t - rounded) % 12 + 12) % 12 === 0);
  const cents = Math.round(best.d);
  $('#micCents').textContent = Math.abs(cents) < 400 ? `${cents > 0 ? '+' : ''}${cents}¢` : pretty(spellMidi(rounded));
  if (Math.abs(best.d) <= 35) { ring.className = 'mic-ring good'; $('#micMsg').textContent = 'Right on it.'; }
  else if (samePc || Math.abs(best.d) <= 90) { ring.className = 'mic-ring near'; $('#micMsg').textContent = samePc ? 'Right note, different octave.' : cents > 0 ? 'A little sharp.' : 'A little flat.'; }
  else { ring.className = 'mic-ring bad'; $('#micMsg').textContent = `Aim for ${targets.map((t) => pretty(spellMidi(t))).join(' + ')}.`; }
}
const spellMidi = (m) => spell(S.key, ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'][((m - keyPc(S.key)) % 12 + 12) % 12]);

// ---------- TRAIN ----------
const DRILLS = [['find', 'Find the number'], ['hear', 'Name that number']];
function renderTrain() {
  $('#drillSeg').innerHTML = DRILLS.map(([v, l]) => `<button role="radio" aria-checked="${S.drill === v}" data-drill="${v}">${l}</button>`).join('');
  if (!ui.drill || ui.drill.type !== S.drill) newDrill();
  const d = ui.drill;
  const best = store.get('wll.best', {})[S.drill + S.key] || 0;
  const score = `<div class="score"><span><b>${d.score}</b>right</span><span><b>${d.streak}</b>streak</span><span><b>${best}</b>best in ${pretty(S.key)}</span></div>`;
  if (S.drill === 'find') {
    $('#drill').innerHTML = `<div class="card drill">
      <div class="ask"><div class="q">Key of ${pretty(S.key)}. Tap any</div><div class="big">${pretty(d.target)}</div><div class="q">on the neck${S.capo ? ` (capo ${S.capo})` : ''}</div></div>
      ${score}<div class="feedback ${d.fb?.cls || ''}">${d.fb?.msg || ''}</div></div>
      <div class="card board-card"><div class="board-wrap" id="drillBoard"></div></div>`;
    const svg = boardSVG({
      key: S.key, capo: S.capo, orientation: narrow() ? 'v' : 'h', range: [0, narrow() ? 15 : 17], labels: 'numbers', mode: 'neck', quiz: !d.reveal, lefty: S.lefty,
      onNote: (s, f, deg) => answerFind(s, f, deg),
    });
    if (d.reveal) svg.querySelectorAll('.dot').forEach((g) => { if (g.dataset.deg === d.target) g.classList.add('reveal'); else g.classList.add('dim'); });
    if (d.hit) svg.querySelector(`.dot[data-s="${d.hit.s}"][data-f="${d.hit.f}"]`)?.classList.add(d.hit.ok ? 'right' : 'wrong');
    $('#drillBoard').replaceChildren(svg);
  } else {
    $('#drill').innerHTML = `<div class="card drill">
      <div class="ask"><div class="q">Key of ${pretty(S.key)}. Listen to the chord, then the note.</div><div class="big">?</div><div class="q">Which number is it?</div></div>
      <div class="answers">${['1', '2', '3', '4', '5', '6', '7'].map((n) => `<button data-ans="${n}" class="${d.picked === n ? (n === d.target ? 'right' : 'wrong') : d.picked && n === d.target ? 'right' : ''}">${n}</button>`).join('')}<button data-ans="replay" style="font-size:16px;font-family:var(--ui)">▶ Again</button></div>
      ${score}<div class="feedback ${d.fb?.cls || ''}">${d.fb?.msg || ''}</div>
      <p class="muted small" style="text-align:center;margin:0">Tip: sing up from 1. Hear the pull of 4 and 7, the openness of 2 and 6.</p></div>`;
  }
}

function newDrill(keepScore = true) {
  const prev = ui.drill;
  const pool = S.drill === 'find' ? ['1', '2', '3', '4', '5', '6', '7', '1', '5', '3', '6', '2'] : ['1', '2', '3', '4', '5', '6', '7', '1', '3', '5'];
  let target;
  do { target = pool[Math.floor(Math.random() * pool.length)]; } while (prev && target === prev.target && Math.random() < 0.8);
  const keep = keepScore && prev?.type === S.drill;
  ui.drill = { type: S.drill, target, score: keep ? prev.score : 0, streak: keep ? prev.streak : 0, fb: null, picked: null, reveal: false, hit: null };
}

function bumpBest(d) {
  const best = store.get('wll.best', {});
  const k = S.drill + S.key;
  if (d.streak > (best[k] || 0)) { best[k] = d.streak; store.set('wll.best', best); }
}

function answerFind(s, f, deg) {
  const d = ui.drill;
  if (d.reveal) return;
  pluck(TUNING[s] + f);
  const ok = deg === d.target;
  d.hit = { s, f, ok };
  if (ok) {
    d.score++; d.streak++; bumpBest(d);
    d.fb = { cls: 'good', msg: `Yes: ${pretty(spell(S.key, deg))} is the ${pretty(deg)}.` };
    renderTrain();
    setTimeout(() => { newDrill(); ui.drill.fb = d.fb; renderTrain(); }, 650);
  } else {
    d.streak = 0;
    d.reveal = true;
    d.fb = { cls: 'bad', msg: `That's the ${pretty(deg)}. Here are all the ${pretty(d.target)}s.` };
    renderTrain();
    setTimeout(() => { newDrill(); renderTrain(); }, 1600);
  }
}

function playHear() {
  const d = ui.drill;
  drone(S.key, makeChord('1'), 2.6);
  const midi = 60 + ((keyPc(S.key) + degreeSemis(d.target)) % 12);
  setTimeout(() => tone(midi, 1.6), 900);
}

function bindTrain() {
  $('#drillSeg').onclick = (e) => { const b = e.target.closest('[data-drill]'); if (!b) return; S.drill = b.dataset.drill; saveSettings(); newDrill(false); renderTrain(); if (S.drill === 'hear') playHear(); };
  $('#drill').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ans]'); if (!b) return;
    const d = ui.drill;
    if (b.dataset.ans === 'replay') return playHear();
    if (d.picked) return;
    d.picked = b.dataset.ans;
    if (d.picked === d.target) { d.score++; d.streak++; bumpBest(d); d.fb = { cls: 'good', msg: `Yes, the ${d.target}.` }; }
    else { d.streak = 0; d.fb = { cls: 'bad', msg: `It was the ${d.target}.` }; }
    renderTrain();
    setTimeout(() => { newDrill(); renderTrain(); playHear(); }, 1500);
  });
}

// ---------- SETTINGS ----------
function renderSettings() {
  $('#setLabels').innerHTML = [['numbers', 'Numbers'], ['notes', 'Notes'], ['both', 'Both']].map(([v, l]) => `<button role="radio" aria-checked="${S.labels === v}" data-labels="${v}">${l}</button>`).join('');
  $('#setLefty').setAttribute('aria-checked', !!S.lefty);
  $('#aiKey').value = store.get('wll.aikey', '') || '';
  $('#offlineState').textContent = navigator.serviceWorker?.controller ? '✓ Works offline on this device.' : '';
}

function bindSettings() {
  $('#setLabels').onclick = (e) => { const b = e.target.closest('[data-labels]'); if (!b) return; S.labels = b.dataset.labels; saveSettings(); renderSettings(); };
  $('#setLefty').onclick = () => { S.lefty = !S.lefty; saveSettings(); renderSettings(); toast(S.lefty ? 'Left-handed necks on' : 'Right-handed necks'); };
  $('#aiKeyForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#aiKey').value.trim();
    if (v && !hasKey(v)) return toast('That doesn’t look like an Anthropic key (sk-ant-…)');
    v ? store.set('wll.aikey', v) : store.del('wll.aikey');
    toast(v ? 'AI key saved on this device' : 'AI key removed');
  };
  $('#replayIntro').onclick = () => { store.del('wll.seenIntro'); go('home'); };
  $('#clearData').onclick = () => {
    if (!confirm('Clear favorites, songs, recent chords, settings and the AI key from this device?')) return;
    ['wll.settings', 'wll.favs', 'wll.songs', 'wll.recent', 'wll.taste', 'wll.aikey', 'wll.best', 'wll.last', 'wll.seenIntro'].forEach(store.del);
    location.reload();
  };
}

// ---------- STAGE (follow mode) ----------
function openStage(idx = 0) {
  if (!ui.ideas.length) return toast('No ideas yet');
  ui.stageOpen = true;
  ui.stageIdx = Math.max(0, idx);
  ui.stageChord = 0;
  $('#stage').hidden = false;
  document.body.style.overflow = 'hidden';
  renderStage();
  try { navigator.wakeLock?.request('screen').then((w) => { ui.wake = w; }).catch(() => {}); } catch { /* unsupported */ }
}
function closeStage() {
  ui.stageOpen = false;
  $('#stage').hidden = true;
  document.body.style.overflow = '';
  if (ui.playFrom === 'stage' && player.playing) stopPlay();
  ui.wake?.release?.().catch(() => {});
  ui.wake = null;
  if (S.view === 'lines') renderIdeas();
}
function renderStage() {
  const line = ui.ideas[ui.stageIdx];
  if (!line) return;
  ui.sel = line.id;
  const n = line.slots.length;
  const ci = ((ui.stageChord % n) + n) % n;
  const ni = (ci + 1) % n;
  const cur = line.slots[ci], nxt = line.slots[ni];
  const pc = slotParts(cur, true), pn = slotParts(nxt, true);
  const cc = cur.explainChord || cur.chord, nc = nxt.explainChord || nxt.chord;
  $('#stageMeta').innerHTML = `Key <b>${pretty(S.key)}</b>${S.capo ? ` · Capo ${S.capo}` : ''} · ${esc(FEEL_SHORT[S.feel])} · ${LEVEL_WORD[S.intensity]}`;
  $('#stageCount').textContent = `${ui.stageIdx + 1}/${ui.ideas.length}`;
  const tension = cur.events.some((e) => e.notes.some((x) => x.tension));
  const following = player.playing && ui.playFrom === 'stage';
  $('#stageBody').innerHTML = `
    <div class="stage-name">${esc(line.name)}</div>
    <div class="follow" id="followTap" role="button" tabindex="0" aria-label="Next chord">
      <div class="now-box ${tension ? 'tension' : ''}">
        <div class="lbl">Now · <b>${pretty(chordName(S.key, cc))}</b> <em>${pretty(cc.label)}</em></div>
        <div class="big ${pc.multi || pc.dyad ? 'multi' : ''}">${pc.num}</div>
        <div class="nm">${pc.nm} <span>${pc.fr}</span></div>
      </div>
      <div class="next-box">
        <div class="lbl">Next · <b>${pretty(chordName(S.key, nc))}</b> <em>${pretty(nc.label)}</em></div>
        <div class="mid ${pn.multi || pn.dyad ? 'multi' : ''}">${pn.num}</div>
        <div class="nm">${pn.nm} <span>${pn.fr}</span></div>
      </div>
    </div>
    <div class="stage-strip">${line.slots.map((s, si) => slotHTML(line, s, si, { stage: true, now: si === ci })).join('')}</div>
    <div class="stage-guide">${following ? 'Following the playback' : 'Tap the big numbers each time the chord changes'}</div>
    ${line.warn ? `<div class="stage-guide warn-t">⚠ ${esc(line.warn)}</div>` : ''}`;
}
function bindStage() {
  $('#stageBtn').onclick = () => { if (!ui.ideas.length) regenerate(); openStage(Math.max(0, ui.ideas.findIndex((l) => l.id === ui.sel))); };
  $('#stageClose').onclick = closeStage;
  const step = (d) => {
    if (ui.playFrom === 'stage' && player.playing) stopPlay();
    ui.stageIdx = (ui.stageIdx + d + ui.ideas.length) % ui.ideas.length;
    ui.stageChord = 0;
    renderStage();
  };
  $('#stagePrev').onclick = () => step(-1);
  $('#stageNext').onclick = () => step(1);
  $('#stageAnother').onclick = () => { if (player.playing) stopPlay(); ui.round++; regenerate({ keepSel: false }); ui.stageIdx = 0; ui.stageChord = 0; renderStage(); };
  $('#stagePlay').onclick = () => {
    const line = ui.ideas[ui.stageIdx];
    if (player.playing && ui.playFrom === 'stage') stopPlay(); else { ui.stageChord = 0; startPlay(line, 'stage'); }
    renderStage();
  };
  $('#stageBody').addEventListener('click', (e) => {
    const slot = e.target.closest('[data-slot]');
    if (slot) { ui.stageChord = +slot.dataset.slot; return renderStage(); }
    if (e.target.closest('#followTap')) { ui.stageChord++; renderStage(); }
  });
  let x0 = null, y0 = null;
  $('#stage').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  $('#stage').addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    x0 = null;
  });
  document.addEventListener('keydown', (e) => {
    if (!ui.stageOpen) return;
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowDown' || e.key === 'Enter') { ui.stageChord++; renderStage(); }
    else if (e.key === 'ArrowUp') { ui.stageChord--; renderStage(); }
    else if (e.key === 'Escape') closeStage();
    else if (e.key === ' ') { e.preventDefault(); $('#stagePlay').click(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (ui.stageOpen && document.visibilityState === 'visible' && !ui.wake) navigator.wakeLock?.request('screen').then((w) => { ui.wake = w; }).catch(() => {});
  });
}

// ---------- navigation ----------
function go(view) {
  if (player.playing && view !== S.view) stopPlay();
  if (view !== 'practice' && ui.listenStop) stopListening();
  S.view = view;
  saveSettings();
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('.tabbar [data-go]').forEach((b) => b.setAttribute('aria-current', b.dataset.go === view ? 'page' : 'false'));
  $('#settingsBtn').classList.toggle('on', view === 'settings');
  if (view === 'home') renderHome();
  if (view === 'lines') { if (!ui.ideas.length) regenerate(); renderLines(); }
  if (view === 'neck') renderNeck();
  if (view === 'practice') renderPractice();
  if (view === 'train') renderTrain();
  if (view === 'settings') renderSettings();
  window.scrollTo({ top: 0 });
}

// ---------- boot ----------
function boot() {
  parse();
  if (ui.parseError) { S.progression = DEFAULTS.progression; parse(); }
  renderChrome();
  bindHome(); bindSetup(); bindLines(); bindNeck(); bindPractice(); bindTrain(); bindSettings(); bindStage();
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (!g) return;
    e.preventDefault();
    go(g.dataset.go);
  });
  regenerate({ keepSel: false });
  // returning visitors land where they left off (never mid-settings)
  go(!S.view || S.view === 'settings' || S.view === 'saved' ? 'home' : S.view);
  let lastNarrow = narrow();
  window.addEventListener('resize', () => {
    if (narrow() === lastNarrow) return;
    lastNarrow = narrow();
    if (S.view === 'lines') renderIdeas();
    if (S.view === 'neck') renderNeckBoard();
    if (S.view === 'practice') renderPracticeBoard();
    if (S.view === 'train') renderTrain();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// Unlock audio on the first touch anywhere (iOS needs a gesture; also resumes a sleeping context).
document.addEventListener('pointerdown', () => unlockAudio(), { capture: true, passive: true });
boot();
