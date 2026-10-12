// Pure logic (no DOM, no network): shared by the browser app and the node tests.
(function (root) {
  const D = s => new Date(s + "T00:00:00Z"), iso = d => d.toISOString().slice(0, 10);
  const add = (s, n) => iso(new Date(D(s).getTime() + n * 864e5)), diff = (a, b) => Math.round((D(a) - D(b)) / 864e5);
  const today = () => iso(new Date()), money = v => "$" + Math.round(v).toLocaleString("en-US");
  function plan(tasks) {
    const by = Object.fromEntries(tasks.map(t => [t.id, t])), memo = {};
    const es = (t, s) => memo[t.id + ":" + s] ??= (!t.pred ? t.start : add(ef(by[t.pred], s), 1));
    const ef = (t, s) => add(es(t, s), t.days - 1 + (s ? t.slip : 0));
    const out = tasks.map(t => ({ ...t, es: es(t, 1), ef: ef(t, 1) }));
    if (!out.length) return { tasks: [], finish: null, baseline: null, slip: 0 };
    const last = out.reduce((a, b) => (b.ef > a.ef ? b : a)), base = tasks.map(t => ef(t, 0)).reduce((a, b) => (b > a ? b : a));
    const o = Object.fromEntries(out.map(x => [x.id, x])), crit = new Set(); let cur = last;
    while (cur) { crit.add(cur.id); cur = o[cur.pred]; }
    out.forEach(x => (x.critical = crit.has(x.id)));
    return { tasks: out, finish: last.ef, baseline: base, slip: diff(last.ef, base) };
  }
  const payProb = (d, a) => (d <= 0 ? 92 : Math.max(5, Math.round(88 - 1.6 * d - a / 60000)));
  const nums = s => new Set((String(s).match(/\d[\d,]*\.?\d*/g) || []).map(n => n.replace(/,/g, "").replace(/\.$/, "")));
  const grounded = (text, facts) => { const a = nums(facts.join(" ")); return [...nums(text)].every(n => a.has(n)); };
  const lst = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
  const num = v => (typeof v === "number" && v >= 0 ? Math.floor(v) : null);
  const str = v => (typeof v === "string" ? v : null);
  const normalize = (o, source) => ({ source, work_completed: lst(o.work_completed), crew_count: num(o.crew_count),
    delays: (Array.isArray(o.delays) ? o.delays : []).filter(d => d && typeof d === "object").map(d => ({ cause: String(d.cause || ""), tasks_affected: lst(d.tasks_affected) })),
    risks: lst(o.risks), materials: lst(o.materials), milestone_complete: !!o.milestone_complete, milestone_name: str(o.milestone_name),
    follow_up_question: str(o.follow_up_question), delay_days: num(o.delay_days), extra_hours: num(o.extra_hours) });
  function siteFallback(raw) {  // keyword extraction so the app works with no LLM
    const low = raw.toLowerCase(), delay = /delay|rebuilt|failed|rain|shortage|late/.test(low);
    const m = raw.match(/(\w[\w ]{2,30}?) (?:is |was |are )?(?:complete|finished|done)/i), dd = raw.match(/(\d+)[- ]days?/), xh = raw.match(/(\d+)\s*(?:extra |overtime )?hours/i);
    const tasks = (low.match(/\b(framing|foundation|roofing|drywall|excavation|facade|demolition|slab|steel)\b/g) || []).slice(0, 2);
    return normalize({ work_completed: raw.split(/[.\n]/).map(s => s.trim()).filter(Boolean).slice(0, 4), delays: delay ? [{ cause: raw.slice(0, 120), tasks_affected: tasks }] : [],
      risks: delay ? ["Possible schedule impact"] : [], milestone_complete: !!m && !delay, milestone_name: m ? m[1].trim().replace(/^./, c => c.toUpperCase()) : null,
      follow_up_question: delay && !dd ? "How many days did this set the schedule back?" : /\d/.test(raw) ? null : "How many crew were on site?",
      delay_days: dd && delay ? +dd[1] : null, extra_hours: xh ? +xh[1] : null }, "fallback");
  }
  const variance = lines => lines.map(l => ({ ...l, var: l.actual - l.budget, pct: l.budget ? Math.round(((l.actual - l.budget) / l.budget) * 100) : 0 }));
  const wxRisks = (tasks, days) => tasks.filter(t => t.wx && t.progress < 100).map(t => ({ task: t.name,
    dates: days.filter(w => t.es <= w.date && w.date <= t.ef && ((w.rain || 0) >= 5 || (w.tmin ?? 9) <= 0)).map(w => w.date) })).filter(r => r.dates.length);
  const holdbackSplit = (gross, rate) => { const hold = Math.round(gross * rate * 100) / 100; return { hold, net: Math.round((gross - hold) * 100) / 100 }; };
  root.Engine = { add, diff, today, money, plan, payProb, grounded, normalize, siteFallback, variance, wxRisks, holdbackSplit };
  if (typeof module !== "undefined") module.exports = root.Engine;
})(typeof window !== "undefined" ? window : globalThis);
