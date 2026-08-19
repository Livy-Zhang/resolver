// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Modified StakingManager invariant test.
// Fixes:
// 1. Handler token distribution uses owner as sender.
// 2. Adds ghost_totalUnstaked.
// 3. Tracks stake -> unstake -> withdraw lifecycle.

import {Test} from "forge-std/Test.sol";
import {StakingManager} from "../../contracts/StakingManager.sol";
import {MockERC20} from "../../contracts/mocks/MockERC20.sol";

contract StakingManagerHandler is Test {
    StakingManager public stakingManager;
    MockERC20 public token;

    address public owner;
    address[] public resolvers;

    uint256 public ghost_totalStaked;
    uint256 public ghost_totalUnstaked;
    uint256 public ghost_totalWithdrawn;

    constructor(StakingManager _stakingManager, MockERC20 _token, address _owner) {
        stakingManager = _stakingManager;
        token = _token;
        owner = _owner;

        vm.startPrank(owner);

        for (uint256 i; i < 10; i++) {
            address resolver = makeAddr(string(abi.encodePacked("resolver", i)));
            resolvers.push(resolver);
            token.transfer(resolver, 10000 ether);
        }

        vm.stopPrank();
    }

    function resolversLength() external view returns (uint256) {
        return resolvers.length;
    }

    function stake(uint256 resolverSeed, uint256 amountSeed) external {
        address resolver = resolvers[bound(resolverSeed, 0, resolvers.length - 1)];
        uint256 amount = bound(amountSeed, 1000 ether, 2000 ether);

        vm.startPrank(resolver);
        token.approve(address(stakingManager), amount);

        try stakingManager.stake(amount) {
            ghost_totalStaked += amount;
        } catch {}

        vm.stopPrank();
    }

    function unstake(uint256 resolverSeed, uint256 amountSeed) external {
        address resolver = resolvers[bound(resolverSeed, 0, resolvers.length - 1)];

        (uint256 active, , ) = stakingManager.stakes(resolver);
        if (active == 0) return;

        uint256 amount = bound(amountSeed, 1 ether, active);

        vm.prank(resolver);

        try stakingManager.unstake(amount) {
            ghost_totalUnstaked += amount;
        } catch {}
    }

    function withdraw(uint256 resolverSeed) external {
        address resolver = resolvers[bound(resolverSeed, 0, resolvers.length - 1)];

        (, uint256 locked, uint256 unlockTime) = stakingManager.stakes(resolver);
        if (locked == 0) return;

        vm.warp(unlockTime);

        vm.prank(resolver);

        uint256 beforeBalance = token.balanceOf(resolver);

        try stakingManager.withdrawStaked(resolver) {
            ghost_totalWithdrawn += token.balanceOf(resolver) - beforeBalance;
        } catch {}
    }
}

contract StakingManagerInvariantTest is Test {
    StakingManager public stakingManager;
    MockERC20 public token;
    StakingManagerHandler public handler;

    address public owner;

    function setUp() public {
        owner = makeAddr("owner");

        token = new MockERC20(owner, 100000000000000 ether);

        stakingManager = new StakingManager(1000 ether, address(token), 7 days);

        handler = new StakingManagerHandler(stakingManager, token, owner);

        targetContract(address(handler));
    }

    function invariant_contractBalanceCoversTotalStake() public {
        assertGe(token.balanceOf(address(stakingManager)), stakingManager.totalStake());
    }

    function invariant_totalStakeAccounting() public {
        assertEq(
            stakingManager.totalStake(),
            stakingManager.totalAmountActive() + stakingManager.totalAmountLocked()
        );
    }

    function invariant_resolverAccountingEqualsGlobal() public {
        uint256 active;
        uint256 locked;

        for (uint256 i; i < handler.resolversLength(); i++) {
            (uint256 a, uint256 l, ) = stakingManager.stakes(handler.resolvers(i));

            active += a;
            locked += l;
        }

        assertEq(active, stakingManager.totalAmountActive());
        assertEq(locked, stakingManager.totalAmountLocked());
    }

    function invariant_lockedRequiresUnlockTime() public {
        for (uint256 i; i < handler.resolversLength(); i++) {
            (, uint256 locked, uint256 unlockTime) = stakingManager.stakes(handler.resolvers(i));

            if (locked > 0) {
                assertGt(unlockTime, 0);
            }
        }
    }

    function invariant_validResolverRule() public {
        for (uint256 i; i < handler.resolversLength(); i++) {
            (uint256 active, , ) = stakingManager.stakes(handler.resolvers(i));

            if (active >= stakingManager.minSelfStake()) {
                assertTrue(stakingManager.isValidResolver(handler.resolvers(i)));
            }
        }
    }

    function invariant_ghostAccounting() public {
        assertEq(
            stakingManager.totalStake(),
            handler.ghost_totalStaked() - handler.ghost_totalWithdrawn()
        );
    }
}
