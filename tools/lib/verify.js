'use strict';
// Checks a token against a metadata document: same hash, not revoked, and the revision history.
const { dataHashOf } = require('./canonical');

const ABI = [
  'function certificate(uint256) view returns (tuple(string sampleId, address issuer, uint64 issuedAt, bool revoked, string revokedReason), tuple(bytes32 dataHash, string uri, uint64 timestamp, address by, string reason), uint256)',
  'function revisions(uint256) view returns (tuple(bytes32 dataHash, string uri, uint64 timestamp, address by, string reason)[])',
  'function ownerOf(uint256) view returns (address)',
  'function hasRole(bytes32, address) view returns (bool)',
  'function ISSUER_ROLE() view returns (bytes32)',
];

async function verifyToken({ ethers, provider, address, tokenId, metadata, fetchMetadata }) {
  const c = new ethers.Contract(address, ABI, provider);
  const [cert, current] = await c.certificate(tokenId);
  const revs = await c.revisions(tokenId);
  const owner = await c.ownerOf(tokenId);
  const issuerStillAccredited = await c.hasRole(await c.ISSUER_ROLE(), cert.issuer);
  const doc = metadata || (fetchMetadata ? await fetchMetadata(current.uri) : null);
  const hash = doc ? dataHashOf(doc) : null;
  const atRevision = hash ? revs.findIndex((r) => r.dataHash === hash) : -1;
  const problems = [];
  if (!doc) problems.push('no metadata document to compare');
  else if (hash !== current.dataHash) problems.push(atRevision >= 0 ? `the document matches revision ${atRevision}, not the current one (${revs.length - 1})` : 'the document does not match any revision of this token');
  if (cert.revoked) problems.push(`certificate revoked: ${cert.revokedReason}`);
  return {
    ok: problems.length === 0,
    problems,
    sampleId: cert.sampleId,
    issuer: cert.issuer,
    issuerStillAccredited,
    owner,
    current: { dataHash: current.dataHash, uri: current.uri },
    computedHash: hash,
    history: revs.map((r, i) => ({ revision: i, at: new Date(Number(r.timestamp) * 1000).toISOString(), by: r.by, reason: r.reason, dataHash: r.dataHash, uri: r.uri })),
  };
}

module.exports = { verifyToken, ABI };
