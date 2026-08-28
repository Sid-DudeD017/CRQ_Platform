import os
import sys

from sqlmodel import Session, create_engine
from backend.main import simulate_risk, generate_mock_data, RiskSimRequest
from backend.database import engine

def test():
    with Session(engine) as db:
        try:
            print("Generating mock data...")
            generate_mock_data(db)
            print("Mock data generated.")
            
            request = RiskSimRequest(budget=650000)
            res = simulate_risk(request, db)
            print("SUCCESS")
            # print(res)
        except Exception as e:
            print("ERROR")
            import traceback
            traceback.print_exc()

test()
