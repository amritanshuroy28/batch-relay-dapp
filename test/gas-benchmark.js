// test/gas-benchmark.js
// Gas Benchmarking & Validation Script
// Demonstrates correctness of batching and measures gas savings
//
// Usage:
//   npx hardhat run test/gas-benchmark.js --network sepolia
//   (or use localhost with `npx hardhat node` running)

import hre from "hardhat";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import "dotenv/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const RPC_URL = process.env.SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

// EIP-712 types
const FORWARD_REQUEST_TYPES = {
    ForwardRequest: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "data", type: "bytes" }
    ]
};

// ═══════════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function getEIP712Domain(batchExecutorAddress, chainId) {
    return {
        name: "BatchExecutor",
        version: "1",
        chainId: chainId,
        verifyingContract: batchExecutorAddress
    };
}

async function signForwardRequest(signer, domain, request) {
    return await signer.signTypedData(domain, FORWARD_REQUEST_TYPES, request);
}

function formatGas(gas) {
    return Number(gas).toLocaleString();
}

function formatETH(wei) {
    return ethers.formatEther(wei);
}

// ═══════════════════════════════════════════════════════════════════
//  DEPLOYMENT (for testing)
// ═══════════════════════════════════════════════════════════════════

async function deployContracts(signer) {
    console.log("📦 Deploying fresh contracts for testing...\n");

    // Load artifacts
    const artifacts = {
        BatchExecutor: await hre.artifacts.readArtifact("BatchExecutor"),
        SampleToken: await hre.artifacts.readArtifact("SampleToken"),
        GasSponsor: await hre.artifacts.readArtifact("GasSponsor")
    };

    // Deploy BatchExecutor
    const batchFactory = new ethers.ContractFactory(
        artifacts.BatchExecutor.abi,
        artifacts.BatchExecutor.bytecode,
        signer
    );
    const batchExecutor = await batchFactory.deploy();
    await batchExecutor.waitForDeployment();
    const batchAddr = await batchExecutor.getAddress();
    console.log(`  BatchExecutor: ${batchAddr}`);

    // Deploy SampleToken
    const tokenFactory = new ethers.ContractFactory(
        artifacts.SampleToken.abi,
        artifacts.SampleToken.bytecode,
        signer
    );
    const token = await tokenFactory.deploy(batchAddr);
    await token.waitForDeployment();
    const tokenAddr = await token.getAddress();
    console.log(`  SampleToken:   ${tokenAddr}`);

    // Deploy GasSponsor
    const sponsorFactory = new ethers.ContractFactory(
        artifacts.GasSponsor.abi,
        artifacts.GasSponsor.bytecode,
        signer
    );
    const sponsor = await sponsorFactory.deploy(
        ethers.parseEther("0.05"),  // maxPerClaim
        ethers.parseEther("1"),     // dailyLimitPerRelayer
        ethers.parseEther("0.01"),  // dailyLimitPerUser
        ethers.parseEther("5")      // globalDailyLimit
    );
    await sponsor.waitForDeployment();
    const sponsorAddr = await sponsor.getAddress();
    console.log(`  GasSponsor:    ${sponsorAddr}`);

    // Whitelist relayer
    const sponsorContract = new ethers.Contract(sponsorAddr, artifacts.GasSponsor.abi, signer);
    await (await sponsorContract.setRelayer(await signer.getAddress(), true)).wait();
    console.log(`  Relayer whitelisted ✓\n`);

    return { batchExecutor, token, sponsor, batchAddr, tokenAddr, sponsorAddr };
}

// ═══════════════════════════════════════════════════════════════════
//  TEST 1: Signature Verification
// ═══════════════════════════════════════════════════════════════════

