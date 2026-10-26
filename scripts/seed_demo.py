"""Explicitly seed the synthetic MaplePro demo records into the configured database."""
from app.database import Base, engine, SessionLocal
from app.seed import seed_database

if __name__ == '__main__':
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_database(db)
    print('Seed routine finished. Existing firms are left unchanged; seed is idempotent.')
