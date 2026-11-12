// Web Audio: synthesized piano + pad, a guitar-ish guide voice with delay and reverb,
// a look-ahead scheduler, tap tempo, and mic pitch detection. No samples, no dependencies.
import { keyPc, degreeSemis } from './theory.js';

let ac = null;
let bus = null;

export function audio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const master = ac.createGain();
    master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    master.connect(comp).connect(ac.destination);
    const verb = ac.createConvolver();
    verb.buffer = impulse(ac, 3.2, 2.4);
    const verbGain = ac.createGain(); verbGain.gain.value = 0.42;
    verb.connect(verbGain).connect(master);
    bus = { master, verb };
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function send(node, dry = 1, wet = 0.4) {
  const d = ac.createGain(); d.gain.value = dry;
  const w = ac.createGain(); w.gain.value = wet;
  node.connect(d).connect(bus.master);
  node.connect(w).connect(bus.verb);
}

/** Soft felt-piano note. */
function piano(midi, t, dur, vel = 0.5) {
  const out = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(5200, hz(midi) * 8), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, hz(midi) * 2), t + 1.6);
  lp.connect(out);
  const partials = [[1, 1], [2, 0.32], [3, 0.12], [4, 0.05]];
  partials.forEach(([m, g], i) => {
    const o = ac.createOscillator();
    o.type = i === 0 ? 'triangle' : 'sine';
    o.frequency.value = hz(midi) * m;
    o.detune.value = (Math.random() - 0.5) * 4;
    const gg = ac.createGain(); gg.gain.value = g;
    o.connect(gg).connect(lp);
    o.start(t); o.stop(t + dur + 1.6);
  });
  const peak = vel * 0.22;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(peak, t + 0.008);
  out.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.9);
  out.gain.exponentialRampToValueAtTime(peak * 0.12, t + dur);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
  send(out, 0.8, 0.5);
}

/** Warm pad note. */
function pad(midi, t, dur, vel = 0.5) {
  const out = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.4;
  lp.connect(out);
  [-7, 7].forEach((det) => {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(midi);
    o.detune.value = det;
    o.connect(lp);
    o.start(t); o.stop(t + dur + 2);
  });
  const peak = vel * 0.06;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(peak, t + Math.min(0.9, dur * 0.4));
  out.gain.setValueAtTime(peak, t + dur);
  out.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
  send(out, 0.7, 0.9);
}

let delayNode = null;
function guitarBus(beatSec) {
  if (!delayNode) {
    const inp = ac.createGain();
    const dl = ac.createDelay(2);
    const fb = ac.createGain(); fb.gain.value = 0.34;
    const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2400;
    const wet = ac.createGain(); wet.gain.value = 0.33;
    inp.connect(dl); dl.connect(tone).connect(fb).connect(dl);
    tone.connect(wet);
    send(inp, 1, 0.55);
    send(wet, 1, 0.6);
    delayNode = { inp, dl };
  }
  delayNode.dl.delayTime.setValueAtTime(beatSec * 0.75, ac.currentTime); // dotted eighth
  return delayNode.inp;
}

/** Clean, neck-pickup-ish guide note with volume swell, slide and slow vibrato. */
function guitar(midi, t, dur, { swell = true, slideFrom = null, beatSec = 0.88, soft = false } = {}) {
  const dest = guitarBus(beatSec);
  const out = ac.createGain();
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900; lp.Q.value = 0.7;
  lp.connect(out).connect(dest);
  const o = ac.createOscillator(); o.type = 'sawtooth';
  const o2 = ac.createOscillator(); o2.type = 'sine';
  const g2 = ac.createGain(); g2.gain.value = 0.6;
  const f = hz(midi);
  if (slideFrom) {
    o.frequency.setValueAtTime(hz(slideFrom), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
    o2.frequency.setValueAtTime(hz(slideFrom), t);
    o2.frequency.exponentialRampToValueAtTime(f, t + 0.14);
  } else { o.frequency.value = f; o2.frequency.value = f; }
  // slow, wide vibrato that starts late
  const lfo = ac.createOscillator(); lfo.frequency.value = 4.6;
  const depth = ac.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(0, t + Math.min(0.6, dur * 0.4));
  depth.gain.linearRampToValueAtTime(f * 0.009, t + Math.min(1.4, dur * 0.8));
  lfo.connect(depth); depth.connect(o.frequency); depth.connect(o2.frequency);
  o.connect(lp); o2.connect(g2).connect(lp);
  const peak = soft ? 0.05 : 0.08;
  out.gain.setValueAtTime(0, t);
  if (swell) out.gain.linearRampToValueAtTime(peak, t + Math.min(0.45, dur * 0.35));
  else { out.gain.linearRampToValueAtTime(peak * 1.2, t + 0.01); out.gain.exponentialRampToValueAtTime(peak * 0.7, t + 0.3); }
  out.gain.setValueAtTime(swell ? peak : peak * 0.7, t + Math.max(0.05, dur - 0.25));
  out.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
  [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + dur + 0.5); });
}

