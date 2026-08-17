// ============ CONFIG ============
// Shares the family-sit Supabase project with behavior_* and j3prep_*.
const SUPABASE_URL = 'https://ikypiznimyzidmyzzoys.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXBpem5pbXl6aWRteXp6b3lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MzUzODIsImV4cCI6MjA5MzMxMTM4Mn0.Ee0FWPHjLBSOIFXWmdPSjG8oT3QmKyKG14BF8oPGgjk';
const GATE_PIN = '4545';
const ADMIN_PIN = '1212';

// Grade labels keyed by first name (roster comes from behavior_kids).
const GRADES = { jayden: 'Grade 5', jackson: 'Grade 2', jameson: 'Kindergarten' };

const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  kids: [],
  points: [],          // behavior_points
  generated: [],       // homeschool_generated (planner output — wins when present)
  tasks: [],           // homeschool_tasks (template fallback)
  log: [],             // homeschool_task_log
  custom: [],          // homeschool_custom_tasks
  progress: [],        // homeschool_progress
  rewards: [],         // homeschool_rewards
  currentKidId: null,
  isAdmin: false,
  adminKidId: null,    // selected kid in admin tabs
  currentTab: 'overview',
  today: todayKey(),
};

// ---------- date helpers ----------
function pad(n) { return (n < 10 ? '0' : '') + n; }
function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayKey() { return dateKey(new Date()); }
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Mon=0 .. Sun=6
  x.setDate(x.getDate() - day);
  return x;
}
function weekRange(ref) {
  const start = mondayOf(ref || new Date());
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start: dateKey(start), end: dateKey(end) };
}
// School week = Monday–Friday (5 days). Returns array of {key, dow, short}.
function weekdaysOf(ref) {
  const mon = mondayOf(ref || new Date());
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const out = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    out.push({ key: dateKey(d), dow: names[i], short: (d.getMonth() + 1) + '/' + d.getDate() });
  }
  return out;
}
function isWeekend(key) {
  const p = key.split('-');
  const w = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
  return w === 0 || w === 6;
}
function prettyDate(key) {
  const parts = key.split('-');
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
function gradeFor(name) { return GRADES[(name || '').trim().toLowerCase().split(' ')[0]] || 'Student'; }

// ---------- shared-resource stagger (1 computer for Math, 1 basket for Shooting) ----------
function timeToMin(hhmm) { const p = (hhmm || '00:00').split(':'); return (+p[0]) * 60 + (+p[1]); }
function minToTime(m) { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
function firstName(name) { return (name || '').trim().toLowerCase().split(' ')[0]; }
function gradeRank(name) {
  const g = gradeFor(name);
  const mm = /Grade\s*(\d+)/i.exec(g);
  if (mm) return parseInt(mm[1], 10);
  if (/kinder/i.test(g)) return 0;
  return -1;
}
function rotationOrder() {
  return state.kids.slice().sort(function (a, b) { return gradeRank(b.name) - gradeRank(a.name); });
}
function rotationIndex(kidId) {
  return Math.max(0, rotationOrder().findIndex(function (k) { return k.id === kidId; }));
}

// COMPUTER (Math): one machine, each child's two 30-min sessions are SEPARATED (math → other → math).
// Jameson (kindergarten) gets ONE 30-min session only. Ordered 30-min slots from COMPUTER_BASE.
const COMPUTER_BASE = '09:15';
const COMPUTER_SLOTS = [
  { kid: 'jayden',  title: 'Math (Part 1)' },
  { kid: 'jackson', title: 'Math (Part 1)' },
  { kid: 'jameson', title: 'Math (Part 1)' },   // Jameson's only math session
  { kid: 'jayden',  title: 'Math (Part 2)' },
  { kid: 'jackson', title: 'Math (Part 2)' },
];
function mathSlotStart(name, title) {
  const fn = firstName(name);
  const i = COMPUTER_SLOTS.findIndex(function (s) { return s.kid === fn && s.title === title; });
  return i < 0 ? null : minToTime(timeToMin(COMPUTER_BASE) + i * 30);
}
// BASKET (200 shots): one hoop, staggered oldest-first, back-to-back.
const SHOT_BASE = '12:45', SHOT_STEP = 35;
function shotStart(kidId) { return minToTime(timeToMin(SHOT_BASE) + rotationIndex(kidId) * SHOT_STEP); }

// For a contended task + kid returns {start, resource}, {exclude:true} if the kid doesn't do it, or null.
function contendedSlot(taskTitle, kid) {
  if (taskTitle === 'Math (Part 1)' || taskTitle === 'Math (Part 2)') {
    const st = mathSlotStart(kid.name, taskTitle);
    return st === null ? { exclude: true } : { start: st, resource: '🖥️ computer' };
  }
  if (taskTitle === '200 shots') return { start: shotStart(kid.id), resource: '🏀 basket' };
  return null;
}
function taskExcludedForKid(taskTitle, kid) {
  const s = contendedSlot(taskTitle, kid);
  return !!(s && s.exclude);
}

// ---------- toast ----------
function toast(msg, type) {
  type = type || '';
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.className = 'toast ' + type; }, 2600);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------- PIN pad ----------
let pinBuffer = '', pinTarget = GATE_PIN, pinCallback = null;
function renderPinPad() {
  const pad = document.getElementById('pinPad');
  pad.innerHTML = '';
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach(function (k) {
    const b = document.createElement('button');
    b.className = 'pin-btn';
    b.textContent = k;
    if (k === '') { b.style.visibility = 'hidden'; }
    else if (k === '⌫') { b.onclick = function () { pinBuffer = pinBuffer.slice(0, -1); updatePinDisplay(); }; }
    else { b.onclick = function () { if (pinBuffer.length < 4) { pinBuffer += k; updatePinDisplay(); } }; }
    pad.appendChild(b);
  });
}
function updatePinDisplay() {
  document.querySelectorAll('#pinDisplay .pin-dot').forEach(function (d, i) { d.classList.toggle('filled', i < pinBuffer.length); });
  if (pinBuffer.length === 4) { setTimeout(checkPin, 120); }
}
function checkPin() {
  if (pinBuffer === pinTarget) {
    pinBuffer = ''; updatePinDisplay();
    document.getElementById('gateErr').textContent = '';
    if (pinCallback) { const cb = pinCallback; pinCallback = null; cb(); }
  } else {
    pinBuffer = ''; updatePinDisplay();
    const card = document.getElementById('gateCard');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    document.getElementById('gateErr').textContent = 'Wrong code';
  }
}
function askPin(target, label, cb) {
  pinTarget = target; pinCallback = cb;
  document.getElementById('gateTitle').textContent = label || 'Enter code';
  document.getElementById('gateSub').textContent = '';
  document.getElementById('gateErr').textContent = '';
  showScreen('gateScreen');
}

function showScreen(id) {
  ['gateScreen', 'loginScreen', 'boardScreen', 'kidScreen', 'adminScreen'].forEach(function (s) {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}
function logout() {
  state.isAdmin = false; state.currentKidId = null;
  showScreen('loginScreen'); renderLogin();
}

// ---------- data load ----------
async function loadAll() {
  try {
    const r = await Promise.all([
      supa.from('behavior_kids').select('*').eq('active', true).order('sort_order'),
      supa.from('behavior_points').select('*').order('recorded_at', { ascending: false }),
      supa.from('homeschool_tasks').select('*').eq('active', true).order('sort_order'),
      supa.from('homeschool_task_log').select('*'),
      supa.from('homeschool_custom_tasks').select('*'),
      supa.from('homeschool_progress').select('*'),
      supa.from('homeschool_rewards').select('*').order('points_required'),
    ]);
    for (const res of r) { if (res.error) throw res.error; }
    state.kids = r[0].data || [];
    state.points = r[1].data || [];
    state.tasks = r[2].data || [];
    state.log = r[3].data || [];
    state.custom = r[4].data || [];
    state.progress = r[5].data || [];
    state.rewards = r[6].data || [];
    if (typeof loadGenerated === 'function') await loadGenerated();
  } catch (e) {
    console.error('loadAll failed', e);
    toast('Sync error: ' + (e.message || e), 'error');
    throw e;
  }
}

// ---------- scoring ----------
// Blocks produced by the Planner ("brain") for this kid+date, if a plan covers it.
function plannedForDay(kidId, dayKey) {
  if (!state.generated || !state.generated.length) return null;
  const rows = state.generated.filter(function (g) { return g.kid_id === kidId && g.task_date === dayKey; });
  if (!rows.length) return null;
  return rows.map(function (g) {
    return { id: g.id, title: g.title, icon: g.icon, start_time: g.start_time,
      duration_min: g.duration_min, target: null, points: g.points,
      category: null, source: 'planned', resource: g.resource,
      teacher_id: g.teacher_id };
  });
}

// Tasks a kid should see on a given date.
// A published plan wins; otherwise fall back to the fixed template + custom tasks.
function tasksForDay(kidId, dayKey) {
  const planned = plannedForDay(kidId, dayKey);
  if (planned) {
    const extra = state.custom.filter(function (c) {
      return c.task_date === dayKey && (c.kid_id === null || c.kid_id === kidId);
    }).map(function (c) {
      return { id: c.id, title: c.title, icon: c.icon || '📝', start_time: null,
        duration_min: null, target: null, points: c.points, category: c.category, source: 'custom' };
    });
    return planned.concat(extra);
  }
  const kid = kidById(kidId) || { id: kidId, name: '' };
  const template = [];
  state.tasks.forEach(function (t) {
    const slot = contendedSlot(t.title, kid);
    if (slot && slot.exclude) return; // e.g. Jameson has no 2nd math session
    template.push({ id: t.id, title: t.title, icon: t.icon,
      start_time: slot ? slot.start : t.start_time,
      duration_min: t.duration_min, target: t.target, points: t.points, category: t.category,
      source: 'template', resource: slot ? slot.resource : null });
  });
  const customs = state.custom.filter(function (c) {
    return c.task_date === dayKey && (c.kid_id === null || c.kid_id === kidId);
  }).map(function (c) {
    return { id: c.id, title: c.title, icon: c.icon || '📝', start_time: null,
      duration_min: null, target: null, points: c.points, category: c.category, source: 'custom' };
  });
  return template.concat(customs);
}
function isDone(kidId, taskId, dayKey) {
  return state.log.some(function (l) { return l.kid_id === kidId && l.task_id === taskId && l.task_date === dayKey && l.done; });
}
// Task points earned this week (Mon–Sun) for a kid.
function taskPointsWeek(kidId, ref) {
  const wr = weekRange(ref);
  return state.log.filter(function (l) {
    return l.kid_id === kidId && l.done && l.task_date >= wr.start && l.task_date <= wr.end;
  }).reduce(function (s, l) { return s + (l.points || 0); }, 0);
}
// Behavior green/red/net this week for a kid.
function behaviorWeek(kidId, ref) {
  const wr = weekRange(ref);
  const startTs = new Date(wr.start + 'T00:00:00');
  const endTs = new Date(wr.end + 'T23:59:59');
  const kp = state.points.filter(function (p) {
    if (p.kid_id !== kidId) return false;
    const t = new Date(p.recorded_at);
    return t >= startTs && t <= endTs;
  });
  const green = kp.filter(function (p) { return p.amount > 0; }).reduce(function (s, p) { return s + p.amount; }, 0);
  const red = kp.filter(function (p) { return p.amount < 0; }).reduce(function (s, p) { return s + Math.abs(p.amount); }, 0);
  return { green: green, red: red, net: green - red };
}
// Behavior green/red/net all-time (across all weeks/months) for a kid.
function behaviorTotal(kidId) {
  const kp = state.points.filter(function (p) { return p.kid_id === kidId; });
  const green = kp.filter(function (p) { return p.amount > 0; }).reduce(function (s, p) { return s + p.amount; }, 0);
  const red = kp.filter(function (p) { return p.amount < 0; }).reduce(function (s, p) { return s + Math.abs(p.amount); }, 0);
  return { green: green, red: red, net: green - red };
}
function weekScore(kidId, ref) {
  return taskPointsWeek(kidId, ref) + behaviorWeek(kidId, ref).net;
}
function ascendStatus(cur, exp) {
  const diff = (cur || 0) - (exp || 0);
  if (exp === 0 && cur === 0) return { cls: 'ontrack', label: 'Not set' };
  if (diff > 0) return { cls: 'ahead', label: 'Ahead +' + diff };
  if (diff < 0) return { cls: 'behind', label: 'Behind ' + diff };
  return { cls: 'ontrack', label: 'On track' };
}

// ---------- login ----------
function renderLogin() {
  const grid = document.getElementById('tileGrid');
  grid.innerHTML = '';
  state.kids.forEach(function (kid) {
    const tile = document.createElement('button');
    tile.className = 'kid-tile';
    tile.style.background = kid.color || '#3b82f6';
    tile.innerHTML = '<div class="avatar">' + escapeHtml((kid.name || '?')[0]) + '</div>' +
      '<div>' + escapeHtml(kid.name) + '</div>' +
      '<div class="grade-badge">' + escapeHtml(gradeFor(kid.name)) + '</div>';
    tile.onclick = function () { openKid(kid.id); };
    grid.appendChild(tile);
  });
  const admin = document.createElement('button');
  admin.className = 'kid-tile admin';
  admin.innerHTML = '<div class="avatar">⚙️</div><div>Parent / Coach</div>';
  admin.onclick = function () { askPin(ADMIN_PIN, 'Parent code', openAdmin); };
  grid.appendChild(admin);
}

// ---------- STUDENT VIEW ----------
function openKid(kidId) {
  state.currentKidId = kidId; state.isAdmin = false;
  showScreen('kidScreen');
  renderKid();
}
function kidById(id) { return state.kids.find(function (k) { return k.id === id; }); }

// ---------- FAMILY BOARD (all three side by side) ----------
function openBoard() {
  state.isAdmin = false; state.currentKidId = null;
  showScreen('boardScreen');
  renderBoard();
}
function renderBoard() {
  const weekend = isWeekend(state.today);
  document.getElementById('boardDate').textContent = weekend ? 'Weekend' : prettyDate(state.today);
  const cols = document.getElementById('boardCols');
  cols.innerHTML = '';
  state.kids.forEach(function (kid) {
    const color = kid.color || '#3b82f6';
    const dayTasks = tasksForDay(kid.id, state.today);
    const done = dayTasks.filter(function (t) { return isDone(kid.id, t.id, state.today); }).length;
    const score = weekScore(kid.id);
    const col = document.createElement('div');
    col.className = 'board-col';
    col.innerHTML =
      '<div class="board-col-head" style="background: linear-gradient(135deg, ' + color + ', ' + shade(color, -30) + ')">' +
        '<div class="board-kid-name">' + escapeHtml(kid.name) + '</div>' +
        '<div class="board-kid-sub">' + escapeHtml(gradeFor(kid.name)) + '</div>' +
        '<div class="board-kid-score"><span>' + (weekend ? '—' : done + '/' + dayTasks.length + ' done') + '</span>' +
          '<span>' + score + ' pts</span></div>' +
      '</div>' +
      '<div class="board-tasks" id="boardTasks-' + kid.id + '"></div>';
    cols.appendChild(col);
    if (weekend) {
      document.getElementById('boardTasks-' + kid.id).innerHTML = '<div class="empty">No school today 🎉</div>';
    } else {
      renderTaskList('boardTasks-' + kid.id, kid.id, state.today, 'board');
    }
  });
}

function renderKid() {
  const kid = kidById(state.currentKidId);
  if (!kid) return;
  const color = kid.color || '#3b82f6';
  document.getElementById('kidTitle').textContent = 'J3 Homeschool';
  document.getElementById('kidHeader').style.background = 'linear-gradient(135deg, ' + color + ', ' + shade(color, -30) + ')';
  document.getElementById('kidName').textContent = kid.name;
  document.getElementById('kidSub').textContent = gradeFor(kid.name) + ' · week of ' + prettyDate(weekRange().start);
  document.getElementById('todayDateLabel').textContent = prettyDate(state.today);

  // score + ring
  const tPts = taskPointsWeek(state.currentKidId);
  const bh = behaviorWeek(state.currentKidId);
  const score = tPts + bh.net;
  document.getElementById('weekScore').textContent = score;
  document.getElementById('scoreBreakdown').innerHTML =
    '<span>✅ ' + tPts + ' tasks</span>' +
    '<span>🟢 +' + bh.green + '</span>' +
    '<span>🔴 −' + bh.red + '</span>';

  // today's completion ring (school is Mon–Fri)
  const weekend = isWeekend(state.today);
  const dayTasks = tasksForDay(state.currentKidId, state.today);
  if (weekend) {
    document.getElementById('todayRing').innerHTML = ringSvg(0, 'Weekend');
    document.getElementById('taskList').innerHTML = '<div class="empty">No school today — enjoy the weekend! 🎉<br>School runs Monday–Friday.</div>';
  } else {
    const doneCount = dayTasks.filter(function (t) { return isDone(state.currentKidId, t.id, state.today); }).length;
    const pct = dayTasks.length ? Math.round((doneCount / dayTasks.length) * 100) : 0;
    document.getElementById('todayRing').innerHTML = ringSvg(pct, doneCount + '/' + dayTasks.length);
    renderTaskList('taskList', state.currentKidId, state.today, 'kid');
  }
  renderKidProgress();
  const bhb = behaviorWeek(state.currentKidId);
  document.getElementById('bhGreen').textContent = bhb.green;
  document.getElementById('bhRed').textContent = bhb.red;
  document.getElementById('bhNet').textContent = bhb.net;
  const bhAll = behaviorTotal(state.currentKidId);
  document.getElementById('bhGreenAll').textContent = bhAll.green;
  document.getElementById('bhRedAll').textContent = bhAll.red;
  document.getElementById('bhNetAll').textContent = bhAll.net;
  renderKidRewards();
}

function ringSvg(pct, centerText) {
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return '<svg width="118" height="118" viewBox="0 0 118 118">' +
    '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="10"/>' +
    '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" ' +
    'stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '"/></svg>' +
    '<div class="ring-label"><div class="ring-pct">' + pct + '%</div><div class="ring-cap">' + escapeHtml(centerText) + '</div></div>';
}

// Minimum gap (minutes) between tasks that counts as a visible break.
const BREAK_MIN = 10;
// Interleave "break" rows into a time-sorted task list wherever there's empty time.
function withBreaks(tasks) {
  const rows = [];
  let coveredUntil = null;
  tasks.forEach(function (t) {
    if (t.start_time) {
      const start = timeToMin(t.start_time);
      if (coveredUntil !== null && start - coveredUntil >= BREAK_MIN) {
        rows.push({ isBreak: true, start_time: minToTime(coveredUntil), end_time: t.start_time, mins: start - coveredUntil });
      }
      const end = start + (t.duration_min || 0);
      coveredUntil = coveredUntil === null ? end : Math.max(coveredUntil, end);
    }
    rows.push(t);
  });
  return rows;
}

function renderTaskList(elId, kidId, dayKey, mode) {
  const list = document.getElementById(elId);
  const tasks = tasksForDay(kidId, dayKey).sort(function (a, b) {
    const at = a.start_time || '99:99', bt = b.start_time || '99:99';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  if (!tasks.length) { list.innerHTML = '<div class="empty">No tasks scheduled.</div>'; return; }
  list.innerHTML = '';
  withBreaks(tasks).forEach(function (t) {
    if (t.isBreak) {
      const b = document.createElement('div');
      b.className = 'task-row break-row';
      b.innerHTML =
        '<div class="task-time">' + t.start_time + '</div>' +
        '<div class="task-check break-check">☕</div>' +
        '<div class="task-icon"></div>' +
        '<div class="task-body"><div class="task-title">Break</div>' +
        '<div class="task-meta">' + t.start_time + '–' + t.end_time + ' · ' + t.mins + ' min free</div></div>';
      list.appendChild(b);
      return;
    }
    const done = isDone(kidId, t.id, dayKey);
    const row = document.createElement('div');
    row.className = 'task-row' + (done ? ' done' : '');
    const meta = [];
    if (t.target) meta.push(escapeHtml(t.target));
    else if (t.duration_min) meta.push(t.duration_min + ' min');
    if (t.resource) meta.push('your turn · ' + t.resource);
    if (t.teacher_id && typeof teacherById === 'function') {
      const tc = teacherById(t.teacher_id);
      if (tc) meta.push('with ' + tc.icon + ' ' + tc.name);
    }
    const tag = t.source === 'custom' ? '<span class="custom-tag">EXTRA</span>' : '';
    row.innerHTML =
      '<div class="task-time">' + (t.start_time || '') + '</div>' +
      '<div class="task-check">' + (done ? '✓' : '') + '</div>' +
      '<div class="task-icon">' + (t.icon || '📌') + '</div>' +
      '<div class="task-body"><div class="task-title">' + escapeHtml(t.title) + tag + '</div>' +
        (meta.length ? '<div class="task-meta">' + meta.join(' · ') + '</div>' : '') + '</div>' +
      '<div class="task-pts">+' + t.points + '</div>';
    row.onclick = function () { toggleTask(kidId, t, dayKey, mode); };
    list.appendChild(row);
  });
}

async function toggleTask(kidId, task, dayKey, mode) {
  const currentlyDone = isDone(kidId, task.id, dayKey);
  try {
    if (currentlyDone) {
      const { error } = await supa.from('homeschool_task_log').delete()
        .eq('kid_id', kidId).eq('task_id', task.id).eq('task_date', dayKey);
      if (error) throw error;
      state.log = state.log.filter(function (l) {
        return !(l.kid_id === kidId && l.task_id === task.id && l.task_date === dayKey);
      });
    } else {
      const row = { kid_id: kidId, task_id: task.id, task_date: dayKey, done: true, points: task.points, source: task.source };
      const { data, error } = await supa.from('homeschool_task_log')
        .upsert(row, { onConflict: 'kid_id,task_id,task_date' }).select();
      if (error) throw error;
      state.log = state.log.filter(function (l) {
        return !(l.kid_id === kidId && l.task_id === task.id && l.task_date === dayKey);
      });
      if (data && data[0]) state.log.push(data[0]);
    }
  } catch (e) {
    console.error('toggleTask failed', e);
    toast('Could not save: ' + (e.message || e), 'error');
    return;
  }
  if (mode === 'admin') { renderAdminToday(); renderAdminWeek(); renderOverview(); }
  else if (mode === 'board') { renderBoard(); }
  else { renderKid(); }
}

function renderKidProgress() {
  const wrap = document.getElementById('kidProgress');
  const rows = state.progress.filter(function (p) { return p.kid_id === state.currentKidId; })
    .sort(function (a, b) { return a.subject.localeCompare(b.subject); });
  if (!rows.length) { wrap.innerHTML = '<div class="empty">No subjects set yet.</div>'; return; }
  wrap.innerHTML = rows.map(function (p) {
    const st = ascendStatus(p.current_lesson, p.expected_lesson);
    return '<div class="prog-row"><div class="prog-subj">' + escapeHtml(p.subject) + '</div>' +
      '<div class="prog-lessons">lesson ' + (p.current_lesson || 0) + ' / ' + (p.expected_lesson || 0) + '</div>' +
      '<span class="pill ' + st.cls + '">' + st.label + '</span></div>';
  }).join('');
}

function rewardsForKid(kidId) {
  return state.rewards.filter(function (r) { return r.kid_id === null || r.kid_id === kidId; })
    .sort(function (a, b) { return a.points_required - b.points_required; });
}
function renderKidRewards() {
  const wrap = document.getElementById('kidRewards');
  const score = weekScore(state.currentKidId);
  const rewards = rewardsForKid(state.currentKidId);
  const congrats = document.getElementById('kidCongrats');
  const earned = rewards.filter(function (r) { return score >= r.points_required; });
  if (earned.length) {
    congrats.classList.remove('hidden');
    congrats.innerHTML = '<div class="congrats-card"><div class="big">🎉 Reward unlocked!</div>' +
      earned.map(function (r) { return '<div class="reward-row-c">' + escapeHtml(r.name) + '</div>'; }).join('') + '</div>';
  } else { congrats.classList.add('hidden'); congrats.innerHTML = ''; }

  if (!rewards.length) { wrap.innerHTML = '<div class="empty">No rewards set yet.</div>'; return; }
  wrap.innerHTML = rewards.map(function (r) {
    const pct = Math.max(0, Math.min(100, (score / r.points_required) * 100));
    const cls = score >= r.points_required ? 'over' : (score < 0 ? 'short' : '');
    const remaining = r.points_required - score;
    return '<div class="reward-row"><div class="reward-top"><span class="reward-name">' + escapeHtml(r.name) + '</span>' +
      '<span class="reward-points">' + Math.max(0, score) + '/' + r.points_required + '</span></div>' +
      '<div class="progress"><div class="progress-bar ' + cls + '" style="width:' + pct + '%"></div></div>' +
      (remaining > 0 ? '<div class="task-meta" style="margin-top:4px;">' + remaining + ' points to go</div>' : '') + '</div>';
  }).join('');
}

// simple hex shade
function shade(hex, amt) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return hex;
  const clamp = function (v) { return Math.max(0, Math.min(255, v)); };
  const r = clamp(parseInt(m[1], 16) + amt), g = clamp(parseInt(m[2], 16) + amt), b = clamp(parseInt(m[3], 16) + amt);
  return '#' + pad2(r) + pad2(g) + pad2(b);
}
function pad2(n) { const s = n.toString(16); return s.length < 2 ? '0' + s : s; }

// ---------- ADMIN VIEW ----------
function openAdmin() {
  state.isAdmin = true; state.currentKidId = null;
  state.adminKidId = state.kids[0] ? state.kids[0].id : null;
  showScreen('adminScreen');
  document.getElementById('cDate').value = state.today;
  populateScopeSelects();
  switchTab('overview');
  renderKidSwitchers();
  renderAdminAll();
}
function populateScopeSelects() {
  ['rScope', 'cScope'].forEach(function (id) {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="all">All kids</option>';
    state.kids.forEach(function (k) {
      const o = document.createElement('option'); o.value = k.id; o.textContent = k.name; sel.appendChild(o);
    });
  });
}
function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('#adminScreen .tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
  document.querySelectorAll('#adminScreen .tab-content').forEach(function (c) { c.classList.toggle('hidden', c.dataset.tab !== tab); });
  if (tab === 'brain' && typeof openBrain === 'function') openBrain();
}
function renderKidSwitchers() {
  ['kidSwitcherToday', 'kidSwitcherProg', 'kidSwitcherWeek'].forEach(function (id) {
    const sw = document.getElementById(id);
    if (!sw) return;
    sw.innerHTML = '';
    state.kids.forEach(function (k) {
      const b = document.createElement('button');
      b.textContent = k.name;
      b.className = k.id === state.adminKidId ? 'active' : '';
      if (k.id === state.adminKidId) b.style.background = k.color || '#3b82f6';
      b.onclick = function () { state.adminKidId = k.id; renderKidSwitchers(); renderAdminToday(); renderAdminProgress(); renderAdminWeek(); };
      sw.appendChild(b);
    });
  });
}
function renderAdminAll() {
  renderOverview(); renderAdminWeek(); renderAdminToday(); renderAdminSchedule();
  renderAdminProgress(); renderAdminRewards(); renderAdminCustom();
}

// Parent weekly grid: tasks (rows) x Mon–Fri (cols), did ✓ / did-not ✗ per day.
function renderAdminWeek() {
  const table = document.getElementById('weekGrid');
  if (!table || !state.adminKidId) { if (table) table.innerHTML = ''; return; }
  const days = weekdaysOf();
  document.getElementById('weekRangeLabel').textContent = days[0].dow + ' ' + days[0].short + ' – ' + days[4].dow + ' ' + days[4].short;

  // Rows = every distinct task this kid actually has across the week
  // (planner output when a plan is published, otherwise the fixed template).
  const seen = {}, template = [];
  days.forEach(function (d) {
    tasksForDay(state.adminKidId, d.key).forEach(function (t) {
      if (t.source === 'custom') return;
      const key = t.title;
      if (!seen[key]) { seen[key] = { id: t.id, title: t.title, icon: t.icon, start_time: t.start_time, ids: {} }; template.push(seen[key]); }
      seen[key].ids[d.key] = t.id;      // planned ids differ per day
    });
  });
  template.sort(function (a, b) {
    const at = a.start_time || '99:99', bt = b.start_time || '99:99'; return at < bt ? -1 : at > bt ? 1 : 0;
  });

  let head = '<thead><tr><th class="task-col">Task</th>';
  days.forEach(function (d) {
    const cls = d.key === state.today ? ' today-col' : '';
    head += '<th class="' + cls.trim() + '">' + d.dow + '<br>' + d.short + '</th>';
  });
  head += '</tr></thead>';

  const kid = kidById(state.adminKidId) || { id: state.adminKidId, name: '' };
  let body = '<tbody>';
  template.forEach(function (t) {
    const na = taskExcludedForKid(t.title, kid);
    body += '<tr><td class="task-col"><span class="task-col-icon">' + (t.icon || '📌') + '</span>' + escapeHtml(t.title) + '</td>';
    days.forEach(function (d) {
      const todayCls = d.key === state.today ? ' today-col' : '';
      const tid = (t.ids && t.ids[d.key]) || t.id;
      let cell;
      if (!t.ids[d.key]) cell = '<span class="wk-future">n/a</span>';
      else if (na) cell = '<span class="wk-future">n/a</span>';
      else if (isDone(state.adminKidId, tid, d.key)) cell = '<span class="wk-yes">✓</span>';
      else if (d.key <= state.today) cell = '<span class="wk-no">✗</span>';
      else cell = '<span class="wk-future">·</span>';
      body += '<td class="' + todayCls.trim() + '">' + cell + '</td>';
    });
    body += '</tr>';
  });
  // daily totals row
  body += '<tr class="total-row"><td class="task-col">Done / total</td>';
  days.forEach(function (d) {
    const todayCls = d.key === state.today ? ' today-col' : '';
    const dt = tasksForDay(state.adminKidId, d.key);
    const done = dt.filter(function (t) { return isDone(state.adminKidId, t.id, d.key); }).length;
    body += '<td class="' + todayCls.trim() + '">' + done + '/' + dt.length + '</td>';
  });
  body += '</tr></tbody>';

  table.innerHTML = head + body;
}

function renderOverview() {
  const cards = document.getElementById('overviewCards');
  cards.innerHTML = state.kids.map(function (k) {
    const s = weekScore(k.id);
    return '<div class="overview-card"><div class="overview-name">' + escapeHtml(k.name) + '</div>' +
      '<div class="overview-net">' + s + '</div><div class="overview-split">pts this week</div></div>';
  }).join('');

  const detail = document.getElementById('overviewDetail');
  detail.innerHTML = state.kids.map(function (k) {
    const tPts = taskPointsWeek(k.id);
    const bh = behaviorWeek(k.id);
    const bhAll = behaviorTotal(k.id);
    const dayTasks = tasksForDay(k.id, state.today);
    const done = dayTasks.filter(function (t) { return isDone(k.id, t.id, state.today); }).length;
    const prog = state.progress.filter(function (p) { return p.kid_id === k.id; });
    const behind = prog.filter(function (p) { return (p.current_lesson || 0) < (p.expected_lesson || 0); });
    const ahead = prog.filter(function (p) { return (p.current_lesson || 0) > (p.expected_lesson || 0); });
    let ascend = 'On track';
    if (behind.length) ascend = '<span class="pill behind">' + behind.length + ' behind</span>';
    else if (ahead.length) ascend = '<span class="pill ahead">' + ahead.length + ' ahead</span>';
    return '<div class="list-item"><div class="grow"><b>' + escapeHtml(k.name) + '</b> · ' + escapeHtml(gradeFor(k.name)) +
      '<div class="meta">Today ' + done + '/' + dayTasks.length + ' done · tasks +' + tPts + ' · wk 🟢' + bh.green + ' 🔴' + bh.red + ' · total net ' + bhAll.net + '</div></div>' +
      '<div>' + ascend + '</div></div>';
  }).join('');
}

function renderAdminToday() {
  document.getElementById('adminTodayDate').textContent = prettyDate(state.today);
  if (state.adminKidId) renderTaskList('adminTaskList', state.adminKidId, state.today, 'admin');
}

function renderRotation() {
  const table = document.getElementById('rotationTable');
  if (!table) return;
  const order = rotationOrder();
  const rows = [
    { title: 'Math (Part 1)', icon: '🖥️' },
    { title: 'Math (Part 2)', icon: '🖥️' },
    { title: '200 shots', icon: '🏀' },
  ];
  let head = '<thead><tr><th class="task-col">Activity</th>';
  order.forEach(function (k) { head += '<th>' + escapeHtml(k.name) + '</th>'; });
  head += '</tr></thead>';
  let body = '<tbody>';
  rows.forEach(function (row) {
    body += '<tr><td class="task-col"><span class="task-col-icon">' + row.icon + '</span>' + escapeHtml(row.title) + '</td>';
    order.forEach(function (k) {
      const slot = contendedSlot(row.title, k);
      const cell = (slot && slot.exclude) ? '<span class="wk-future">—</span>' : (slot ? slot.start : '');
      body += '<td>' + cell + '</td>';
    });
    body += '</tr>';
  });
  body += '</tbody>';
  table.innerHTML = head + body;
}
function renderAdminSchedule() {
  renderRotation();
  const wrap = document.getElementById('adminSchedule');
  const tasks = state.tasks.slice().sort(function (a, b) {
    const at = a.start_time || '99:99', bt = b.start_time || '99:99';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  if (!tasks.length) { wrap.innerHTML = '<div class="empty">No schedule blocks. Add one above.</div>'; return; }
  wrap.innerHTML = '';
  tasks.forEach(function (t) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = '<div class="grow">' + (t.icon || '📌') + ' <b>' + escapeHtml(t.title) + '</b>' +
      '<div class="meta">' + (t.start_time || '—') + ' · ' + (t.duration_min || '?') + ' min · +' + t.points + ' pts' +
      (t.target ? ' · ' + escapeHtml(t.target) : '') + '</div></div>';
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = 'Delete';
    del.onclick = function () { deleteTask(t.id); };
    item.appendChild(del);
    wrap.appendChild(item);
  });
}

async function addTask() {
  const title = document.getElementById('tTitle').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }
  const maxOrder = state.tasks.reduce(function (m, t) { return Math.max(m, t.sort_order || 0); }, 0);
  const row = {
    title: title,
    icon: document.getElementById('tIcon').value.trim() || '📌',
    start_time: document.getElementById('tStart').value.trim() || null,
    duration_min: parseInt(document.getElementById('tDur').value, 10) || 30,
    points: parseInt(document.getElementById('tPts').value, 10) || 5,
    category: document.getElementById('tCat').value,
    target: document.getElementById('tTarget').value.trim() || null,
    sort_order: maxOrder + 1, active: true,
  };
  try {
    const { data, error } = await supa.from('homeschool_tasks').insert(row).select();
    if (error) throw error;
    if (data && data[0]) state.tasks.push(data[0]);
    ['tTitle', 'tStart', 'tTarget'].forEach(function (id) { document.getElementById(id).value = ''; });
    toast('Block added', 'success');
    renderAdminSchedule(); renderAdminToday(); renderOverview();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}
async function deleteTask(id) {
  try {
    const { error } = await supa.from('homeschool_tasks').delete().eq('id', id);
    if (error) throw error;
    state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
    toast('Deleted', 'success');
    renderAdminSchedule(); renderAdminToday(); renderOverview();
  } catch (e) { console.error(e); toast('Delete failed: ' + (e.message || e), 'error'); }
}

function renderAdminProgress() {
  const wrap = document.getElementById('adminProgress');
  if (!state.adminKidId) { wrap.innerHTML = '<div class="empty">Pick a kid.</div>'; return; }
  const rows = state.progress.filter(function (p) { return p.kid_id === state.adminKidId; })
    .sort(function (a, b) { return a.subject.localeCompare(b.subject); });
  if (!rows.length) { wrap.innerHTML = '<div class="empty">No subjects yet. Add one below.</div>'; return; }
  wrap.innerHTML =
    '<div class="prog-edit-row"><div class="label" style="margin:0;">Subject</div>' +
    '<div class="label" style="margin:0;text-align:center;">Current</div>' +
    '<div class="label" style="margin:0;text-align:center;">Expected</div><div></div></div>';
  rows.forEach(function (p) {
    const st = ascendStatus(p.current_lesson, p.expected_lesson);
    const row = document.createElement('div');
    row.className = 'prog-edit-row';
    row.innerHTML = '<div class="subj">' + escapeHtml(p.subject) + '<br><span class="pill ' + st.cls + '" style="font-size:10px;">' + st.label + '</span></div>';
    const cur = document.createElement('input'); cur.type = 'number'; cur.value = p.current_lesson || 0;
    const exp = document.createElement('input'); exp.type = 'number'; exp.value = p.expected_lesson || 0;
    cur.onchange = function () { saveProgress(p.id, parseInt(cur.value, 10) || 0, parseInt(exp.value, 10) || 0); };
    exp.onchange = function () { saveProgress(p.id, parseInt(cur.value, 10) || 0, parseInt(exp.value, 10) || 0); };
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '✕';
    del.onclick = function () { deleteSubject(p.id); };
    row.appendChild(cur); row.appendChild(exp); row.appendChild(del);
    wrap.appendChild(row);
  });
}
async function saveProgress(id, cur, exp) {
  try {
    const { error } = await supa.from('homeschool_progress').update({ current_lesson: cur, expected_lesson: exp, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    const p = state.progress.find(function (x) { return x.id === id; });
    if (p) { p.current_lesson = cur; p.expected_lesson = exp; }
    toast('Saved', 'success');
    renderAdminProgress(); renderOverview();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}
async function addSubject() {
  const subject = document.getElementById('newSubject').value.trim();
  if (!subject) { toast('Enter a subject', 'error'); return; }
  if (!state.adminKidId) { toast('Pick a kid', 'error'); return; }
  try {
    const { data, error } = await supa.from('homeschool_progress')
      .upsert({ kid_id: state.adminKidId, subject: subject, current_lesson: 0, expected_lesson: 0 }, { onConflict: 'kid_id,subject' }).select();
    if (error) throw error;
    if (data && data[0]) {
      const existing = state.progress.find(function (x) { return x.id === data[0].id; });
      if (!existing) state.progress.push(data[0]);
    }
    document.getElementById('newSubject').value = '';
    toast('Subject added', 'success');
    renderAdminProgress();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}
async function deleteSubject(id) {
  try {
    const { error } = await supa.from('homeschool_progress').delete().eq('id', id);
    if (error) throw error;
    state.progress = state.progress.filter(function (p) { return p.id !== id; });
    renderAdminProgress(); renderOverview();
  } catch (e) { console.error(e); toast('Delete failed: ' + (e.message || e), 'error'); }
}

function renderAdminRewards() {
  const wrap = document.getElementById('adminRewards');
  if (!state.rewards.length) { wrap.innerHTML = '<div class="empty">No rewards yet.</div>'; return; }
  wrap.innerHTML = '';
  state.rewards.slice().sort(function (a, b) { return a.points_required - b.points_required; }).forEach(function (r) {
    const who = r.kid_id === null ? 'All kids' : ((kidById(r.kid_id) || {}).name || 'Kid');
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = '<div class="grow"><b>' + escapeHtml(r.name) + '</b><div class="meta">' + r.points_required + ' pts · ' + escapeHtml(who) + '</div></div>';
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = 'Delete';
    del.onclick = function () { deleteReward(r.id); };
    item.appendChild(del);
    wrap.appendChild(item);
  });
}
async function addReward() {
  const name = document.getElementById('rName').value.trim();
  const pts = parseInt(document.getElementById('rPts').value, 10);
  if (!name || !pts) { toast('Enter reward and points', 'error'); return; }
  const scope = document.getElementById('rScope').value;
  const row = { name: name, points_required: pts, kid_id: scope === 'all' ? null : scope };
  try {
    const { data, error } = await supa.from('homeschool_rewards').insert(row).select();
    if (error) throw error;
    if (data && data[0]) state.rewards.push(data[0]);
    document.getElementById('rName').value = ''; document.getElementById('rPts').value = '';
    toast('Reward added', 'success');
    renderAdminRewards();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}
async function deleteReward(id) {
  try {
    const { error } = await supa.from('homeschool_rewards').delete().eq('id', id);
    if (error) throw error;
    state.rewards = state.rewards.filter(function (r) { return r.id !== id; });
    renderAdminRewards();
  } catch (e) { console.error(e); toast('Delete failed: ' + (e.message || e), 'error'); }
}

function renderAdminCustom() {
  const wrap = document.getElementById('adminCustom');
  const upcoming = state.custom.filter(function (c) { return c.task_date >= state.today; })
    .sort(function (a, b) { return a.task_date < b.task_date ? -1 : 1; });
  if (!upcoming.length) { wrap.innerHTML = '<div class="empty">No upcoming custom tasks.</div>'; return; }
  wrap.innerHTML = '';
  upcoming.forEach(function (c) {
    const who = c.kid_id === null ? 'All kids' : ((kidById(c.kid_id) || {}).name || 'Kid');
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = '<div class="grow"><b>' + escapeHtml(c.title) + '</b><div class="meta">' + prettyDate(c.task_date) + ' · +' + c.points + ' · ' + escapeHtml(who) + '</div></div>';
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = 'Delete';
    del.onclick = function () { deleteCustom(c.id); };
    item.appendChild(del);
    wrap.appendChild(item);
  });
}
async function addCustomTask() {
  const title = document.getElementById('cTitle').value.trim();
  const date = document.getElementById('cDate').value;
  const pts = parseInt(document.getElementById('cPts').value, 10) || 5;
  if (!title || !date) { toast('Enter task and date', 'error'); return; }
  const scope = document.getElementById('cScope').value;
  const row = { task_date: date, kid_id: scope === 'all' ? null : scope, title: title, points: pts, category: 'disciplines', icon: '📝' };
  try {
    const { data, error } = await supa.from('homeschool_custom_tasks').insert(row).select();
    if (error) throw error;
    if (data && data[0]) state.custom.push(data[0]);
    document.getElementById('cTitle').value = '';
    toast('Task added to ' + prettyDate(date), 'success');
    renderAdminCustom(); renderAdminToday();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}
async function deleteCustom(id) {
  try {
    const { error } = await supa.from('homeschool_custom_tasks').delete().eq('id', id);
    if (error) throw error;
    state.custom = state.custom.filter(function (c) { return c.id !== id; });
    renderAdminCustom(); renderAdminToday();
  } catch (e) { console.error(e); toast('Delete failed: ' + (e.message || e), 'error'); }
}

// ---------- boot ----------
document.querySelectorAll('#adminScreen .tabs button').forEach(function (b) {
  b.onclick = function () { switchTab(b.dataset.tab); };
});

renderPinPad();
askPin(GATE_PIN, 'J3 Homeschool', async function () {
  showScreen('loginScreen');
  try { await loadAll(); renderLogin(); openBoard(); }
  catch (e) { /* toast already shown; stays on loginScreen */ }
});
