// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenVesting
 * @notice Holds token allocations and releases them linearly after an optional cliff.
 * @dev The owner funds each schedule when it is created and may revoke a schedule's unvested
 * portion. Vested tokens remain claimable by the beneficiary after revocation.
 */
contract TokenVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

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
    error InvalidRefundAddress();
    error InvalidAllocationAmount();
    error InvalidVestingDuration();
    error InvalidCliffDuration();
    error ScheduleAlreadyExists();
    error NotClaimable();
    error ScheduleDoesNotExist();
    error ScheduleAlreadyRevoked();

    /**
     * @notice Creates a vesting manager for a single ERC-20 token.
     * @param _vestingToken ERC-20 token used for all vesting schedules.
     */
    constructor(address _vestingToken) Ownable(msg.sender) {
        if (_vestingToken == address(0)) revert InvalidToken();
        VESTING_TOKEN = IERC20(_vestingToken);
    }

    /**
     * @notice Creates and funds an irrevocable-until-revoked vesting schedule for a beneficiary.
     * @param beneficiary Recipient entitled to claim vested tokens.
     * @param totalAllocation Total token allocation for the schedule.
     * @param cliffDuration Delay in seconds before linear vesting begins.
     * @param vestingDuration Total duration in seconds from creation to full vesting.
     */
    function scheduleVesting(
        address beneficiary,
        uint256 totalAllocation,
        uint256 cliffDuration,
        uint256 vestingDuration
    ) external onlyOwner nonReentrant {
        if (beneficiary == address(0)) revert InvalidBeneficiaryAddress();

        if (totalAllocation == 0) revert InvalidAllocationAmount();
        if (vestingDuration == 0) revert InvalidVestingDuration();
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

    /**
     * @notice Revokes a schedule and transfers its unvested tokens to a refund address.
     * @dev The vested allocation is fixed at the revocation timestamp and remains claimable.
     * @param beneficiary Beneficiary whose schedule is revoked.
     * @param refundAddress Recipient of the unvested token amount.
     */
    function revoke(address beneficiary, address refundAddress) external onlyOwner {
        if (beneficiary == address(0)) revert InvalidBeneficiaryAddress();
        if (refundAddress == address(0)) revert InvalidRefundAddress();
        VestingSchedule storage schedule = vestingSchedules[beneficiary];

        if (schedule.startTime == 0) revert ScheduleDoesNotExist();
        if (schedule.revoked) revert ScheduleAlreadyRevoked();

        uint256 vested = getVestedAmount(beneficiary);

        uint256 unvested = schedule.totalAllocation - vested;
        schedule.revoked = true;
        schedule.totalAllocation = vested;
        totalVestingAllocation -= unvested;
        if (unvested > 0) VESTING_TOKEN.safeTransfer(refundAddress, unvested);

        emit ScheduleRevoked(beneficiary, refundAddress, unvested);
    }

    /**
     * @notice Returns the total amount vested for a beneficiary at the current timestamp.
     * @param beneficiary Beneficiary whose schedule is queried.
     * @return vested Total vested token amount.
     */
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

    /**
     * @notice Returns the amount currently claimable by a beneficiary.
     * @param beneficiary Beneficiary whose claimable amount is queried.
     * @return claimable Vested token amount not yet claimed.
     */
    function getClaimableAmount(address beneficiary) public view returns (uint256) {
        VestingSchedule memory schedule = vestingSchedules[beneficiary];
        if (schedule.totalAllocation == 0) return 0;

        uint256 vested = getVestedAmount(beneficiary);
        uint256 claimable = vested - schedule.amountClaimed;
        return claimable;
    }

    /** @notice Transfers all currently vested and unclaimed tokens to the caller. */
    function claim() public nonReentrant {
        uint256 claimable = getClaimableAmount(msg.sender);
        if (claimable == 0) revert NotClaimable();

        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        schedule.amountClaimed += claimable;

        VESTING_TOKEN.safeTransfer(msg.sender, claimable);
        emit TokensClaimed(msg.sender, claimable);
    }

    /**
     * @notice Returns the complete vesting schedule for a beneficiary.
     * @param beneficiary Beneficiary whose schedule is queried.
     * @return schedule Vesting schedule data.
     */
    function vestingSchedulesOf(address beneficiary) public view returns (VestingSchedule memory) {
        return vestingSchedules[beneficiary];
    }
}
