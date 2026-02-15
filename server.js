// server.js
// Express server for the Batch Relay dApp

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Relayer } from "./relayer.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Initialize Relayer (if environment variables are set)
let relayer = null;

if (process.env.SEPOLIA_RPC_URL && process.env.RELAYER_PRIVATE_KEY && process.env.BATCH_EXECUTOR_ADDRESS) {
    relayer = new Relayer({
        rpcUrl: process.env.SEPOLIA_RPC_URL,
        relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY,
        batchExecutorAddress: process.env.BATCH_EXECUTOR_ADDRESS,
        gasSponsorAddress: process.env.GAS_SPONSOR_ADDRESS || null,
        maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || "10"),
        batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || "15000")
    });

    relayer.startAutoFlush();
    console.log("✓ Relayer initialized and running");
} else {
    console.warn("⚠ Relayer not initialized. Missing environment variables:");
    console.warn("  - SEPOLIA_RPC_URL");
    console.warn("  - RELAYER_PRIVATE_KEY");
    console.warn("  - BATCH_EXECUTOR_ADDRESS");
}

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        relayer: relayer ? "initialized" : "not configured",
        timestamp: new Date().toISOString()
    });
});

// API endpoint to submit a signed request to the relayer
app.post("/api/relay", async (req, res) => {
    if (!relayer) {
        return res.status(503).json({
            error: "Relayer not configured. Check environment variables."
        });
    }

    try {
        const { request, signature } = req.body;

        if (!request || !signature) {
            return res.status(400).json({
                error: "Missing 'request' or 'signature' in body"
            });
        }

        // Add the signed request to the relayer queue
        const result = await relayer.addRequest(request, signature);

        res.json({
            status: result.status || "queued",
            queueLength: relayer.pendingRequests.length,
            message: "Request added to batch queue"
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log("\nEndpoints:");
    console.log(`  GET  /              - HTML interface`);
    console.log(`  GET  /health        - Health check`);
    console.log(`  POST /api/relay     - Submit signed transaction\n`);
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\nShutting down gracefully...");
    if (relayer) relayer.stop();
    process.exit(0);
});
