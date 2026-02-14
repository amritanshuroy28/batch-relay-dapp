#!/usr/bin/env node

/**
 * Quick Deployment Helper
 * Run with: node deploy-helper.js
 */

import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function main() {
    console.log("\n" + "=".repeat(70));
    console.log("🚀 Batch Executor - Deployment Helper");
    console.log("=".repeat(70) + "\n");

    // Check if .env exists
    const envPath = path.join(__dirname, ".env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

    console.log("📋 Step 1: Environment Configuration\n");

    const rpcUrl = await question("Enter Sepolia RPC URL (https://...): ");
    const privateKey = await question("Enter deployer private key (0x...): ");
    const etherscanKey = await question("Enter Etherscan API key (optional): ");

    // Update .env
    const updates = {
        SEPOLIA_RPC_URL: rpcUrl,
        DEPLOYER_PRIVATE_KEY: privateKey
    };

    if (etherscanKey) {
        updates.ETHERSCAN_API_KEY = etherscanKey;
    }

    for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
            envContent += `${key}=${value}\n`;
        }
    }

    fs.writeFileSync(envPath, envContent);
    console.log("✅ Environment saved to .env\n");

    // Compile
    console.log("📦 Step 2: Compiling Contracts\n");
    console.log("This may take a minute...\n");

    try {
        execSync("npx hardhat compile", { stdio: "inherit" });
        console.log("\n✅ Contracts compiled successfully\n");
    } catch (error) {
        console.error("❌ Compilation failed:", error.message);
        rl.close();
        process.exit(1);
    }

    // Deploy
    console.log("🚀 Step 3: Deploying Contracts\n");
    const proceed = await question("Ready to deploy to Sepolia? (yes/no): ");

    if (proceed.toLowerCase() !== "yes") {
        console.log("Deployment cancelled.");
        rl.close();
        process.exit(0);
    }

    try {
        execSync("npm run deploy -- --network sepolia", { stdio: "inherit" });
        console.log("\n✅ Deployment successful!\n");
    } catch (error) {
        console.error("❌ Deployment failed:", error.message);
        rl.close();
        process.exit(1);
    }

    // Fund GasSponsor
    console.log("💰 Step 4: Fund GasSponsor Pool\n");

    try {
        const deploymentJson = fs.readFileSync(
            path.join(__dirname, "deployment.json"),
            "utf8"
        );
        const deployment = JSON.parse(deploymentJson);
        const gasSponsorAddress = deployment.contracts.GasSponsor.address;

        console.log(`Send ETH to: ${gasSponsorAddress}`);
        console.log("Recommended: 0.1 - 1 ETH (depending on expected usage)\n");

        const funded = await question("Have you funded the GasSponsor? (yes/no): ");

        if (funded.toLowerCase() === "yes") {
            console.log("\n✅ All set! You can now start the server.\n");
            console.log("Run: npm start\n");
        }
    } catch (error) {
        console.log("⚠️  Could not read deployment file. Check deployment.json manually.\n");
    }

    // Next steps
    console.log("📝 Next Steps:\n");
    console.log("1. Update index.html with contract addresses from deployment.json");
    console.log("2. Run: npm start");
    console.log("3. Open http://localhost:3000");
    console.log("4. Connect wallet and test batch transfers\n");

    console.log("=".repeat(70) + "\n");

    rl.close();
}

main().catch(console.error);
