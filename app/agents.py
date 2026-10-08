"""Agents: LLM (Gemini) explains/extracts/drafts; deterministic code does every number."""
import os, re, json, logging, contextvars, datetime as dt, httpx
SCOPE = contextvars.ContextVar('scope', default=None)  # client_id when a client is logged in
log = logging.getLogger("maplepro")
money = lambda v: f"${v:,.0f}"

def rows(c, q, *a): return [dict(r) for r in c.execute(q, a)]

def gemini_json(prompt: str):
    key = os.getenv("GEMINI_API_KEY")
    if not key: return None
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    try:
        r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                       headers={"x-goog-api-key": key},
                       json={"contents": [{"parts": [{"text": prompt}]}],
                             "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}},
                       timeout=30)
        r.raise_for_status()
        return json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
    except Exception as e:
        log.warning("Gemini call failed, using fallback: %s", e); return None

def grounded(text: str, facts: list) -> bool:
    """Reject LLM copy containing any number that is not in the supplied facts."""
    nums = lambda s: {n.replace(",", "").strip(".") for n in re.findall(r"\d[\d,]*\.?\d*", s)}
    return nums(text) <= nums(" ".join(map(str, facts)))

# ---- Site Agent: field note -> structured report ---------------------------------
def site_agent(raw: str, project: dict) -> dict:
    prompt = ("You are a construction site clerk. Convert the field note into JSON with keys: "
              "work_completed (string[]), crew_count (int|null), delays ([{cause:string,tasks_affected:string[],delay_days:int|null (only if the note states it)}]), "
              "risks (string[]), materials (string[]), milestone_complete (bool), milestone_name (string|null), "
              "follow_up_question (string|null: ask if key info is missing, never guess), "
              "delay_days (int|null, only if the note states a number of days), extra_hours (int|null, only if stated). "
              f"Project: {project['name']}. Note: {raw}")
    out = gemini_json(prompt)
    if isinstance(out, dict): return normalize(out, "gemini")
    low = raw.lower()  # keyword fallback so the app works offline
    delay = any(k in low for k in ("delay", "rebuilt", "failed", "rain", "shortage", "late"))
    m = re.search(r"(\w[\w ]{2,30}?) (?:is |was |are )?(?:complete|finished|done)", raw, re.I)
    dd = re.search(r"(\d+)[- ]days?", raw); xh = re.search(r"(\d+)\s*(?:extra |overtime )?hours", raw, re.I)
    tasks = [w for w in re.findall(r"\b(framing|foundation|roofing|drywall|excavation|facade|demolition|slab|steel)\b", low)]
    return normalize({"work_completed": [s.strip() for s in re.split(r"[.\n]", raw) if s.strip()][:4], "crew_count": None,
            "delays": [{"cause": raw[:120], "tasks_affected": tasks[:2]}] if delay else [],
            "risks": ["Possible schedule impact"] if delay else [], "materials": [],
            "milestone_complete": bool(m) and not delay, "milestone_name": m.group(1).strip().capitalize() if m else None,
            "follow_up_question": ("How many days did this set the schedule back?" if delay and not dd
                                   else None if re.search(r"\d", raw) else "How many crew were on site?"),
            "delay_days": int(dd.group(1)) if dd and delay else None, "extra_hours": int(xh.group(1)) if xh else None}, "fallback")

def normalize(o: dict, source: str) -> dict:
    """Validate LLM output shape so downstream code never trips on missing or wrong-typed keys."""
    lst = lambda k: [x for x in (o.get(k) or []) if isinstance(x, str)] if isinstance(o.get(k), list) else []
    num = lambda k: int(o[k]) if isinstance(o.get(k), (int, float)) and not isinstance(o.get(k), bool) and o[k] >= 0 else None
    delays = [{"cause": str(d.get("cause", "")), "tasks_affected": [x for x in d.get("tasks_affected", []) if isinstance(x, str)]}
              for d in (o.get("delays") or []) if isinstance(d, dict)]
    return {"source": source, "work_completed": lst("work_completed"), "crew_count": num("crew_count"), "delays": delays,
            "risks": lst("risks"), "materials": lst("materials"), "milestone_complete": bool(o.get("milestone_complete")),
            "milestone_name": o.get("milestone_name") if isinstance(o.get("milestone_name"), str) else None,
            "follow_up_question": o.get("follow_up_question") if isinstance(o.get("follow_up_question"), str) else None,
            "delay_days": num("delay_days"), "extra_hours": num("extra_hours")}

