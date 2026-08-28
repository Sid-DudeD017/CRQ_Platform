const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Deploying AuditLedger contract...");
  const AuditLedger = await hre.ethers.getContractFactory("AuditLedger");
  const auditLedger = await AuditLedger.deploy();

  await auditLedger.waitForDeployment();
  const contractAddress = await auditLedger.getAddress();
  
  console.log(`AuditLedger deployed to: ${contractAddress}`);

  // Copy ABI and address for the Backend
  const backendEnvPath = path.join(__dirname, "../../backend/.env");
  const abiPath = path.join(__dirname, "../artifacts/contracts/AuditLedger.sol/AuditLedger.json");
  const backendAbiPath = path.join(__dirname, "../../backend/AuditLedger.json");
  
  fs.copyFileSync(abiPath, backendAbiPath);
  console.log(`Copied ABI to ${backendAbiPath}`);
  
  console.log("\n⚠️ ACTION REQUIRED: Update your backend/.env with this address:");
  console.log(`CONTRACT_ADDRESS="${contractAddress}"\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