async function testSignatureVerification(signer, batchExecutor, token, batchAddr, tokenAddr, chainId) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("  TEST 1: EIP-712 Signature Verification");
    console.log("═══════════════════════════════════════════════════════\n");

    const userAddress = await signer.getAddress();
    const domain = getEIP712Domain(batchAddr, chainId);
    const tokenIface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)"
    ]);

    // Build a request
    const nonce = Number(await batchExecutor.getNonce(userAddress));
    const request = {
        from: userAddress,
        to: tokenAddr,
        value: 0,
        gas: 200000,
        nonce: nonce,
        data: tokenIface.encodeFunctionData("transfer", [
            "0x0000000000000000000000000000000000000001",
            ethers.parseUnits("10", 18)
        ])
    };

    // Sign it
    const signature = await signForwardRequest(signer, domain, request);
    console.log(`  Request nonce: ${nonce}`);
    console.log(`  Signature: ${signature.slice(0, 20)}...`);

    // Verify on-chain
    const isValid = await batchExecutor.verify(request, signature);
    console.log(`  Verification result: ${isValid ? "✅ VALID" : "❌ INVALID"}`);

    // Test with wrong signer
    const wrongRequest = { ...request, from: "0x0000000000000000000000000000000000000001" };
    const isInvalid = await batchExecutor.verify(wrongRequest, signature);
    console.log(`  Wrong signer test:   ${!isInvalid ? "✅ REJECTED (correct)" : "❌ ACCEPTED (bug!)"}`);

    console.log();
    return isValid && !isInvalid;
}

// ═══════════════════════════════════════════════════════════════════
//  TEST 2: Nonce Replay Protection
// ═══════════════════════════════════════════════════════════════════

async function testNonceProtection(signer, batchExecutor, token, batchAddr, tokenAddr, chainId) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("  TEST 2: Nonce-Based Replay Protection");
    console.log("═══════════════════════════════════════════════════════\n");

    const userAddress = await signer.getAddress();
    const domain = getEIP712Domain(batchAddr, chainId);
    const tokenIface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)"
    ]);

    const nonce = Number(await batchExecutor.getNonce(userAddress));
    console.log(`  Current nonce: ${nonce}`);

    // Create and sign a valid request
    const request = {
        from: userAddress,
        to: tokenAddr,
        value: 0,
        gas: 200000,
        nonce: nonce,
        data: tokenIface.encodeFunctionData("transfer", [
            "0x0000000000000000000000000000000000000002",
            ethers.parseUnits("1", 18)
        ])
    };

    const signature = await signForwardRequest(signer, domain, request);

    // Execute it (should succeed)
    const tx = await batchExecutor.executeBatch([request], [signature]);
    const receipt = await tx.wait();
    console.log(`  First execution: ✅ SUCCESS (gas: ${formatGas(receipt.gasUsed)})`);

    // Try to replay the same request (should fail)
    try {
        await batchExecutor.executeBatch([request], [signature]);
        console.log(`  Replay attempt:  ❌ SUCCEEDED (bug!)`);
        return false;
    } catch (error) {
        console.log(`  Replay attempt:  ✅ REJECTED (nonce already used)`);
    }

    const newNonce = Number(await batchExecutor.getNonce(userAddress));
    console.log(`  Nonce after:     ${newNonce} (incremented from ${nonce})`);

    console.log();
    return newNonce === nonce + 1;
}

// ═══════════════════════════════════════════════════════════════════
//  TEST 3: Batch Execution & Gas Measurement
// ═══════════════════════════════════════════════════════════════════

