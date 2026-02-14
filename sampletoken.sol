// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import  "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SampleToken
 * @notice A simple ERC-20 token for testing batch transfers.
 *         Supports meta-transaction awareness (recognizes the
 *         original sender appended by BatchExecutor).
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