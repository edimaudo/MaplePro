import json, os, csv, io, html, sqlite3, datetime as dt
import httpx
from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.responses import RedirectResponse, Response, HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from . import db, agents, paypal, sched

STAFF_LIMIT = lambda: float(os.getenv("STAFF_APPROVAL_LIMIT", "50000"))
AUTO = lambda: set(os.getenv("AUTO_KINDS", "remind").split(","))  # low-stakes kinds that run without approval
RATE = lambda: float(os.getenv("LABOR_RATE", "65"))
HOLDBACK = 0.10  # default holdback; verify statutory rules before relying on it

@asynccontextmanager
async def lifespan(app):
    if db.STORAGE != "browser": db.conn().close()
    yield
app = FastAPI(title="MaplePro", lifespan=lifespan)
_secret = os.getenv("SECRET_KEY")
if not _secret and (paypal.live() or os.getenv("VERCEL")): raise RuntimeError("Set SECRET_KEY")
app.add_middleware(SessionMiddleware, secret_key=_secret or "dev-only-secret", same_site="lax",
                   https_only=os.getenv("COOKIE_SECURE") == "1")
T = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
T.env.filters["money"] = lambda v: f"${v:,.0f}" if v is not None else "-"
now = lambda: dt.datetime.now().isoformat(timespec="seconds")
go = lambda url: RedirectResponse(url, status_code=303)
def page(req, name, u, **ctx): return T.TemplateResponse(req, name, {"live": paypal.live(), "u": u, "storage": db.STORAGE, **ctx})

# ---- auth & scoping -------------------------------------------------------------
class Login(Exception): pass
@app.exception_handler(Login)
async def _login(req, exc): return go("/login")

def me(req):
    uid = req.session.get("uid")
    if uid:
        c = db.conn(); r = c.execute("select * from users where id=?", (uid,)).fetchone(); c.close()
        if r: return dict(r)
    raise Login()

def need(u, *roles):
    if u["role"] not in roles: raise HTTPException(403, "Not allowed for your role")

def pids(c, u):
    if u["role"] in ("admin", "staff"): q, a = "select id from projects", ()
    elif u["role"] == "client": q, a = "select id from projects where client_id=?", (u["client_id"],)
    else: q, a = "select project_id id from members where user_id=?", (u["id"],)
    return [r["id"] for r in c.execute(q, a)]

@app.get("/login")
def login_form(req: Request): return T.TemplateResponse(req, "login.html", {"error": None, "u": None, "live": paypal.live(), "storage": db.STORAGE})

@app.post("/login")
def login(req: Request, email: str = Form(...), password: str = Form(...)):
    c = db.conn(); r = c.execute("select * from users where email=?", (email.strip().lower(),)).fetchone(); c.close()
    if not r or not db.check_pw(password, r["pw"]):
        return T.TemplateResponse(req, "login.html", {"error": "Email or password is incorrect.", "u": None, "live": paypal.live(), "storage": db.STORAGE}, status_code=401)
    req.session.clear(); req.session["uid"] = r["id"]; return go("/")

@app.post("/logout")
def logout(req: Request): req.session.clear(); return go("/login")

# ---- action helpers -----------------------------------------------------------------
def acts(c, where="1=1", *a):
    out = agents.rows(c, f"select * from actions where {where} order by id desc", *a)
    for x in out: x["p"] = json.loads(x["payload"])
    return out

def log_action(c, agent, kind, ref, title, why, payload):
    i = c.execute("insert into actions(agent,kind,ref_id,title,rationale,payload,created) values(?,?,?,?,?,?,?)",
                  (agent, kind, ref, title, why, json.dumps(payload), now())).lastrowid
    return acts(c, "id=?", i)[0]

def release(c, payout_id, status):  # free timesheets so a failed or rejected payout can be re-proposed
    c.execute("update payouts set status=? where id=?", (status, payout_id))
    c.execute("update timesheets set payout_id=null, status='approved' where payout_id=?", (payout_id,))

