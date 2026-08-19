// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TokenVesting} from "../../contracts/TokenVesting.sol";
import {MockERC20} from "../../contracts/mocks/MockERC20.sol";

contract TokenVestingHandler is Test {
    TokenVesting public vesting;
    MockERC20 public token;

    address public owner;

    address[] public users;

    uint256 public ghost_totalScheduled;
    uint256 public ghost_totalClaimed;
    uint256 public ghost_totalRefunded;

    mapping(address => bool) public ghost_isRevoked;

    mapping(address => uint256) public ghost_revokedAllocation;

    constructor(TokenVesting _vesting, MockERC20 _token, address _owner) {
        vesting = _vesting;
        token = _token;
        owner = _owner;

        for (uint256 i = 0; i < 10; i++) {
            users.push(makeAddr(string(abi.encodePacked("user", i))));
        }
    }

    function usersLength() external view returns (uint256) {
        return users.length;
    }

    function schedule(
        uint256 userSeed,
        uint256 amountSeed,
        uint256 cliffSeed,
        uint256 durationSeed
    ) external {
        address user = users[bound(userSeed, 0, users.length - 1)];

        uint256 amount = bound(amountSeed, 1 ether, 100000 ether);

        uint256 duration = bound(durationSeed, 7 days, 365 days);

        uint256 cliff = bound(cliffSeed, 0, duration - 1);

        vm.startPrank(owner);

        token.approve(address(vesting), amount);

        try vesting.scheduleVesting(user, amount, cliff, duration) {
            ghost_totalScheduled += amount;
        } catch {}

        vm.stopPrank();
    }

    function warp(uint256 timeSeed) external {
        uint256 time = bound(timeSeed, 1 days, 365 days);

        vm.warp(block.timestamp + time);
    }

    function claim(uint256 userSeed) external {
        address user = users[bound(userSeed, 0, users.length - 1)];

        uint256 beforeBalance = token.balanceOf(user);

        vm.prank(user);

        try vesting.claim() {
            uint256 afterBalance = token.balanceOf(user);

            ghost_totalClaimed += afterBalance - beforeBalance;
        } catch {}
    }

    function revoke(uint256 userSeed) external {
        address user = users[bound(userSeed, 0, users.length - 1)];

        uint256 beforeBalance = token.balanceOf(owner);

        vm.prank(owner);

        try vesting.revoke(user, owner) {
            uint256 afterBalance = token.balanceOf(owner);

            ghost_totalRefunded += afterBalance - beforeBalance;

            TokenVesting.VestingSchedule memory schedules = vesting.vestingSchedulesOf(user);

            ghost_isRevoked[user] = true;

            ghost_revokedAllocation[user] = schedules.totalAllocation;
        } catch {}
    }
}

contract TokenVestingInvariantTest is Test {
    TokenVesting public vesting;

    MockERC20 public token;

    TokenVestingHandler public handler;

    address public owner;

    function setUp() public {
        owner = makeAddr("owner");

        token = new MockERC20(owner, 1000000 ether);

        vesting = new TokenVesting(address(token));

        handler = new TokenVestingHandler(vesting, token, owner);

        targetContract(address(handler));
        vm.warp(1);
    }

    function invariant_fundsAreConserved() public {
        uint256 accounted =
            handler.ghost_totalClaimed() +
                handler.ghost_totalRefunded() +
                token.balanceOf(address(vesting));

        assertEq(accounted, handler.ghost_totalScheduled());
    }

    function invariant_claimedNeverExceedsAllocation() public {
        uint256 length = handler.usersLength();

        for (uint256 i; i < length; i++) {
            address user = handler.users(i);

            TokenVesting.VestingSchedule memory schedule = vesting.vestingSchedulesOf(user);

            assertLe(schedule.amountClaimed, schedule.totalAllocation);
        }
    }

    function invariant_claimedNeverExceedsVested() public {
        uint256 length = handler.usersLength();

        for (uint256 i; i < length; i++) {
            address user = handler.users(i);

            TokenVesting.VestingSchedule memory schedule = vesting.vestingSchedulesOf(user);

            if (schedule.totalAllocation == 0) continue;

            uint256 vested = vesting.getVestedAmount(user);

            assertLe(schedule.amountClaimed, vested);
        }
    }

    function invariant_cliffCannotUnlock() public {
        uint256 length = handler.usersLength();

        for (uint256 i; i < length; i++) {
            address user = handler.users(i);

            TokenVesting.VestingSchedule memory schedule = vesting.vestingSchedulesOf(user);

            if (schedule.totalAllocation == 0) continue;

            if (block.timestamp <= schedule.startTime + schedule.cliffDuration) {
                assertEq(vesting.getVestedAmount(user), 0);
            }
        }
    }

    function invariant_afterEndFullyVested() public {
        uint256 length = handler.usersLength();

        for (uint256 i; i < length; i++) {
            address user = handler.users(i);

            TokenVesting.VestingSchedule memory schedule = vesting.vestingSchedulesOf(user);

            if (schedule.totalAllocation == 0) continue;

            if (block.timestamp >= schedule.startTime + schedule.vestingDuration) {
                assertEq(vesting.getVestedAmount(user), schedule.totalAllocation);
            }
        }
    }

    function invariant_revokedAllocationFrozen() public {
        uint256 length = handler.usersLength();

        for (uint256 i; i < length; i++) {
            address user = handler.users(i);

            if (!handler.ghost_isRevoked(user)) continue;

            TokenVesting.VestingSchedule memory schedule = vesting.vestingSchedulesOf(user);

            assertTrue(schedule.revoked);

            assertEq(schedule.totalAllocation, handler.ghost_revokedAllocation(user));

            assertEq(vesting.getVestedAmount(user), schedule.totalAllocation);
        }
    }

    function invariant_revokedCannotIncreaseClaimable() public {
        uint256 length = handler.usersLength();

        for (uint256 i; i < length; i++) {
            address user = handler.users(i);

            if (!handler.ghost_isRevoked(user)) continue;

            TokenVesting.VestingSchedule memory schedule = vesting.vestingSchedulesOf(user);

            uint256 claimable = vesting.getClaimableAmount(user);

            assertLe(claimable, schedule.totalAllocation - schedule.amountClaimed);
        }
    }
}
