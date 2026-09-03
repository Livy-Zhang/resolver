// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IRewardsDistributor} from "../interface/IRewardsDistributor.sol";

/**
 * @title MockCloneFactory
 * @notice Test-only helper for creating and initializing arbitrary distributor clones.
 */
contract MockCloneFactory {
    event CloneCreated(address indexed clone);

    function cloneAndInitialize(
        address implementation,
        address resolver,
        address rewardsUpdater,
        address rewardToken,
        uint256 rewardRate
    ) external returns (address clone) {
        clone = Clones.clone(implementation);
        IRewardsDistributor(clone).initialize(resolver, rewardsUpdater, rewardToken, rewardRate);
        emit CloneCreated(clone);
    }
}
