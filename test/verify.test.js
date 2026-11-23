const { expect } = require('chai');
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');
const { fromAgs } = require('../tools/lib/from-ags');
const { dataHashOf } = require('../tools/lib/canonical');
const { verifyToken } = require('../tools/lib/verify');

describe('verifying certificates against documents', () => {
  it('accepts the issued document, flags edits, old revisions and revocation', async () => {
    const [admin, holder] = await ethers.getSigners();
    const nft = await ethers.deployContract('GeoNFT', [admin.address]);
    const address = await nft.getAddress();
    const ags = path.join(__dirname, '..', 'examples', 'site-investigation.ags');
    const [c] = fromAgs(fs.readFileSync(ags, 'utf8'), ags);
    await (await nft.issue(holder.address, c.sampleId, c.dataHash, 'ipfs://x/' + c.file)).wait();
    const check = (doc) => verifyToken({ ethers, provider: ethers.provider, address, tokenId: 1n, metadata: doc });

    expect((await check(c.metadata)).ok).to.equal(true);
    const reverse = (v) => (Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverse(v[k])])) : v);
    expect((await check(reverse(c.metadata))).ok, 'key order does not matter').to.equal(true);

    const edited = JSON.parse(JSON.stringify(c.metadata));
    edited.geonft.sample.top = 2.5;
    const r1 = await check(edited);
    expect(r1.ok).to.equal(false);
    expect(r1.problems[0]).to.match(/does not match any revision/);

    const v2 = { ...c.metadata, description: c.metadata.description + ' (rev 2)' };
    await (await nft.revise(1n, dataHashOf(v2), 'ipfs://x/v2.json', 'description fixed')).wait();
    expect((await check(v2)).ok).to.equal(true);
    expect((await check(c.metadata)).problems[0]).to.match(/revision 0, not the current one/);

    await (await nft.revoke(1n, 'wrong borehole')).wait();
    const r3 = await check(v2);
    expect(r3.ok).to.equal(false);
    expect(r3.problems.join()).to.match(/revoked: wrong borehole/);
    expect(r3.history.map((h) => h.reason)).to.deep.equal(['issued', 'description fixed']);
  });
});
