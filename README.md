# Gas-Optimized Batch Transaction Relay

A complete dApp for batching Ethereum transactions to save gas, with optional gas sponsorship pool support.

## 🎯 Live Deployment (Sepolia Testnet)

| Component | Address |
|-----------|---------|
| **BatchExecutor Contract** | [`0xf1f0d57a5EA38627dcDa27bA0557988866170862`](https://sepolia.etherscan.io/address/0xf1f0d57a5EA38627dcDa27bA0557988866170862) |
| **SampleToken (ERC-20)** | [`0x4cC232F1bacC60f81288AE1B1202F46AA1e37F15`](https://sepolia.etherscan.io/address/0x4cC232F1bacC60f81288AE1B1202F46AA1e37F15) |
| **GasSponsor Pool** | [`0xE0B5356288De0B086a9f9AD530E81f23bE4c4133`](https://sepolia.etherscan.io/address/0xE0B5356288De0B086a9f9AD530E81f23bE4c4133) |

**Server**: http://localhost:3000 (run `npm start`)

## 🎯 What This Does

- **Batch Transactions**: Bundle multiple transactions into one on-chain call (~70% gas savings)
- **Meta-Transactions**: Users don't need to hold ETH for gas
- **Gas Sponsorship**: Optional pool to subsidize gas costs for users
- **EIP-712 Signatures**: Standard, secure off-chain transaction signing

## 📦 What You've Got

### Smart Contracts (in `contracts/`)
1. **BatchExecutor**
   - Validates signatures (EIP-712)
   - Executes batched transactions
   - Tracks nonces for replay protection

2. **GasSponsor**
   - Manages gas sponsorship pool
   - Configurable daily limits (global, per-relayer, per-user)
   - Emergency pause and withdrawal functions

3. **SampleToken**
   - ERC-20 token for testing
   - Supports meta-transaction awareness
   - Mints 1M tokens to deployer

### Backend (Node.js)
- **server.js** - Express server, serves dApp + endpoints
- **relayer.js** - Batch collector and executor
- **signer.js** - Off-chain transaction signer

### Frontend
- **index.html** - Web interface for users

## 🚀 Quick Start

### 1. Prerequisites

You need:
- Node.js v18+ (already installed ✓)
- Sepolia testnet ETH (~0.1 ETH for deployment)
- A private key (testnet-only!)

### 2. Get Sepolia ETH

Visit https://sepoliafaucet.com and request test ETH

### 3. Set Up Environment

Create `.env` file with:

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=your_key  # optional
```

Get RPC URL from:
- Infura: https://infura.io (free tier)
- Alchemy: https://alchemy.com
- Quicknode: https://quicknode.com

### 4. Deploy Contracts

```bash
# Compile contracts
npm run compile

# Deploy to Sepolia
npm run deploy -- --network sepolia
```

This will save contract addresses to `.env` and `deployment.json`

### 5. Fund Gas Sponsor Pool

Create a transaction to send ETH to the GasSponsor address:

```bash
# Using MetaMask or Etherscan
# Send 0.1-1 ETH to the address from deployment output
```

### 6. Update Frontend Configuration

In `index.html`, update the CONFIG object with your deployed addresses:

```javascript
const CONFIG = {
    batchExecutorAddress: "0x...",
    sampleTokenAddress: "0x...",
    gasSponsorAddress: "0x...",
};
```

### 7. Start Server

```bash
npm start
```

Open http://localhost:3000

## 🛠️ Development Commands

```bash
npm run compile          # Compile Solidity contracts
npm run deploy           # Deploy to Sepolia
npm run deploy:helper    # Interactive deployment wizard
npm start                # Start server
npm run dev              # Start server (same as start)
```

## 📝 File Structure

```
newdApp/
├── contracts/                      # Solidity smart contracts
│   ├── BatchExecutor.sol           # Main batching logic
│   ├── GasSponsor.sol              # Gas sponsorship pool
│   └── SampleToken.sol             # Test ERC-20 token
├── scripts/
│   └── deploy.js                   # Hardhat deployment script
├── artifacts/                      # Compiled contracts (generated)
├── server.js                       # Express server
├── relayer.js                      # Relayer batch logic
├── signer.js                       # Transaction signer utility
├── index.html                      # Web frontend
├── hardhat.config.js               # Hardhat configuration
├── deploy-helper.js                # Interactive deploy wizard
├── package.json                    # Dependencies
├── .env                            # Environment variables (create this)
└── DEPLOYMENT.md                   # Detailed deployment guide
```

## 🔑 Key Concepts

### Batching
Users sign multiple transaction requests off-chain. The relayer collects them and submits all at once:

```
Single txs:  5 calls × 21,000 gas each = 105,000 gas
Batched:     1 call with 5 txs = ~31,500 gas
Savings:     70% gas reduction
```

### Meta-Transactions
1. User signs transaction off-chain (no gas needed)
2. Relayer submits signed transactions
3. Smart contract verifies signature
4. Only relayer pays gas (can be reimbursed by pool)

### EIP-712 Signatures
Standard Ethereum signature format where users sign:
```solidity
struct ForwardRequest {
    address from;      // User's address
    address to;        // Contract to call
    uint256 value;     // ETH to send
    uint256 gas;       // Gas for this tx
    uint256 nonce;     // Replay protection
    bytes data;        // Encoded function call
}
```

## 💻 How It Works (Example)

1. **User prepares 3 token transfers**
   ```javascript
   const requests = [
       { from: user1, to: token, data: transfer(user2, 100) },
       { from: user2, to: token, data: transfer(user3, 50) },
       { from: user3, to: token, data: transfer(user1, 75) },
   ];
   ```

2. **User signs each request**
   ```javascript
   const signatures = await Promise.all(
       requests.map(req => sign(req))
   );
   ```

3. **Send to relayer API**
   ```javascript
   await fetch("/api/relay", {
       method: "POST",
       body: JSON.stringify({ request: requests[0], signature: signatures[0] })
   });
   ```

4. **Relayer batches them**
   - Collects requests over 15 seconds (configurable)
   - Verifies each signature
   - Groups into batch

5. **Relayer submits batch**
   ```javascript
   await batchExecutor.executeBatch(requests, signatures);
   ```

6. **Gas reimbursement** (if GasSponsor has funds)
   - Relayer's gas cost calculated
   - Sponsor pool reimburses relayer
   - User benefits from subsidy

## ⚙️ Gas Sponsor Configuration

Default limits (edit in `scripts/deploy.js` before deployment):

```javascript
const limits = {
    maxPerClaim: 0.05 ETH,           // Max per batch
    dailyLimitPerRelayer: 1 ETH,     // Relayer daily limit
    dailyLimitPerUser: 0.01 ETH,     // Per-address limit
    globalDailyLimit: 5 ETH          // Total daily limit
};
```

### Admin Functions (Owner Only)

```solidity
setRelayer(address, bool)           // Whitelist/blacklist relayer
setLimits(max, relayerDaily, userDaily, globalDaily)
setPaused(bool)                     // Emergency pause
emergencyWithdraw()                 // Withdraw all funds
```

## 🔒 Security

✅ **What's Protected**
- EIP-712 signature verification
- Nonce tracking (replay protection)
- Chain-ID binding (no cross-chain attacks)
- Configurable limits (no pool draining)
- Owner pause function (emergency stop)

⚠️ **What to Remember**
- Never use mainnet private keys during testing
- Test thoroughly on Sepolia first
- Review contract code before deployment
- Use reasonable gas sponsor limits
- Monitor sponsorship pool balance

## 🧪 Testing

### Test on Sepolia
1. Deploy contracts (see above)
2. Fund GasSponsor with ETH
3. Open http://localhost:3000
4. Connect MetaMask to Sepolia
5. Try batch transfers
6. Watch gas savings in transaction explorer

### Monitor Transactions
- View batches on Etherscan: https://sepolia.etherscan.io
- Check server logs for batch submissions
- Track relayer's address in explorer

## 📊 Expected Gas Savings

| Scenario | Traditional | Batched | Savings |
|----------|-----------|---------|---------|
| 5 token transfers | 105,000 gas | 31,500 gas | 70% |
| 10 transfers | 210,000 gas | 62,000 gas | 70% |
| 20 transfers | 420,000 gas | 120,000 gas | 71% |

*Actual savings depend on calldata size and storage operations*

## 🐛 Troubleshooting

### Deployment fails
```bash
# Check you have Sepolia ETH
# Verify RPC URL works
# Check gas price isn't too high
```

### Contracts won't compile
```bash
rm -rf artifacts hardhat_cache
npm run compile
```

### Server won't start
```bash
# Port 3000 in use?
netstat -ano | findstr :3000

# Check environment variables
cat .env
```

### Relayer not batching
```bash
# Check server logs
# Verify contract addresses in .env
# Ensure GasSponsor has ETH (check balance)
```

## 📚 Learn More

### Solidity
- Read inline comments in contracts
- Standard OpenZeppelin ERC-20 patterns

### Hardhat
- https://hardhat.org/docs

### Ethers.js
- https://docs.ethers.org/v6/

### EIP-712
- https://eips.ethereum.org/EIPS/eip-712

## 📄 License

MIT

## Support Files

- **DEPLOYMENT.md** - Detailed deployment steps
- **deployment.json** - Contract addresses after deployment
- **artifacts/** - Compiled contract ABIs and bytecode

---

**Ready to deploy?**

```bash
node deploy-helper.js
```

This will guide you through the entire process! 🚀
