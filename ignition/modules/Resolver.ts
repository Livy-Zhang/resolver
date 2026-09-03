import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const INITIAL_TOKEN_SUPPLY = 1_000_000n * 10n ** 18n;
const MIN_SELF_STAKE = 1_000n * 10n ** 18n;
const REWARD_DURATION_DAYS = 30;
const FREEZING_PERIOD = 7 * 24 * 60 * 60;

export default buildModule("ResolverModule", (m) => {
    const deployer = m.getAccount(0);
    const rootPublisher = deployer;

    // Development tokens. Staking principal and rewards must use separate tokens.
    const stakingToken = m.contract("MockERC20", [deployer, INITIAL_TOKEN_SUPPLY], {
        id: "StakingToken",
    });
    const rewardToken = m.contract("MockERC20", [deployer, INITIAL_TOKEN_SUPPLY], {
        id: "RewardToken",
    });

    const tokenVesting = m.contract("TokenVesting", [rewardToken]);

    const stakingManager = m.contract("StakingManager", [
        MIN_SELF_STAKE,
        stakingToken,
        FREEZING_PERIOD,
    ]);

    const delegationManager = m.contract("DelegationManager", [
        rewardToken,
        stakingToken,
        stakingManager,
        REWARD_DURATION_DAYS,
        FREEZING_PERIOD,
    ]);

    // The implementation is intentionally not initialized; each clone is initialized by the factory.
    const rewardsDistributorImplementation = m.contract("RewardsDistributor");

    const rewardsDistributorFactory = m.contract("RewardsDistributorFactory", [
        rewardsDistributorImplementation,
        stakingManager,
        rootPublisher,
        rewardToken,
    ]);

    return {
        stakingToken,
        rewardToken,
        tokenVesting,
        stakingManager,
        delegationManager,
        rewardsDistributorImplementation,
        rewardsDistributorFactory,
    };
});
