// relayer.js
// This runs on a server (or locally for testing).
// It collects signed requests and submits batch transactions.

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// --- Configuration ---
const BATCH_EXECUTOR_ABI = [
    "function executeBatch((address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data)[] requests, bytes[] signatures) external payable returns (bool[])",
    "function verify((address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data) req, bytes signature) external view returns (bool)",
    "function getNonce(address from) external view returns (uint256)",
    "event BatchExecuted(address indexed relayer, uint256 totalRequests, uint256 successCount)"
];

const GAS_SPONSOR_ABI = [
    "function claim(uint256 amount, address[] calldata users) external",
    "function getBalance() external view returns (uint256)"
];

class Relayer {
    constructor(config) {
        // Connect to Sepolia
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);

        // Relayer's own wallet (this account pays gas upfront)
        this.wallet = new ethers.Wallet(config.relayerPrivateKey, this.provider);

        // Contract instances
        this.batchExecutor = new ethers.Contract(
            config.batchExecutorAddress,
            BATCH_EXECUTOR_ABI,
            this.wallet
        );

        this.gasSponsor = config.gasSponsorAddress
            ? new ethers.Contract(config.gasSponsorAddress, GAS_SPONSOR_ABI, this.wallet)
            : null;

        // Queue of pending requests
        this.pendingRequests = [];
        this.pendingSignatures = [];

        // Settings
        this.maxBatchSize = config.maxBatchSize || 10;
        this.batchIntervalMs = config.batchIntervalMs || 15000; // 15 seconds
    }

    /**
     * Add a signed request to the queue.
     * Called when the frontend sends a signed request via API.
     */
    async addRequest(request, signature) {
        // Verify the signature before accepting it
        const isValid = await this.batchExecutor.verify(request, signature);

        if (!isValid) {
            throw new Error("Invalid signature or nonce");
        }

        this.pendingRequests.push(request);
        this.pendingSignatures.push(signature);

        console.log(`Request queued from ${request.from} (nonce: ${request.nonce})`);
        console.log(`Queue size: ${this.pendingRequests.length}`);

        // If queue is full, flush immediately
        if (this.pendingRequests.length >= this.maxBatchSize) {
            return await this.flushBatch();
        }

        return { status: "queued", queueSize: this.pendingRequests.length };
    }

    /**
     * Submit all queued requests as one batch transaction.
     * This is where the gas savings happen!
     */
    async flushBatch() {
        if (this.pendingRequests.length === 0) {
            console.log("No pending requests to flush.");
            return null;
        }

        const requests = [...this.pendingRequests];
        const signatures = [...this.pendingSignatures];

        // Clear the queue
        this.pendingRequests = [];
        this.pendingSignatures = [];

        console.log(`\nSubmitting batch of ${requests.length} requests...`);

        try {
            // Estimate gas first (so we know the cost)
            const estimatedGas = await this.batchExecutor.executeBatch.estimateGas(
                requests,
                signatures
            );

            console.log(`Estimated gas: ${estimatedGas.toString()}`);

            // Submit the batch transaction
            const tx = await this.batchExecutor.executeBatch(
                requests,
                signatures,
                {
                    gasLimit: estimatedGas * 120n / 100n  // 20% buffer
                }
            );

            console.log(`Transaction submitted: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait();

            console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
            console.log(`Actual gas used: ${receipt.gasUsed.toString()}`);

            // Calculate cost - need to get gas price from the transaction
            const txDetails = await this.provider.getTransaction(tx.hash);
            const gasPrice = txDetails.gasPrice || tx.gasPrice;
            
            if (!gasPrice) {
                console.warn("⚠️  Warning: Could not determine gas price, skipping reimbursement");
                return {
                    status: "executed",
                    txHash: tx.hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString(),
                    batchSize: requests.length,
                    warning: "Gas price unavailable, reimbursement skipped"
                };
            }
            
            const gasCost = receipt.gasUsed * gasPrice;
            console.log(`Gas cost: ${ethers.formatEther(gasCost)} ETH`);

            // Optionally claim reimbursement from GasSponsor
            if (this.gasSponsor) {
                // Extract unique user addresses from the batch (deduplicate)
                const users = [...new Set(requests.map(req => req.from))];
                await this.claimReimbursement(gasCost, users);
            }

            return {
                status: "executed",
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                batchSize: requests.length
            };
        } catch (error) {
            console.error("Batch execution failed:", error.message);
            // Put requests back in queue for retry
            this.pendingRequests = [...requests, ...this.pendingRequests];
            this.pendingSignatures = [...signatures, ...this.pendingSignatures];
            throw error;
        }
    }

    /**
     * Claim gas reimbursement from the GasSponsor contract.
     */
    async claimReimbursement(gasCost, users) {
        try {
            const poolBalance = await this.gasSponsor.getBalance();
            console.log(`GasSponsor pool balance: ${ethers.formatEther(poolBalance)} ETH`);

            if (poolBalance >= gasCost) {
                const claimTx = await this.gasSponsor.claim(gasCost, users);
                await claimTx.wait();
                console.log(`Reimbursed: ${ethers.formatEther(gasCost)} ETH`);
            } else {
                console.log("Insufficient sponsor funds, skipping reimbursement");
            }
        } catch (error) {
            console.error("Reimbursement failed:", error.message);
        }
    }

    /**
     * Start automatic batch flushing at regular intervals.
     */
    startAutoFlush() {
        console.log(`Relayer started. Flushing every ${this.batchIntervalMs / 1000}s`);
        console.log(`Max batch size: ${this.maxBatchSize}`);

        this.interval = setInterval(async () => {
            if (this.pendingRequests.length > 0) {
                await this.flushBatch();
            }
        }, this.batchIntervalMs);
    }

    /**
     * Stop the auto-flush interval.
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            console.log("Relayer stopped.");
        }
    }
}

/*
### Sponsorship Modes Explained

Here's how a dApp owner would configure different sponsorship strategies:

Mode 1: Full Sponsorship (generous — for onboarding)
  maxPerClaim        = 0.05 ETH    (covers most batch transactions)
  dailyLimitPerRelayer = 1 ETH     (relayer can claim up to 1 ETH/day)
  dailyLimitPerUser    = 0.01 ETH  (each user gets ~20 free txs/day)  
  globalDailyLimit     = 5 ETH     (total cap to prevent draining)

Mode 2: Partial Sponsorship (sustainable — for ongoing use)
  maxPerClaim        = 0.005 ETH   (covers ~50% of typical batch cost)
  dailyLimitPerRelayer = 0.5 ETH
  dailyLimitPerUser    = 0.003 ETH (users get a small daily subsidy)
  globalDailyLimit     = 2 ETH

Mode 3: Relayer-Only (no user subsidy)
  No GasSponsor deployed at all.
*/

export { Relayer };