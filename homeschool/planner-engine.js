/* ============================================================
   J3 HOMESCHOOL — SCHEDULING ENGINE ("the brain")
   Pure / no DOM, so it runs in the browser AND under node for tests.

   generate(ctx) -> { blocks, unplaced, stats }

   ctx = {
     kids:       [{id, name}],
     activities: [{id,name,icon,teacher_id,points,duration_min,location,
                   resource,participation,tags[],kid_ids[],kid_durations{},fixed_time}],
     rules:      [{type, config, active}],
     plan:       {start_week:'YYYY-MM-DD' (a Monday), weeks:1..4,
                  day_windows:{ "0":{on,start,end} ... "5":{...} }},   0=Mon .. 5=Sat
     reqs:       [{id,activity_id,qty,every_n_weeks,duration_min,kid_ids[],days[],priority}]
   }

   Hard guarantees (a block is never placed if it would break these):
     · a kid is never in two places at once
     · a resource (computer / basket / kitchen) is used by one block at a time
     · a TEACHER is used by one block at a time  (Grandpapa can't teach two things)
     · teacher_hours  — teacher-led work only inside that teacher's availability
     · blackout       — by tag / teacher / activity, per day + time window
     · spacing        — repeats of the same activity kept apart for a kid
     · order          — B never starts before A ends
     · max_per_day    — cap by tag or activity
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HSEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STEP = 5;                                   // placement granularity (minutes)
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function t2m(hhmm) {
    if (!hhmm) return 0;
    var p = String(hhmm).split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  function m2t(m) {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function overlaps(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }
  function hitsAny(list, s, e) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (overlaps(s, e, list[i][0], list[i][1])) return true;
    return false;
  }
  function push(map, key, s, e) { (map[key] = map[key] || []).push([s, e]); }

  function parseDate(key) {
    var p = String(key).split('-');
    return new Date(+p[0], (+p[1]) - 1, +p[2]);
  }
  function fmtDate(d) {
    var mm = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
  }
  function addDays(key, n) {
    var d = parseDate(key); d.setDate(d.getDate() + n); return d;
  }

  // Spread `qty` sessions across the allowed days as evenly as possible.
  function pickDays(qty, allowed) {
    var out = [];
    if (!allowed.length || qty <= 0) return out;
    if (qty <= allowed.length) {
      var step = allowed.length / qty;
      for (var i = 0; i < qty; i++) out.push(allowed[Math.floor(i * step)]);
    } else {
      for (var j = 0; j < qty; j++) out.push(allowed[j % allowed.length]);
    }
    return out;
  }

  function kidsFor(req, act, allKids) {
    var ids = (req && req.kid_ids && req.kid_ids.length) ? req.kid_ids
            : (act.kid_ids && act.kid_ids.length) ? act.kid_ids
            : allKids.map(function (k) { return k.id; });
    var valid = {}; allKids.forEach(function (k) { valid[k.id] = true; });
    return ids.filter(function (id) { return valid[id]; });
  }

  function tagsOf(act) { return act.tags || []; }

  // Does a custom rule's SUBJECT match this activity?
  //   {scope:'any'|'tag'|'teacher'|'activity'|'category', value:x}
  function subjMatch(subj, act) {
    if (!subj || subj.scope === 'any' || !subj.scope) return true;
    if (subj.scope === 'tag') return tagsOf(act).indexOf(subj.value) >= 0;
    if (subj.scope === 'teacher') return act.teacher_id === subj.value;
    if (subj.scope === 'activity') return act.id === subj.value;
    if (subj.scope === 'category') return act.category === subj.value;
    return false;
  }
  function daysApply(days, day) { return !days || !days.length || days.indexOf(day) >= 0; }

  // Every block this kid already has today, with its activity — lets custom
  // rules reason about tags/teachers/categories, not just one activity id.
  function kidBlocksMatching(c, kid, subj) {
    var list = c.kidBlocks[kid] || [];
    return list.filter(function (b) { return subjMatch(subj, b.act); });
  }

  // Returns false if any custom rule forbids [st,en) for this session.
  function customOk(s, st, en, c) {
    for (var i = 0; i < c.rules.length; i++) {
      var r = c.rules[i];
      if (r.type !== 'custom') continue;
      var cf = r.config || {};
      if (!subjMatch(cf.subject, s.act)) continue;
      var p = cf.params || {};
      var v = cf.verb;

      if (v === 'not_between') {
        if (daysApply(p.days, c.day) && overlaps(st, en, t2m(p.start || '00:00'), t2m(p.end || '23:59'))) return false;
      } else if (v === 'only_between') {
        if (daysApply(p.days, c.day) && !(st >= t2m(p.start || '00:00') && en <= t2m(p.end || '23:59'))) return false;
      } else if (v === 'only_on_days') {
        if (p.days && p.days.length && p.days.indexOf(c.day) < 0) return false;
      } else if (v === 'never_on_days') {
        if (p.days && p.days.indexOf(c.day) >= 0) return false;
      } else if (v === 'max_per_day') {
        for (var k = 0; k < s.kids.length; k++) {
          if (kidBlocksMatching(c, s.kids[k], cf.subject).length >= (p.n || 1)) return false;
        }
      } else if (v === 'min_gap') {
        var gap = p.minutes || 0;
        for (var k2 = 0; k2 < s.kids.length; k2++) {
          var prior = kidBlocksMatching(c, s.kids[k2], cf.subject);
          for (var q = 0; q < prior.length; q++) {
            if (overlaps(st - gap, en + gap, prior[q].s, prior[q].e)) return false;
          }
        }
      } else if (v === 'after') {
        var prev = c.placedAct[p.activity_id];
        if (prev && st < prev.end) return false;
      } else if (v === 'before') {
        var other = c.placedAct[p.activity_id];
        if (other && en > other.start) return false;
      } else if (v === 'not_same_day_as') {
        for (var k3 = 0; k3 < s.kids.length; k3++) {
          var same = (c.kidBlocks[s.kids[k3]] || []).filter(function (b) { return b.act.id === p.activity_id; });
          if (same.length) return false;
        }
      } else if (v === 'only_kids') {
        var allow = p.kid_ids || [];
        for (var k4 = 0; k4 < s.kids.length; k4++) if (allow.indexOf(s.kids[k4]) < 0) return false;
      }
    }
    return true;
  }

  // ---- constraint checks for a candidate window [st, en) ----
  function fits(s, st, en, c) {
    // kids free?
    for (var i = 0; i < s.kids.length; i++) if (hitsAny(c.busyKid[s.kids[i]], st, en)) return false;
    // resource free?
    if (s.resource && hitsAny(c.busyRes[s.resource], st, en)) return false;
    // teacher free?
    if (s.teacher && hitsAny(c.busyTeach[s.teacher], st, en)) return false;

    // teacher availability windows
    if (s.teacher) {
      var th = c.rules.filter(function (r) {
        return r.type === 'teacher_hours' && (r.config || {}).teacher_id === s.teacher;
      });
      if (th.length) {
        var forDay = th.filter(function (r) {
          var ds = (r.config || {}).days;
          return !ds || !ds.length || ds.indexOf(c.day) >= 0;
        });
        if (!forDay.length) return false;                       // teacher off today
        var inWindow = forDay.some(function (r) {
          return st >= t2m(r.config.start || '00:00') && en <= t2m(r.config.end || '23:59');
        });
        if (!inWindow) return false;
      }
    }

    // blackouts (tag / teacher / activity)
    for (var b = 0; b < c.rules.length; b++) {
      var r2 = c.rules[b];
      if (r2.type !== 'blackout') continue;
      var cf = r2.config || {};
      if (cf.days && cf.days.length && cf.days.indexOf(c.day) < 0) continue;
      var match = false;
      if (cf.scope === 'tag') match = tagsOf(s.act).indexOf(cf.value) >= 0;
      else if (cf.scope === 'teacher') match = s.act.teacher_id === cf.value;
      else if (cf.scope === 'activity') match = s.act.id === cf.value;
      if (!match) continue;
      if (overlaps(st, en, t2m(cf.start || '00:00'), t2m(cf.end || '23:59'))) return false;
    }

    // spacing between repeats of the same activity for the same kid
    for (var sp = 0; sp < c.rules.length; sp++) {
      var r3 = c.rules[sp];
      if (r3.type !== 'spacing') continue;
      var c3 = r3.config || {};
      if (c3.activity_id !== s.act.id) continue;
      var gap = c3.min_gap_min || 0;
      for (var k = 0; k < s.kids.length; k++) {
        var prev = c.actKid[s.act.id + '|' + s.kids[k]] || [];
        for (var p = 0; p < prev.length; p++) {
          // need `gap` clear minutes between the two blocks
          if (overlaps(st - gap, en + gap, prev[p][0], prev[p][1])) return false;
        }
      }
    }

    // max per day (tag or activity)
    for (var mx = 0; mx < c.rules.length; mx++) {
      var r4 = c.rules[mx];
      if (r4.type !== 'max_per_day') continue;
      var c4 = r4.config || {};
      var applies = c4.scope === 'tag' ? tagsOf(s.act).indexOf(c4.value) >= 0
                  : c4.scope === 'activity' ? s.act.id === c4.value : false;
      if (!applies) continue;
      var key = c4.scope + ':' + c4.value;
      if ((c.counts[key] || 0) >= (c4.max || 99)) return false;
    }

    // user-built rules
    if (!customOk(s, st, en, c)) return false;
    return true;
  }

  function commit(s, st, en, c, out) {
    s.kids.forEach(function (k) {
      push(c.busyKid, k, st, en);
      push(c.actKid, s.act.id + '|' + k, st, en);
      (c.kidBlocks[k] = c.kidBlocks[k] || []).push({ s: st, e: en, act: s.act });
    });
    if (s.resource) push(c.busyRes, s.resource, st, en);
    if (s.teacher) push(c.busyTeach, s.teacher, st, en);
    c.placedAct[s.act.id] = { start: st, end: en };
    c.rules.forEach(function (r) {
      if (r.type !== 'max_per_day') return;
      var cf = r.config || {};
      var applies = cf.scope === 'tag' ? tagsOf(s.act).indexOf(cf.value) >= 0
                  : cf.scope === 'activity' ? s.act.id === cf.value : false;
      if (!applies) return;
      var key = cf.scope + ':' + cf.value;
      c.counts[key] = (c.counts[key] || 0) + 1;
    });
    s.kids.forEach(function (k) {
      out.push({
        task_date: c.dateKey, kid_id: k, activity_id: s.act.id,
        teacher_id: s.teacher || null, title: s.act.name, icon: s.act.icon || '📌',
        points: s.act.points == null ? 5 : s.act.points,
        start_time: m2t(st), duration_min: en - st, resource: s.resource || null
      });
    });
  }

  function tryPlace(s, c, out) {
    var dur = s.duration;
    // "after X" order rules raise the earliest legal start
    var minStart = c.winS;
    c.rules.forEach(function (r) {
      var cf = r.config || {};
      if (r.type === 'order') {
        if (cf.after_activity_id !== s.act.id) return;
        var prev = c.placedAct[cf.before_activity_id];
        if (prev) minStart = Math.max(minStart, prev.end);
      } else if (r.type === 'custom' && cf.verb === 'after' && subjMatch(cf.subject, s.act)) {
        var prev2 = c.placedAct[(cf.params || {}).activity_id];
        if (prev2) minStart = Math.max(minStart, prev2.end);
      }
    });

    if (s.fixed) {                                   // anchored block (meals) — exact time or bust
      var fs = t2m(s.fixed), fe = fs + dur;
      // must still sit inside the day's available window (e.g. a short Saturday)
      if (fs < c.winS || fe > c.winE) return false;
      if (fs < minStart) return false;
      if (fits(s, fs, fe, c)) { commit(s, fs, fe, c, out); return true; }
      return false;
    }
    for (var st = Math.max(c.winS, minStart); st + dur <= c.winE; st += STEP) {
      if (fits(s, st, st + dur, c)) { commit(s, st, st + dur, c, out); return true; }
    }
    return false;
  }

  function cmpSession(a, b) {
    if (!!b.fixed !== !!a.fixed) return b.fixed ? 1 : -1;   // anchors first
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.duration - a.duration;                          // big rocks before pebbles
  }

  function generate(ctx) {
    ctx = ctx || {};
    var kids = ctx.kids || [];
    var acts = ctx.activities || [];
    var reqs = ctx.reqs || [];
    var rules = (ctx.rules || []).filter(function (r) { return r.active !== false; });
    var plan = ctx.plan || {};
    var weeks = Math.max(1, Math.min(4, plan.weeks || 1));
    var dw = plan.day_windows || {};
    var actById = {}; acts.forEach(function (a) { actById[a.id] = a; });

    var blocks = [], unplaced = [];

    var onDays = [];
    for (var d = 0; d < 6; d++) {
      var cfg = dw[String(d)];
      if (cfg && cfg.on !== false) onDays.push(d);
    }

    for (var w = 0; w < weeks; w++) {
      var weekStart = fmtDate(addDays(plan.start_week, w * 7));

      // ---- build this week's sessions, bucketed by day ----
      var byDay = {}; onDays.forEach(function (dd) { byDay[dd] = []; });

      reqs.forEach(function (req) {
        var every = req.every_n_weeks || 1;
        if (every > 1 && (w % every) !== 0) return;            // not this week
        var act = actById[req.activity_id];
        if (!act || act.active === false) return;
        var allowed = (req.days && req.days.length)
          ? req.days.filter(function (x) { return onDays.indexOf(x) >= 0; })
          : onDays;
        var ks = kidsFor(req, act, kids);
        if (!ks.length || !allowed.length) return;
        var days = pickDays(req.qty == null ? 1 : req.qty, allowed);

        days.forEach(function (dd) {
          function mk(who) {
            var dur = req.duration_min
              || (act.kid_durations && who.length === 1 && act.kid_durations[who[0]])
              || act.duration_min || 30;
            return {
              act: act, kids: who, duration: dur,
              priority: req.priority == null ? 5 : req.priority,
              fixed: act.fixed_time || null,
              // 'solo' means one kid at a time even without a named resource
              resource: act.resource || (act.participation === 'solo' ? ('act:' + act.id) : null),
              teacher: act.teacher_id || null
            };
          }
          if (act.participation === 'together') byDay[dd].push(mk(ks.slice()));
          else ks.forEach(function (k) { byDay[dd].push(mk([k])); });
        });
      });

      // ---- place each day ----
      onDays.forEach(function (dd) {
        var cfg2 = dw[String(dd)] || {};
        var c = {
          day: dd,
          dateKey: fmtDate(addDays(weekStart, dd)),
          winS: t2m(cfg2.start || '09:15'),
          winE: t2m(cfg2.end || '16:40'),
          busyKid: {}, busyRes: {}, busyTeach: {}, actKid: {}, kidBlocks: {},
          placedAct: {}, counts: {}, rules: rules
        };
        byDay[dd].slice().sort(cmpSession).forEach(function (s) {
          if (!tryPlace(s, c, blocks)) {
            unplaced.push({
              date: c.dateKey, day: DAY_NAMES[dd], title: s.act.name,
              kids: s.kids.slice(), duration: s.duration,
              reason: s.fixed ? 'anchor time ' + s.fixed + ' was already taken' : 'no free slot that satisfies the rules'
            });
          }
        });
      });
    }

    return {
      blocks: blocks,
      unplaced: unplaced,
      stats: { blocks: blocks.length, unplaced: unplaced.length, weeks: weeks, days: onDays.length }
    };
  }

  return { generate: generate, t2m: t2m, m2t: m2t, DAY_NAMES: DAY_NAMES, pickDays: pickDays };
});
