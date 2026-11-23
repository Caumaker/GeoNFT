// Issues the certificates listed in an index.json made by tools/ags4-to-geonft.js. Already issued samples are skipped.
//   CONTRACT=0x... BASE_URI=ipfs://<folder CID>/ INDEX=out/index.json [TO=0xcustodian] npx hardhat run scripts/mint.js --network amoy
// Upload the metadata folder first (IPFS, Arweave or any HTTPS host): BASE_URI + file must return each document.
const fs = require('fs');
const { ethers } = require('hardhat');

async function main() {
  const { CONTRACT, BASE_URI, INDEX = 'out/index.json', TO } = process.env;
  if (!CONTRACT || !BASE_URI) throw new Error('set CONTRACT and BASE_URI');
  const [issuer] = await ethers.getSigners();
  const nft = await ethers.getContractAt('GeoNFT', CONTRACT, issuer);
  const to = TO || issuer.address;
  for (const item of JSON.parse(fs.readFileSync(INDEX, 'utf8'))) {
    const existing = await nft.tokenOfSample(await nft.sampleKey(issuer.address, item.sampleId));
    if (existing !== 0n) { console.log(`${item.sampleId}: already token ${existing}`); continue; }
    const tx = await nft.issue(to, item.sampleId, item.dataHash, BASE_URI + item.file);
    const receipt = await tx.wait();
    const ev = receipt.logs.map((l) => { try { return nft.interface.parseLog(l); } catch (e) { return null; } }).find((e) => e && e.name === 'Issued');
    console.log(`${item.sampleId}: token ${ev.args.tokenId} (tx ${receipt.hash})`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
