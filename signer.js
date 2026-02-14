// signer.js
// This runs in the user's browser.
// It creates ForwardRequests and gets the user to sign them.

const EIP712_DOMAIN_TYPE = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
];

const FORWARD_REQUEST_TYPE = [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "data", type: "bytes" }
];

/**
 * Creates the EIP-712 domain data.
 * This MUST match what the smart contract uses in its constructor,
 * otherwise signatures won't verify.
 */
function getDomain(batchExecutorAddress, chainId) {
    return {
        name: "BatchExecutor",
        version: "1",
        chainId: chainId,
        verifyingContract: batchExecutorAddress
    };
}

/**
 * Build a ForwardRequest object.
 * 
 * @param from     - User's wallet address
 * @param to       - Target contract to call (e.g., SampleToken address)
 * @param data     - Encoded function call (e.g., transfer(to, amount))
 * @param nonce    - User's current nonce from BatchExecutor
 * @param gasLimit - Gas limit for this specific call
 * @param value    - ETH to send (usually 0)
 */
function buildRequest(from, to, data, nonce, gasLimit = 200000, value = 0) {
    return {
        from: from,
        to: to,
        value: value,
        gas: gasLimit,
        nonce: nonce,
        data: data
    };
}

/**
 * Ask the user's wallet to sign a ForwardRequest using EIP-712.
 * 
 * This is the KEY function. When called, MetaMask pops up and shows
 * the user a readable version of what they're signing:
 * 
 *   "BatchExecutor wants you to sign:
 *    from: 0xYourAddress
 *    to: 0xTokenAddress
 *    nonce: 3
 *    data: 0xa9059cbb..."
 * 
 * The user clicks "Sign" — no gas paid!
 * 
 * @param provider  - ethers.js BrowserProvider (connected to MetaMask)
 * @param request   - The ForwardRequest object
 * @param batchExecutorAddress - Address of the deployed BatchExecutor
 * @param chainId   - Network chain ID (11155111 for Sepolia)
 * @returns         - The signature (65 bytes hex string)
 */
async function signRequest(provider, request, batchExecutorAddress, chainId) {
    const signer = await provider.getSigner();
    const domain = getDomain(batchExecutorAddress, chainId);

    // EIP-712 typed data signing
    // This uses eth_signTypedData_v4 under the hood
    const signature = await signer.signTypedData(
        domain,                              // Domain (binds to contract + chain)
        { ForwardRequest: FORWARD_REQUEST_TYPE }, // Type definitions
        request                              // The actual data to sign
    );

    return signature;
}

/**
 * Helper: Encode a function call to use as the `data` field.
 * 
 * Example: To encode "transfer(0xBob, 1000)", you'd do:
 *   const iface = new ethers.Interface(tokenABI);
 *   const data = iface.encodeFunctionData("transfer", [bobAddress, 1000]);
 */
function encodeFunctionCall(contractInterface, functionName, args) {
    return contractInterface.encodeFunctionData(functionName, args);
}

/**
 * FULL FLOW: Sign multiple requests for batching.
 * 
 * This is what the frontend calls. It:
 * 1. Gets the user's current nonce
 * 2. Builds a request for each action
 * 3. Signs each request (nonce increments for each)
 * 4. Returns arrays ready to send to the relayer
 */
async function signBatchRequests(
    provider,
    batchExecutorContract,  // ethers.Contract instance
    batchExecutorAddress,
    chainId,
    actions  // Array of { to, data, gasLimit?, value? }
) {
    const signer = await provider.getSigner();
    const userAddress = await signer.getAddress();

    // Get current nonce from the contract
    let currentNonce = await batchExecutorContract.getNonce(userAddress);
    currentNonce = Number(currentNonce);

    const requests = [];
    const signatures = [];

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        // Build the request with incrementing nonce
        const request = buildRequest(
            userAddress,
            action.to,
            action.data,
            currentNonce + i,       // Each request gets the next nonce
            action.gasLimit || 200000,
            action.value || 0
        );

        // Sign it (MetaMask popup for each — in production you'd
        // use a session key or batch signing to reduce popups)
        const signature = await signRequest(
            provider,
            request,
            batchExecutorAddress,
            chainId
        );

        requests.push(request);
        signatures.push(signature);
    }

    return { requests, signatures };
}