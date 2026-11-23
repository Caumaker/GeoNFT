// Issues the certificates listed in out/index.json. The hash is computed from each document file right now, after
// any edit, and the document must pass the schema. A sample already issued with the same hash is skipped; with a
// different hash the script stops and tells you to use scripts/revise.js (a certificate is never silently replaced).
//   CONTRACT=0x... BASE_URI=ipfs://<folder CID>/ [OUT=out] [TO=0xcustodian] [CHECK_URI=1] npx hardhat run scripts/mint.js --network amoy
// Upload the folder first (IPFS, Arweave or HTTPS): BASE_URI + file must return each document. CHECK_URI=1 downloads
// each one and refuses to mint if it differs from the local file.
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');
const { dataHashOf } = require('../tools/lib/canonical');
const { strictParse } = require('../tools/lib/strict-json');
const { validate } = require('../tools/lib/validate');

async function documentHash(file, uri, check) {
  const metadata = strictParse(fs.readFileSync(file, 'utf8'));
  const v = validate(metadata);
  if (!v.ok) throw new Error(`${path.basename(file)} fails the schema: ${v.errors.join('; ')}`);
  const hash = dataHashOf(metadata);
  if (check) {
    const url = uri.startsWith('ipfs://') ? (process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/') + uri.slice(7) : uri;
    const remote = strictParse(await (await fetch(url, { signal: AbortSignal.timeout(30000) })).text());
    if (dataHashOf(remote) !== hash) throw new Error(`${url} is not the same document as ${path.basename(file)}: upload again before minting`);
  }
  return { metadata, hash };
}

async function main() {
  const { CONTRACT, BASE_URI, OUT = 'out', TO, CHECK_URI } = process.env;
  if (!CONTRACT || !BASE_URI) throw new Error('set CONTRACT and BASE_URI');
  const [issuer] = await ethers.getSigners();
  const nft = await ethers.getContractAt('GeoNFT', CONTRACT, issuer);
  const to = TO || issuer.address;
  const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
  for (const item of index) {
    const uri = BASE_URI + item.file;
    const { metadata, hash } = await documentHash(path.join(OUT, item.file), uri, CHECK_URI === '1');
    if (metadata.geonft.sample.id !== item.sampleId) throw new Error(`${item.file} describes ${metadata.geonft.sample.id}, index says ${item.sampleId}`);
    const existing = await nft.tokenOfSample(await nft.sampleKey(issuer.address, item.sampleId));
    if (existing !== 0n) {
      const current = await nft.dataHash(existing);
      if (current === hash) { console.log(`${item.sampleId}: already token ${existing}, same document`); continue; }
      throw new Error(`${item.sampleId} is already token ${existing} with another document. To record the change: TOKEN=${existing} FILE=${path.join(OUT, item.file)} URI=<new uri> REASON="..." npx hardhat run scripts/revise.js`);
    }
    const receipt = await (await nft.issue(to, item.sampleId, hash, uri)).wait();
    const ev = receipt.logs.map((l) => { try { return nft.interface.parseLog(l); } catch (e) { return null; } }).find((e) => e && e.name === 'Issued');
    console.log(`${item.sampleId}: token ${ev.args.tokenId} (tx ${receipt.hash})`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
