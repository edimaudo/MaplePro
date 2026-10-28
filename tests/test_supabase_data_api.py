from app.config import settings
from app import database


class FakeResponse:
    status_code = 200
    content = b'[{"id":"p-1"}]'

    def json(self):
        return [{"id": "p-1"}]


class FakeHttpClient:
    def __init__(self):
        self.last = None

    def request(self, *args, **kwargs):
        self.last = (args, kwargs)
        return FakeResponse()


def test_select_uses_existing_supabase_url_and_api_key(monkeypatch):
    fake = FakeHttpClient()
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_api_key", "configured-key")
    monkeypatch.setattr(database, "_http_client", lambda: fake)

    result = database.rows(
        "projects",
        filters=(("firm_id", "firm-northline"),),
        in_filters=(("project_id", ["p-1", "p-2"]),),
        order="target_completion:asc",
        limit=10,
    )

    args, kwargs = fake.last
    assert result == [{"id": "p-1"}]
    assert args[0] == "GET"
    assert args[1] == "https://example.supabase.co/rest/v1/projects"
    assert kwargs["headers"]["apikey"] == "configured-key"
    assert kwargs["headers"]["Authorization"] == "Bearer configured-key"
    assert ("firm_id", "eq.firm-northline") in kwargs["params"]
    assert ("order", "target_completion.asc") in kwargs["params"]
    assert ("limit", "10") in kwargs["params"]


def test_empty_in_filter_short_circuits_without_network(monkeypatch):
    def fail_if_called():
        raise AssertionError("No request should be made for an empty IN filter")

    monkeypatch.setattr(database, "_http_client", fail_if_called)
    assert database.rows("projects", in_filters=(("id", []),)) == []
