/* ============================================================
   J3 HOMESCHOOL — PLANNER UI ("Brain" tab)
   Loads after app.js, so it shares supa / state / toast / escapeHtml.
   Engine lives in planner-engine.js (window.HSEngine).
   ============================================================ */

const DAYS6 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_WINDOWS = {
  '0': { on: true, start: '09:15', end: '16:40' },
  '1': { on: true, start: '09:15', end: '16:40' },
  '2': { on: true, start: '09:15', end: '16:40' },
  '3': { on: true, start: '09:15', end: '16:40' },
  '4': { on: true, start: '09:15', end: '16:40' },
  '5': { on: false, start: '09:15', end: '12:00' },
};

const P = {
  teachers: [], activities: [], rules: [], plan: null, reqs: [],
  generated: [], preview: null, sub: 'plan', loaded: false,
};

// ---------- helpers ----------
function mondayKey(d) {
  const x = new Date((d || new Date()).getTime());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return dateKey(x);
}
function actById(id) { return P.activities.find(function (a) { return a.id === id; }); }
function teacherById(id) { return P.teachers.find(function (t) { return t.id === id; }); }
function jarr(v) { return Array.isArray(v) ? v : (v ? JSON.parse(v) : []); }
function kidName(id) { const k = kidById(id); return k ? k.name : '?'; }

// ---------- load ----------
async function loadPlanner(force) {
  if (P.loaded && !force) return true;
  try {
    const r = await Promise.all([
      supa.from('homeschool_teachers').select('*').eq('active', true).order('sort_order'),
      supa.from('homeschool_activities').select('*').eq('active', true).order('sort_order'),
      supa.from('homeschool_rules').select('*').order('created_at'),
      supa.from('homeschool_plans').select('*').order('created_at', { ascending: false }).limit(1),
    ]);
    for (const res of r) { if (res.error) throw res.error; }
    P.teachers = r[0].data || [];
    P.activities = (r[1].data || []).map(function (a) {
      a.tags = jarr(a.tags); a.kid_ids = jarr(a.kid_ids);
      a.kid_durations = a.kid_durations || {};
      return a;
    });
    P.rules = (r[2].data || []).map(function (x) { x.config = x.config || {}; return x; });
    P.plan = (r[3].data || [])[0] || null;
    if (P.plan) {
      P.plan.day_windows = (P.plan.day_windows && Object.keys(P.plan.day_windows).length)
        ? P.plan.day_windows : JSON.parse(JSON.stringify(DEFAULT_WINDOWS));
      const rq = await supa.from('homeschool_plan_req').select('*').eq('plan_id', P.plan.id);
      if (rq.error) throw rq.error;
      P.reqs = (rq.data || []).map(function (x) { x.kid_ids = jarr(x.kid_ids); x.days = jarr(x.days); return x; });
    } else { P.reqs = []; }
    P.loaded = true;
    return true;
  } catch (e) {
    console.error('loadPlanner failed', e);
    if (/does not exist|schema cache|Could not find the table/i.test(e.message || '')) {
      P.missing = true;
      return false;
    }
    toast('Planner load error: ' + (e.message || e), 'error');
    return false;
  }
}

// ---------- entry ----------
async function openBrain() {
  const host = document.getElementById('brainBody');
  host.innerHTML = '<div class="empty">Loading planner…</div>';
  const ok = await loadPlanner();
  if (!ok && P.missing) {
    host.innerHTML = '<div class="card"><h3>Planner tables not created yet</h3>' +
      '<p class="empty" style="text-align:left;padding:0 0 10px;">The Brain needs its database tables. ' +
      'Run <b>planner-schema.sql</b> in the Supabase SQL editor once, then reload this page.</p></div>';
    return;
  }
  renderBrain();
}

function renderBrain() {
  const host = document.getElementById('brainBody');
  const subs = [
    ['plan', '📅 Week setup'], ['reqs', '🎯 What to schedule'], ['rules', '⚖️ Rules'],
    ['library', '📚 Library'], ['teachers', '👥 Teachers'], ['preview', '✨ Generate'],
  ];
  host.innerHTML = '<div class="tabs subtabs">' + subs.map(function (s) {
    return '<button class="' + (P.sub === s[0] ? 'active' : '') + '" onclick="setSub(\'' + s[0] + '\')">' + s[1] + '</button>';
  }).join('') + '</div><div id="brainPane"></div>';
  const pane = document.getElementById('brainPane');
  if (P.sub === 'plan') renderPlanSetup(pane);
  else if (P.sub === 'reqs') renderReqs(pane);
  else if (P.sub === 'rules') renderRules(pane);
  else if (P.sub === 'library') renderLibrary(pane);
  else if (P.sub === 'teachers') renderTeachers(pane);
  else renderPreview(pane);
}
function setSub(s) { P.sub = s; renderBrain(); }

