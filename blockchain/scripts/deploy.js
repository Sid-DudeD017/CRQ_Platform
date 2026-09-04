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

  // Write/replace CONTRACT_ADDRESS in backend/.env automatically instead of
  // relying on someone reading the console output and pasting it in by hand
  // - a forgotten or stale address here is the classic reason the ledger
  // logs fine but nothing ever shows up on-chain after a redeploy.
  let envContents = fs.existsSync(backendEnvPath) ? fs.readFileSync(backendEnvPath, "utf8") : "";
  const addressLine = `CONTRACT_ADDRESS=${contractAddress}`;
  if (/^CONTRACT_ADDRESS=.*$/m.test(envContents)) {
    envContents = envContents.replace(/^CONTRACT_ADDRESS=.*$/m, addressLine);
  } else {
    if (envContents.length && !envContents.endsWith("\n")) envContents += "\n";
    envContents += `${addressLine}\n`;
  }
  fs.writeFileSync(backendEnvPath, envContents);
  console.log(`Wrote ${addressLine} to ${backendEnvPath}`);
  console.log("\nRestart the backend (or start it, if it wasn't running) so it picks up the new address, then Accept Risk should commit on-chain.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
