from datetime import date, timedelta
import pytest
from fastapi import HTTPException
from app import main


def test_replan_updates_only_open_milestones_in_the_requested_project(monkeypatch):
    principal = main.Principal(user_id="u1", email="manager@example.com", name="Project Manager", role="project_manager", firm_id="f1")
    project = {"id": "p1", "name": "Northstar"}
    milestones = [
        {"id": "m1", "project_id": "p1", "title": "Structure", "planned_date": "2026-11-10", "status": "In progress", "progress_pct": 35},
        {"id": "m2", "project_id": "p1", "title": "Finishes", "planned_date": "2026-11-24", "status": "Upcoming", "progress_pct": 0},
        {"id": "m3", "project_id": "p1", "title": "Handover", "planned_date": "2026-12-01", "status": "Complete", "progress_pct": 100},
        {"id": "m4", "project_id": "p2", "title": "Other project", "planned_date": "2026-11-20", "status": "Upcoming", "progress_pct": 0},
    ]
    monkeypatch.setattr(main, "_gather_records", lambda _principal: ([project], [], milestones, [], [], [], []))
    updates = []
    def fake_update(table, row_id, values):
        updates.append((table, row_id, values))
        return {"id": row_id, **values}
    monkeypatch.setattr(main, "update_one", fake_update)
    body = main.ReplanProjectRequest(milestones=[
        main.ReplanMilestoneDate(id="m1", planned_date=date(2026, 11, 12)),
        main.ReplanMilestoneDate(id="m2", planned_date=date(2026, 11, 26)),
    ])
    result = main.replan_project("p1", body, principal)
    assert result["updated_count"] == 2
    assert [item[1] for item in updates] == ["m1", "m2"]


def test_replan_rejects_completed_milestones(monkeypatch):
    principal = main.Principal(user_id="u1", email="manager@example.com", name="Project Manager", role="project_manager", firm_id="f1")
    project = {"id": "p1", "name": "Northstar"}
    milestones = [{"id": "m1", "project_id": "p1", "title": "Handover", "planned_date": "2026-11-10", "status": "Complete", "progress_pct": 100}]
    monkeypatch.setattr(main, "_gather_records", lambda _principal: ([project], [], milestones, [], [], [], []))
    body = main.ReplanProjectRequest(milestones=[main.ReplanMilestoneDate(id="m1", planned_date=date(2026, 11, 12))])
    with pytest.raises(HTTPException) as error:
        main.replan_project("p1", body, principal)
    assert error.value.status_code == 409


def test_replan_is_restricted_to_project_managers(monkeypatch):
    principal = main.Principal(user_id="u1", email="client@example.com", name="Client", role="client", firm_id="f1")
    body = main.ReplanProjectRequest(milestones=[main.ReplanMilestoneDate(id="m1", planned_date=date(2026, 11, 12))])
    with pytest.raises(HTTPException) as error:
        main.replan_project("p1", body, principal)
    assert error.value.status_code == 403
