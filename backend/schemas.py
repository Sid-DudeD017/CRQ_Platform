from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class AssetSchema(BaseModel):
    id: str = Field(..., description="Asset ID mapped to CMDB")
    asset_type: str
    ip_address: Optional[str] = None
    data_classification: Optional[str] = Field(None, description="e.g., PII, PHI, Public")
    business_criticality: Optional[str] = Field(None, description="e.g., Tier 1, Tier 2")
    business_value: float
    
    class Config:
        orm_mode = True

class TelemetryLogSchema(BaseModel):
    id: int
    asset_id: str
    timestamp: datetime
    
    # 1. Vulnerability Management
    cve_ids: Optional[List[str]] = []
    cvss_score: Optional[float] = None
    patch_status: Optional[str] = None
    
    # 2. SIEM
    event_frequency_24h: int = 0
    anomalous_access_flags: int = 0
    incident_alert_level: Optional[str] = None
    
    # 3. IAM
    privilege_level: Optional[str] = None
    excessive_permissions: bool = False
    mfa_active: bool = True
    
    # 4. EDR
    edr_health_status: Optional[str] = None
    host_compromise_flags: bool = False
    malware_alerts_24h: int = 0
    
    # 5. CSPM
    public_exposure_flag: bool = False
    cloud_misconfigurations_count: int = 0
    
    # 7. Threat Intel
    cisa_kev_presence: bool = False
    threat_actor_chatter: Optional[str] = None

    # Legacy fields
    vulnerability_score: float
    threat_level: str
    edr_status: str
    metadata_log: Optional[Dict[str, Any]] = None

    class Config:
        orm_mode = True
