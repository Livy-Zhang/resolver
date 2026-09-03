// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockRewardsDistributor
 * @notice Test-only clone implementation.
 */
contract MockRewardsDistributor {
    address public resolver;
    address public rootPublisher;
    address public rewardToken;
    uint256 public rewardRate;
    bool public initialized;

    error AlreadyInitialized();

    function initialize(
        address resolver_,
        address rootPublisher_,
        address rewardToken_,
        uint256 rewardRate_
    ) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        resolver = resolver_;
        rootPublisher = rootPublisher_;
        rewardToken = rewardToken_;
        rewardRate = rewardRate_;
    }
}
