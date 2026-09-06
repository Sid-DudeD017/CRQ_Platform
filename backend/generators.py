"""
Mock enterprise telemetry + network topology generator, called by
POST /api/generate-mock-data.
"""
import random
from datetime import datetime, timedelta

from faker import Faker
from sqlalchemy import delete, or_
from sqlmodel import Session, select

from .models import Asset, EDRStatus, NetworkEdge, TelemetryLog, ThreatLevel

fake = Faker()

BUSINESS_UNITS = [
    "Payment Processing", "Retail Operations", "Customer Data Platform",
    "Corporate IT", "Cloud Infrastructure", "HR & Payroll",
]
ASSET_TYPES = ["Server", "Laptop", "Database", "Gateway", "IoT_Device"]
TELEMETRY_SOURCES = ["vulnerability_scanner", "siem", "iam", "edr", "cspm"]
SUBNETS = ["10.0.1.", "10.0.2.", "192.168.1."]

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
    for i in range(1, num_assets + 1):
        asset_type = random.choice(ASSET_TYPES)
        ip = f"{random.choice(SUBNETS)}{random.randint(2, 254)}"
        
        if asset_type == "Database":
            classification = random.choice(["PII", "PCI", "Critical"])
            criticality = "Tier 1"
            value = round(random.uniform(200000, 1000000), 2)
        elif asset_type == "Gateway":
            classification = "Public"
            criticality = "Tier 1"
            value = round(random.uniform(50000, 200000), 2)
        else:
            classification = random.choice(["Internal", "Public", "None"])
            criticality = random.choice(["Tier 2", "Tier 3"])
            value = round(random.uniform(5000, 50000), 2)

        assets.append(Asset(
            id=f"AST-{i:03d}",
            name=f"{fake.word().capitalize()}-{asset_type}-{random.randint(100, 999)}",
            asset_type=asset_type,
            business_unit=random.choice(BUSINESS_UNITS),
            business_value=value,
            criticality_score=random.randint(10, 100),
            ip_address=ip,
            data_classification=classification,
            business_criticality=criticality,
        ))
    return assets


