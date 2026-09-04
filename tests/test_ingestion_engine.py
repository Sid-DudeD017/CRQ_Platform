"""
Unit coverage for backend/ingestion_engine.parse_config - the rule-based
config parser behind the Ingestion Engine page. Pure function, no DB, so
these run instantly and offline. One case per rule (both the
control_present and control_gap sides), the BGP-neighbor-auth heuristic's
positive and negative cases, a couple of "must NOT fire" negative checks,
and one end-to-end pass over a realistic sample config as a regression
guard for exact finding count / ordering / no-duplicates.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend import ingestion_engine as ie  # noqa: E402


def test_each_control_present_rule_fires():
    cases = [
        ("ip verify unicast source reachable-via rx", "Enforce Anti-Spoofing (uRPF)", 0.95),
        ("service password-encryption", "Password Encryption Enabled", 0.92),
        ("ip http secure-server", "Management Plane Hardening (HTTPS-only)", 0.85),
        ("switchport port-security", "Port Security Enabled", 0.85),
        ("logging host 10.0.0.50", "Centralized Logging (SIEM Integration)", 0.85),
        ("ntp server 10.0.0.1", "NTP Time Synchronization", 0.75),
    ]
    for line, expected_param, expected_conf in cases:
        findings = ie.parse_config(line)
        assert len(findings) == 1, (line, findings)
        f = findings[0]
        assert f.parameter == expected_param
        assert f.kind == "control_present"
        assert f.severity == "info"
        assert f.confidence == expected_conf


def test_each_control_gap_rule_fires_critical():
    cases = [
        ("snmp-server community public RO", "Default/Weak SNMP Community String"),
        ("snmp-server community private RO", "Default/Weak SNMP Community String"),
        ("enable password cisco123", "Cleartext Enable Password (use 'enable secret')"),
    ]
    for line, expected_param in cases:
        findings = ie.parse_config(line)
        assert len(findings) == 1, (line, findings)
        f = findings[0]
        assert f.parameter == expected_param
        assert f.kind == "control_gap"
        assert f.severity == "critical"


def test_stronger_config_is_not_flagged_as_a_gap():
    """A non-default SNMP string and a hashed 'enable secret' must not
    trip the weak-SNMP / cleartext-password gap rules."""
    assert ie.parse_config("snmp-server community S3cur3Str1ng RO") == []
    assert ie.parse_config("enable secret $1$abc$def") == []


def test_port_security_maximum_line_does_not_double_match():
    """Regression guard: 'switchport port-security maximum 2' used to also
    match the bare 'switchport port-security' rule, producing two findings
    for one control."""
    config = "switchport port-security\nswitchport port-security maximum 2\n"
    findings = ie.parse_config(config)
    assert len(findings) == 1
    assert findings[0].line_number == 1


def test_bgp_neighbor_auth_heuristic_positive_and_negative():
    config = (
        "router bgp 65000\n"
        " neighbor 10.0.1.2 remote-as 65001\n"
        " neighbor 10.0.1.2 description Core-Router-B\n"
        " neighbor 10.0.2.2 remote-as 65002\n"
        " neighbor 10.0.2.2 password S3cur3BgpKey!\n"
    )
    findings = ie.parse_config(config)
    bgp_findings = [f for f in findings if f.parameter == "BGP Neighbor Authentication (Missing)"]
    assert len(bgp_findings) == 1
    assert "10.0.1.2" in bgp_findings[0].rationale
    assert "10.0.2.2" not in bgp_findings[0].rationale


def test_empty_and_no_match_content_produce_no_findings():
    assert ie.parse_config("") == []
    assert ie.parse_config("hostname SONiC-CORE-04\ninterface Ethernet0\n") == []


def test_full_sample_config_end_to_end():
    """Regression guard against the generated SONiC sample config: exactly
    9 findings (8 line-rule matches + 1 BGP-auth gap), sorted by line
    number, no duplicate line numbers."""
    sample = """! SONiC OS Configuration
! Core Switch - Data Center Rack 04
!
hostname SONiC-CORE-04
!
enable password cisco123
!
service password-encryption
!
snmp-server community public RO
!
ip http secure-server
!
logging host 10.0.0.50
!
ntp server 10.0.0.1
!
interface Ethernet0
 description Uplink-Core-Primary
 mtu 9100
 speed 100000
 ip address 10.0.1.1/30
!
interface Ethernet4
 description Downlink-Access-01
 mtu 1500
 ip verify unicast source reachable-via rx
 switchport access vlan 10
 switchport port-security
 switchport port-security maximum 2
!
interface Ethernet8
 description Downlink-Access-02
 mtu 1500
 switchport access vlan 20
!
router bgp 65000
 bgp router-id 10.0.0.1
 neighbor 10.0.1.2 remote-as 65001
 neighbor 10.0.1.2 description Core-Router-B
 neighbor 10.0.2.2 remote-as 65002
 neighbor 10.0.2.2 password S3cur3BgpKey!
!
end
"""
    findings = ie.parse_config(sample)
    assert len(findings) == 9, f"expected 9 findings, got {len(findings)}: {findings}"
    line_numbers = [f.line_number for f in findings]
    assert line_numbers == sorted(line_numbers)
    assert len(set(line_numbers)) == len(line_numbers)
