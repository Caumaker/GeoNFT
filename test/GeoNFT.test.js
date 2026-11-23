const { expect } = require('chai');
const { ethers } = require('hardhat');

const h = (s) => ethers.sha256(ethers.toUtf8Bytes(s));

describe('GeoNFT', () => {
  let nft, admin, lab, other, custodian, outsider, ISSUER;

  beforeEach(async () => {
    [admin, lab, other, custodian, outsider] = await ethers.getSigners();
    nft = await ethers.deployContract('GeoNFT', [admin.address]);
    ISSUER = await nft.ISSUER_ROLE();
    await nft.grantRole(ISSUER, lab.address);
    await nft.grantRole(ISSUER, other.address);
  });

  const issue = (by = lab, sample = 'BH-01/12.50/U1', to = custodian.address) => nft.connect(by).issue(to, sample, h(sample), 'ipfs://meta-' + sample);

  it('issues a certificate to the first custodian, with the hash and the URI', async () => {
    await expect(issue()).to.emit(nft, 'Issued').withArgs(1n, lab.address, 'BH-01/12.50/U1', h('BH-01/12.50/U1'), 'ipfs://meta-BH-01/12.50/U1');
    expect(await nft.ownerOf(1)).to.equal(custodian.address);
    expect(await nft.tokenURI(1)).to.equal('ipfs://meta-BH-01/12.50/U1');
    expect(await nft.dataHash(1)).to.equal(h('BH-01/12.50/U1'));
    const [cert, current, count] = await nft.certificate(1);
    expect(cert.issuer).to.equal(lab.address);
    expect(cert.revoked).to.equal(false);
    expect(current.reason).to.equal('issued');
    expect(count).to.equal(1n);
    expect(await nft.totalIssued()).to.equal(1n);
    expect(await nft.tokenOfSample(await nft.sampleKey(lab.address, 'BH-01/12.50/U1'))).to.equal(1n);
  });

  it('only accredited issuers can issue, and empty fields are refused', async () => {
    await expect(issue(outsider)).to.be.revertedWithCustomError(nft, 'AccessControlUnauthorizedAccount');
    await expect(nft.connect(lab).issue(custodian.address, '', h('x'), 'ipfs://x')).to.be.revertedWithCustomError(nft, 'EmptyField').withArgs('sampleId');
    await expect(nft.connect(lab).issue(custodian.address, 's', ethers.ZeroHash, 'ipfs://x')).to.be.revertedWithCustomError(nft, 'EmptyField').withArgs('dataHash');
    await expect(nft.connect(lab).issue(custodian.address, 's', h('x'), '')).to.be.revertedWithCustomError(nft, 'EmptyField').withArgs('uri');
  });

  it('one certificate per sample per issuer; another issuer may certify its own sample with the same id', async () => {
    await issue();
    await expect(issue()).to.be.revertedWithCustomError(nft, 'AlreadyIssued').withArgs(1n);
    await expect(issue(other)).to.emit(nft, 'Issued');
  });

  it('revisions keep the history and only the issuer can write them', async () => {
    await issue();
    await expect(nft.connect(lab).revise(1, h('v2'), 'ipfs://v2', 'added Atterberg limits'))
      .to.emit(nft, 'Revised').withArgs(1n, 1n, h('v2'), 'ipfs://v2', 'added Atterberg limits')
      .and.to.emit(nft, 'MetadataUpdate').withArgs(1n);
    expect(await nft.tokenURI(1)).to.equal('ipfs://v2');
    expect(await nft.dataHash(1)).to.equal(h('v2'));
    const revs = await nft.revisions(1);
    expect(revs.map((r) => r.reason)).to.deep.equal(['issued', 'added Atterberg limits']);
    expect(revs[0].dataHash).to.equal(h('BH-01/12.50/U1'));
    await expect(nft.connect(other).revise(1, h('v3'), 'ipfs://v3', 'x')).to.be.revertedWithCustomError(nft, 'NotTheIssuer');
    await expect(nft.connect(custodian).revise(1, h('v3'), 'ipfs://v3', 'x')).to.be.revertedWithCustomError(nft, 'NotTheIssuer');
    await expect(nft.connect(lab).revise(1, h('v3'), 'ipfs://v3', '')).to.be.revertedWithCustomError(nft, 'EmptyField').withArgs('reason');
  });

  it('an issuer whose accreditation was removed can no longer revise', async () => {
    await issue();
    await nft.revokeRole(ISSUER, lab.address);
    await expect(nft.connect(lab).revise(1, h('v2'), 'ipfs://v2', 'late fix')).to.be.revertedWithCustomError(nft, 'NotTheIssuer');
  });

  it('revocation needs a reason, keeps the token and blocks new revisions', async () => {
    await issue();
    await expect(nft.connect(outsider).revoke(1, 'no')).to.be.revertedWithCustomError(nft, 'NotTheIssuer');
    await expect(nft.connect(lab).revoke(1, '')).to.be.revertedWithCustomError(nft, 'EmptyField').withArgs('reason');
    await expect(nft.connect(lab).revoke(1, 'sample contaminated in transport')).to.emit(nft, 'Revoked').withArgs(1n, 'sample contaminated in transport');
    const [cert] = await nft.certificate(1);
    expect(cert.revoked).to.equal(true);
    expect(cert.revokedReason).to.equal('sample contaminated in transport');
    expect(await nft.ownerOf(1)).to.equal(custodian.address);
    await expect(nft.connect(lab).revise(1, h('v2'), 'ipfs://v2', 'x')).to.be.revertedWithCustomError(nft, 'CertificateRevoked');
    await expect(nft.connect(lab).revoke(1, 'again')).to.be.revertedWithCustomError(nft, 'CertificateRevoked');
  });

  it('an issuer whose accreditation was removed cannot revoke (stolen key scenario)', async () => {
    await issue();
    await nft.revokeRole(ISSUER, lab.address);
    await expect(nft.connect(lab).revoke(1, 'wipe')).to.be.revertedWithCustomError(nft, 'NotTheIssuer');
  });

  it('history can be read one revision at a time', async () => {
    await issue();
    await nft.connect(lab).revise(1, h('v2'), 'ipfs://v2', 'second');
    expect(await nft.revisionCount(1)).to.equal(2n);
    expect((await nft.revisionAt(1, 1)).reason).to.equal('second');
    await expect(nft.revisionAt(1, 2)).to.be.reverted;
  });

  it('Issued and CustodyNote come before the Transfer of the same call', async () => {
    const rc = await (await issue()).wait();
    const names = rc.logs.map((l) => { try { return nft.interface.parseLog(l).name; } catch (e) { return null; } }).filter(Boolean);
    expect(names).to.deep.equal(['Issued', 'Transfer']);
    const rc2 = await (await nft.connect(custodian).transferWithNote(lab.address, 1, 'to lab')).wait();
    const names2 = rc2.logs.map((l) => { try { return nft.interface.parseLog(l).name; } catch (e) { return null; } }).filter(Boolean);
    expect(names2).to.deep.equal(['CustodyNote', 'Transfer']);
  });

  it('the admin can revoke any certificate (e.g. an issuer lost its accreditation)', async () => {
    await issue();
    await expect(nft.connect(admin).revoke(1, 'issuer accreditation withdrawn')).to.emit(nft, 'Revoked');
  });

  it('custody transfers carry a note and only the holder (or an approved operator) can make them', async () => {
    await issue();
    await expect(nft.connect(custodian).transferWithNote(lab.address, 1, 'shipped to lab, seal 4471'))
      .to.emit(nft, 'CustodyNote').withArgs(1n, custodian.address, lab.address, 'shipped to lab, seal 4471');
    expect(await nft.ownerOf(1)).to.equal(lab.address);
    await expect(nft.connect(outsider).transferWithNote(outsider.address, 1, 'mine now')).to.be.revertedWithCustomError(nft, 'ERC721InsufficientApproval');
    await nft.connect(lab).approve(other.address, 1);
    await expect(nft.connect(other).transferWithNote(custodian.address, 1, 'returned to the site store')).to.emit(nft, 'CustodyNote');
    expect(await nft.ownerOf(1)).to.equal(custodian.address);
  });

  it('reading a token that does not exist reverts', async () => {
    await expect(nft.tokenURI(9)).to.be.revertedWithCustomError(nft, 'ERC721NonexistentToken');
    await expect(nft.certificate(9)).to.be.revertedWithCustomError(nft, 'ERC721NonexistentToken');
  });

  it('declares ERC-721, ERC-4906 and AccessControl', async () => {
    for (const id of ['0x80ac58cd', '0x5b5e139f', '0x49064906', '0x7965db0b', '0x01ffc9a7']) expect(await nft.supportsInterface(id), id).to.equal(true);
    expect(await nft.supportsInterface('0xffffffff')).to.equal(false);
  });
});
