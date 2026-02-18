// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * @title GasSponsor
 * @author Gas Fee Optimizer — Batch Transaction System
 * @notice Manages a gas sponsorship pool with configurable multi-layer constraints,
 *         enabling full or partial gas fee subsidization for meta-transaction users.
 *
 * @dev Implements a defense-in-depth approach to pool security with 6 constraint layers:
 *
 * SPONSORSHIP MODES:
 *   Mode 1 — Full Sponsorship:    Relayer gets 100% reimbursement (up to cap)
 *            Use case: User onboarding, promotional campaigns
 *   Mode 2 — Partial Sponsorship: Relayer gets up to maxPerClaim, absorbs the rest
 *            Use case: Sustainable ongoing operations
 *   Mode 3 — No Sponsorship:      GasSponsor not deployed; relayer absorbs all costs
 *            Use case: Relayer funded by service fees
 *
 * CONSTRAINT LAYERS (defense-in-depth):
 *   Layer 1: Per-Claim Cap        — Bounds maximum single reimbursement
 *   Layer 2: Per-Relayer Daily     — Prevents one relayer from draining the pool
 *   Layer 3: Per-User Daily        — Prevents Sybil-style abuse by single users
 *   Layer 4: Global Daily          — Hard cap on total daily spending
 *   Layer 5: Pool Balance Check    — Cannot reimburse more than the pool holds
 *   Layer 6: Emergency Pause       — Owner can freeze all claims instantly
 *
 * ECONOMICS:
 *   The pool acts as a shared public good. Any address can deposit ETH.
 *   Only whitelisted relayers can claim reimbursement after executing batches.
 *   Per-user costs are split equally among batch participants for fair accounting.
 *
 * SECURITY:
 *   - Only whitelisted relayers can claim (setRelayer by owner)
 *   - Day-based limit resets use block.timestamp / 1 days for gas efficiency
 *   - estimateReimbursement() allows pre-checking without state changes
 *   - emergencyWithdraw() provides a safety valve for compromised contracts
 */
