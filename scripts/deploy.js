// scripts/deploy.js
// Hardhat deployment script with CommonJS

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    console.log("🚀 Starting contract deployment...\n");

    const { ethers } = hre;

    // Get signer  
    const [deployer] = await ethers.getSigners();
    console.log("🔐 Deployer Address:", deployer.address);

    try {
        // Get balance
        const balance = await deployer.provider.getBalance(deployer.address);
        console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

        // ============================================
        // 1. Deploy BatchExecutor
        // ============================================
        console.log("📦 Deploying BatchExecutor...");
        const BatchExecutor = await ethers.getContractFactory("BatchExecutor");
        const batchExecutor = await BatchExecutor.deploy();
        await batchExecutor.waitForDeployment();
        const batchExecutorAddress = await batchExecutor.getAddress();
        console.log("✅ BatchExecutor deployed at:", batchExecutorAddress);

        // ============================================
        // 2. Deploy SampleToken (with BatchExecutor as forwarder)
        // ============================================
        console.log("\n📦 Deploying SampleToken...");
        const SampleToken = await ethers.getContractFactory("SampleToken");
        const sampleToken = await SampleToken.deploy(batchExecutorAddress);
        await sampleToken.waitForDeployment();
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

        const GasSponsor = await ethers.getContractFactory("GasSponsor");
        const gasSponsor = await GasSponsor.deploy(
            limits.maxPerClaim,
            limits.dailyLimitPerRelayer,
            limits.dailyLimitPerUser,
            limits.globalDailyLimit
        );
        await gasSponsor.waitForDeployment();
        const gasSponsorAddress = await gasSponsor.getAddress();
        console.log("✅ GasSponsor deployed at:", gasSponsorAddress);

        // ============================================
        // 4. Whitelist relayer in GasSponsor
        // ============================================
        const relayerAddress = deployer.address;
        console.log("\n🔄 Whitelisting relayer...");
        const setRelayerTx = await gasSponsor.setRelayer(relayerAddress, true);
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
            network: hre.network.name,
            deployer: deployer.address,
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
