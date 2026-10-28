"""Supabase PostgreSQL connection management.

MaplePro intentionally has no local-file database fallback. Configure DATABASE_URL
with the project's Supabase PostgreSQL connection string in every environment.
"""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    """Declarative base for model metadata; schema is managed by Supabase SQL."""


def parse_database_url(raw_url: str | None) -> URL:
    """Validate and normalize the required Supabase PostgreSQL URL."""
    if not raw_url or not raw_url.strip():
        raise RuntimeError(
            "DATABASE_URL is required. Configure the Supabase PostgreSQL connection string "
            "in the environment before starting MaplePro. Local SQLite databases are not supported."
        )

    value = raw_url.strip()
    if value.startswith("postgres://"):
        value = "postgresql://" + value[len("postgres://"):]

    try:
        url = make_url(value)
    except Exception as exc:
        raise RuntimeError("DATABASE_URL is not a valid database connection URL.") from exc

    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")

    if url.drivername != "postgresql+psycopg":
        raise RuntimeError(
            "MaplePro requires Supabase PostgreSQL via the psycopg driver. "
            "Set DATABASE_URL to your Supabase PostgreSQL connection string; other database engines are unsupported."
        )
    if not url.host or not url.database:
        raise RuntimeError("DATABASE_URL must include the Supabase database host and database name.")

    # Supabase requires TLS. Keep it on when a connection string omits sslmode.
    query = dict(url.query)
    if query.get("sslmode", "").lower() == "disable":
        raise RuntimeError("DATABASE_URL must use SSL for Supabase PostgreSQL; sslmode=disable is not supported.")
    query.setdefault("sslmode", "require")
    return url.set(query=query)


@lru_cache(maxsize=1)
def get_engine():
    """Return a process-local engine, created only after validating configuration."""
    url = parse_database_url(settings.database_url)
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=0,
        pool_recycle=300,
        # Safe with Supavisor/PgBouncer transaction pooling used by some serverless deployments.
        connect_args={"prepare_threshold": None},
    )


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db():
    db = get_session_factory()()
    try:
        yield db
    finally:
        db.close()