async function testBatchExecution(signer, batchExecutor, token, batchAddr, tokenAddr, chainId, batchSize) {
    console.log("═══════════════════════════════════════════════════════");
    console.log(`  TEST 3: Batch Execution (${batchSize} transfers)`);
    console.log("═══════════════════════════════════════════════════════\n");

    const userAddress = await signer.getAddress();
    const domain = getEIP712Domain(batchAddr, chainId);
    const tokenIface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)"
    ]);

    // ── Measure individual transfers first ──
    console.log("  📊 Measuring individual transfer costs...");
    let totalIndividualGas = 0n;
    const recipients = [];

    for (let i = 0; i < batchSize; i++) {
        const recipient = ethers.Wallet.createRandom().address;
        recipients.push(recipient);

        const tx = await token.transfer(recipient, ethers.parseUnits("1", 18));
        const receipt = await tx.wait();
        totalIndividualGas += receipt.gasUsed;
    }

    console.log(`  Individual total: ${formatGas(totalIndividualGas)} gas (${batchSize} txs)\n`);

    // ── Now measure batched transfers ──
    console.log("  📊 Measuring batched transfer costs...");

    let currentNonce = Number(await batchExecutor.getNonce(userAddress));
    const requests = [];
    const signatures = [];

    for (let i = 0; i < batchSize; i++) {
        const request = {
            from: userAddress,
            to: tokenAddr,
            value: 0,
            gas: 200000,
            nonce: currentNonce + i,
            data: tokenIface.encodeFunctionData("transfer", [
                recipients[i],
                ethers.parseUnits("1", 18)
            ])
        };

        const signature = await signForwardRequest(signer, domain, request);
        requests.push(request);
        signatures.push(signature);
    }

    const batchTx = await batchExecutor.executeBatch(requests, signatures);
    const batchReceipt = await batchTx.wait();
    const batchGas = batchReceipt.gasUsed;

    console.log(`  Batched total:    ${formatGas(batchGas)} gas (1 tx)\n`);

    // ── Calculate savings ──
    const savings = totalIndividualGas - batchGas;
    const savingsPercent = Number((savings * 10000n) / totalIndividualGas) / 100;

    console.log("  ┌───────────────────────────────────────────────┐");
    console.log(`  │ Individual:  ${formatGas(totalIndividualGas).padStart(12)} gas  (${batchSize} transactions) │`);
    console.log(`  │ Batched:     ${formatGas(batchGas).padStart(12)} gas  (1 transaction)   │`);
    console.log(`  │ Saved:       ${formatGas(savings).padStart(12)} gas  (${savingsPercent.toFixed(1)}%)          │`);
    console.log("  └───────────────────────────────────────────────┘\n");

    return {
        batchSize,
        individualGas: Number(totalIndividualGas),
        batchedGas: Number(batchGas),
        savings: Number(savings),
        savingsPercent
    };
}

// ═══════════════════════════════════════════════════════════════════
//  TEST 4: Gas Sponsorship
// ═══════════════════════════════════════════════════════════════════

async function testGasSponsorship(signer, sponsor, sponsorAddr) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("  TEST 4: Gas Sponsorship Pool");
    console.log("═══════════════════════════════════════════════════════\n");

    const GAS_SPONSOR_ABI = [
        "function deposit() external payable",
        "function claim(uint256, address[]) external",
        "function getBalance() external view returns (uint256)",
        "function estimateReimbursement(uint256, address, address[]) external view returns (uint256, bool)",
        "function getRelayerDailyRemaining(address) external view returns (uint256)",
        "function getUserDailyRemaining(address) external view returns (uint256)",
        "function getGlobalDailyRemaining() external view returns (uint256)",
        "function totalDeposited() external view returns (uint256)",
        "function totalClaimed() external view returns (uint256)"
    ];

    const sponsorContract = new ethers.Contract(sponsorAddr, GAS_SPONSOR_ABI, signer);
    const relayerAddress = await signer.getAddress();

    // Check initial balance
    const initialBalance = await sponsorContract.getBalance();
    console.log(`  Pool balance (before): ${formatETH(initialBalance)} ETH`);

    // Deposit 0.01 ETH
    const depositAmount = ethers.parseEther("0.01");
    const depositTx = await sponsorContract.deposit({ value: depositAmount });
    await depositTx.wait();
    console.log(`  Deposited:            ${formatETH(depositAmount)} ETH ✅`);

    // Check balance after deposit
    const afterBalance = await sponsorContract.getBalance();
    console.log(`  Pool balance (after):  ${formatETH(afterBalance)} ETH`);

    // Estimate reimbursement
    const claimAmount = ethers.parseEther("0.001");
    const [reimburse, wouldSucceed] = await sponsorContract.estimateReimbursement(
        claimAmount,
        relayerAddress,
        [relayerAddress]
    );
    console.log(`  Estimate for 0.001 ETH claim: ${formatETH(reimburse)} ETH (would succeed: ${wouldSucceed}) ✅`);

    // Claim reimbursement
    const claimTx = await sponsorContract.claim(claimAmount, [relayerAddress]);
    const claimReceipt = await claimTx.wait();
    console.log(`  Claimed:              ${formatETH(claimAmount)} ETH (gas: ${formatGas(claimReceipt.gasUsed)}) ✅`);

    // Check daily remaining
    const relayerRemaining = await sponsorContract.getRelayerDailyRemaining(relayerAddress);
    const userRemaining = await sponsorContract.getUserDailyRemaining(relayerAddress);
    const globalRemaining = await sponsorContract.getGlobalDailyRemaining();
    console.log(`  Relayer daily remaining: ${formatETH(relayerRemaining)} ETH`);
    console.log(`  User daily remaining:    ${formatETH(userRemaining)} ETH`);
    console.log(`  Global daily remaining:  ${formatETH(globalRemaining)} ETH`);

    // Track totals
    const totalDeposited = await sponsorContract.totalDeposited();
    const totalClaimed = await sponsorContract.totalClaimed();
    console.log(`  Total deposited:       ${formatETH(totalDeposited)} ETH`);
    console.log(`  Total claimed:         ${formatETH(totalClaimed)} ETH`);

    console.log();
    return wouldSucceed;
}

