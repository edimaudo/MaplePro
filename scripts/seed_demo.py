"""Load the synthetic MaplePro demo data into the configured Supabase project."""
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.database import check_schema
from app.seed import seed_database

if __name__ == "__main__":
    check_schema()
    inserted = seed_database()
    if inserted:
        print("Supabase demo data checked and repaired: missing demo profiles and related records were added; existing project data was preserved.")
    else:
        print("Supabase demo data is complete; no rows needed repair.")
