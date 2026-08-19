// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStakingManager} from "./interface/IStakingManager.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

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

    function delegatedAmountOf(address delegator) external view returns (uint256) {
        return delegations[delegator].delegatedAmount;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, durationEnd);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalDelegated == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalDelegated;
    }

    function earned(address delegator) public view returns (uint256) {
        return
            (delegations[delegator].delegatedAmount *
                (rewardPerToken() - userRewardPerTokenPaid[delegator])) /
                1e18 +
            rewards[delegator];
    }

    function getRewardForDuration() public view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

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

    function exit() external nonReentrant updateReward(msg.sender) {
        Delegation storage delegationInfo = delegations[msg.sender];
        _undelegate(msg.sender, delegationInfo.delegatedAmount, delegationInfo);
        _claimReward(msg.sender);
    }

    /**
     * @notice Notify the contract about a new reward amount.
     * @dev This function is called by the owner to notify the contract about a new reward amount.
     * @dev Owner should transfer staking tokens and then call this function to notify the contract about the new reward amount upon contract deployment.
     * @param reward The amount of reward tokens to be distributed.
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
        uint balance = REWARD_TOKEN.balanceOf(address(this));
        if (rewardRate > balance / rewardsDuration) revert RewardAmountTooHigh();

        lastUpdateTime = block.timestamp;
        durationEnd = block.timestamp + rewardsDuration;
        emit RewardAdded(reward);
    }

    function setFreezingPeriod(uint256 _freezingPeriod) external onlyOwner {
        freezingPeriod = _freezingPeriod;
        emit FreezingPeriodUpdated(freezingPeriod);
    }

    function isValidDelegation(address delegator) public view returns (bool) {
        return delegations[delegator].delegatedAmount > 0;
    }

    function getTotalDelegated() external view returns (uint256) {
        return totalDelegated;
    }
}
