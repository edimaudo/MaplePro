import pytest
from sqlalchemy.engine import URL

from app.database import parse_database_url


def test_database_url_is_required():
    with pytest.raises(RuntimeError, match="DATABASE_URL is required"):
        parse_database_url("")


def test_sqlite_is_rejected():
    with pytest.raises(RuntimeError, match="requires Supabase PostgreSQL"):
        parse_database_url("sqlite:///maplepro.db")


def test_postgres_url_is_normalized_to_psycopg():
    url = parse_database_url("postgresql://postgres:secret@example.supabase.co:5432/postgres?sslmode=require")
    assert isinstance(url, URL)
    assert url.drivername == "postgresql+psycopg"
    assert url.host == "example.supabase.co"
    assert url.database == "postgres"
    assert url.query["sslmode"] == "require"


def test_legacy_postgres_scheme_is_normalized():
    url = parse_database_url("postgres://postgres:secret@example.supabase.co:5432/postgres")
    assert url.drivername == "postgresql+psycopg"
    assert url.query["sslmode"] == "require"


def test_insecure_postgres_connection_is_rejected():
    with pytest.raises(RuntimeError, match="must use SSL"):
        parse_database_url("postgresql://postgres:secret@example.supabase.co:5432/postgres?sslmode=disable")
