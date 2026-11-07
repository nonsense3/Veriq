// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Veriq report registry
/// @notice Stores cryptographic commitments to off-chain security reports so anyone can check a report's
///         integrity and history. It stores no URLs, messages, personal data or evidence: only opaque keys,
///         salted SHA-256 commitments, revision links and hashes of validation/dispute statements.
/// @dev Records are append-only. A revision is a new record whose `parent` points at an earlier record.
///      A record establishes that a report existed unchanged at a point in time, not that its verdict is true.
contract ReportRegistry {
    enum StatementKind {
        None,
        Validate,
        Dispute
    }

    struct Record {
        bytes32 commitment;
        bytes32 parent;
        address registrar;
        uint64 registeredAt;
        uint16 schemaVersion;
    }

    mapping(bytes32 => Record) private records;
    mapping(bytes32 => uint32) public validations;
    mapping(bytes32 => uint32) public disputes;
    uint256 public totalRecords;

    event ReportRegistered(bytes32 indexed key, bytes32 indexed commitment, bytes32 indexed parent, address registrar, uint16 schemaVersion);
    event StatementAdded(bytes32 indexed key, StatementKind kind, bytes32 statementHash, address author);

    error AlreadyRegistered(bytes32 key);
    error UnknownReport(bytes32 key);
    error EmptyValue();
    error InvalidStatement();

    function register(bytes32 key, bytes32 commitment, bytes32 parent, uint16 schemaVersion) external {
        if (key == bytes32(0) || commitment == bytes32(0) || schemaVersion == 0) revert EmptyValue();
        if (records[key].registeredAt != 0) revert AlreadyRegistered(key);
        if (parent != bytes32(0) && records[parent].registeredAt == 0) revert UnknownReport(parent);
        records[key] = Record(commitment, parent, msg.sender, uint64(block.timestamp), schemaVersion);
        unchecked {
            totalRecords += 1;
        }
        emit ReportRegistered(key, commitment, parent, msg.sender, schemaVersion);
    }

    /// @notice Attach a validation or dispute statement. The statement text stays off-chain; only its hash is recorded.
    function addStatement(bytes32 key, StatementKind kind, bytes32 statementHash) external {
        if (records[key].registeredAt == 0) revert UnknownReport(key);
        if (kind == StatementKind.None || statementHash == bytes32(0)) revert InvalidStatement();
        if (kind == StatementKind.Validate) validations[key] += 1;
        else disputes[key] += 1;
        emit StatementAdded(key, kind, statementHash, msg.sender);
    }

    function getRecord(bytes32 key)
        external
        view
        returns (bytes32 commitment, bytes32 parent, address registrar, uint64 registeredAt, uint16 schemaVersion)
    {
        Record storage record = records[key];
        return (record.commitment, record.parent, record.registrar, record.registeredAt, record.schemaVersion);
    }

    function isRegistered(bytes32 key) external view returns (bool) {
        return records[key].registeredAt != 0;
    }
}
