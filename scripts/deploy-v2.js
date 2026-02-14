// scripts/deploy-v2.js
// Hardhat deployment script with direct ethers import

import hre from "hardhat";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import "dotenv/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    console.log("🚀 Starting contract deployment...\n");

    // Get network provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    
    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY not set in .env");
    }
    
    const signer = new ethers.Wallet(privateKey, provider);
    const deployerAddress = await signer.getAddress();
    
    console.log("🔐 Deployer Address:", deployerAddress);

    try {
        // Get balance
        const balance = await provider.getBalance(deployerAddress);
        console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

        // Get contract artifacts from Hardhat
        const deployedArtifacts = {
            BatchExecutor: await hre.artifacts.readArtifact("BatchExecutor"),
            SampleToken: await hre.artifacts.readArtifact("SampleToken"),
            GasSponsor: await hre.artifacts.readArtifact("GasSponsor")
        };

        // ============================================
        // 1. Deploy BatchExecutor
        // ============================================
        console.log("📦 Deploying BatchExecutor...");
        const BatchExecutorArtifact = deployedArtifacts.BatchExecutor;
        const batchExecutorFactory = new ethers.ContractFactory(
            BatchExecutorArtifact.abi,
            BatchExecutorArtifact.bytecode,
            signer
        );
        const batchExecutor = await batchExecutorFactory.deploy();
        const batchExecutorReceipt = await batchExecutor.waitForDeployment();
        const batchExecutorAddress = await batchExecutor.getAddress();
        console.log("✅ BatchExecutor deployed at:", batchExecutorAddress);

        // ============================================
        // 2. Deploy SampleToken (with BatchExecutor as forwarder)
        // ============================================
        console.log("\n📦 Deploying SampleToken...");
        const SampleTokenArtifact = deployedArtifacts.SampleToken;
        const sampleTokenFactory = new ethers.ContractFactory(
            SampleTokenArtifact.abi,
            SampleTokenArtifact.bytecode,
            signer
        );
        const sampleToken = await sampleTokenFactory.deploy(batchExecutorAddress);
        const sampleTokenReceipt = await sampleToken.waitForDeployment();
        const sampleTokenAddress = await sampleToken.getAddress();
        console.log("✅ SampleToken deployed at:", sampleTokenAddress);

        // ============================================
        // 3. Deploy GasSponsor with limits
        // ============================================
        console.log("\n📦 Deploying GasSponsor...");
        
        const limits = {
            maxPerClaim: ethers.parseEther("0.05"),           // 0.05 ETH max per claim
            dailyLimitPerRelayer: ethers.parseEther("1"),     // 1 ETH per relayer per day
            dailyLimitPerUser: ethers.parseEther("0.01"),     // 0.01 ETH per user per day
            globalDailyLimit: ethers.parseEther("5")          // 5 ETH global daily limit
        };

        const GasSponsorArtifact = deployedArtifacts.GasSponsor;
        const gasSponsorFactory = new ethers.ContractFactory(
            GasSponsorArtifact.abi,
            GasSponsorArtifact.bytecode,
            signer
        );
        const gasSponsor = await gasSponsorFactory.deploy(
            limits.maxPerClaim,
            limits.dailyLimitPerRelayer,
            limits.dailyLimitPerUser,
            limits.globalDailyLimit
        );
        const gasSponsorReceipt = await gasSponsor.waitForDeployment();
        const gasSponsorAddress = await gasSponsor.getAddress();
        console.log("✅ GasSponsor deployed at:", gasSponsorAddress);

        // ============================================
        // 4. Whitelist relayer in GasSponsor
        // ============================================
        const relayerAddress = deployerAddress;
        console.log("\n🔄 Whitelisting relayer...");
        const gasSponsorContract = new ethers.Contract(
            gasSponsorAddress,
            GasSponsorArtifact.abi,
            signer
        );
        const setRelayerTx = await gasSponsorContract.setRelayer(relayerAddress, true);
        await setRelayerTx.wait();
        console.log("✅ Relayer whitelisted:", relayerAddress);

        // ============================================
        // 5. Update .env file
        // ============================================
        console.log("\n📝 Updating .env file...");
        const envPath = path.join(__dirname, "..", ".env");
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

        const updates = {
            BATCH_EXECUTOR_ADDRESS: batchExecutorAddress,
            SAMPLE_TOKEN_ADDRESS: sampleTokenAddress,
            GAS_SPONSOR_ADDRESS: gasSponsorAddress,
            RELAYER_ADDRESS: relayerAddress
        };

        for (const [key, value] of Object.entries(updates)) {
            const regex = new RegExp(`^${key}=.*$`, "m");
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${key}=${value}`);
            } else {
                envContent += `${key}=${value}\n`;
            }
        }

        fs.writeFileSync(envPath, envContent);
        console.log("✅ .env file updated");

        // ============================================
        // 6. Save deployment info to JSON
        // ============================================
        const deploymentInfo = {
            timestamp: new Date().toISOString(),
            network: "sepolia",
            deployer: deployerAddress,
            contracts: {
                BatchExecutor: {
                    address: batchExecutorAddress
                },
                SampleToken: {
                    address: sampleTokenAddress,
                    trustForwarder: batchExecutorAddress
                },
                GasSponsor: {
                    address: gasSponsorAddress,
                    limits: {
                        maxPerClaim: ethers.formatEther(limits.maxPerClaim) + " ETH",
                        dailyLimitPerRelayer: ethers.formatEther(limits.dailyLimitPerRelayer) + " ETH",
                        dailyLimitPerUser: ethers.formatEther(limits.dailyLimitPerUser) + " ETH",
                        globalDailyLimit: ethers.formatEther(limits.globalDailyLimit) + " ETH"
                    }
                }
            }
        };

        const deploymentPath = path.join(__dirname, "..", "deployment.json");
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        console.log("✅ Deployment info saved to deployment.json");

        // ============================================
        // 7. Summary
        // ============================================
        console.log("\n" + "=".repeat(70));
        console.log("🎉 DEPLOYMENT COMPLETE!");
        console.log("=".repeat(70));
        console.log("\n📋 Contract Addresses:");
        console.log(`  BatchExecutor:  ${batchExecutorAddress}`);
        console.log(`  SampleToken:    ${sampleTokenAddress}`);
        console.log(`  GasSponsor:     ${gasSponsorAddress}`);
        console.log(`  Relayer:        ${relayerAddress}`);
        console.log("\n⚙️  Gas Sponsor Limits:");
        console.log(`  Max per claim:          ${ethers.formatEther(limits.maxPerClaim)} ETH`);
        console.log(`  Daily relayer limit:    ${ethers.formatEther(limits.dailyLimitPerRelayer)} ETH`);
        console.log(`  Daily user limit:       ${ethers.formatEther(limits.dailyLimitPerUser)} ETH`);
        console.log(`  Global daily limit:     ${ethers.formatEther(limits.globalDailyLimit)} ETH`);
        console.log("\n📝 Next Steps:");
        console.log("1. Fund the GasSponsor contract with ETH");
        console.log("2. Update index.html CONFIG object with deployed addresses");
        console.log("3. Start the server: npm start");
        console.log("\n🔗 View on Sepolia Etherscan:");
        console.log(`  https://sepolia.etherscan.io/address/${batchExecutorAddress}`);
        console.log("=".repeat(70) + "\n");

    } catch (error) {
        console.error("\n❌ Deployment failed:", error.message);
        console.error(error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
