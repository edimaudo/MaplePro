from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from .config import settings
from .database import insert_many, rows, one, update_one

FIRM_ID = "firm-northline"

PROJECT_DATA = [
    {"id":"prj-northstar","code":"MP-2401","name":"Northstar Commercial Renovation","client_name":"Northstar Properties","client_email":"client@maplepro.demo","manager":"Olivia Chen","sub":"subcontractor@maplepro.demo","location":"Toronto, ON","budget":1_200_000,"actual":672_000,"committed":348_000,"progress":48,"start_offset":-210,"finish_offset":50,"stage":"Interior fit-out","description":"Multi-floor commercial renovation with HVAC replacement, electrical upgrades, and tenant improvements."},
    {"id":"prj-lakeshore","code":"MP-2402","name":"Lakeshore Medical Fitout","client_name":"Lakeshore Health Group","client_email":"client@maplepro.demo","manager":"Olivia Chen","sub":"subcontractor@maplepro.demo","location":"Mississauga, ON","budget":2_400_000,"actual":1_720_000,"committed":410_000,"progress":72,"start_offset":-240,"finish_offset":25,"stage":"Mechanical & finishes","description":"Clinical fit-out with specialized mechanical systems, medical-grade finishes, and inspection gates."},
    {"id":"prj-westview","code":"MP-2403","name":"Westview Residential Phase II","client_name":"Westview Living","client_email":"projects@westview.example","manager":"Marcus Reid","sub":"trade-westview@example.com","location":"Vaughan, ON","budget":3_850_000,"actual":2_600_000,"committed":890_000,"progress":68,"start_offset":-280,"finish_offset":109,"stage":"Structure & envelope","description":"Residential mid-rise phase with envelope work and sequential unit handovers."},
    {"id":"prj-cedar","code":"MP-2404","name":"Cedar Ridge School Addition","client_name":"York District Schools","client_email":"facilities@yorkschools.example","manager":"Marcus Reid","sub":"trade-cedar@example.com","location":"Richmond Hill, ON","budget":1_100_000,"actual":914_000,"committed":126_000,"progress":78,"start_offset":-190,"finish_offset":10,"stage":"Commissioning","description":"School addition requiring inspections, life-safety sign-off, and a fixed opening date."},
    {"id":"prj-harbor","code":"MP-2405","name":"Harbor Logistics Warehouse","client_name":"Harbor Logistics","client_email":"finance@harbor.example","manager":"Priya Nair","sub":"trade-harbor@example.com","location":"Brampton, ON","budget":4_600_000,"actual":3_100_000,"committed":1_050_000,"progress":57,"start_offset":-260,"finish_offset":143,"stage":"Shell & services","description":"Large warehouse build with concrete, loading-bay systems, and coordinated MEP trades."},
    {"id":"prj-midtown","code":"MP-2406","name":"Midtown Retail Conversion","client_name":"Midtown Retail Partners","client_email":"accounts@midtown.example","manager":"Olivia Chen","sub":"trade-midtown@example.com","location":"Toronto, ON","budget":780_000,"actual":715_000,"committed":44_000,"progress":83,"start_offset":-140,"finish_offset":4,"stage":"Final inspections","description":"Retail conversion with high urgency around final inspection and tenant handover."},
    {"id":"prj-pinecrest","code":"MP-2407","name":"Pinecrest Townhomes","client_name":"Pinecrest Communities","client_email":"build@pinecrest.example","manager":"Priya Nair","sub":"trade-pinecrest@example.com","location":"Pickering, ON","budget":2_150_000,"actual":1_100_000,"committed":740_000,"progress":46,"start_offset":-170,"finish_offset":90,"stage":"Framing & rough-in","description":"Townhome development with staged trade mobilization and material delivery dependencies."},
    {"id":"prj-greenway","code":"MP-2408","name":"Greenway Office Tower","client_name":"Greenway Commercial REIT","client_email":"ap@greenway.example","manager":"Marcus Reid","sub":"trade-greenway@example.com","location":"Markham, ON","budget":5_800_000,"actual":4_100_000,"committed":1_150_000,"progress":61,"start_offset":-310,"finish_offset":186,"stage":"Curtain wall & MEP","description":"Office tower renovation with façade replacement, energy upgrades, and phased occupancy."},
]


def _months_before(d: date, months: int) -> date:
    return d - timedelta(days=30 * months)