def execute(c, a):
    rid, p = f"maplepro-action-{a['id']}", a["p"]
    if a["kind"] == "remind":
        inv = agents.rows(c, "select i.*, cl.email from invoices i join clients cl on cl.id=i.client_id where i.id=?", a["ref_id"])[0]
        if inv["paypal_id"]: return paypal.remind(inv["paypal_id"], p["subject"], p["note"], rid)
        res = paypal.create_and_send(inv["number"], inv["email"], [(f"Invoice {inv['number']}", inv["amount"])], p["note"], rid)
        c.execute("update invoices set paypal_id=? where id=?", (res["id"], inv["id"])); return res
    if a["kind"] == "create_invoice":
        pr = agents.rows(c, "select p.*, cl.email from projects p join clients cl on cl.id=p.client_id where p.id=?", a["ref_id"])[0]
        n = c.execute("select coalesce(max(id),0)+100 n from invoices").fetchone()["n"]; number = f"INV-{dt.date.today().year}-{n:03d}"
        res = paypal.create_and_send(number, pr["email"], [(f"{p['milestone']} (net of {HOLDBACK:.0%} holdback)", p["amount"])], f"Progress billing: {p['milestone']}", rid)
        c.execute("insert into invoices(number,project_id,client_id,amount,due_date,status,paypal_id) values(?,?,?,?,?,?,?)",
                  (number, pr["id"], pr["client_id"], p["amount"], (dt.date.today() + dt.timedelta(days=30)).isoformat(), "sent", res["id"])); return res
    if a["kind"] == "payout":
        po = agents.rows(c, "select * from payouts where id=?", p["payout_id"])[0]
        bal = paypal.balance()
        if bal is not None and po["amount"] > bal: raise ValueError(f"Insufficient PayPal balance ({bal:,.2f})")
        email = c.execute("select email from users where id=?", (po["user_id"],)).fetchone()["email"]
        res = paypal.payout(f"maplepro-payout-{po['id']}", [(f"payout-{po['id']}", email, po["amount"])], "Subcontractor payment")
        st = "paid" if res.get("mock") else "processing"
        c.execute("update payouts set status=?, batch_id=? where id=?", (st, res["batch"], po["id"]))
        if st == "paid": c.execute("update timesheets set status='paid' where payout_id=?", (po["id"],))
        return res
    raise ValueError("unknown action")

def run(c, a, by):
    try: res = {"by": by, **execute(c, a)}; st = "executed"
    except Exception as e:
        res, st = {"by": by, "error": str(e)}, "failed"
        if a["kind"] == "payout": release(c, a["p"]["payout_id"], "failed")
    c.execute("update actions set status=?, result=?, decided=? where id=?", (st, json.dumps(res), now(), a["id"]))

def on_paid(c, inv_id):
    """Client payment landed -> Billing Agent proposes payouts for approved timesheets (holdback applied)."""
    pid = c.execute("select project_id from invoices where id=?", (inv_id,)).fetchone()["project_id"]
    for r in agents.rows(c, "select user_id, sum(hours*rate) gross, sum(hours) h from timesheets where project_id=? and status='approved' and payout_id is null group by user_id", pid):
        hold = round(r["gross"] * HOLDBACK, 2); net = round(r["gross"] - hold, 2)
        poid = c.execute("insert into payouts(project_id,user_id,amount,holdback,status) values(?,?,?,?,'proposed')", (pid, r["user_id"], net, hold)).lastrowid
        c.execute("update timesheets set payout_id=?, status='in_payout' where project_id=? and user_id=? and status='approved' and payout_id is null", (poid, pid, r["user_id"]))
        who = c.execute("select name from users where id=?", (r["user_id"],)).fetchone()["name"]
        log_action(c, "Billing", "payout", pid, f"Pay {who} for {r['h']:g} approved hours",
                   f"Client payment received. {r['h']:g} approved hours, gross {agents.money(r['gross'])}, holdback {agents.money(hold)}, net {agents.money(net)}.",
                   {"payout_id": poid, "amount": net, "holdback": hold})

