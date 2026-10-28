from app.seed import build_seed_records


def test_seed_dataset_has_expected_related_records():
    data = build_seed_records()
    assert len(data["firms"]) == 1
    assert len(data["profiles"]) == 4
    assert len(data["projects"]) == 8
    assert len(data["project_snapshots"]) == 48
    assert len(data["milestones"]) == 32
    assert len(data["invoices"]) == 32
    project_ids = {project["id"] for project in data["projects"]}
    assert {row["project_id"] for row in data["project_snapshots"]} == project_ids
    assert {row["project_id"] for row in data["milestones"]} == project_ids
    assert {row["project_id"] for row in data["invoices"]} == project_ids
