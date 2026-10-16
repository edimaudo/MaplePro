// Pure logic (no DOM, no network): shared by the browser app and the node tests.
(function (root) {
  const D = s => new Date(s + "T00:00:00Z"), iso = d => d.toISOString().slice(0, 10);
  const add = (s, n) => iso(new Date(D(s).getTime() + n * 864e5)), diff = (a, b) => Math.round((D(a) - D(b)) / 864e5);
  const today = () => iso(new Date()), money = v => "$" + Math.round(v).toLocaleString("en-US");
  // Forecast from reported slips AND actual progress: a task that is behind its expected progress pushes its finish out.
  function plan(tasks, asOf = today()) {
    const by = Object.fromEntries(tasks.map(t => [t.id, t])), memo = {};
    const es = (t, s) => memo[t.id + ":" + s] ??= (!t.pred ? t.start : add(ef(by[t.pred], s), 1));
    const lag = t => { if (t.progress >= 100) return 0; const e = es(t, 1); if (e > asOf) return 0; const exp = Math.min(100, (diff(asOf, e) + 1) / t.days * 100);
      return t.progress < exp ? Math.ceil((exp - t.progress) / 100 * t.days) : 0; };
    const ef = (t, s) => add(es(t, s), t.days - 1 + (s ? t.slip + lag(t) : 0));
    const out = tasks.map(t => { const f = ef(t, 1), b = ef(t, 0); return { ...t, es: es(t, 1), ef: f, bf: b, lag: lag(t), delta: diff(f, b) }; });
    if (!out.length) return { tasks: [], finish: null, baseline: null, slip: 0 };
    const last = out.reduce((a, b) => (b.ef > a.ef ? b : a)), base = out.reduce((a, b) => (b.bf > a ? b.bf : a), out[0].bf);
    const o = Object.fromEntries(out.map(x => [x.id, x])), crit = new Set(); let cur = last;
    while (cur) { crit.add(cur.id); cur = o[cur.pred]; }
    out.forEach(x => (x.critical = crit.has(x.id)));
    return { tasks: out, finish: last.ef, baseline: base, slip: diff(last.ef, base) };
  }
  function recovery(pl) {
    const open = pl.tasks.filter(t => t.critical && t.progress < 100); if (!pl.slip || !open.length) return [];
    const rem = t => Math.ceil(t.days * (1 - t.progress / 100)), total = open.reduce((s, t) => s + rem(t), 0);
    return [{ label: `Add a second crew on ${open[0].name}`, days: Math.min(pl.slip, Math.ceil(rem(open[0]) * 0.3)), tradeoff: "Extra labor cost; recovers days on the longest path." },
      { label: "Work Saturdays on critical tasks", days: Math.min(pl.slip, Math.ceil(total * 0.15)), tradeoff: "Overtime premium and crew fatigue." },
      { label: "Accept the new finish date and tell the client", days: 0, tradeoff: "No extra cost; may trigger delay clauses." }];
  }
  const eac = (spent, progress) => (progress > 0 ? Math.round(spent / (progress / 100)) : null);
  const payProb = (d, a) => (d <= 0 ? 92 : Math.max(5, Math.round(88 - 1.6 * d - a / 60000)));
  const lateAvg = paid => { const l = paid.filter(i => i.paid_date).map(i => diff(i.paid_date, i.due_date)); return l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null; };
  const toneFor = (avg, over) => avg == null ? { tone: over >= 14 ? "firm but friendly" : "warm and friendly", hint: "No payment history yet." }
    : avg > 10 ? { tone: "firm but friendly", hint: `Usually pays about ${avg} days late.` } : avg <= 3 ? { tone: "light and brief", hint: avg <= 0 ? "Usually pays on time." : `Usually pays about ${avg} days late.` } : { tone: "warm and friendly", hint: `Usually pays about ${avg} days late.` };
  function cashView(inv, outs, asOf = today()) {
    const wk = d => Math.min(4, Math.max(0, Math.floor(diff(d, asOf) / 7))), rows = [0, 1, 2, 3, 4].map(i => ({ label: "Week " + (i + 1), inflow: 0, outflow: 0 }));
    inv.forEach(i => (rows[wk(i.due_date)].inflow += i.amount * i.prob / 100)); outs.forEach(o => (rows[wk(o.date || asOf)].outflow += o.amount));
    let cum = 0; rows.forEach(r => { r.inflow = Math.round(r.inflow); r.outflow = Math.round(r.outflow); r.net = r.inflow - r.outflow; cum += r.net; r.cum = cum; }); return rows;
  }
  const nums = s => new Set((String(s).match(/\d[\d,]*\.?\d*/g) || []).map(n => n.replace(/,/g, "").replace(/\.$/, "")));
  const grounded = (text, facts) => { const a = nums(facts.join(" ")); return [...nums(text)].every(n => a.has(n)); };
  const lst = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []), num = v => (typeof v === "number" && v >= 0 ? Math.floor(v) : null), str = v => (typeof v === "string" ? v : null);
  const normalize = (o, source) => ({ source, work_completed: lst(o.work_completed), crew_count: num(o.crew_count),
    delays: (Array.isArray(o.delays) ? o.delays : []).filter(d => d && typeof d === "object").map(d => ({ cause: String(d.cause || ""), tasks_affected: lst(d.tasks_affected) })),
    risks: lst(o.risks), materials: lst(o.materials), safety: lst(o.safety), milestone_complete: !!o.milestone_complete, milestone_name: str(o.milestone_name),
    follow_up_question: str(o.follow_up_question), delay_days: num(o.delay_days), extra_hours: num(o.extra_hours), scope_change: str(o.scope_change), scope_cost: num(o.scope_cost) });
  function siteFallback(raw) {  // keyword extraction so the app works with no LLM
    const low = raw.toLowerCase(), delay = /delay|rebuilt|failed|rain|shortage|late/.test(low), parts = raw.split(/[.\n]/).map(s => s.trim()).filter(Boolean);
    const m = raw.match(/(\w[\w ]{2,30}?) (?:is |was |are )?(?:complete|finished|done)/i), dd = raw.match(/(\d+)[- ]days?/), xh = raw.match(/(\d+)\s*(?:extra |overtime )?hours/i);
    const tasks = (low.match(/\b(framing|foundation|roofing|drywall|excavation|facade|demolition|slab|steel)\b/g) || []).slice(0, 2);
    const sc = /(client|owner) (requested|asked)|change order|extra work|additional work|scope change/i.test(raw), cost = raw.match(/\$\s?([\d,]+)/);
    return normalize({ work_completed: parts.slice(0, 4), delays: delay ? [{ cause: raw.slice(0, 120), tasks_affected: tasks }] : [], risks: delay ? ["Possible schedule impact"] : [],
      safety: parts.filter(p => /safety|injur|ppe|hazard|near miss/i.test(p)), materials: parts.filter(p => /delivered|received|shortage|ordered/i.test(p)),
      milestone_complete: !!m && !delay && !sc, milestone_name: m ? m[1].trim().replace(/^./, c => c.toUpperCase()) : null,
      follow_up_question: delay && !dd ? "How many days did this set the schedule back?" : sc && !cost ? "What is the cost of the extra work?" : /\d/.test(raw) ? null : "How many crew were on site?",
      delay_days: dd && delay ? +dd[1] : null, extra_hours: xh ? +xh[1] : null, crew_count: (raw.match(/crew of (\d+)/i) || [])[1] ? +raw.match(/crew of (\d+)/i)[1] : null,
      scope_change: sc ? raw.slice(0, 120) : null, scope_cost: sc && cost ? +cost[1].replace(/,/g, "") : null }, "fallback");
  }
  const variance = lines => lines.map(l => ({ ...l, var: l.actual - l.budget, pct: l.budget ? Math.round(((l.actual - l.budget) / l.budget) * 100) : 0 }));
  const wxRisks = (tasks, days) => tasks.filter(t => t.wx && t.progress < 100).map(t => ({ task: t.name,
    dates: days.filter(w => t.es <= w.date && w.date <= t.ef && ((w.rain || 0) >= 5 || (w.tmin ?? 9) <= 0)).map(w => w.date) })).filter(r => r.dates.length);
  const holdbackSplit = (gross, rate) => { const hold = Math.round(gross * rate * 100) / 100; return { hold, net: Math.round((gross - hold) * 100) / 100 }; };
  const matchTasks = (text, tasks) => tasks.filter(t => text.toLowerCase().includes(t.name.toLowerCase()));
  root.Engine = { add, diff, today, money, plan, recovery, eac, payProb, lateAvg, toneFor, cashView, grounded, normalize, siteFallback, variance, wxRisks, holdbackSplit, matchTasks };
  if (typeof module !== "undefined") module.exports = root.Engine;
})(typeof window !== "undefined" ? window : globalThis);
