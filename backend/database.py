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
from sqlalchemy import inspect, text
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


def _add_missing_columns() -> None:
    """
    SQLModel.metadata.create_all() only creates tables that don't exist
    yet - it never alters a table that's already there. So the first time
    a field is added to an existing model (e.g. RiskSimulation gaining
    active_controls/sebi_resilience/var_99, or any future field on any
    other table), every database that already has that table keeps the
    old schema forever, and the very next insert fails with something
    like 'column "active_controls" of relation "risksimulation" does not
    exist' (Postgres) or 'table risksimulation has no column named
    active_controls' (SQLite) - which is exactly the "simulation failing
    to fetch" symptom this fixes. There's no Alembic in this project, so
    rather than requiring a manual migration step, this does the minimal
    safe thing on every startup: for every SQLModel table that already
    exists, diff its live columns against the model and ADD COLUMN any
    that are missing. It only ever adds nullable columns, never drops or
    changes one, and each column gets its own transaction so one failure
    (e.g. insufficient DB permissions) can't block the others or crash
    startup - it's logged and the app continues.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table_name, table in SQLModel.metadata.tables.items():
        if table_name not in existing_tables:
            continue  # brand-new table - create_all() above already made it
        existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
        for col in table.columns:
            if col.name in existing_cols:
                continue
            try:
                col_type = col.type.compile(dialect=engine.dialect)
                with engine.begin() as conn:
                    conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN "{col.name}" {col_type}'))
                print(f"[init_db] Added missing column {table_name}.{col.name} ({col_type})")
            except Exception as e:
                print(f"[init_db] Could not add column {table_name}.{col.name}: {e}")


def _add_missing_indexes() -> None:
    """
    [Performance - fix] Companion to _add_missing_columns above, and for
    the identical reason: SQLModel.metadata.create_all() only creates
    indexes as part of creating a brand-new table - it never retrofits an
    index onto a table that already exists. So marking a field
    `index=True` on a model (as this session's fix just did for every
    table's `data_source` column, to speed up the owner_email +
    data_source filters every 'own data' query in main.py runs) would
    silently do nothing for anyone whose database already existed before
    that change. This diffs each table's live indexes against which
    columns the model declares `index=True` for for and adds any that are
    missing - additive only, never drops or rebuilds an existing index,
    and (like _add_missing_columns) isolates each attempt so one failure
    can't block the others or crash startup.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table_name, table in SQLModel.metadata.tables.items():
        if table_name not in existing_tables:
            continue
        existing_indexed_cols = set()
        for idx in inspector.get_indexes(table_name):
            cols = idx.get("column_names") or []
            if len(cols) == 1 and cols[0]:
                existing_indexed_cols.add(cols[0])
        for col in table.columns:
            if not col.index or col.name in existing_indexed_cols or col.primary_key:
                continue
            index_name = f"ix_crq_autofix_{table_name}_{col.name}"
            try:
                with engine.begin() as conn:
                    conn.execute(text(f'CREATE INDEX IF NOT EXISTS "{index_name}" ON "{table_name}" ("{col.name}")'))
                print(f"[init_db] Added missing index {index_name} on {table_name}.{col.name}")
            except Exception as e:
                print(f"[init_db] Could not add index on {table_name}.{col.name}: {e}")


def init_db() -> None:
    """Create all tables, then repair any that already existed under an
    older schema (see _add_missing_columns/_add_missing_indexes). Safe to
    call more than once."""
    from . import models  # noqa: F401 - populate metadata before create_all
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    _add_missing_indexes()


def get_db():
    """FastAPI dependency: `db: Session = Depends(get_db)`."""
    with Session(engine) as session:
        yield session
