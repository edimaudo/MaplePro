from __future__ import annotations

import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from .config import settings
from .database import check_schema, insert_one, one, rows, update_one
from .risk import analyze_project


@asynccontextmanager
async def lifespan(_app: FastAPI):
    check_schema()
    yield


app = FastAPI(title="MaplePro API", version="0.2.0", description="Construction project intelligence and PayPal workflow prototype", lifespan=lifespan)
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@dataclass
class Principal:
    user_id: str
    email: str
    name: str
    role: str
    firm_id: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class NewInvoiceRequest(BaseModel):
    project_id: str
    recipient_name: str = Field(min_length=2, max_length=200)
    recipient_email: EmailStr
    description: str = Field(min_length=3, max_length=500)
    amount: float = Field(gt=0, le=100_000_000)
    currency_code: str = Field(default="CAD", min_length=3, max_length=3)
    due_in_days: int = Field(default=30, ge=0, le=180)


_DEMO_PASSWORD = "MaplePro2026!"


def init_database() -> None:
    """Check Supabase tables and confirm the seeded demo account is visible."""
    check_schema()
    if settings.demo_mode and not one("profiles", filters=(("email", "admin@maplepro.demo"),), columns="id,email"):
        raise RuntimeError(
            "MaplePro demo data is not readable. Run scripts/seed_demo.py and ensure the server-side Supabase API key has access under RLS; a public anon key alone cannot read the demo tables."
        )


def _as_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _as_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _profile_principal(profile: dict[str, Any]) -> Principal:
    if not profile.get("active", True):
        raise HTTPException(status_code=403, detail="This account is disabled.")
    return Principal(
        user_id=str(profile["id"]), email=str(profile["email"]).lower(), name=profile["full_name"],
        role=profile["role"], firm_id=profile["firm_id"],
    )


