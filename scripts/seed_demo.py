"""Seed the synthetic MaplePro demo dataset into the configured Supabase database.

Run this explicitly after applying supabase/schema.sql. This script does not create
or migrate tables and does not support local-file databases.
"""
from pathlib import Path
import sys

from sqlalchemy import inspect, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.database import get_engine, get_session_factory
from app.seed import seed_database

REQUIRED_TABLES = {
    "firms", "profiles", "projects", "invoices", "milestones",
    "project_snapshots", "payment_events",
}

if __name__ == "__main__":
    engine = get_engine()
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    inspector = inspect(engine)
    missing = sorted(table for table in REQUIRED_TABLES if not inspector.has_table(table, schema="public"))
    if missing:
        raise SystemExit(
            "Supabase schema is missing required tables. Run supabase/schema.sql first. Missing: "
            + ", ".join(missing)
        )
    with get_session_factory()() as db:
        seed_database(db)
    print("Supabase demo seed completed. Existing firms are left unchanged; seed is idempotent.")
