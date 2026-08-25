// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StakingManager
 * @notice Manages resolver self-stake, unstaking delays, and resolver-authorized operators.
 * @dev Resolver eligibility can change after users delegate to that resolver. Delegators must
 * independently monitor resolver eligibility through {isValidResolver}.
 */
contract StakingManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable STAKING_TOKEN;

    uint256 public minSelfStake;
    uint256 public thawingPeriod;

    uint256 public totalAmountActive;
    uint256 public totalAmountLocked;

    mapping(address => mapping(address => bool)) fillOrderOperators;

    struct Stake {
        uint256 amountActive;
        uint256 amountLocked;
        uint256 unlockTime;
    }

    mapping(address => Stake) public stakes;

    error InvalidStakingAmount();
    error BelowMinSelfStake();
    error NotValidResolver();
    error NotAllowedToWithdraw();
    error InvalidAddress();
    error InvalidOperator();
    error InvalidMinSelfStake();
    error LockedExist();
    error InvalidThawingPeriod();
    error NoLockedAmount();

    event MinSelfStakeUpdated(uint256 minSelfStake);
    event ThawingPeriodUpdated(uint256 thawingPeriod);
    event Staked(address indexed resolver, uint256 amount);
    event Unstaked(address indexed resolver, uint256 amount);
    event StakedWithdrawn(address indexed resolver, address indexed to, uint256 amount);
    event SetOperator(address indexed resolver, address indexed operator, bool allowed);

    /**
     * @notice Creates a staking manager.
     * @param _minSelfStake Minimum active stake required for resolver eligibility.
     * @param _stakingToken ERC-20 token used for self-stake.
     * @param _thawingPeriod Delay between unstaking and withdrawing locked tokens.
     */
    constructor(
        uint256 _minSelfStake,
        address _stakingToken,
        uint256 _thawingPeriod
    ) Ownable(msg.sender) {
        if (_stakingToken == address(0)) revert InvalidAddress();
        if (_minSelfStake == 0) revert InvalidMinSelfStake();
        if (_thawingPeriod == 0) revert InvalidThawingPeriod();

        minSelfStake = _minSelfStake;
        STAKING_TOKEN = IERC20(_stakingToken);
        thawingPeriod = _thawingPeriod;
    }

    /**
     * @notice Adds active self-stake for the caller.
     * @param stakingAmount Amount of staking tokens to deposit.
     */
    function stake(uint256 stakingAmount) external nonReentrant {
        if (stakingAmount == 0) revert InvalidStakingAmount();

        Stake storage stakeInfo = stakes[msg.sender];

        if (stakeInfo.amountActive + stakingAmount < minSelfStake) {
            revert BelowMinSelfStake();
        }

        stakeInfo.amountActive += stakingAmount;

        totalAmountActive += stakingAmount;

        STAKING_TOKEN.safeTransferFrom(msg.sender, address(this), stakingAmount);

        emit Staked(msg.sender, stakingAmount);
    }

    /**
     * @notice Moves active self-stake into the locked withdrawal state.
     * @dev A resolver may become ineligible after this call, including while it has delegations.
     * Delegators are responsible for monitoring this condition.
     * @param unstakingAmount Amount of active self-stake to lock for withdrawal.
     */
    function unstake(uint256 unstakingAmount) external nonReentrant {
        if (unstakingAmount == 0) revert InvalidStakingAmount();

        Stake storage stakeInfo = stakes[msg.sender];

        if (stakeInfo.amountActive < unstakingAmount) {
            revert InvalidStakingAmount();
        }

        if (stakeInfo.amountLocked != 0) revert LockedExist();

        stakeInfo.amountActive -= unstakingAmount;
        stakeInfo.amountLocked += unstakingAmount;

        totalAmountActive -= unstakingAmount;
        totalAmountLocked += unstakingAmount;

        stakeInfo.unlockTime = block.timestamp + thawingPeriod;

        emit Unstaked(msg.sender, unstakingAmount);
    }

    /**
     * @notice Withdraws all unlocked self-stake to a non-zero recipient.
     * @param to Recipient of the withdrawn staking tokens.
     */
    function withdrawStaked(address to) external nonReentrant {
        if (to == address(0)) revert InvalidAddress();

        Stake storage stakeInfo = stakes[msg.sender];

        uint256 amount = stakeInfo.amountLocked;

        if (amount == 0) revert NoLockedAmount();

        if (block.timestamp < stakeInfo.unlockTime) {
            revert NotAllowedToWithdraw();
        }

        stakeInfo.amountLocked = 0;
        stakeInfo.unlockTime = 0;

        totalAmountLocked -= amount;

        STAKING_TOKEN.safeTransfer(to, amount);

        emit StakedWithdrawn(msg.sender, to, amount);
    }

    /**
     * @notice Returns whether a resolver meets the current minimum active self-stake.
     * @param resolver Resolver address to check.
     * @return valid True when the resolver is currently eligible.
     */
    function isValidResolver(address resolver) public view returns (bool) {
        return stakes[resolver].amountActive >= minSelfStake;
    }

    /**
     * @notice Updates the minimum self-stake required for resolver eligibility.
     * @dev This is a trusted owner governance function. The owner may set the threshold to zero.
     * @param _minSelfStake New minimum active self-stake.
     */
    function setMinSelfStake(uint256 _minSelfStake) external onlyOwner {
        minSelfStake = _minSelfStake;

        emit MinSelfStakeUpdated(minSelfStake);
    }

    /**
     * @notice Updates the delay between unstaking and withdrawing self-stake.
     * @dev This is a trusted owner governance function. The owner may set the delay to zero.
     * @param _thawingPeriod New thawing period in seconds.
     */
    function setThawingPeriod(uint256 _thawingPeriod) external onlyOwner {
        thawingPeriod = _thawingPeriod;

        emit ThawingPeriodUpdated(thawingPeriod);
    }

    /**
     * @notice Grants or revokes an operator for the caller while the caller is an eligible resolver.
     * @param operator Operator address to update.
     * @param allowed Whether the operator is authorized.
     */
    function setOperator(address operator, bool allowed) external {
        if (operator == address(0)) revert InvalidOperator();

        if (!isValidResolver(msg.sender)) revert NotValidResolver();

        fillOrderOperators[msg.sender][operator] = allowed;

        emit SetOperator(msg.sender, operator, allowed);
    }

    /**
     * @notice Returns whether an operator is authorized by an eligible resolver.
     * @param resolver Resolver that authorized the operator.
     * @param operator Operator address to check.
     * @return valid True when authorization and resolver eligibility both hold.
     */
    function isValidOperator(address resolver, address operator) public view returns (bool) {
        return fillOrderOperators[resolver][operator] && isValidResolver(resolver);
    }

    /**
     * @notice Returns a resolver's active self-stake.
     * @param resolver Resolver address to query.
     * @return amount Active self-stake amount.
     */
    function getSelfStakedAmount(address resolver) external view returns (uint256) {
        return stakes[resolver].amountActive;
    }

    /**
     * @notice Returns the sum of all active and locked self-stake.
     * @return amount Aggregate self-stake held by the contract.
     */
    function totalStake() external view returns (uint256) {
        return totalAmountActive + totalAmountLocked;
    }
}