def get_principal(authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    token = authorization.split(" ", 1)[1].strip()

    # Demo identities are accepted only when DEMO_MODE=true.
    if token.startswith("demo:"):
        if not settings.demo_mode:
            raise HTTPException(status_code=401, detail="Demo sessions are disabled.")
        email = token[5:].strip().lower()
        profile = one("profiles", filters=(("email", email),))
        if not profile:
            raise HTTPException(status_code=401, detail="Demo account not found. Check Supabase seed data and server API-key permissions.")
        return _profile_principal(profile)

    if not settings.supabase_auth_configured:
        raise HTTPException(status_code=401, detail="Session is invalid. Sign in again.")
    try:
        response = httpx.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Unable to validate Supabase session.") from exc
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Supabase session is invalid or expired.")
    auth_user_id = response.json().get("id")
    profile = one("profiles", filters=(("auth_user_id", auth_user_id),)) if auth_user_id else None
    if not profile:
        raise HTTPException(status_code=403, detail="Your signed-in account is not assigned to a MaplePro firm. Contact an administrator.")
    return _profile_principal(profile)


def _scope_project_rows(principal: Principal) -> list[dict[str, Any]]:
    filters: list[tuple[str, Any]] = [("firm_id", principal.firm_id)]
    if principal.role == "client":
        filters.append(("client_email", principal.email))
    elif principal.role == "subcontractor":
        filters.append(("assigned_subcontractor_email", principal.email))
    return rows("projects", filters=filters, order="target_completion:asc")


def _serialize_project(project: dict[str, Any], snapshots: list[dict[str, Any]], invoices: list[dict[str, Any]], milestones: list[dict[str, Any]]) -> dict[str, Any]:
    analysis = analyze_project(project, snapshots, invoices, milestones)
    return {
        "id": project["id"], "code": project["code"], "name": project["name"],
        "client_name": project["client_name"], "client_email": project["client_email"],
        "project_manager": project["project_manager"], "location": project["location"],
        "status": project["status"], "stage": project["stage"],
        "budget": float(project["budget"]), "actual_cost": float(project["actual_cost"]),
        "committed_costs": float(project.get("committed_costs", 0) or 0),
        "progress_pct": float(project.get("progress_pct", 0) or 0),
        "start_date": _as_date(project["start_date"]).isoformat(),
        "target_completion": _as_date(project["target_completion"]).isoformat(),
        "description": project.get("description", ""),
        "risk_score": analysis["risk_score"], "risk_level": analysis["risk_level"],
        "projected_final_cost": analysis["projected_final_cost"],
        "projected_variance_pct": analysis["projected_variance_pct"],
        "predicted_finish": analysis["predicted_finish"], "schedule_slip_days": analysis["schedule_slip_days"],
        "confidence_score": analysis["confidence_score"], "overdue_invoice_count": analysis["overdue_invoice_count"],
    }


def _serialize_invoice(invoice: dict[str, Any], project_name: str) -> dict[str, Any]:
    due_date = _as_date(invoice["due_date"])
    issued_date = _as_date(invoice["issued_date"])
    paid_at = _as_datetime(invoice.get("paid_at"))
    last_reminded_at = _as_datetime(invoice.get("last_reminded_at"))
    overdue_days = max(0, (date.today() - due_date).days) if str(invoice.get("status", "")).upper() != "PAID" else 0
    return {
        "id": invoice["id"], "invoice_number": invoice["invoice_number"], "project_id": invoice["project_id"],
        "project_name": project_name, "invoice_type": invoice.get("invoice_type", "client_invoice"),
        "recipient_name": invoice["recipient_name"], "recipient_email": invoice["recipient_email"],
        "description": invoice["description"], "amount": float(invoice["amount"]),
        "currency_code": invoice.get("currency_code", "CAD"), "issued_date": issued_date.isoformat(),
        "due_date": due_date.isoformat(), "status": invoice.get("status", "SENT"), "overdue_days": overdue_days,
        "reminders_sent": int(invoice.get("reminders_sent", 0) or 0),
        "last_reminded_at": last_reminded_at.isoformat() if last_reminded_at else None,
        "paid_at": paid_at.isoformat() if paid_at else None,
        "paypal_invoice_id": invoice.get("paypal_invoice_id"), "paypal_view_url": invoice.get("paypal_view_url"),
    }


def _gather_records(principal: Principal):
    projects = _scope_project_rows(principal)
    project_ids = [p["id"] for p in projects]
    if project_ids:
        invoice_filters: list[tuple[str, Any]] = [("firm_id", principal.firm_id)]
        if principal.role == "client":
            invoice_filters.extend((("invoice_type", "client_invoice"), ("recipient_email", principal.email)))
        elif principal.role == "subcontractor":
            invoice_filters.extend((("invoice_type", "subcontractor_invoice"), ("recipient_email", principal.email)))
        invoices = rows("invoices", filters=invoice_filters, in_filters=(("project_id", project_ids),), order="due_date:asc")
        milestones = rows("milestones", filters=(("firm_id", principal.firm_id),), in_filters=(("project_id", project_ids),), order="planned_date:asc")
        snapshots = rows("project_snapshots", filters=(("firm_id", principal.firm_id),), in_filters=(("project_id", project_ids),), order="snapshot_date:asc")
    else:
        invoices, milestones, snapshots = [], [], []

    by_project_snapshots: dict[str, list[dict[str, Any]]] = {p["id"]: [] for p in projects}
    by_project_milestones: dict[str, list[dict[str, Any]]] = {p["id"]: [] for p in projects}
    for item in snapshots:
        by_project_snapshots.setdefault(item["project_id"], []).append(item)
    for item in milestones:
        by_project_milestones.setdefault(item["project_id"], []).append(item)
    serialized_projects = [_serialize_project(p, by_project_snapshots.get(p["id"], []), invoices, by_project_milestones.get(p["id"], [])) for p in projects]
    names = {p["id"]: p["name"] for p in projects}
    serialized_invoices = [_serialize_invoice(i, names.get(i["project_id"], "Project")) for i in invoices]
    analyses = [analyze_project(p, by_project_snapshots.get(p["id"], []), invoices, by_project_milestones.get(p["id"], [])) for p in projects]
    return projects, invoices, milestones, snapshots, serialized_projects, serialized_invoices, analyses


def _insight_cards(analyses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for analysis in sorted(analyses, key=lambda item: item["risk_score"], reverse=True):
        if analysis["risk_score"] < 20 and analysis["overdue_invoice_count"] == 0:
            continue
        first_reason = analysis["reasons"][0]
        priority = "Urgent" if analysis["risk_score"] >= 60 or analysis["overdue_invoice_value"] >= 100000 else ("Today" if analysis["risk_score"] >= 35 else "This week")
        action = analysis["actions"][0]
        cards.append({
            "id": f"risk-{analysis['project_id']}", "project_id": analysis["project_id"], "project_name": analysis["project_name"],
            "priority": priority, "risk_level": analysis["risk_level"], "risk_score": analysis["risk_score"],
            "headline": _headline_from_reason(first_reason), "explanation": " ".join(analysis["reasons"][:2]) + ".",
            "evidence": analysis["reasons"], "recommended_action": action["title"], "action_detail": action["detail"],
            "action_type": action["type"], "invoice_id": action.get("invoice_id"),
            "confidence_score": analysis["confidence_score"], "ai_generated": False,
        })
    return cards[:8]


def _headline_from_reason(reason: str) -> str:
    lower = reason.lower()
    if "invoice" in lower:
        return "Overdue receivables need attention"
    if "cost" in lower or "budget" in lower:
        return "Cost-to-complete is trending above budget"
    if "completion" in lower or "progress" in lower:
        return "Schedule recovery needs review"
    return "Project risk signal detected"


def _current_dashboard(principal: Principal) -> dict[str, Any]:
    projects, invoices, milestones, snapshots, project_json, invoice_json, analyses = _gather_records(principal)
    today = date.today()
    unpaid_client = [i for i in invoices if i.get("invoice_type") == "client_invoice" and str(i.get("status", "")).upper() != "PAID"]
    overdue_client = [i for i in unpaid_client if _as_date(i["due_date"]) < today]
    high_risk = [a for a in analyses if a["risk_level"] == "High"]
    next_milestones = [m for m in milestones if m.get("status") != "Complete"]
    next_milestones.sort(key=lambda m: _as_date(m["planned_date"]))
    project_names = {p["id"]: p["name"] for p in projects}
    milestone_json = [{
        "id": m["id"], "project_id": m["project_id"], "project_name": project_names.get(m["project_id"], "Project"),
        "title": m["title"], "planned_date": _as_date(m["planned_date"]).isoformat(),
        "progress_pct": float(m.get("progress_pct", 0) or 0), "status": m["status"],
    } for m in next_milestones[:8]]
    budget_total = sum(float(p["budget"]) for p in projects)
    actual_total = sum(float(p["actual_cost"]) for p in projects)
    committed_total = sum(float(p.get("committed_costs", 0) or 0) for p in projects)
    outstanding = sum(float(i["amount"]) for i in unpaid_client)
    overdue_value = sum(float(i["amount"]) for i in overdue_client)
    return {
        "user": {"id": principal.user_id, "email": principal.email, "name": principal.name, "role": principal.role, "firm_id": principal.firm_id},
        "stats": {
            "active_projects": len(projects), "high_risk_projects": len(high_risk), "total_budget": round(budget_total, 2),
            "actual_cost": round(actual_total, 2), "committed_costs": round(committed_total, 2),
            "outstanding_invoices": round(outstanding, 2), "overdue_invoice_value": round(overdue_value, 2),
            "overdue_invoice_count": len(overdue_client),
            "avg_progress": round(sum(float(p.get("progress_pct", 0) or 0) for p in projects) / len(projects), 1) if projects else 0,
        },
        "projects": project_json, "invoices": invoice_json, "milestones": milestone_json, "insights": _insight_cards(analyses),
        "integrations": {"gemini_configured": bool(settings.gemini_api_key), "gemini_model": settings.gemini_model,
                         "paypal_configured": settings.paypal_configured, "demo_mode": settings.demo_mode,
                         "supabase_auth": settings.supabase_auth_configured and not settings.demo_mode,
                         "database_provider": "Supabase Data API" if settings.supabase_configured else "Not configured"},
        "data_notice": "Seeded demonstration data. Forecasts use synthetic monthly snapshots and are not calibrated production predictions." if settings.demo_mode else "Project records and forecast assumptions should be validated before operational decisions.",
    }


def _find_accessible_invoice(principal: Principal, invoice_id: str) -> dict[str, Any] | None:
    _projects, invoices, *_ = _gather_records(principal)
    return next((invoice for invoice in invoices if invoice.get("id") == invoice_id), None)


@app.get("/", include_in_schema=False)
def landing_page():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/login", include_in_schema=False)
def login_page():
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/app", include_in_schema=False)
def application_page():
    return FileResponse(STATIC_DIR / "app.html")


@app.get("/404", include_in_schema=False)
def not_found_page():
    return FileResponse(STATIC_DIR / "404.html", status_code=404)


@app.get("/api/config")
def get_public_config():
    return {
        "app_name": "MaplePro", "auth_mode": "demo" if settings.demo_mode else ("supabase" if settings.supabase_auth_configured else "unconfigured"),
        "supabase_url": settings.supabase_url if not settings.demo_mode else "",
        "supabase_anon_key": settings.supabase_anon_key if not settings.demo_mode else "",
        "demo_mode": settings.demo_mode, "gemini_configured": bool(settings.gemini_api_key),
        "gemini_model": settings.gemini_model, "paypal_configured": settings.paypal_configured,
        "database_provider": "Supabase Data API" if settings.supabase_configured else "Not configured",
    }


@app.post("/api/auth/login")
def demo_login(body: LoginRequest):
    if not settings.demo_mode:
        raise HTTPException(status_code=400, detail="Demo login is disabled. Use your Supabase account.")
    profile = one("profiles", filters=(("email", str(body.email).lower()),))
    if body.password != _DEMO_PASSWORD:
        raise HTTPException(status_code=401, detail="The password is incorrect. Please try again.")
    if not profile:
        raise HTTPException(
            status_code=503,
            detail=(
                "MaplePro could not read this demo profile from the Supabase project configured in Vercel. "
                "Check that SUPABASE_URL matches the project you inspected and that the server-side "
                "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is configured for demo data access. "
                "A public anon/publishable key can return no rows under the current RLS policies. "
                "If the profile is absent from that project, run scripts/seed_demo.py or "
                "supabase/repair_demo_profiles.sql."
            ),
        )
    return {"access_token": f"demo:{profile['email']}", "token_type": "bearer", "user": {"email": profile["email"], "name": profile["full_name"], "role": profile["role"]}}


@app.get("/api/me")
def me(principal: Principal = Depends(get_principal)):
    return {"id": principal.user_id, "email": principal.email, "name": principal.name, "role": principal.role, "firm_id": principal.firm_id}


@app.get("/api/dashboard")
def dashboard(principal: Principal = Depends(get_principal)):
    return _current_dashboard(principal)


@app.get("/api/projects")
def list_projects(principal: Principal = Depends(get_principal)):
    return _current_dashboard(principal)["projects"]


@app.get("/api/invoices")
def list_invoices(principal: Principal = Depends(get_principal)):
    return _current_dashboard(principal)["invoices"]


@app.get("/api/intelligence")
def get_intelligence(principal: Principal = Depends(get_principal)):
    dashboard_data = _current_dashboard(principal)
    return {"mode": "rules_fallback", "ai_generated": False, "executive_summary": _fallback_executive_summary(dashboard_data),
            "insights": dashboard_data["insights"], "notice": "Rule-based explanation. Add GEMINI_API_KEY to generate contextual insight narratives with Gemini Flash."}


def _fallback_executive_summary(dash: dict[str, Any]) -> str:
    stats = dash["stats"]
    if stats["overdue_invoice_count"]:
        return f"{stats['overdue_invoice_count']} client invoice(s) are past due, representing ${stats['overdue_invoice_value']:,.0f} in overdue receivables. Review the highest-risk projects and use the invoice workflow to follow up."
    if stats["high_risk_projects"]:
        return f"{stats['high_risk_projects']} project(s) have elevated cost or schedule signals. Validate the current commitments and milestone assumptions before reprioritizing work."
    return "No urgent rule-based trigger is currently elevated. Continue weekly project cost, progress, and receivables reviews."


@app.post("/api/intelligence/refresh")
def refresh_intelligence(principal: Principal = Depends(get_principal)):
    dashboard_data = _current_dashboard(principal)
    fallback = {"mode": "rules_fallback", "ai_generated": False, "executive_summary": _fallback_executive_summary(dashboard_data), "insights": dashboard_data["insights"]}
    if not settings.gemini_api_key:
        fallback["notice"] = "Gemini is not connected. Showing transparent rule-based analysis; set GEMINI_API_KEY to enable Gemini Flash."
        return fallback

    evidence = {
        "metrics": dashboard_data["stats"],
        "projects": [{k: p[k] for k in ("id", "code", "name", "risk_score", "risk_level", "budget", "actual_cost", "projected_final_cost", "projected_variance_pct", "progress_pct", "target_completion", "predicted_finish", "schedule_slip_days", "confidence_score", "overdue_invoice_count")} for p in dashboard_data["projects"]],
        "rule_based_insights": dashboard_data["insights"],
    }
    prompt = (
        "You are MaplePro, a construction project decision-support assistant. Use ONLY the supplied JSON evidence. "
        "Do not invent numbers, payment status, or dates. Distinguish observed facts from estimated forecasts. "
        "The dataset is synthetic demo data. Write a concise executive_summary and return an insights array with one item per relevant high/medium risk project. "
        "Each insight must have project_id, headline, explanation, recommendation, and priority (Urgent, Today, or This week). "
        "Keep recommendations practical for a construction project manager. Do not claim statistical certainty. Evidence JSON:\n" + json.dumps(evidence, ensure_ascii=False)
    )
    schema = {
        "type": "OBJECT", "properties": {
            "executive_summary": {"type": "STRING"},
            "insights": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "project_id": {"type": "STRING"}, "headline": {"type": "STRING"}, "explanation": {"type": "STRING"},
                "recommendation": {"type": "STRING"}, "priority": {"type": "STRING", "enum": ["Urgent", "Today", "This week"]}
            }, "required": ["project_id", "headline", "explanation", "recommendation", "priority"]}}
        }, "required": ["executive_summary", "insights"]
    }
    try:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent",
            params={"key": settings.gemini_api_key},
            json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema}},
            timeout=40.0,
        )
        if response.status_code >= 400:
            raise ValueError(f"Gemini API returned HTTP {response.status_code}")
        generated = json.loads(response.json()["candidates"][0]["content"]["parts"][0]["text"])
        allowed_ids = {p["id"] for p in dashboard_data["projects"]}
        insights = []
        for item in generated.get("insights", []):
            project_id = item.get("project_id")
            if project_id not in allowed_ids:
                continue
            insights.append({**item, "id": f"gemini-{project_id}", "ai_generated": True,
                             "risk_level": next((p["risk_level"] for p in dashboard_data["projects"] if p["id"] == project_id), "Medium")})
        return {"mode": "gemini_flash", "ai_generated": True, "executive_summary": generated.get("executive_summary", fallback["executive_summary"]),
                "insights": insights or dashboard_data["insights"], "model": settings.gemini_model,
                "notice": "Gemini generated the narrative; financial calculations and risk scores were computed by MaplePro."}
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError):
        fallback["notice"] = "Gemini request did not complete; showing rule-based analysis instead. Verify the API key, model access, and quota."
        return fallback


