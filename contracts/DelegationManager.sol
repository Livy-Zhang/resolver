// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStakingManager} from "./interface/IStakingManager.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DelegationManager
 * @notice Holds delegated staking tokens and distributes time-based rewards to delegators.
 * @dev Resolver eligibility is checked when users delegate or redelegate, but is not guaranteed
 * for the lifetime of a delegation. Delegators must monitor resolver eligibility themselves.
 */
contract DelegationManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable REWARD_TOKEN;
    IERC20 public immutable STAKING_TOKEN;
    IStakingManager public immutable STAKING_MANAGER;
    uint256 public durationEnd;
    uint256 public rewardRate;
    uint256 public rewardsDuration;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public freezingPeriod;

    struct Delegation {
        uint256 delegatedAmount;
        uint256 updatedAt;
        address resolver;
    }

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 public totalDelegated;
    mapping(address => Delegation) public delegations; // delegator => Delegation
    mapping(address => uint256) public delegationTo; // resolver => total delegated amount to that resolver

    error InvalidAddress();
    error InvalidDuration();
    error NotValidResolver();
    error NotValidDelegation();
    error InvalidUndelegationAmount();
    error InvalidNewResolver();
    error InvalidRewardAmount();
    error RewardAmountTooHigh();
    error OnlyOneDelegationAllowed();
    error InvalidFreezingPeriod();
    error InvalidDelegationAmount();
    error FreezingPeriodNotOver();

    event RewardAdded(uint256 reward);
    event RewardPaid(address indexed user, uint256 reward);
    event FreezingPeriodUpdated(uint256 freezingPeriod);
    event Delegated(address indexed delegator, address indexed resolver, uint256 amount);
    event Undelegated(address indexed delegator, uint256 amount);
    event Redelegated(
        address indexed delegator,
        address indexed oldResolver,
        address indexed newResolver
    );

    modifier updateReward(address delegator) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (delegator != address(0)) {
            rewards[delegator] = earned(delegator);
            userRewardPerTokenPaid[delegator] = rewardPerTokenStored;
        }
        _;
    }

    /**
     * @notice Creates a delegation and reward distribution manager.
     * @param _rewardsToken ERC-20 token paid as delegation rewards.
     * @param _stakingToken ERC-20 token deposited by delegators.
     * @param _stakingManager Contract used to check resolver eligibility.
     * @param _durationInDays Duration of each reward period, in days.
     * @param _freezingPeriod Delay in seconds before a delegation can be withdrawn or redelegated.
     */
    constructor(
        address _rewardsToken,
        address _stakingToken,
        address _stakingManager,
        uint256 _durationInDays,
        uint256 _freezingPeriod
    ) Ownable(msg.sender) {
        if (
            _rewardsToken == address(0) ||
            _stakingToken == address(0) ||
            _stakingManager == address(0)
        ) {
            revert InvalidAddress();
        }
        if (_durationInDays == 0) {
            revert InvalidDuration();
        }
        if (_freezingPeriod == 0) {
            revert InvalidFreezingPeriod();
        }
        REWARD_TOKEN = IERC20(_rewardsToken);
        STAKING_TOKEN = IERC20(_stakingToken);
        STAKING_MANAGER = IStakingManager(_stakingManager);
        rewardsDuration = _durationInDays * 3600 * 24;
        freezingPeriod = _freezingPeriod;
    }

    /**
     * @notice Returns an account's currently delegated token amount.
     * @param delegator Account whose delegation is queried.
     * @return amount Current delegated amount.
     */
    function delegatedAmountOf(address delegator) external view returns (uint256) {
        return delegations[delegator].delegatedAmount;
    }

    /**
     * @notice Returns the latest timestamp at which rewards may accrue.
     * @return timestamp The lesser of the current timestamp and reward-period end.
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, durationEnd);
    }

    /**
     * @notice Returns cumulative rewards per delegated token, scaled by 1e18.
     * @return accumulatedRewardPerToken Current reward-per-token accumulator.
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalDelegated == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalDelegated;
    }

    /**
     * @notice Returns the accrued, unclaimed reward for a delegator.
     * @param delegator Account whose reward is queried.
     * @return reward Amount currently accrued for the account.
     */
    function earned(address delegator) public view returns (uint256) {
        return
            (delegations[delegator].delegatedAmount *
                (rewardPerToken() - userRewardPerTokenPaid[delegator])) /
                1e18 +
            rewards[delegator];
    }

    /**
     * @notice Returns the scheduled rewards for one complete reward period.
     * @return reward Total reward emitted during the period at the current rate.
     */
    function getRewardForDuration() public view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /**
     * @notice Delegates staking tokens to an eligible resolver.
     * @dev Eligibility is checked only for this call. Delegators must monitor the resolver after
     * delegating because its self-stake may later fall below the eligibility threshold.
     * @param resolver Resolver receiving delegation attribution.
     * @param delegationAmount Amount of staking tokens to delegate.
     */
    function delegate(
        address resolver,
        uint256 delegationAmount
    ) external nonReentrant updateReward(msg.sender) {
        if (resolver == address(0)) revert InvalidAddress();
        if (delegationAmount == 0) revert InvalidDelegationAmount();
        if (!STAKING_MANAGER.isValidResolver(resolver)) revert NotValidResolver();
        _delegate(msg.sender, resolver, delegationAmount);
    }

    function _delegate(address delegator, address resolver, uint256 delegationAmount) internal {
        Delegation storage delegationInfo = delegations[delegator];
        if (delegationInfo.delegatedAmount > 0) {
            if (delegationInfo.resolver != resolver) {
                revert OnlyOneDelegationAllowed();
            }
        } else {
            delegationInfo.resolver = resolver;
        }

        delegationInfo.delegatedAmount += delegationAmount;
        delegationInfo.updatedAt = block.timestamp;

        totalDelegated += delegationAmount;
        delegationTo[resolver] += delegationAmount;
        STAKING_TOKEN.safeTransferFrom(delegator, address(this), delegationAmount);
        emit Delegated(delegator, resolver, delegationAmount);
    }

    /**
     * @notice Withdraws some or all of the caller's delegation after the freezing period.
     * @param undelegationAmount Amount of staking tokens to withdraw.
     */
    function undelegate(uint256 undelegationAmount) public nonReentrant updateReward(msg.sender) {
        if (undelegationAmount == 0) revert InvalidUndelegationAmount();
        Delegation storage delegationInfo = delegations[msg.sender];
        if (delegationInfo.delegatedAmount == 0) revert NotValidDelegation();
        if (delegationInfo.delegatedAmount < undelegationAmount) revert InvalidUndelegationAmount();
        _undelegate(msg.sender, undelegationAmount, delegationInfo);
    }

    function _undelegate(
        address delegator,
        uint256 undelegationAmount,
        Delegation storage delegationInfo
    ) internal {
        if (block.timestamp < delegationInfo.updatedAt + freezingPeriod)
            revert FreezingPeriodNotOver();

        delegationInfo.delegatedAmount -= undelegationAmount;
        totalDelegated -= undelegationAmount;
        delegationTo[delegationInfo.resolver] -= undelegationAmount;

        if (delegationInfo.delegatedAmount == 0) {
            delete delegations[delegator];
        }
        STAKING_TOKEN.safeTransfer(delegator, undelegationAmount);
        emit Undelegated(delegator, undelegationAmount);
    }

    /**
     * @notice Moves the caller's full delegation to another eligible resolver.
     * @dev A successful redelegation resets the freezing period.
     * @param newResolver Resolver receiving the delegation attribution.
     */
    function redelegate(address newResolver) external nonReentrant updateReward(msg.sender) {
        if (!STAKING_MANAGER.isValidResolver(newResolver)) revert NotValidResolver();

        Delegation storage delegationInfo = delegations[msg.sender];
        if (delegationInfo.delegatedAmount == 0) revert NotValidDelegation();
        if (delegationInfo.resolver == newResolver) revert InvalidNewResolver();
        if (block.timestamp < delegationInfo.updatedAt + freezingPeriod)
            revert FreezingPeriodNotOver();
        address oldResolver = delegationInfo.resolver;
        uint256 delegatedAmount = delegationInfo.delegatedAmount;

        delegationInfo.updatedAt = block.timestamp;
        delegationInfo.resolver = newResolver;

        delegationTo[oldResolver] -= delegatedAmount;
        delegationTo[newResolver] += delegatedAmount;

        emit Redelegated(msg.sender, oldResolver, newResolver);
    }

    /** @notice Claims all rewards accrued by the caller. */
    function claimReward() public nonReentrant updateReward(msg.sender) {
        _claimReward(msg.sender);
    }

    function _claimReward(address delegator) internal {
        uint256 reward = rewards[delegator];
        if (reward > 0) {
            rewards[delegator] = 0;
            REWARD_TOKEN.safeTransfer(delegator, reward);
            emit RewardPaid(delegator, reward);
        }
    }

    /** @notice Withdraws the caller's entire delegation and claims all accrued rewards. */
    function exit() external nonReentrant updateReward(msg.sender) {
        Delegation storage delegationInfo = delegations[msg.sender];
        if (delegationInfo.delegatedAmount == 0) revert NotValidDelegation();
        _undelegate(msg.sender, delegationInfo.delegatedAmount, delegationInfo);
        _claimReward(msg.sender);
    }

    /**
     * @notice Starts or replaces the reward schedule using a new reward amount.
     * @dev The owner must transfer sufficient reward tokens to this contract before calling this function.
     * @dev this function does not transfer tokens from the owner.
     * @param reward Amount of reward tokens to distribute over the next period.
     */
    function notifyRewardAmount(uint256 reward) external onlyOwner updateReward(address(0)) {
        if (reward == 0) revert InvalidRewardAmount();
        if (block.timestamp >= durationEnd) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = durationEnd - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = REWARD_TOKEN.balanceOf(address(this));
        if (rewardRate > balance / rewardsDuration) revert RewardAmountTooHigh();

        lastUpdateTime = block.timestamp;
        durationEnd = block.timestamp + rewardsDuration;
        emit RewardAdded(reward);
    }

    /**
     * @notice Updates the delay before delegation withdrawal or redelegation.
     * @dev Trusted owner governance may set this value to zero.
     * @param _freezingPeriod New freezing period in seconds.
     */
    function setFreezingPeriod(uint256 _freezingPeriod) external onlyOwner {
        freezingPeriod = _freezingPeriod;
        emit FreezingPeriodUpdated(freezingPeriod);
    }

    /**
     * @notice Returns whether an account has a non-zero active delegation.
     * @param delegator Account whose delegation is queried.
     * @return valid True when the account has an active delegation.
     */
    function isValidDelegation(address delegator) public view returns (bool) {
        return delegations[delegator].delegatedAmount > 0;
    }

    /**
     * @notice Returns total staking tokens held as delegations.
     * @return amount Aggregate delegated amount.
     */
    function getTotalDelegated() external view returns (uint256) {
        return totalDelegated;
    }
}
