from __future__ import annotations

import pytest

import app.main as main


def _counts_for_demo(table: str, expected: dict[str, int]) -> list[dict[str, str]]:
    return [{"id": f"{table}-{index}"} for index in range(expected[table])]


def test_demo_workspace_is_seeded_and_verified_once(monkeypatch):
    expected = {
        "profiles": 4,
        "projects": 8,
        "invoices": 32,
        "milestones": 32,
        "project_snapshots": 48,
    }
    calls = {"schema": 0, "seed": 0}

    monkeypatch.setattr(main.settings, "demo_mode", True)
    monkeypatch.setattr(main, "_demo_workspace_ready", False)
    monkeypatch.setattr(main, "check_schema", lambda: calls.__setitem__("schema", calls["schema"] + 1))
    monkeypatch.setattr(main, "seed_database", lambda: calls.__setitem__("seed", calls["seed"] + 1))
    monkeypatch.setattr(main, "rows", lambda table, **kwargs: _counts_for_demo(table, expected))

    main.initialize_workspace_data()
    main.initialize_workspace_data()

    assert calls == {"schema": 1, "seed": 1}
    assert main._demo_workspace_ready is True


def test_demo_workspace_fails_clearly_if_seed_did_not_populate_data(monkeypatch):
    monkeypatch.setattr(main.settings, "demo_mode", True)
    monkeypatch.setattr(main, "_demo_workspace_ready", False)
    monkeypatch.setattr(main, "check_schema", lambda: None)
    monkeypatch.setattr(main, "seed_database", lambda: None)

    def empty_rows(table, **kwargs):
        return []

    monkeypatch.setattr(main, "rows", empty_rows)

    with pytest.raises(RuntimeError, match="could not finish preparing the demo workspace"):
        main.initialize_workspace_data()