// ---------- 1. week setup ----------
function renderPlanSetup(pane) {
  const pl = P.plan || { start_week: mondayKey(new Date()), weeks: 1, day_windows: JSON.parse(JSON.stringify(DEFAULT_WINDOWS)) };
  const dw = pl.day_windows;
  pane.innerHTML =
    '<div class="card"><h3>Plan window</h3>' +
      '<div class="row" style="margin-bottom:12px;">' +
        '<div><span class="label">Start week (Monday)</span><input type="date" id="plStart" value="' + pl.start_week + '"></div>' +
        '<div><span class="label">How many weeks</span><select id="plWeeks">' +
          [1, 2, 3, 4].map(function (n) { return '<option value="' + n + '"' + (pl.weeks === n ? ' selected' : '') + '>' + n + ' week' + (n > 1 ? 's' : '') + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<span class="label">Which days are available, and what hours</span>' +
      '<div id="dayRows">' + DAYS6.map(function (nm, i) {
        const c = dw[String(i)] || { on: false, start: '09:15', end: '16:40' };
        return '<div class="day-row">' +
          '<label class="day-toggle"><input type="checkbox" data-day="' + i + '" class="dayOn"' + (c.on !== false ? ' checked' : '') + '><span>' + nm + '</span></label>' +
          '<input type="time" class="dayStart" data-day="' + i + '" value="' + (c.start || '09:15') + '">' +
          '<span class="day-dash">→</span>' +
          '<input type="time" class="dayEnd" data-day="' + i + '" value="' + (c.end || '16:40') + '">' +
        '</div>';
      }).join('') + '</div>' +
      '<button class="btn-primary" style="width:100%;margin-top:12px;" onclick="savePlan()">Save plan window</button>' +
    '</div>' +
    (P.plan ? '' : '<div class="card"><p class="empty">No plan yet — saving creates one.</p></div>');
}

async function savePlan() {
  const dw = {};
  DAYS6.forEach(function (_, i) {
    dw[String(i)] = {
      on: document.querySelector('.dayOn[data-day="' + i + '"]').checked,
      start: document.querySelector('.dayStart[data-day="' + i + '"]').value || '09:15',
      end: document.querySelector('.dayEnd[data-day="' + i + '"]').value || '16:40',
    };
  });
  const row = {
    start_week: document.getElementById('plStart').value,
    weeks: parseInt(document.getElementById('plWeeks').value, 10) || 1,
    day_windows: dw, status: 'draft',
  };
  try {
    let res;
    if (P.plan) res = await supa.from('homeschool_plans').update(row).eq('id', P.plan.id).select();
    else res = await supa.from('homeschool_plans').insert(row).select();
    if (res.error) throw res.error;
    P.plan = res.data[0]; P.plan.day_windows = dw;
    toast('Plan saved', 'success');
    renderBrain();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}

// ---------- 2. what to schedule ----------
function renderReqs(pane) {
  if (!P.plan) { pane.innerHTML = '<div class="card"><p class="empty">Set up the week first.</p></div>'; return; }
  const opts = P.activities.map(function (a) {
    return '<option value="' + a.id + '">' + escapeHtml((a.icon || '') + ' ' + a.name) + '</option>';
  }).join('');
  pane.innerHTML =
    '<div class="card"><h3>Add to this plan</h3>' +
      '<div class="field"><span class="label">Activity</span><select id="rqAct">' + opts + '</select></div>' +
      '<div class="row" style="margin-bottom:10px;">' +
        '<div><span class="label">Times per kid, per week</span><input type="number" id="rqQty" value="5" min="1"></div>' +
        '<div><span class="label">Repeat</span><select id="rqEvery">' +
          '<option value="1">Every week</option><option value="2">Every 2 weeks</option>' +
          '<option value="3">Every 3 weeks</option><option value="4">Every 4 weeks</option></select></div>' +
        '<div><span class="label">Priority</span><input type="number" id="rqPrio" value="5" min="1" max="10"></div>' +
      '</div>' +
      '<div class="row" style="margin-bottom:10px;">' +
        '<div><span class="label">Minutes (blank = default)</span><input type="number" id="rqDur" placeholder="default"></div>' +
      '</div>' +
      '<span class="label">Only these kids (none = all)</span>' +
      '<div class="chk-row">' + state.kids.map(function (k) {
        return '<label class="chk"><input type="checkbox" class="rqKid" value="' + k.id + '"><span>' + escapeHtml(k.name) + '</span></label>';
      }).join('') + '</div>' +
      '<span class="label" style="margin-top:10px;">Only these days (none = any)</span>' +
      '<div class="chk-row">' + DAYS6.map(function (nm, i) {
        return '<label class="chk"><input type="checkbox" class="rqDay" value="' + i + '"><span>' + nm + '</span></label>';
      }).join('') + '</div>' +
      '<button class="btn-primary" style="width:100%;margin-top:12px;" onclick="addReq()">Add</button>' +
    '</div>' +
    '<div class="card"><h3>In this plan (' + P.reqs.length + ')</h3><div id="reqList"></div></div>';

  const list = document.getElementById('reqList');
  if (!P.reqs.length) { list.innerHTML = '<div class="empty">Nothing yet.</div>'; return; }
  list.innerHTML = '';
  P.reqs.forEach(function (rq) {
    const a = actById(rq.activity_id) || { name: '?', icon: '❓' };
    const who = rq.kid_ids.length ? rq.kid_ids.map(kidName).join(', ') : 'all kids';
    const dys = rq.days.length ? rq.days.map(function (d) { return DAYS6[d]; }).join('/') : 'any day';
    const rep = rq.every_n_weeks > 1 ? ' · every ' + rq.every_n_weeks + ' wks' : '';
    const it = document.createElement('div');
    it.className = 'list-item';
    it.innerHTML = '<div class="grow">' + (a.icon || '') + ' <b>' + escapeHtml(a.name) + '</b>' +
      '<div class="meta">' + rq.qty + '×/wk · ' + (rq.duration_min || a.duration_min || 30) + 'm · ' +
      escapeHtml(who) + ' · ' + dys + rep + ' · P' + rq.priority + '</div></div>';
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '✕';
    del.onclick = function () { delRow('homeschool_plan_req', rq.id, function () { P.reqs = P.reqs.filter(function (x) { return x.id !== rq.id; }); }); };
    it.appendChild(del); list.appendChild(it);
  });
}

async function addReq() {
  const kidIds = [].slice.call(document.querySelectorAll('.rqKid:checked')).map(function (c) { return c.value; });
  const days = [].slice.call(document.querySelectorAll('.rqDay:checked')).map(function (c) { return parseInt(c.value, 10); });
  const dur = parseInt(document.getElementById('rqDur').value, 10);
  const row = {
    plan_id: P.plan.id,
    activity_id: document.getElementById('rqAct').value,
    qty: parseInt(document.getElementById('rqQty').value, 10) || 1,
    every_n_weeks: parseInt(document.getElementById('rqEvery').value, 10) || 1,
    duration_min: isNaN(dur) ? null : dur,
    kid_ids: kidIds, days: days,
    priority: parseInt(document.getElementById('rqPrio').value, 10) || 5,
  };
  try {
    const { data, error } = await supa.from('homeschool_plan_req').insert(row).select();
    if (error) throw error;
    const r = data[0]; r.kid_ids = jarr(r.kid_ids); r.days = jarr(r.days);
    P.reqs.push(r);
    toast('Added', 'success'); renderBrain();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}

// ---------- 3. rules ----------
function renderRules(pane) {
  const actOpts = P.activities.map(function (a) { return '<option value="' + a.id + '">' + escapeHtml(a.name) + '</option>'; }).join('');
  const teachOpts = P.teachers.map(function (t) { return '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>'; }).join('');
  const allTags = {};
  P.activities.forEach(function (a) { (a.tags || []).forEach(function (t) { allTags[t] = 1; }); });
  const tagOpts = Object.keys(allTags).sort().map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');

  pane.innerHTML =
    '<div class="card"><h3>Add a rule</h3>' +
      '<div class="field"><span class="label">Rule type</span><select id="ruType" onchange="ruleTypeChanged()">' +
        '<option value="blackout">🚫 Blackout — don\'t schedule X during a time window</option>' +
        '<option value="teacher_hours">🕐 Teacher hours — when a teacher is available</option>' +
        '<option value="spacing">↔️ Spacing — keep repeats apart</option>' +
        '<option value="order">➡️ Order — B must come after A</option>' +
        '<option value="max_per_day">🔢 Max per day</option>' +
      '</select></div>' +
      '<div id="ruFields"></div>' +
      '<button class="btn-primary" style="width:100%;margin-top:10px;" onclick="addRule()">Add rule</button>' +
    '</div>' +
    '<div class="card"><h3>Active rules (' + P.rules.length + ')</h3><div id="ruleList"></div></div>' +
    '<datalist id="dlActs">' + actOpts + '</datalist>';

  window._ruOpts = { actOpts: actOpts, teachOpts: teachOpts, tagOpts: tagOpts };
  ruleTypeChanged();

  const list = document.getElementById('ruleList');
  if (!P.rules.length) { list.innerHTML = '<div class="empty">No rules yet.</div>'; return; }
  list.innerHTML = '';
  P.rules.forEach(function (r) {
    const it = document.createElement('div');
    it.className = 'list-item';
    it.innerHTML = '<div class="grow"><b>' + escapeHtml(r.label) + '</b><div class="meta">' + escapeHtml(describeRule(r)) + '</div></div>';
    const tog = document.createElement('button');
    tog.className = r.active ? 'btn-secondary' : 'btn-danger';
    tog.textContent = r.active ? 'On' : 'Off';
    tog.onclick = async function () {
      try {
        const { error } = await supa.from('homeschool_rules').update({ active: !r.active }).eq('id', r.id);
        if (error) throw error;
        r.active = !r.active; renderBrain();
      } catch (e) { toast('Failed: ' + e.message, 'error'); }
    };
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '✕';
    del.onclick = function () { delRow('homeschool_rules', r.id, function () { P.rules = P.rules.filter(function (x) { return x.id !== r.id; }); }); };
    it.appendChild(tog); it.appendChild(del); list.appendChild(it);
  });
}

function dayChecks(cls) {
  return '<div class="chk-row">' + DAYS6.map(function (nm, i) {
    return '<label class="chk"><input type="checkbox" class="' + cls + '" value="' + i + '"><span>' + nm + '</span></label>';
  }).join('') + '</div>';
}
function ruleTypeChanged() {
  const t = document.getElementById('ruType').value;
  const o = window._ruOpts || {};
  const f = document.getElementById('ruFields');
  const timeRow = '<div class="row" style="margin-bottom:10px;">' +
    '<div><span class="label">From</span><input type="time" id="ruStart" value="12:00"></div>' +
    '<div><span class="label">To</span><input type="time" id="ruEnd" value="15:00"></div></div>';
  if (t === 'blackout') {
    f.innerHTML = '<div class="field"><span class="label">Block what?</span><select id="ruScope" onchange="blackoutScope()">' +
        '<option value="tag">A tag (e.g. outdoor)</option><option value="teacher">A teacher</option><option value="activity">One activity</option>' +
      '</select></div><div class="field" id="ruValWrap"><span class="label">Tag</span><select id="ruValue">' + (o.tagOpts || '') + '</select></div>' +
      timeRow + '<span class="label">On which days (none = every day)</span>' + dayChecks('ruDay');
  } else if (t === 'teacher_hours') {
    f.innerHTML = '<div class="field"><span class="label">Teacher</span><select id="ruValue">' + (o.teachOpts || '') + '</select></div>' +
      '<div class="row" style="margin-bottom:10px;"><div><span class="label">Available from</span><input type="time" id="ruStart" value="09:00"></div>' +
      '<div><span class="label">Until</span><input type="time" id="ruEnd" value="12:00"></div></div>' +
      '<span class="label">On which days (none = every day)</span>' + dayChecks('ruDay');
  } else if (t === 'spacing') {
    f.innerHTML = '<div class="field"><span class="label">Activity</span><select id="ruValue">' + (o.actOpts || '') + '</select></div>' +
      '<div class="field"><span class="label">Minimum gap between repeats (minutes)</span><input type="number" id="ruGap" value="60"></div>';
  } else if (t === 'order') {
    f.innerHTML = '<div class="field"><span class="label">This activity…</span><select id="ruBefore">' + (o.actOpts || '') + '</select></div>' +
      '<div class="field"><span class="label">…must come before</span><select id="ruAfter">' + (o.actOpts || '') + '</select></div>';
  } else {
    f.innerHTML = '<div class="field"><span class="label">Limit what?</span><select id="ruScope" onchange="blackoutScope()">' +
        '<option value="tag">A tag</option><option value="activity">One activity</option></select></div>' +
      '<div class="field" id="ruValWrap"><span class="label">Tag</span><select id="ruValue">' + (o.tagOpts || '') + '</select></div>' +
      '<div class="field"><span class="label">Max per day</span><input type="number" id="ruMax" value="2"></div>';
  }
}
function blackoutScope() {
  const s = document.getElementById('ruScope').value;
  const o = window._ruOpts || {};
  const wrap = document.getElementById('ruValWrap');
  if (s === 'tag') wrap.innerHTML = '<span class="label">Tag</span><select id="ruValue">' + (o.tagOpts || '') + '</select>';
  else if (s === 'teacher') wrap.innerHTML = '<span class="label">Teacher</span><select id="ruValue">' + (o.teachOpts || '') + '</select>';
  else wrap.innerHTML = '<span class="label">Activity</span><select id="ruValue">' + (o.actOpts || '') + '</select>';
}

function describeRule(r) {
  const c = r.config || {};
  const days = (c.days && c.days.length) ? c.days.map(function (d) { return DAYS6[d]; }).join('/') : 'every day';
  const nameOf = function (scope, v) {
    if (scope === 'teacher') { const t = teacherById(v); return t ? t.name : v; }
    if (scope === 'activity') { const a = actById(v); return a ? a.name : v; }
    return v;
  };
  if (r.type === 'blackout') return 'No ' + nameOf(c.scope, c.value) + ' between ' + c.start + '–' + c.end + ' (' + days + ')';
  if (r.type === 'teacher_hours') { const t = teacherById(c.teacher_id); return (t ? t.name : '?') + ' available ' + c.start + '–' + c.end + ' (' + days + ')'; }
  if (r.type === 'spacing') { const a = actById(c.activity_id); return (a ? a.name : '?') + ' repeats ≥' + c.min_gap_min + ' min apart'; }
  if (r.type === 'order') { const b = actById(c.before_activity_id), a2 = actById(c.after_activity_id); return (b ? b.name : '?') + ' → ' + (a2 ? a2.name : '?'); }
  if (r.type === 'max_per_day') return 'Max ' + c.max + ' × ' + nameOf(c.scope, c.value) + ' per day';
  return r.type;
}

async function addRule() {
  const type = document.getElementById('ruType').value;
  const days = [].slice.call(document.querySelectorAll('.ruDay:checked')).map(function (c) { return parseInt(c.value, 10); });
  let config = {}, label = '';
  const val = function () { const e = document.getElementById('ruValue'); return e ? e.value : null; };
  if (type === 'blackout') {
    config = { scope: document.getElementById('ruScope').value, value: val(), start: document.getElementById('ruStart').value, end: document.getElementById('ruEnd').value, days: days };
    label = 'No ' + config.value + ' ' + config.start + '–' + config.end;
  } else if (type === 'teacher_hours') {
    config = { teacher_id: val(), start: document.getElementById('ruStart').value, end: document.getElementById('ruEnd').value, days: days };
    const t = teacherById(config.teacher_id);
    label = (t ? t.name : 'Teacher') + ' hours';
  } else if (type === 'spacing') {
    config = { activity_id: val(), min_gap_min: parseInt(document.getElementById('ruGap').value, 10) || 30 };
    const a = actById(config.activity_id); label = (a ? a.name : '?') + ' spacing';
  } else if (type === 'order') {
    config = { before_activity_id: document.getElementById('ruBefore').value, after_activity_id: document.getElementById('ruAfter').value };
    const b = actById(config.before_activity_id), a2 = actById(config.after_activity_id);
    label = (b ? b.name : '?') + ' → ' + (a2 ? a2.name : '?');
  } else {
    config = { scope: document.getElementById('ruScope').value, value: val(), max: parseInt(document.getElementById('ruMax').value, 10) || 1 };
    label = 'Max ' + config.max + ' ' + config.value + '/day';
  }
  try {
    const { data, error } = await supa.from('homeschool_rules').insert({ label: label, type: type, config: config, active: true }).select();
    if (error) throw error;
    P.rules.push(data[0]);
    toast('Rule added', 'success'); renderBrain();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}

// ---------- 4. library ----------
function renderLibrary(pane) {
  const teachOpts = '<option value="">Self-directed (no teacher)</option>' +
    P.teachers.map(function (t) { return '<option value="' + t.id + '">' + escapeHtml(t.icon + ' ' + t.name) + '</option>'; }).join('');
  pane.innerHTML =
    '<div class="card"><h3>Add an activity</h3>' +
      '<div class="row" style="margin-bottom:10px;">' +
        '<div style="flex:2;"><span class="label">Name</span><input id="acName" placeholder="e.g. Chemistry"></div>' +
        '<div style="flex:1;"><span class="label">Icon</span><input id="acIcon" value="📌"></div>' +
      '</div>' +
      '<div class="field"><span class="label">Teacher</span><select id="acTeacher">' + teachOpts + '</select></div>' +
      '<div class="row" style="margin-bottom:10px;">' +
        '<div><span class="label">Minutes</span><input type="number" id="acDur" value="30"></div>' +
        '<div><span class="label">Points</span><input type="number" id="acPts" value="10"></div>' +
        '<div><span class="label">Fixed time</span><input id="acFixed" placeholder="opt. 11:45"></div>' +
      '</div>' +
      '<div class="row" style="margin-bottom:10px;">' +
        '<div><span class="label">Where</span><select id="acLoc"><option value="either">Either</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option></select></div>' +
        '<div><span class="label">Needs (exclusive)</span><input id="acRes" placeholder="computer / basket…"></div>' +
      '</div>' +
      '<div class="field"><span class="label">Who does it</span><select id="acPart">' +
        '<option value="together">Together — all assigned kids at once</option>' +
        '<option value="independent">Independent — each on their own, can overlap</option>' +
        '<option value="solo">One at a time — never two kids at once</option>' +
      '</select></div>' +
      '<div class="field"><span class="label">Tags (comma separated)</span><input id="acTags" placeholder="outdoor, physical, messy"></div>' +
      '<span class="label">Only these kids (none = all)</span>' +
      '<div class="chk-row">' + state.kids.map(function (k) {
        return '<label class="chk"><input type="checkbox" class="acKid" value="' + k.id + '"><span>' + escapeHtml(k.name) + '</span></label>';
      }).join('') + '</div>' +
      '<button class="btn-primary" style="width:100%;margin-top:12px;" onclick="addActivity()">Add activity</button>' +
    '</div>' +
    '<div class="card"><h3>Library (' + P.activities.length + ')</h3><div id="libList"></div></div>';

  const list = document.getElementById('libList');
  if (!P.activities.length) { list.innerHTML = '<div class="empty">Empty.</div>'; return; }
  list.innerHTML = '';
  P.activities.forEach(function (a) {
    const t = teacherById(a.teacher_id);
    const bits = [(a.duration_min || 30) + 'm', '+' + a.points];
    if (t) bits.push(t.icon + ' ' + t.name);
    if (a.resource) bits.push('needs ' + a.resource);
    if (a.participation === 'solo') bits.push('one at a time');
    else if (a.participation === 'together') bits.push('together');
    if (a.fixed_time) bits.push('@' + a.fixed_time);
    if ((a.tags || []).length) bits.push('#' + a.tags.join(' #'));
    const it = document.createElement('div');
    it.className = 'list-item';
    it.innerHTML = '<div class="grow">' + (a.icon || '') + ' <b>' + escapeHtml(a.name) + '</b>' +
      '<div class="meta">' + escapeHtml(bits.join(' · ')) + '</div></div>';
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '✕';
    del.onclick = function () { delRow('homeschool_activities', a.id, function () { P.activities = P.activities.filter(function (x) { return x.id !== a.id; }); }); };
    it.appendChild(del); list.appendChild(it);
  });
}

async function addActivity() {
  const name = document.getElementById('acName').value.trim();
  if (!name) { toast('Enter a name', 'error'); return; }
  const tags = document.getElementById('acTags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const kidIds = [].slice.call(document.querySelectorAll('.acKid:checked')).map(function (c) { return c.value; });
  const row = {
    name: name, icon: document.getElementById('acIcon').value.trim() || '📌',
    teacher_id: document.getElementById('acTeacher').value || null,
    duration_min: parseInt(document.getElementById('acDur').value, 10) || 30,
    points: parseInt(document.getElementById('acPts').value, 10) || 5,
    location: document.getElementById('acLoc').value,
    resource: document.getElementById('acRes').value.trim() || null,
    participation: document.getElementById('acPart').value,
    fixed_time: document.getElementById('acFixed').value.trim() || null,
    tags: tags, kid_ids: kidIds, active: true,
    sort_order: P.activities.length + 50,
  };
  try {
    const { data, error } = await supa.from('homeschool_activities').insert(row).select();
    if (error) throw error;
    const a = data[0]; a.tags = jarr(a.tags); a.kid_ids = jarr(a.kid_ids);
    P.activities.push(a);
    toast('Added', 'success'); renderBrain();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}

// ---------- 5. teachers ----------
function renderTeachers(pane) {
  pane.innerHTML =
    '<div class="card"><h3>Add a teacher</h3>' +
      '<div class="row" style="margin-bottom:10px;">' +
        '<div style="flex:2;"><span class="label">Name</span><input id="tcName" placeholder="e.g. Grandpapa"></div>' +
        '<div style="flex:1;"><span class="label">Icon</span><input id="tcIcon" value="👤"></div>' +
      '</div>' +
      '<p class="empty" style="text-align:left;padding:0 0 10px;">A teacher can only teach one thing at a time — the planner enforces that automatically.</p>' +
      '<button class="btn-primary" style="width:100%;" onclick="addTeacher()">Add teacher</button>' +
    '</div>' +
    '<div class="card"><h3>Teachers</h3><div id="tcList"></div></div>';
  const list = document.getElementById('tcList');
  if (!P.teachers.length) { list.innerHTML = '<div class="empty">None yet.</div>'; return; }
  list.innerHTML = '';
  P.teachers.forEach(function (t) {
    const subs = P.activities.filter(function (a) { return a.teacher_id === t.id; });
    const it = document.createElement('div');
    it.className = 'list-item';
    it.innerHTML = '<div class="grow">' + t.icon + ' <b>' + escapeHtml(t.name) + '</b>' +
      '<div class="meta">' + (subs.length ? escapeHtml(subs.map(function (s) { return s.name; }).join(', ')) : 'no subjects yet') + '</div></div>';
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '✕';
    del.onclick = function () { delRow('homeschool_teachers', t.id, function () { P.teachers = P.teachers.filter(function (x) { return x.id !== t.id; }); }); };
    it.appendChild(del); list.appendChild(it);
  });
}
async function addTeacher() {
  const name = document.getElementById('tcName').value.trim();
  if (!name) { toast('Enter a name', 'error'); return; }
  try {
    const { data, error } = await supa.from('homeschool_teachers').insert({
      name: name, icon: document.getElementById('tcIcon').value.trim() || '👤',
      sort_order: P.teachers.length + 1, active: true,
    }).select();
    if (error) throw error;
    P.teachers.push(data[0]);
    toast('Added', 'success'); renderBrain();
  } catch (e) { console.error(e); toast('Save failed: ' + (e.message || e), 'error'); }
}

// ---------- shared delete ----------
async function delRow(table, id, after) {
  try {
    const { error } = await supa.from(table).delete().eq('id', id);
    if (error) throw error;
    after(); toast('Deleted', 'success'); renderBrain();
  } catch (e) { console.error(e); toast('Delete failed: ' + (e.message || e), 'error'); }
}

// ---------- 6. generate & publish ----------
function renderPreview(pane) {
  if (!P.plan) { pane.innerHTML = '<div class="card"><p class="empty">Set up the week first.</p></div>'; return; }
  const pv = P.preview;
  pane.innerHTML =
    '<div class="card"><h3>Build the schedule</h3>' +
      '<p class="empty" style="text-align:left;padding:0 0 10px;">' + P.reqs.length + ' activities · ' +
      P.plan.weeks + ' week' + (P.plan.weeks > 1 ? 's' : '') + ' from ' + P.plan.start_week +
      ' · ' + P.rules.filter(function (r) { return r.active; }).length + ' active rules</p>' +
      '<div class="row"><button class="btn-primary" onclick="doGenerate()">✨ Generate schedule</button>' +
      (pv && pv.blocks.length ? '<button class="btn-secondary" onclick="doPublish()">📤 Publish to boards</button>' : '') +
      '</div></div>' +
    '<div id="pvBody"></div>';
  const body = document.getElementById('pvBody');
  if (!pv) { body.innerHTML = '<div class="card"><p class="empty">Hit Generate to see the week.</p></div>'; return; }

  let html = '';
  if (pv.unplaced.length) {
    html += '<div class="card"><h3>⚠️ Couldn\'t fit (' + pv.unplaced.length + ')</h3>' +
      pv.unplaced.slice(0, 12).map(function (u) {
        return '<div class="list-item"><div class="grow"><b>' + escapeHtml(u.title) + '</b>' +
          '<div class="meta">' + u.day + ' ' + u.date + ' · ' + u.kids.map(kidName).join(', ') + ' · ' + escapeHtml(u.reason) + '</div></div></div>';
      }).join('') +
      (pv.unplaced.length > 12 ? '<div class="empty">…and ' + (pv.unplaced.length - 12) + ' more</div>' : '') +
      '<p class="empty" style="text-align:left;">Widen the day hours, lower a quantity, or relax a rule.</p></div>';
  }
  const dates = [];
  pv.blocks.forEach(function (b) { if (dates.indexOf(b.task_date) < 0) dates.push(b.task_date); });
  dates.sort();
  html += '<div class="card"><h3>Preview — ' + pv.blocks.length + ' blocks</h3>';
  dates.forEach(function (d) {
    html += '<div class="pv-day"><div class="pv-date">' + prettyDate(d) + '</div><div class="week-scroll"><table class="week-grid"><thead><tr><th class="task-col">Time</th>' +
      state.kids.map(function (k) { return '<th>' + escapeHtml(k.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
    const times = [];
    pv.blocks.filter(function (b) { return b.task_date === d; }).forEach(function (b) {
      if (times.indexOf(b.start_time) < 0) times.push(b.start_time);
    });
    times.sort();
    times.forEach(function (tm) {
      html += '<tr><td class="task-col">' + tm + '</td>';
      state.kids.forEach(function (k) {
        const b = pv.blocks.find(function (x) { return x.task_date === d && x.start_time === tm && x.kid_id === k.id; });
        html += '<td style="font-size:12px;">' + (b ? (b.icon + ' ' + escapeHtml(b.title)) : '<span class="wk-future">·</span>') + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  });
  html += '</div>';
  body.innerHTML = html;
}

function doGenerate() {
  if (!window.HSEngine) { toast('Engine not loaded', 'error'); return; }
  if (!P.reqs.length) { toast('Add something to schedule first', 'error'); return; }
  const ctx = {
    kids: state.kids.map(function (k) { return { id: k.id, name: k.name }; }),
    activities: P.activities,
    rules: P.rules,
    plan: P.plan,
    reqs: P.reqs,
  };
  try {
    P.preview = window.HSEngine.generate(ctx);
    toast(P.preview.blocks.length + ' blocks · ' + P.preview.unplaced.length + ' unplaced',
      P.preview.unplaced.length ? '' : 'success');
    renderBrain();
  } catch (e) { console.error(e); toast('Generate failed: ' + (e.message || e), 'error'); }
}

async function doPublish() {
  const pv = P.preview;
  if (!pv || !pv.blocks.length) { toast('Generate first', 'error'); return; }
  const dates = {};
  pv.blocks.forEach(function (b) { dates[b.task_date] = 1; });
  const dateList = Object.keys(dates).sort();
  try {
    // replace any previous plan output for these dates
    const { error: delErr } = await supa.from('homeschool_generated')
      .delete().gte('task_date', dateList[0]).lte('task_date', dateList[dateList.length - 1]);
    if (delErr) throw delErr;
    const rows = pv.blocks.map(function (b) {
      return {
        plan_id: P.plan.id, task_date: b.task_date, kid_id: b.kid_id,
        activity_id: b.activity_id, teacher_id: b.teacher_id, title: b.title,
        icon: b.icon, points: b.points, start_time: b.start_time,
        duration_min: b.duration_min, resource: b.resource,
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supa.from('homeschool_generated').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }
    await supa.from('homeschool_plans').update({ status: 'published' }).eq('id', P.plan.id);
    P.plan.status = 'published';
    await loadGenerated();
    toast('Published ' + rows.length + ' blocks to the boards', 'success');
    renderBoard && renderBoard();
  } catch (e) { console.error(e); toast('Publish failed: ' + (e.message || e), 'error'); }
}

// Loaded by app.js at boot so the boards can use the plan.
async function loadGenerated() {
  try {
    const wr = weekRange();
    const from = wr.start;
    const to = dateKey(new Date(new Date(wr.start).getTime() + 34 * 864e5));
    const res = await Promise.all([
      supa.from('homeschool_generated').select('*').gte('task_date', from).lte('task_date', to),
      supa.from('homeschool_teachers').select('*').eq('active', true),
    ]);
    if (res[0].error) throw res[0].error;
    state.generated = res[0].data || [];
    if (!res[1].error) P.teachers = res[1].data || [];   // so boards can name the teacher
  } catch (e) {
    if (!/does not exist|schema cache|Could not find the table/i.test(e.message || '')) console.error('loadGenerated', e);
    state.generated = [];
  }
}