def build_seed_records(today: date | None = None) -> dict[str, list[dict[str, Any]]]:
    """Build all synthetic seed rows as plain dictionaries for Supabase inserts."""
    today = today or date.today()
    users = [
        ("usr-admin", "admin@maplepro.demo", "Alex Morgan", "admin"),
        ("usr-manager", "manager@maplepro.demo", "Olivia Chen", "project_manager"),
        ("usr-client", "client@maplepro.demo", "Jordan Blake", "client"),
        ("usr-subcontractor", "subcontractor@maplepro.demo", "Sam Patel", "subcontractor"),
    ]
    result: dict[str, list[dict[str, Any]]] = {
        "firms": [{"id": FIRM_ID, "name": settings.firm_name}],
        "profiles": [{"id": uid, "auth_user_id": None, "firm_id": FIRM_ID, "email": email, "full_name": name, "role": role, "active": True} for uid, email, name, role in users],
        "projects": [], "invoices": [], "milestones": [], "project_snapshots": [],
    }

    milestone_names = ["Design & permits", "Structural / rough-in", "MEP & finishes", "Inspection and handover"]
    date_fracs = [0.12, 0.42, 0.76, 1.0]
    due_days_first = [14, 24, 8, 31, 19, 16, 6, 12]
    due_days_second = [35, 28, 9, 4, 40, 13, 3, 18]

    for index, raw in enumerate(PROJECT_DATA):
        start_date = today + timedelta(days=raw["start_offset"])
        target_completion = today + timedelta(days=raw["finish_offset"])
        result["projects"].append({
            "id": raw["id"], "firm_id": FIRM_ID, "code": raw["code"], "name": raw["name"],
            "client_name": raw["client_name"], "client_email": raw["client_email"],
            "project_manager": raw["manager"], "assigned_subcontractor_email": raw["sub"],
            "location": raw["location"], "status": "In progress", "stage": raw["stage"],
            "budget": raw["budget"], "actual_cost": raw["actual"], "committed_costs": raw["committed"],
            "progress_pct": raw["progress"], "start_date": start_date.isoformat(),
            "target_completion": target_completion.isoformat(), "description": raw["description"],
        })

        for m in range(5, -1, -1):
            fraction = (6 - m) / 6
            progress = max(3.0, raw["progress"] - m * (5.0 + (index % 3)))
            cost = raw["actual"] * (progress / max(raw["progress"], 1))
            plan_gap = (10 if index in (2, 3, 5) else 2) * fraction
            planned = min(100.0, progress + plan_gap)
            result["project_snapshots"].append({
                "id": f"snap-{raw['id']}-{m}", "firm_id": FIRM_ID, "project_id": raw["id"],
                "snapshot_date": _months_before(today, m).isoformat(), "actual_cost": round(cost, 2),
                "progress_pct": round(progress, 1), "planned_progress_pct": round(planned, 1),
                "committed_costs": round(raw["committed"] * progress / 100, 2),
            })

        for j, (title, frac) in enumerate(zip(milestone_names, date_fracs)):
            planned = start_date + timedelta(days=max(30, int((target_completion - start_date).days * frac)))
            if j == 3:
                planned = target_completion
            complete = (j == 0) or (j == 1 and raw["progress"] > 55) or (j == 2 and raw["progress"] > 88)
            delayed = (index in (3, 5) and j == 2 and raw["progress"] < 90)
            status = "Complete" if complete else ("At risk" if delayed or (planned < today and not complete) else "Upcoming")
            progress_pct = 100.0 if complete else (min(95.0, max(5.0, raw["progress"] - j * 18)) if j < 3 else raw["progress"])
            result["milestones"].append({
                "id": f"mil-{raw['id']}-{j+1}", "firm_id": FIRM_ID, "project_id": raw["id"],
                "title": title, "planned_date": planned.isoformat(), "actual_date": planned.isoformat() if complete else None,
                "progress_pct": progress_pct, "status": status,
            })

        invoice_specs = [
            ("client_invoice", raw["client_name"], raw["client_email"], "Progress billing", raw["budget"] * 0.12),
            ("client_invoice", raw["client_name"], raw["client_email"], "Materials and site work", raw["budget"] * 0.08),
            ("client_invoice", raw["client_name"], raw["client_email"], "Milestone payment", raw["budget"] * 0.06),
            ("subcontractor_invoice", "Northline Trade Services", raw["sub"], "Subcontractor work claim", raw["budget"] * 0.035),
        ]
        for j, (kind, recipient, email, description, amount) in enumerate(invoice_specs):
            if j == 0:
                status = "OVERDUE" if index in (0, 3, 5) else ("PAID" if index in (1, 2, 6) else "SENT")
                due = today - timedelta(days=due_days_first[index])
            elif j == 1:
                status = "PAID" if index in (0, 1, 4, 7) else ("OVERDUE" if index in (2, 5) else "SENT")
                due = today - timedelta(days=due_days_second[index])
            elif j == 2:
                status = "PAID" if index in (0, 2, 4) else "SENT"
                due = today + timedelta(days=7 + index * 2)
            else:
                status = "PAID" if index % 3 == 0 else ("OVERDUE" if index in (1, 3, 5) else "SENT")
                due = today - timedelta(days=10 + index * 2) if status == "OVERDUE" else today + timedelta(days=12 + index * 3)
            if status == "PAID":
                due = today - timedelta(days=4 + j * 3)
            result["invoices"].append({
                "id": f"inv-{raw['id']}-{j+1}", "firm_id": FIRM_ID, "project_id": raw["id"],
                "invoice_number": f"MP-2026-{index*4+j+101:04d}", "invoice_type": kind,
                "recipient_name": recipient, "recipient_email": email, "description": description,
                "amount": round(amount, 2), "currency_code": "CAD", "issued_date": (due - timedelta(days=30)).isoformat(),
                "due_date": due.isoformat(), "status": status, "paypal_invoice_id": None, "paypal_view_url": None,
                "reminders_sent": 1 if status == "OVERDUE" and j == 0 else 0,
                "paid_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat() if status == "PAID" else None,
            })
    return result


