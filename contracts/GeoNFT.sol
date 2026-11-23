// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title GeoNFT: certificates for geological samples and data
/// @notice Each token certifies one sample (a core run, a soil sample, a test specimen, a survey) issued by an
/// accredited issuer. The token stores the SHA-256 of the sample's metadata document, so anyone can check that the
/// document they were given is the one the issuer certified. Records are never deleted: corrections are new
/// revisions, withdrawn certificates are revoked with a reason, and every change of hands is a transfer that can
/// carry a custody note.
contract GeoNFT is ERC721, AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    struct Revision {
        bytes32 dataHash; // SHA-256 of the canonical metadata JSON
        string uri; // where the metadata document is published (ipfs://, https://)
        uint64 timestamp; // block timestamp
        address by; // issuer that wrote it
        string reason; // "issued", or why the record was corrected
    }

    struct Certificate {
        string sampleId; // issuer's own sample identifier, unique per issuer
        address issuer;
        uint64 issuedAt;
        bool revoked;
        string revokedReason;
    }

    mapping(uint256 tokenId => Certificate) private _certificates;
    mapping(uint256 tokenId => Revision[]) private _revisions;
    /// @notice keccak256(issuer, sampleId) => tokenId (0 = not issued). One certificate per sample per issuer.
    mapping(bytes32 sampleKey => uint256) public tokenOfSample;
    uint256 private _nextId = 1;

    event Issued(uint256 indexed tokenId, address indexed issuer, string sampleId, bytes32 dataHash, string uri);
    event Revised(uint256 indexed tokenId, uint256 revision, bytes32 dataHash, string uri, string reason);
    event Revoked(uint256 indexed tokenId, string reason);
    event CustodyNote(uint256 indexed tokenId, address indexed from, address indexed to, string note);
    /// @dev ERC-4906: tells indexers and marketplaces to fetch the metadata again
    event MetadataUpdate(uint256 _tokenId);

    error EmptyField(string field);
    error AlreadyIssued(uint256 tokenId);
    error NotTheIssuer(uint256 tokenId);
    error CertificateRevoked(uint256 tokenId);

    constructor(address admin) ERC721("GeoNFT Sample Certificate", "GEOSAMPLE") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
    }

    /// @notice Issues the certificate of a sample to its first custodian.
    function issue(address to, string calldata sampleId, bytes32 dataHash, string calldata uri)
        external
        onlyRole(ISSUER_ROLE)
        returns (uint256 tokenId)
    {
        if (bytes(sampleId).length == 0) revert EmptyField("sampleId");
        if (dataHash == bytes32(0)) revert EmptyField("dataHash");
        if (bytes(uri).length == 0) revert EmptyField("uri");
        bytes32 key = sampleKey(msg.sender, sampleId);
        if (tokenOfSample[key] != 0) revert AlreadyIssued(tokenOfSample[key]);

        tokenId = _nextId++;
        tokenOfSample[key] = tokenId;
        _certificates[tokenId] = Certificate(sampleId, msg.sender, uint64(block.timestamp), false, "");
        _revisions[tokenId].push(Revision(dataHash, uri, uint64(block.timestamp), msg.sender, "issued"));
        // the event goes out before _safeMint: a receiving contract's callback cannot log anything ahead of it
        emit Issued(tokenId, msg.sender, sampleId, dataHash, uri);
        _safeMint(to, tokenId);
    }

    /// @notice Records a corrected or extended metadata document (a new lab result, a fixed coordinate).
    /// The previous revisions stay readable.
    function revise(uint256 tokenId, bytes32 dataHash, string calldata uri, string calldata reason) external {
        Certificate storage c = _certificate(tokenId);
        if (c.issuer != msg.sender || !hasRole(ISSUER_ROLE, msg.sender)) revert NotTheIssuer(tokenId);
        if (c.revoked) revert CertificateRevoked(tokenId);
        if (dataHash == bytes32(0)) revert EmptyField("dataHash");
        if (bytes(uri).length == 0) revert EmptyField("uri");
        if (bytes(reason).length == 0) revert EmptyField("reason");
        _revisions[tokenId].push(Revision(dataHash, uri, uint64(block.timestamp), msg.sender, reason));
        emit Revised(tokenId, _revisions[tokenId].length - 1, dataHash, uri, reason);
        emit MetadataUpdate(tokenId);
    }

    /// @notice Withdraws a certificate (contaminated sample, wrong location...). The token and its history remain.
    /// The issuer can revoke only while still accredited: a stolen key whose role was removed cannot wipe its records.
    function revoke(uint256 tokenId, string calldata reason) external {
        Certificate storage c = _certificate(tokenId);
        bool issuerOk = c.issuer == msg.sender && hasRole(ISSUER_ROLE, msg.sender);
        if (!issuerOk && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotTheIssuer(tokenId);
        if (c.revoked) revert CertificateRevoked(tokenId);
        if (bytes(reason).length == 0) revert EmptyField("reason");
        c.revoked = true;
        c.revokedReason = reason;
        emit Revoked(tokenId, reason);
        emit MetadataUpdate(tokenId);
    }

    /// @notice Hands the sample (and its certificate) to the next custodian, with a note for the record:
    /// "shipped to lab X, seal 4471", "received intact".
    function transferWithNote(address to, uint256 tokenId, string calldata note) external {
        address from = ownerOf(tokenId);
        emit CustodyNote(tokenId, from, to, note); // before the transfer callback, so custody history stays in order
        safeTransferFrom(from, to, tokenId);
    }

    // ---------------------------------------------------------------- reading

    function sampleKey(address issuer, string calldata sampleId) public pure returns (bytes32) {
        return keccak256(abi.encode(issuer, sampleId));
    }

    function certificate(uint256 tokenId) external view returns (Certificate memory, Revision memory current, uint256 revisionCount) {
        Certificate storage c = _certificate(tokenId);
        Revision[] storage r = _revisions[tokenId];
        return (c, r[r.length - 1], r.length);
    }

    /// @notice Whole history in one call. For very long histories use revisionCount and revisionAt.
    function revisions(uint256 tokenId) external view returns (Revision[] memory) {
        _certificate(tokenId);
        return _revisions[tokenId];
    }

    function revisionCount(uint256 tokenId) external view returns (uint256) {
        _certificate(tokenId);
        return _revisions[tokenId].length;
    }

    function revisionAt(uint256 tokenId, uint256 index) external view returns (Revision memory) {
        _certificate(tokenId);
        return _revisions[tokenId][index];
    }

    /// @notice SHA-256 of the current metadata document.
    function dataHash(uint256 tokenId) external view returns (bytes32) {
        _certificate(tokenId);
        Revision[] storage r = _revisions[tokenId];
        return r[r.length - 1].dataHash;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Revision[] storage r = _revisions[tokenId];
        return r[r.length - 1].uri;
    }

    function totalIssued() external view returns (uint256) {
        return _nextId - 1;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }

    function _certificate(uint256 tokenId) private view returns (Certificate storage c) {
        _requireOwned(tokenId);
        c = _certificates[tokenId];
    }
}