# ---- staff pages -------------------------------------------------------------------
@app.get("/")
def home(req: Request):
    u = me(req); c = db.conn()
    if u["role"] in ("admin", "staff"):
        ctx = agents.overview(c); ctx["pending"] = acts(c, "status='pending'"); r = page(req, "command.html", u, **ctx)
    else:
        ids = pids(c, u); q = ",".join("?" * len(ids)) or "null"
        ctx = {"projects": agents.rows(c, f"select * from projects where id in ({q})", *ids)}
        if u["role"] == "client": ctx["invoices"] = agents.rows(c, "select i.*, p.name project from invoices i join projects p on p.id=i.project_id where i.client_id=?", u["client_id"])
        else:
            ctx["timesheets"] = agents.rows(c, "select t.*, p.name project from timesheets t join projects p on p.id=t.project_id where user_id=? order by id desc", u["id"])
            ctx["payouts"] = agents.rows(c, "select * from payouts where user_id=? order by id desc", u["id"])
        r = page(req, "portal.html", u, **ctx)
    c.close(); return r

@app.get("/finance")
def finance(req: Request):
    u = me(req); need(u, "admin", "staff"); c = db.conn(); invs = agents.invoices(c); pend = acts(c, "status='pending'"); c.close()
    od = [i for i in invs if i["days_over"] > 0]
    return page(req, "finance.html", u, invs=invs, high=[i for i in od if i["risk"] == "high"], healthy=[i for i in invs if i["days_over"] == 0], total=sum(i["amount"] for i in od), pending=pend)

@app.get("/approvals")
def approvals(req: Request):
    u = me(req); need(u, "admin", "staff"); c = db.conn(); a = acts(c); c.close()
    return page(req, "approvals.html", u, pending=[x for x in a if x["status"] == "pending"], history=[x for x in a if x["status"] != "pending"], limit=STAFF_LIMIT())

