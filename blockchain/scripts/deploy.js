const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  const AuditLedger = await hre.ethers.getContractFactory("AuditLedger");
  const auditLedger = await AuditLedger.deploy();

  await auditLedger.waitForDeployment();

  console.log("AuditLedger deployed to:", await auditLedger.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
