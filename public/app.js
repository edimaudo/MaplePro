"use strict";
// MaplePro browser app. Data lives in IndexedDB; the server is only used for Gemini and PayPal calls.
const E = window.Engine, { add: addD, today, money, diff } = E;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const T = ["clients", "projects", "invoices", "reports", "actions", "users", "members", "tasks", "timesheets", "payouts", "budget_lines", "meta"];
let S = {}, idb, ME = null, ST = { paypal: false, gemini: false };
const CFG = { staffLimit: 50000, holdback: 0.1, rate: 65, milestonePct: 0.08, access: "", lat: 43.77, lon: -79.41, autoKinds: ["remind"] };
const now = () => new Date().toISOString().slice(0, 19);

// ---- IndexedDB: everything is loaded into memory at start, writes go through to the database ------------
const openDb = () => new Promise((res, rej) => { const r = indexedDB.open("maplepro", 1);
  r.onupgradeneeded = () => T.forEach(t => r.result.createObjectStore(t, { keyPath: "id" })); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const loadAll = () => Promise.all(T.map(t => new Promise(res => { const q = idb.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res((S[t] = q.result)); })));
const put = (t, row) => { idb.transaction(t, "readwrite").objectStore(t).put(row); return row; };
const add = (t, row) => { row = { ...row, id: Math.max(0, ...S[t].map(r => r.id)) + 1 }; S[t].push(row); return put(t, row); };
const upd = (t, id, patch) => { const r = S[t].find(x => x.id == id); Object.assign(r, patch); put(t, r); return r; };
const saveCfg = () => put("meta", { id: 2, v: { ...CFG } });
const api = (path, body) => fetch("/api/" + path, { method: "POST", headers: { "Content-Type": "application/json", "x-access-code": CFG.access }, body: JSON.stringify(body || {}) })
  .then(async r => { if (!r.ok) throw new Error((await r.text()).slice(0, 200)); return r.json(); });
const gem = async prompt => { try { return (await api("gemini", { prompt })).result; } catch (e) { return null; } };

function seed() {
  const t = today(), d = n => addD(t, -n), A = (tb, rows) => rows.forEach(r => add(tb, r));
  A("clients", [["Acme Real Estate Development", "client@example.com"], ["Downtown Commercial Properties", "billing@example.com"], ["Suburban Retail Group", "ap@example.com"]].map(([name, email]) => ({ name, email })));
  A("projects", [["Riverside Luxury Apartments", 1, 3500000, 980000, 28, "2027-09-30", "12-story, 150-unit apartment complex with underground parking, pool, gym and rooftop terrace."],
    ["Downtown Office Tower Renovation", 2, 2500000, 700000, 18, "2027-03-15", "Interior and facade renovation of a 9-story office tower."],
    ["Suburban Shopping Center", 3, 1500000, 182200, 12, "2027-06-01", "New 40,000 sq ft retail center with shared parking."]]
    .map(([name, client_id, budget, spent, progress, due, description]) => ({ name, client_id, budget, spent, progress, due, description })));
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
  S.projects.forEach(p => [["labor", .30, .38], ["materials", .35, .30], ["equipment", .10, .10], ["subs", .25, .22]]
    .forEach(([category, pl, ac]) => add("budget_lines", { project_id: p.id, category, budget: Math.round(p.budget * p.progress / 100 * pl), actual: Math.round(p.spent * ac) })));
}

// ---- scoping and data helpers ------------------------------------------------------------------------------
const staff = () => ME && ["admin", "staff"].includes(ME.role);
const cl = id => S.clients.find(c => c.id == id), proj = id => S.projects.find(p => p.id == id);
const myProjects = () => staff() ? S.projects : ME.role === "client" ? S.projects.filter(p => p.client_id == ME.client_id) : S.projects.filter(p => S.members.some(m => m.user_id == ME.id && m.project_id == p.id));
const invs = () => S.invoices.filter(i => i.status !== "paid").map(i => { const dd = Math.max(diff(today(), i.due_date), 0), c = cl(i.client_id);
  return { ...i, client: c.name, email: c.email, project: proj(i.project_id).name, days_over: dd, prob: E.payProb(dd, i.amount), risk: dd > 10 ? "high" : "healthy" }; })
  .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
const logAction = (agent, kind, ref, title, rationale, payload) => add("actions", { agent, kind, ref_id: ref, title, rationale, payload, status: "pending", result: null, created: now(), decided: null });
const release = (pid, status) => { upd("payouts", pid, { status }); S.timesheets.filter(t => t.payout_id == pid).forEach(t => upd("timesheets", t.id, { payout_id: null, status: "approved" })); };

// ---- agents ----------------------------------------------------------------------------------------------------
async function siteAgent(raw, p) {
  const o = await gem("You are a construction site clerk. Convert the field note into JSON with keys: work_completed (string[]), crew_count (int|null), delays ([{cause:string,tasks_affected:string[]}]), risks (string[]), materials (string[]), milestone_complete (bool), milestone_name (string|null), follow_up_question (string|null: ask if key info is missing, never guess), delay_days (int|null, only if the note states a number of days), extra_hours (int|null, only if stated). Project: " + p.name + ". Note: " + raw);
  return o && typeof o === "object" ? E.normalize(o, "gemini") : E.siteFallback(raw);
}
async function draftReminder(inv) {
  const facts = [inv.number, money(inv.amount), inv.days_over, inv.project], tone = inv.days_over >= 14 ? "firm but friendly" : "warm and friendly";
  const o = await gem(`Write a payment reminder, tone ${tone}, 2 sentences. Use ONLY these facts and no other numbers: ${JSON.stringify(facts)}. Return JSON {subject, note}.`);
  if (o && o.note && o.subject && E.grounded(o.subject + " " + o.note, facts)) return { subject: o.subject, note: o.note, source: "gemini" };
  return { subject: `Reminder: invoice ${inv.number}`, note: `Hi, invoice ${inv.number} for ${money(inv.amount)} on ${inv.project} is ${inv.days_over} days past due. Please let us know if anything is blocking payment.`, source: "template" };
}
async function explain(lines, delays) {
  const over = lines.filter(l => l.var > 0); if (!over.length) return "All categories are within the planned spend to date.";
  const tpl = over.map(l => `${l.category[0].toUpperCase() + l.category.slice(1)} is ${money(l.var)} over plan (${l.pct}%).`).join(" ") + (delays.length ? " Recent site delays: " + delays.join("; ") + "." : "");
  const facts = [...over.map(l => `${l.category} ${money(l.var)} ${l.pct}%`), ...delays];
  const o = await gem(`Explain this construction budget variance in 2 plain sentences for a project manager. Use ONLY these facts and no other numbers: ${JSON.stringify(facts)}. Return JSON {"text": string}.`);
  return o && typeof o.text === "string" && E.grounded(o.text, facts) ? o.text : tpl;
}
let WX = { t: 0, v: [] };
async function weather() {
  if (Date.now() - WX.t < 18e5) return WX.v;
  try { const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&daily=precipitation_sum,temperature_2m_min&forecast_days=7&timezone=auto`)).json();
    WX = { t: Date.now(), v: j.daily.time.map((date, i) => ({ date, rain: j.daily.precipitation_sum[i], tmin: j.daily.temperature_2m_min[i] })) };
  } catch (e) { WX = { t: Date.now() - 12e5, v: [] }; } return WX.v;
}

// ---- actions: tiered approval and PayPal execution -------------------------------------------------------------
async function execute(a) {
  const rid = "maplepro-action-" + a.id, p = a.payload;
  if (a.kind === "remind") { const inv = S.invoices.find(i => i.id == a.ref_id), c = cl(inv.client_id);
    if (inv.paypal_id) return api("paypal/remind", { id: inv.paypal_id, subject: p.subject, note: p.note, rid });
    const r = await api("paypal/invoice", { number: inv.number, email: c.email, items: [[`Invoice ${inv.number}`, inv.amount]], note: p.note, rid }); upd("invoices", inv.id, { paypal_id: r.id }); return r; }
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
const badge = (t, c = "bg-slate-100 text-slate-700") => `<span class="text-xs px-2 py-0.5 rounded-full ${c}">${esc(t)}</span>`;
const bar = (v, c) => `<div class="h-2 rounded bg-slate-100"><div class="h-2 rounded ${c}" style="width:${Math.min(v, 100)}%"></div></div>`;
const btn = (label, act, data = "", cls = "bg-blue-600 text-white hover:bg-blue-700") => `<button data-act="${act}" ${data} class="rounded-md px-3 py-1.5 text-sm ${cls}">${label}</button>`;
const ghost = "border hover:bg-slate-50";
function card(a) { const p = a.payload;
  return `<div class="rounded-lg border bg-white p-4"><div class="flex items-center gap-2">${badge(a.agent, "bg-indigo-100 text-indigo-800")}<span class="font-medium text-sm">${esc(a.title)}</span>
    ${a.status !== "pending" ? `<span class="ml-auto">${badge(a.status, a.status === "executed" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700")}</span>` : ""}</div>
    ${p.note ? `<p class="mt-2 text-sm text-slate-600">"${esc(p.note)}"</p>` : ""}${p.amount ? `<p class="mt-2 text-sm text-slate-600">Amount ${money(p.amount)}, holdback ${money(p.holdback)}</p>` : ""}
    <details class="mt-2 text-xs text-slate-500"><summary class="cursor-pointer">Why did the agent propose this?</summary><p class="mt-1">${esc(a.rationale)}</p>${a.result ? `<p class="mt-1 break-all">Result: ${esc(JSON.stringify(a.result))}</p>` : ""}</details>
    ${a.status === "pending" ? `<div class="mt-3 flex gap-2">${btn("Approve and send via PayPal", "approve", `data-id="${a.id}"`)}${btn("Reject", "reject", `data-id="${a.id}"`, ghost)}</div>` : ""}</div>`; }
const stat = (l, v, c = "bg-white") => `<div class="rounded-lg border ${c} p-4"><div class="text-xs text-slate-500">${l}</div><div class="text-xl font-semibold">${v}</div></div>`;

function layout(body) {
  const nav = [["#/", staff() ? "Command Center" : "My work"], ...(staff() ? [["#/finance", "Financial Intelligence"], ["#/timesheets", "Timesheets"], ["#/approvals", "Approvals & Audit"]] : []), ...(ME.role === "admin" ? [["#/settings", "Settings"]] : [])];
  const cur = location.hash || "#/";
  return `<div class="flex min-h-screen"><aside class="w-56 shrink-0 bg-slate-950 text-slate-300 p-4 hidden md:block"><div class="text-white text-lg font-semibold">MaplePro</div><div class="text-xs text-slate-500 mb-6">Decision Intelligence</div>
    ${nav.map(([h, l]) => `<a href="${h}" class="block rounded-md px-3 py-2 text-sm ${cur === h ? "bg-slate-800 text-white" : "hover:bg-slate-900"}">${l}</a>`).join("")}
    ${ME.role === "admin" ? `<button data-act="csv" class="block w-full text-left rounded-md px-3 py-2 text-sm hover:bg-slate-900">Export audit log</button>` : ""}</aside>
    <div class="flex-1 min-w-0"><header class="bg-white border-b px-6 py-3 flex flex-wrap items-center gap-3 text-sm">
    <form data-form="ask" class="flex-1 min-w-[12rem] max-w-md"><label class="sr-only" for="q">Ask MaplePro</label><input id="q" name="q" placeholder="Ask: which invoices are overdue?" class="w-full rounded-md border px-3 py-1.5"></form>
    ${badge("PayPal: " + (ST.paypal ? "sandbox connected" : "mock mode"), ST.paypal ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}
    <button data-act="reset" class="text-xs underline text-slate-500">Reset local data</button><span>${esc(ME.name)} (${ME.role})</span><button data-act="logout" class="underline text-blue-700">Sign out</button></header>
    <main class="p-6 max-w-6xl">${body}</main></div></div>`; }

const V = {};
const accounts = () => [["Admin", "admin", "Everything: all approvals, Settings, audit export"], ["Project manager", "staff", `Command Center; approves up to ${money(CFG.staffLimit)}`],
  ["Client", "client", "Own projects and invoices only"], ["Subcontractor", "subcontractor", "Timesheets and payouts only"]].map(([label, role, desc]) => ({ label, desc, email: S.users.find(u => u.role === role).email }));
const acctTable = () => `<div class="overflow-x-auto rounded-xl border bg-white"><table class="w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500"><tr><th class="p-3">Role</th><th class="p-3">Email</th><th class="p-3">Password</th><th class="p-3 hidden md:table-cell">What they can see</th><th></th></tr></thead>
  <tbody class="divide-y">${accounts().map(a => `<tr><td class="p-3 font-medium whitespace-nowrap">${a.label}</td><td class="p-3 font-mono">${esc(a.email)}</td><td class="p-3 font-mono">maple123</td><td class="p-3 hidden md:table-cell text-slate-600">${a.desc}</td>
  <td class="p-3 text-right whitespace-nowrap"><button data-act="demo" data-email="${esc(a.email)}" class="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">Sign in as ${a.label.toLowerCase()}</button></td></tr>`).join("")}</tbody></table></div>`;

V.landing = () => `<div class="min-h-screen bg-slate-50"><header class="bg-slate-950 text-white"><div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"><span class="text-lg font-semibold">MaplePro</span>
  <a href="#/login" class="rounded-md border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800">Sign in</a></div>
  <div class="mx-auto max-w-6xl px-6 pb-16 pt-12"><p class="text-sm text-blue-300">Construction management, run by AI agents</p>
  <h1 class="mt-3 max-w-3xl text-4xl font-semibold leading-tight">Turn a messy field note into a schedule update, a cost update and a paid invoice.</h1>
  <p class="mt-4 max-w-2xl text-slate-300">MaplePro's agents read daily reports, forecast delays and budget overruns, and prepare invoices and subcontractor payouts. You approve every move of money, and PayPal does the payment.</p>
  <div class="mt-8 flex flex-wrap gap-3"><a href="#demo" data-act="scroll" class="rounded-md bg-blue-600 px-5 py-2.5 font-medium hover:bg-blue-500">Try the demo</a><a href="#/login" class="rounded-md border border-slate-600 px-5 py-2.5 hover:bg-slate-800">Sign in</a></div></div></header>
  <main class="mx-auto max-w-6xl space-y-14 px-6 py-12">
  <section><h2 class="text-xl font-semibold">What it does</h2><div class="mt-4 grid gap-4 md:grid-cols-3">
  ${[["Reads the site", "Paste a field note. The Site Agent pulls out work done, delays, risks and milestones, and asks when something is missing."], ["Sees the consequences", "Delays move the critical path and finish date, weather is checked, and overtime shows up as budget variance, explained in plain language."], ["Moves the money, with you in control", "Milestones become PayPal invoices, client payments trigger subcontractor payouts with holdback, and big actions need an admin."]]
  .map(([t, d]) => `<div class="rounded-xl border bg-white p-5"><h3 class="font-medium">${t}</h3><p class="mt-2 text-sm text-slate-600">${d}</p></div>`).join("")}</div></section>
  <section><h2 class="text-xl font-semibold">How a project event flows</h2><ol class="mt-4 grid gap-3 text-sm md:grid-cols-5">${["Field note", "Agents analyse", "Schedule and budget update", "You approve", "PayPal invoice or payout"]
  .map((t, i) => `<li class="rounded-lg border bg-white p-4"><span class="text-xs text-blue-700">Step ${i + 1}</span><div class="mt-1 font-medium">${t}</div></li>`).join("")}</ol></section>
  <section id="demo"><h2 class="text-xl font-semibold">Try the demo</h2><p class="mt-1 text-sm text-slate-600">Four demo accounts, all with the password <span class="font-mono">maple123</span>. Click a button to sign in as that role. Data is fake and stays in this browser; PayPal runs in sandbox or mock mode.</p><div class="mt-4">${acctTable()}</div></section></main></div>`;

V.login = () => `<div class="mx-auto max-w-3xl px-6 py-10"><a href="#/" class="text-sm text-blue-700 underline">Back to home</a><h1 class="mt-3 text-2xl font-semibold">Sign in to MaplePro</h1>
  <form data-form="login" class="mt-4 max-w-sm space-y-3 rounded-xl border bg-white p-6"><label class="block text-sm">Email<input name="email" type="email" required autocomplete="username" class="mt-1 w-full rounded-md border px-3 py-1.5"></label>
  <label class="block text-sm">Password<input name="password" type="password" required autocomplete="current-password" class="mt-1 w-full rounded-md border px-3 py-1.5"></label><button class="w-full rounded-md bg-blue-600 py-2 text-white hover:bg-blue-700">Sign in</button></form>
  <h2 class="mt-8 mb-2 font-medium">Demo accounts</h2><p class="mb-3 text-sm text-slate-600">Use these exact emails with the password <span class="font-mono">maple123</span>, or click a button.</p>${acctTable()}</div>`;

V.command = () => { const all = invs(), od = all.filter(i => i.days_over > 0), projs = S.projects.map(p => { const burn = Math.round(p.spent / p.budget * 100); return { ...p, burn, gap: burn - p.progress, client: cl(p.client_id).name, overdue: od.filter(i => i.project_id == p.id).reduce((s, i) => s + i.amount, 0) }; });
  const stream = projs.filter(p => p.gap >= 8).map(p => ({ a: "Budget", t: `${p.name}: ${p.burn}% of budget spent against ${p.progress}% progress.`, c: Math.min(95, 55 + p.gap * 2) }));
  if (od.length) stream.unshift({ a: "Billing", t: `${od.length} invoices overdue, ${money(od.reduce((s, i) => s + i.amount, 0))} outstanding.`, c: 90 });
  const week = [...projs.filter(p => !S.reports.some(r => r.project_id == p.id)).map(p => `Submit a daily report for ${p.name}`), ...all.filter(i => i.days_over === 0 && i.due_date > today()).map(i => `${i.number} due in ${diff(i.due_date, today())} days`)];
  const pend = S.actions.filter(a => a.status === "pending").reverse();
  return `<h1 class="text-2xl font-semibold">Command Center</h1><section class="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><h2 class="font-medium">AI Intelligence Stream</h2>
  ${stream.map(s => `<div class="mt-2 flex gap-2 text-sm">${badge(s.a, "bg-white border")}<span>${esc(s.t)}</span><span class="ml-auto whitespace-nowrap text-slate-500">heuristic ${s.c}%</span></div>`).join("") || `<p class="mt-2 text-sm">No risks detected.</p>`}</section>
  <section class="mt-6"><h2 class="font-medium mb-2">Priority intelligence</h2><div class="grid gap-3 md:grid-cols-3">
  <div class="rounded-lg border bg-white p-4"><div class="text-red-600 font-medium">Urgent</div>${od.filter(i => i.days_over >= 14).map(i => `<p class="mt-2 text-sm"><a class="text-blue-700 underline" href="#/finance">${i.number}</a> is ${i.days_over} days overdue (${money(i.amount)})</p>`).join("")}</div>
  <div class="rounded-lg border bg-white p-4"><div class="text-amber-600 font-medium">Today (${pend.length})</div><p class="mt-2 text-sm">${pend.length} agent proposals waiting. <a class="text-blue-700 underline" href="#/approvals">Review</a></p></div>
  <div class="rounded-lg border bg-white p-4"><div class="text-blue-600 font-medium">This week (${week.length})</div>${week.map(w => `<p class="mt-2 text-sm">${esc(w)}</p>`).join("")}</div></div></section>
  <section class="mt-6"><h2 class="font-medium mb-2">Active projects</h2><div class="grid gap-3 md:grid-cols-3">${projs.map(p => `<a href="#/projects/${p.id}" class="rounded-lg border bg-white p-4 hover:border-blue-400 block">
  <div class="flex justify-between gap-2"><span class="font-medium text-sm">${esc(p.name)}</span>${p.gap >= 8 ? badge("watch", "bg-amber-100 text-amber-800") : badge("on track", "bg-emerald-100 text-emerald-800")}</div><p class="text-xs text-slate-500">${esc(p.client)}</p>
  <div class="mt-3 text-xs">Progress ${p.progress}%</div>${bar(p.progress, "bg-blue-600")}<div class="mt-2 text-xs">Budget used ${p.burn}%</div>${bar(p.burn, p.gap >= 8 ? "bg-amber-500" : "bg-emerald-500")}
  ${p.overdue ? `<p class="mt-2 text-xs text-red-600">${money(p.overdue)} overdue</p>` : ""}</a>`).join("")}</div></section>
  ${pend.length ? `<section class="mt-6"><h2 class="font-medium mb-2">Waiting for your approval</h2><div class="space-y-3">${pend.map(card).join("")}</div></section>` : ""}
  <section class="mt-6 grid gap-3 md:grid-cols-3">${stat("Contract value", money(S.projects.reduce((s, p) => s + p.budget, 0)))}${stat("Spent to date", money(S.projects.reduce((s, p) => s + p.spent, 0)))}${stat("Overdue receivables", money(od.reduce((s, i) => s + i.amount, 0)))}</section>`; };

V.portal = () => { const ps = myProjects(), mine = S.timesheets.filter(t => t.user_id == ME.id).reverse();
  return `<h1 class="text-2xl font-semibold">My work</h1><h2 class="mt-4 mb-2 font-medium">Projects</h2><div class="grid gap-3 md:grid-cols-3">${ps.map(p => `<div class="rounded-lg border bg-white p-4"><div class="font-medium text-sm">${esc(p.name)}</div><div class="mt-2 text-xs">Progress ${p.progress}%</div>${bar(p.progress, "bg-blue-600")}</div>`).join("") || `<p class="text-sm text-slate-500">No projects assigned.</p>`}</div>
  ${ME.role === "client" ? `<h2 class="mt-6 mb-2 font-medium">Invoices</h2><div class="rounded-lg border bg-white divide-y">${S.invoices.filter(i => i.client_id == ME.client_id).map(i => `<div class="flex justify-between p-3 text-sm"><span>${i.number} · ${esc(proj(i.project_id).name)}</span><span>${money(i.amount)} · ${i.status} · due ${i.due_date}</span></div>`).join("")}</div>` :
  `<h2 class="mt-6 mb-2 font-medium">Submit timesheet</h2><form data-form="ts" class="flex flex-wrap items-end gap-2 text-sm"><label>Project<select name="project_id" class="block rounded-md border px-2 py-1.5">${ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
  <label>Date<input type="date" name="work_date" required class="block rounded-md border px-2 py-1.5"></label><label>Hours<input type="number" step="0.5" min="0.5" max="24" name="hours" required class="block w-24 rounded-md border px-2 py-1.5"></label><button class="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">Submit</button></form>
  <h2 class="mt-6 mb-2 font-medium">My timesheets</h2><div class="rounded-lg border bg-white divide-y">${mine.map(t => `<div class="flex justify-between p-3 text-sm"><span>${t.work_date} · ${esc(proj(t.project_id).name)} · ${t.hours} h</span>${badge(t.status)}</div>`).join("")}</div>
  <h2 class="mt-6 mb-2 font-medium">My payouts</h2><div class="rounded-lg border bg-white divide-y">${S.payouts.filter(p => p.user_id == ME.id).map(p => `<div class="flex justify-between p-3 text-sm"><span>${money(p.amount)} (holdback ${money(p.holdback)})</span>${badge(p.status)}</div>`).join("") || `<p class="p-3 text-sm text-slate-500">No payouts yet. They are proposed after the client pays.</p>`}</div>`}`; };

V.finance = () => { const all = invs(), od = all.filter(i => i.days_over > 0), high = all.filter(i => i.risk === "high"), ok = all.filter(i => i.days_over === 0);
  return `<h1 class="text-2xl font-semibold">Financial Intelligence</h1><div class="mt-2">${btn("Sync payments from PayPal", "sync", "", ghost)}</div>
  <div class="mt-4 grid gap-3 md:grid-cols-3">${stat("Overdue", money(od.reduce((s, i) => s + i.amount, 0)), "bg-red-50")}${stat("High-risk invoices", high.length)}${stat("Awaiting your approval", S.actions.filter(a => a.status === "pending").length)}</div>
  <h2 class="mt-6 mb-2 font-medium">High risk (${high.length})</h2><div class="space-y-3">${high.map(i => `<div class="rounded-lg border border-red-200 bg-white p-4"><div class="flex flex-wrap items-center gap-2"><span class="font-medium">${i.number}</span>${badge(i.days_over + " days overdue", "bg-red-100 text-red-800")}<span class="ml-auto font-semibold">${money(i.amount)}</span></div>
  <p class="text-sm text-slate-600">${esc(i.client)} · ${esc(i.project)}</p><p class="text-sm mt-1">Payment probability <b>${i.prob}%</b> <span class="text-xs text-slate-500">(heuristic from days overdue and amount)</span></p>
  <div class="mt-3 flex gap-2">${btn("Draft reminder", "draft", `data-id="${i.id}"`)}${ST.paypal ? "" : btn("Simulate payment (mock)", "simpaid", `data-id="${i.id}"`, ghost)}</div></div>`).join("")}</div>
  <h2 class="mt-6 mb-2 font-medium">Healthy (${ok.length})</h2><div class="rounded-lg border bg-white divide-y">${ok.map(i => `<div class="flex justify-between p-3 text-sm"><span>${i.number} · ${esc(i.client)}</span><span>${money(i.amount)} · due ${i.due_date} · ${i.prob}% likely on time</span></div>`).join("")}</div>`; };

V.approvals = () => { const a = [...S.actions].reverse();
  return `<h1 class="text-2xl font-semibold">Approvals &amp; Audit</h1><p class="text-sm text-slate-500">Reminders run automatically. Invoices and payouts need approval; staff can approve up to ${money(CFG.staffLimit)}, admins any amount.</p>
  <h2 class="mt-4 mb-2 font-medium">Pending</h2><div class="space-y-3">${a.filter(x => x.status === "pending").map(card).join("") || `<p class="text-sm text-slate-500">Nothing waiting.</p>`}</div>
  <h2 class="mt-6 mb-2 font-medium">History</h2><div class="space-y-3">${a.filter(x => x.status !== "pending").map(card).join("") || `<p class="text-sm text-slate-500">No decisions yet.</p>`}</div>`; };

V.timesheets = () => `<h1 class="text-2xl font-semibold">Timesheets</h1><div class="mt-4 rounded-lg border bg-white divide-y">${[...S.timesheets].reverse().map(t => `<div class="flex flex-wrap items-center gap-2 p-3 text-sm"><span>${t.work_date} · ${esc(S.users.find(u => u.id == t.user_id).name)} · ${esc(proj(t.project_id).name)} · ${t.hours} h · ${money(t.hours * t.rate)}</span><span class="ml-auto">${badge(t.status)}</span>
  ${t.status === "submitted" ? btn("Approve", "tsapprove", `data-id="${t.id}"`) : ""}</div>`).join("")}</div>`;

V.settings = () => `<h1 class="text-2xl font-semibold">Settings</h1><form data-form="settings" class="mt-4 max-w-md space-y-3 text-sm">
  <label class="block">Staff approval limit (CAD)<input name="staffLimit" type="number" min="0" value="${CFG.staffLimit}" class="mt-1 w-full rounded-md border px-3 py-1.5"></label>
  <label class="block">Access code (needed if the server sets ACCESS_CODE)<input name="access" value="${esc(CFG.access)}" class="mt-1 w-full rounded-md border px-3 py-1.5"></label>
  <label class="block">Client invoice email (sandbox buyer account)<input name="clientEmail" type="email" value="${esc(S.clients[0].email)}" class="mt-1 w-full rounded-md border px-3 py-1.5"></label>
  <label class="block">Subcontractor payout email (sandbox personal account)<input name="subEmail" type="email" value="${esc(S.users.find(u => u.role === "subcontractor").email)}" class="mt-1 w-full rounded-md border px-3 py-1.5"></label>
  <button class="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">Save</button></form>`;

V.project = async id => { const p = proj(id); if (!p) return "<p>Project not found.</p>";
  const pl = E.plan(S.tasks.filter(t => t.project_id == id)), wx = E.wxRisks(pl.tasks, await weather()), lines = E.variance(S.budget_lines.filter(l => l.project_id == id));
  const reps = S.reports.filter(r => r.project_id == id).reverse(), why = await explain(lines, reps.slice(0, 3).flatMap(r => r.s.delays.map(d => d.cause)));
  return `<a href="#/" class="text-sm text-blue-700 underline">Back</a><h1 class="mt-2 text-2xl font-semibold">${esc(p.name)}</h1><p class="text-sm text-slate-600">${esc(cl(p.client_id).name)} · due ${p.due}</p><p class="mt-2 max-w-2xl text-sm">${esc(p.description)}</p>
  <div class="mt-3 text-sm">Budget ${money(p.budget)} · spent ${money(p.spent)} · progress ${p.progress}%</div>
  <section class="mt-6"><h2 class="font-medium mb-1">Schedule</h2><p class="text-sm">Forecast finish ${pl.finish} · baseline ${pl.baseline} · <b class="${pl.slip ? "text-amber-700" : "text-emerald-700"}">${pl.slip} days behind</b></p>
  <div class="mt-2 rounded-lg border bg-white divide-y text-sm">${pl.tasks.map(t => `<div class="flex flex-wrap gap-2 p-2"><span class="w-44">${esc(t.name)}</span><span>${t.es} to ${t.ef}</span><span>${t.progress}%</span>${t.critical ? badge("critical path", "bg-red-100 text-red-800") : ""}${t.slip ? badge("+" + t.slip + " days", "bg-amber-100 text-amber-800") : ""}</div>`).join("")}</div>
  ${wx.map(w => `<p class="mt-2 text-sm text-amber-700">Weather risk: ${esc(w.task)} is scheduled on ${w.dates.join(", ")} (rain or freezing forecast).</p>`).join("")}</section>
  <section class="mt-6"><h2 class="font-medium mb-1">Budget vs plan to date</h2><p class="text-sm">${esc(why)}</p><div class="mt-2 rounded-lg border bg-white divide-y text-sm">${lines.map(l => `<div class="flex justify-between p-2"><span>${l.category[0].toUpperCase() + l.category.slice(1)}</span><span>plan ${money(l.budget)} · actual ${money(l.actual)} · <b class="${l.var > 0 ? "text-red-700" : "text-emerald-700"}">${l.pct}%</b></span></div>`).join("")}</div></section>
  <section class="mt-6"><h2 class="font-medium mb-2">New daily report</h2><form data-form="report" class="max-w-2xl"><input type="hidden" name="pid" value="${id}"><label for="raw" class="text-sm">Field note (typed or pasted)</label>
  <textarea id="raw" name="raw" required maxlength="4000" rows="4" class="mt-1 w-full rounded-md border p-2 text-sm" placeholder="Framing complete on levels 3 to 5. Crew of 12. One wall failed inspection and was rebuilt."></textarea>
  <button class="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">Analyze with Site Agent</button></form></section>
  <section class="mt-6"><h2 class="font-medium mb-2">Reports</h2><div class="space-y-3">${reps.map(r => { const s = r.s; return `<div class="rounded-lg border bg-white p-4 text-sm"><div class="flex gap-2 text-xs text-slate-500">${r.created} ${badge("structured by " + s.source)}</div><p class="mt-2 italic text-slate-600">"${esc(r.raw)}"</p>
  ${s.work_completed.length ? `<p class="mt-2"><b>Work completed:</b> ${esc(s.work_completed.join("; "))}</p>` : ""}${s.delays.map(d => `<p class="mt-1 text-amber-700"><b>Delay:</b> ${esc(d.cause)}${d.tasks_affected.length ? ` (affects ${esc(d.tasks_affected.join(", "))})` : ""}</p>`).join("")}
  ${(s.impacts || []).map(i => `<p class="mt-1 text-indigo-700">${esc(i)}</p>`).join("")}${s.risks.length ? `<p class="mt-1"><b>Risks:</b> ${esc(s.risks.join("; "))}</p>` : ""}
  ${s.milestone_complete ? `<p class="mt-1 text-emerald-700">Milestone complete: ${esc(s.milestone_name)}. Billing Agent drafted an invoice for <a class="underline" href="#/approvals">your approval</a>.</p>` : ""}${s.follow_up_question ? `<p class="mt-1 text-blue-700"><b>Agent asks:</b> ${esc(s.follow_up_question)}</p>` : ""}</div>`; }).join("") || `<p class="text-sm text-slate-500">No reports yet.</p>`}</div></section>`; };

V.ask = async q => { const route = await gem(`Pick one tool for this construction question. Tools: overdue, at_risk, approvals, payouts, schedule. Return JSON {"tool": string}. Question: ${q}`);
  const kw = [["overdue", "overdue"], ["owe", "overdue"], ["invoice", "overdue"], ["risk", "at_risk"], ["budget", "at_risk"], ["approv", "approvals"], ["wait", "approvals"], ["payout", "payouts"], ["pay", "payouts"], ["schedule", "schedule"], ["delay", "schedule"]];
  const tool = route && ["overdue", "at_risk", "approvals", "payouts", "schedule"].includes(route.tool) ? route.tool : (kw.find(([k]) => q.toLowerCase().includes(k)) || [])[1];
  const ids = myProjects().map(p => p.id); let title = "I can answer questions about overdue invoices, at-risk projects, approvals, payouts and schedule.", lines = [];
  if (tool === "overdue" && ME.role !== "subcontractor") { title = "Overdue invoices"; lines = invs().filter(i => i.days_over > 0 && ids.includes(i.project_id)).map(i => [`${i.number}: ${money(i.amount)}, ${i.days_over} days overdue (${i.client})`, staff() ? "#/finance" : "#/"]); }
  else if (tool === "at_risk" && staff()) { title = "Projects where spend is ahead of progress"; lines = S.projects.filter(p => Math.round(p.spent / p.budget * 100) - p.progress >= 8).map(p => [`${p.name}: ${Math.round(p.spent / p.budget * 100)}% of budget used, ${p.progress}% complete`, "#/projects/" + p.id]); }
  else if (tool === "approvals" && staff()) { title = "Waiting for approval"; lines = S.actions.filter(a => a.status === "pending").map(a => [a.title, "#/approvals"]); }
  else if (tool === "payouts" && ME.role !== "client") { title = "Payouts"; lines = S.payouts.filter(p => staff() || p.user_id == ME.id).map(p => [`${money(p.amount)} (${p.status}), holdback ${money(p.holdback)}`, staff() ? "#/approvals" : "#/"]); }
  else if (tool === "schedule" && staff()) { title = "Schedule forecast"; lines = ids.map(id => { const pl = E.plan(S.tasks.filter(t => t.project_id == id)); return [`${proj(id).name}: forecast finish ${pl.finish}, ${pl.slip} days behind baseline`, "#/projects/" + id]; }); }
  else if (tool) title = "That information isn't available for your role.";
  return `<h1 class="text-xl font-semibold">${esc(title)}</h1><p class="text-sm text-slate-500">You asked: ${esc(q)}</p><div class="mt-4 space-y-2">${lines.map(([t, l]) => `<a href="${l}" class="block rounded-lg border bg-white p-3 text-sm hover:border-blue-400">${esc(t)}</a>`).join("") || `<p class="text-sm text-slate-500">Nothing to show.</p>`}</div>`; };

async function render() {
  const app = document.getElementById("app");
  if (!ME) { app.innerHTML = location.hash === "#/login" ? V.login() : V.landing(); return; }
  const [path, qs] = (location.hash.slice(1) || "/").split("?"), seg = path.split("/").filter(Boolean); let body;
  try {
    if (!seg.length) body = staff() ? V.command() : V.portal();
    else if (!staff() && seg[0] !== "ask") body = "<p class='text-sm'>Not allowed for your role.</p>";
    else if (seg[0] === "finance") body = V.finance(); else if (seg[0] === "approvals") body = V.approvals(); else if (seg[0] === "timesheets") body = V.timesheets();
    else if (seg[0] === "settings") body = ME.role === "admin" ? V.settings() : "<p class='text-sm'>Not allowed for your role.</p>";
    else if (seg[0] === "projects") body = await V.project(+seg[1]); else if (seg[0] === "ask") body = await V.ask(decodeURIComponent(new URLSearchParams(qs).get("q") || ""));
    else body = "<p>Not found.</p>";
  } catch (e) { body = `<p class="text-sm text-red-700">Something went wrong: ${esc(e.message)}</p>`; }
  app.innerHTML = layout(body);
}

const ACT = {
  async approve(d) { const a = S.actions.find(x => x.id == d.id); if (a.status !== "pending") return;
    if (ME.role === "staff" && (a.payload.amount || 0) > CFG.staffLimit) throw new Error(`Over the ${money(CFG.staffLimit)} staff limit: an admin must approve`); await run(a, ME.email); },
  reject(d) { const a = S.actions.find(x => x.id == d.id); if (a.kind === "payout") release(a.payload.payout_id, "rejected"); upd("actions", a.id, { status: "rejected", result: { by: ME.email }, decided: now() }); },
  async draft(d) { const inv = invs().find(i => i.id == d.id), r = await draftReminder(inv);
    const a = logAction("Billing", "remind", inv.id, `Send reminder for ${inv.number}`, `${inv.days_over} days overdue, estimated payment probability ${inv.prob}% (heuristic). Draft by ${r.source}.`, { subject: r.subject, note: r.note });
    if (CFG.autoKinds.includes("remind")) await run(a, "auto (low-stakes tier)"); location.hash = "#/approvals"; },
  simpaid(d) { upd("invoices", +d.id, { status: "paid" }); onPaid(+d.id); location.hash = "#/approvals"; },
  tsapprove(d) { upd("timesheets", +d.id, { status: "approved" }); },
  demo(d) { FORM.login({ email: d.email, password: "maple123" }); },
  scroll() { document.getElementById("demo").scrollIntoView({ behavior: "smooth" }); },
  sync, logout() { ME = null; put("meta", { id: 3, uid: null }); location.hash = "#/"; },
  reset() { if (!confirm("Delete all local MaplePro data?")) return; idb.close(); indexedDB.deleteDatabase("maplepro").onsuccess = () => { location.hash = "#/"; location.reload(); }; },
  csv() { const rows = [["id", "created", "agent", "kind", "title", "rationale", "status", "result", "decided"], ...S.actions.map(a => [a.id, a.created, a.agent, a.kind, a.title, a.rationale, a.status, JSON.stringify(a.result), a.decided])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" })); a.download = "audit.csv"; a.click(); },
};
const FORM = {
  login(f) { const u = S.users.find(x => x.email === f.email.trim().toLowerCase());
    if (!u || f.password !== "maple123") throw new Error("Email or password is incorrect."); ME = u; put("meta", { id: 3, uid: u.id }); location.hash = "#/"; },
  ask(f) { location.hash = "#/ask?q=" + encodeURIComponent(f.q); },
  async ts(f) { if (ME.role !== "subcontractor" || !myProjects().some(p => p.id == f.project_id)) throw new Error("Not assigned to this project");
    add("timesheets", { project_id: +f.project_id, user_id: ME.id, work_date: f.work_date, hours: +f.hours, rate: CFG.rate, status: "submitted", payout_id: null }); },
  async report(f) { const p = proj(+f.pid), s = await siteAgent(f.raw.slice(0, 4000), p); s.impacts = [];
    if (s.delay_days && s.delays.length) { const open = S.tasks.filter(t => t.project_id == p.id && t.progress < 100), names = s.delays.flatMap(d => d.tasks_affected.map(x => x.toLowerCase()));
      const hit = open.find(t => names.some(n => t.name.toLowerCase().includes(n) || n.includes(t.name.toLowerCase()))) || open[0];
      if (hit) { upd("tasks", hit.id, { slip: hit.slip + s.delay_days }); s.impacts.push(`Schedule: ${hit.name} slips ${s.delay_days} days; finish date recalculated.`); } }
    if (s.extra_hours) { const cost = s.extra_hours * CFG.rate, l = S.budget_lines.find(x => x.project_id == p.id && x.category === "labor"); upd("budget_lines", l.id, { actual: l.actual + cost }); upd("projects", p.id, { spent: p.spent + cost });
      s.impacts.push(`Budget: ${s.extra_hours} extra labor hours add ${money(cost)}.`); }
    add("reports", { project_id: p.id, raw: f.raw, s, created: now() });
    if (s.milestone_complete && s.milestone_name) { const gross = Math.round(p.budget * CFG.milestonePct), { hold, net } = E.holdbackSplit(gross, CFG.holdback);
      logAction("Billing", "create_invoice", p.id, `Invoice milestone: ${s.milestone_name}`, `Site Agent reported '${s.milestone_name}' complete. Milestone billing ${money(gross)} less ${CFG.holdback * 100}% holdback ${money(hold)} = ${money(net)}.`, { milestone: s.milestone_name, amount: net, holdback: hold }); } },
  settings(f) { CFG.staffLimit = +f.staffLimit || 0; CFG.access = f.access.trim(); saveCfg();
    upd("clients", 1, { email: f.clientEmail }); const su = S.users.find(u => u.role === "subcontractor"); upd("users", su.id, { email: f.subEmail }); const cu = S.users.find(u => u.role === "client"); upd("users", cu.id, { email: f.clientEmail }); alert("Saved"); },
};
document.addEventListener("click", async e => { const b = e.target.closest("[data-act]"); if (!b) return; e.preventDefault(); b.disabled = true;
  try { await ACT[b.dataset.act](b.dataset); } catch (err) { alert(err.message); } render(); });
document.addEventListener("submit", async e => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault();
  try { await FORM[f.dataset.form](Object.fromEntries(new FormData(f))); } catch (err) { alert(err.message); } render(); });
window.addEventListener("hashchange", render);

(async () => {
  idb = await openDb(); await loadAll(); if (!S.projects.length) seed();
  const cfg = S.meta.find(m => m.id == 2); if (cfg) Object.assign(CFG, cfg.v);
  const ses = S.meta.find(m => m.id == 3); if (ses && ses.uid) ME = S.users.find(u => u.id == ses.uid) || null;
  try { ST = await (await fetch("/api/status")).json(); } catch (e) {}
  render();
})();
