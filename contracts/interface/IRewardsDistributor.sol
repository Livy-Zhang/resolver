// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IRewardsDistributor
 * @notice Initialization interface implemented by resolver reward distributor clones.
 */
interface IRewardsDistributor {
    function initialize(
        address resolver,
        address rootPublisher,
        address rewardToken,
        uint256 rewardRate
    ) external;
}
