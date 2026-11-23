// Whole life of a certificate on a local chain, no wallet needed: npm run demo
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ethers } = require('hardhat');
const { fromAgs } = require('../tools/lib/from-ags');
const { dataHashOf, sha256Hex } = require('../tools/lib/canonical');
const { verifyToken } = require('../tools/lib/verify');

const show = (r) => `${r.ok ? 'VALID  ' : 'INVALID'} ${r.problems.join('; ')}`;

async function main() {
  const [admin, lab, siteStore, lab2] = await ethers.getSigners();
  const nft = await ethers.deployContract('GeoNFT', [admin.address]);
  const address = await nft.getAddress();
  await nft.grantRole(await nft.ISSUER_ROLE(), lab.address);
  console.log(`GeoNFT at ${address}; admin ${admin.address.slice(0, 10)}..., accredited lab ${lab.address.slice(0, 10)}...\n`);

  const agsFile = path.join(__dirname, '..', 'examples', 'site-investigation.ags');
  const { certs } = fromAgs(fs.readFileSync(agsFile), agsFile);
  const docs = {};
  for (const c of certs) {
    await (await nft.connect(lab).issue(siteStore.address, c.sampleId, c.dataHash, `https://example.org/geonft/${c.file}`)).wait();
    docs[c.sampleId] = c.metadata;
    console.log(`issued ${c.sampleId.padEnd(26)} ${c.metadata.geonft.tests.length} test(s) -> held by the site store`);
  }
  const check = (id, doc) => verifyToken({ ethers, provider: ethers.provider, address, tokenId: id, metadata: doc });

  console.log('\n1. Anyone checks a certificate against the document they received');
  console.log('   token 1 with the original document:', show(await check(1n, docs[certs[0].sampleId])));
  const forged = JSON.parse(JSON.stringify(docs[certs[0].sampleId]));
  forged.geonft.tests[0].results.LNMC_MC.value = 18;
  console.log('   token 1 with moisture content edited from 28 to 18:', show(await check(1n, forged)));

  console.log('\n2. The lab adds a report to the record (new revision, old one kept)');
  const v2 = JSON.parse(JSON.stringify(docs[certs[0].sampleId]));
  const report = Buffer.from('lab report PDF bytes would go here');
  v2.geonft.files.push({ name: 'BH01-U1-lab-report.pdf', sha256: sha256Hex(report), mediaType: 'application/pdf', uri: 'https://example.org/geonft/BH01-U1-lab-report.pdf' });
  await (await nft.connect(lab).revise(1n, dataHashOf(v2), 'https://example.org/geonft/BH01-U1-v2.json', 'lab report attached')).wait();
  console.log('   new document:', show(await check(1n, v2)));
  console.log('   old document:', show(await check(1n, docs[certs[0].sampleId])));

  console.log('\n3. Chain of custody: the core box goes to a second lab and comes back');
  await (await nft.connect(siteStore).transferWithNote(lab2.address, 4n, 'core box 7 shipped, seal 4471')).wait();
  await (await nft.connect(lab2).transferWithNote(siteStore.address, 4n, 'returned after UCS test, seal intact')).wait();
  const notas = await nft.queryFilter(nft.filters.CustodyNote(4n));
  for (const n of notas) console.log(`   ${n.args.from.slice(0, 10)}... -> ${n.args.to.slice(0, 10)}...  "${n.args.note}"`);

  console.log('\n4. A sample turns out contaminated: revoked with a reason, history kept');
  await (await nft.connect(lab).revoke(2n, 'bag torn in transport, sample contaminated')).wait();
  console.log('   token 2:', show(await check(2n, docs[certs[1].sampleId])));

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'geonft-demo-'));
  for (const c of certs) fs.writeFileSync(path.join(out, c.file), JSON.stringify(c.metadata, null, 2));
  console.log(`\nmetadata documents written to ${out}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
