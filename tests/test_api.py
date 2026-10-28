import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import parse_database_url
from app.main import app

try:
    parse_database_url(settings.database_url)
    _SUPABASE_DB_CONFIGURED = True
except RuntimeError:
    _SUPABASE_DB_CONFIGURED = False

pytestmark = pytest.mark.skipif(
    not _SUPABASE_DB_CONFIGURED,
    reason="API integration tests require DATABASE_URL pointing to a configured Supabase PostgreSQL project.",
)


DEMO_PASSWORD = "MaplePro2026!"


def _login(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_dashboard_requires_authentication():
    with TestClient(app) as client:
        response = client.get("/api/dashboard")
        assert response.status_code == 401


def test_demo_personas_are_scoped_to_their_records():
    with TestClient(app) as client:
        manager_token = _login(client, "manager@maplepro.demo")
        manager = client.get("/api/dashboard", headers={"Authorization": f"Bearer {manager_token}"})
        assert manager.status_code == 200
        assert len(manager.json()["projects"]) == 8
        assert len(manager.json()["invoices"]) >= 32

        client_token = _login(client, "client@maplepro.demo")
        client_dashboard = client.get("/api/dashboard", headers={"Authorization": f"Bearer {client_token}"})
        assert client_dashboard.status_code == 200
        client_data = client_dashboard.json()
        assert len(client_data["projects"]) == 2
        assert all(p["client_email"] == "client@maplepro.demo" for p in client_data["projects"])
        assert all(i["invoice_type"] == "client_invoice" for i in client_data["invoices"])
        assert all(i["recipient_email"] == "client@maplepro.demo" for i in client_data["invoices"])

        trade_token = _login(client, "subcontractor@maplepro.demo")
        trade_dashboard = client.get("/api/dashboard", headers={"Authorization": f"Bearer {trade_token}"})
        assert trade_dashboard.status_code == 200
        trade_data = trade_dashboard.json()
        assert len(trade_data["projects"]) == 2
        assert {p["id"] for p in trade_data["projects"]} == {"prj-northstar", "prj-lakeshore"}
        assert all(i["invoice_type"] == "subcontractor_invoice" for i in trade_data["invoices"])
        assert all(i["recipient_email"] == "subcontractor@maplepro.demo" for i in trade_data["invoices"])


def test_non_manager_roles_cannot_create_or_remind_invoices():
    with TestClient(app) as client:
        client_token = _login(client, "client@maplepro.demo")
        client_headers = {"Authorization": f"Bearer {client_token}"}
        create = client.post(
            "/api/invoices",
            headers=client_headers,
            json={
                "project_id": "prj-northstar",
                "recipient_name": "Northstar Properties",
                "recipient_email": "client@maplepro.demo",
                "description": "Progress billing",
                "amount": 5000,
                "currency_code": "CAD",
                "due_in_days": 30,
            },
        )
        assert create.status_code == 403
        remind = client.post("/api/invoices/inv-prj-northstar-1/remind", headers=client_headers)
        assert remind.status_code == 403

        trade_token = _login(client, "subcontractor@maplepro.demo")
        trade_headers = {"Authorization": f"Bearer {trade_token}"}
        create_as_trade = client.post(
            "/api/invoices",
            headers=trade_headers,
            json={
                "project_id": "prj-northstar",
                "recipient_name": "Trade Services",
                "recipient_email": "subcontractor@maplepro.demo",
                "description": "Trade claim",
                "amount": 1000,
            },
        )
        assert create_as_trade.status_code == 403


def test_intelligence_falls_back_without_gemini_key(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")
    with TestClient(app) as client:
        token = _login(client, "manager@maplepro.demo")
        response = client.post("/api/intelligence/refresh", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        data = response.json()
        assert data["mode"] == "rules_fallback"
        assert data["ai_generated"] is False
        assert data["insights"]
        assert "Gemini is not connected" in data["notice"]
