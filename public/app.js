"use strict";
// MaplePro browser app. Data lives in IndexedDB; the server is only used for Gemini and PayPal calls.
const E = window.Engine, { add: addD, today, money, diff } = E;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const T = ["proposals", "materials", "equipment", "incidents", "notes", "clients", "projects", "invoices", "reports", "actions", "users", "members", "tasks", "timesheets", "payouts", "budget_lines", "meta"];
let S = {}, idb, ME = null, ST = { paypal: false, gemini: false };
const CFG = { staffLimit: 50000, holdback: 0.1, rate: 65, milestonePct: 0.08, access: "", lat: 43.77, lon: -79.41, autoKinds: ["remind"] };
const now = () => new Date().toISOString().slice(0, 19);

// ---- IndexedDB: everything is loaded into memory at start, writes go through to the database ------------
const openDb = () => new Promise((res, rej) => { const r = indexedDB.open("maplepro", 2);
  r.onupgradeneeded = () => T.forEach(t => { if (!r.result.objectStoreNames.contains(t)) r.result.createObjectStore(t, { keyPath: "id" }); }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const loadAll = () => Promise.all(T.map(t => new Promise(res => { const q = idb.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res((S[t] = q.result)); })));
const put = (t, row) => { idb.transaction(t, "readwrite").objectStore(t).put(row); return row; };
const add = (t, row) => { row = { ...row, id: Math.max(0, ...S[t].map(r => r.id)) + 1 }; S[t].push(row); return put(t, row); };
const upd = (t, id, patch) => { const r = S[t].find(x => x.id == id); Object.assign(r, patch); put(t, r); return r; };
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
  A("invoices", [["INV-2026-008", 1, 1, 250500, d(27), "sent"], ["INV-2026-009", 2, 2, 215000, d(15), "sent"], ["INV-2026-004", 2, 2, 328000, d(12), "sent"],
    ["INV-2026-011", 1, 1, 180000, d(-12), "sent"], ["INV-2026-012", 3, 3, 95000, d(-20), "sent"], ["INV-2026-002", 1, 1, 400000, d(60), "paid"]]
    .map(([number, project_id, client_id, amount, due_date, status]) => ({ number, project_id, client_id, amount, due_date, status, paypal_id: null })));
  A("users", [["admin@maplepro.test", "Admin User", "admin"], ["pm@maplepro.test", "Pat Manager", "staff"], ["client@example.com", "Acme Client", "client", 1], ["sub@maplepro.test", "Sam Subcontractor", "subcontractor"]]
    .map(([email, name, role, client_id]) => ({ email, name, role, client_id: client_id || null })));
  A("members", [{ user_id: 4, project_id: 1 }, { user_id: 4, project_id: 2 }]);
  const chains = { 1: [["Excavation", 10, 100, 0], ["Foundation", 14, 100, 1], ["Framing", 20, 40, 0], ["Roofing", 10, 0, 1], ["Drywall", 12, 0, 0]],
    2: [["Demolition", 12, 100, 0], ["Facade work", 25, 30, 1], ["Interior fit-out", 30, 0, 0]], 3: [["Site prep", 8, 100, 0], ["Concrete slab", 10, 50, 1], ["Steel frame", 20, 0, 0]] };
  for (const [pid, ts] of Object.entries(chains)) { let prev = null;
    ts.forEach(([name, days, progress, wx], i) => { const pred = name === "Drywall" ? prev - 1 : i ? prev : null;
      prev = add("tasks", { project_id: +pid, name, days, pred, progress, slip: 0, wx, start: d(45) }).id; }); }
  A("timesheets", [[9, 40, "approved"], [2, 36, "approved"], [0, 8, "submitted"]].map(([n, hours, status]) => ({ project_id: 1, user_id: 4, work_date: d(n), hours, rate: 65, status, payout_id: null })));
  A("proposals", [["Phase 2 fit-out", 1, 420000, "Sent"], ["Lobby renovation", 2, 185000, "Accepted"], ["Parking structure repair", 3, 96000, "Draft"]].map(([title, client_id, amount, status]) => ({ title, client_id, amount, status, created: t })));
  A("materials", [["Cement bags", "bag", 320, 100, 12.5], ["Concrete mix", "m3", 85, 30, 165], ["Drywall sheets", "sheet", 600, 200, 14], ["Electrical wire (500 ft)", "roll", 48, 20, 185], ["Lumber 2x4", "pc", 1500, 500, 6.5],
    ["Plywood 3/4 in", "sheet", 90, 100, 48], ["PVC pipe 4 in", "pc", 220, 80, 18], ["Interior paint", "pail", 140, 40, 62], ["Roofing shingles", "bundle", 410, 150, 38], ["Insulation rolls", "roll", 260, 100, 54],
    ["Rebar #5", "ton", 22, 8, 1250], ["Nails 3 in", "box", 300, 100, 22], ["Floor tile 12x12", "box", 380, 120, 32], ["Interior doors", "ea", 60, 20, 210], ["Window units", "ea", 14, 6, 420]].map(([name, unit, qty, min_qty, unit_cost]) => ({ name, unit, qty, min_qty, unit_cost })));
  A("equipment", ["Excavator CAT 320", "Tower crane", "Skid steer", "Concrete mixer", "Scissor lift", "Backhoe loader", "Dump truck", "Generator 100 kW", "Compactor", "Forklift", "Boom lift", "Concrete pump"]
    .map((name, i) => ({ name, type: i < 3 ? "Heavy" : i < 8 ? "Site" : "Lifting", status: i < 8 ? "In use" : i < 11 ? "Available" : "Maintenance", rate: 45 + i * 12 })));
  A("incidents", [["Slip on wet surface", "Low", "Closed", 1], ["Minor cut", "Low", "Closed", 2], ["Near miss: falling object", "Medium", "Closed", 1], ["Missing guardrail", "High", "Investigating", 1], ["Equipment strike", "Medium", "Open", 3], ["Heat exhaustion", "Medium", "Closed", 2], ["PPE violation", "Low", "Closed", 3]]
    .map(([type, severity, status, project_id], i) => ({ type, severity, status, project_id, date: d(i * 4 + 1), description: "" })));
  S.projects.forEach(p => [["labor", .30, .38], ["materials", .35, .30], ["equipment", .10, .10], ["subs", .25, .22]]
    .forEach(([category, pl, ac]) => add("budget_lines", { project_id: p.id, category, budget: Math.round(p.budget * p.progress / 100 * pl), actual: Math.round(p.spent * ac) })));
}

// ---- scoping and data helpers ------------------------------------------------------------------------------
const staff = () => ME && ["admin", "staff"].includes(ME.role);
const cl = id => S.clients.find(c => c.id == id), proj = id => S.projects.find(p => p.id == id);
const myProjects = () => staff() ? S.projects : ME.role === "client" ? S.projects.filter(p => p.client_id == ME.client_id) : S.projects.filter(p => S.members.some(m => m.user_id == ME.id && m.project_id == p.id));
const invs = () => S.invoices.filter(i => i.status === "sent").map(i => { const dd = Math.max(diff(today(), i.due_date), 0), c = cl(i.client_id);
  return { ...i, client: c.name, email: c.email, project: proj(i.project_id).name, days_over: dd, prob: E.payProb(dd, i.amount), risk: dd > 10 ? "high" : "healthy" }; })
  .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
const logAction = (agent, kind, ref, title, rationale, payload) => add("actions", { agent, kind, ref_id: ref, title, rationale, payload, status: "pending", result: null, created: now(), decided: null });
const release = (pid, status) => { upd("payouts", pid, { status }); S.timesheets.filter(t => t.payout_id == pid).forEach(t => upd("timesheets", t.id, { payout_id: null, status: "approved" })); };

// ---- agents ----------------------------------------------------------------------------------------------------
async function siteAgent(raw, p) {
  const o = await gem("You are a construction site clerk. Convert the field note into JSON with keys: work_completed (string[]), crew_count (int|null), delays ([{cause:string,tasks_affected:string[]}]), risks (string[]), materials (string[]), milestone_complete (bool), milestone_name (string|null), follow_up_question (string|null: ask if key info is missing, never guess), delay_days (int|null, only if the note states a number of days), extra_hours (int|null, only if stated). Project: " + p.name + ". Note: " + raw);
  return o && typeof o === "object" ? E.normalize(o, "gemini") : E.siteFallback(raw);
}
const tplReminder = inv => ({ subject: `Reminder: invoice ${inv.number}`, note: `Hi ${inv.client}, invoice ${inv.number} for ${money(inv.amount)} on ${inv.project} ${inv.days_over > 0 ? `is ${inv.days_over} days past due` : `is due on ${inv.due_date}`}. Please let us know if anything is holding up payment.`, source: "template" });
async function draftReminder(inv) {
  const facts = [inv.number, money(inv.amount), inv.days_over, inv.project, inv.client], tone = inv.days_over >= 14 ? "firm but friendly" : "warm and friendly";
  const o = await gem(`Write a payment reminder to the client ${inv.client}, tone ${tone}, 2 sentences. Use ONLY these facts and no other numbers: ${JSON.stringify(facts)}. Return JSON {subject, note}.`);
  if (o && o.note && o.subject && E.grounded(o.subject + " " + o.note, facts)) return { subject: o.subject, note: o.note, source: "gemini" };
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
    const r = await api("paypal/invoice", { number, email: c.email, items: [[`${p.milestone} (net of ${CFG.holdback * 100}% holdback)`, p.amount]], note: "Progress billing: " + p.milestone, rid });
    add("invoices", { number, project_id: pr.id, client_id: pr.client_id, amount: p.amount, due_date: addD(today(), 30), status: "sent", paypal_id: r.id }); return r; }
  if (a.kind === "payout") { const po = S.payouts.find(x => x.id == p.payout_id), u = S.users.find(x => x.id == po.user_id);
    const b = (await api("paypal/balance")).balance; if (b != null && po.amount > b) throw new Error(`Insufficient PayPal balance (${b})`);
    const r = await api("paypal/payout", { batch_id: "maplepro-payout-" + po.id, items: [["payout-" + po.id, u.email, po.amount]], note: "Subcontractor payment" });
    const st = r.mock ? "paid" : "processing"; upd("payouts", po.id, { status: st, batch_id: r.batch });
    if (st === "paid") S.timesheets.filter(t => t.payout_id == po.id).forEach(t => upd("timesheets", t.id, { status: "paid" })); return r; }
  throw new Error("unknown action");
}
async function run(a, by) { let st = "executed", res;
  try { res = { by, ...(await execute(a)) }; } catch (e) { st = "failed"; res = { by, error: String(e.message || e) }; if (a.kind === "payout") release(a.payload.payout_id, "failed"); }
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
    try { const st = (await api("paypal/invoice-status", { id: i.paypal_id })).status; if (st) { upd("invoices", i.id, { status: st }); if (st === "paid") onPaid(i.id); } } catch (e) {} }
  for (const po of S.payouts.filter(p => p.status === "processing")) {
    try { const st = (await api("paypal/payout-status", { id: po.batch_id })).status;
      if (st === "paid") { upd("payouts", po.id, { status: "paid" }); S.timesheets.filter(t => t.payout_id == po.id).forEach(t => upd("timesheets", t.id, { status: "paid" })); } else if (st === "failed") release(po.id, "failed"); } catch (e) {} }
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

const NAV = [["#/", "Command Center"], ["#/finance", "Financial Intelligence"], ["#/field", "Field Operations"], ["#/projects", "Projects"], ["#/clients", "Clients"], ["#/proposals", "Proposals"], ["#/invoices", "Invoices"],
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
  <footer class="muted border-t px-6 py-6 text-center text-sm" style="border-color:var(--border)">MaplePro demo. Sample data is stored in this browser only.</footer></div>`;
V.login = () => `<div class="min-h-screen">${topbar(brand, "", "")}<div class="mx-auto max-w-md px-6 py-16"><h1 class="text-2xl font-semibold tracking-tight">Sign in</h1><p class="muted mt-1 text-sm">Use your MaplePro account.</p>
  <form data-form="login" class="card mt-6 space-y-4 p-6"><label class="block text-sm font-medium">Email<input id="email" name="email" type="email" required autocomplete="username" class="input mt-1"></label>
  <label class="block text-sm font-medium">Password<input id="password" name="password" type="password" required autocomplete="current-password" class="input mt-1"></label><button class="btn btn-primary w-full justify-center py-2.5">Sign in</button></form>
  <p class="mt-4 text-center text-sm"><a href="#/" class="link">Back to home</a></p></div></div>`;

V.command = () => { const all = invs(), od = all.filter(i => i.days_over > 0), odT = od.reduce((s, i) => s + i.amount, 0), pend = S.actions.filter(a => a.status === "pending").reverse();
  const projs = S.projects.map(p => { const burn = Math.round(p.spent / p.budget * 100); return { ...p, burn, gap: burn - p.progress, client: cl(p.client_id).name, overdue: od.filter(i => i.project_id == p.id).reduce((s, i) => s + i.amount, 0) }; });
  const ins = projs.filter(p => p.gap >= 8).map(p => ({ a: "Budget", t: `${p.name}: ${p.burn}% of budget spent against ${p.progress}% progress.`, c: Math.min(95, 55 + p.gap * 2) }));
  if (od.length) ins.unshift({ a: "Billing", t: `${od.length} invoices overdue, ${money(odT)} outstanding.`, c: 90 });
  const week = [...projs.filter(p => !S.reports.some(r => r.project_id == p.id)).map(p => `Submit a daily report for ${p.name}`), ...S.timesheets.filter(t => t.status === "submitted").map(t => `Approve ${t.hours} h timesheet for ${esc(proj(t.project_id).name)}`), ...all.filter(i => i.days_over === 0 && i.due_date > today()).map(i => `${i.number} is due in ${diff(i.due_date, today())} days`)];
  return head("Command Center", "What needs your attention across all projects.") + stats([["Active projects", S.projects.length], ["Overdue receivables", money(odT)], ["Awaiting approval", pend.length], ["Spent of contract", money(S.projects.reduce((s, p) => s + p.spent, 0)), "of " + money(S.projects.reduce((s, p) => s + p.budget, 0))]]) +
  sec("Intelligence stream", `<div class="card divide-y p-0" style="border-color:var(--border)">${ins.map(s => `<div class="flex flex-wrap items-center gap-3 p-4 text-sm">${bdg(s.a, "info")}<span>${esc(s.t)}</span><span class="muted ml-auto text-xs">heuristic confidence ${s.c}%</span></div>`).join("") || `<p class="muted p-4 text-sm">No risks detected.</p>`}</div>`) +
  sec("Priority", `<div class="grid gap-4 md:grid-cols-3"><div class="card p-4"><div class="font-medium text-red-600">Urgent</div>${od.filter(i => i.days_over >= 14).map(i => `<p class="mt-2 text-sm"><a class="link" href="#/finance">${i.number}</a> is ${i.days_over} days overdue (${money(i.amount)})</p>`).join("") || '<p class="muted mt-2 text-sm">Nothing urgent.</p>'}</div>
  <div class="card p-4"><div class="font-medium text-amber-600">Today</div><p class="mt-2 text-sm">${pend.length} proposals waiting. <a class="link" href="#/approvals">Review</a></p></div>
  <div class="card p-4"><div class="font-medium text-blue-600">This week</div>${week.map(w => `<p class="mt-2 text-sm">${w}</p>`).join("") || '<p class="muted mt-2 text-sm">All clear.</p>'}</div></div>`) +
  sec("Active projects", `<div class="grid gap-4 md:grid-cols-3">${projs.map(p => `<a href="#/projects/${p.id}" class="card block p-4 hover:border-blue-400"><div class="flex justify-between gap-2"><span class="text-sm font-medium">${esc(p.name)}</span>${p.gap >= 8 ? bdg("watch", "warn") : bdg("on track", "ok")}</div><p class="muted text-xs">${esc(p.client)}</p>
  <div class="mt-3 text-xs">Progress ${p.progress}%</div>${bar(p.progress)}<div class="mt-2 text-xs">Budget used ${p.burn}%</div>${bar(p.burn, p.gap >= 8 ? "bg-amber-500" : "bg-emerald-500")}${p.overdue ? `<p class="mt-2 text-xs text-red-600">${money(p.overdue)} overdue</p>` : ""}</a>`).join("")}</div>`) +
  (pend.length ? sec("Waiting for approval", `<div class="space-y-3">${pend.map(actCard).join("")}</div>`) : ""); };

V.portal = () => { const ps = myProjects(), mine = S.timesheets.filter(t => t.user_id == ME.id).reverse();
  return head("My work", "Your projects and activity.") + sec("Projects", `<div class="grid gap-4 md:grid-cols-3">${ps.map(p => `<div class="card p-4"><div class="text-sm font-medium">${esc(p.name)}</div><div class="mt-2 text-xs">Progress ${p.progress}%</div>${bar(p.progress)}</div>`).join("") || '<p class="muted text-sm">No projects assigned.</p>'}</div>`) +
  (ME.role === "client" ? sec("Invoices", tbl(["Invoice", "Project", "Amount", "Due", "Status"], S.invoices.filter(i => i.client_id == ME.client_id).map(i => [i.number, esc(proj(i.project_id).name), money(i.amount), i.due_date, st(i.status)]))) :
  sec("Submit timesheet", `<div class="card p-5">${form("ts", [["project_id", "Project", "select", () => ps.map(p => [p.id, p.name])], ["work_date", "Date", "date"], ["hours", "Hours", "number"]], "Submit")}</div>`) +
  sec("My timesheets", tbl(["Date", "Project", "Hours", "Status"], mine.map(t => [t.work_date, esc(proj(t.project_id).name), t.hours, st(t.status)]))) +
  sec("My payouts", tbl(["Amount", "Holdback", "Status"], S.payouts.filter(p => p.user_id == ME.id).map(p => [money(p.amount), money(p.holdback), st(p.status)])))); };

V.finance = () => { const all = invs(), od = all.filter(i => i.days_over > 0), high = all.filter(i => i.risk === "high"), ok = all.filter(i => i.days_over === 0);
  return head("Financial Intelligence", "Receivables, payment risk and who to follow up with.", ST.paypal ? btn("Refresh payment status", "sync") : "") +
  stats([["Outstanding", money(all.reduce((s, i) => s + i.amount, 0))], ["Overdue", money(od.reduce((s, i) => s + i.amount, 0))], ["High-risk invoices", high.length], ["Collected", money(S.invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0))]]) +
  sec(`High risk (${high.length})`, `<div class="space-y-3">${high.map(i => `<div class="card p-4" style="border-color:#fca5a5"><div class="flex flex-wrap items-center gap-2"><span class="font-medium">${i.number}</span>${bdg(i.days_over + " days overdue", "bad")}<span class="ml-auto font-semibold">${money(i.amount)}</span></div>
  <p class="muted text-sm">${esc(i.client)} · ${esc(i.project)}</p><p class="mt-1 text-sm">Payment probability <b>${i.prob}%</b> <span class="muted text-xs">(estimated from days overdue and amount)</span></p>
  <div class="mt-3 flex flex-wrap gap-2"><a href="#/remind/${i.id}" class="btn btn-primary">Remind ${esc(i.client)}</a>${btn("Mark as paid", "simpaid", `data-id="${i.id}"`)}</div></div>`).join("") || '<p class="muted text-sm">No high-risk invoices.</p>'}</div>`) +
  sec(`On track (${ok.length})`, tbl(["Invoice", "Client", "Amount", "Due", "Likely on time"], ok.map(i => [i.number, esc(i.client), money(i.amount), i.due_date, i.prob + "%"]))); };

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
  <div class="card p-5 text-sm"><h2 class="font-semibold">Invoice</h2><dl class="mt-3 space-y-2"><div><dt class="muted">Project</dt><dd>${esc(inv.project)}</dd></div><div><dt class="muted">Amount</dt><dd>${money(inv.amount)}</dd></div><div><dt class="muted">Due</dt><dd>${inv.due_date}</dd></div><div><dt class="muted">Chance of on-time payment</dt><dd>${inv.prob}%</dd></div></dl></div></div>`; };

V.invoices = () => head("Invoices", "Create invoices and send them through PayPal after approval.") +
  create("New invoice", form("invoice", [["project_id", "Project", "select", () => S.projects.map(p => [p.id, p.name])], ["amount", "Amount (CAD)", "number"], ["due_date", "Due date", "date"], ["description", "Description", "text", null, 1]], "Create and request approval")) +
  tbl(["Invoice", "Client", "Project", "Amount", "Due", "Status", ""], [...S.invoices].reverse().map(i => { const over = Math.max(diff(today(), i.due_date), 0) > 0;
    return [i.number, esc(cl(i.client_id).name), esc(proj(i.project_id).name), money(i.amount), i.due_date, st(i.status), i.status === "sent" ? `<div class="flex gap-2">${over ? `<a href="#/remind/${i.id}" class="btn">Remind ${esc(cl(i.client_id).name)}</a>` : ""}${btn("Mark as paid", "simpaid", `data-id="${i.id}"`)}</div>` : ""]; }));

const ENT = {
  clients: { t: "Clients", one: "client", sub: "People and companies you build for.", f: [["name", "Name"], ["email", "Email", "email"], ["phone", "Phone", "tel", null, 1]], cols: ["Name", "Email", "Phone", "Projects"], row: c => [esc(c.name), esc(c.email), esc(c.phone || "-"), S.projects.filter(p => p.client_id == c.id).length] },
  proposals: { t: "Proposals", one: "proposal", sub: "Quotes you have sent or are preparing.", f: [["title", "Title"], ["client_id", "Client", "select", () => S.clients.map(c => [c.id, c.name])], ["amount", "Amount (CAD)", "number"], ["status", "Status", "select", ["Draft", "Sent", "Accepted", "Declined"]]], def: () => ({ created: today() }),
    cols: ["Title", "Client", "Amount", "Status", "Created"], row: p => [esc(p.title), esc(cl(p.client_id).name), money(p.amount), st(p.status), p.created] },
  materials: { t: "Materials", one: "material", sub: "Inventory levels and value.", f: [["name", "Name"], ["unit", "Unit"], ["qty", "Quantity", "number"], ["min_qty", "Minimum quantity", "number"], ["unit_cost", "Unit cost (CAD)", "number"]],
    stats: () => [["Total materials", S.materials.length], ["Low stock", S.materials.filter(m => m.qty > 0 && m.qty < m.min_qty).length], ["Out of stock", S.materials.filter(m => m.qty <= 0).length], ["Total value", money(S.materials.reduce((s, m) => s + m.qty * m.unit_cost, 0))]],
    cols: ["Material", "Quantity", "Minimum", "Unit cost", "Value", "Status"], row: m => [esc(m.name), `${m.qty} ${esc(m.unit)}`, m.min_qty, money(m.unit_cost), money(m.qty * m.unit_cost), m.qty <= 0 ? bdg("Out of stock", "bad") : m.qty < m.min_qty ? bdg("Low stock", "warn") : bdg("In stock", "ok")] },
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

V.project = async (id, tab) => { const p = proj(id); if (!p) return "<p>Project not found.</p>"; const c = cl(p.client_id);
  const tabs = [["overview", "Overview"], ["schedule", "Schedule and budget"], ["time", "Time tracking"], ["notes", "Notes"], ["reports", "Daily reports"]];
  const top = `<a href="#/projects" class="link text-sm">Back to projects</a><div class="mt-2">${head(esc(p.name), `${esc(c.name)} · due ${p.due}`)}</div><div class="mb-6 flex gap-1 overflow-x-auto border-b" style="border-color:var(--border)">${tabs.map(([k, l]) => `<a href="#/projects/${id}/${k}" class="tab ${tab === k ? "on" : ""}">${l}</a>`).join("")}</div>`;
  if (tab === "overview") return top + `<div class="grid gap-4 md:grid-cols-2"><div class="card p-5"><h2 class="font-semibold">Project information</h2><dl class="mt-3 space-y-3 text-sm"><div><dt class="muted">Name</dt><dd>${esc(p.name)}</dd></div><div><dt class="muted">Description</dt><dd>${esc(p.description || "-")}</dd></div><div><dt class="muted">Status</dt><dd>Active</dd></div><div><dt class="muted">Created</dt><dd>${p.created || "-"}</dd></div></dl></div>
    <div class="card p-5"><h2 class="font-semibold">Client information</h2><dl class="mt-3 space-y-3 text-sm"><div><dt class="muted">Client</dt><dd>${esc(c.name)}</dd></div><div><dt class="muted">Email</dt><dd>${esc(c.email)}</dd></div><div><dt class="muted">Phone</dt><dd>${esc(c.phone || "-")}</dd></div></dl></div></div>
    <div class="mt-4">${stats([["Contract budget", money(p.budget)], ["Spent", money(p.spent)], ["Progress", p.progress + "%"]])}</div>`;
  if (tab === "schedule") { const tasks = S.tasks.filter(t => t.project_id == id), pl = E.plan(tasks), lines = E.variance(S.budget_lines.filter(l => l.project_id == id));
    const reps = S.reports.filter(r => r.project_id == id).reverse(), delays = reps.slice(0, 3).flatMap(r => r.s.delays.map(d => d.cause));
    POST = async () => { const days = await weather(), el = document.getElementById("wx"); if (el) { const wx = E.wxRisks(pl.tasks, days);
        el.innerHTML = wx.map(w => `<p class="text-sm text-amber-600">Weather risk: ${esc(w.task)} is scheduled on ${w.dates.join(", ")} (rain or freezing forecast).</p>`).join("") || `<p class="muted text-sm">${days.length ? "No weather risks in the next 7 days." : "Weather forecast unavailable."}</p>`; }
      if (ST.gemini) { const t = await explain(lines, delays), w = document.getElementById("why"); if (w) w.textContent = t; } };
    return top + sec("Schedule", (pl.finish ? `<p class="mb-3 text-sm">Forecast finish <b>${pl.finish}</b> · baseline ${pl.baseline} · <b class="${pl.slip ? "text-amber-600" : "text-emerald-600"}">${pl.slip} days behind</b></p>` : '<p class="muted mb-3 text-sm">No tasks yet. Add the first task below.</p>') +
      tbl(["Task", "Start", "Finish", "Progress", ""], pl.tasks.map(t => [esc(t.name), t.es, t.ef, t.progress + "%", (t.critical ? bdg("critical path", "bad") + " " : "") + (t.slip ? bdg("+" + t.slip + " days", "warn") : "")])) + `<div id="wx" class="mt-3"><p class="muted text-sm">Checking the weather forecast...</p></div>`) +
    create("Add task", form("task", [["name", "Task name"], ["days", "Duration (days)", "number"], ["pred", "Starts after", "select", () => tasks.map(t => [t.id, t.name]), 1], ["start", "Start date (if it starts after nothing)", "date", null, 1], ["wx", "Weather sensitive", "select", ["No", "Yes"]]], "Add task", `data-pid="${id}"`)) +
    (tasks.length ? create("Update task progress", form("progress", [["task_id", "Task", "select", () => tasks.map(t => [t.id, t.name])], ["progress", "Percent complete", "number"]], "Update")) : "") +
    sec("Budget against plan to date", `<p id="why" class="mb-3 text-sm">${esc(explainTpl(lines, delays))}</p>` + tbl(["Category", "Plan", "Actual", "Variance"], lines.map(l => [l.category[0].toUpperCase() + l.category.slice(1), money(l.budget), money(l.actual), `<b class="${l.var > 0 ? "text-red-600" : "text-emerald-600"}">${l.pct}%</b>`]))); }
  if (tab === "time") { const ts = S.timesheets.filter(t => t.project_id == id).reverse(), subs = S.users.filter(u => u.role === "subcontractor");
    return top + create("Log hours", form("hours", [["user_id", "Worker", "select", () => subs.map(u => [u.id, u.name])], ["work_date", "Date", "date"], ["hours", "Hours", "number"]], "Log hours", `data-pid="${id}"`)) +
      tbl(["Date", "Worker", "Hours", "Cost", "Status", ""], ts.map(t => [t.work_date, esc(S.users.find(u => u.id == t.user_id).name), t.hours, money(t.hours * t.rate), st(t.status), t.status === "submitted" ? btn("Approve", "tsapprove", `data-id="${t.id}"`, "btn-primary") : ""])); }
  if (tab === "notes") return top + create("Add note", form("note", [["text", "Note", "textarea"]], "Save note", `data-pid="${id}"`)) + `<div class="space-y-3">${S.notes.filter(n => n.project_id == id).reverse().map(n => `<div class="card p-4 text-sm"><div class="muted text-xs">${esc(n.author)} · ${n.created}</div><p class="mt-1">${esc(n.text)}</p></div>`).join("") || '<p class="muted text-sm">No notes yet.</p>'}</div>`;
  const reps = S.reports.filter(r => r.project_id == id).reverse();
  return top + create("New daily report", `<form data-form="report" data-pid="${id}"><label class="block text-sm font-medium" for="raw">Field note</label><textarea id="raw" name="raw" required maxlength="4000" rows="4" class="input mt-1" placeholder="Framing complete on levels 3 to 5. Crew of 12. One wall failed inspection and was rebuilt."></textarea><p class="muted mt-1 text-xs">Delays, extra hours and finished milestones in the note update the schedule, the budget and invoicing proposals.</p><button class="btn btn-primary mt-3">Submit report</button></form>`) +
    `<div class="space-y-3">${reps.map(r => { const s = r.s; return `<div class="card p-4 text-sm"><div class="muted flex gap-2 text-xs">${r.created} ${bdg("read by " + s.source)}</div><p class="mt-2 italic">"${esc(r.raw)}"</p>
    ${s.work_completed.length ? `<p class="mt-2"><b>Work completed:</b> ${esc(s.work_completed.join("; "))}</p>` : ""}${s.delays.map(d => `<p class="mt-1 text-amber-600"><b>Delay:</b> ${esc(d.cause)}${d.tasks_affected.length ? ` (affects ${esc(d.tasks_affected.join(", "))})` : ""}</p>`).join("")}${(s.impacts || []).map(i => `<p class="mt-1 text-blue-600">${esc(i)}</p>`).join("")}${s.risks.length ? `<p class="mt-1"><b>Risks:</b> ${esc(s.risks.join("; "))}</p>` : ""}
    ${s.milestone_complete ? `<p class="mt-1 text-emerald-600">Milestone complete: ${esc(s.milestone_name)}. An invoice is waiting in <a class="link" href="#/approvals">Approvals</a>.</p>` : ""}${s.follow_up_question ? `<p class="mt-1 text-blue-600"><b>Question:</b> ${esc(s.follow_up_question)}</p>` : ""}</div>`; }).join("") || '<p class="muted text-sm">No reports yet.</p>'}</div>`; };

V.field = () => { const t = today(), repToday = S.reports.filter(r => r.created.slice(0, 10) === t), low = S.materials.filter(m => m.qty < m.min_qty), eq = s => S.equipment.filter(e => e.status === s).length;
  const tb = S.projects.reduce((s, p) => s + p.budget, 0), ta = S.projects.reduce((s, p) => s + p.spent, 0);
  return head("Field Operations", "Live view of sites, stock, equipment and safety.") + stats([["Active sites", S.projects.length], ["Critical issues", S.incidents.filter(i => i.severity === "Critical" && i.status !== "Closed").length], ["Pending reports", S.projects.filter(p => !repToday.some(r => r.project_id == p.id)).length], ["Reports today", repToday.length]]) +
  sec("Active sites", tbl(["Site", "Client", "Progress", ""], S.projects.map(p => [esc(p.name), esc(cl(p.client_id).name), p.progress + "%", `<a class="link" href="#/projects/${p.id}/reports">Daily reports</a>`]))) +
  sec("Material inventory", stats([["Materials", S.materials.length], ["Low stock alerts", low.length], ["Total value", money(S.materials.reduce((s, m) => s + m.qty * m.unit_cost, 0))]]) + (low.length ? `<div class="mt-3">${tbl(["Low stock", "Quantity", "Minimum"], low.map(m => [esc(m.name), m.qty, m.min_qty]))}</div>` : "")) +
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
  return `<a href="#/reports" class="link text-sm">Back to reports</a><div class="mt-2">${head(r.t + " Report", "Generated " + now().replace("T", " "), btn("Export CSV", "export", `data-kind="${k}"`) + btn("Print", "print"))}</div>${tbl(r.cols, r.rows().map(row => row.map(esc)))}`; };

V.budget = () => { const tb = S.projects.reduce((s, p) => s + p.budget, 0), ta = S.projects.reduce((s, p) => s + p.spent, 0);
  return head("Budget", "Each project with its cost categories.") + stats([["Total budget", money(tb)], ["Total spent", money(ta)], ["Remaining", money(tb - ta)], ["Over budget", S.projects.filter(p => p.spent > p.budget).length]]) +
  create("New budget line", form("line", [["project_id", "Project", "select", () => S.projects.map(p => [p.id, p.name])], ["category", "Category", "select", ["labor", "materials", "equipment", "subs", "permits", "other"]], ["budget", "Planned to date (CAD)", "number"], ["actual", "Actual to date (CAD)", "number"]])).replace('class="card mb-6 p-5"', 'class="card mt-6 p-5"') +
  S.projects.map(p => { const lines = E.variance(S.budget_lines.filter(l => l.project_id == p.id)), used = Math.round(p.spent / p.budget * 100), plan = lines.reduce((s, l) => s + l.budget, 0), act = lines.reduce((s, l) => s + l.actual, 0);
    return `<div class="card mt-6 overflow-hidden"><div class="flex flex-wrap items-start justify-between gap-4 p-5"><div><a class="link font-semibold" href="#/projects/${p.id}/schedule">${esc(p.name)}</a><div class="muted text-sm">${esc(cl(p.client_id).name)}</div></div>
      <div class="grid grid-cols-3 gap-6 text-sm"><div><div class="muted text-xs">Budget</div>${money(p.budget)}</div><div><div class="muted text-xs">Spent</div>${money(p.spent)}</div><div><div class="muted text-xs">Remaining</div>${money(p.budget - p.spent)}</div></div></div>
      <div class="px-5 pb-5">${bar(used, used - p.progress >= 8 ? "bg-amber-500" : "bg-emerald-500")}<div class="muted mt-1 text-xs">${used}% of budget used · ${p.progress}% complete</div></div>
      ${tbl(["Category", "Plan to date", "Actual", "Variance"], [...lines.map(l => [l.category[0].toUpperCase() + l.category.slice(1), money(l.budget), money(l.actual), `<b class="${l.var > 0 ? "text-red-600" : "text-emerald-600"}">${l.pct}%</b>`]), [`<b>Total</b>`, `<b>${money(plan)}</b>`, `<b>${money(act)}</b>`, `<b class="${act > plan ? "text-red-600" : "text-emerald-600"}">${plan ? Math.round((act - plan) / plan * 100) : 0}%</b>`]], true)}</div>`; }).join(""); };

V.approvals = () => { const a = [...S.actions].reverse();
  return head("Approvals", `Reminders run automatically. Invoices and payouts need approval; staff can approve up to ${money(CFG.staffLimit)}, admins any amount.`, ME.role === "admin" ? btn("Export audit log", "csv") : "") +
  sec("Waiting", `<div class="space-y-3">${a.filter(x => x.status === "pending").map(actCard).join("") || '<p class="muted text-sm">Nothing waiting.</p>'}</div>`) + sec("History", `<div class="space-y-3">${a.filter(x => x.status !== "pending").map(actCard).join("") || '<p class="muted text-sm">No decisions yet.</p>'}</div>`); };

V.admin = () => head("Admin", "People, approval rules, integrations and data.") +
  sec("Users", create("New user", form("user", [["name", "Full name"], ["email", "Email", "email"], ["role", "Role", "select", ["staff", "admin", "client", "subcontractor"]], ["client_id", "Client (for client users)", "select", () => S.clients.map(c => [c.id, c.name]), 1], ["project_id", "Project (for subcontractors)", "select", () => S.projects.map(p => [p.id, p.name]), 1]], "Create user")) + tbl(["Name", "Email", "Role"], S.users.map(u => [esc(u.name), esc(u.email), st(u.role)])) + '<p class="muted mt-2 text-xs">New users sign in with the password maple123 (demo only).</p>') +
  sec("Approval rules", `<div class="card p-5">${form("settings", [["staffLimit", "Staff approval limit (CAD)", "number"], ["access", "Access code (only if the server sets ACCESS_CODE)", "text", null, 1]], "Save").replace('name="staffLimit"', `name="staffLimit" value="${CFG.staffLimit}"`).replace('name="access"', `name="access" value="${esc(CFG.access)}"`)}</div>`) +
  sec("Integrations", tbl(["Service", "Status"], [["PayPal", ST.paypal ? bdg("Sandbox connected", "ok") : bdg("Test mode: no PayPal keys on the server", "warn")], ["Gemini", ST.gemini ? bdg("Connected", "ok") : bdg("Not configured: built-in rules are used", "warn")]])) +
  sec("Data", `<div class="card flex flex-wrap items-center justify-between gap-3 p-5"><p class="text-sm">All data is stored in this browser. Resetting restores the sample data.</p>${btn("Reset local data", "reset")}</div>`);

function answer(q) {
  const kw = [["overdue", "overdue"], ["owe", "overdue"], ["invoice", "overdue"], ["risk", "at_risk"], ["budget", "at_risk"], ["approv", "approvals"], ["waiting", "approvals"], ["payout", "payouts"], ["schedule", "schedule"], ["delay", "schedule"]];
  const tool = (kw.find(([k]) => q.toLowerCase().includes(k)) || [])[1], ids = myProjects().map(p => p.id); let title = "", lines = [];
  if (tool === "overdue" && ME.role !== "subcontractor") { title = "Overdue invoices"; lines = invs().filter(i => i.days_over > 0 && ids.includes(i.project_id)).map(i => [`${i.number}: ${money(i.amount)}, ${i.days_over} days overdue (${i.client})`, staff() ? "#/finance" : "#/"]); }
  else if (tool === "at_risk" && staff()) { title = "Projects where spend is ahead of progress"; lines = S.projects.filter(p => Math.round(p.spent / p.budget * 100) - p.progress >= 8).map(p => [`${p.name}: ${Math.round(p.spent / p.budget * 100)}% of budget used, ${p.progress}% complete`, "#/projects/" + p.id]); }
  else if (tool === "approvals" && staff()) { title = "Waiting for approval"; lines = S.actions.filter(a => a.status === "pending").map(a => [a.title, "#/approvals"]); }
  else if (tool === "payouts" && ME.role !== "client") { title = "Payouts"; lines = S.payouts.filter(p => staff() || p.user_id == ME.id).map(p => [`${money(p.amount)} (${p.status}), holdback ${money(p.holdback)}`, staff() ? "#/approvals" : "#/"]); }
  else if (tool === "schedule" && staff()) { title = "Schedule forecast"; lines = ids.map(id => { const pl = E.plan(S.tasks.filter(t => t.project_id == id)); return [`${proj(id).name}: forecast finish ${pl.finish}, ${pl.slip} days behind baseline`, "#/projects/" + id + "/schedule"]; }); }
  return { title, lines };
}
V.search = q => { q = q.trim(); if (!q) return head("Search", "Type a project, client, invoice, material or a question such as \"overdue invoices\".");
  const t = q.toLowerCase(), has = o => Object.values(o).some(v => typeof v === "string" && v.toLowerCase().includes(t)), ids = myProjects().map(p => p.id), groups = [], G = (title, items) => { if (items.length) groups.push([title, items]); };
  G("Projects", myProjects().filter(has).map(p => [p.name, `${cl(p.client_id).name} · ${p.progress}% complete`, "#/projects/" + p.id]));
  G("Invoices", S.invoices.filter(i => ids.includes(i.project_id) && (has(i) || cl(i.client_id).name.toLowerCase().includes(t))).map(i => [i.number, `${cl(i.client_id).name} · ${money(i.amount)} · ${i.status}`, staff() ? "#/invoices" : "#/"]));
  if (staff()) { G("Clients", S.clients.filter(has).map(c => [c.name, c.email, "#/clients"])); G("Proposals", S.proposals.filter(has).map(p => [p.title, `${cl(p.client_id).name} · ${money(p.amount)} · ${p.status}`, "#/proposals"]));
    G("Materials", S.materials.filter(has).map(m => [m.name, `${m.qty} ${m.unit} in stock`, "#/materials"])); G("Equipment", S.equipment.filter(has).map(e => [e.name, `${e.type} · ${e.status}`, "#/equipment"]));
    G("Safety", S.incidents.filter(has).map(i => [i.type, `${proj(i.project_id).name} · ${i.severity} · ${i.status}`, "#/safety"])); G("Notes", S.notes.filter(has).map(n => [n.text.slice(0, 80), proj(n.project_id).name, "#/projects/" + n.project_id + "/notes"]));
    G("People", S.users.filter(u => has(u)).map(u => [u.name, `${u.email} · ${u.role}`, ME.role === "admin" ? "#/admin" : "#/"])); }
  const a = answer(q), list = (rows) => `<div class="space-y-2">${rows.map(([ti, su, l]) => `<a href="${l}" class="card block p-3 text-sm hover:border-blue-400"><div class="font-medium">${esc(ti)}</div>${su ? `<div class="muted text-xs">${esc(su)}</div>` : ""}</a>`).join("")}</div>`;
  return head("Search results", `For "${esc(q)}"`) + (a.title ? sec(a.title, list(a.lines.map(([x, l]) => [x, "", l])) || "") : "") + groups.map(([ti, items]) => sec(ti, list(items))).join("") + (!a.title && !groups.length ? '<p class="muted text-sm">No matches. Try a project, client, invoice number or material name.</p>' : ""); };

let RT = 0, POST = null;
async function render() {
  const my = ++RT; POST = null; const app = document.getElementById("app");
  if (!ME) { app.innerHTML = location.hash === "#/login" ? V.login() : V.landing(); return; }
  const [path, qs] = (location.hash.slice(1) || "/").split("?"), s = path.split("/").filter(Boolean), r = s[0] || "", q = decodeURIComponent(new URLSearchParams(qs).get("q") || ""); let body;
  const R = { "": V.command, finance: V.finance, field: V.field, projects: () => (s[1] ? V.project(+s[1], s[2] || "overview") : V.projects()), clients: () => V.entity("clients"), proposals: () => V.entity("proposals"), invoices: V.invoices, remind: () => V.remind(+s[1]),
    reports: () => (s[1] ? V.report(s[1]) : V.reports()), materials: () => V.entity("materials"), equipment: () => V.entity("equipment"), safety: () => V.entity("incidents"), budget: V.budget, approvals: V.approvals, admin: () => (ME.role === "admin" ? V.admin() : "<p>Not allowed for your role.</p>"), search: () => V.search(q), ask: () => V.search(q) };
  try { body = !staff() ? (r === "" ? V.portal() : r === "search" || r === "ask" ? V.search(q) : "<p>Not allowed for your role.</p>") : R[r] ? await R[r]() : "<p>Page not found.</p>"; }
  catch (e) { body = `<p class="text-sm text-red-600">Something went wrong: ${esc(e.message)}</p>`; }
  if (my !== RT) return; app.innerHTML = layout(body); if (POST) { const f = POST; POST = null; f().catch(() => {}); }
}

const pref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const csvText = rows => rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
const download = (name, text) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); };
const ACT = {
  async approve(d) { const a = S.actions.find(x => x.id == d.id); if (a.status !== "pending") return;
    if (ME.role === "staff" && (a.payload.amount || 0) > CFG.staffLimit) throw new Error(`Over the ${money(CFG.staffLimit)} staff limit: an admin must approve`); await run(a, ME.email); },
  reject(d) { const a = S.actions.find(x => x.id == d.id); if (a.kind === "payout") release(a.payload.payout_id, "rejected"); upd("actions", a.id, { status: "rejected", result: { by: ME.email }, decided: now() }); },
  simpaid(d) { upd("invoices", +d.id, { status: "paid" }); onPaid(+d.id); location.hash = "#/approvals"; },
  tsapprove(d) { upd("timesheets", +d.id, { status: "approved" }); },
  sync,
  logout() { ME = null; put("meta", { id: 3, uid: null }); location.hash = "#/"; },
  theme() { const on = document.documentElement.classList.toggle("dark"); pref("mp-theme", on ? "dark" : "light"); },
  font(d) { const c = document.documentElement.classList; c.remove("sm", "lg"); if (d.size !== "md") c.add(d.size); pref("mp-font", d.size); },
  print() { window.print(); },
  export(d) { const r = REPORTS[d.kind]; download(d.kind + "-report.csv", csvText([r.cols, ...r.rows()])); },
  csv() { download("audit.csv", csvText([["id", "created", "agent", "kind", "title", "rationale", "status", "result", "decided"], ...S.actions.map(a => [a.id, a.created, a.agent, a.kind, a.title, a.rationale, a.status, JSON.stringify(a.result), a.decided])])); },
  reset() { if (!confirm("Delete all local MaplePro data and restore the sample data?")) return; idb.close(); indexedDB.deleteDatabase("maplepro").onsuccess = () => { location.hash = "#/"; location.reload(); }; },
};
const KEEP = new Set(["print", "export", "csv"]);
const FORM = {
  login(f) { const u = S.users.find(x => x.email === f.email.trim().toLowerCase());
    if (!u || f.password !== "maple123") throw new Error("Email or password is incorrect."); ME = u; put("meta", { id: 3, uid: u.id }); location.hash = "#/"; },
  ask(f) { location.hash = "#/search?q=" + encodeURIComponent(f.q); },
  async sendremind(f, ds) { const inv = invs().find(i => i.id == ds.id), a = logAction("Billing", "remind", inv.id, `Reminder to ${inv.client} for ${inv.number}`, `${ME.name} sent a reminder to ${inv.client} (${inv.email}); invoice is ${inv.days_over} days overdue.`, { subject: f.subject, note: f.note });
    await run(a, ME.email); const ok = a.status === "executed"; toast(ok ? `Reminder sent to ${inv.client}` : "Could not send: " + (a.result.error || "unknown error")); location.hash = ok ? "#/finance" : "#/remind/" + inv.id; },
  create(f, ds) { const e = ENT[ds.ent], row = {}; for (const [k, , type] of e.f) { const v = f[k]; row[k] = v === undefined || v === "" ? null : type === "number" || k.endsWith("_id") ? +v : v; } add(ds.ent, { ...row, ...(e.def ? e.def() : {}) }); },
  project(f) { const p = add("projects", { name: f.name, client_id: +f.client_id, budget: +f.budget, spent: 0, progress: 0, due: f.due, description: f.description || "", created: today() });
    ["labor", "materials", "equipment", "subs"].forEach(category => add("budget_lines", { project_id: p.id, category, budget: 0, actual: 0 })); location.hash = "#/projects/" + p.id; },
  invoice(f) { const p = proj(+f.project_id), n = Math.max(0, ...S.invoices.map(i => i.id)) + 100, number = `INV-${new Date().getFullYear()}-${String(n).padStart(3, "0")}`;
    const inv = add("invoices", { number, project_id: p.id, client_id: p.client_id, amount: +f.amount, due_date: f.due_date, status: "draft", paypal_id: null });
    logAction("Billing", "send_invoice", inv.id, `Send invoice ${number} via PayPal`, `${ME.name} created ${number} for ${money(inv.amount)} on ${p.name}.`, { amount: inv.amount, desc: f.description || "" }); },
  task(f, ds) { const pred = f.pred ? +f.pred : null; add("tasks", { project_id: +ds.pid, name: f.name, days: Math.max(1, +f.days), pred, progress: 0, slip: 0, wx: f.wx === "Yes" ? 1 : 0, start: f.start || today() }); },
  progress(f) { const t = upd("tasks", +f.task_id, { progress: Math.min(100, Math.max(0, +f.progress)) }), all = S.tasks.filter(x => x.project_id == t.project_id), tot = all.reduce((s, x) => s + x.days, 0);
    upd("projects", t.project_id, { progress: Math.round(all.reduce((s, x) => s + x.days * x.progress, 0) / tot) }); },
  hours(f, ds) { add("timesheets", { project_id: +ds.pid, user_id: +f.user_id, work_date: f.work_date, hours: +f.hours, rate: CFG.rate, status: "submitted", payout_id: null }); },
  note(f, ds) { add("notes", { project_id: +ds.pid, text: f.text, author: ME.name, created: now().replace("T", " ") }); },
  line(f) { add("budget_lines", { project_id: +f.project_id, category: f.category, budget: +f.budget, actual: +f.actual }); },
  user(f) { if (S.users.some(u => u.email === f.email.trim().toLowerCase())) throw new Error("That email already exists");
    const u = add("users", { email: f.email.trim().toLowerCase(), name: f.name, role: f.role, client_id: f.role === "client" && f.client_id ? +f.client_id : null }); if (f.role === "subcontractor" && f.project_id) add("members", { user_id: u.id, project_id: +f.project_id }); },
  ts(f) { if (ME.role !== "subcontractor" || !myProjects().some(p => p.id == f.project_id)) throw new Error("Not assigned to this project");
    add("timesheets", { project_id: +f.project_id, user_id: ME.id, work_date: f.work_date, hours: +f.hours, rate: CFG.rate, status: "submitted", payout_id: null }); },
  async report(f, ds) { const p = proj(+ds.pid), s = await siteAgent(f.raw.slice(0, 4000), p); s.impacts = [];
    if (s.delay_days && s.delays.length) { const open = S.tasks.filter(t => t.project_id == p.id && t.progress < 100), names = s.delays.flatMap(d => d.tasks_affected.map(x => x.toLowerCase()));
      const hit = open.find(t => names.some(n => t.name.toLowerCase().includes(n) || n.includes(t.name.toLowerCase()))) || open[0];
      if (hit) { upd("tasks", hit.id, { slip: hit.slip + s.delay_days }); s.impacts.push(`Schedule: ${hit.name} slips ${s.delay_days} days; finish date recalculated.`); } }
    if (s.extra_hours) { const cost = s.extra_hours * CFG.rate, l = S.budget_lines.find(x => x.project_id == p.id && x.category === "labor"); if (l) upd("budget_lines", l.id, { actual: l.actual + cost }); upd("projects", p.id, { spent: p.spent + cost });
      s.impacts.push(`Budget: ${s.extra_hours} extra labor hours add ${money(cost)}.`); }
    add("reports", { project_id: p.id, raw: f.raw, s, created: now() });
    if (s.milestone_complete && s.milestone_name) { const gross = Math.round(p.budget * CFG.milestonePct), { hold, net } = E.holdbackSplit(gross, CFG.holdback);
      logAction("Billing", "create_invoice", p.id, `Invoice milestone: ${s.milestone_name}`, `Site report says '${s.milestone_name}' is complete. Milestone billing ${money(gross)} less ${CFG.holdback * 100}% holdback ${money(hold)} = ${money(net)}.`, { milestone: s.milestone_name, amount: net, holdback: hold }); } },
  settings(f) { CFG.staffLimit = +f.staffLimit || 0; CFG.access = (f.access || "").trim(); saveCfg(); alert("Saved"); },
};
document.addEventListener("click", async e => { const b = e.target.closest("[data-act]"); if (!b) return; e.preventDefault(); b.disabled = true;
  try { await ACT[b.dataset.act](b.dataset); } catch (err) { alert(err.message); } b.disabled = false; if (!KEEP.has(b.dataset.act)) render(); });
document.addEventListener("submit", async e => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault();
  try { await FORM[f.dataset.form](Object.fromEntries(new FormData(f)), f.dataset); } catch (err) { alert(err.message); } render(); });
document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); const q = document.getElementById("q"); if (q) q.focus(); } });
window.addEventListener("hashchange", render);

(async () => {
  idb = await openDb(); await loadAll(); if (!S.projects.length) seed();
  const cfg = S.meta.find(m => m.id == 2); if (cfg) Object.assign(CFG, cfg.v);
  const ses = S.meta.find(m => m.id == 3); if (ses && ses.uid) ME = S.users.find(u => u.id == ses.uid) || null;
  try { ST = await (await fetch("/api/status")).json(); } catch (e) {}
  render();
})();
