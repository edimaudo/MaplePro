"use strict";
// MaplePro browser app. Data lives in IndexedDB; the server is only used for Gemini and PayPal calls.
const E = window.Engine, { add: addD, today, money, diff } = E;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const T = ["change_orders", "files", "holdbacks", "proposals", "materials", "equipment", "incidents", "notes", "clients", "projects", "invoices", "reports", "actions", "users", "members", "tasks", "timesheets", "payouts", "budget_lines", "meta"];
let S = {}, idb, ME = null, ST = { paypal: false, gemini: false };
const CFG = { staffLimit: 50000, holdback: 0.1, rate: 65, milestonePct: 0.08, access: "", lat: 43.77, lon: -79.41, autoKinds: [], depositPct: 0.1, autoRemind: false };
const now = () => new Date().toISOString().slice(0, 19);

// ---- IndexedDB: everything is loaded into memory at start, writes go through to the database ------------
const openDb = () => new Promise((res, rej) => { const r = indexedDB.open("maplepro", 3);
  r.onupgradeneeded = () => T.forEach(t => { if (!r.result.objectStoreNames.contains(t)) r.result.createObjectStore(t, { keyPath: "id" }); }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const loadAll = () => Promise.all(T.map(t => new Promise(res => { const q = idb.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res((S[t] = q.result)); })));
const put = (t, row) => { idb.transaction(t, "readwrite").objectStore(t).put(row); return row; };
const add = (t, row) => { row = { ...row, id: Math.max(0, ...S[t].map(r => r.id)) + 1 }; S[t].push(row); return put(t, row); };
const upd = (t, id, patch) => { const r = S[t].find(x => x.id == id); Object.assign(r, patch); put(t, r); return r; };
const clearAll = () => Promise.all(T.map(t => new Promise(res => { const q = idb.transaction(t, "readwrite").objectStore(t).clear(); q.onsuccess = () => res(); })));
const saveCfg = () => put("meta", { id: 2, v: { ...CFG } });
const api = (path, body) => fetch("/api/" + path, { method: "POST", headers: { "Content-Type": "application/json", "x-access-code": CFG.access }, body: JSON.stringify(body || {}), signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined })
  .then(async r => { if (!r.ok) throw new Error((await r.text()).slice(0, 200)); return r.json(); });
const gem = async prompt => { try { return (await api("gemini", { prompt })).result; } catch (e) { return null; } };

function seed() {
  const t = today(), d = n => addD(t, -n), A = (tb, rows) => rows.forEach(r => add(tb, r));
  A("clients", [["Acme Real Estate Development", "client@example.com", "+1 (555) 234 5678"], ["Downtown Commercial Properties", "billing@example.com", "+1 (555) 311 0042"], ["Suburban Retail Group", "ap@example.com", "+1 (555) 902 7710"]].map(([name, email, phone]) => ({ name, email, phone })));
  A("projects", [["Riverside Luxury Apartments", 1, 3500000, 980000, 28, "2027-09-30", "12-story, 150-unit apartment complex with underground parking, pool, gym and rooftop terrace."],
    ["Downtown Office Tower Renovation", 2, 2500000, 700000, 18, "2027-03-15", "Interior and facade renovation of a 9-story office tower."],
    ["Suburban Shopping Center", 3, 1500000, 182200, 12, "2027-06-01", "New 40,000 sq ft retail center with shared parking."]]
    .map(([name, client_id, budget, spent, progress, due, description]) => ({ name, client_id, budget, spent, progress, due, description, created: d(60) })));
  A("invoices", [["INV-2026-008", 1, 1, 250500, d(27), "sent", null], ["INV-2026-009", 2, 2, 215000, d(15), "sent", null], ["INV-2026-004", 2, 2, 328000, d(12), "sent", null],
    ["INV-2026-011", 1, 1, 180000, d(-12), "sent", null], ["INV-2026-012", 3, 3, 95000, d(-20), "sent", null], ["INV-2026-002", 1, 1, 400000, d(60), "paid", d(55)],
    ["INV-2026-001", 2, 2, 120000, d(90), "paid", d(70)], ["INV-2026-003", 3, 3, 60000, d(50), "paid", d(50)]]
    .map(([number, project_id, client_id, amount, due_date, status, paid_date]) => ({ number, project_id, client_id, amount, due_date, status, paid_date, paypal_id: null })));
  A("users", [["admin@maplepro.test", "Admin User", "admin"], ["pm@maplepro.test", "Pat Manager", "staff"], ["client@example.com", "Acme Client", "client", 1], ["sub@maplepro.test", "Sam Subcontractor", "subcontractor"]]
    .map(([email, name, role, client_id]) => ({ email, name, role, client_id: client_id || null })));
  A("members", [{ user_id: 4, project_id: 1 }, { user_id: 4, project_id: 2 }]);
  const chains = { 1: [["Excavation", 10, 100, 0, "Site work"], ["Foundation", 14, 100, 1, "Site work"], ["Framing", 20, 40, 0, "Structure"], ["Roofing", 10, 0, 1, "Structure"], ["Drywall", 12, 0, 0, "Finishes"]],
    2: [["Demolition", 12, 100, 0, "Strip-out"], ["Facade work", 25, 30, 1, "Envelope"], ["Interior fit-out", 30, 0, 0, "Finishes"]], 3: [["Site prep", 8, 100, 0, "Site work"], ["Concrete slab", 10, 50, 1, "Structure"], ["Steel frame", 20, 0, 0, "Structure"]] };
  for (const [pid, ts] of Object.entries(chains)) { let prev = null;
    ts.forEach(([name, days, progress, wx, phase], i) => { const pred = name === "Drywall" ? prev - 1 : i ? prev : null;
      prev = add("tasks", { project_id: +pid, name, days, pred, progress, slip: 0, wx, phase, start: d(45) }).id; }); }
  A("timesheets", [[9, 40, "approved"], [2, 36, "approved"], [0, 8, "submitted"]].map(([n, hours, status]) => ({ project_id: 1, user_id: 4, work_date: d(n), hours, rate: 65, status, payout_id: null })));
  A("proposals", [["Phase 2 fit-out", 1, 1, 420000, "Sent"], ["Lobby renovation", 2, 2, 185000, "Accepted"], ["Parking structure repair", 3, 3, 96000, "Draft"]]
    .map(([title, client_id, project_id, amount, status]) => ({ title, client_id, project_id, amount, status, created: t })));
  A("materials", [["Cement bags", "bag", 320, 100, 12.5, 6], ["Concrete mix", "m3", 85, 30, 165, 2], ["Drywall sheets", "sheet", 600, 200, 14, 25], ["Electrical wire (500 ft)", "roll", 48, 20, 185, 1], ["Lumber 2x4", "pc", 1500, 500, 6.5, 60],
    ["Plywood 3/4 in", "sheet", 90, 100, 48, 8], ["PVC pipe 4 in", "pc", 220, 80, 18, 4], ["Interior paint", "pail", 140, 40, 62, 3], ["Roofing shingles", "bundle", 410, 150, 38, 12], ["Insulation rolls", "roll", 260, 100, 54, 5],
    ["Rebar #5", "ton", 22, 8, 1250, 0.4], ["Nails 3 in", "box", 300, 100, 22, 6], ["Floor tile 12x12", "box", 380, 120, 32, 8], ["Interior doors", "ea", 60, 20, 210, 1], ["Window units", "ea", 14, 6, 420, 0.5]]
    .map(([name, unit, qty, min_qty, unit_cost, daily_use]) => ({ name, unit, qty, min_qty, unit_cost, daily_use })));
  A("equipment", ["Excavator CAT 320", "Tower crane", "Skid steer", "Concrete mixer", "Scissor lift", "Backhoe loader", "Dump truck", "Generator 100 kW", "Compactor", "Forklift", "Boom lift", "Concrete pump"]
    .map((name, i) => ({ name, type: i < 3 ? "Heavy" : i < 8 ? "Site" : "Lifting", status: i < 8 ? "In use" : i < 11 ? "Available" : "Maintenance", rate: 45 + i * 12 })));
  A("incidents", [["Slip on wet surface", "Low", "Closed", 1], ["Minor cut", "Low", "Closed", 2], ["Near miss: falling object", "Medium", "Closed", 1], ["Missing guardrail", "High", "Investigating", 1], ["Equipment strike", "Medium", "Open", 3], ["Heat exhaustion", "Medium", "Closed", 2], ["PPE violation", "Low", "Closed", 3]]
    .map(([type, severity, status, project_id], i) => ({ type, severity, status, project_id, date: d(i * 4 + 1), description: "" })));
  S.projects.forEach(p => { const ph = [...new Set(S.tasks.filter(x => x.project_id == p.id).map(x => x.phase))];
    [["labor", .30, .38], ["materials", .35, .30], ["equipment", .10, .10], ["subs", .25, .22]].forEach(([category, pl, ac]) => { const plan = Math.round(p.budget * p.progress / 100 * pl), act = Math.round(p.spent * ac);
      ph.forEach((phase, k) => { const last = k === ph.length - 1, pp = last ? plan - Math.round(plan / ph.length) * (ph.length - 1) : Math.round(plan / ph.length), aa = last ? act - Math.round(act / ph.length) * (ph.length - 1) : Math.round(act / ph.length);
        add("budget_lines", { project_id: p.id, category, phase, budget: pp, actual: aa, committed: Math.round(aa * 1.15) }); }); }); });
  add("change_orders", { project_id: 1, number: "CO-001", title: "Rooftop terrace lighting upgrade", description: "Client requested upgraded lighting on the rooftop terrace.", amount: 18500, status: "Pending client", created: t, invoiced: false,
    history: [{ at: t, by: "Pat Manager", event: "Drafted" }, { at: t, by: "Pat Manager", event: "Sent to client for approval" }] });
}

// ---- scoping and data helpers ------------------------------------------------------------------------------
const staff = () => ME && ["admin", "staff"].includes(ME.role);
const cl = id => S.clients.find(c => c.id == id), proj = id => S.projects.find(p => p.id == id);
const myProjects = () => staff() ? S.projects : ME.role === "client" ? S.projects.filter(p => p.client_id == ME.client_id) : S.projects.filter(p => S.members.some(m => m.user_id == ME.id && m.project_id == p.id));
const invs = () => S.invoices.filter(i => i.status === "sent").map(i => { const dd = Math.max(diff(today(), i.due_date), 0), c = cl(i.client_id);
  return { ...i, client: c.name, email: c.email, project: proj(i.project_id).name, days_over: dd, prob: E.payProb(dd, i.amount), risk: dd > 10 ? "high" : "healthy", late: E.lateAvg(S.invoices.filter(x => x.client_id == i.client_id && x.status === "paid")) }; })
  .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const pidOf = (kind, ref) => (kind === "create_invoice" || kind === "payout" ? ref : kind === "release_holdback" ? (S.holdbacks.find(h => h.id == ref) || {}).project_id : (S.invoices.find(i => i.id == ref) || {}).project_id);
const logAction = (agent, kind, ref, title, rationale, payload) => add("actions", { agent, kind, ref_id: ref, project_id: pidOf(kind, ref) || null, title, rationale, payload, status: "pending", result: null, created: now(), decided: null });
const audit = (title, pid = null, detail = "") => add("actions", { agent: "User", kind: "edit", ref_id: null, project_id: pid ? +pid : null, title, rationale: detail || (ME ? ME.name : "System"), payload: {}, status: "recorded", result: null, created: now(), decided: now() });
const release = (pid, status) => { upd("payouts", pid, { status }); S.timesheets.filter(t => t.payout_id == pid).forEach(t => upd("timesheets", t.id, { payout_id: null, status: "approved" })); };

// ---- agents ----------------------------------------------------------------------------------------------------
async function siteAgent(raw, p) {
  const o = await gem("You are a construction site clerk. Convert the field note into JSON with keys: work_completed (string[]), crew_count (int|null), delays ([{cause:string,tasks_affected:string[]}]), risks (string[]), materials (string[]), milestone_complete (bool), milestone_name (string|null), follow_up_question (string|null: ask if key info is missing, never guess), delay_days (int|null, only if the note states a number of days), extra_hours (int|null, only if stated). Project: " + p.name + ". Note: " + raw);
  return o && typeof o === "object" ? E.normalize(o, "gemini") : E.siteFallback(raw);
}
const tplReminder = inv => { const t = E.toneFor(inv.late, inv.days_over), when = inv.days_over > 0 ? `is ${inv.days_over} days past due` : `is due on ${inv.due_date}`, what = `invoice ${inv.number} for ${money(inv.amount)} on ${inv.project}`;
  const note = t.tone === "firm but friendly" ? `Hi ${inv.client}, our records show ${what} ${when}. Please arrange payment this week or tell us when we can expect it.`
    : t.tone === "light and brief" ? `Hi ${inv.client}, a quick reminder that ${what} ${when}. Thank you!` : `Hi ${inv.client}, ${what} ${when}. Please let us know if anything is holding up payment.`;
  return { subject: `Reminder: invoice ${inv.number}`, note, source: "template", tone: t }; };
async function draftReminder(inv) {
  const facts = [inv.number, money(inv.amount), inv.days_over, inv.project, inv.client], t = E.toneFor(inv.late, inv.days_over);
  const o = await gem(`Write a payment reminder to the client ${inv.client}, tone ${t.tone}, 2 sentences. Use ONLY these facts and no other numbers: ${JSON.stringify(facts)}. Return JSON {subject, note}.`);
  if (o && o.note && o.subject && E.grounded(o.subject + " " + o.note, facts)) return { subject: o.subject, note: o.note, source: "gemini", tone: t };
  return tplReminder(inv);
}
const explainTpl = (lines, delays) => { const over = lines.filter(l => l.var > 0); if (!over.length) return "All categories are within the planned spend to date.";
  return over.map(l => `${l.category[0].toUpperCase() + l.category.slice(1)} is ${money(l.var)} over plan (${l.pct}%).`).join(" ") + (delays.length ? " Recent site delays: " + delays.join("; ") + "." : ""); };
async function explain(lines, delays) {
  const tpl = explainTpl(lines, delays), over = lines.filter(l => l.var > 0); if (!over.length) return tpl;
  const facts = [...over.map(l => `${l.category} ${money(l.var)} ${l.pct}%`), ...delays];
  const o = await gem(`Explain this construction budget variance in 2 plain sentences for a project manager. Use ONLY these facts and no other numbers: ${JSON.stringify(facts)}. Return JSON {"text": string}.`);
  return o && typeof o.text === "string" && E.grounded(o.text, facts) ? o.text : tpl;
}
let WX = { t: 0, v: [] };
async function weather() {
  if (Date.now() - WX.t < 18e5) return WX.v;
  try { const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&daily=precipitation_sum,temperature_2m_min&forecast_days=7&timezone=auto`, { signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined })).json();
    WX = { t: Date.now(), v: j.daily.time.map((date, i) => ({ date, rain: j.daily.precipitation_sum[i], tmin: j.daily.temperature_2m_min[i] })) };
  } catch (e) { WX = { t: Date.now() - 12e5, v: [] }; } return WX.v;
}

// ---- actions: tiered approval and PayPal execution -------------------------------------------------------------
async function execute(a) {
  const rid = "maplepro-action-" + a.id, p = a.payload;
  if (a.kind === "remind") { const inv = S.invoices.find(i => i.id == a.ref_id), c = cl(inv.client_id);
    if (inv.paypal_id) return api("paypal/remind", { id: inv.paypal_id, subject: p.subject, note: p.note, rid });
    const r = await api("paypal/invoice", { number: inv.number, email: c.email, items: [[`Invoice ${inv.number}`, inv.amount]], note: p.note, rid }); upd("invoices", inv.id, { paypal_id: r.id }); return r; }
  if (a.kind === "send_invoice") { const inv = S.invoices.find(i => i.id == a.ref_id), c = cl(inv.client_id);
    const r = await api("paypal/invoice", { number: inv.number, email: c.email, items: [[p.desc || `Invoice ${inv.number}`, inv.amount]], note: p.desc || "", rid }); upd("invoices", inv.id, { paypal_id: r.id, status: "sent" }); return r; }
  if (a.kind === "create_invoice") { const pr = proj(a.ref_id), c = cl(pr.client_id), n = Math.max(0, ...S.invoices.map(i => i.id)) + 100, number = `INV-${new Date().getFullYear()}-${String(n).padStart(3, "0")}`;
    const lines = p.lines || [[`${p.milestone} (net of ${CFG.holdback * 100}% holdback)`, p.amount]];
    const r = await api("paypal/invoice", { number, email: c.email, items: lines, note: p.milestone ? "Progress billing: " + p.milestone : "", rid });
    add("invoices", { number, project_id: pr.id, client_id: pr.client_id, amount: p.amount, due_date: addD(today(), 30), status: "sent", paypal_id: r.id, paid_date: null });
    if (p.holdback > 0) add("holdbacks", { project_id: pr.id, kind: "receivable", party: pr.client_id, amount: p.holdback, due: addD(today(), 45), status: "held" }); return r; }
  if (a.kind === "payout") { const po = S.payouts.find(x => x.id == p.payout_id), u = S.users.find(x => x.id == po.user_id);
    const b = (await api("paypal/balance")).balance; if (b != null && po.amount > b) throw new Error(`Insufficient PayPal balance (${b})`);
    const r = await api("paypal/payout", { batch_id: "maplepro-payout-" + po.id, items: [["payout-" + po.id, u.email, po.amount]], note: "Subcontractor payment" });
    const st = r.mock ? "paid" : "processing"; upd("payouts", po.id, { status: st, batch_id: r.batch });
    if (st === "paid") S.timesheets.filter(t => t.payout_id == po.id).forEach(t => upd("timesheets", t.id, { status: "paid" }));
    if (po.holdback > 0) add("holdbacks", { project_id: po.project_id, kind: "payable", party: po.user_id, amount: po.holdback, due: addD(today(), 45), status: "held" }); return r; }
  if (a.kind === "release_holdback") { const h = S.holdbacks.find(x => x.id == p.holdback_id); let r;
    if (h.kind === "payable") { const u = S.users.find(x => x.id == h.party); r = await api("paypal/payout", { batch_id: "maplepro-holdback-" + h.id, items: [["holdback-" + h.id, u.email, h.amount]], note: "Holdback release" }); }
    else { const c = cl(h.party), n = Math.max(0, ...S.invoices.map(i => i.id)) + 100, number = `INV-${new Date().getFullYear()}-${String(n).padStart(3, "0")}`;
      r = await api("paypal/invoice", { number, email: c.email, items: [["Holdback release", h.amount]], note: "Release of retained holdback", rid });
      add("invoices", { number, project_id: h.project_id, client_id: c.id, amount: h.amount, due_date: addD(today(), 30), status: "sent", paypal_id: r.id, paid_date: null }); }
    upd("holdbacks", h.id, { status: "released" }); return r; }
  throw new Error("unknown action");
}
async function run(a, by) { let st = "executed", res;
  try { res = { by, ...(await execute(a)) }; } catch (e) { st = "failed"; res = { by, error: String(e.message || e) }; if (a.kind === "payout") release(a.payload.payout_id, "failed"); if (a.kind === "release_holdback") upd("holdbacks", a.payload.holdback_id, { status: "held" }); }
  upd("actions", a.id, { status: st, result: res, decided: now() }); }
function onPaid(invId) {  // client payment landed -> propose payouts for approved timesheets, holdback applied
  const pid = S.invoices.find(i => i.id == invId).project_id, by = {};
  S.timesheets.filter(t => t.project_id == pid && t.status === "approved" && !t.payout_id).forEach(t => (by[t.user_id] ||= []).push(t));
  for (const [uid, ts] of Object.entries(by)) { const gross = ts.reduce((s, t) => s + t.hours * t.rate, 0), h = ts.reduce((s, t) => s + t.hours, 0), { hold, net } = E.holdbackSplit(gross, CFG.holdback);
    const po = add("payouts", { project_id: pid, user_id: +uid, amount: net, holdback: hold, status: "proposed", batch_id: null });
    ts.forEach(t => upd("timesheets", t.id, { payout_id: po.id, status: "in_payout" }));
    logAction("Billing", "payout", pid, `Pay ${S.users.find(u => u.id == uid).name} for ${h} approved hours`, `Client payment received. ${h} approved hours, gross ${money(gross)}, holdback ${money(hold)}, net ${money(net)}.`, { payout_id: po.id, amount: net, holdback: hold }); }
}
async function sync() {
  for (const i of S.invoices.filter(i => i.status === "sent" && i.paypal_id && !i.paypal_id.startsWith("MOCK-"))) {
    try { const st = (await api("paypal/invoice-status", { id: i.paypal_id })).status; if (st) { upd("invoices", i.id, { status: st, paid_date: st === "paid" ? today() : null }); if (st === "paid") onPaid(i.id); } } catch (e) {} }
  for (const po of S.payouts.filter(p => p.status === "processing")) {
    try { const st = (await api("paypal/payout-status", { id: po.batch_id })).status;
      if (st === "paid") { upd("payouts", po.id, { status: "paid" }); S.timesheets.filter(t => t.payout_id == po.id).forEach(t => upd("timesheets", t.id, { status: "paid" })); } else if (st === "failed") release(po.id, "failed"); } catch (e) {} }
}
async function autoRemind() {  // optional low-stakes automation: reminds clients about invoices that are 7+ days overdue, at most once a week
  if (!CFG.autoRemind) return; let n = 0;
  for (const i of invs().filter(x => x.days_over >= 7)) { if (n >= 3 || (i.last_reminder && diff(today(), i.last_reminder) < 7)) continue; const d = tplReminder(i);
    const a = logAction("Billing", "remind", i.id, `Automatic reminder to ${i.client} for ${i.number}`, `Automatic reminder: ${i.days_over} days overdue, tone ${d.tone.tone}.`, { subject: d.subject, note: d.note });
    await run(a, "auto (low-stakes tier)"); upd("invoices", i.id, { last_reminder: today() }); n++; }
}

// ---- UI ---------------------------------------------------------------------------------------------------------
const bdg = (t, k = "n") => `<span class="badge b-${k}">${esc(t)}</span>`;
const TONE = { executed: "ok", paid: "ok", approved: "ok", Accepted: "ok", Available: "ok", Closed: "ok", sent: "info", Sent: "info", "In use": "info", processing: "info", in_payout: "info", pending: "warn", submitted: "warn", proposed: "warn", Open: "warn", Investigating: "warn", Maintenance: "warn", Medium: "warn", failed: "bad", High: "bad", Critical: "bad" };
const st = s => bdg(s, TONE[s] || "n");
const bar = (v, k = "bg-blue-600") => `<div class="h-2 rounded-full" style="background:var(--hover)"><div class="h-2 rounded-full ${k}" style="width:${Math.min(Math.max(v, 0), 100)}%"></div></div>`;
const btn = (label, act, data = "", k = "") => `<button data-act="${act}" ${data} class="btn ${k}">${label}</button>`;
const head = (t, s = "", a = "") => `<div class="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 class="text-2xl font-semibold tracking-tight">${t}</h1>${s ? `<p class="muted mt-1 text-sm">${s}</p>` : ""}</div><div class="flex flex-wrap gap-2">${a}</div></div>`;
const sec = (t, body, a = "") => `<section class="mt-8"><div class="mb-3 flex items-center justify-between gap-2"><h2 class="text-base font-semibold">${t}</h2>${a}</div>${body}</section>`;
const stat = (l, v, sub = "") => `<div class="card p-4"><div class="muted text-xs">${l}</div><div class="mt-1 text-2xl font-semibold">${v}</div>${sub ? `<div class="muted mt-1 text-xs">${sub}</div>` : ""}</div>`;
const stats = a => `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-${Math.min(a.length, 4)}">${a.map(x => stat(...x)).join("")}</div>`;
const tbl = (cols, rows, plain) => `<div class="${plain ? "overflow-x-auto border-t" : "card overflow-x-auto"}" ${plain ? 'style="border-color:var(--border)"' : ""}><table class="w-full text-sm"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="muted">Nothing here yet.</td></tr>`}</tbody></table></div>`;
const fld = ([k, l, type = "text", opts, optional]) => `<label class="block text-sm font-medium">${l}${optional ? ' <span class="muted font-normal">(optional)</span>' : ""}` + (type === "select"
  ? `<select name="${k}" ${optional ? "" : "required"} class="input mt-1">${optional ? '<option value="">None</option>' : ""}${(typeof opts === "function" ? opts() : opts).map(o => Array.isArray(o) ? `<option value="${o[0]}">${esc(o[1])}</option>` : `<option>${esc(o)}</option>`).join("")}</select>`
  : type === "file" ? `<input name="${k}" type="file" ${opts || ""} ${optional ? "" : "required"} class="input mt-1">`
  : type === "textarea" ? `<textarea name="${k}" ${optional ? "" : "required"} rows="3" class="input mt-1"></textarea>`
  : `<input name="${k}" type="${type}" ${optional ? "" : "required"} step="any" class="input mt-1">`) + "</label>";
const form = (name, fields, label = "Save", data = "") => `<form data-form="${name}" ${data} class="grid gap-4 sm:grid-cols-2">${fields.map(f => `<div ${["textarea"].includes(f[2]) ? 'class="sm:col-span-2"' : ""}>${fld(f)}</div>`).join("")}<div class="sm:col-span-2"><button class="btn btn-primary">${label}</button></div></form>`;
const create = (label, inner) => `<details class="card mb-6 p-5"><summary class="btn btn-primary inline-flex cursor-pointer">+ ${label}</summary><div class="mt-5">${inner}</div></details>`;
const SIZES = [["sm", "Small text", ".75rem"], ["md", "Medium text", ".95rem"], ["lg", "Large text", "1.2rem"]];
const curSize = () => (document.documentElement.classList.contains("lg") ? "lg" : document.documentElement.classList.contains("sm") ? "sm" : "md");
const toggles = () => `<div class="seg" role="group" aria-label="Text size">${SIZES.map(([k, l, fs]) => `<button type="button" data-act="font" data-size="${k}" aria-label="${l}" title="${l}" aria-pressed="${curSize() === k}" style="font-size:${fs};font-weight:600">A</button>`).join("")}</div>` +
  `<button type="button" data-act="theme" class="btn" aria-label="Switch between light and dark mode">${document.documentElement.classList.contains("dark") ? "Light mode" : "Dark mode"}</button>`;
const topbar = (left, mid, right) => `<header class="flex flex-wrap items-center gap-3 border-b px-6 py-3" style="background:var(--surface);border-color:var(--border)">${left}<div class="ml-auto flex flex-wrap items-center gap-2">${mid}${toggles()}${right}</div></header>`;
const brand = `<a href="#/" class="text-lg font-semibold">MaplePro</a>`;
const toast = m => { const t = document.createElement("div"); t.setAttribute("role", "status"); t.className = "card"; t.style.cssText = "position:fixed;bottom:1.5rem;right:1.5rem;padding:.75rem 1rem;z-index:50;font-size:.875rem"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 4000); };
function actCard(a) { const p = a.payload;
  return `<div class="card p-4"><div class="flex flex-wrap items-center gap-2">${bdg(a.agent, "info")}<span class="text-sm font-medium">${esc(a.title)}</span>${a.status !== "pending" ? `<span class="ml-auto">${st(a.status)}</span>` : ""}</div>
  ${p.note ? `<p class="muted mt-2 text-sm">"${esc(p.note)}"</p>` : ""}${p.amount ? `<p class="muted mt-2 text-sm">Amount ${money(p.amount)}${p.holdback ? `, holdback ${money(p.holdback)}` : ""}</p>` : ""}
  <details class="muted mt-2 text-xs"><summary class="cursor-pointer">Why was this proposed?</summary><p class="mt-1">${esc(a.rationale)}</p>${a.result ? `<p class="mt-1 break-all">Result: ${esc(JSON.stringify(a.result))}</p>` : ""}</details>
  ${a.status === "pending" ? `<div class="mt-3 flex gap-2">${btn("Approve and send", "approve", `data-id="${a.id}"`, "btn-primary")}${btn("Reject", "reject", `data-id="${a.id}"`)}</div>` : ""}</div>`; }

const phasesOf = pid => [...new Set(S.tasks.filter(t => t.project_id == pid).map(t => t.phase).filter(Boolean))];
const grp = (lines, key) => { const m = {}; lines.forEach(l => { const k = l[key] || "General", g = (m[k] ||= { key: k, budget: 0, actual: 0, committed: 0 }); g.budget += l.budget; g.actual += l.actual; g.committed += l.committed || 0; }); return E.variance(Object.values(m)); };
const projHealth = p => { const pl = E.plan(S.tasks.filter(t => t.project_id == p.id)), burn = Math.round(p.spent / p.budget * 100), od = sum(invs().filter(i => i.project_id == p.id && i.days_over > 0), i => i.amount);
  return { pl, slip: pl.slip, burn, gap: burn - p.progress, od, late: E.lateAvg(S.invoices.filter(i => i.client_id == p.client_id && i.status === "paid")) }; };
const pills = h => [bdg("Schedule: " + (h.slip > 0 ? h.slip + " days behind" : "on time"), h.slip > 0 ? "warn" : "ok"), bdg("Budget: " + (h.gap >= 8 ? h.gap + " pts over" : "on track"), h.gap >= 8 ? "warn" : "ok"), bdg("Payments: " + (h.od ? money(h.od) + " overdue" : "current"), h.od ? "warn" : "ok")].join(" ");
const stockDays = m => (m.daily_use > 0 ? Math.floor(m.qty / m.daily_use) : null);
const anomalies = () => { const out = [];
  S.timesheets.filter(t => t.status === "submitted").forEach(t => { if (!S.reports.some(r => r.project_id == t.project_id && r.created.slice(0, 10) === t.work_date)) out.push({ pid: t.project_id, ts: t.id, text: `${t.hours} h logged for ${t.work_date} on ${proj(t.project_id).name} with no daily report that day` }); });
  const per = {}; S.timesheets.forEach(t => { const k = t.user_id + "|" + t.work_date; per[k] = (per[k] || 0) + t.hours; });
  Object.entries(per).filter(([, h]) => h > 12).forEach(([k, h]) => { const [u, d] = k.split("|"); out.push({ text: `${S.users.find(x => x.id == u).name} is booked ${h} h on ${d} across projects` }); }); return out; };
const cash = () => E.cashView(invs().map(i => ({ amount: i.amount, due_date: i.due_date, prob: i.prob })), [...S.timesheets.filter(t => ["submitted", "approved"].includes(t.status)).map(t => ({ amount: t.hours * t.rate, date: addD(today(), 3) })), ...S.payouts.filter(p => p.status === "proposed").map(p => ({ amount: p.amount, date: addD(today(), 3) }))], today());
const cashHtml = () => { const rows = cash(), mx = Math.max(1, ...rows.flatMap(r => [r.inflow, r.outflow]));
  return `<div class="card p-5"><div class="space-y-3">${rows.map(r => `<div class="grid grid-cols-[5rem_1fr_9rem] items-center gap-3 text-sm"><span>${r.label}</span><div class="space-y-1">${bar(r.inflow / mx * 100, "bg-emerald-500")}${bar(r.outflow / mx * 100, "bg-red-500")}</div><span class="text-right">${money(r.net)} net</span></div>`).join("")}</div>
  <p class="muted mt-3 text-xs">Green: expected client payments, weighted by payment probability. Red: labor payouts waiting to be paid. Running total after five weeks: ${money(rows[4].cum)}.</p></div>`; };
const barRow = (label, v, max, text, cls = "bg-blue-600") => `<div class="grid grid-cols-[10rem_1fr_10rem] items-center gap-3 py-1 text-sm"><span class="truncate">${label}</span>${bar(max ? v / max * 100 : 0, cls)}<span class="text-right">${text}</span></div>`;
function insights() { const out = [], all = invs(), od = all.filter(i => i.days_over > 0), mk = (agent, text, signals, href, label) => out.push({ agent, text, signals, conf: Math.min(95, 50 + 15 * signals.length), href, label });
  if (od.length) mk("Billing", `${od.length} invoices overdue, ${money(sum(od, i => i.amount))} outstanding.`, [`${od.length} overdue invoices`, `oldest is ${Math.max(...od.map(i => i.days_over))} days late`, `${money(sum(od, i => i.amount))} at risk`], "#/finance", "Open receivables");
  S.projects.forEach(p => { const h = projHealth(p);
    if (h.slip > 0) mk("Schedule", `${p.name}: forecast finish is ${h.slip} days behind the baseline.`, [`${h.slip} days behind`, `${h.pl.tasks.filter(t => t.lag > 0 || t.slip > 0).length} tasks behind or delayed`], `#/projects/${p.id}/schedule`, "View schedule");
    if (h.gap >= 8) mk("Budget", `${p.name}: ${h.burn}% of budget spent against ${p.progress}% progress.`, [`${h.gap} points ahead of progress`, `forecast at completion ${money(E.eac(p.spent, p.progress) || 0)}`], `#/projects/${p.id}/schedule`, "View budget");
    if (h.late != null && h.late > 7 && h.od > 0) mk("Billing", `${cl(p.client_id).name} usually pays ${h.late} days late and has ${money(h.od)} outstanding.`, [`average ${h.late} days late`, `${money(h.od)} overdue`], "#/finance", "Open receivables"); });
  const low = S.materials.filter(m => stockDays(m) != null && stockDays(m) <= 14); if (low.length) mk("Resources", `${low.length} material${low.length > 1 ? "s" : ""} will run out within 14 days: ${low.slice(0, 3).map(m => m.name).join(", ")}.`, [`${low.length} materials`, "based on daily use"], "#/materials", "See materials");
  const an = anomalies(); if (an.length) mk("Resources", an[0].text + (an.length > 1 ? ` (+${an.length - 1} more)` : ""), [`${an.length} timesheet checks`], an[0].pid ? `#/projects/${an[0].pid}/time` : "#/projects", "Review timesheets");
  if (cash().some(w => w.cum < 0)) mk("Cash", "Cash is forecast to go negative within 30 days.", ["weekly inflow vs outflow"], "#/finance", "See cash view"); return out; }
const NAV = [["#/", "Command Center"], ["#/finance", "Financial Intelligence"], ["#/field", "Field Operations"], ["#/analytics", "Analytics"], ["#/projects", "Projects"], ["#/clients", "Clients"], ["#/proposals", "Proposals"], ["#/invoices", "Invoices"],
  ["#/reports", "Reports"], ["#/materials", "Materials"], ["#/equipment", "Equipment"], ["#/safety", "Safety"], ["#/budget", "Budget"], ["#/approvals", "Approvals"], ["#/admin", "Admin"]];
function layout(body) {
  const nav = staff() ? NAV.filter(n => n[1] !== "Admin" || ME.role === "admin") : [["#/", "My work"]], cur = location.hash || "#/", on = h => (h === "#/" ? cur === "#/" || cur === "" : cur.startsWith(h));
  const pend = S.actions.filter(a => a.status === "pending").length;
  return `<div class="flex min-h-screen"><aside class="hidden w-60 shrink-0 p-4 md:block" style="background:var(--side)"><div class="px-3 pb-6 pt-2 text-lg font-semibold text-white">MaplePro</div>
  <nav class="space-y-1">${nav.map(([h, l]) => `<a href="${h}" class="flex items-center justify-between rounded-lg px-3 py-2 text-sm ${on(h) ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}">${l}${l === "Approvals" && pend ? `<span class="badge b-warn">${pend}</span>` : ""}</a>`).join("")}</nav></aside>
  <div class="min-w-0 flex-1">${topbar(`<span class="text-sm font-medium">Welcome, ${esc(ME.name)}</span>`,
    `<form data-form="ask" class="min-w-[14rem]"><label class="sr-only" for="q">Search</label><input id="q" name="q" class="input" placeholder="Search (Ctrl K)"></form>`,
    `<span class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white" title="${esc(ME.email)}">${esc(ME.name[0])}</span>${btn("Sign out", "logout")}`)}
  <nav class="flex gap-2 overflow-x-auto border-b p-2 md:hidden" style="border-color:var(--border)">${nav.map(([h, l]) => `<a href="${h}" class="btn">${l}</a>`).join("")}</nav>
  <main class="mx-auto max-w-6xl p-6 md:p-8">${body}</main></div></div>`; }

const V = {};
V.landing = () => `<div class="min-h-screen">${topbar(brand, "", '<a href="#/login" class="btn btn-primary">Sign in</a>')}
  <section class="mx-auto max-w-6xl px-6 pb-16 pt-20"><h1 class="max-w-3xl text-4xl font-bold leading-tight tracking-tight md:text-5xl">Run every project, budget and invoice in one place.</h1>
  <p class="muted mt-5 max-w-2xl text-lg">MaplePro gives contractors a clear view of schedules, costs, field work and payments, so problems show up early and invoices go out on time.</p></section>
  <section class="mx-auto max-w-6xl px-6 pb-20"><div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${[["Projects and schedules", "Track tasks, dependencies, the critical path and weather risk for every job."], ["Budgets and costs", "Compare planned and actual spend by category and see variances as they happen."],
    ["Field operations", "Daily reports, materials, equipment and safety incidents, together."], ["Invoicing and payments", "Send invoices and pay subcontractors through PayPal, with approvals you control."], ["Clients and subcontractors", "Each person sees only their own projects, invoices and timesheets."], ["Reports", "Materials, equipment, safety and budget reports you can export."]]
    .map(([t, d]) => `<div class="card p-5"><h3 class="font-semibold">${t}</h3><p class="muted mt-2 text-sm">${d}</p></div>`).join("")}</div></section>
  <footer class="muted border-t px-6 py-6 text-center text-sm" style="border-color:var(--border)">&copy; ${new Date().getFullYear()} MaplePro</footer></div>`;
V.login = () => `<div class="min-h-screen">${topbar(brand, "", "")}<div class="mx-auto max-w-md px-6 py-16"><h1 class="text-2xl font-semibold tracking-tight">Sign in</h1><p class="muted mt-1 text-sm">Use your MaplePro account.</p>
  <form data-form="login" class="card mt-6 space-y-4 p-6"><label class="block text-sm font-medium">Email<input id="email" name="email" type="email" required autocomplete="username" class="input mt-1"></label>
  <label class="block text-sm font-medium">Password<input id="password" name="password" type="password" required autocomplete="current-password" class="input mt-1"></label><button class="btn btn-primary w-full justify-center py-2.5">Sign in</button></form>
  <p class="mt-4 text-center text-sm"><a href="#/" class="link">Back to home</a></p></div></div>`;

V.command = () => { const all = invs(), od = all.filter(i => i.days_over > 0), pend = S.actions.filter(a => a.status === "pending").reverse(), ins = insights(), urgent = od.filter(i => i.days_over >= 14), week = [];
  S.projects.filter(p => !S.reports.some(r => r.project_id == p.id)).forEach(p => week.push(["Reports", `No daily report yet for ${esc(p.name)}`, `#/projects/${p.id}/reports`, "Write report"]));
  S.timesheets.filter(t => t.status === "submitted").forEach(t => week.push(["Timesheets", `${t.hours} h from ${esc(S.users.find(u => u.id == t.user_id).name)} waiting for approval`, `#/projects/${t.project_id}/time`, "Review"]));
  all.filter(i => i.days_over === 0 && i.due_date > today()).forEach(i => week.push(["Billing", `${i.number} is due in ${diff(i.due_date, today())} days`, "#/invoices", "Open"]));
  const row = (agent, text, sub, href, label) => `<div class="mt-3 text-sm"><div class="flex flex-wrap items-center gap-2">${bdg(agent, "info")}<span>${text}</span></div>${sub ? `<div class="muted mt-1 text-xs">${sub}</div>` : ""}<a href="${href}" class="btn mt-2">${label}</a></div>`;
  return head("Command Center", "What needs your attention across all projects.") + stats([["Active projects", S.projects.length], ["Overdue receivables", money(sum(od, i => i.amount))], ["Awaiting approval", pend.length], ["Spent of contract", money(sum(S.projects, p => p.spent)), "of " + money(sum(S.projects, p => p.budget))]]) +
  sec("Intelligence stream", `<div class="card divide-y" style="border-color:var(--border)">${ins.map(x => `<div class="p-4 text-sm" style="border-color:var(--border)"><div class="flex flex-wrap items-center gap-3">${bdg(x.agent, "info")}<span>${esc(x.text)}</span><span class="muted ml-auto text-xs">confidence ${x.conf}%</span><a class="btn" href="${x.href}">${x.label}</a></div>
    <details class="muted mt-2 text-xs"><summary class="cursor-pointer">Why this was flagged</summary><p class="mt-1">Based on: ${esc(x.signals.join("; "))}. Confidence starts at 50% and rises 15% for each supporting signal, up to 95%.</p></details></div>`).join("") || '<p class="muted p-4 text-sm">No risks detected.</p>'}</div>`) +
  sec("Priority", `<div class="grid gap-4 md:grid-cols-3"><div class="card p-4"><div class="font-medium text-red-600">Urgent</div>${urgent.map(i => row("Billing", `${i.number} · ${esc(i.client)} · ${i.days_over} days overdue`, `${money(i.amount)} · ${i.prob}% chance of payment (estimated)`, `#/remind/${i.id}`, "Remind " + esc(i.client))).join("") || '<p class="muted mt-2 text-sm">Nothing urgent.</p>'}</div>
  <div class="card p-4"><div class="font-medium text-amber-600">Today</div>${pend.slice(0, 3).map(a => row(a.agent, esc(a.title), "", "#/approvals", "Review")).join("") || '<p class="muted mt-2 text-sm">Nothing waiting for approval.</p>'}</div>
  <div class="card p-4"><div class="font-medium text-blue-600">This week</div>${week.slice(0, 4).map(w => row(...w.slice(0, 2), "", w[2], w[3])).join("") || '<p class="muted mt-2 text-sm">All clear.</p>'}</div></div>`) +
  sec("Active projects", `<div class="grid gap-4 md:grid-cols-3">${S.projects.map(p => { const h = projHealth(p); return `<a href="#/projects/${p.id}" class="card block p-4 hover:border-blue-400"><div class="text-sm font-medium">${esc(p.name)}</div><p class="muted text-xs">${esc(cl(p.client_id).name)}</p>
    <div class="mt-3 text-xs">Progress ${p.progress}%</div>${bar(p.progress)}<div class="mt-2 text-xs">Budget used ${h.burn}%</div>${bar(h.burn, h.gap >= 8 ? "bg-amber-500" : "bg-emerald-500")}<div class="mt-3 flex flex-wrap gap-1">${pills(h)}</div></a>`; }).join("")}</div>`) +
  (pend.length ? sec("Waiting for approval", `<div class="space-y-3">${pend.map(actCard).join("")}</div>`) : ""); };

V.portal = () => { const ps = myProjects(), ids = ps.map(p => p.id), mine = S.timesheets.filter(t => t.user_id == ME.id).reverse();
  const cos = S.change_orders.filter(c => c.status === "Pending client" && ids.includes(c.project_id)), props = S.proposals.filter(p => p.client_id == ME.client_id && p.status === "Sent");
  return head("My work", "Your projects and activity.") + sec("Projects", `<div class="grid gap-4 md:grid-cols-3">${ps.map(p => `<div class="card p-4"><div class="text-sm font-medium">${esc(p.name)}</div><div class="mt-2 text-xs">Progress ${p.progress}%</div>${bar(p.progress)}</div>`).join("") || '<p class="muted text-sm">No projects assigned.</p>'}</div>`) +
  (ME.role === "client" ? sec("Waiting for your approval", `<div class="space-y-3">${cos.map(c => `<div class="card p-4"><div class="flex flex-wrap items-center gap-2"><b>${c.number}: ${esc(c.title)}</b><span class="ml-auto font-semibold">${money(c.amount)}</span></div><p class="muted mt-1 text-sm">${esc(proj(c.project_id).name)}${c.description ? " · " + esc(c.description) : ""}</p>
      <div class="mt-3 flex gap-2">${btn("Approve", "cdecide", `data-id="${c.id}" data-d="approve"`, "btn-primary")}${btn("Decline", "cdecide", `data-id="${c.id}" data-d="decline"`)}</div></div>`).join("")}
    ${props.map(p => `<div class="card p-4"><div class="flex flex-wrap items-center gap-2"><b>Proposal: ${esc(p.title)}</b><span class="ml-auto font-semibold">${money(p.amount)}</span></div><div class="mt-3 flex gap-2">${btn("Accept", "paccept", `data-id="${p.id}"`, "btn-primary")}${btn("Decline", "pdecline", `data-id="${p.id}"`)}</div></div>`).join("")}
    ${cos.length + props.length ? "" : '<p class="muted text-sm">Nothing waiting for you.</p>'}</div>`) +
    sec("Invoices", tbl(["Invoice", "Project", "Amount", "Due", "Status"], S.invoices.filter(i => i.client_id == ME.client_id).map(i => [i.number, esc(proj(i.project_id).name), money(i.amount), i.due_date, st(i.status)]))) +
    sec("Change orders", tbl(["Number", "Title", "Amount", "Status"], S.change_orders.filter(c => ids.includes(c.project_id)).map(c => [c.number, esc(c.title), money(c.amount), st(c.status)]))) :
  sec("Submit timesheet", `<div class="card p-5">${form("ts", [["project_id", "Project", "select", () => ps.map(p => [p.id, p.name])], ["work_date", "Date", "date"], ["hours", "Hours", "number"]], "Submit")}</div>`) +
  sec("My timesheets", tbl(["Date", "Project", "Hours", "Status"], mine.map(t => [t.work_date, esc(proj(t.project_id).name), t.hours, st(t.status)]))) +
  sec("My payouts", tbl(["Amount", "Holdback withheld", "Status"], S.payouts.filter(p => p.user_id == ME.id).map(p => [money(p.amount), money(p.holdback), st(p.status)]))) +
  sec("My holdback", tbl(["Amount", "Release due", "Status"], S.holdbacks.filter(h => h.kind === "payable" && h.party == ME.id).map(h => [money(h.amount), h.due, st(h.status === "held" ? "pending" : h.status)])))); };

V.finance = () => { const all = invs(), od = all.filter(i => i.days_over > 0), high = all.filter(i => i.risk === "high"), ok = all.filter(i => i.days_over === 0), hbs = [...S.holdbacks].reverse();
  return head("Financial Intelligence", "Receivables, payment risk and who to follow up with.", ST.paypal ? btn("Refresh payment status", "sync") : "") +
  stats([["Outstanding", money(sum(all, i => i.amount))], ["Overdue", money(sum(od, i => i.amount))], ["High-risk invoices", high.length], ["Collected", money(sum(S.invoices.filter(i => i.status === "paid"), i => i.amount))]]) + sec("30-day cash view", cashHtml()) +
  sec(`High risk (${high.length})`, `<div class="space-y-3">${high.map(i => `<div class="card p-4" style="border-color:#fca5a5"><div class="flex flex-wrap items-center gap-2"><span class="font-medium">${i.number}</span>${bdg(i.days_over + " days overdue", "bad")}<span class="ml-auto font-semibold">${money(i.amount)}</span></div>
  <p class="muted text-sm">${esc(i.client)} · ${esc(i.project)}${i.late != null ? ` · usually pays ${i.late} days late` : ""}</p><p class="mt-1 text-sm">Payment probability <b>${i.prob}%</b> <span class="muted text-xs">(estimated from days overdue and amount)</span></p>
  <div class="mt-3 flex flex-wrap gap-2"><a href="#/remind/${i.id}" class="btn btn-primary">Remind ${esc(i.client)}</a>${btn("Mark as paid", "simpaid", `data-id="${i.id}"`)}</div></div>`).join("") || '<p class="muted text-sm">No high-risk invoices.</p>'}</div>`) +
  sec(`On track (${ok.length})`, tbl(["Invoice", "Client", "Amount", "Due", "Likely on time"], ok.map(i => [i.number, esc(i.client), money(i.amount), i.due_date, i.prob + "%"]))) +
  sec("Holdback", tbl(["Project", "Held for", "Amount", "Release due", "Status", ""], hbs.map(h => [esc(proj(h.project_id).name), h.kind === "payable" ? esc(S.users.find(u => u.id == h.party).name) + " (subcontractor)" : esc(cl(h.party).name) + " (client)", money(h.amount), h.due, st(h.status === "held" ? "pending" : h.status), h.status === "held" ? btn("Propose release", "release", `data-id="${h.id}"`) : ""]))); };

V.remind = async id => { const inv = invs().find(i => i.id == id);
  if (!inv) return `<a href="#/finance" class="link text-sm">Back</a>` + head("Reminder", "This invoice is not waiting for payment.");
  const d = ST.gemini ? await draftReminder(inv) : tplReminder(inv);
  return `<a href="#/finance" class="link text-sm">Back to Financial Intelligence</a><div class="mt-2">${head("Remind " + esc(inv.client), `Invoice ${inv.number} · ${money(inv.amount)} · ${inv.days_over > 0 ? inv.days_over + " days overdue" : "due " + inv.due_date}`)}</div>
  <div class="grid gap-4 lg:grid-cols-3"><div class="card p-5 lg:col-span-2"><form data-form="sendremind" data-id="${inv.id}" class="space-y-4">
  <div class="text-sm"><div class="muted">To</div><div class="font-medium">${esc(inv.client)} &lt;${esc(inv.email)}&gt;</div></div>
  <label class="block text-sm font-medium">Subject<input name="subject" required value="${esc(d.subject)}" class="input mt-1"></label>
  <label class="block text-sm font-medium">Message<textarea name="note" required rows="5" class="input mt-1">${esc(d.note)}</textarea></label>
  <p class="muted text-xs">Sent to the client as a PayPal invoice reminder. ${d.source === "gemini" ? "The wording was suggested by Gemini" : "The wording is a template"}; edit it before sending.</p>
  <div class="flex gap-2"><button class="btn btn-primary">Send reminder</button><a href="#/finance" class="btn">Cancel</a></div></form></div>
  <div class="card p-5 text-sm"><h2 class="font-semibold">Invoice</h2><dl class="mt-3 space-y-2"><div><dt class="muted">Project</dt><dd>${esc(inv.project)}</dd></div><div><dt class="muted">Amount</dt><dd>${money(inv.amount)}</dd></div><div><dt class="muted">Due</dt><dd>${inv.due_date}</dd></div><div><dt class="muted">Chance of on-time payment</dt><dd>${inv.prob}%</dd></div><div><dt class="muted">Payment history</dt><dd>${E.toneFor(inv.late, inv.days_over).hint}</dd></div><div><dt class="muted">Suggested tone</dt><dd>${(d.tone || E.toneFor(inv.late, inv.days_over)).tone}</dd></div></dl></div></div>`; };

V.invoices = () => head("Invoices", "Create invoices and send them through PayPal after approval.") +
  create("New invoice", form("invoice", [["project_id", "Project", "select", () => S.projects.map(p => [p.id, p.name])], ["amount", "Amount (CAD)", "number"], ["due_date", "Due date", "date"], ["description", "Description", "text", null, 1]], "Create and request approval")) +
  tbl(["Invoice", "Client", "Project", "Amount", "Due", "Status", ""], [...S.invoices].reverse().map(i => { const over = Math.max(diff(today(), i.due_date), 0) > 0;
    return [i.number, esc(cl(i.client_id).name), esc(proj(i.project_id).name), money(i.amount), i.due_date, st(i.status), i.status === "sent" ? `<div class="flex gap-2">${over ? `<a href="#/remind/${i.id}" class="btn">Remind ${esc(cl(i.client_id).name)}</a>` : ""}${btn("Mark as paid", "simpaid", `data-id="${i.id}"`)}</div>` : ""]; }));

const ENT = {
  clients: { t: "Clients", one: "client", sub: "People and companies you build for.", f: [["name", "Name"], ["email", "Email", "email"], ["phone", "Phone", "tel", null, 1]], cols: ["Name", "Email", "Phone", "Projects"], row: c => [esc(c.name), esc(c.email), esc(c.phone || "-"), S.projects.filter(p => p.client_id == c.id).length] },
  proposals: { t: "Proposals", one: "proposal", sub: "Quotes you have sent or are preparing. Accepting one proposes the deposit invoice.", f: [["title", "Title"], ["client_id", "Client", "select", () => S.clients.map(c => [c.id, c.name])], ["project_id", "Project (for the deposit invoice)", "select", () => S.projects.map(p => [p.id, p.name]), 1], ["amount", "Amount (CAD)", "number"], ["status", "Status", "select", ["Draft", "Sent", "Accepted", "Declined"]]], def: () => ({ created: today() }),
    cols: ["Title", "Client", "Project", "Amount", "Status", "Created", ""], row: p => [esc(p.title), esc(cl(p.client_id).name), p.project_id ? esc(proj(p.project_id).name) : "-", money(p.amount), st(p.status), p.created, ["Draft", "Sent"].includes(p.status) ? `<div class="flex gap-2">${btn("Mark accepted", "paccept", `data-id="${p.id}"`)}${btn("Mark declined", "pdecline", `data-id="${p.id}"`)}</div>` : ""] },
  materials: { t: "Materials", one: "material", sub: "Inventory, usage and when to reorder.", f: [["name", "Name"], ["unit", "Unit"], ["qty", "Quantity", "number"], ["min_qty", "Minimum quantity", "number"], ["unit_cost", "Unit cost (CAD)", "number"], ["daily_use", "Daily use", "number", null, 1]],
    stats: () => [["Total materials", S.materials.length], ["Low stock", S.materials.filter(m => m.qty > 0 && m.qty < m.min_qty).length], ["Reorder within 14 days", S.materials.filter(m => stockDays(m) != null && stockDays(m) <= 14).length], ["Total value", money(sum(S.materials, m => m.qty * m.unit_cost))]],
    cols: ["Material", "Quantity", "Minimum", "Value", "Days of stock", "Reorder by", "Status"], row: m => { const d = stockDays(m);
      return [esc(m.name), `${m.qty} ${esc(m.unit)}`, m.min_qty, money(m.qty * m.unit_cost), d == null ? "-" : d + " days", d == null ? "-" : addD(today(), Math.max(0, d - 7)), m.qty <= 0 ? bdg("Out of stock", "bad") : m.qty < m.min_qty ? bdg("Low stock", "warn") : d != null && d <= 14 ? bdg("Reorder soon", "warn") : bdg("In stock", "ok")]; } },
  equipment: { t: "Equipment", one: "equipment", sub: "Fleet availability and usage.", f: [["name", "Name"], ["type", "Type"], ["status", "Status", "select", ["Available", "In use", "Maintenance"]], ["rate", "Hourly cost (CAD)", "number"]],
    stats: () => [["Total equipment", S.equipment.length], ["Available", S.equipment.filter(e => e.status === "Available").length], ["In use", S.equipment.filter(e => e.status === "In use").length], ["Maintenance", S.equipment.filter(e => e.status === "Maintenance").length]],
    cols: ["Name", "Type", "Status", "Hourly cost"], row: e => [esc(e.name), esc(e.type), st(e.status), money(e.rate)] },
  incidents: { t: "Safety", one: "incident", sub: "Incidents and investigations.", f: [["project_id", "Project", "select", () => S.projects.map(p => [p.id, p.name])], ["type", "What happened"], ["severity", "Severity", "select", ["Low", "Medium", "High", "Critical"]], ["status", "Status", "select", ["Open", "Investigating", "Closed"]], ["date", "Date", "date"], ["description", "Details", "textarea", null, 1]],
    stats: () => [["Total incidents", S.incidents.length], ["High or critical", S.incidents.filter(i => ["High", "Critical"].includes(i.severity) && i.status !== "Closed").length], ["Pending investigations", S.incidents.filter(i => i.status !== "Closed").length]],
    cols: ["Date", "Project", "Incident", "Severity", "Status"], row: i => [i.date, esc(proj(i.project_id).name), esc(i.type), st(i.severity), st(i.status)] },
};
V.entity = k => { const e = ENT[k], rows = [...S[k]].reverse();
  return head(e.t, e.sub) + (e.stats ? `<div class="mb-6">${stats(e.stats())}</div>` : "") + create("New " + e.one, form("create", e.f, "Save", `data-ent="${k}"`)) + tbl(e.cols, rows.map(e.row)); };

V.projects = () => head("Projects", "Grouped by client.") + create("New project", form("project", [["name", "Project name"], ["client_id", "Client", "select", () => S.clients.map(c => [c.id, c.name])], ["budget", "Contract budget (CAD)", "number"], ["due", "Due date", "date"], ["description", "Description", "textarea", null, 1]])) +
  S.clients.filter(c => S.projects.some(p => p.client_id == c.id)).map(c => { const ps = S.projects.filter(p => p.client_id == c.id);
    return sec(`${esc(c.name)} <span class="muted text-sm font-normal">· ${ps.length} project${ps.length > 1 ? "s" : ""} · ${money(ps.reduce((s, p) => s + p.budget, 0))} contracted · ${money(ps.reduce((s, p) => s + p.spent, 0))} spent</span>`,
      tbl(["Project", "Progress", "Budget", "Spent", "Remaining", "Due"], ps.map(p => [`<a class="link" href="#/projects/${p.id}">${esc(p.name)}</a>`, `<div class="w-32">${bar(p.progress)}<span class="text-xs">${p.progress}%</span></div>`, money(p.budget), money(p.spent), money(p.budget - p.spent), p.due]))); }).join("");

V.project = async (id, tab) => { const p = proj(id); if (!p) return "<p>Project not found.</p>"; const c = cl(p.client_id), h = projHealth(p), tasks = S.tasks.filter(t => t.project_id == id);
  const tabs = [["overview", "Overview"], ["schedule", "Schedule and budget"], ["changes", "Change orders"], ["time", "Time tracking"], ["reports", "Daily reports"], ["notes", "Notes"], ["files", "Files"], ["activity", "Activity"]];
  const top = `<a href="#/projects" class="link text-sm">Back to projects</a><div class="mt-2">${head(esc(p.name), `${esc(c.name)} · due ${p.due}`)}</div><div class="mb-6 flex gap-1 overflow-x-auto border-b" style="border-color:var(--border)">${tabs.map(([k, l]) => `<a href="#/projects/${id}/${k}" class="tab whitespace-nowrap ${tab === k ? "on" : ""}">${l}</a>`).join("")}</div>`;
  if (tab === "overview") { const eac = E.eac(p.spent, p.progress), rec = E.recovery(h.pl);
    return top + `<div class="grid gap-4 md:grid-cols-2"><div class="card p-5"><h2 class="font-semibold">Project information</h2><dl class="mt-3 space-y-3 text-sm"><div><dt class="muted">Name</dt><dd>${esc(p.name)}</dd></div><div><dt class="muted">Description</dt><dd>${esc(p.description || "-")}</dd></div><div><dt class="muted">Status</dt><dd>Active</dd></div><div><dt class="muted">Created</dt><dd>${p.created || "-"}</dd></div></dl></div>
    <div class="card p-5"><h2 class="font-semibold">Client information</h2><dl class="mt-3 space-y-3 text-sm"><div><dt class="muted">Client</dt><dd>${esc(c.name)}</dd></div><div><dt class="muted">Email</dt><dd>${esc(c.email)}</dd></div><div><dt class="muted">Phone</dt><dd>${esc(c.phone || "-")}</dd></div></dl></div></div>
    <div class="mt-4">${stats([["Contract budget", money(p.budget)], ["Spent", money(p.spent)], ["Progress", p.progress + "%"], ["Forecast at completion", eac ? money(eac) : "-", eac ? (eac > p.budget ? money(eac - p.budget) + " over budget" : "within budget") : "needs progress to forecast"]])}</div>
    ${sec("Health", `<div class="flex flex-wrap gap-2">${pills(h)}</div>`)}${rec.length ? sec("Recovery options", tbl(["Option", "Days recovered", "Trade-off"], rec.map(r => [esc(r.label), r.days || "-", esc(r.tradeoff)]))) : ""}`; }
  if (tab === "schedule") { const pl = h.pl, lines = E.variance(S.budget_lines.filter(l => l.project_id == id)), reps = S.reports.filter(r => r.project_id == id).reverse(), delays = reps.slice(0, 3).flatMap(r => r.s.delays.map(d => d.cause)), rec = E.recovery(pl), eac = E.eac(p.spent, p.progress);
    POST = async () => { const days = await weather(), el = document.getElementById("wx"); if (el) { const wx = E.wxRisks(pl.tasks, days);
        el.innerHTML = wx.map(w => `<p class="text-sm text-amber-600">Weather risk: ${esc(w.task)} is scheduled on ${w.dates.join(", ")} (rain or freezing forecast).</p>`).join("") || `<p class="muted text-sm">${days.length ? "No weather risks in the next 7 days." : "Weather forecast unavailable."}</p>`; }
      if (ST.gemini) { const t = await explain(lines, delays), w = document.getElementById("why"); if (w) w.textContent = t; } };
    const cat = grp(lines, "category"), phs = grp(lines, "phase"), bt = (rows) => tbl(["", "Plan to date", "Committed", "Actual", "Variance"], rows.map(l => [esc(l.key[0].toUpperCase() + l.key.slice(1)), money(l.budget), money(l.committed), money(l.actual), `<b class="${l.var > 0 ? "text-red-600" : "text-emerald-600"}">${l.pct}%</b>`]));
    return top + sec("Schedule", (pl.finish ? `<p class="mb-3 text-sm">Forecast finish <b>${pl.finish}</b> · baseline ${pl.baseline} · <b class="${pl.slip ? "text-amber-600" : "text-emerald-600"}">${pl.slip} days behind</b> <span class="muted text-xs">(from reported delays and actual progress)</span></p>` : '<p class="muted mb-3 text-sm">No tasks yet. Add the first task below.</p>') +
      tbl(["Task", "Phase", "Start", "Finish", "Vs baseline", "Progress", ""], pl.tasks.map(t => [esc(t.name), esc(t.phase || "-"), t.es, t.ef, t.delta > 0 ? bdg("+" + t.delta + " days", "warn") : bdg("on plan", "ok"), t.progress + "%", (t.critical ? bdg("critical path", "bad") + " " : "") + (t.lag > 0 ? bdg("behind progress", "warn") : "")])) + `<div id="wx" class="mt-3"><p class="muted text-sm">Checking the weather forecast...</p></div>`) +
    (rec.length ? sec("Recovery options", tbl(["Option", "Days recovered", "Trade-off"], rec.map(r => [esc(r.label), r.days || "-", esc(r.tradeoff)]))) : "") +
    create("Add task", form("task", [["name", "Task name"], ["phase", "Phase", "text", null, 1], ["days", "Duration (days)", "number"], ["pred", "Starts after", "select", () => tasks.map(t => [t.id, t.name]), 1], ["start", "Start date (if it starts after nothing)", "date", null, 1], ["wx", "Weather sensitive", "select", ["No", "Yes"]]], "Add task", `data-pid="${id}"`)).replace('class="card mb-6 p-5"', 'class="card mt-4 mb-6 p-5"') +
    (tasks.length ? create("Update task progress", form("progress", [["task_id", "Task", "select", () => tasks.map(t => [t.id, t.name])], ["progress", "Percent complete", "number"]], "Update")) : "") +
    sec("Budget against plan to date", `<p id="why" class="mb-3 text-sm">${esc(explainTpl(lines, delays))}</p>${eac ? `<p class="mb-3 text-sm">Forecast at completion <b>${money(eac)}</b> against a budget of ${money(p.budget)}.</p>` : ""}<h3 class="mb-2 text-sm font-medium">By category</h3>${bt(cat)}<h3 class="mb-2 mt-5 text-sm font-medium">By phase</h3>${bt(phs)}`); }
  if (tab === "changes") { const cos = S.change_orders.filter(x => x.project_id == id).reverse();
    return top + create("New change order", form("co", [["title", "Title"], ["amount", "Amount (CAD)", "number"], ["description", "Description", "textarea", null, 1]], "Save draft", `data-pid="${id}"`)) +
      `<div class="space-y-3">${cos.map(x => `<div class="card p-4 text-sm"><div class="flex flex-wrap items-center gap-2"><b>${x.number}: ${esc(x.title)}</b>${st(x.status)}<span class="ml-auto font-semibold">${money(x.amount)}</span></div>${x.description ? `<p class="muted mt-1">${esc(x.description)}</p>` : ""}
      <details class="muted mt-2 text-xs"><summary class="cursor-pointer">Approval history</summary><ul class="mt-1 space-y-1">${x.history.map(e => `<li>${esc(e.at)} · ${esc(e.by)} · ${esc(e.event)}</li>`).join("")}</ul></details>
      <div class="mt-3 flex flex-wrap gap-2">${x.status === "Draft" ? btn("Send to client", "csend", `data-id="${x.id}"`, "btn-primary") : ""}${x.status === "Pending client" ? btn("Record client approval", "cdecide", `data-id="${x.id}" data-d="approve"`, "btn-primary") + btn("Record decline", "cdecide", `data-id="${x.id}" data-d="decline"`) : ""}</div></div>`).join("") || '<p class="muted text-sm">No change orders yet.</p>'}</div>`; }
  if (tab === "time") { const ts = S.timesheets.filter(t => t.project_id == id).reverse(), subs = S.users.filter(u => u.role === "subcontractor"), an = anomalies();
    return top + (an.filter(a => a.pid == id).map(a => `<p class="mb-2 text-sm text-amber-600">Check: ${esc(a.text)}</p>`).join("")) + create("Log hours", form("hours", [["user_id", "Worker", "select", () => subs.map(u => [u.id, u.name])], ["work_date", "Date", "date"], ["hours", "Hours", "number"]], "Log hours", `data-pid="${id}"`)) +
      tbl(["Date", "Worker", "Hours", "Cost", "Status", ""], ts.map(t => [t.work_date, esc(S.users.find(u => u.id == t.user_id).name), t.hours, money(t.hours * t.rate), st(t.status), t.status === "submitted" ? btn("Approve", "tsapprove", `data-id="${t.id}"`, "btn-primary") : ""])); }
  if (tab === "notes") return top + create("Add note", form("note", [["text", "Note", "textarea"]], "Save note", `data-pid="${id}"`)) + `<div class="space-y-3">${S.notes.filter(n => n.project_id == id).reverse().map(n => `<div class="card p-4 text-sm"><div class="muted text-xs">${esc(n.author)} · ${n.created}</div><p class="mt-1">${esc(n.text)}</p></div>`).join("") || '<p class="muted text-sm">No notes yet.</p>'}</div>`;
  if (tab === "files") return top + create("Upload file", form("file", [["file", "File (up to 1.5 MB)", "file"]], "Upload", `data-pid="${id}"`)) + tbl(["File", "Size", "Uploaded by", "When"], S.files.filter(f => f.project_id == id).reverse().map(f => [`<a class="link" href="${f.url}" download="${esc(f.name)}">${esc(f.name)}</a>`, Math.max(1, Math.round(f.size / 1024)) + " KB", esc(f.by), f.created]));
  if (tab === "activity") return top + tbl(["When", "Who", "What", "Status"], S.actions.filter(a => a.project_id == id).reverse().slice(0, 100).map(a => [a.created.replace("T", " "), esc(a.agent === "User" ? a.rationale : a.agent), esc(a.title), st(a.status)]));
  const reps = S.reports.filter(r => r.project_id == id).reverse();
  return top + create("New daily report", `<form data-form="report" data-pid="${id}"><label class="block text-sm font-medium" for="raw">Field note</label><textarea id="raw" name="raw" required maxlength="4000" rows="4" class="input mt-1" placeholder="Framing complete on levels 3 to 5. Crew of 12. One wall failed inspection and was rebuilt."></textarea>
    <label class="mt-3 block text-sm font-medium">Photos <span class="muted font-normal">(optional, up to 3, 1.5 MB each)</span><input name="photos" type="file" accept="image/*" multiple class="input mt-1"></label>
    <p class="muted mt-1 text-xs">Delays, extra hours, scope changes and finished milestones in the note update the schedule, the budget, change orders and invoicing proposals.</p><button class="btn btn-primary mt-3">Submit report</button></form>`) +
    `<div class="space-y-3">${reps.map(r => { const s = r.s, linked = x => { const m = E.matchTasks(x, tasks).map(t => t.name); return (m.length ? m : [...new Set(s.delays.flatMap(d => d.tasks_affected).map(n => (tasks.find(t => t.name.toLowerCase().includes(n.toLowerCase())) || {}).name).filter(Boolean))]).map(n => bdg(n, "info")).join(" "); };
    return `<div class="card p-4 text-sm"><div class="muted flex gap-2 text-xs">${r.created} ${bdg("read by " + s.source)}</div><p class="mt-2 italic">"${esc(r.raw)}"</p>
    ${s.crew_count ? `<p class="mt-2"><b>Crew on site:</b> ${s.crew_count}</p>` : ""}${s.work_completed.length ? `<p class="mt-2"><b>Work completed:</b> ${esc(s.work_completed.join("; "))}</p>` : ""}${s.materials.length ? `<p class="mt-1"><b>Materials:</b> ${esc(s.materials.join("; "))}</p>` : ""}
    ${s.delays.map(d => `<p class="mt-1 text-amber-600"><b>Delay:</b> ${esc(d.cause)}${d.tasks_affected.length ? ` (affects ${esc(d.tasks_affected.join(", "))})` : ""}</p>`).join("")}${s.safety.length ? `<p class="mt-1 text-red-600"><b>Safety:</b> ${esc(s.safety.join("; "))}</p>` : ""}
    ${s.risks.map(x => `<p class="mt-1"><b>Risk:</b> ${esc(x)} ${linked(x)}</p>`).join("")}${(s.impacts || []).map(i => `<p class="mt-1 text-blue-600">${esc(i)}</p>`).join("")}
    ${s.milestone_complete ? `<p class="mt-1 text-emerald-600">Milestone complete: ${esc(s.milestone_name)}. An invoice is waiting in <a class="link" href="#/approvals">Approvals</a>.</p>` : ""}${s.follow_up_question ? `<p class="mt-1 text-blue-600"><b>Question:</b> ${esc(s.follow_up_question)}</p>` : ""}
    ${(r.photos || []).length ? `<div class="mt-3 flex flex-wrap gap-2">${r.photos.map(f => `<a href="${f.url}" download="${esc(f.name)}"><img src="${f.url}" alt="${esc(f.name)}" class="h-20 rounded"></a>`).join("")}</div>` : ""}</div>`; }).join("") || '<p class="muted text-sm">No reports yet.</p>'}</div>`; };

V.field = () => { const t = today(), repToday = S.reports.filter(r => r.created.slice(0, 10) === t), low = S.materials.filter(m => m.qty < m.min_qty), eq = x => S.equipment.filter(e => e.status === x).length, soon = S.materials.filter(m => stockDays(m) != null && stockDays(m) <= 14), an = anomalies();
  const tb = sum(S.projects, p => p.budget), ta = sum(S.projects, p => p.spent);
  return head("Field Operations", "Live view of sites, stock, equipment and safety.") + stats([["Active sites", S.projects.length], ["Critical issues", S.incidents.filter(i => i.severity === "Critical" && i.status !== "Closed").length], ["Pending reports", S.projects.filter(p => !repToday.some(r => r.project_id == p.id)).length], ["Reports today", repToday.length]]) +
  sec("Active sites", tbl(["Site", "Client", "Progress", ""], S.projects.map(p => [esc(p.name), esc(cl(p.client_id).name), p.progress + "%", `<a class="link" href="#/projects/${p.id}/reports">Daily reports</a>`]))) +
  sec("Material inventory", stats([["Materials", S.materials.length], ["Low stock alerts", low.length], ["Total value", money(sum(S.materials, m => m.qty * m.unit_cost))]]) + (low.length ? `<div class="mt-3">${tbl(["Low stock", "Quantity", "Minimum"], low.map(m => [esc(m.name), m.qty, m.min_qty]))}</div>` : "")) +
  sec("Reorder suggestions", tbl(["Material", "Days of stock", "Reorder by"], soon.map(m => [esc(m.name), stockDays(m) + " days", addD(today(), Math.max(0, stockDays(m) - 7))]))) +
  sec("Crew and timesheet checks", an.length ? `<div class="space-y-2">${an.map(a => `<div class="card p-3 text-sm">${esc(a.text)}</div>`).join("")}</div>` : '<p class="muted text-sm">No timesheet issues.</p>') +
  sec("Equipment utilization", stats([["Total", S.equipment.length], ["Available", eq("Available")], ["In use", eq("In use")], ["Maintenance", eq("Maintenance")]])) +
  sec("Safety", stats([["Total incidents", S.incidents.length], ["High or critical open", S.incidents.filter(i => ["High", "Critical"].includes(i.severity) && i.status !== "Closed").length], ["Pending investigations", S.incidents.filter(i => i.status !== "Closed").length]])) +
  sec("Budget health", stats([["Total budget", money(tb)], ["Total spent", money(ta)], ["Remaining", money(tb - ta)], ["Over budget projects", S.projects.filter(p => p.spent > p.budget).length]])); };

const REPORTS = {
  materials: { t: "Materials Inventory", d: "Stock levels, value and low-stock alerts.", cols: ["Material", "Quantity", "Minimum", "Unit cost", "Value", "Status"], rows: () => S.materials.map(m => [m.name, `${m.qty} ${m.unit}`, m.min_qty, m.unit_cost, m.qty * m.unit_cost, m.qty <= 0 ? "Out of stock" : m.qty < m.min_qty ? "Low stock" : "In stock"]) },
  equipment: { t: "Equipment Utilization", d: "Status and hourly cost of every machine.", cols: ["Name", "Type", "Status", "Hourly cost"], rows: () => S.equipment.map(e => [e.name, e.type, e.status, e.rate]) },
  safety: { t: "Safety Incident Summary", d: "Incidents by project, severity and status.", cols: ["Date", "Project", "Incident", "Severity", "Status"], rows: () => S.incidents.map(i => [i.date, proj(i.project_id).name, i.type, i.severity, i.status]) },
  budget: { t: "Budget Variance Analysis", d: "Contract budget against spend, by project.", cols: ["Project", "Budget", "Spent", "Remaining", "Used %", "Progress %"], rows: () => S.projects.map(p => [p.name, p.budget, p.spent, p.budget - p.spent, Math.round(p.spent / p.budget * 100), p.progress]) },
};
V.reports = () => head("Report Center", "Generate reports for management review.") + `<div class="grid gap-4 md:grid-cols-2">${Object.entries(REPORTS).map(([k, r]) => `<div class="card p-5"><h2 class="font-semibold">${r.t} Report</h2><p class="muted mt-1 text-sm">${r.d}</p><a href="#/reports/${k}" class="btn btn-primary mt-4">Generate report</a></div>`).join("")}</div>`;
V.report = k => { const r = REPORTS[k]; if (!r) return "<p>Report not found.</p>";
  return `<a href="#/reports" class="link text-sm">Back to reports</a><div class="mt-2">${head(r.t + " Report", "Generated " + now().replace("T", " "), btn("Export CSV", "export", `data-kind="${k}"`) + btn("Export Excel", "xls", `data-kind="${k}"`) + btn("Print", "print"))}</div>${tbl(r.cols, r.rows().map(row => row.map(esc)))}`; };

V.budget = () => { const tb = sum(S.projects, p => p.budget), ta = sum(S.projects, p => p.spent);
  return head("Budget", "Each project with its cost categories.") + stats([["Total budget", money(tb)], ["Total spent", money(ta)], ["Remaining", money(tb - ta)], ["Over budget", S.projects.filter(p => p.spent > p.budget).length]]) +
  create("New budget line", form("line", [["project_id", "Project", "select", () => S.projects.map(p => [p.id, p.name])], ["category", "Category", "select", ["labor", "materials", "equipment", "subs", "permits", "other"]], ["phase", "Phase", "text", null, 1], ["budget", "Planned to date (CAD)", "number"], ["committed", "Committed (CAD)", "number", null, 1], ["actual", "Actual to date (CAD)", "number"]])).replace('class="card mb-6 p-5"', 'class="card mt-6 p-5"') +
  S.projects.map(p => { const lines = E.variance(S.budget_lines.filter(l => l.project_id == p.id)), used = Math.round(p.spent / p.budget * 100), cat = grp(lines, "category"), eac = E.eac(p.spent, p.progress);
    return `<div class="card mt-6 overflow-hidden"><div class="flex flex-wrap items-start justify-between gap-4 p-5"><div><a class="link font-semibold" href="#/projects/${p.id}/schedule">${esc(p.name)}</a><div class="muted text-sm">${esc(cl(p.client_id).name)}</div></div>
      <div class="grid grid-cols-4 gap-6 text-sm"><div><div class="muted text-xs">Budget</div>${money(p.budget)}</div><div><div class="muted text-xs">Spent</div>${money(p.spent)}</div><div><div class="muted text-xs">Remaining</div>${money(p.budget - p.spent)}</div><div><div class="muted text-xs">Forecast at completion</div>${eac ? money(eac) : "-"}</div></div></div>
      <div class="px-5 pb-5">${bar(used, used - p.progress >= 8 ? "bg-amber-500" : "bg-emerald-500")}<div class="muted mt-1 text-xs">${used}% of budget used · ${p.progress}% complete</div></div>
      ${tbl(["Category", "Plan to date", "Committed", "Actual", "Variance"], [...cat.map(l => [esc(l.key[0].toUpperCase() + l.key.slice(1)), money(l.budget), money(l.committed), money(l.actual), `<b class="${l.var > 0 ? "text-red-600" : "text-emerald-600"}">${l.pct}%</b>`]),
        ["<b>Total</b>", `<b>${money(sum(cat, l => l.budget))}</b>`, `<b>${money(sum(cat, l => l.committed))}</b>`, `<b>${money(sum(cat, l => l.actual))}</b>`, `<b>${sum(cat, l => l.budget) ? Math.round((sum(cat, l => l.actual) - sum(cat, l => l.budget)) / sum(cat, l => l.budget) * 100) : 0}%</b>`]], true)}</div>`; }).join(""); };

V.approvals = () => { const a = [...S.actions].reverse(), rec = a.filter(x => x.status === "recorded").slice(0, 100);
  return head("Approvals", `Invoices, payouts and holdback releases need approval: staff can approve up to ${money(CFG.staffLimit)}, admins any amount.`, ME.role === "admin" ? btn("Export audit log", "csv") : "") +
  sec("Waiting", `<div class="space-y-3">${a.filter(x => x.status === "pending").map(actCard).join("") || '<p class="muted text-sm">Nothing waiting.</p>'}</div>`) +
  sec("History", `<div class="space-y-3">${a.filter(x => !["pending", "recorded"].includes(x.status)).map(actCard).join("") || '<p class="muted text-sm">No decisions yet.</p>'}</div>`) +
  sec("Activity log", tbl(["When", "Who", "What"], rec.map(x => [x.created.replace("T", " "), esc(x.rationale), esc(x.title)]))); };

V.admin = () => { const all = [...S.invoices.filter(i => i.status !== "draft"), ...S.payouts.map(p => ({ ...p, number: "Payout #" + p.id, paypal_id: p.batch_id, due_date: "-", pay: 1 }))], refs = {}; all.forEach(i => { if (i.paypal_id) refs[i.paypal_id] = (refs[i.paypal_id] || 0) + 1; });
  const check = i => i.pay ? (i.status === "processing" ? "Waiting for PayPal" : !i.paypal_id ? "No PayPal reference" : "OK") : i.status === "paid" && !i.paypal_id ? "Marked paid by hand" : !i.paypal_id ? "No PayPal reference" : refs[i.paypal_id] > 1 ? "Duplicate reference" : String(i.paypal_id).startsWith("MOCK-") ? "Test reference" : "OK";
  return head("Admin", "People, approval rules, integrations and data.") +
  sec("Users", create("New user", form("user", [["name", "Full name"], ["email", "Email", "email"], ["role", "Role", "select", ["staff", "admin", "client", "subcontractor"]], ["client_id", "Client (for client users)", "select", () => S.clients.map(c => [c.id, c.name]), 1], ["project_id", "Project (for subcontractors)", "select", () => S.projects.map(p => [p.id, p.name]), 1]], "Create user")) + tbl(["Name", "Email", "Role"], S.users.map(u => [esc(u.name), esc(u.email), st(u.role)])) + '<p class="muted mt-2 text-xs">New users sign in with the demo password.</p>') +
  sec("Approval rules", `<div class="card p-5">${form("settings", [["staffLimit", "Staff approval limit (CAD)", "number"], ["autoRemind", "Automatic reminders for invoices 7+ days overdue", "select", CFG.autoRemind ? ["On", "Off"] : ["Off", "On"]], ["access", "Access code (only if the server sets ACCESS_CODE)", "text", null, 1]], "Save").replace('name="staffLimit"', `name="staffLimit" value="${CFG.staffLimit}"`).replace('name="access"', `name="access" value="${esc(CFG.access)}"`)}</div><p class="muted mt-2 text-xs">Low stakes (reminders) can run on their own. Invoices, payouts and holdback releases always wait for a person.</p>`) +
  sec("Integrations", tbl(["Service", "Status"], [["PayPal", ST.paypal ? bdg("Sandbox connected", "ok") : bdg("Test mode: no PayPal keys on the server", "warn")], ["Gemini", ST.gemini ? bdg("Connected", "ok") : bdg("Not configured: built-in rules are used", "warn")]])) +
  sec("Reconciliation", tbl(["Item", "Amount", "App status", "PayPal reference", "Check"], all.map(i => [esc(i.number), money(i.amount), st(i.status), esc(i.paypal_id || "-"), (c => bdg(c, c === "OK" ? "ok" : "warn"))(check(i))]), false) + '<p class="muted mt-2 text-xs">Compares what this app recorded with the PayPal reference saved for each invoice and payout. Use Refresh payment status on Financial Intelligence to update statuses from PayPal.</p>') +
  sec("Data", `<div class="card flex flex-wrap items-center justify-between gap-3 p-5"><p class="text-sm">All data is stored in this browser. Resetting restores the sample data.</p>${btn("Reset local data", "reset")}</div>`); };

V.analytics = () => { const ps = S.projects, mx = Math.max(...ps.map(p => p.budget)), all = invs(), bucket = (a, b) => sum(all.filter(i => i.days_over >= a && i.days_over <= b), i => i.amount), ag = [["Current", bucket(0, 0)], ["1 to 14 days", bucket(1, 14)], ["15 to 30 days", bucket(15, 30)], ["Over 30 days", bucket(31, 9999)]], amx = Math.max(1, ...ag.map(x => x[1]));
  return head("Analytics", "Spend, receivables and schedule at a glance.") + sec("Spend against budget", `<div class="card p-5">${ps.map(p => barRow(esc(p.name), p.spent, mx, `${money(p.spent)} of ${money(p.budget)}`, p.spent / p.budget * 100 - p.progress >= 8 ? "bg-amber-500" : "bg-emerald-500")).join("")}</div>`) +
  sec("Receivables aging", `<div class="card p-5">${ag.map(([l, v], i) => barRow(l, v, amx, money(v), i > 1 ? "bg-red-500" : i ? "bg-amber-500" : "bg-emerald-500")).join("")}</div>`) +
  sec("Schedule", `<div class="card p-5">${ps.map(p => { const h = projHealth(p); return barRow(esc(p.name), Math.max(h.slip, 0), Math.max(1, ...ps.map(x => projHealth(x).slip)), h.slip > 0 ? h.slip + " days behind" : "on time", h.slip > 0 ? "bg-amber-500" : "bg-emerald-500"); }).join("")}</div>`) + sec("30-day cash view", cashHtml()); };

async function answer(q) {
  const kw = [["overdue", "overdue"], ["owe", "overdue"], ["invoice", "overdue"], ["risk", "at_risk"], ["budget", "at_risk"], ["approv", "approvals"], ["waiting", "approvals"], ["payout", "payouts"], ["schedule", "schedule"], ["delay", "schedule"], ["cash", "cash"], ["holdback", "holdback"], ["change order", "changes"], ["reorder", "stock"], ["stock", "stock"]];
  let tool = (kw.find(([k]) => q.toLowerCase().includes(k)) || [])[1]; if (!tool && ST.gemini && q.includes(" ")) { const r = await gem(`Pick one tool for this construction question or "none". Tools: overdue, at_risk, approvals, payouts, schedule, cash, holdback, changes, stock. Return JSON {"tool": string}. Question: ${q}`); if (r && ["overdue", "at_risk", "approvals", "payouts", "schedule", "cash", "holdback", "changes", "stock"].includes(r.tool)) tool = r.tool; }
  const ids = myProjects().map(p => p.id); let title = "", lines = [];
  if (tool === "overdue" && ME.role !== "subcontractor") { title = "Overdue invoices"; lines = invs().filter(i => i.days_over > 0 && ids.includes(i.project_id)).map(i => [`${i.number}: ${money(i.amount)}, ${i.days_over} days overdue (${i.client})`, staff() ? "#/finance" : "#/"]); }
  else if (tool === "at_risk" && staff()) { title = "Projects where spend is ahead of progress"; lines = S.projects.filter(p => Math.round(p.spent / p.budget * 100) - p.progress >= 8).map(p => [`${p.name}: ${Math.round(p.spent / p.budget * 100)}% of budget used, ${p.progress}% complete`, "#/projects/" + p.id + "/schedule"]); }
  else if (tool === "approvals" && staff()) { title = "Waiting for approval"; lines = S.actions.filter(a => a.status === "pending").map(a => [a.title, "#/approvals"]); }
  else if (tool === "payouts" && ME.role !== "client") { title = "Payouts"; lines = S.payouts.filter(p => staff() || p.user_id == ME.id).map(p => [`${money(p.amount)} (${p.status}), holdback ${money(p.holdback)}`, staff() ? "#/approvals" : "#/"]); }
  else if (tool === "schedule" && staff()) { title = "Schedule forecast"; lines = ids.map(id => { const pl = E.plan(S.tasks.filter(t => t.project_id == id)); return [`${proj(id).name}: forecast finish ${pl.finish}, ${pl.slip} days behind baseline`, "#/projects/" + id + "/schedule"]; }); }
  else if (tool === "cash" && staff()) { title = "30-day cash view"; lines = cash().map(r => [`${r.label}: in ${money(r.inflow)}, out ${money(r.outflow)}, net ${money(r.net)}`, "#/finance"]); }
  else if (tool === "holdback" && staff()) { title = "Holdback"; lines = S.holdbacks.filter(h => h.status === "held").map(h => [`${proj(h.project_id).name}: ${money(h.amount)} held, release due ${h.due}`, "#/finance"]); }
  else if (tool === "changes") { title = "Change orders"; lines = S.change_orders.filter(c => ids.includes(c.project_id)).map(c => [`${c.number} ${c.title}: ${money(c.amount)} (${c.status})`, staff() ? `#/projects/${c.project_id}/changes` : "#/"]); }
  else if (tool === "stock" && staff()) { title = "Materials to reorder"; lines = S.materials.filter(m => stockDays(m) != null && stockDays(m) <= 14).map(m => [`${m.name}: ${stockDays(m)} days of stock left`, "#/materials"]); }
  return { title, lines };
}
V.search = async q => { q = q.trim(); if (!q) return head("Search", "Type a project, client, invoice, material or a question such as \"overdue invoices\".");
  const t = q.toLowerCase(), has = o => Object.values(o).some(v => typeof v === "string" && v.toLowerCase().includes(t)), ids = myProjects().map(p => p.id), groups = [], G = (title, items) => { if (items.length) groups.push([title, items]); };
  G("Projects", myProjects().filter(has).map(p => [p.name, `${cl(p.client_id).name} · ${p.progress}% complete`, "#/projects/" + p.id]));
  G("Invoices", S.invoices.filter(i => ids.includes(i.project_id) && (has(i) || cl(i.client_id).name.toLowerCase().includes(t))).map(i => [i.number, `${cl(i.client_id).name} · ${money(i.amount)} · ${i.status}`, staff() ? "#/invoices" : "#/"]));
  G("Change orders", S.change_orders.filter(c => ids.includes(c.project_id) && has(c)).map(c => [`${c.number} ${c.title}`, `${money(c.amount)} · ${c.status}`, staff() ? `#/projects/${c.project_id}/changes` : "#/"]));
  if (staff()) { G("Clients", S.clients.filter(has).map(c => [c.name, c.email, "#/clients"])); G("Proposals", S.proposals.filter(has).map(p => [p.title, `${cl(p.client_id).name} · ${money(p.amount)} · ${p.status}`, "#/proposals"]));
    G("Materials", S.materials.filter(has).map(m => [m.name, `${m.qty} ${m.unit} in stock`, "#/materials"])); G("Equipment", S.equipment.filter(has).map(e => [e.name, `${e.type} · ${e.status}`, "#/equipment"]));
    G("Safety", S.incidents.filter(has).map(i => [i.type, `${proj(i.project_id).name} · ${i.severity} · ${i.status}`, "#/safety"])); G("Notes", S.notes.filter(n => n.text.toLowerCase().includes(t)).map(n => [n.text.slice(0, 80), proj(n.project_id).name, "#/projects/" + n.project_id + "/notes"]));
    G("Files", S.files.filter(has).map(f => [f.name, proj(f.project_id).name, "#/projects/" + f.project_id + "/files"])); G("People", S.users.filter(has).map(u => [u.name, `${u.email} · ${u.role}`, ME.role === "admin" ? "#/admin" : "#/"])); }
  const a = await answer(q), list = rows => `<div class="space-y-2">${rows.map(([ti, su, l]) => `<a href="${l}" class="card block p-3 text-sm hover:border-blue-400"><div class="font-medium">${esc(ti)}</div>${su ? `<div class="muted text-xs">${esc(su)}</div>` : ""}</a>`).join("")}</div>`;
  return head("Search results", `For "${esc(q)}"`) + (a.title ? sec(a.title, a.lines.length ? list(a.lines.map(([x, l]) => [x, "", l])) : '<p class="muted text-sm">Nothing to show.</p>') : "") + groups.map(([ti, items]) => sec(ti, list(items))).join("") + (!a.title && !groups.length ? '<p class="muted text-sm">No matches. Try a project, client, invoice number or material name.</p>' : ""); };

let RT = 0, POST = null;
async function render() {
  const my = ++RT; POST = null; const app = document.getElementById("app");
  if (!ME) { app.innerHTML = location.hash === "#/login" ? V.login() : V.landing(); return; }
  const [path, qs] = (location.hash.slice(1) || "/").split("?"), s = path.split("/").filter(Boolean), r = s[0] || "", q = decodeURIComponent(new URLSearchParams(qs).get("q") || ""); let body;
  const R = { "": V.command, finance: V.finance, field: V.field, projects: () => (s[1] ? V.project(+s[1], s[2] || "overview") : V.projects()), clients: () => V.entity("clients"), proposals: () => V.entity("proposals"), invoices: V.invoices, remind: () => V.remind(+s[1]),
    reports: () => (s[1] ? V.report(s[1]) : V.reports()), materials: () => V.entity("materials"), equipment: () => V.entity("equipment"), safety: () => V.entity("incidents"), budget: V.budget, approvals: V.approvals, admin: () => (ME.role === "admin" ? V.admin() : "<p>Not allowed for your role.</p>"), search: () => V.search(q), ask: () => V.search(q), analytics: V.analytics };
  try { body = !staff() ? (r === "" ? V.portal() : r === "search" || r === "ask" ? await V.search(q) : "<p>Not allowed for your role.</p>") : R[r] ? await R[r]() : "<p>Page not found.</p>"; }
  catch (e) { body = `<p class="text-sm text-red-600">Something went wrong: ${esc(e.message)}</p>`; }
  if (my !== RT) return; app.innerHTML = layout(body); if (POST) { const f = POST; POST = null; f().catch(() => {}); }
}

const pref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const csvText = rows => rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
const download = (name, text, type = "text/csv") => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
const hist = e => ({ at: now().replace("T", " "), by: ME ? ME.name : "System", event: e });
const coNum = () => "CO-" + String(Math.max(0, ...S.change_orders.map(c => c.id)) + 1).padStart(3, "0");
const readFile = fl => new Promise((res, rej) => { if (fl.size > 1.5 * 1024 * 1024) return rej(new Error(`${fl.name} is larger than 1.5 MB`)); const r = new FileReader(); r.onload = () => res({ name: fl.name, type: fl.type, size: fl.size, url: r.result }); r.onerror = () => rej(new Error("Could not read the file")); r.readAsDataURL(fl); });
const ACT = {
  async approve(d) { const a = S.actions.find(x => x.id == d.id); if (a.status !== "pending") return;
    if (ME.role === "staff" && (a.payload.amount || 0) > CFG.staffLimit) throw new Error(`Over the ${money(CFG.staffLimit)} staff limit: an admin must approve`); await run(a, ME.email); },
  reject(d) { const a = S.actions.find(x => x.id == d.id); if (a.kind === "payout") release(a.payload.payout_id, "rejected"); if (a.kind === "release_holdback") upd("holdbacks", a.payload.holdback_id, { status: "held" }); upd("actions", a.id, { status: "rejected", result: { by: ME.email }, decided: now() }); },
  simpaid(d) { const inv = S.invoices.find(x => x.id == +d.id); upd("invoices", inv.id, { status: "paid", paid_date: today() }); onPaid(inv.id); audit("Marked invoice " + inv.number + " as paid", inv.project_id); location.hash = "#/approvals"; },
  tsapprove(d) { const t = upd("timesheets", +d.id, { status: "approved" }); audit("Approved timesheet", t.project_id); },
  sync,
  csend(d) { const co = S.change_orders.find(x => x.id == d.id); upd("change_orders", co.id, { status: "Pending client", history: [...co.history, hist("Sent to client for approval")] }); audit(`Sent ${co.number} to the client`, co.project_id); },
  cdecide(d) { const co = S.change_orders.find(x => x.id == d.id); if (co.status !== "Pending client") return; if (!(staff() || myProjects().some(p => p.id == co.project_id))) throw new Error("Not allowed");
    const ap = d.d === "approve", by = ME.name + (staff() ? " (recorded by staff)" : ""); upd("change_orders", co.id, { status: ap ? "Approved" : "Declined", history: [...co.history, hist(ap ? `Approved by ${by}` : `Declined by ${by}`)] });
    if (ap) { upd("projects", co.project_id, { budget: proj(co.project_id).budget + co.amount }); const { hold, net } = E.holdbackSplit(co.amount, CFG.holdback);
      logAction("Billing", "create_invoice", co.project_id, `Invoice ${co.number}: ${co.title}`, `${co.number} was approved. ${money(co.amount)} less ${CFG.holdback * 100}% holdback ${money(hold)} = ${money(net)}.`, { milestone: `${co.number}: ${co.title}`, amount: net, holdback: hold, lines: [[`Change order ${co.number}: ${co.title} (net of holdback)`, net]], co_id: co.id });
      upd("change_orders", co.id, { invoiced: true, history: [...S.change_orders.find(x => x.id == co.id).history, hist("Invoice proposed for approval")] }); }
    audit(`${ap ? "Approved" : "Declined"} ${co.number}`, co.project_id); },
  paccept(d) { const p = S.proposals.find(x => x.id == d.id); upd("proposals", p.id, { status: "Accepted" }); audit(`Accepted proposal ${p.title}`, p.project_id);
    if (p.project_id) { const dep = Math.round(p.amount * CFG.depositPct); logAction("Billing", "create_invoice", p.project_id, `Deposit invoice for ${p.title}`, `Proposal '${p.title}' was accepted. Deposit ${CFG.depositPct * 100}% of ${money(p.amount)} = ${money(dep)}.`, { milestone: `Deposit: ${p.title}`, amount: dep, holdback: 0, lines: [[`Deposit for ${p.title}`, dep]] }); }
    else toast("Accepted. Link a project to this proposal to invoice the deposit."); },
  pdecline(d) { const p = S.proposals.find(x => x.id == d.id); upd("proposals", p.id, { status: "Declined" }); audit(`Declined proposal ${p.title}`, p.project_id); },
  release(d) { const h = S.holdbacks.find(x => x.id == d.id); if (h.status !== "held") return; upd("holdbacks", h.id, { status: "release proposed" });
    logAction("Billing", "release_holdback", h.id, `Release holdback: ${money(h.amount)}`, `${money(h.amount)} held on ${proj(h.project_id).name} for ${h.kind === "payable" ? S.users.find(u => u.id == h.party).name : cl(h.party).name}. Release was due ${h.due}.`, { holdback_id: h.id, amount: h.amount }); },
  xls(d) { const r = REPORTS[d.kind]; download(d.kind + "-report.xls", `<table><tr>${r.cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${r.rows().map(x => `<tr>${x.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table>`, "application/vnd.ms-excel"); },
  logout() { ME = null; put("meta", { id: 3, uid: null }); location.hash = "#/"; },
  theme() { const on = document.documentElement.classList.toggle("dark"); pref("mp-theme", on ? "dark" : "light"); },
  font(d) { const c = document.documentElement.classList; c.remove("sm", "lg"); if (d.size !== "md") c.add(d.size); pref("mp-font", d.size); },
  print() { window.print(); },
  export(d) { const r = REPORTS[d.kind]; download(d.kind + "-report.csv", csvText([r.cols, ...r.rows()])); },
  csv() { download("audit.csv", csvText([["id", "created", "agent", "kind", "title", "rationale", "status", "result", "decided"], ...S.actions.map(a => [a.id, a.created, a.agent, a.kind, a.title, a.rationale, a.status, JSON.stringify(a.result), a.decided])])); },
  reset() { if (!confirm("Delete all local MaplePro data and restore the sample data?")) return; idb.close(); indexedDB.deleteDatabase("maplepro").onsuccess = () => { location.hash = "#/"; location.reload(); }; },
};
const KEEP = new Set(["print", "export", "xls", "csv"]);
const FORM = {
  login(f) { const u = S.users.find(x => x.email === f.email.trim().toLowerCase());
    if (!u || f.password !== "maple123") throw new Error("Email or password is incorrect."); ME = u; put("meta", { id: 3, uid: u.id }); location.hash = "#/"; },
  ask(f) { location.hash = "#/search?q=" + encodeURIComponent(f.q); },
  async sendremind(f, ds) { const inv = invs().find(i => i.id == ds.id), a = logAction("Billing", "remind", inv.id, `Reminder to ${inv.client} for ${inv.number}`, `${ME.name} sent a reminder to ${inv.client} (${inv.email}); invoice is ${inv.days_over} days overdue.`, { subject: f.subject, note: f.note });
    await run(a, ME.email); const ok = a.status === "executed"; toast(ok ? `Reminder sent to ${inv.client}` : "Could not send: " + (a.result.error || "unknown error")); location.hash = ok ? "#/finance" : "#/remind/" + inv.id; },
  create(f, ds) { const e = ENT[ds.ent], row = {}; for (const [k, , type] of e.f) { const v = f[k]; row[k] = v === undefined || v === "" ? null : type === "number" || k.endsWith("_id") ? +v : v; } add(ds.ent, { ...row, ...(e.def ? e.def() : {}) }); },
  project(f) { const p = add("projects", { name: f.name, client_id: +f.client_id, budget: +f.budget, spent: 0, progress: 0, due: f.due, description: f.description || "", created: today() });
    ["labor", "materials", "equipment", "subs"].forEach(category => add("budget_lines", { project_id: p.id, category, phase: null, budget: 0, actual: 0, committed: 0 })); location.hash = "#/projects/" + p.id; },
  invoice(f) { const p = proj(+f.project_id), n = Math.max(0, ...S.invoices.map(i => i.id)) + 100, number = `INV-${new Date().getFullYear()}-${String(n).padStart(3, "0")}`;
    const inv = add("invoices", { number, project_id: p.id, client_id: p.client_id, amount: +f.amount, due_date: f.due_date, status: "draft", paypal_id: null });
    logAction("Billing", "send_invoice", inv.id, `Send invoice ${number} via PayPal`, `${ME.name} created ${number} for ${money(inv.amount)} on ${p.name}.`, { amount: inv.amount, desc: f.description || "" }); },
  task(f, ds) { const pred = f.pred ? +f.pred : null; add("tasks", { project_id: +ds.pid, name: f.name, phase: f.phase || null, days: Math.max(1, +f.days), pred, progress: 0, slip: 0, wx: f.wx === "Yes" ? 1 : 0, start: f.start || today() }); },
  progress(f) { const t = upd("tasks", +f.task_id, { progress: Math.min(100, Math.max(0, +f.progress)) }), all = S.tasks.filter(x => x.project_id == t.project_id), tot = all.reduce((s, x) => s + x.days, 0);
    upd("projects", t.project_id, { progress: Math.round(all.reduce((s, x) => s + x.days * x.progress, 0) / tot) }); },
  hours(f, ds) { add("timesheets", { project_id: +ds.pid, user_id: +f.user_id, work_date: f.work_date, hours: +f.hours, rate: CFG.rate, status: "submitted", payout_id: null }); },
  note(f, ds) { add("notes", { project_id: +ds.pid, text: f.text, author: ME.name, created: now().replace("T", " ") }); },
  line(f) { add("budget_lines", { project_id: +f.project_id, category: f.category, phase: f.phase || null, budget: +f.budget, committed: +f.committed || 0, actual: +f.actual }); },
  user(f) { if (S.users.some(u => u.email === f.email.trim().toLowerCase())) throw new Error("That email already exists");
    const u = add("users", { email: f.email.trim().toLowerCase(), name: f.name, role: f.role, client_id: f.role === "client" && f.client_id ? +f.client_id : null }); if (f.role === "subcontractor" && f.project_id) add("members", { user_id: u.id, project_id: +f.project_id }); },
  ts(f) { if (ME.role !== "subcontractor" || !myProjects().some(p => p.id == f.project_id)) throw new Error("Not assigned to this project");
    add("timesheets", { project_id: +f.project_id, user_id: ME.id, work_date: f.work_date, hours: +f.hours, rate: CFG.rate, status: "submitted", payout_id: null }); },
  co(f, ds) { add("change_orders", { project_id: +ds.pid, number: coNum(), title: f.title, description: f.description || "", amount: +f.amount, status: "Draft", created: today(), invoiced: false, history: [hist("Drafted")] }); },
  file(f, ds) { const fl = (f.__files || [])[0]; if (!fl) throw new Error("Choose a file first"); add("files", { project_id: +ds.pid, name: fl.name, type: fl.type, size: fl.size, url: fl.url, by: ME.name, created: now().replace("T", " ") }); },
  async report(f, ds) { const p = proj(+ds.pid), s = await siteAgent(f.raw.slice(0, 4000), p); s.impacts = [];
    if (s.delay_days && s.delays.length) { const open = S.tasks.filter(t => t.project_id == p.id && t.progress < 100), names = s.delays.flatMap(d => d.tasks_affected.map(x => x.toLowerCase()));
      const hit = open.find(t => names.some(n => t.name.toLowerCase().includes(n) || n.includes(t.name.toLowerCase()))) || open[0];
      if (hit) { upd("tasks", hit.id, { slip: hit.slip + s.delay_days }); s.impacts.push(`Schedule: ${hit.name} slips ${s.delay_days} days; finish date recalculated.`); } }
    if (s.extra_hours) { const cost = s.extra_hours * CFG.rate, l = S.budget_lines.find(x => x.project_id == p.id && x.category === "labor"); if (l) upd("budget_lines", l.id, { actual: l.actual + cost }); upd("projects", p.id, { spent: p.spent + cost });
      s.impacts.push(`Budget: ${s.extra_hours} extra labor hours add ${money(cost)}.`); }
    if (s.scope_change) { if (s.scope_cost) { const co = add("change_orders", { project_id: p.id, number: coNum(), title: s.scope_change.slice(0, 60), description: s.scope_change, amount: s.scope_cost, status: "Draft", created: today(), invoiced: false, history: [{ at: now().replace("T", " "), by: "Budget Agent", event: "Drafted from a daily report for your review" }] });
        s.impacts.push(`Change order ${co.number} drafted for ${money(s.scope_cost)}. Review it under Change orders.`); } else s.impacts.push("A scope change was mentioned. Add its cost under Change orders."); }
    add("reports", { project_id: p.id, raw: f.raw, s, photos: (f.__files || []).slice(0, 3), created: now() });
    if (s.milestone_complete && s.milestone_name) { const gross = Math.round(p.budget * CFG.milestonePct), { hold, net } = E.holdbackSplit(gross, CFG.holdback), tk = S.tasks.find(t => t.project_id == p.id && t.name.toLowerCase() === s.milestone_name.toLowerCase()), label = (tk && tk.phase ? tk.phase + ": " : "") + s.milestone_name;
      logAction("Billing", "create_invoice", p.id, `Invoice milestone: ${s.milestone_name}`, `Site report says '${s.milestone_name}' is complete. Milestone billing ${money(gross)} less ${CFG.holdback * 100}% holdback ${money(hold)} = ${money(net)}.`, { milestone: s.milestone_name, amount: net, holdback: hold, lines: [[`${label} (net of ${CFG.holdback * 100}% holdback)`, net]] }); } },
  settings(f) { CFG.staffLimit = +f.staffLimit || 0; CFG.access = (f.access || "").trim(); CFG.autoRemind = f.autoRemind === "On"; saveCfg(); alert("Saved"); },
};
document.addEventListener("click", async e => { const b = e.target.closest("[data-act]"); if (!b) return; e.preventDefault(); b.disabled = true;
  try { await ACT[b.dataset.act](b.dataset); } catch (err) { alert(err.message); } b.disabled = false; if (!KEEP.has(b.dataset.act)) render(); });
const AUD = { create: (f, d) => `Created ${ENT[d.ent].one}`, project: () => "Created project", invoice: () => "Created invoice", task: () => "Added task", progress: () => "Updated task progress", hours: () => "Logged hours", note: () => "Added note", line: () => "Added budget line",
  user: () => "Created user", settings: () => "Changed approval rules", report: () => "Submitted daily report", ts: () => "Submitted timesheet", sendremind: () => "Sent reminder", co: () => "Drafted change order", file: () => "Uploaded file" };
document.addEventListener("submit", async e => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault();
  try { const data = Object.fromEntries(new FormData(f)), fi = [...f.querySelectorAll("input[type=file]")]; fi.forEach(i => delete data[i.name]);
    const files = fi.flatMap(i => [...i.files]); if (files.length) data.__files = await Promise.all(files.slice(0, 3).map(readFile));
    await FORM[f.dataset.form](data, f.dataset); const a = AUD[f.dataset.form]; if (a && ME) audit(a(data, f.dataset), f.dataset.pid || data.project_id); } catch (err) { alert(err.message); } render(); });
document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); const q = document.getElementById("q"); if (q) q.focus(); } });
window.addEventListener("hashchange", render);

(async () => {
  idb = await openDb(); await loadAll();
  const ver = S.meta.find(m => m.id == 4); if (!ver || ver.v !== 3) { await clearAll(); await loadAll(); seed(); put("meta", { id: 4, v: 3 }); S.meta.push({ id: 4, v: 3 }); }  // sample data is rebuilt once when the data layout changes
  const cfg = S.meta.find(m => m.id == 2); if (cfg) Object.assign(CFG, cfg.v);
  const ses = S.meta.find(m => m.id == 3); if (ses && ses.uid) ME = S.users.find(u => u.id == ses.uid) || null;
  try { ST = await (await fetch("/api/status")).json(); } catch (e) {}
  render(); autoRemind().catch(() => {});
})();

window.MaplePro = { autoRemind };  // handle used by the browser tests
