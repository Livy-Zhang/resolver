// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IStakingManager} from "./interface/IStakingManager.sol";
import {IRewardsDistributor} from "./interface/IRewardsDistributor.sol";

/**
 * @title RewardsDistributorFactory
 * @notice Deploys one reward-distributor clone for each eligible resolver.
 * @dev The distributor implementation must expose {IRewardsDistributor-initialize}. A resolver
 * may create only one distributor, enforced by {distributorOf}.
 */
contract RewardsDistributorFactory is Ownable {
    address public immutable DISTRIBUTOR_IMPLEMENTATION;
    IStakingManager public immutable STAKING_MANAGER;
    address public immutable REWARD_TOKEN;
    address public rootPublisher;

    mapping(address resolver => address distributor) public distributorOf;

    error InvalidAddress();
    error InvalidImplementation();
    error NotValidResolver();
    error DistributorAlreadyExists();
    error InvalidRewardRate();

    event DistributorCreated(
        address indexed resolver,
        address indexed distributor,
        address rootPublisher,
        address rewardToken,
        uint256 rewardRate
    );
    event RootPublisherUpdated(
        address indexed previousRootPublisher,
        address indexed rootPublisher
    );

    /**
     * @notice Creates a factory for resolver-specific reward distributors.
     * @param _distributorImplementation Clone implementation used for all distributors.
     * @param _stakingManager Contract used to validate resolver eligibility at creation time.
     * @param _rootPublisher Protocol account authorized by each clone to publish roots.
     * @param _rewardToken ERC-20 token configured for each clone's rewards.
     */
    constructor(
        address _distributorImplementation,
        address _stakingManager,
        address _rootPublisher,
        address _rewardToken
    ) Ownable(msg.sender) {
        if (
            _stakingManager == address(0) ||
            _rootPublisher == address(0) ||
            _rewardToken == address(0)
        ) {
            revert InvalidAddress();
        }
        if (_distributorImplementation.code.length == 0) revert InvalidImplementation();

        DISTRIBUTOR_IMPLEMENTATION = _distributorImplementation;
        STAKING_MANAGER = IStakingManager(_stakingManager);
        REWARD_TOKEN = _rewardToken;
        rootPublisher = _rootPublisher;
    }

    /**
     * @notice Creates the caller's resolver-specific reward distributor with APR.
     * @param rewardRate scaled by 1e18 where 1e18 is 100% APR.
     * @return distributor Address of the newly deployed clone.
     */
    function createDistributor(uint256 rewardRate) external returns (address distributor) {
        if (!STAKING_MANAGER.isValidResolver(msg.sender)) revert NotValidResolver();
        if (distributorOf[msg.sender] != address(0)) revert DistributorAlreadyExists();
        if (rewardRate == 0) revert InvalidRewardRate();

        distributor = Clones.clone(DISTRIBUTOR_IMPLEMENTATION);
        IRewardsDistributor(distributor).initialize(
            msg.sender,
            rootPublisher,
            REWARD_TOKEN,
            rewardRate
        );
        distributorOf[msg.sender] = distributor;
        emit DistributorCreated(msg.sender, distributor, rootPublisher, REWARD_TOKEN, rewardRate);
    }

    /**
     * @notice Updates the protocol account used for distributors created in the future.
     * @dev Existing distributors retain the publisher supplied during their initialization.
     * @param newRootPublisher New protocol root publisher.
     */
    function setRootPublisher(address newRootPublisher) external onlyOwner {
        if (newRootPublisher == address(0)) revert InvalidAddress();

        address previousRootPublisher = rootPublisher;
        rootPublisher = newRootPublisher;
        emit RootPublisherUpdated(previousRootPublisher, newRootPublisher);
    }
}