function click(t, accent) {
  const o = ac.createOscillator(); o.frequency.value = accent ? 1760 : 1180;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.12, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(bus.master);
  o.start(t); o.stop(t + 0.06);
}

/** Close voicing of a chord: bass note + triad around middle C. */
export function voicing(key, chord) {
  const root = keyPc(key);
  const pcs = chord.tones.slice(0, 3).map((d) => (root + degreeSemis(d)) % 12);
  const bassPc = (root + degreeSemis(chord.bass || chord.root)) % 12;
  const bass = 36 + ((bassPc - 0 + 12) % 12) + (bassPc < 4 ? 12 : 0);
  const triad = pcs.map((pc) => { let m = 55 + ((pc - 7 + 12) % 12); return m; }).sort((a, b) => a - b);
  return [bass, ...triad];
}

/**
 * Player: loops a progression with chords (whole notes) and an optional guide line.
 * opts: { key, chords, line, bpm, meter '4/4'|'6/8', sound 'piano'|'pad', guide, click, countIn, onBar(barIdx, chordIdx), onStop }
 */
export function createPlayer() {
  let timer = null;
  let state = null;

  function barSeconds(bpm, meter) {
    return meter === '6/8' ? 2 * (60 / bpm) : 4 * (60 / bpm);
  }

  function scheduleBar(barIndex, t, o) {
    const n = o.chords.length;
    const ci = barIndex % n;
    const bar = barSeconds(o.bpm, o.meter);
    const chord = o.chords[ci];
    const notes = voicing(o.key, chord);
    notes.forEach((m, i) => (o.sound === 'pad' ? pad(m, t, bar, i === 0 ? 0.7 : 0.55) : piano(m, t, bar, i === 0 ? 0.62 : 0.45)));
    if (o.sound === 'pad') piano(notes[0], t, bar, 0.25);
    if (o.click) {
      const ticks = o.meter === '6/8' ? 6 : 4;
      for (let k = 0; k < ticks; k++) click(t + (k * bar) / ticks, k === 0 || (o.meter === '6/8' && k === 3));
    }
    if (o.guide && o.line) {
      const slot = o.line.slots[ci];
      const beatSec = 60 / o.bpm;
      slot?.events.forEach((e) => e.notes.forEach((nn) => {
        if (nn.tie) return;
        // extend tied notes across following bars
        let len = e.len * bar;
        if (e.len >= 1) for (let j = 1; j < n; j++) { const nx = o.line.slots[(ci + j) % n]?.events[0]?.notes[0]; if (nx?.tie && nx.midi === nn.midi && barIndex + j < Infinity) len += bar; else break; }
        guitar(nn.midi, t + e.at * bar, Math.max(0.15, len - 0.02), { swell: e.len >= 0.5, slideFrom: nn.slideFrom?.midi, beatSec, soft: nn.soft });
      }));
    }
  }

  function start(o) {
    stop(true);
    const ctx = audio();
    const bar = barSeconds(o.bpm, o.meter);
    const t0 = ctx.currentTime + 0.12;
    const countIn = o.countIn ? bar : 0;
    if (o.countIn) {
      const ticks = o.meter === '6/8' ? 6 : 4;
      for (let k = 0; k < ticks; k++) click(t0 + (k * bar) / ticks, k === 0);
    }
    state = { o, t0: t0 + countIn, bar, next: 0, countIn, startedAt: t0 };
    const tick = () => {
      while (state && state.t0 + state.next * state.bar < ctx.currentTime + 0.35) {
        scheduleBar(state.next, state.t0 + state.next * state.bar, state.o);
        state.next++;
        if (o.bars && state.next >= o.bars) { /* stop scheduling after N bars */ }
      }
    };
    tick();
    timer = setInterval(tick, 40);
    return state;
  }

  /** Where are we? { bar, chordIndex, frac, counting } */
  function position() {
    if (!state || !ac) return null;
    const t = ac.currentTime;
    if (t < state.t0) return { counting: true, frac: (t - state.startedAt) / Math.max(0.01, state.countIn), bar: -1, chordIndex: -1 };
    const pos = (t - state.t0) / state.bar;
    const bar = Math.floor(pos);
    return { bar, chordIndex: bar % state.o.chords.length, frac: pos - bar, counting: false };
  }

  function update(partial) { if (state) Object.assign(state.o, partial); }

  function stop(silent) {
    if (timer) clearInterval(timer);
    timer = null;
    const was = !!state;
    state = null;
    if (bus && was && !silent) {
      // quick fade so ringing notes don't hang
      const g = bus.master.gain;
      const t = ac.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.0001, t + 0.25);
      g.linearRampToValueAtTime(0.9, t + 0.6);
    }
  }

  return { start, stop, position, update, get playing() { return !!state; } };
}

