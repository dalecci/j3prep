// Optional AI ideas. Calls Claude straight from the browser with the user's own key
// (stored only on this device). Every note it suggests is re-checked by the rule engine.
import { spell, chordName, colorsFor, roleOf, feelById, INTENSITY, DEGREE_SEMIS, degreePc } from './theory.js';
import { midisInRange } from './fretboard.js';
import { finalize } from './lines.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';
const DEGS = ['1', '2', '3', '4', '5', '6', '7', 'b7', 'b6', 'b3', '#4', 'b2'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'when', 'slots'],
        properties: {
          name: { type: 'string' },
          when: { type: 'string' },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['notes'],
              properties: {
                notes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['deg', 'beat', 'beats'],
                    properties: {
                      deg: { type: 'string', enum: DEGS },
                      beat: { type: 'integer' },
                      beats: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export function hasKey(key) {
  return typeof key === 'string' && key.trim().startsWith('sk-ant-');
}

function describe(ctx, opts) {
  const feel = feelById(ctx.feel);
  const lvl = INTENSITY[ctx.intensity];
  const chords = ctx.chords.map((c, i) => {
    const colors = colorsFor(c).map((x) => `${x.deg}${x.tension ? ' (tension, resolve to ' + x.resolve + ')' : ''} = ${x.feel}`).join('; ');
    return `Bar ${i + 1}: ${c.label} (${chordName(ctx.key, c)}). Chord tones: ${c.tones.join(' ')}. Colors: ${colors || 'none'}.`;
  }).join('\n');
  const band = ctx.band;
  const locked = (opts.locks || []).map((i) => {
    const s = opts.line?.slots[i];
    return s ? `Bar ${i + 1}: keep exactly ${s.events.map((e) => e.notes.map((n) => `${n.deg}@beat${1 + e.at * 4}x${e.len * 4}`).join('+')).join(' ')}` : '';
  }).filter(Boolean).join('\n');
  const liked = (opts.favorites || []).slice(0, 6).map((f) => `- ${f.name}: ${f.numbers}`).join('\n');
  return `Key of ${ctx.key}. One bar of 4 beats per chord, looping.
${chords}

Feel: ${feel.name}. ${feel.blurb}
Intensity ${ctx.intensity}/5: ${lvl.name}. ${lvl.notes}
Band: vocal ${band.vocal}, keys ${band.keys}${ctx.keysMelody ? ' (keys has the melody: only pedal tones, swells, and short answers up high)' : ''}.
${locked ? '\nLocked bars (copy these exactly, write new notes only for the other bars):\n' + locked : ''}
${liked ? '\nLines this player saved as favorites (match their taste):\n' + liked : ''}`;
}

const SYSTEM = `You write lead guitar lines for spontaneous, quiet worship moments. You think in Nashville numbers (scale degrees of the key).
Rules you must follow:
- The major pentatonic (1 2 3 5 6) is always safe. 4 and 7 are tension notes.
- Any note held 2 beats or longer must be a chord tone or a listed color of that bar's chord.
- At most one tension note per line. A tension note is long and soft and resolves on the next chord change to the note given.
- Short passing notes (1 beat or less) may step between chord tones.
- Leave space. Fewer notes is better at low intensity. Never fill every beat.
- Lines should be singable and melodic, with a clear shape (rise, fall, or answer).
Return 3 different ideas. Each idea has one entry in slots per bar, in order. beat is 1-4, beats is the length in beats (0.5 to 4). Use an empty notes array for a bar of silence.
Give each idea a short evocative name (2-4 words) and one sentence in "when" on when to use it.`;

/** Ask Claude for ideas. Returns finalized lines (only the ones that pass the rule check). */
export async function aiIdeas(ctx, apiKey, opts = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: describe(ctx, opts) }],
    }),
  });
  if (!res.ok) {
    let msg = `AI request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error?.message) msg += ': ' + j.error.message; } catch { /* ignore */ }
    if (res.status === 401) msg = 'That API key was rejected. Check it in Saved → Settings.';
    throw new Error(msg);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('The AI declined this request. Try different settings.');
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The AI returned no ideas.');
  let parsed;
  try { parsed = JSON.parse(textBlock.text); } catch { throw new Error('The AI reply was not readable. Try again.'); }
  const out = [];
  for (const idea of parsed.ideas || []) {
    const line = toLine(ctx, idea, opts);
    if (line) out.push(line);
  }
  if (!out.length) throw new Error('The AI ideas broke the theory rules, so they were filtered out. Try again.');
  return out;
}

/** Convert an AI idea into a line skeleton, re-checking every note against the rules. */
function toLine(ctx, idea, opts) {
  if (!Array.isArray(idea.slots) || idea.slots.length !== ctx.chords.length) return null;
  const { lo, hi } = ctx.zone;
  let prev = Math.round((lo + hi) / 2);
  let tensions = 0;
  const lockSet = new Set(opts.locks || []);
  const slots = [];
  for (let i = 0; i < ctx.chords.length; i++) {
    const chord = ctx.chords[i];
    if (lockSet.has(i) && opts.line) {
      const kept = JSON.parse(JSON.stringify(opts.line.slots[i]));
      kept.events.forEach((e) => e.notes.forEach((n) => { delete n.pos; if (n.slideFrom) delete n.slideFrom.pos; }));
      slots.push(kept);
      const last = kept.events[kept.events.length - 1]?.notes[0];
      if (last) prev = last.midi;
      continue;
    }
    const notes = (idea.slots[i].notes || []).filter((n) => DEGS.includes(n.deg) && n.beat >= 1 && n.beat <= 4).sort((a, b) => a.beat - b.beat);
    const events = [];
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k];
      const at = (n.beat - 1) / 4;
      const nextAt = k + 1 < notes.length ? (notes[k + 1].beat - 1) / 4 : 1;
      const len = Math.max(0.125, Math.min(n.beats / 4, nextAt - at, 1 - at));
      if (at < (events[events.length - 1]?.at ?? -1) + 0.01) continue;
      const role = roleOf(n.deg, chord);
      const long = len >= 0.5;
      if (long && role === 'outside') return null;
      if (role === 'tension') { tensions++; if (tensions > 1) return null; }
      const pc = degreePc(ctx.key, n.deg);
      const cands = midisInRange(pc, lo - 3, hi + 3);
      if (!cands.length) return null;
      const midi = cands.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0];
      prev = midi;
      events.push({ at, len, notes: [{ deg: n.deg, midi, tension: role === 'tension', soft: role === 'tension', passing: !long && role === 'outside' }] });
    }
    slots.push({ chordIndex: i, chord, events, accent: events.some((e) => e.notes[0].tension) });
  }
  if (!slots.some((s) => s.events.length)) return null;
  // Rule: a tension note resolves on the next chord change. Enforce it.
  slots.forEach((s, i) => {
    const t = s.events.flatMap((e) => e.notes).find((n) => n.tension);
    if (!t) return;
    const color = colorsFor(ctx.chords[i]).find((c) => c.deg === t.deg);
    if (!color?.resolve) return;
    const j = (i + 1) % slots.length;
    if (j === i || lockSet.has(j)) return;
    const resMidi = midisInRange(degreePc(ctx.key, color.resolve), t.midi - 3, t.midi + 3)[0];
    if (resMidi == null) return;
    const rest = slots[j].events.filter((e) => e.at > 0.01);
    slots[j] = { ...slots[j], resolves: true, events: [{ at: 0, len: rest[0]?.at || 1, notes: [{ deg: color.resolve, midi: resMidi, resolution: true }] }, ...rest] };
  });
  const line = {
    type: 'ai',
    name: '✨ ' + String(idea.name || 'AI idea').slice(0, 40),
    when: String(idea.when || '').slice(0, 200),
    tips: ['Swell into long notes', 'Slow, wide vibrato', 'Leave space for the leader'],
    slots,
  };
  // silent bars render as rests
  line.slots.forEach((s) => { if (!s.events.length) s.events = []; });
  return finalize(ctx, line);
}

export { spell };
