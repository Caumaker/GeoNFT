// Deploys GeoNFT. The admin (who accredits issuers) should be a multisig: set ADMIN=0x... and the deploying
// key ends with no role at all. Without ADMIN the deployer becomes admin and first issuer (fine for tests).
//   npx hardhat run scripts/deploy.js --network amoy      (Polygon testnet; get test POL from a faucet)
//   npx hardhat run scripts/deploy.js --network polygon   (mainnet, costs a few cents of POL)
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('no deployer: set DEPLOYER_KEY in the environment');
  console.log(`network ${network.name}, deployer ${deployer.address}`);
  const admin = process.env.ADMIN || deployer.address;
  if (!ethers.isAddress(admin)) throw new Error(`ADMIN is not an address: ${admin}`);
  const nft = await ethers.deployContract('GeoNFT', [admin]);
  await nft.waitForDeployment();
  const address = await nft.getAddress();
  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify({ network: network.name, chainId: Number(network.config.chainId || 31337), address, admin, deployer: deployer.address, at: new Date().toISOString() }, null, 2) + '\n');
  console.log(`GeoNFT deployed at ${address}, admin ${admin} (saved in deployments/${network.name}.json)`);
  if (admin !== deployer.address) console.log('the admin (multisig) accredits issuers with grantRole(ISSUER_ROLE, issuer)');
  if (network.name !== 'hardhat') console.log(`verify the source: npx hardhat verify --network ${network.name} ${address} ${admin}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
