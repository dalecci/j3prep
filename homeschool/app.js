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
  tasks: [],           // homeschool_tasks (template)
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
function prettyDate(key) {
  const parts = key.split('-');
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
function gradeFor(name) { return GRADES[(name || '').trim().toLowerCase().split(' ')[0]] || 'Student'; }

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
  ['gateScreen', 'loginScreen', 'kidScreen', 'adminScreen'].forEach(function (s) {
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
  } catch (e) {
    console.error('loadAll failed', e);
    toast('Sync error: ' + (e.message || e), 'error');
    throw e;
  }
}

// ---------- scoring ----------
// Tasks a kid should see on a given date = active template tasks + custom tasks for that date/kid.
function tasksForDay(kidId, dayKey) {
  const template = state.tasks.map(function (t) {
    return { id: t.id, title: t.title, icon: t.icon, start_time: t.start_time,
      duration_min: t.duration_min, target: t.target, points: t.points, category: t.category, source: 'template' };
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

  // today's completion ring
  const dayTasks = tasksForDay(state.currentKidId, state.today);
  const doneCount = dayTasks.filter(function (t) { return isDone(state.currentKidId, t.id, state.today); }).length;
  const pct = dayTasks.length ? Math.round((doneCount / dayTasks.length) * 100) : 0;
  document.getElementById('todayRing').innerHTML = ringSvg(pct, doneCount + '/' + dayTasks.length);

  renderTaskList('taskList', state.currentKidId, state.today, false);
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

function renderTaskList(elId, kidId, dayKey, adminMode) {
  const list = document.getElementById(elId);
  const tasks = tasksForDay(kidId, dayKey).sort(function (a, b) {
    const at = a.start_time || '99:99', bt = b.start_time || '99:99';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  if (!tasks.length) { list.innerHTML = '<div class="empty">No tasks scheduled.</div>'; return; }
  list.innerHTML = '';
  tasks.forEach(function (t) {
    const done = isDone(kidId, t.id, dayKey);
    const row = document.createElement('div');
    row.className = 'task-row' + (done ? ' done' : '');
    const meta = [];
    if (t.target) meta.push(escapeHtml(t.target));
    else if (t.duration_min) meta.push(t.duration_min + ' min');
    const tag = t.source === 'custom' ? '<span class="custom-tag">EXTRA</span>' : '';
    row.innerHTML =
      '<div class="task-time">' + (t.start_time || '') + '</div>' +
      '<div class="task-check">' + (done ? '✓' : '') + '</div>' +
      '<div class="task-icon">' + (t.icon || '📌') + '</div>' +
      '<div class="task-body"><div class="task-title">' + escapeHtml(t.title) + tag + '</div>' +
        (meta.length ? '<div class="task-meta">' + meta.join(' · ') + '</div>' : '') + '</div>' +
      '<div class="task-pts">+' + t.points + '</div>';
    row.onclick = function () { toggleTask(kidId, t, dayKey, adminMode); };
    list.appendChild(row);
  });
}

async function toggleTask(kidId, task, dayKey, adminMode) {
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
  if (adminMode) { renderAdminToday(); renderOverview(); }
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
}
function renderKidSwitchers() {
  ['kidSwitcherToday', 'kidSwitcherProg'].forEach(function (id) {
    const sw = document.getElementById(id);
    sw.innerHTML = '';
    state.kids.forEach(function (k) {
      const b = document.createElement('button');
      b.textContent = k.name;
      b.className = k.id === state.adminKidId ? 'active' : '';
      if (k.id === state.adminKidId) b.style.background = k.color || '#3b82f6';
      b.onclick = function () { state.adminKidId = k.id; renderKidSwitchers(); renderAdminToday(); renderAdminProgress(); };
      sw.appendChild(b);
    });
  });
}
function renderAdminAll() {
  renderOverview(); renderAdminToday(); renderAdminSchedule();
  renderAdminProgress(); renderAdminRewards(); renderAdminCustom();
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
  if (state.adminKidId) renderTaskList('adminTaskList', state.adminKidId, state.today, true);
}

function renderAdminSchedule() {
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
  try { await loadAll(); renderLogin(); }
  catch (e) { /* toast already shown */ }
});
