from __future__ import annotations
from datetime import date, datetime, timedelta
from statistics import mean
from typing import Any


def _get(row: Any, key: str, default: Any = None) -> Any:
    if isinstance(row, dict):
        return row.get(key, default)
    return getattr(row, key, default)


def _date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def linear_slope(points: list[tuple[float, float]]) -> float:
    """Least-squares slope for (time index, value) points; zero when insufficient data."""
    if len(points) < 2:
        return 0.0
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    mx, my = mean(xs), mean(ys)
    denominator = sum((x - mx) ** 2 for x in xs)
    if denominator == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in points) / denominator


def analyze_project(project: Any, snapshots: list[Any], invoices: list[Any], milestones: list[Any], today: date | None = None) -> dict:
    """Build transparent project risk and forecast metrics from Supabase records."""
    today = today or date.today()
    snapshots = sorted(snapshots, key=lambda x: _date(_get(x, "snapshot_date")))
    project_id = _get(project, "id")
    project_invoices = [i for i in invoices if _get(i, "project_id") == project_id]
    client_invoices = [i for i in project_invoices if _get(i, "invoice_type") == "client_invoice"]
    overdue = [i for i in client_invoices if str(_get(i, "status", "")).upper() != "PAID" and _date(_get(i, "due_date")) < today]
    outstanding = sum(float(_get(i, "amount", 0) or 0) for i in client_invoices if str(_get(i, "status", "")).upper() != "PAID")

    project_progress = float(_get(project, "progress_pct", 0) or 0)
    actual_cost = float(_get(project, "actual_cost", 0) or 0)
    committed_costs = float(_get(project, "committed_costs", 0) or 0)
    budget = float(_get(project, "budget", 0) or 0)
    target_completion = _date(_get(project, "target_completion"))
    # Forecast A: estimated final cost from observed cost-to-progress ratio.
    latest = snapshots[-1] if snapshots else None
    observed_progress = max(float(_get(latest, "progress_pct", project_progress) if latest else project_progress) / 100.0, 0.15)
    observed_cost = float(_get(latest, "actual_cost", actual_cost) if latest else actual_cost)
    projected_final_cost = max(actual_cost, observed_cost / observed_progress)
    projected_final_cost = max(projected_final_cost, actual_cost + committed_costs)
    projected_variance_pct = ((projected_final_cost - budget) / max(budget, 1)) * 100

    # Forecast B: trend-based remaining-duration estimate from time-ordered snapshots.
    progress_points = [(float(i), float(_get(s, "progress_pct", 0) or 0)) for i, s in enumerate(snapshots)]
    monthly_progress_rate = max(0.5, linear_slope(progress_points))
    remaining_months = max(0.0, (100.0 - project_progress) / monthly_progress_rate)
    predicted_finish = today + timedelta(days=int(remaining_months * 30.44))
    schedule_slip_days = (predicted_finish - target_completion).days

    overdue_value = sum(float(_get(i, "amount", 0) or 0) for i in overdue)
    behind = max(0.0, float(_get(latest, "planned_progress_pct", project_progress) if latest else project_progress) - float(_get(latest, "progress_pct", project_progress) if latest else project_progress))

    # This is an interpretable rule index, not a probability of project failure.
    score = 0
    reasons: list[str] = []
    if overdue:
        score += min(30, 12 + len(overdue) * 6)
        reasons.append(f"{len(overdue)} client invoice(s) are past due, totalling ${overdue_value:,.0f}")
    if projected_variance_pct > 15:
        score += 28
        reasons.append(f"forecast final cost is {projected_variance_pct:.1f}% above budget")
    elif projected_variance_pct > 7:
        score += 20
        reasons.append(f"forecast final cost is {projected_variance_pct:.1f}% above budget")
    elif projected_variance_pct > 2:
        score += 10
        reasons.append(f"forecast final cost is {projected_variance_pct:.1f}% above budget")
    if schedule_slip_days > 30:
        score += 25
        reasons.append(f"trend-based completion estimate is {schedule_slip_days} days past target")
    elif schedule_slip_days > 10:
        score += 16
        reasons.append(f"trend-based completion estimate is {schedule_slip_days} days past target")
    elif schedule_slip_days > 0:
        score += 7
        reasons.append(f"trend-based completion estimate is {schedule_slip_days} days past target")
    if behind > 12:
        score += 12
        reasons.append(f"progress is {behind:.0f} points behind plan in the latest snapshot")
    elif behind > 5:
        score += 6
        reasons.append(f"progress is {behind:.0f} points behind plan in the latest snapshot")
    if target_completion <= today + timedelta(days=14) and project_progress < 90:
        score += 10
        reasons.append("target completion is within two weeks and work remains")
    score = min(100, score)
    risk_level = "High" if score >= 60 else ("Medium" if score >= 30 else "Low")
    confidence = min(92, 48 + max(0, len(snapshots) - 1) * 7 + (8 if len(milestones) >= 3 else 0))
    actions = []
    if overdue:
        actions.append({"title": "Resolve outstanding receivables", "detail": f"Review {len(overdue)} overdue client invoice(s) totalling ${overdue_value:,.0f} and send a documented reminder.", "type": "invoice", "invoice_id": _get(overdue[0], "id")})
    if projected_variance_pct > 5:
        actions.append({"title": "Review cost-to-complete", "detail": f"Compare the ${projected_final_cost:,.0f} cost forecast with remaining commitments and change orders.", "type": "project", "project_id": project_id})
    if schedule_slip_days > 10 or behind > 8:
        actions.append({"title": "Re-plan the critical path", "detail": f"Validate trade dependencies and recovery options for the estimated {max(0, schedule_slip_days)}-day slip.", "type": "project", "project_id": project_id})
    if not actions:
        actions.append({"title": "Maintain current controls", "detail": "No immediate rule-based trigger is elevated. Continue weekly cost and milestone checks.", "type": "project", "project_id": project_id})

    return {
        "project_id": project_id, "project_name": _get(project, "name", ""), "project_code": _get(project, "code", ""),
        "risk_score": score, "risk_level": risk_level, "reasons": reasons or ["No elevated rule-based signals detected."],
        "budget": round(budget, 2), "actual_cost": round(actual_cost, 2),
        "projected_final_cost": round(projected_final_cost, 2), "projected_variance_pct": round(projected_variance_pct, 1),
        "progress_pct": round(project_progress, 1), "planned_progress_pct": round(float(_get(latest, "planned_progress_pct", project_progress) if latest else project_progress), 1),
        "target_completion": target_completion.isoformat(), "predicted_finish": predicted_finish.isoformat(),
        "schedule_slip_days": int(schedule_slip_days), "monthly_progress_rate": round(monthly_progress_rate, 2),
        "confidence_score": confidence, "confidence_note": "Based on simulated monthly snapshots; not a calibrated probability.",
        "overdue_invoice_count": len(overdue), "overdue_invoice_value": round(overdue_value, 2),
        "outstanding_client_invoice_value": round(outstanding, 2), "actions": actions,
    }
