// Deploys GeoNFT with the deployer as admin and first issuer.
//   npx hardhat run scripts/deploy.js --network amoy      (Polygon testnet; get test POL from a faucet)
//   npx hardhat run scripts/deploy.js --network polygon   (mainnet, costs a few cents of POL)
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('no deployer: set DEPLOYER_KEY in the environment');
  console.log(`network ${network.name}, deployer ${deployer.address}`);
  const nft = await ethers.deployContract('GeoNFT', [deployer.address]);
  await nft.waitForDeployment();
  const address = await nft.getAddress();
  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify({ network: network.name, chainId: Number(network.config.chainId || 31337), address, deployer: deployer.address, at: new Date().toISOString() }, null, 2) + '\n');
  console.log(`GeoNFT deployed at ${address} (saved in deployments/${network.name}.json)`);
  if (network.name !== 'hardhat') console.log(`verify the source: npx hardhat verify --network ${network.name} ${address} ${deployer.address}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
