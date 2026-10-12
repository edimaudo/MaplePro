import os
for k in ("GEMINI_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ACCESS_CODE"): os.environ.pop(k, None)
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)

def test_status_and_static():
    assert c.get("/api/status").json() == {"paypal": False, "gemini": False, "access_required": False}
    assert "MaplePro" in c.get("/").text and c.get("/app.js").status_code == 200 and c.get("/engine.js").status_code == 200

def test_gemini_without_key_returns_none():
    assert c.post("/api/gemini", json={"prompt": "hi"}).json() == {"result": None}

def test_paypal_mock_flows():
    inv = c.post("/api/paypal/invoice", json={"number": "INV-1", "email": "a@b.co", "items": [["Work", 100]], "note": "n", "rid": "r1"}).json()
    assert inv["id"] == "MOCK-INV-1"
    assert c.post("/api/paypal/remind", json={"id": inv["id"], "subject": "s", "note": "n"}).status_code == 200
    assert c.post("/api/paypal/payout", json={"batch_id": "b1", "items": [["i1", "s@b.co", 50]], "note": "n"}).json()["mock"] is True
    assert c.post("/api/paypal/balance", json={}).json() == {"balance": None}

def test_validation_and_limits():
    assert c.post("/api/paypal/payout", json={"batch_id": "b", "items": [["i", "s@b.co", -5]]}).status_code == 400
    assert c.post("/api/paypal/payout", json={"batch_id": "b", "items": [["i", "s@b.co", 999999]]}).status_code == 400
    assert c.post("/api/paypal/invoice", json={"number": "x"}).status_code == 400
    assert c.post("/api/paypal/nope", json={}).status_code == 404

def test_access_code(monkeypatch):
    monkeypatch.setenv("ACCESS_CODE", "s3cret")
    assert c.post("/api/paypal/balance", json={}).status_code == 401
    assert c.post("/api/paypal/balance", json={}, headers={"x-access-code": "s3cret"}).status_code == 200
