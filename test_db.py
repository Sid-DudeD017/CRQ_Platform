from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlmodel import select
import backend.models as models

engine = create_engine("sqlite:///crq_db.sqlite3")
with Session(engine) as session:
    try:
        decisions = session.execute(select(models.RiskDecision).limit(5)).all()
        print("Success:", decisions)
    except Exception as e:
        print("DB Error:", e)
