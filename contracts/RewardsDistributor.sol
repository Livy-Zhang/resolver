// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RewardsDistributor
 * @notice Resolver-specific, Merkle-proof based rewards distributor deployed through clones.
 * @dev Rewards pass through three states: None -> Pending -> Claimable. The protocol's
 * rewardsUpdater proposes a root, and the resolver must then fund and confirm that exact root
 * before delegators can claim against it.
 */
contract RewardsDistributor is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EpochStatus {
        None,
        Pending,
        Claimable
    }

    struct Epoch {
        bytes32 merkleRoot;
        uint256 totalReward;
        EpochStatus status;
    }

    address public resolver;
    address public rewardsUpdater;
    IERC20 public rewardToken;
    uint256 public rewardRate;

    mapping(uint256 epochId => Epoch) public epochs;
    mapping(uint256 epochId => mapping(address delegator => bool)) public claimed;

    error InvalidAddress();
    error EpochAlreadyExists();
    error EpochNotPending();
    error EpochNotClaimable();
    error Unauthorized();
    error AlreadyClaimed();
    error InvalidProof();
    error InvalidEpochId();
    error InvalidMerkleRoot();
    error InvalidTotalReward();
    error InvalidRewardRate();

    event DistributorInitialized(
        address indexed resolver,
        address indexed rewardsUpdater,
        address indexed rewardToken,
        uint256 rewardRate
    );

    event RootSubmitted(uint256 indexed epochId, bytes32 indexed merkleRoot, uint256 totalReward);

    event RootConfirmed(uint256 indexed epochId, address indexed resolver, uint256 totalReward);

    event RewardRateUpdated(uint256 previousRewardRate, uint256 newRewardRate);

    event RewardClaimed(uint256 indexed epochId, address indexed delegator, uint256 amount);

    modifier onlyRewardsUpdater() {
        if (msg.sender != rewardsUpdater) revert Unauthorized();
        _;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert Unauthorized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes a clone created by {RewardsDistributorFactory}.
     * @param _resolver Resolver responsible for funding and confirming epochs.
     * @param _rewardsUpdater Protocol account authorized to submit Merkle roots.
     * @param _rewardToken ERC-20 token used for rewards by this clone.
     * @param _rewardRate Initial APR for this clone, scaled by 1e18 where 1e18 is 100% APR.
     */
    function initialize(
        address _resolver,
        address _rewardsUpdater,
        address _rewardToken,
        uint256 _rewardRate
    ) external initializer {
        if (
            _resolver == address(0) || _rewardsUpdater == address(0) || _rewardToken == address(0)
        ) {
            revert InvalidAddress();
        }
        if (_rewardRate == 0) revert InvalidRewardRate();

        resolver = _resolver;
        rewardsUpdater = _rewardsUpdater;
        rewardToken = IERC20(_rewardToken);
        rewardRate = _rewardRate;
        emit DistributorInitialized(_resolver, _rewardsUpdater, _rewardToken, _rewardRate);
    }

    /**
     * @notice Updates this resolver's APR.
     * @dev The stored value changes immediately, but off-chain reward calculations only apply
     * the new rate beginning with the next calendar month's reward period.
     * @param newRewardRate New APR, scaled by 1e18 where 1e18 is 100% APR.
     */
    function setRewardRate(uint256 newRewardRate) external onlyResolver {
        uint256 previousRewardRate = rewardRate;
        rewardRate = newRewardRate;
        emit RewardRateUpdated(previousRewardRate, newRewardRate);
    }

    /**
     * @notice Proposes an epoch's reward root. The epoch remains pending until the resolver funds it.
     * @param epochId Unique identifier for the reward period. Its time range is defined off-chain.
     * @param merkleRoot Root of leaves returned by {leaf}.
     * @param totalReward Total token amount the resolver must fund to confirm the epoch.
     */
    function submitRoot(
        uint256 epochId,
        bytes32 merkleRoot,
        uint256 totalReward
    ) external onlyRewardsUpdater {
        if (epochId == 0) revert InvalidEpochId();
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (totalReward == 0) revert InvalidTotalReward();
        if (epochs[epochId].status != EpochStatus.None) revert EpochAlreadyExists();

        epochs[epochId] = Epoch({
            merkleRoot: merkleRoot,
            totalReward: totalReward,
            status: EpochStatus.Pending
        });

        emit RootSubmitted(epochId, merkleRoot, totalReward);
    }

    /**
     * @notice Funds and activates a pending epoch proposed by the protocol.
     * @dev The resolver must first approve this distributor for the epoch's total reward.
     * @param epochId Pending epoch to confirm.
     */
    function confirmRoot(uint256 epochId) external onlyResolver nonReentrant {
        Epoch storage epoch = epochs[epochId];
        if (epoch.status != EpochStatus.Pending) revert EpochNotPending();

        IERC20(rewardToken).safeTransferFrom(resolver, address(this), epoch.totalReward);
        epoch.status = EpochStatus.Claimable;

        emit RootConfirmed(epochId, resolver, epoch.totalReward);
    }

    /**
     * @notice Claims a delegator's allocation for a claimable epoch.
     * @dev Anyone may submit a valid proof, but rewards are always paid to the encoded delegator.
     * @param epochId Claimable epoch identifier.
     * @param delegator Recipient encoded in the epoch's Merkle leaf.
     * @param amount Amount encoded for the delegator in the epoch's Merkle leaf.
     * @param proof Merkle proof for the delegator's leaf.
     */
    function claim(
        uint256 epochId,
        address delegator,
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant {
        Epoch storage epoch = epochs[epochId];
        if (epoch.status != EpochStatus.Claimable) revert EpochNotClaimable();
        if (claimed[epochId][delegator]) revert AlreadyClaimed();
        if (
            !MerkleProof.verifyCalldata(proof, epoch.merkleRoot, leaf(epochId, delegator, amount))
        ) {
            revert InvalidProof();
        }

        claimed[epochId][delegator] = true;
        rewardToken.safeTransfer(delegator, amount);

        emit RewardClaimed(epochId, delegator, amount);
    }

    /**
     * @notice Returns the sorted-Merkle-tree leaf for an epoch allocation.
     * @dev Leaves use `keccak256(abi.encodePacked(chainId, distributor, epochId, delegator, amount))`.
     * The off-chain tree must hash each pair in sorted order, as expected by {MerkleProof}.
     */
    function leaf(
        uint256 epochId,
        address delegator,
        uint256 amount
    ) public view returns (bytes32) {
        return
            keccak256(abi.encodePacked(block.chainid, address(this), epochId, delegator, amount));
    }
}