@app.get("/audit.csv")
def audit(req: Request):
    u = me(req); need(u, "admin"); c = db.conn(); b = io.StringIO(); w = csv.writer(b)
    w.writerow(["id", "created", "agent", "kind", "title", "rationale", "status", "result", "decided"])
    for r in c.execute("select id,created,agent,kind,title,rationale,status,result,decided from actions order by id"): w.writerow(list(r))
    c.close(); return Response(b.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=audit.csv"})

@app.get("/projects/{pid}")
def project(req: Request, pid: int):
    u = me(req); need(u, "admin", "staff"); c = db.conn()
    p = agents.rows(c, "select p.*, cl.name client from projects p join clients cl on cl.id=p.client_id where p.id=?", pid)
    if not p: raise HTTPException(404)
    reps = agents.rows(c, "select * from reports where project_id=? order by id desc", pid)
    for r in reps: r["s"] = json.loads(r["structured"])
    pl = sched.plan(agents.rows(c, "select * from tasks where project_id=? order by id", pid))
    lines = sched.variance(agents.rows(c, "select * from budget_lines where project_id=?", pid))
    delays = [d["cause"] for r in reps[:3] for d in r["s"]["delays"]]
    ctx = dict(p=p[0], reports=reps, pl=pl, wx=sched.wx_risks(pl["tasks"], sched.weather()), lines=lines, why=sched.explain(lines, delays))
    c.close(); return page(req, "project.html", u, **ctx)

@app.post("/projects/{pid}/report")
def add_report(req: Request, pid: int, raw: str = Form(..., max_length=4000)):
    u = me(req); need(u, "admin", "staff"); c = db.conn(); p = agents.rows(c, "select * from projects where id=?", pid)[0]
    s = agents.site_agent(raw, p); s["impacts"] = []
    if s["delay_days"] and s["delays"]:  # event chain: Site -> Schedule
        tasks = agents.rows(c, "select * from tasks where project_id=? and progress<100 order by id", pid)
        hit = next((t for t in tasks if any(t["name"].lower() in x.lower() or x.lower() in t["name"].lower() for d in s["delays"] for x in d["tasks_affected"])), tasks[0] if tasks else None)
        if hit:
            c.execute("update tasks set slip=slip+? where id=?", (s["delay_days"], hit["id"]))
            s["impacts"].append(f"Schedule: {hit['name']} slips {s['delay_days']} days; finish date recalculated.")
    if s["extra_hours"]:  # Site -> Budget (cost computed by code)
        cost = round(s["extra_hours"] * RATE(), 2)
        c.execute("update budget_lines set actual=actual+? where project_id=? and category='labor'", (cost, pid))
        c.execute("update projects set spent=spent+? where id=?", (cost, pid))
        s["impacts"].append(f"Budget: {s['extra_hours']} extra labor hours add {agents.money(cost)}.")
    c.execute("insert into reports(project_id,raw,structured,created) values(?,?,?,?)", (pid, raw, json.dumps(s), now()))
    if s["milestone_complete"] and s["milestone_name"]:  # Site -> Billing
        gross = round(p["budget"] * 0.08); hold = round(gross * HOLDBACK)
        log_action(c, "Billing", "create_invoice", pid, f"Invoice milestone: {s['milestone_name']}",
                   f"Site Agent reported '{s['milestone_name']}' complete. Milestone billing {agents.money(gross)} less {HOLDBACK:.0%} holdback {agents.money(hold)} = {agents.money(gross - hold)}.",
                   {"milestone": s["milestone_name"], "amount": gross - hold, "holdback": hold})
    c.commit(); c.close(); return go(f"/projects/{pid}")

@app.post("/invoices/{iid}/draft")
def draft(req: Request, iid: int):
    u = me(req); need(u, "admin", "staff"); c = db.conn(); inv = next(i for i in agents.invoices(c) if i["id"] == iid)
    d = agents.draft_reminder(inv)
    a = log_action(c, "Billing", "remind", iid, f"Send reminder for {inv['number']}",
                   f"{inv['days_over']} days overdue, estimated payment probability {inv['prob']}% (heuristic). Draft by {d['source']}.", {"subject": d["subject"], "note": d["note"]})
    if "remind" in AUTO(): run(c, a, "auto (low-stakes tier)")
    c.commit(); c.close(); return go("/approvals")

@app.post("/actions/{aid}/{decision}")
def decide(req: Request, aid: int, decision: str):
    u = me(req); need(u, "admin", "staff"); c = db.conn(); r = acts(c, "id=?", aid)
    if not r: raise HTTPException(404)
    a = r[0]
    if a["status"] != "pending" or decision not in ("approve", "reject"): return go("/approvals")
    if decision == "approve" and u["role"] == "staff" and a["p"].get("amount", 0) > STAFF_LIMIT():
        raise HTTPException(403, f"Over the {agents.money(STAFF_LIMIT())} staff limit: an admin must approve")
    if decision == "approve": run(c, a, u["email"])
    else:
        if a["kind"] == "payout": release(c, a["p"]["payout_id"], "rejected")
        c.execute("update actions set status='rejected', result=?, decided=? where id=?", (json.dumps({"by": u["email"]}), now(), aid))
    c.commit(); c.close(); return go("/approvals")

@app.post("/invoices/{iid}/simulate-paid")  # mock mode only: stands in for the PayPal webhook
def simulate_paid(req: Request, iid: int):
    u = me(req); need(u, "admin", "staff")
    if paypal.live(): raise HTTPException(403, "Use the PayPal sandbox to pay")
    c = db.conn(); c.execute("update invoices set status='paid' where id=?", (iid,)); on_paid(c, iid); c.commit(); c.close(); return go("/approvals")

# ---- timesheets --------------------------------------------------------------------------
@app.get("/timesheets")
def timesheets(req: Request):
    u = me(req); need(u, "admin", "staff"); c = db.conn()
    rows = agents.rows(c, "select t.*, p.name project, u.name who from timesheets t join projects p on p.id=t.project_id join users u on u.id=t.user_id order by t.id desc"); c.close()
    return page(req, "timesheets.html", u, rows=rows)

@app.post("/timesheets")
def add_timesheet(req: Request, project_id: int = Form(...), work_date: str = Form(...), hours: float = Form(..., gt=0, le=24)):
    u = me(req); need(u, "subcontractor"); c = db.conn()
    if project_id not in pids(c, u): raise HTTPException(403, "Not assigned to this project")
    c.execute("insert into timesheets(project_id,user_id,work_date,hours,rate) values(?,?,?,?,?)", (project_id, u["id"], dt.date.fromisoformat(work_date).isoformat(), hours, RATE()))
    c.commit(); c.close(); return go("/")

@app.post("/timesheets/{tid}/approve")
def approve_ts(req: Request, tid: int):
    u = me(req); need(u, "admin", "staff"); c = db.conn()
    c.execute("update timesheets set status='approved' where id=? and status='submitted'", (tid,)); c.commit(); c.close(); return go("/timesheets")

# ---- command bar ---------------------------------------------------------------------------
@app.get("/ask")
def ask(req: Request, q: str = ""):
    u = me(req); c = db.conn(); ids = pids(c, u); staff = u["role"] in ("admin", "staff")
    route = agents.gemini_json("Pick one tool for this construction question. Tools: overdue, at_risk, approvals, payouts, schedule. "
                               f"Return JSON {{\"tool\": string}}. Question: {q}") or {}
    tool = route.get("tool") if route.get("tool") in ("overdue", "at_risk", "approvals", "payouts", "schedule") else next(
        (t for k, t in (("overdue", "overdue"), ("owe", "overdue"), ("invoice", "overdue"), ("risk", "at_risk"), ("budget", "at_risk"), ("approv", "approvals"),
                        ("wait", "approvals"), ("payout", "payouts"), ("pay", "payouts"), ("schedule", "schedule"), ("delay", "schedule")) if k in q.lower()), None)
    title, lines = "I can answer questions about overdue invoices, at-risk projects, approvals, payouts and schedule.", []
    if tool == "overdue" and u["role"] in ("admin", "staff", "client"):
        title = "Overdue invoices"
        lines = [(f"{i['number']}: {agents.money(i['amount'])}, {i['days_over']} days overdue ({i['client']})", "/finance" if staff else "/") for i in agents.invoices(c) if i["days_over"] > 0 and i["project_id"] in ids]
    elif tool == "at_risk" and staff:
        title = "Projects where spend is ahead of progress"
        lines = [(f"{p['name']}: {p['burn']}% of budget used, {p['progress']}% complete", f"/projects/{p['id']}") for p in agents.overview(c)["projects"] if p["gap"] >= 8]
    elif tool == "approvals" and staff:
        title = "Waiting for approval"; lines = [(a["title"], "/approvals") for a in acts(c, "status='pending'")]
    elif tool == "payouts" and u["role"] != "client":
        title = "Payouts"; qy = "select * from payouts" + ("" if staff else f" where user_id={int(u['id'])}")
        lines = [(f"{agents.money(r['amount'])} ({r['status']}), holdback {agents.money(r['holdback'])}", "/approvals" if staff else "/") for r in agents.rows(c, qy)]
    elif tool == "schedule" and staff:
        title = "Schedule forecast"
        for pid in ids:
            pl = sched.plan(agents.rows(c, "select * from tasks where project_id=?", pid))
            if pl["finish"]: lines.append((f"Project {pid}: forecast finish {pl['finish']}, {pl['slip']} days behind baseline", f"/projects/{pid}"))
    elif tool: title = "That information isn't available for your role."
    c.close(); return page(req, "ask.html", u, q=q, title=title, lines=lines)

# ---- webhooks ------------------------------------------------------------------------------
INV = {"INVOICING.INVOICE.PAID": "paid", "INVOICING.INVOICE.CANCELLED": "cancelled", "INVOICING.INVOICE.REFUNDED": "refunded"}
PAY_OK = {"PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTSBATCH.SUCCESS"}
PAY_BAD = {"PAYMENT.PAYOUTS-ITEM.FAILED", "PAYMENT.PAYOUTS-ITEM.RETURNED", "PAYMENT.PAYOUTS-ITEM.BLOCKED", "PAYMENT.PAYOUTS-ITEM.DENIED", "PAYMENT.PAYOUTSBATCH.DENIED"}

@app.post("/webhooks/paypal")
async def webhook(req: Request):
    if db.STORAGE == "browser": raise HTTPException(503, "Webhooks need DATABASE_URL; browser storage mode uses Sync payments")
    raw = await req.body(); ev = json.loads(raw)
    if not paypal.verify_webhook(req.headers, ev): raise HTTPException(400, "invalid signature")
    c = db.conn(); t = ev["event_type"]; res = ev.get("resource", {})
    try: c.execute("insert into webhook_events(event_id,type,payload,created) values(?,?,?,?)", (ev["id"], t, raw.decode(), now()))
    except db.IntegrityError: c.rollback(); c.close(); return {"status": "duplicate"}  # PayPal retries are safe
    if t in INV:
        pid = (res.get("invoice") or res).get("id"); row = c.execute("select id,status from invoices where paypal_id=?", (pid,)).fetchone()
        if row and row["status"] != INV[t]:
            c.execute("update invoices set status=? where id=?", (INV[t], row["id"]))
            if t == "INVOICING.INVOICE.PAID": on_paid(c, row["id"])
    elif t in PAY_OK | PAY_BAD:
        batch = res.get("payout_batch_id") or res.get("batch_header", {}).get("payout_batch_id")
        for po in agents.rows(c, "select * from payouts where batch_id=? and status='processing'", batch):
            if t in PAY_OK: c.execute("update payouts set status='paid' where id=?", (po["id"],)); c.execute("update timesheets set status='paid' where payout_id=?", (po["id"],))
            else: release(c, po["id"], "failed")
    c.commit(); c.close(); return {"status": "ok"}

# ---- sync (polling; works without webhooks) -----------------------------------------------------
@app.post("/sync")
def sync(req: Request):
    u = me(req); need(u, "admin", "staff"); c = db.conn()
    for i in agents.rows(c, "select id, paypal_id from invoices where status='sent' and paypal_id is not null"):
        if i["paypal_id"].startswith("MOCK-"): continue
        try: st = paypal.invoice_status(i["paypal_id"])
        except Exception: continue
        if st:
            c.execute("update invoices set status=? where id=?", (st, i["id"]))
            if st == "paid": on_paid(c, i["id"])
    for po in agents.rows(c, "select id, batch_id from payouts where status='processing'"):
        try: st = paypal.payout_status(po["batch_id"])
        except Exception: continue
        if st == "paid": c.execute("update payouts set status='paid' where id=?", (po["id"],)); c.execute("update timesheets set status='paid' where payout_id=?", (po["id"],))
        elif st == "failed": release(c, po["id"], "failed")
    c.commit(); c.close(); return go("/finance")

# ---- browser storage mode: the browser keeps the data (localStorage); the server stays stateless -------
@app.middleware("http")
async def shell(req: Request, call_next):
    if db.STORAGE == "browser" and req.url.path not in ("/__rpc", "/__shim.js", "/webhooks/paypal") and not req.headers.get("x-mp-inner"):
        if req.method == "GET":
            return HTMLResponse('<!doctype html><html data-shell lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MaplePro</title></head>'
                                '<body><p style="font:14px sans-serif;padding:2rem">Loading...</p><script src="/__shim.js"></script></body></html>')
        return Response("Use the app interface", status_code=405)
    return await call_next(req)

@app.get("/__shim.js")
def shim(): return Response(open(os.path.join(os.path.dirname(__file__), "templates", "shim.js")).read(), media_type="text/javascript")

@app.post("/__rpc")
async def rpc(req: Request):
    """Run a normal app request against the state the browser sent, and return the HTML plus the new state."""
    if db.STORAGE != "browser": raise HTTPException(404)
    b = await req.json(); url = b.get("url", "")
    if not url.startswith("/") or url.startswith("//") or url.split("?")[0] in ("/__rpc", "/__shim.js") or url.startswith("/webhooks"): raise HTTPException(400, "bad url")
    text = b.get("state")
    if text and not db.verify(b.get("sig", ""), text): raise HTTPException(400, "Saved data failed verification")
    mem = db.mem_open(json.loads(text) if text else None); tok = db.MEM.set(db.Keep(mem))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://app") as cl:
            r = await cl.request(b.get("method", "GET"), url, data=b.get("form") or None, headers={"cookie": b.get("cookie", ""), "x-mp-inner": "1"})
        new = db.dump(mem)
    finally: db.MEM.reset(tok); mem.close()
    jar = dict(x.split("=", 1) for x in b.get("cookie", "").split("; ") if "=" in x)
    for sc in r.headers.get_list("set-cookie"): k, v = sc.split(";")[0].split("=", 1); jar[k] = v
    out = {"state": new, "sig": db.sign(new), "cookie": "; ".join(f"{k}={v}" for k, v in jar.items())}
    ct = r.headers.get("content-type", "")
    if r.status_code in (301, 302, 303, 307): out["location"] = r.headers["location"]
    elif r.status_code >= 400: out["html"] = f'<p style="font:14px sans-serif;padding:2rem">Error {r.status_code}: {html.escape(r.text[:300])} <a href="/" style="color:#1d4ed8">Home</a></p>'
    elif ct.startswith("text/html"): out["html"] = r.text
    else: out.update(text=r.text, ctype=ct, filename="audit.csv")
    return out