def _paypal_access_token() -> str:
    if not settings.paypal_configured:
        raise HTTPException(status_code=503, detail="PayPal Sandbox credentials are not configured.")
    try:
        response = httpx.post(
            f"{settings.paypal_base_url}/v1/oauth2/token",
            auth=(settings.paypal_client_id, settings.paypal_client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json", "Accept-Language": "en_US"}, timeout=15.0,
        )
        response.raise_for_status()
        return response.json()["access_token"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Could not obtain a PayPal access token. Verify Sandbox credentials.") from exc


def _paypal_request(method: str, path: str, payload: dict | None = None) -> dict[str, Any]:
    token = _paypal_access_token()
    try:
        response = httpx.request(method, f"{settings.paypal_base_url}{path}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=25.0)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"PayPal API rejected the request ({response.status_code}). Check the invoice fields and Sandbox app permissions.")
        return response.json() if response.content else {}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="PayPal Sandbox could not be reached.") from exc


def _create_paypal_invoice(body: NewInvoiceRequest, invoice_number: str, due_date: date) -> tuple[str, str | None, dict]:
    payload = {
        "detail": {"invoice_number": invoice_number, "currency_code": body.currency_code.upper(),
                   "invoice_date": date.today().isoformat(), "due_date": due_date.isoformat(),
                   "payment_term": {"term_type": "DUE_ON_DATE_SPECIFIED", "due_date": due_date.isoformat()},
                   "note": "Please reference the MaplePro project code when submitting payment."},
        "invoicer": {"business_name": settings.firm_name},
        "primary_recipients": [{"billing_info": {"email_address": str(body.recipient_email)}}],
        "items": [{"name": body.description, "quantity": "1", "unit_amount": {"currency_code": body.currency_code.upper(), "value": f"{body.amount:.2f}"}}],
    }
    created = _paypal_request("POST", "/v2/invoicing/invoices", payload)
    external_id = created.get("id")
    if not external_id:
        raise HTTPException(status_code=502, detail="PayPal created no invoice ID; invoice was not saved in MaplePro.")
    sent = _paypal_request("POST", f"/v2/invoicing/invoices/{external_id}/send", {"send_to_invoicer": True, "send_to_recipient": True})
    sent_links = sent if isinstance(sent, list) else list(sent.get("links", []))
    if isinstance(sent, dict) and sent.get("rel"):
        sent_links.append(sent)
    payer_url = next((link.get("href") for link in sent_links if link.get("rel") == "payer-view" and link.get("href")), None)
    details = _paypal_request("GET", f"/v2/invoicing/invoices/{external_id}")
    metadata = ((details.get("detail") or {}).get("metadata") or {}) if isinstance(details, dict) else {}
    payer_url = payer_url or metadata.get("recipient_view_url") or metadata.get("payer_view_url")
    return external_id, payer_url, details


@app.post("/api/invoices")
def create_invoice(body: NewInvoiceRequest, principal: Principal = Depends(get_principal)):
    if principal.role not in {"admin", "project_manager"}:
        raise HTTPException(status_code=403, detail="Only administrators and project managers can create invoices.")
    project = next((p for p in _scope_project_rows(principal) if p.get("id") == body.project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    today = date.today()
    due = today + timedelta(days=body.due_in_days)
    invoice_number = f"MP-{today.year}-{uuid4().hex[:6].upper()}"
    paypal_id, payer_url = None, None
    if settings.paypal_configured:
        paypal_id, payer_url, _details = _create_paypal_invoice(body, invoice_number, due)
    elif not settings.demo_mode:
        raise HTTPException(status_code=503, detail="PayPal is not configured. Add Sandbox credentials before creating a real invoice.")

    invoice = insert_one("invoices", {
        "id": f"inv-{uuid4().hex[:12]}", "firm_id": principal.firm_id, "project_id": project["id"],
        "invoice_number": invoice_number, "invoice_type": "client_invoice", "recipient_name": body.recipient_name,
        "recipient_email": str(body.recipient_email), "description": body.description, "amount": round(body.amount, 2),
        "currency_code": body.currency_code.upper(), "issued_date": today.isoformat(), "due_date": due.isoformat(),
        "status": "SENT", "paypal_invoice_id": paypal_id, "paypal_view_url": payer_url, "reminders_sent": 0,
    })
    return {"invoice": _serialize_invoice(invoice, project["name"]), "real_paypal": bool(paypal_id),
            "message": "Invoice created and sent through PayPal Sandbox." if paypal_id else "Invoice added as a demo record. No PayPal email or payment was sent.",
            "payer_url": payer_url}


@app.post("/api/invoices/{invoice_id}/remind")
def remind_invoice(invoice_id: str, principal: Principal = Depends(get_principal)):
    if principal.role not in {"admin", "project_manager"}:
        raise HTTPException(status_code=403, detail="Only administrators and project managers can send invoice reminders.")
    invoice = _find_accessible_invoice(principal, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    if str(invoice.get("status", "")).upper() == "PAID":
        raise HTTPException(status_code=409, detail="This invoice is already marked as paid.")
    if settings.paypal_configured:
        if not invoice.get("paypal_invoice_id"):
            raise HTTPException(status_code=409, detail="This seeded invoice has no PayPal invoice ID. Create a new invoice through the PayPal workflow to send real reminders.")
        _paypal_request("POST", f"/v2/invoicing/invoices/{invoice['paypal_invoice_id']}/remind", {"send_to_invoicer": True, "send_to_recipient": True})
        real_paypal = True
    else:
        if not settings.demo_mode:
            raise HTTPException(status_code=503, detail="PayPal is not configured.")
        real_paypal = False
    reminder_count = int(invoice.get("reminders_sent", 0) or 0) + 1
    update_one("invoices", invoice_id, {"reminders_sent": reminder_count, "last_reminded_at": datetime.now(timezone.utc).isoformat()})
    return {"ok": True, "real_paypal": real_paypal, "reminders_sent": reminder_count,
            "message": "Reminder sent through PayPal." if real_paypal else "Demo reminder recorded. No external email was sent."}


@app.post("/api/invoices/{invoice_id}/simulate-payment")
def simulate_demo_payment(invoice_id: str, principal: Principal = Depends(get_principal)):
    if not settings.demo_mode:
        raise HTTPException(status_code=404, detail="Demo payment simulation is disabled.")
    if principal.role not in {"admin", "project_manager", "client"}:
        raise HTTPException(status_code=403, detail="Your role cannot complete this demonstration action.")
    invoice = _find_accessible_invoice(principal, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    if principal.role == "client" and (invoice.get("recipient_email") != principal.email or invoice.get("invoice_type") != "client_invoice"):
        raise HTTPException(status_code=403, detail="This invoice is not addressed to your client account.")
    if str(invoice.get("status", "")).upper() == "PAID":
        return {"ok": True, "message": "Invoice is already marked as paid.", "simulated": True}
    update_one("invoices", invoice_id, {"status": "PAID", "paid_at": datetime.now(timezone.utc).isoformat()})
    return {"ok": True, "message": "Demonstration status updated only. No PayPal transaction was made.", "simulated": True}


@app.post("/api/webhooks/paypal")
async def paypal_webhook(request: Request):
    if not (settings.paypal_configured and settings.paypal_webhook_id):
        raise HTTPException(status_code=503, detail="PayPal webhook verification is not configured.")
    event = await request.json()
    headers = request.headers
    verification = {"auth_algo": headers.get("paypal-auth-algo"), "cert_url": headers.get("paypal-cert-url"),
                    "transmission_id": headers.get("paypal-transmission-id"), "transmission_sig": headers.get("paypal-transmission-sig"),
                    "transmission_time": headers.get("paypal-transmission-time"), "webhook_id": settings.paypal_webhook_id,
                    "webhook_event": event}
    if not all(verification.get(k) for k in ("auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time")):
        raise HTTPException(status_code=400, detail="PayPal signature headers are incomplete.")
    result = _paypal_request("POST", "/v1/notifications/verify-webhook-signature", verification)
    if result.get("verification_status") != "SUCCESS":
        raise HTTPException(status_code=400, detail="PayPal webhook signature verification failed.")
    event_id = event.get("id")
    event_type = event.get("event_type", "unknown")
    if not event_id:
        return {"received": True, "processed": False}
    if one("payment_events", filters=(("paypal_event_id", event_id),), columns="id"):
        return {"received": True, "duplicate": True}
    resource = event.get("resource") or {}
    external_id = resource.get("invoice_id") or resource.get("id")
    related_invoice = one("invoices", filters=(("paypal_invoice_id", external_id),)) if external_id else None
    if not related_invoice:
        return {"received": True, "processed": False}
    insert_one("payment_events", {"id": f"evt-{uuid4().hex[:12]}", "firm_id": related_invoice["firm_id"],
                                    "invoice_id": related_invoice["id"], "paypal_event_id": event_id,
                                    "event_type": event_type, "payload_json": json.dumps(event)})
    if "INVOICING.INVOICE.PAID" in event_type.upper():
        update_one("invoices", related_invoice["id"], {"status": "PAID", "paid_at": datetime.now(timezone.utc).isoformat()})
    return {"received": True, "processed": True}


@app.get("/api/search")
def search(q: str = "", principal: Principal = Depends(get_principal)):
    term = q.strip().lower()[:120]
    if not term:
        return {"projects": [], "invoices": []}
    dash = _current_dashboard(principal)
    projects = [p for p in dash["projects"] if term in p["name"].lower() or term in p["code"].lower() or term in p["client_name"].lower() or term in p["location"].lower()]
    invoices = [i for i in dash["invoices"] if term in i["invoice_number"].lower() or term in i["recipient_name"].lower() or term in i["project_name"].lower() or term in i["description"].lower()]
    return {"projects": projects[:8], "invoices": invoices[:8]}


@app.get("/api/health")
def health():
    try:
        rows("firms", columns="id", limit=1)
        database_status = "connected"
    except Exception:
        database_status = "unavailable"
    return {"status": "ok" if database_status == "connected" else "degraded", "demo_mode": settings.demo_mode,
            "database": database_status, "database_provider": "Supabase Data API",
            "paypal_configured": settings.paypal_configured, "gemini_configured": bool(settings.gemini_api_key)}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Keep generic server failures from leaking credentials or stack traces to clients.
    return JSONResponse(status_code=500, content={"detail": "Unexpected server error. Check the application log."})


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": "Not found."})
    return FileResponse(STATIC_DIR / "404.html", status_code=404)
