from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class Asset(Base):
    __tablename__ = "assets"
    
    id = Column(String, primary_key=True, index=True) # e.g., 'SRV-01'
    asset_type = Column(String) # e.g., 'Server', 'Laptop', 'Database'
    business_value = Column(Float) # Financial value of the asset
    
    telemetry_logs = relationship("TelemetryLog", back_populates="asset")

class TelemetryLog(Base):
    __tablename__ = "telemetry_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), index=True)
    vulnerability_score = Column(Float)
    threat_level = Column(String)
    edr_status = Column(String)
    # Storing additional flexible data like EDR logs or scan results
    metadata_log = Column(JSON, nullable=True)
    
    asset = relationship("Asset", back_populates="telemetry_logs")

class NetworkTopology(Base):
    __tablename__ = "network_topology"
    
    id = Column(Integer, primary_key=True, index=True)
    version = Column(Integer, default=1, index=True) # To allow tracking changes over time
    adjacency_matrix = Column(JSON) # 2D array representing connectivity
    node_mapping = Column(JSON) # Maps matrix index to Asset ID, e.g., {0: "SRV-01", 1: "SRV-02"}
    timestamp = Column(DateTime, default=datetime.utcnow)

class RiskSimulation(Base):
    __tablename__ = "risk_simulations"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    expected_annual_loss = Column(Float)
    monte_carlo_distribution = Column(JSON) # To store the VaR curve data
    optimized_budget_allocation = Column(JSON) # Output from the 0/1 knapsack optimizer