/** Play one note now (for taps on the fretboard). */
export function pluck(midi, opts = {}) {
  audio();
  guitar(midi, ac.currentTime + 0.01, opts.dur || 1.2, { swell: false, beatSec: 0.88 });
}

/** Play a drone chord (for ear training). */
export function drone(key, chord, dur = 2.5) {
  audio();
  voicing(key, chord).forEach((m) => pad(m, ac.currentTime + 0.02, dur, 0.6));
}

export function tone(midi, dur = 1.4) {
  audio();
  piano(midi, ac.currentTime + 0.02, dur, 0.7);
}

// ---------- tap tempo ----------
export function createTapTempo() {
  let taps = [];
  return function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2200) taps = [];
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length < 2) return null;
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    return Math.max(40, Math.min(160, Math.round(60000 / avg)));
  };
}

// ---------- mic pitch ----------
export async function createListener(onPitch) {
  const ctx = audio();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let raf = 0;
  const loop = () => {
    an.getFloatTimeDomainData(buf);
    const f = detectPitch(buf, ctx.sampleRate);
    onPitch(f ? 69 + 12 * Math.log2(f / 440) : null);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); src.disconnect(); };
}

/** Autocorrelation pitch detection with parabolic interpolation. Returns Hz or null. */
export function detectPitch(buf, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.012) return null;
  let r1 = 0, r2 = buf.length - 1;
  const thr = 0.2;
  for (let i = 0; i < buf.length / 2; i++) if (Math.abs(buf[i]) < thr) { r1 = i; break; }
  for (let i = 1; i < buf.length / 2; i++) if (Math.abs(buf[buf.length - i]) < thr) { r2 = buf.length - i; break; }
  const b = buf.slice(r1, r2);
  const n = b.length;
  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) { let s = 0; for (let i = 0; i < n - lag; i++) s += b[i] * b[i + lag]; c[lag] = s; }
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxv = -1, maxp = -1;
  for (let i = d; i < n; i++) if (c[i] > maxv) { maxv = c[i]; maxp = i; }
  if (maxp <= 0) return null;
  const x1 = c[maxp - 1] ?? c[maxp], x2 = c[maxp], x3 = c[maxp + 1] ?? c[maxp];
  const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  const T0 = a ? maxp - bb / (2 * a) : maxp;
  const f = sampleRate / T0;
  return f > 70 && f < 1400 ? f : null;
}
