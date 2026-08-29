from sqlalchemy import create_engine
from sqlalchemy.orm import Session
import backend.generators as generators
import backend.models as models

engine = create_engine("sqlite:///crq_db.sqlite3")
models.Base.metadata.create_all(bind=engine)
with Session(engine) as session:
    success, msg = generators.populate_database(session)
    print("Result:", msg)
