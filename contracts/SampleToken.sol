// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SampleToken
 * @author Gas Fee Optimizer — Batch Transaction System
 * @notice A meta-transaction-aware ERC-20 token for demonstrating gas-optimized
 *         batch transfers via the BatchExecutor trusted forwarder.
 *
 * @dev Implements the Trusted Forwarder pattern (ERC-2771 inspired):
 *   - When called directly by a user → standard ERC-20 behavior
 *   - When called via BatchExecutor → extracts real sender from calldata
 *
 * SENDER PROPAGATION:
 *   BatchExecutor appends the original sender address (20 bytes) to the end
 *   of the calldata when forwarding calls. This contract's _msgSender()
 *   override detects calls from the trusted forwarder and extracts the
 *   real sender using assembly for gas efficiency.
 *
 *   calldata layout for forwarded calls:
 *   [original function data][sender address (20 bytes)]
 *
 * This pattern allows any existing ERC-20 function (transfer, approve, etc.)
 * to work seamlessly with both direct and relayed execution paths.
 */
contract SampleToken is ERC20 {

    address public trustedForwarder;  // The BatchExecutor address

    constructor(
        address _trustedForwarder
    ) ERC20("SampleToken", "SMPL") {
        trustedForwarder = _trustedForwarder;
        // Mint 1 million tokens to the deployer for testing
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    /**
     * @notice Override _msgSender to support meta-transactions.
     * If the call comes from the trusted forwarder (BatchExecutor),
     * the real sender is appended to the calldata (last 20 bytes).
     */
    function _msgSender() internal view override returns (address sender) {
        if (msg.sender == trustedForwarder && msg.data.length >= 20) {
            // Extract the original sender from the last 20 bytes
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
}
