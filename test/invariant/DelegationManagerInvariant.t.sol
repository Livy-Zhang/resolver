// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DelegationManager} from "../../contracts/DelegationManager.sol";
import {MockERC20} from "../../contracts/mocks/MockERC20.sol";
import {MockStakingManager} from "../../contracts/mocks/MockStakingManager.sol";

contract DelegationManagerHandler is Test {
    DelegationManager public delegationManager;
    MockStakingManager public stakingManager;
    MockERC20 public stakingToken;

    address public owner;

    address[] public delegators;
    address[] public resolvers;

    uint256 public ghost_totalDelegated;
    uint256 public ghost_totalUndelegated;

    mapping(address => uint256) public ghostResolverDelegated;
    mapping(address => address) public ghostDelegationResolver;


    constructor(
        DelegationManager _delegationManager,
        MockStakingManager _stakingManager,
        MockERC20 _stakingToken,
        address _owner
    ) {
        delegationManager = _delegationManager;
        stakingManager = _stakingManager;
        stakingToken = _stakingToken;
        owner = _owner;

        vm.startPrank(owner);

        for (uint256 i; i < 5; i++) {
            address user = makeAddr(string(abi.encodePacked("delegator", i)));
            delegators.push(user);
            stakingToken.transfer(user, 10000 ether);
        }

        vm.stopPrank();

        for (uint256 i; i < 5; i++) {
            address resolver = makeAddr(string(abi.encodePacked("resolver", i)));
            resolvers.push(resolver);
            stakingManager.setResolver(resolver, true);
        }
    }


    function delegatorsLength() external view returns(uint256){
        return delegators.length;
    }

    function resolversLength() external view returns(uint256){
        return resolvers.length;
    }


    function delegate(
        uint256 delegatorSeed,
        uint256 resolverSeed,
        uint256 amountSeed
    ) external {

        address delegator =
            delegators[bound(delegatorSeed,0,delegators.length-1)];

        address resolver =
            resolvers[bound(resolverSeed,0,resolvers.length-1)];

        uint256 amount =
            bound(amountSeed,100 ether,1000 ether);


        vm.startPrank(delegator);

        stakingToken.approve(
            address(delegationManager),
            amount
        );


        try delegationManager.delegate(resolver,amount){

            ghost_totalDelegated += amount;

            ghostResolverDelegated[resolver] += amount;

            ghostDelegationResolver[delegator] = resolver;

        }catch{}

        vm.stopPrank();
    }


    function undelegate(
        uint256 delegatorSeed,
        uint256 amountSeed
    ) external {

        address delegator =
            delegators[bound(delegatorSeed,0,delegators.length-1)];


        (
            uint256 delegatedAmount,
            ,
            address resolver
        ) = delegationManager.delegations(delegator);


        if(delegatedAmount == 0)
            return;


        uint256 amount =
            bound(amountSeed,1,delegatedAmount);


        vm.warp(block.timestamp + 8 days);


        vm.prank(delegator);


        try delegationManager.undelegate(amount){

            ghost_totalUndelegated += amount;

            ghostResolverDelegated[resolver] -= amount;


            if(amount == delegatedAmount){
                delete ghostDelegationResolver[delegator];
            }

        }catch{}
    }


    function redelegate(
        uint256 delegatorSeed,
        uint256 resolverSeed
    ) external {

        address delegator =
            delegators[bound(delegatorSeed,0,delegators.length-1)];


        address newResolver =
            resolvers[bound(resolverSeed,0,resolvers.length-1)];


        (
            uint256 amount,
            ,
            address oldResolver
        ) = delegationManager.delegations(delegator);


        if(amount == 0)
            return;


        vm.warp(block.timestamp + 8 days);


        vm.prank(delegator);


        try delegationManager.redelegate(newResolver){

            ghostResolverDelegated[oldResolver] -= amount;

            ghostResolverDelegated[newResolver] += amount;

            ghostDelegationResolver[delegator] = newResolver;

        }catch{}
    }
}


contract DelegationManagerInvariantTest is Test {

    DelegationManager public delegationManager;
    MockStakingManager public stakingManager;

    MockERC20 public stakingToken;
    MockERC20 public rewardToken;

    DelegationManagerHandler public handler;

    address public owner;


    function setUp() public {

        owner = makeAddr("owner");

        stakingToken =
            new MockERC20(owner,100000000 ether);

        rewardToken =
            new MockERC20(owner,100000000 ether);


        stakingManager =
            new MockStakingManager();


        delegationManager =
            new DelegationManager(
                address(rewardToken),
                address(stakingToken),
                address(stakingManager),
                30,
                7 days
            );


        handler =
            new DelegationManagerHandler(
                delegationManager,
                stakingManager,
                stakingToken,
                owner
            );


        targetContract(address(handler));
    }


    // Contract must hold all delegated staking tokens
    function invariant_contractBalanceCoversDelegation() public {

        assertGe(
            stakingToken.balanceOf(address(delegationManager)),
            delegationManager.totalDelegated()
        );
    }


    // Sum user delegation equals global accounting
    function invariant_totalDelegatedAccounting() public {

        uint256 total;

        for(uint256 i;i<handler.delegatorsLength();i++){

            (
                uint256 amount,
                ,

            ) =
                delegationManager.delegations(
                    handler.delegators(i)
                );

            total += amount;
        }


        assertEq(
            total,
            delegationManager.totalDelegated()
        );
    }


    // Resolver accounting equals ghost accounting
    function invariant_resolverAccounting() public {

        uint256 total;


        for(uint256 i;i<handler.resolversLength();i++){

            address resolver =
                handler.resolvers(i);


            uint256 amount =
                delegationManager.delegationTo(resolver);


            assertEq(
                amount,
                handler.ghostResolverDelegated(resolver)
            );


            total += amount;
        }


        assertEq(
            total,
            delegationManager.totalDelegated()
        );
    }


    // Every active delegation must have resolver
    function invariant_validDelegation() public {

        for(uint256 i;i<handler.delegatorsLength();i++){

            (
                uint256 amount,
                ,
                address resolver
            ) =
                delegationManager.delegations(
                    handler.delegators(i)
                );


            if(amount > 0){
                assertTrue(resolver != address(0));
            }
        }
    }
}
