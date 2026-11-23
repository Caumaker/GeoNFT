// Records a new revision of a certificate (new lab result, corrected coordinate). The old revisions stay readable.
//   CONTRACT=0x... TOKEN=12 FILE=out/BH-01_2_1_U_BH01-U1.json URI=ipfs://<cid>/BH-01_2_1_U_BH01-U1.json REASON="lab report added" \
//     npx hardhat run scripts/revise.js --network amoy
// Publish the new document under a NEW address (a new IPFS CID or a new file name): the old revision keeps pointing to the old one.
const fs = require('fs');
const { ethers } = require('hardhat');
const { dataHashOf } = require('../tools/lib/canonical');
const { strictParse } = require('../tools/lib/strict-json');
const { validate } = require('../tools/lib/validate');

async function main() {
  const { CONTRACT, TOKEN, FILE, URI, REASON } = process.env;
  if (!CONTRACT || !TOKEN || !FILE || !URI || !REASON) throw new Error('set CONTRACT, TOKEN, FILE, URI and REASON');
  const metadata = strictParse(fs.readFileSync(FILE, 'utf8'));
  const v = validate(metadata);
  if (!v.ok) throw new Error(`${FILE} fails the schema: ${v.errors.join('; ')}`);
  const [issuer] = await ethers.getSigners();
  const nft = await ethers.getContractAt('GeoNFT', CONTRACT, issuer);
  const [cert, current] = await nft.certificate(BigInt(TOKEN));
  if (metadata.geonft.sample.id !== cert.sampleId) throw new Error(`the document describes ${metadata.geonft.sample.id}, token ${TOKEN} certifies ${cert.sampleId}`);
  const hash = dataHashOf(metadata);
  if (hash === current.dataHash) { console.log('the token already points to this document; nothing to do'); return; }
  if (URI === current.uri) throw new Error('URI is the same address as the current revision: publish the new document under a new address');
  const receipt = await (await nft.revise(BigInt(TOKEN), hash, URI, REASON)).wait();
  console.log(`token ${TOKEN}: new revision recorded (tx ${receipt.hash})`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
