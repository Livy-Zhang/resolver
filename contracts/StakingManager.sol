// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract StakingManager is Ownable, ReentrancyGuard, Pausable {
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

    function stake(uint256 stakingAmount) external whenNotPaused nonReentrant {
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

    function unstake(uint256 unstakingAmount) external whenNotPaused nonReentrant {
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

    function withdrawStaked(address to) external whenNotPaused nonReentrant {
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

    function isValidResolver(address resolver) public view returns (bool) {
        return stakes[resolver].amountActive >= minSelfStake;
    }

    function setMinSelfStake(uint256 _minSelfStake) external onlyOwner {
        minSelfStake = _minSelfStake;

        emit MinSelfStakeUpdated(minSelfStake);
    }

    function setThawingPeriod(uint256 _thawingPeriod) external onlyOwner {
        thawingPeriod = _thawingPeriod;

        emit ThawingPeriodUpdated(thawingPeriod);
    }

    function setOperator(address operator, bool allowed) external {
        if (operator == address(0)) revert InvalidOperator();

        if (!isValidResolver(msg.sender)) revert NotValidResolver();

        fillOrderOperators[msg.sender][operator] = allowed;

        emit SetOperator(msg.sender, operator, allowed);
    }

    function isValidOperator(address resolver, address operator) public view returns (bool) {
        return fillOrderOperators[resolver][operator] && isValidResolver(resolver);
    }

    function getSelfStakedAmount(address resolver) external view returns (uint256) {
        return stakes[resolver].amountActive;
    }

    function totalStake() external view returns (uint256) {
        return totalAmountActive + totalAmountLocked;
    }
}
