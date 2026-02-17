// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BatchExecutor
 * @author Gas Fee Optimizer — Batch Transaction System
 * @notice Executes batched meta-transactions with EIP-712 signature verification
 *         and nonce-based replay protection.
 *
 * @dev This contract implements the Trusted Forwarder pattern (inspired by ERC-2771)
 *      combined with transaction batching for gas optimization.
 *
 * ARCHITECTURE:
 *   The system achieves gas savings by amortizing the 21,000 base transaction cost
 *   across N operations. For N token transfers:
 *     - Individual cost:  N × (21,000 + C_exec) gas
 *     - Batched cost:     21,000 + N × (C_exec + C_overhead) gas
 *     - Savings:          (N-1) × 21,000 - N × C_overhead gas
 *
 *   Where C_overhead ≈ 5,000 gas (signature verification + nonce check + loop)
 *   yields ~60-70% savings for batch sizes of 5-20.
 *
 * FLOW:
 *   1. Users sign ForwardRequest structs off-chain via EIP-712 (no gas cost)
 *   2. A relayer collects signed requests into a queue
 *   3. Relayer calls executeBatch() with all requests + signatures in one TX
 *   4. This contract verifies each signature, checks nonces, and executes
 *   5. Original sender identity is propagated to target contracts via calldata appending
 *
 * SECURITY MODEL:
 *   - EIP-712 domain separator binds signatures to this contract on this chain
 *   - Sequential nonces prevent replay attacks
 *   - Nonce incremented before execution prevents reentrancy-based reuse
 *   - Gas limits per sub-call prevent griefing attacks
 *   - Users can bypass the relayer and call executeBatch() directly
 */
contract BatchExecutor {

    // ─── EIP-712 Domain Separator ────────────────────────────────
    // This binds signatures to THIS specific contract on THIS chain.
    // Prevents cross-chain and cross-contract replay attacks.

    bytes32 public DOMAIN_SEPARATOR;

    // The "type hash" for our ForwardRequest struct.
    // Think of it as a fingerprint of the struct's shape.
    bytes32 public constant REQUEST_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)"
    );

    // ─── Nonce Tracking ──────────────────────────────────────────
    // Each user has a nonce that increments after each executed request.
    // mapping: user address => their current nonce
    mapping(address => uint256) public nonces;

    // ─── The ForwardRequest Struct ───────────────────────────────
    // This is what a user signs. It represents one action they want to perform.
    struct ForwardRequest {
        address from;    // Who is the original sender (the user)
        address to;      // Which contract to call
        uint256 value;   // ETH to send along (usually 0)
        uint256 gas;     // Gas limit for this specific call
        uint256 nonce;   // User's current nonce (replay protection)
        bytes data;      // The actual function call data (encoded)
    }

    // ─── Events ──────────────────────────────────────────────────
    // Events are logs stored on-chain. Useful for the frontend to
    // track what happened.

    event RequestExecuted(
        address indexed from,
        address indexed to,
        uint256 nonce,
        bool success
    );

    event BatchExecuted(
        address indexed relayer,
        uint256 totalRequests,
        uint256 successCount
    );

    // ─── Constructor ─────────────────────────────────────────────
    // Runs once when the contract is deployed.
    // Sets up the EIP-712 domain separator.

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("BatchExecutor")),   // Name of our contract
                keccak256(bytes("1")),                // Version
                block.chainid,                        // Chain ID (11155111 for Sepolia)
                address(this)                         // This contract's address
            )
        );
    }

    // ─── Core Function: Verify a Signature ───────────────────────
    // Given a request and a signature, recover WHO signed it.
    // If the recovered address matches request.from, the signature is valid.

    function verify(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public view returns (bool) {
        // Step 1: Hash the request data using EIP-712 format
        bytes32 structHash = keccak256(
            abi.encode(
                REQUEST_TYPEHASH,
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                keccak256(req.data)
            )
        );

        // Step 2: Create the final digest (what was actually signed)
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        // Step 3: Recover the signer from the signature
        address signer = _recoverSigner(digest, signature);

        // Step 4: Check that the signer matches AND nonce is correct
        return signer == req.from && req.nonce == nonces[req.from];
    }

    // ─── Core Function: Execute a Single Request ─────────────────
    // Internal function that executes one verified request.

    function _executeRequest(
        ForwardRequest calldata req
    ) internal returns (bool success) {
        // Increment nonce BEFORE execution (prevents reentrancy issues)
        nonces[req.from] = req.nonce + 1;

        // Execute the call
        // We append req.from to the call data so the target contract
        // can know who the original sender was (not the relayer)
        (success, ) = req.to.call{gas: req.gas, value: req.value}(
            abi.encodePacked(req.data, req.from)
        );

        emit RequestExecuted(req.from, req.to, req.nonce, success);
    }

    // ─── Core Function: Execute a Batch ──────────────────────────
    // THE MAIN FUNCTION the relayer calls.
    // Takes an array of requests and signatures, verifies each, executes each.

    function executeBatch(
        ForwardRequest[] calldata requests,
        bytes[] calldata signatures
    ) external payable returns (bool[] memory results) {
        // Sanity check: must have matching arrays
        require(
            requests.length == signatures.length,
            "BatchExecutor: length mismatch"
        );
        require(requests.length > 0, "BatchExecutor: empty batch");

        results = new bool[](requests.length);
        uint256 successCount = 0;

        for (uint256 i = 0; i < requests.length; i++) {
            // Verify signature for each request
            require(
                verify(requests[i], signatures[i]),
                "BatchExecutor: invalid signature or nonce"
            );

            // Execute the request
            results[i] = _executeRequest(requests[i]);

            if (results[i]) {
                successCount++;
            }
        }

        emit BatchExecuted(msg.sender, requests.length, successCount);
    }

    // ─── Helper: Get Current Nonce ───────────────────────────────
    function getNonce(address from) external view returns (uint256) {
        return nonces[from];
    }

    // ─── Internal: Signature Recovery ────────────────────────────
    // Splits a 65-byte signature into (v, r, s) components
    // and uses ecrecover to get the signer's address.

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        require(signature.length == 65, "BatchExecutor: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        // Signatures are 65 bytes: [r (32 bytes)][s (32 bytes)][v (1 byte)]
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // ecrecover is a built-in Solidity function that recovers
        // the address that created a signature
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "BatchExecutor: invalid signature");
        return signer;
    }

    // Allow the contract to receive ETH (needed if requests send ETH)
    receive() external payable {}
}
