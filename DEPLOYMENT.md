# Batch Executor - Gas Optimized Batch Relay dApp

## Setup & Deployment Guide

### Prerequisites

1. **Node.js** (v18+) - Already installed ✓
2. **Sepolia Testnet Account** - With some Sepolia ETH for gas
3. **RPC URL** - Infura, Alchemy, or Quicknode (free tier available)
4. **Private Key** - Only use a test account!

### Installation

All dependencies are already installed:
```bash
npm install
```

### Environment Setup

Create a `.env` file in the root directory with:

```env
# Sepolia RPC URL (get from Infura, Alchemy, etc.)
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY

# Deployer Private Key (NEVER use mainnet keys!)
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Optional: Etherscan API Key for verification
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY

# Server Configuration
PORT=3000
RELAYER_PRIVATE_KEY=YOUR_RELAYER_PRIVATE_KEY
MAX_BATCH_SIZE=10
BATCH_INTERVAL_MS=15000
```

### Step 1: Get Sepolia ETH

1. Go to https://sepoliafaucet.com
2. Enter your wallet address
3. Request test ETH (you need at least 0.1 ETH for deployment)

### Step 2: Compile Contracts

```bash
npx hardhat compile
```

This will:
- Download the Solidity 0.8.20 compiler
- Compile all contracts in `./contracts/`
- Generate artifacts in `./artifacts/`

### Step 3: Deploy Contracts

```bash
npm run deploy -- --network sepolia
```

The deployment script will:
1. Deploy BatchExecutor contract
2. Deploy SampleToken with BatchExecutor as the trusted forwarder
3. Deploy GasSponsor with predefined limits
4. Whitelist the relayer address in GasSponsor
5. Update `.env` with deployed contract addresses
6. Save deployment info to `deployment.json`

### Step 4: Fund GasSponsor Pool

Send ETH to the GasSponsor contract address (shown after deployment):

```bash
# Using cast (Foundry)
cast send <GAS_SPONSOR_ADDRESS> --value 0.1ether

# Or manually send ETH through MetaMask/Etherscan
```

### Step 5: Start the Server

```bash
npm start
```

The server will run on http://localhost:3000

## File Structure

```
.
├── contracts/                 # Solidity contracts
│   ├── BatchExecutor.sol      # Main batch execution contract
│   ├── GasSponsor.sol         # Gas sponsorship pool
│   └── SampleToken.sol        # ERC-20 token for testing
├── scripts/
│   └── deploy.js              # Hardhat deployment script
├── index.html                 # Frontend dApp interface
├── server.js                  # Express server
├── relayer.js                 # Relayer logic
├── signer.js                  # Offline signer utility
├── hardhat.config.js          # Hardhat configuration
├── package.json               # Dependencies
└── .env                       # Environment variables (create this)
```

## Contract Addresses

After deployment, check `deployment.json` for:
- `BatchExecutor.address` - Main contract for batching
- `SampleToken.address` - Test token
- `GasSponsor.address` - Gas sponsorship pool

Update these in `index.html` CONFIG object:
```javascript
const CONFIG = {
    batchExecutorAddress: "0x...",
    sampleTokenAddress: "0x...",
    gasSponsorAddress: "0x...",
};
```

## Gas Sponsor Configuration

Default limits (adjust in `scripts/deploy.js` before deploying):

- **Max per claim**: 0.05 ETH
- **Daily relayer limit**: 1 ETH
- **Daily user limit**: 0.01 ETH per address
- **Global daily limit**: 5 ETH total

## Features

### 1. Batch Execution
- Users sign transactions off-chain
- Relayer collects and batches them
- Execute multiple transactions in one call
- **Gas savings**: ~70% reduction vs individual txs

### 2. Meta-Transactions
- Users don't pay gas directly
- Relayer submits batched transactions
- Optional gas sponsorship pool for subsidy

### 3. EIP-712 Signatures
- Standard signature format (Web3.js compatible)
- Replay protection via nonce + chain ID
- Signature verification on-chain

### 4. Gas Sponsorship
- Configurable sponsorship tiers
- Daily limits per relayer/user/global
- Emergency pause functionality
- Owner can adjust limits or withdraw funds

## API Endpoints

### GET /
HTML frontend interface

### GET /health
Check server and relayer status
```json
{
  "status": "ok",
  "relayer": "initialized|not configured",
  "timestamp": "2026-02-15T..."
}
```

### POST /api/relay
Submit a signed request
```json
{
  "request": {
    "from": "0x...",
    "to": "0x...",
    "value": "0",
    "gas": "100000",
    "nonce": "0",
    "data": "0x..."
  },
  "signature": "0x..."
}
```

## Testing

### 1. Connect Wallet in Frontend
- Open http://localhost:3000
- Connect MetaMask to Sepolia
- Approve gas sponsorship pool access

### 2. Send Test Transactions
- Select recipients
- Set amount
- Sign and submit

### 3. Monitor Relayer
- Check server logs for batch submissions
- View transaction on Etherscan
- Track gas savings

## Troubleshooting

### Compilation fails
```bash
# Clear cache and reinstall
rm -rf hardhat_cache artifacts
npm install
npx hardhat compile
```

### Deployment fails
- Check RPC URL is correct
- Verify private key has funds
- Ensure correct network selected
- Check gas price/limit settings

### Server won't start
```bash
# Check if port 3000 is in use
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows
```

### Relayer not initialized
- Verify all environment variables in `.env`
- Check contract addresses are correct
- Ensure RPC URL is working

## Security Notes

🚨 **IMPORTANT**: Never use mainnet private keys!

1. Always use testnet accounts
2. Never commit `.env` to git
3. Use environment variables in production
4. The GasSponsor contract owns the sponsorship pool
5. Owner can pause claims and withdraw funds

## Next Steps

1. Deploy to Sepolia testnet
2. Test batch transactions
3. Monitor gas savings
4. Adjust sponsorship limits as needed
5. Deploy GasSponsor to mainnet (when ready)

## Support

For issues or questions:
- Check Solidity contracts for inline documentation
- Review Hardhat docs: https://hardhat.org
- Ethers.js docs: https://docs.ethers.org/v6/

Good luck! 🚀