def _insert_missing_by_id(table: str, records: list[dict[str, Any]]) -> int:
    """Insert only missing IDs so a partial seed can be safely repaired."""
    if not records:
        return 0
    ids = [str(record["id"]) for record in records]
    existing = rows(table, in_filters=(("id", ids),), columns="id")
    existing_ids = {str(record["id"]) for record in existing}
    missing = [record for record in records if str(record["id"]) not in existing_ids]
    if not missing:
        return 0
    try:
        insert_many(table, missing)
    except Exception:
        # On serverless cold starts, more than one instance can seed concurrently.
        # Treat a conflicting insert as successful only when another instance has
        # now created every requested row; never swallow permission/schema failures.
        confirmed = rows(table, in_filters=(("id", [str(record["id"]) for record in missing]),), columns="id")
        confirmed_ids = {str(record["id"]) for record in confirmed}
        if not all(str(record["id"]) in confirmed_ids for record in missing):
            raise
    return len(missing)


def _ensure_profiles(records: list[dict[str, Any]]) -> int:
    """Restore demo profiles by email without overwriting a linked Auth user ID."""
    changed = 0
    for record in records:
        existing = one("profiles", filters=(("email", record["email"]),), columns="id,email,firm_id,full_name,role,active")
        if not existing:
            existing = one("profiles", filters=(("id", record["id"]),), columns="id,email,firm_id,full_name,role,active")
        if existing:
            # Repair role/name/firm/email drift while preserving the row ID and auth_user_id.
            updates = {
                key: record[key]
                for key in ("email", "firm_id", "full_name", "role", "active")
                if existing.get(key) != record[key]
            }
            if updates:
                update_one("profiles", str(existing["id"]), updates)
                changed += 1
        else:
            try:
                insert_many("profiles", [record])
                changed += 1
            except Exception:
                # Multiple instances may create the same demo profile at first start.
                # Only suppress the error if the profile now exists in the database.
                raced = one("profiles", filters=(("email", record["email"]),), columns="id,email,firm_id,full_name,role,active")
                if not raced:
                    raced = one("profiles", filters=(("id", record["id"]),), columns="id,email,firm_id,full_name,role,active")
                if not raced:
                    raise
    return changed


def seed_database() -> bool:
    """Idempotently seed missing demo rows and repair missing/drifted profiles.

    Unlike the old all-or-nothing check, an existing firm does not prevent the
    remaining tables or the demo profiles from being repaired. Existing project,
    invoice, milestone, and snapshot rows are left untouched.
    """
    records = build_seed_records()
    changed = 0
    changed += _insert_missing_by_id("firms", records["firms"])
    changed += _ensure_profiles(records["profiles"])
    changed += _insert_missing_by_id("projects", records["projects"])
    changed += _insert_missing_by_id("project_snapshots", records["project_snapshots"])
    changed += _insert_missing_by_id("milestones", records["milestones"])
    changed += _insert_missing_by_id("invoices", records["invoices"])
    return changed > 0
