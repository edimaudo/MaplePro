import os, datetime as dt
DB = "/tmp/maplepro_test.db"
if os.path.exists(DB): os.remove(DB)
os.environ["MAPLEPRO_DB"] = DB
for k in ("GEMINI_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"): os.environ.pop(k, None)
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import agents, sched

def as_user(email, pw="maple123"):
    t = TestClient(app); t.post("/login", data={"email": email, "password": pw}); return t

@pytest.fixture(scope="module")
def admin():
    with TestClient(app) as t:  # starts lifespan (seeds DB)
        pass
    return as_user("admin@maplepro.test")

def test_critical_path_and_slip():
    s = dt.date.today().isoformat()
    ts = [dict(id=1, days=5, pred=None, slip=0, start=s, progress=0, wx=0, name="a"), dict(id=2, days=3, pred=1, slip=2, start=s, progress=0, wx=0, name="b")]
    p = sched.plan(ts)
    assert p["slip"] == 2 and all(t["critical"] for t in p["tasks"])

def test_grounding_rejects_invented_numbers():
    assert agents.grounded("Invoice 12 is $5,000 late", ["12", "$5,000"])
    assert not agents.grounded("Invoice 12 is $9,999 late", ["12", "$5,000"])

def test_normalize_handles_bad_llm_output():
    o = agents.normalize({"delays": "oops", "delay_days": -3, "work_completed": [1, "ok"]}, "gemini")
    assert o["delays"] == [] and o["delay_days"] is None and o["work_completed"] == ["ok"]

def test_login_required_and_wrong_password(admin):
    assert TestClient(app).get("/finance", follow_redirects=False).status_code == 303
    assert as_user("admin@maplepro.test", "nope").get("/finance", follow_redirects=False).status_code == 303

def test_client_and_sub_are_scoped(admin):
    client, sub = as_user("client@example.com"), as_user("sub@maplepro.test")
    for t in (client, sub):
        assert t.get("/finance").status_code == 403 and t.get("/approvals").status_code == 403 and t.get("/projects/1").status_code == 403
    assert "INV-2026-009" not in client.get("/").text  # belongs to another client
    assert client.get("/ask?q=overdue invoices").status_code == 200
    assert sub.post("/timesheets", data={"project_id": 3, "work_date": "2026-01-01", "hours": 4}).status_code == 403

def test_staff_limit_and_event_chain(admin):
    pm = as_user("pm@maplepro.test")
    pm.post("/projects/1/report", data={"raw": "Framing complete. Rain caused a 3 day delay to Framing. 10 overtime hours."})
    page = pm.get("/projects/1").text
    assert "slips 3 days" in page and "extra labor hours add $650" in page
    pm.post("/projects/1/report", data={"raw": "Foundation is complete. Crew of 8."})
    assert pm.post("/actions/1/approve").status_code == 403  # milestone invoice > staff limit
    assert admin.post("/actions/1/approve").status_code == 200

def test_payment_triggers_payout_with_holdback(admin):
    sub = as_user("sub@maplepro.test")
    admin.post("/invoices/1/simulate-paid")
    page = admin.get("/approvals").text
    assert "Pay Sam Subcontractor for 76 approved hours" in page
    pid = [a for a in agents.rows(__import__("app.db", fromlist=["x"]).conn(), "select id from actions where kind='payout'")][0]["id"]
    admin.post(f"/actions/{pid}/approve")
    assert "paid" in sub.get("/").text

def test_webhook_rejects_unsigned_then_dedupes(admin, monkeypatch):
    ev = {"id": "WH-1", "event_type": "INVOICING.INVOICE.PAID", "resource": {}}
    assert TestClient(app).post("/webhooks/paypal", json=ev).status_code == 400
    monkeypatch.setenv("ALLOW_UNSIGNED_WEBHOOKS", "1")
    c = TestClient(app)
    assert c.post("/webhooks/paypal", json=ev).json()["status"] == "ok"
    assert c.post("/webhooks/paypal", json=ev).json()["status"] == "duplicate"
