// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AuditLedger {
    address public authorizedServer;

    struct AuditRecord {
        uint256 timestamp;
        string action;
        string dataHash;
        string user;
    }

    AuditRecord[] public ledger;

    event RiskAccepted(uint256 indexed timestamp, string action, string dataHash, string user);

    modifier onlyServer() {
        require(msg.sender == authorizedServer, "Unauthorized: Only FastAPI server can log audits");
        _;
    }

    constructor() {
        // By default, the deployer is the authorized server (FastAPI's wallet)
        authorizedServer = msg.sender;
    }

    function logRiskAcceptance(string memory _action, string memory _dataHash, string memory _user) public onlyServer {
        ledger.push(AuditRecord({
            timestamp: block.timestamp,
            action: _action,
            dataHash: _dataHash,
            user: _user
        }));

        emit RiskAccepted(block.timestamp, _action, _dataHash, _user);
    }

    function getRecordCount() public view returns (uint256) {
        return ledger.length;
    }

    function getRecord(uint256 index) public view returns (uint256, string memory, string memory, string memory) {
        require(index < ledger.length, "Index out of bounds");
        AuditRecord memory record = ledger[index];
        return (record.timestamp, record.action, record.dataHash, record.user);
    }
}
