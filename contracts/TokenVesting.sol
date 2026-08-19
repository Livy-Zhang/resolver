// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TokenVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*
TGE (startTime)
    |
    |←——— cliffDuration ———→|←————— vestingDuration —————→|
    |                        |                              |
    |                        |                              |
    0                      cliffEnd                     100%解锁
    |                        |                              |
    |    ❌ 不可解锁          |     ✅ 线性解锁             |
    |                        |                              |
    |                        |                              |
    └────────────────────────┴──────────────────────────────┘
    
                    总锁仓周期 = vestingDuration
                    (从 startTime 到 100% 解锁)
*/
    struct VestingSchedule {
        uint256 totalAllocation;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 vestingDuration;
        uint256 amountClaimed;
        bool revoked;
    }

    IERC20 public immutable VESTING_TOKEN;
    mapping(address beneficiary => VestingSchedule) public vestingSchedules;
    uint256 public totalVestingAllocation;

    event VestingScheduled(
        address indexed beneficiary,
        uint256 totalAllocation,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration
    );
    event ScheduleRevoked(
        address indexed beneficiary,
        address refundAddress,
        uint256 unvestedAmount
    );
    event TokensClaimed(address indexed beneficiary, uint256 amount);

    error InvalidToken();
    error InvalidBeneficiaryAddress();
    error InvalidAllocationAmount();
    error InvalidVestingDuration();
    error InvalidCliffDuration();
    error ScheduleAlreadyExists();
    error NotClaimable();
    error ScheduleDoesNotExist();
    error ScheduleAlreadyRevoked();

    constructor(address _vestingToken) Ownable(msg.sender) {
        if (_vestingToken == address(0)) revert InvalidToken();
        VESTING_TOKEN = IERC20(_vestingToken);
    }

    function scheduleVesting(
        address beneficiary,
        uint256 totalAllocation,
        uint256 cliffDuration,
        uint256 vestingDuration
    ) external onlyOwner nonReentrant {
        if (beneficiary == address(0)) revert InvalidBeneficiaryAddress();

        // validate allocation amount is not zero
        if (totalAllocation == 0) revert InvalidAllocationAmount();

        // validate vesting duration is not zero
        if (vestingDuration == 0) revert InvalidVestingDuration();

        // validate cliff duration is not greater than or equal to vesting duration
        if (cliffDuration >= vestingDuration) {
            revert InvalidCliffDuration();
        }

        if (vestingSchedules[beneficiary].startTime != 0) {
            revert ScheduleAlreadyExists();
        }

        vestingSchedules[beneficiary] = VestingSchedule({
            totalAllocation: totalAllocation,
            startTime: block.timestamp,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            amountClaimed: 0,
            revoked: false
        });

        totalVestingAllocation += totalAllocation;

        VESTING_TOKEN.safeTransferFrom(msg.sender, address(this), totalAllocation);

        emit VestingScheduled(
            beneficiary,
            totalAllocation,
            block.timestamp,
            cliffDuration,
            vestingDuration
        );
    }

    function revoke(address beneficiary, address refundAddress) external onlyOwner {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];

        if (schedule.startTime == 0) revert ScheduleDoesNotExist();
        if (schedule.revoked) revert ScheduleAlreadyRevoked();

        uint256 vested = getVestedAmount(beneficiary);

        uint256 unvested = schedule.totalAllocation - vested;
        schedule.revoked = true;
        schedule.totalAllocation = vested;
        if (unvested > 0) VESTING_TOKEN.safeTransfer(refundAddress, unvested);

        emit ScheduleRevoked(beneficiary, refundAddress, unvested);
    }

    function getVestedAmount(address beneficiary) public view returns (uint256) {
        VestingSchedule memory schedule = vestingSchedules[beneficiary];
        if (schedule.totalAllocation == 0) return 0;

        if (schedule.revoked == true) return schedule.totalAllocation;

        uint256 cliffEnd = schedule.startTime + schedule.cliffDuration;
        if (block.timestamp <= cliffEnd) {
            return 0;
        }

        uint256 vestingPeriodEnd = schedule.startTime + schedule.vestingDuration;
        if (block.timestamp >= vestingPeriodEnd) return schedule.totalAllocation;

        uint256 vestedAmount =
            (schedule.totalAllocation * (block.timestamp - cliffEnd)) /
                (schedule.vestingDuration - schedule.cliffDuration);

        return vestedAmount;
    }

    function getClaimableAmount(address beneficiary) public view returns (uint256) {
        VestingSchedule memory schedule = vestingSchedules[beneficiary];
        if (schedule.totalAllocation == 0) return 0;

        uint256 vested = getVestedAmount(beneficiary);
        uint256 claimable = vested - schedule.amountClaimed;
        return claimable;
    }

    function claim() public nonReentrant {
        uint256 claimable = getClaimableAmount(msg.sender);
        if (claimable == 0) revert NotClaimable();

        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        schedule.amountClaimed += claimable;

        VESTING_TOKEN.safeTransfer(msg.sender, claimable);
        emit TokensClaimed(msg.sender, claimable);
    }

    function vestingSchedulesOf(address beneficiary) public view returns (VestingSchedule memory) {
        return vestingSchedules[beneficiary];
    }
}
