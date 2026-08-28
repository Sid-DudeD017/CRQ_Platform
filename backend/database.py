"""
Database engine and session management using SQLModel (SQLAlchemy +
Pydantic in one). Neon Postgres in production; local SQLite by default so
the whole team can run this with zero setup.

Compatibility notes:
- `SessionLocal` is kept as a callable session factory (`db =
  SessionLocal()`) because ai-agent/tools.py's query_telemetry tool
  instantiates a session directly, rather than going through FastAPI's
  Depends(get_db). It's built with sqlmodel.Session as its class, so
  sessions it produces behave identically to ones get_db() yields.
- Accepts both DATABASE_URL (used elsewhere in this project) and
  NEON_DATABASE_URL (the original scaffold's name) so nobody's existing
  .env breaks either way.
"""
import os

from dotenv import load_dotenv
from sqlalchemy.orm import sessionmaker
from sqlmodel import Session, SQLModel, create_engine

# Loads backend/.env if present (e.g. DATABASE_URL for Neon Postgres).
# Never overrides a real env var already set in the shell.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("NEON_DATABASE_URL") or "sqlite:///./crq_db.sqlite3"

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)

# Callable session factory for code that instantiates a session directly
# (see module docstring) rather than through the get_db() dependency below.
SessionLocal = sessionmaker(class_=Session, bind=engine, autocommit=False, autoflush=False)


def init_db() -> None:
    """Create all tables. Safe to call more than once (no-ops on existing tables)."""
    from . import models  # noqa: F401 - populate metadata before create_all
    SQLModel.metadata.create_all(engine)


def get_db():
    """FastAPI dependency: `db: Session = Depends(get_db)`."""
    with Session(engine) as session:
        yield session
