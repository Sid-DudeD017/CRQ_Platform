import random
from datetime import datetime, timedelta
import json
import logging
from .models import Asset, TelemetryLog, NetworkTopology

logger = logging.getLogger(__name__)

ASSET_TYPES = ["Server", "Laptop", "Database", "Gateway", "IoT_Device"]
THREAT_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
EDR_STATUSES = ["ACTIVE", "WARNING", "OFFLINE"]

def generate_mock_assets(num_assets=20):
    assets = []
    for i in range(1, num_assets + 1):
        asset = Asset(
            id=f"AST-{i:03d}",
            asset_type=random.choice(ASSET_TYPES),
            business_value=round(random.uniform(5000, 500000), 2)
        )
        assets.append(asset)
    return assets

def generate_mock_telemetry(assets, num_logs_per_asset=5):
    logs = []
    for asset in assets:
        for _ in range(num_logs_per_asset):
            timestamp = datetime.utcnow() - timedelta(days=random.randint(0, 30), hours=random.randint(0, 23))
            
            # Metadata depends on asset type
            metadata = {
                "scan_id": f"SCAN-{random.randint(1000, 9999)}",
                "open_ports": random.sample([22, 80, 443, 3306, 8080], k=random.randint(1, 3)),
                "os_version": random.choice(["Ubuntu 20.04", "Windows Server 2022", "CentOS 7", "RedHat 8"]),
                "data_source": random.choice(["Splunk (SIEM)", "Wiz (CSPM)", "CrowdStrike (EDR)"]),
                "compliance_scope": random.sample(["NIST CSF", "RBI Master Direction", "SEBI CSCRF"], k=random.randint(1, 2))
            }
            
            log = TelemetryLog(
                asset_id=asset.id,
                timestamp=timestamp,
                vulnerability_score=round(random.uniform(1.0, 10.0), 1),
                threat_level=random.choice(THREAT_LEVELS),
                edr_status=random.choice(EDR_STATUSES),
                metadata_log=metadata
            )
            logs.append(log)
    return logs

def generate_network_topology(assets):
    """
    Generate an Adjacency Matrix mathematically modeling the network topology.
    Using simple random connectivity for mock purposes.
    """
    num_assets = len(assets)
    # node_mapping: {0: "AST-001", 1: "AST-002", ...}
    node_mapping = {i: asset.id for i, asset in enumerate(assets)}
    
    # Initialize nxn matrix with 0s
    matrix = [[0 for _ in range(num_assets)] for _ in range(num_assets)]
    
    for i in range(num_assets):
        for j in range(i + 1, num_assets):
            # 20% chance of a connection between any two nodes
            if random.random() < 0.20:
                # Store weight/strength of connection if needed, using 1 for binary connectivity
                matrix[i][j] = 1
                matrix[j][i] = 1 # Undirected graph for this example
    
    topology = NetworkTopology(
        version=1,
        adjacency_matrix=matrix,
        node_mapping=node_mapping
    )
    
    return topology

def populate_database(db):
    """
    Utility function to clear and populate the database with mock data.
    """
    try:
        # Clear existing data
        db.query(TelemetryLog).delete()
        db.query(Asset).delete()
        db.query(NetworkTopology).delete()
        db.commit()
        
        # Generate new data
        assets = generate_mock_assets(num_assets=25)
        db.add_all(assets)
        db.flush() # flush to ensure assets are saved before telemetry
        
        logs = generate_mock_telemetry(assets, num_logs_per_asset=10)
        db.add_all(logs)
        
        topology = generate_network_topology(assets)
        db.add(topology)
        
        db.commit()
        return True, "Database populated successfully"
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to populate database: {e}")
        return False, str(e)
