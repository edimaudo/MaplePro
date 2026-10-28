from app.config import Settings
from app.database import rows


def test_supabase_url_and_api_key_are_the_only_database_configuration(monkeypatch):
    cfg = Settings()
    monkeypatch.setattr(cfg, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(cfg, "supabase_api_key", "test-api-key")
    assert cfg.supabase_configured is True


def test_database_configuration_is_missing_without_supabase_url_or_key(monkeypatch):
    cfg = Settings()
    monkeypatch.setattr(cfg, "supabase_url", "")
    monkeypatch.setattr(cfg, "supabase_api_key", "")
    assert cfg.supabase_configured is False


def test_rows_returns_empty_for_empty_in_filter_without_network(monkeypatch):
    # Empty filters should short-circuit instead of sending an invalid PostgREST IN clause.
    assert rows("projects", in_filters=(("id", []),)) == []