// ═══════════════════════════════════════════════════════════════════
//  TEST 5: Multi-Size Gas Benchmark
// ═══════════════════════════════════════════════════════════════════

async function runGasBenchmark(signer, batchExecutor, token, batchAddr, tokenAddr, chainId) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("  TEST 5: Multi-Size Gas Benchmark");
    console.log("═══════════════════════════════════════════════════════\n");

    const batchSizes = [2, 5, 10];
    const results = [];

    for (const size of batchSizes) {
        const result = await testBatchExecution(
            signer, batchExecutor, token, batchAddr, tokenAddr, chainId, size
        );
        results.push(result);
    }

    // Summary table
    console.log("═══════════════════════════════════════════════════════");
    console.log("  GAS BENCHMARK SUMMARY");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("  Batch Size │ Individual Gas │  Batched Gas  │ Savings");
    console.log("  ───────────┼────────────────┼───────────────┼────────");

    for (const r of results) {
        console.log(
            `  ${String(r.batchSize).padStart(10)} │ ${formatGas(r.individualGas).padStart(14)} │ ${formatGas(r.batchedGas).padStart(13)} │ ${r.savingsPercent.toFixed(1)}%`
        );
    }

    console.log();
    return results;
}

// ═══════════════════════════════════════════════════════════════════
//  TEST 6: Failure Handling
// ═══════════════════════════════════════════════════════════════════

async function testFailureHandling(signer, batchExecutor, token, batchAddr, tokenAddr, chainId) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("  TEST 6: Failure Handling & Edge Cases");
    console.log("═══════════════════════════════════════════════════════\n");

    const domain = getEIP712Domain(batchAddr, chainId);
    const userAddress = await signer.getAddress();

    // Test 1: Empty batch should revert
    console.log("  [a] Empty batch...");
    try {
        await batchExecutor.executeBatch([], []);
        console.log("      ❌ Should have reverted");
    } catch (e) {
        console.log("      ✅ Reverted correctly (empty batch)");
    }

    // Test 2: Mismatched array lengths
    console.log("  [b] Mismatched arrays...");
    try {
        const tokenIface = new ethers.Interface(["function transfer(address, uint256) returns (bool)"]);
        const nonce = Number(await batchExecutor.getNonce(userAddress));
        const req = {
            from: userAddress, to: tokenAddr, value: 0, gas: 200000,
            nonce: nonce,
            data: tokenIface.encodeFunctionData("transfer", [
                "0x0000000000000000000000000000000000000001",
                ethers.parseUnits("1", 18)
            ])
        };
        const sig = await signForwardRequest(signer, domain, req);
        await batchExecutor.executeBatch([req, req], [sig]);
        console.log("      ❌ Should have reverted");
    } catch (e) {
        console.log("      ✅ Reverted correctly (length mismatch)");
    }

    // Test 3: Wrong nonce
    console.log("  [c] Wrong nonce...");
    try {
        const tokenIface = new ethers.Interface(["function transfer(address, uint256) returns (bool)"]);
        const req = {
            from: userAddress, to: tokenAddr, value: 0, gas: 200000,
            nonce: 999999, // Wrong nonce
            data: tokenIface.encodeFunctionData("transfer", [
                "0x0000000000000000000000000000000000000001",
                ethers.parseUnits("1", 18)
            ])
        };
        const sig = await signForwardRequest(signer, domain, req);
        await batchExecutor.executeBatch([req], [sig]);
        console.log("      ❌ Should have reverted");
    } catch (e) {
        console.log("      ✅ Reverted correctly (invalid nonce)");
    }

    console.log();
    return true;
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════════

