import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

/**
 * Deploys ReportRegistry and records the address, chain id, deployment transaction and ABI in
 * deployments/<network>.json so the scanner and the independent verifier can find it.
 */
const connection = await network.getOrCreate();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
if (!deployer) throw new Error("No deployer account available on this network.");

const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction("ReportRegistry");
const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
const chainId = await publicClient.getChainId();
const networkName = connection.networkName;

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "../deployments", `${networkName}.json`);
mkdirSync(dirname(output), { recursive: true });
const record = {
  network: networkName,
  chainId,
  address: contract.address,
  deployer: deployer.account.address,
  transactionHash: deploymentTransaction.hash,
  blockNumber: Number(receipt.blockNumber),
  deployedAt: new Date().toISOString(),
  abi: contract.abi,
};
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);

console.log(`ReportRegistry deployed on ${networkName} (chain ${chainId})`);
console.log(`  address:     ${contract.address}`);
console.log(`  transaction: ${deploymentTransaction.hash} (block ${receipt.blockNumber})`);
console.log(`  record:      ${output}`);
