from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from sqlalchemy.orm import Session
from .models import Firm, UserProfile, Project, Invoice, Milestone, ProjectSnapshot
from .config import settings

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
    # Approximate monthly snapshots without an additional dependency.
    return d - timedelta(days=30 * months)


def seed_database(db: Session) -> None:
    if db.query(Firm).first():
        return
    today = date.today()
    db.add(Firm(id=FIRM_ID, name=settings.firm_name))
    users = [
        ("usr-admin", "admin@maplepro.demo", "Alex Morgan", "admin"),
        ("usr-manager", "manager@maplepro.demo", "Olivia Chen", "project_manager"),
        ("usr-client", "client@maplepro.demo", "Jordan Blake", "client"),
        ("usr-subcontractor", "subcontractor@maplepro.demo", "Sam Patel", "subcontractor"),
    ]
    for uid, email, name, role in users:
        db.add(UserProfile(id=uid, auth_user_id=None, firm_id=FIRM_ID, email=email, full_name=name, role=role, active=True))

    for index, raw in enumerate(PROJECT_DATA):
        p = Project(
            id=raw["id"], firm_id=FIRM_ID, code=raw["code"], name=raw["name"],
            client_name=raw["client_name"], client_email=raw["client_email"],
            project_manager=raw["manager"], assigned_subcontractor_email=raw["sub"],
            location=raw["location"], status="In progress", stage=raw["stage"],
            budget=raw["budget"], actual_cost=raw["actual"], committed_costs=raw["committed"],
            progress_pct=raw["progress"], start_date=today + timedelta(days=raw["start_offset"]),
            target_completion=today + timedelta(days=raw["finish_offset"]), description=raw["description"],
        )
        db.add(p)
        # Six snapshots allow the forecast logic to use a synthetic historical trend from day one.
        for m in range(5, -1, -1):
            fraction = (6 - m) / 6
            progress = max(3.0, raw["progress"] - m * (5.0 + (index % 3)))
            cost = raw["actual"] * (progress / max(raw["progress"], 1))
            plan_gap = (10 if index in (2, 3, 5) else 2) * fraction
            planned = min(100.0, progress + plan_gap)
            db.add(ProjectSnapshot(
                id=f"snap-{raw['id']}-{m}", firm_id=FIRM_ID, project_id=raw["id"],
                snapshot_date=_months_before(today, m), actual_cost=round(cost, 2),
                progress_pct=round(progress, 1), planned_progress_pct=round(planned, 1),
                committed_costs=round(raw["committed"] * progress / 100, 2),
            ))

        milestone_names = ["Design & permits", "Structural / rough-in", "MEP & finishes", "Inspection and handover"]
        date_fracs = [0.12, 0.42, 0.76, 1.0]
        for j, (title, frac) in enumerate(zip(milestone_names, date_fracs)):
            planned = p.start_date + timedelta(days=max(30, int((p.target_completion - p.start_date).days * frac)))
            if j == 3:
                planned = p.target_completion
            complete = (j == 0) or (j == 1 and raw["progress"] > 55) or (j == 2 and raw["progress"] > 88)
            delayed = (index in (3, 5) and j == 2 and raw["progress"] < 90)
            status = "Complete" if complete else ("At risk" if delayed or (planned < today and not complete) else "Upcoming")
            progress = 100.0 if complete else (min(95.0, max(5.0, raw["progress"] - j * 18)) if j < 3 else raw["progress"])
            db.add(Milestone(
                id=f"mil-{raw['id']}-{j+1}", firm_id=FIRM_ID, project_id=raw["id"], title=title,
                planned_date=planned, actual_date=planned if complete else None,
                progress_pct=progress, status=status,
            ))

        # Three client invoices per project plus a subcontractor invoice.
        invoice_specs = [
            ("client_invoice", raw["client_name"], raw["client_email"], "Progress billing", raw["budget"] * 0.12),
            ("client_invoice", raw["client_name"], raw["client_email"], "Materials and site work", raw["budget"] * 0.08),
            ("client_invoice", raw["client_name"], raw["client_email"], "Milestone payment", raw["budget"] * 0.06),
            ("subcontractor_invoice", "Northline Trade Services", raw["sub"], "Subcontractor work claim", raw["budget"] * 0.035),
        ]
        for j, (kind, recipient, email, desc, amount) in enumerate(invoice_specs):
            if j == 0:
                status = "OVERDUE" if index in (0, 3, 5) else ("PAID" if index in (1, 2, 6) else "SENT")
                due = today - timedelta(days=[14, 24, 8, 31, 19, 16, 6, 12][index])
            elif j == 1:
                status = "PAID" if index in (0, 1, 4, 7) else ("OVERDUE" if index in (2, 5) else "SENT")
                due = today - timedelta(days=[35, 28, 9, 4, 40, 13, 3, 18][index])
            elif j == 2:
                status = "PAID" if index in (0, 2, 4) else "SENT"
                due = today + timedelta(days=7 + index * 2)
            else:
                status = "PAID" if index % 3 == 0 else ("OVERDUE" if index in (1, 3, 5) else "SENT")
                due = today - timedelta(days=10 + index * 2) if status == "OVERDUE" else today + timedelta(days=12 + index * 3)
            due = due if status != "PAID" else today - timedelta(days=4 + j * 3)
            inv = Invoice(
                id=f"inv-{raw['id']}-{j+1}", firm_id=FIRM_ID, project_id=raw["id"],
                invoice_number=f"MP-2026-{index*4+j+101:04d}", invoice_type=kind,
                recipient_name=recipient, recipient_email=email,
                description=desc, amount=round(amount, 2), currency_code="CAD",
                issued_date=due - timedelta(days=30), due_date=due,
                status=status, paypal_invoice_id=None, paypal_view_url=None,
                reminders_sent=(1 if status == "OVERDUE" and j == 0 else 0),
                paid_at=datetime.now(timezone.utc) - timedelta(days=2) if status == "PAID" else None,
            )
            db.add(inv)
    db.commit()