contract GasSponsor {

    // ─── State Variables ─────────────────────────────────────────

    address public owner;
    bool public paused;           // Emergency pause flag

    // Relayer management
    mapping(address => bool) public whitelistedRelayers;

    // ─── Constraint Configuration ────────────────────────────────
    // All amounts in wei

    uint256 public maxPerClaim;       // Max reimbursement per single claim
    uint256 public dailyLimitPerRelayer;  // Max per relayer per day
    uint256 public dailyLimitPerUser;     // Max sponsored per user per day
    uint256 public globalDailyLimit;      // Max total daily spending

    // ─── Tracking ────────────────────────────────────────────────

    // Relayer daily tracking
    mapping(address => uint256) public relayerDailyClaimed;
    mapping(address => uint256) public relayerLastClaimDay;

    // User daily tracking (how much gas has been sponsored for each user)
    mapping(address => uint256) public userDailySponsored;
    mapping(address => uint256) public userLastSponsorDay;

    // Global daily tracking
    uint256 public globalDailyClaimed;
    uint256 public globalLastClaimDay;

    // Total statistics
    uint256 public totalDeposited;
    uint256 public totalClaimed;
    uint256 public totalClaimCount;

    // ─── Events ──────────────────────────────────────────────────

    event Deposited(address indexed sponsor, uint256 amount);
    event Claimed(
        address indexed relayer,
        uint256 amount,
        address[] users,
        uint256 batchSize
    );
    event RelayerStatusChanged(address indexed relayer, bool whitelisted);
    event LimitsUpdated(
        uint256 maxPerClaim,
        uint256 dailyLimitPerRelayer,
        uint256 dailyLimitPerUser,
        uint256 globalDailyLimit
    );
    event Paused(bool status);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event EmergencyWithdrawal(address indexed owner, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "GasSponsor: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "GasSponsor: paused");
        _;
    }

    modifier onlyWhitelistedRelayer() {
        require(whitelistedRelayers[msg.sender], "GasSponsor: not whitelisted");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────

    constructor(
        uint256 _maxPerClaim,
        uint256 _dailyLimitPerRelayer,
        uint256 _dailyLimitPerUser,
        uint256 _globalDailyLimit
    ) {
        owner = msg.sender;
        maxPerClaim = _maxPerClaim;
        dailyLimitPerRelayer = _dailyLimitPerRelayer;
        dailyLimitPerUser = _dailyLimitPerUser;
        globalDailyLimit = _globalDailyLimit;
    }

    // ─── Deposit Functions ───────────────────────────────────────

    /**
     * @notice Deposit ETH to fund gas sponsorship.
     * Anyone can call this — dApp owners, DAOs, users who want
     * to contribute to the pool.
     */
    function deposit() external payable {
        require(msg.value > 0, "GasSponsor: zero deposit");
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    // ─── Claim Function (The Core Logic) ─────────────────────────

    /**
     * @notice Relayer claims reimbursement after executing a batch.
     * 
     * @param amount   - Total gas cost the relayer spent
     * @param users    - Array of user addresses in the batch
     *                   (for per-user tracking)
     * 
     * HOW PARTIAL SPONSORSHIP WORKS:
     * If the relayer spent 0.01 ETH but maxPerClaim is 0.005 ETH,
     * they only get reimbursed 0.005 ETH. The relayer absorbs
     * the rest, or can charge users through other means.
     */
    function claim(
        uint256 amount,
        address[] calldata users
    ) external onlyWhitelistedRelayer whenNotPaused {
        
        // ── Step 1: Cap the claim amount ──
        uint256 reimbursement = amount;
        if (reimbursement > maxPerClaim) {
            reimbursement = maxPerClaim;  // Partial sponsorship kicks in
        }

        // ── Step 2: Check relayer daily limit ──
        uint256 today = block.timestamp / 1 days;

        if (relayerLastClaimDay[msg.sender] < today) {
            relayerDailyClaimed[msg.sender] = 0;
            relayerLastClaimDay[msg.sender] = today;
        }

        require(
            relayerDailyClaimed[msg.sender] + reimbursement <= dailyLimitPerRelayer,
            "GasSponsor: relayer daily limit reached"
        );

        // ── Step 3: Check per-user daily limits ──
        // Split reimbursement equally among users for tracking purposes
        uint256 perUserCost = reimbursement / users.length;

        for (uint256 i = 0; i < users.length; i++) {
            if (userLastSponsorDay[users[i]] < today) {
                userDailySponsored[users[i]] = 0;
                userLastSponsorDay[users[i]] = today;
            }

            require(
                userDailySponsored[users[i]] + perUserCost <= dailyLimitPerUser,
                "GasSponsor: user daily limit reached"
            );
        }

        // ── Step 4: Check global daily limit ──
        if (globalLastClaimDay < today) {
            globalDailyClaimed = 0;
            globalLastClaimDay = today;
        }

        require(
            globalDailyClaimed + reimbursement <= globalDailyLimit,
            "GasSponsor: global daily limit reached"
        );

        // ── Step 5: Check pool balance ──
        require(
            address(this).balance >= reimbursement,
            "GasSponsor: insufficient pool funds"
        );

        // ── Step 6: Update all tracking state ──
        relayerDailyClaimed[msg.sender] += reimbursement;

        for (uint256 i = 0; i < users.length; i++) {
            userDailySponsored[users[i]] += perUserCost;
        }

        globalDailyClaimed += reimbursement;
        totalClaimed += reimbursement;
        totalClaimCount++;

        // ── Step 7: Transfer reimbursement ──
        (bool sent, ) = payable(msg.sender).call{value: reimbursement}("");
        require(sent, "GasSponsor: transfer failed");

        emit Claimed(msg.sender, reimbursement, users, users.length);
    }

    // ─── Pre-check Function ──────────────────────────────────────

    /**
     * @notice Check if a claim would succeed without executing it.
     * Useful for the relayer to decide whether to submit a batch.
     * Returns the actual reimbursement amount (may be less than requested).
     */
    function estimateReimbursement(
        uint256 amount,
        address relayer,
        address[] calldata users
    ) external view returns (uint256 reimbursement, bool wouldSucceed) {
        
        reimbursement = amount;
        if (reimbursement > maxPerClaim) {
            reimbursement = maxPerClaim;
        }

        // Check pool balance
        if (address(this).balance < reimbursement) {
            return (0, false);
        }

        // Check relayer daily limit
        uint256 today = block.timestamp / 1 days;
        uint256 relayerClaimed = relayerDailyClaimed[relayer];
        if (relayerLastClaimDay[relayer] < today) {
            relayerClaimed = 0;
        }
        if (relayerClaimed + reimbursement > dailyLimitPerRelayer) {
            return (0, false);
        }

        // Check global daily limit
        uint256 globalClaimed = globalDailyClaimed;
        if (globalLastClaimDay < today) {
            globalClaimed = 0;
        }
        if (globalClaimed + reimbursement > globalDailyLimit) {
            return (0, false);
        }

        // Check per-user limits
        uint256 perUserCost = reimbursement / users.length;
        for (uint256 i = 0; i < users.length; i++) {
            uint256 userClaimed = userDailySponsored[users[i]];
            if (userLastSponsorDay[users[i]] < today) {
                userClaimed = 0;
            }
            if (userClaimed + perUserCost > dailyLimitPerUser) {
                return (0, false);
            }
        }

        return (reimbursement, true);
    }

    // ─── Admin Functions ─────────────────────────────────────────

    function setRelayer(address relayer, bool status) external onlyOwner {
        whitelistedRelayers[relayer] = status;
        emit RelayerStatusChanged(relayer, status);
    }

    function setLimits(
        uint256 _maxPerClaim,
        uint256 _dailyLimitPerRelayer,
        uint256 _dailyLimitPerUser,
        uint256 _globalDailyLimit
    ) external onlyOwner {
        maxPerClaim = _maxPerClaim;
        dailyLimitPerRelayer = _dailyLimitPerRelayer;
        dailyLimitPerUser = _dailyLimitPerUser;
        globalDailyLimit = _globalDailyLimit;
        emit LimitsUpdated(_maxPerClaim, _dailyLimitPerRelayer, _dailyLimitPerUser, _globalDailyLimit);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "GasSponsor: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Emergency withdrawal — owner can pull all funds.
     * Only use if the contract is compromised or being deprecated.
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool sent, ) = payable(owner).call{value: balance}("");
        require(sent, "GasSponsor: transfer failed");
        emit EmergencyWithdrawal(owner, balance);
    }

    // ─── View Functions ──────────────────────────────────────────

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getRelayerDailyRemaining(address relayer) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 claimed = relayerDailyClaimed[relayer];
        if (relayerLastClaimDay[relayer] < today) {
            claimed = 0;
        }
        return dailyLimitPerRelayer > claimed ? dailyLimitPerRelayer - claimed : 0;
    }

    function getUserDailyRemaining(address user) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 claimed = userDailySponsored[user];
        if (userLastSponsorDay[user] < today) {
            claimed = 0;
        }
        return dailyLimitPerUser > claimed ? dailyLimitPerUser - claimed : 0;
    }

    function getGlobalDailyRemaining() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 claimed = globalDailyClaimed;
        if (globalLastClaimDay < today) {
            claimed = 0;
        }
        return globalDailyLimit > claimed ? globalDailyLimit - claimed : 0;
    }

    receive() external payable {
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value);
    }
}
