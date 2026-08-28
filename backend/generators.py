"""
Mock enterprise telemetry + network topology generator, called by
POST /api/generate-mock-data.

Same external behavior as the original scaffold (clears and repopulates
Asset/telemetry/network data, returns (success, message)), rebuilt with
more realistic generation: threat levels are weighted (not uniform-random,
so most findings are LOW/MEDIUM with a smaller tail of CRITICAL, matching
real vuln-scan distributions), and the network topology is a hub-and-spoke
graph per business unit instead of a flat 20%-chance random coin flip
between every pair of assets - so /api/topology now returns something that
actually looks like a segmented enterprise network.
"""
import random
from datetime import datetime, timedelta

from faker import Faker
from sqlalchemy import delete
from sqlmodel import Session

from .models import Asset, EDRStatus, NetworkEdge, TelemetryLog, ThreatLevel

fake = Faker()

BUSINESS_UNITS = [
    "Payment Processing", "Retail Operations", "Customer Data Platform",
    "Corporate IT", "Cloud Infrastructure", "HR & Payroll",
]
ASSET_TYPES = ["Server", "Laptop", "Database", "Gateway", "IoT_Device"]
TELEMETRY_SOURCES = ["vulnerability_scanner", "siem", "iam", "edr", "cspm"]

THREAT_WEIGHTS = [
    (ThreatLevel.LOW, 0.30), (ThreatLevel.MEDIUM, 0.35),
    (ThreatLevel.HIGH, 0.25), (ThreatLevel.CRITICAL, 0.10),
]
EDR_WEIGHTS = [
    (EDRStatus.ACTIVE, 0.75), (EDRStatus.WARNING, 0.18), (EDRStatus.OFFLINE, 0.07),
]
SCORE_RANGES = {
    ThreatLevel.LOW: (0.5, 3.9), ThreatLevel.MEDIUM: (4.0, 6.9),
    ThreatLevel.HIGH: (7.0, 8.9), ThreatLevel.CRITICAL: (9.0, 10.0),
}


def _weighted(options):
    values, weights = zip(*options)
    return random.choices(values, weights=weights, k=1)[0]


def generate_mock_assets(num_assets: int = 25) -> list:
    assets = []
    for _ in range(num_assets):
        asset_type = random.choice(ASSET_TYPES)
        assets.append(Asset(
            name=f"{fake.word().capitalize()}-{asset_type}-{random.randint(100, 999)}",
            asset_type=asset_type,
            business_unit=random.choice(BUSINESS_UNITS),
            business_value=round(random.uniform(5000, 500000), 2),
            criticality_score=random.randint(10, 100),
        ))
    return assets


def generate_mock_telemetry(assets: list, num_logs_per_asset: int = 10) -> list:
    logs = []
    for asset in assets:
        for _ in range(num_logs_per_asset):
            level = _weighted(THREAT_WEIGHTS)
            timestamp = datetime.utcnow() - timedelta(days=random.randint(0, 30), hours=random.randint(0, 23))
            logs.append(TelemetryLog(
                asset_id=asset.id,
                timestamp=timestamp,
                vulnerability_score=round(random.uniform(*SCORE_RANGES[level]), 1),
                threat_level=level,
                edr_status=_weighted(EDR_WEIGHTS),
                source=random.choice(TELEMETRY_SOURCES),
                metadata_log={
                    "scan_id": f"SCAN-{random.randint(1000, 9999)}",
                    "open_ports": random.sample([22, 80, 443, 3306, 8080], k=random.randint(1, 3)),
                    "os_version": random.choice(["Ubuntu 20.04", "Windows Server 2022", "CentOS 7", "RedHat 8"]),
                    "compliance_scope": random.sample(
                        ["NIST CSF", "RBI Master Direction", "SEBI CSCRF"], k=random.randint(1, 2)
                    ),
                },
            ))
    return logs


def generate_network_edges(assets: list, extra_cross_unit_edges: int = 8) -> list:
    """Hub-and-spoke per business unit, plus a few cross-unit links for
    shared services - mirrors real network segmentation."""
    edges = []
    by_unit = {}
    for asset in assets:
        by_unit.setdefault(asset.business_unit, []).append(asset)

    hubs = []
    for unit_assets in by_unit.values():
        if not unit_assets:
            continue
        hub = max(unit_assets, key=lambda a: a.criticality_score)
        hubs.append(hub)
        for asset in unit_assets:
            if asset.id == hub.id:
                continue
            edges.append(NetworkEdge(
                source_asset_id=asset.id, target_asset_id=hub.id,
                weight=round(random.uniform(0.4, 1.0), 2),
            ))

    if len(hubs) > 1:
        max_possible = len(hubs) * (len(hubs) - 1) // 2
        used = set()
        for _ in range(min(extra_cross_unit_edges, max_possible)):
            for _attempt in range(10):
                a, b = random.sample(hubs, 2)
                pair = frozenset((a.id, b.id))
                if pair not in used:
                    used.add(pair)
                    edges.append(NetworkEdge(
                        source_asset_id=a.id, target_asset_id=b.id,
                        weight=round(random.uniform(0.1, 0.5), 2),
                    ))
                    break
    return edges


def populate_database(db: Session):
    """Clear and repopulate Asset/TelemetryLog/NetworkEdge with fresh mock
    data. Returns (success: bool, message: str), same as the original."""
    try:
        db.execute(delete(TelemetryLog))
        db.execute(delete(NetworkEdge))
        db.execute(delete(Asset))
        db.commit()

        assets = generate_mock_assets(num_assets=25)
        db.add_all(assets)
        db.commit()
        for asset in assets:
            db.refresh(asset)

        logs = generate_mock_telemetry(assets, num_logs_per_asset=10)
        edges = generate_network_edges(assets)
        db.add_all(logs)
        db.add_all(edges)
        db.commit()

        return True, f"Database populated: {len(assets)} assets, {len(logs)} telemetry logs, {len(edges)} network edges"
    except Exception as e:
        db.rollback()
        return False, str(e)
