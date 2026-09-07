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

  // Deploying anywhere other than a local Hardhat node (i.e. --network
  // sepolia) means the backend needs to point at that SAME remote RPC
  // endpoint and sign with this SAME wallet (AuditLedger.sol's
  // `authorizedServer` is whichever address deployed it) instead of its
  // localhost/well-known-test-key defaults - otherwise every write reverts
  // with "Unauthorized" or the backend just can't reach 127.0.0.1:8545 at
  // all once it's hosted somewhere that isn't your own machine. Writing
  // both alongside CONTRACT_ADDRESS here means one `deploy` command is
  // enough - nobody has to remember to also hand-edit WEB3_PROVIDER_URL /
  // DEPLOYER_PRIVATE_KEY to match.
  const networkName = hre.network.name;
  if (networkName !== "hardhat" && networkName !== "localhost") {
    const rpcUrl = hre.network.config.url;
    const deployerKey = hre.network.config.accounts && hre.network.config.accounts[0];

    const setEnvVar = (contents, key, value) => {
      const line = `${key}=${value}`;
      if (new RegExp(`^${key}=.*$`, "m").test(contents)) {
        return contents.replace(new RegExp(`^${key}=.*$`, "m"), line);
      }
      if (contents.length && !contents.endsWith("\n")) contents += "\n";
      return contents + `${line}\n`;
    };

    let updated = fs.readFileSync(backendEnvPath, "utf8");
    updated = setEnvVar(updated, "WEB3_PROVIDER_URL", rpcUrl || "");
    if (deployerKey) {
      updated = setEnvVar(updated, "DEPLOYER_PRIVATE_KEY", deployerKey);
    }
    fs.writeFileSync(backendEnvPath, updated);
    console.log(`Wrote WEB3_PROVIDER_URL=${rpcUrl} to ${backendEnvPath}`);
    if (deployerKey) {
      console.log(`Wrote DEPLOYER_PRIVATE_KEY to ${backendEnvPath} (same wallet that deployed - required, since it's AuditLedger's authorizedServer).`);
    } else {
      console.log("No PRIVATE_KEY found in blockchain/.env - set DEPLOYER_PRIVATE_KEY in backend/.env by hand to the same key you deployed with.");
    }
    console.log(`\nDeployed to '${networkName}'. Set the same WEB3_PROVIDER_URL / CONTRACT_ADDRESS / DEPLOYER_PRIVATE_KEY as Render env vars (see render.yaml) so the hosted backend uses this contract instead of needing a local Hardhat node.`);
  }

  console.log("\nRestart the backend (or start it, if it wasn't running) so it picks up the new address, then Accept Risk should commit on-chain.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