def generate_mock_telemetry(assets: list, num_logs_per_asset: int = 10) -> list:
    logs = []
    for asset in assets:
        for _ in range(num_logs_per_asset):
            level = _weighted(THREAT_WEIGHTS)
            timestamp = datetime.utcnow() - timedelta(days=random.randint(0, 30), hours=random.randint(0, 23))
            
            metadata = {
                "scan_id": f"SCAN-{random.randint(1000, 9999)}",
                "open_ports": random.sample([22, 80, 443, 3306, 8080], k=random.randint(1, 3)),
                "os_version": random.choice(["Ubuntu 20.04", "Windows Server 2022", "CentOS 7", "RedHat 8"]),
                "compliance_scope": random.sample(
                    ["NIST CSF", "RBI Master Direction", "SEBI CSCRF"], k=random.randint(1, 2)
                ),
                "data_source": random.choice(["Splunk (SIEM)", "Wiz (CSPM)", "CrowdStrike (EDR)"]),
            }
            
            has_cves = random.random() < 0.4
            cves = [f"CVE-2023-{random.randint(1000,9999)}"] if has_cves else []
            cvss = round(random.uniform(4.0, 10.0), 1) if has_cves else 0.0
            patch = "Missing Critical" if cvss > 7.0 else "Up-to-date"

            logs.append(TelemetryLog(
                asset_id=asset.id,
                timestamp=timestamp,
                vulnerability_score=cvss if has_cves else round(random.uniform(*SCORE_RANGES[level]), 1),
                threat_level=level,
                edr_status=_weighted(EDR_WEIGHTS),
                source=random.choice(TELEMETRY_SOURCES),
                metadata_log=metadata,
                
                cve_ids=cves,
                cvss_score=cvss,
                patch_status=patch,
                event_frequency_24h=random.randint(0, 5),
                anomalous_access_flags=random.randint(0, 5),
                incident_alert_level=random.choice(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
                privilege_level=random.choice(["Admin", "Standard"]),
                excessive_permissions=random.random() < 0.2,
                mfa_active=random.random() > 0.1,
                edr_health_status=random.choice(["Healthy", "Warning", "Offline"]),
                host_compromise_flags=random.random() < 0.05,
                malware_alerts_24h=random.randint(0, 3),
                public_exposure_flag=(asset.data_classification == "Public"),
                cloud_misconfigurations_count=random.randint(0, 10),
                cisa_kev_presence=(cvss > 8.0 and random.random() < 0.3),
                threat_actor_chatter=random.choice(["None", "Low", "High"]),
            ))
    return logs


def generate_network_edges(assets: list, extra_cross_unit_edges: int = 8) -> list:
    """Network topology based on CMDB subnets, classifications, and business units."""
    edges = []
    used = set()
    num_assets = len(assets)
    
    for i in range(num_assets):
        for j in range(i + 1, num_assets):
            a1 = assets[i]
            a2 = assets[j]
            
            connected = False
            # 1. Gateway/Public assets connect to everything in their subnet
            if (a1.data_classification == "Public" or a2.data_classification == "Public") and (a1.ip_address and a2.ip_address and a1.ip_address[:6] == a2.ip_address[:6]):
                connected = True
            
            # 2. Tier 1 assets only talk to each other if they are on same subnet
            elif a1.business_criticality == "Tier 1" and a2.business_criticality == "Tier 1":
                if a1.ip_address and a2.ip_address and a1.ip_address[:7] == a2.ip_address[:7]:
                    connected = True
                    
            # 3. Hub-and-spoke fallback (Upstream Logic)
            elif a1.business_unit == a2.business_unit:
                if random.random() < 0.2:
                    connected = True
            
            # 4. Default minor cross-talk
            elif random.random() < 0.05:
                connected = True
                
            if connected:
                pair = frozenset((a1.id, a2.id))
                if pair not in used:
                    used.add(pair)
                    edges.append(NetworkEdge(
                        source_asset_id=a1.id, 
                        target_asset_id=a2.id,
                        weight=round(random.uniform(0.4, 1.0), 2),
                    ))
    return edges


def populate_database(db: Session):
    """
    Clear and repopulate the DEMO ('predefined') fleet only.

    [Own-Data / Demo isolation] This used to unconditionally wipe every
    Asset/TelemetryLog/NetworkEdge row in the database before
    regenerating - harmless when only demo data ever existed, but once
    the Ingestion Engine dashboard has its own 'own'-tagged Asset/
    TelemetryLog rows (see generate_own_data_seed/ensure_own_data_baseline
    below), clicking "Generate Demo Data" would silently delete someone's
    real ingested environment along with the demo fleet. Now scoped to
    rows tagged 'predefined' (or NULL, for rows created before this
    column existed) so it only ever touches the demo side. NetworkEdge has
    no data_source of its own - only the demo fleet ever creates edges
    (see generate_network_edges), so clearing all of them here stays safe.
    """
    try:
        predefined_assets = or_(Asset.data_source == "predefined", Asset.data_source.is_(None))
        predefined_logs = or_(TelemetryLog.data_source == "predefined", TelemetryLog.data_source.is_(None))
        db.execute(delete(TelemetryLog).where(predefined_logs))
        db.execute(delete(NetworkEdge))
        db.execute(delete(Asset).where(predefined_assets))
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


def generate_own_data_seed():
    """
    [Own-Data / Demo isolation] A small, fixed (not randomized) starter
    fleet for the "Enter your own data" dashboard, seeded once before any
    config has been uploaded through the Ingestion Engine. Deliberately
    moderate/neutral - not artificially clean, not artificially bad -
    because what's supposed to actually move this baseline is confirmed
    Ingestion Engine findings (see risk_engine.derive_fair_inputs'
    gap_deduction) and Training coverage, not randomization. Kept separate
    from generate_mock_assets' 25-asset randomized demo fleet so the two
    dashboards start from genuinely different data instead of secretly
    sharing one global pool.
    """
    assets = [
        Asset(id="OWN-001", name="Core Edge Router", asset_type="Gateway",
              business_unit="Cloud Infrastructure", business_value=180000.0,
              criticality_score=70, ip_address="10.20.0.1",
              data_classification="Public", business_criticality="Tier 1"),
        Asset(id="OWN-002", name="Core Distribution Switch", asset_type="Server",
              business_unit="Corporate IT", business_value=90000.0,
              criticality_score=60, ip_address="10.20.0.2",
              data_classification="Internal", business_criticality="Tier 2"),
        Asset(id="OWN-003", name="Application Server", asset_type="Server",
              business_unit="Retail Operations", business_value=140000.0,
              criticality_score=65, ip_address="10.20.1.10",
              data_classification="Internal", business_criticality="Tier 2"),
        Asset(id="OWN-004", name="Customer Database", asset_type="Database",
              business_unit="Customer Data Platform", business_value=650000.0,
              criticality_score=90, ip_address="10.20.1.20",
              data_classification="PII", business_criticality="Tier 1"),
        Asset(id="OWN-005", name="Public WAN Gateway", asset_type="Gateway",
              business_unit="Cloud Infrastructure", business_value=160000.0,
              criticality_score=75, ip_address="203.0.113.1",
              data_classification="Public", business_criticality="Tier 1"),
        Asset(id="OWN-006", name="Employee Endpoint Fleet", asset_type="Laptop",
              business_unit="HR & Payroll", business_value=45000.0,
              criticality_score=35, ip_address="10.20.9.0",
              data_classification="Internal", business_criticality="Tier 3"),
    ]
    for a in assets:
        a.data_source = "own"

    def _log(asset_id, vuln, mfa=True, patch="Up-to-date", cvss=0.0, exposure=False, misconfig=0):
        return TelemetryLog(
            asset_id=asset_id, vulnerability_score=vuln, threat_level=ThreatLevel.MEDIUM,
            edr_status=EDRStatus.ACTIVE, source="vulnerability_scanner",
            cvss_score=cvss, patch_status=patch,
            event_frequency_24h=1, anomalous_access_flags=0, incident_alert_level="LOW",
            privilege_level="Standard", excessive_permissions=False, mfa_active=mfa,
            edr_health_status="Healthy", host_compromise_flags=False, malware_alerts_24h=0,
            public_exposure_flag=exposure, cloud_misconfigurations_count=misconfig,
            cisa_kev_presence=False, threat_actor_chatter="None", data_source="own",
        )

    logs = [
        _log("OWN-001", 5.5, exposure=True),
        _log("OWN-002", 4.5),
        _log("OWN-003", 5.0),
        _log("OWN-004", 5.5, mfa=True),
        _log("OWN-005", 6.0, exposure=True, misconfig=1),
        _log("OWN-006", 4.0),
    ]
    return assets, logs


def ensure_own_data_baseline(db: Session) -> bool:
    """
    Lazily seeds generate_own_data_seed()'s starter fleet exactly once,
    the first time anything asks for 'own' data (see risk_engine.
    derive_fair_inputs). Checked by existence, never wipes or re-seeds -
    unlike populate_database above, this must never clobber real Asset/
    TelemetryLog state that a user's own Ingestion Engine confirmations
    may already be influencing. Returns True if it just seeded, False if
    'own' data already existed.
    """
    existing = db.exec(select(Asset).where(Asset.data_source == "own")).first()
    if existing:
        return False
    assets, logs = generate_own_data_seed()
    db.add_all(assets)
    db.commit()
    db.add_all(logs)
    db.commit()
    return True