# ---- Billing Agent ------------------------------------------------------------------
def pay_prob(days_over: int, amount: float) -> int:
    return 92 if days_over <= 0 else max(5, round(88 - 1.6 * days_over - amount / 60000))

def invoices(c):
    out = []
    for r in rows(c, """select i.*, cl.name client, cl.email, p.name project from invoices i
                        join clients cl on cl.id=i.client_id join projects p on p.id=i.project_id
                        where i.status not in ('paid','cancelled','refunded') {sc} order by due_date""".format(sc="and i.client_id=%d" % SCOPE.get() if SCOPE.get() else "")):
        r["days_over"] = max((dt.date.today() - dt.date.fromisoformat(r["due_date"])).days, 0)
        r["prob"] = pay_prob(r["days_over"], r["amount"])
        r["risk"] = "high" if r["days_over"] > 10 else "healthy"
        out.append(r)
    return out

def draft_reminder(inv: dict) -> dict:
    facts = [inv["number"], money(inv["amount"]), inv["days_over"], inv["project"]]
    tone = "firm but friendly" if inv["days_over"] >= 14 else "warm and friendly"
    tpl = {"subject": f"Reminder: invoice {inv['number']}",
           "note": f"Hi, invoice {inv['number']} for {money(inv['amount'])} on {inv['project']} is {inv['days_over']} days past due. "
                   "Please let us know if anything is blocking payment."}
    out = gemini_json(f"Write a payment reminder, tone {tone}, 2 sentences. Use ONLY these facts and no other numbers: "
                      f"{facts}. Return JSON {{subject, note}}.")
    if isinstance(out, dict) and out.get("note") and grounded(out["subject"] + " " + out["note"], facts):
        return {**out, "source": "gemini"}
    return {**tpl, "source": "template"}

# ---- Overview / Intelligence Stream -----------------------------------------------
def overview(c):
    invs = invoices(c); od = [i for i in invs if i["days_over"] > 0]
    projs = rows(c, "select p.*, cl.name client from projects p join clients cl on cl.id=p.client_id where status='active'" + (" and p.client_id=%d" % SCOPE.get() if SCOPE.get() else ""))
    stream, week = [], []
    for p in projs:
        p["burn"] = round(p["spent"] / p["budget"] * 100); p["gap"] = p["burn"] - p["progress"]
        p["health"] = "watch" if p["gap"] >= 8 else "on track"
        last = c.execute("select max(created) m from reports where project_id=?", (p["id"],)).fetchone()["m"]
        if not last: week.append(f"Submit a daily report for {p['name']}")
        if p["gap"] >= 8:
            stream.append({"agent": "Budget", "level": "warn", "conf": min(95, 55 + p["gap"] * 2),
                           "text": f"{p['name']}: {p['burn']}% of budget spent against {p['progress']}% progress."})
    total = sum(i["amount"] for i in od)
    if od: stream.insert(0, {"agent": "Billing", "level": "urgent", "conf": 90,
                             "text": f"{len(od)} invoices overdue, {money(total)} outstanding."})
    week += [f"{i['number']} due in {-i['days_over']} days" for i in invs if i["days_over"] == 0 and i["due_date"] > dt.date.today().isoformat()]
    pend = c.execute("select count(*) n from actions where status='pending'").fetchone()["n"]
    return {"projects": projs, "overdue": od, "overdue_total": total, "stream": stream,
            "urgent": [i for i in od if i["days_over"] >= 14], "today_n": pend, "week": week,
            "contract": sum(p["budget"] for p in projs), "spent": sum(p["spent"] for p in projs)}
