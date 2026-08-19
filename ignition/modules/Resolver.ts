import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";


export default buildModule(
    "ResolverModule",
    (m) => {

                const deployer = m.getAccount(0);

        // 1. 部署 MockERC20
        const token = m.contract(
            "MockERC20",
            [
                deployer,
                1000000n * 10n ** 18n
            ]
        );


        // 2. TokenVesting 依赖 token
        const tokenVesting = m.contract(
            "TokenVesting",
            [
                token,
            ]
        );


        // 3. StakingManager 依赖 token
        const stakingManager = m.contract(
            "StakingManager",
            [
                1000n * 10n ** 18n,
                token,
                7 * 24 * 60 * 60
            ]
        );


        // 4. DelegationManager 依赖 token + stakingManager
        const delegationManager = m.contract(
            "DelegationManager",
            [
                token,
                token,
                stakingManager,
                30,
                7 * 24 * 60 * 60
            ]
        );


        return {
            token,
            tokenVesting,
            stakingManager,
            delegationManager
        };
    }
);