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


def test_seed_repairs_profiles_when_firm_already_exists(monkeypatch):
    import app.seed as seed

    inserted = []

    def fake_rows(table, *, filters=(), in_filters=(), order=None, limit=None, columns="*"):
        if table == "firms":
            return [{"id": seed.FIRM_ID}]
        return []

    def fake_one(table, *, filters, columns="*"):
        return None

    def fake_insert_many(table, values):
        inserted.append((table, list(values)))
        return values

    monkeypatch.setattr(seed, "rows", fake_rows)
    monkeypatch.setattr(seed, "one", fake_one)
    monkeypatch.setattr(seed, "insert_many", fake_insert_many)
    monkeypatch.setattr(seed, "update_one", lambda *args, **kwargs: None)

    assert seed.seed_database() is True
    assert sum(len(values) for table, values in inserted if table == "profiles") == 4
    # Missing related data also gets restored; an existing firm no longer short-circuits.
    assert {table for table, _ in inserted} >= {"profiles", "projects", "project_snapshots", "milestones", "invoices"}