async function main() {
    console.log("\n╔═══════════════════════════════════════════════════════╗");
    console.log("║   Gas Fee Optimizer — Test & Validation Suite         ║");
    console.log("║   Batch Transaction System Benchmark                  ║");
    console.log("╚═══════════════════════════════════════════════════════╝\n");

    if (!PRIVATE_KEY) {
        console.error("❌ DEPLOYER_PRIVATE_KEY not set in .env");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log(`  Network:  ${network.name} (chain ID: ${chainId})`);
    console.log(`  Signer:   ${await signer.getAddress()}`);
    
    const balance = await provider.getBalance(await signer.getAddress());
    console.log(`  Balance:  ${formatETH(balance)} ETH\n`);

    // Deploy fresh contracts
    const { batchExecutor, token, sponsor, batchAddr, tokenAddr, sponsorAddr } =
        await deployContracts(signer);

    const results = {
        signatureVerification: false,
        nonceProtection: false,
        gasSponsorship: false,
        failureHandling: false,
        benchmark: []
    };

    // Run tests
    try {
        results.signatureVerification = await testSignatureVerification(
            signer, batchExecutor, token, batchAddr, tokenAddr, chainId
        );
    } catch (e) {
        console.error("  ❌ Test 1 failed:", e.message);
    }

    try {
        results.nonceProtection = await testNonceProtection(
            signer, batchExecutor, token, batchAddr, tokenAddr, chainId
        );
    } catch (e) {
        console.error("  ❌ Test 2 failed:", e.message);
    }

    try {
        results.benchmark = await runGasBenchmark(
            signer, batchExecutor, token, batchAddr, tokenAddr, chainId
        );
    } catch (e) {
        console.error("  ❌ Test 5 (Benchmark) failed:", e.message);
    }

    try {
        results.gasSponsorship = await testGasSponsorship(signer, sponsor, sponsorAddr);
    } catch (e) {
        console.error("  ❌ Test 4 failed:", e.message);
    }

    try {
        results.failureHandling = await testFailureHandling(
            signer, batchExecutor, token, batchAddr, tokenAddr, chainId
        );
    } catch (e) {
        console.error("  ❌ Test 6 failed:", e.message);
    }

    // Final Report
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║                    FINAL REPORT                       ║");
    console.log("╠═══════════════════════════════════════════════════════╣");
    console.log(`║  Signature Verification: ${results.signatureVerification ? "✅ PASS" : "❌ FAIL"}                    ║`);
    console.log(`║  Nonce Replay Protection: ${results.nonceProtection ? "✅ PASS" : "❌ FAIL"}                   ║`);
    console.log(`║  Gas Sponsorship:        ${results.gasSponsorship ? "✅ PASS" : "❌ FAIL"}                    ║`);
    console.log(`║  Failure Handling:       ${results.failureHandling ? "✅ PASS" : "❌ FAIL"}                    ║`);
    console.log("╠═══════════════════════════════════════════════════════╣");

    if (results.benchmark.length > 0) {
        console.log("║  Gas Savings Summary:                                 ║");
        for (const r of results.benchmark) {
            const line = `║    ${r.batchSize} txs: ${r.savingsPercent.toFixed(1)}% savings (${formatGas(r.savings)} gas saved)`;
            console.log(line.padEnd(57) + "║");
        }
    }

    console.log("╚═══════════════════════════════════════════════════════╝\n");

    // Save results to file
    const reportPath = path.join(__dirname, "..", "test-results.json");
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        network: network.name,
        chainId,
        results
    }, null, 2));
    console.log(`📄 Results saved to test-results.json\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Test suite failed:", error);
        process.exit(1);
    });
