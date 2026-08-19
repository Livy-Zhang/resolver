import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

describe("DelegationManager", function () {
    let delegationManager: any;
    let mockRewardToken: any;
    let mockStakingToken: any;
    let stakingManagerMock: any;
    let owner: any;
    let nonOwner: any;
    let delegatorA: any;
    let delegatorB: any;
    let resolverA: any;
    let resolverB: any;
    let resolverC: any;

    let REWARD_AMOUNT: bigint;
    let DURATION_IN_DAYS: bigint;
    let FREEZING_PERIOD: number;
    let REWARDS_DURATION: bigint;

    beforeEach(async function () {
        REWARD_AMOUNT = ethers.parseEther("10000");
        DURATION_IN_DAYS = 30n;
        FREEZING_PERIOD = 10;
        REWARDS_DURATION = DURATION_IN_DAYS * 24n * 60n * 60n;

        [owner, nonOwner, delegatorA, delegatorB, resolverA, resolverB, resolverC] =
            await ethers.getSigners();

        mockRewardToken = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        await mockRewardToken.waitForDeployment();

        mockStakingToken = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        await mockStakingToken.waitForDeployment();

        const StakingManagerMockFactory = await ethers.getContractFactory("MockStakingManager");
        stakingManagerMock = await StakingManagerMockFactory.deploy();
        await stakingManagerMock.waitForDeployment();

        await stakingManagerMock.setResolver(resolverA.address, true);

        await stakingManagerMock.setResolver(resolverB.address, true);

        delegationManager = await ethers.deployContract("DelegationManager", [
            await mockRewardToken.getAddress(),
            await mockStakingToken.getAddress(),
            await stakingManagerMock.getAddress(),
            DURATION_IN_DAYS,
            FREEZING_PERIOD,
        ]);
        await delegationManager.waitForDeployment();

        await mockStakingToken.transfer(delegatorA.address, ethers.parseEther("10000"));
        await mockStakingToken.transfer(delegatorB.address, ethers.parseEther("10000"));

        await mockStakingToken
            .connect(delegatorA)
            .approve(await delegationManager.getAddress(), ethers.parseEther("10000"));
        await mockStakingToken
            .connect(delegatorB)
            .approve(await delegationManager.getAddress(), ethers.parseEther("10000"));
        await mockStakingToken.approve(
            await delegationManager.getAddress(),
            ethers.parseEther("1000000"),
        );

        await mockRewardToken.transfer(await delegationManager.getAddress(), REWARD_AMOUNT);
        await delegationManager.notifyRewardAmount(REWARD_AMOUNT);
    });

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            expect(await delegationManager.REWARD_TOKEN()).to.equal(
                await mockRewardToken.getAddress(),
            );
            expect(await delegationManager.STAKING_TOKEN()).to.equal(
                await mockStakingToken.getAddress(),
            );
            expect(await delegationManager.STAKING_MANAGER()).to.equal(
                await stakingManagerMock.getAddress(),
            );
            expect(await delegationManager.rewardsDuration()).to.equal(REWARDS_DURATION);
            expect(await delegationManager.freezingPeriod()).to.equal(FREEZING_PERIOD);
        });

        it("Should set the correct owner", async function () {
            expect(await delegationManager.owner()).to.equal(owner.address);
        });

        it("Should revert if rewards token is zero address", async function () {
            const factory = await ethers.getContractFactory("DelegationManager");
            await expect(
                factory.deploy(
                    ethers.ZeroAddress,
                    await mockStakingToken.getAddress(),
                    await stakingManagerMock.getAddress(),
                    DURATION_IN_DAYS,
                    FREEZING_PERIOD,
                ),
            ).to.be.revertedWithCustomError(factory, "InvalidAddress");
        });

        it("Should revert if staking token is zero address", async function () {
            const factory = await ethers.getContractFactory("DelegationManager");
            await expect(
                factory.deploy(
                    await mockRewardToken.getAddress(),
                    ethers.ZeroAddress,
                    await stakingManagerMock.getAddress(),
                    DURATION_IN_DAYS,
                    FREEZING_PERIOD,
                ),
            ).to.be.revertedWithCustomError(factory, "InvalidAddress");
        });

        it("Should revert if staking manager is zero address", async function () {
            const factory = await ethers.getContractFactory("DelegationManager");
            await expect(
                factory.deploy(
                    await mockRewardToken.getAddress(),
                    await mockStakingToken.getAddress(),
                    ethers.ZeroAddress,
                    DURATION_IN_DAYS,
                    FREEZING_PERIOD,
                ),
            ).to.be.revertedWithCustomError(factory, "InvalidAddress");
        });

        it("Should revert if duration is zero", async function () {
            const factory = await ethers.getContractFactory("DelegationManager");
            await expect(
                factory.deploy(
                    await mockRewardToken.getAddress(),
                    await mockStakingToken.getAddress(),
                    await stakingManagerMock.getAddress(),
                    0,
                    FREEZING_PERIOD,
                ),
            ).to.be.revertedWithCustomError(factory, "InvalidDuration");
        });

        it("Should revert if freezing period is zero", async function () {
            const factory = await ethers.getContractFactory("DelegationManager");
            await expect(
                factory.deploy(
                    await mockRewardToken.getAddress(),
                    await mockStakingToken.getAddress(),
                    await stakingManagerMock.getAddress(),
                    DURATION_IN_DAYS,
                    0,
                ),
            ).to.be.revertedWithCustomError(factory, "InvalidFreezingPeriod");
        });
    });

    describe("delegate", function () {
        it("Should emit Delegated event on successful delegation", async function () {
            const amount = ethers.parseEther("2000");
            await expect(delegationManager.connect(delegatorA).delegate(resolverA.address, amount))
                .to.emit(delegationManager, "Delegated")
                .withArgs(delegatorA.address, resolverA.address, amount);
        });

        it("Should transfer tokens and update state on successful delegation", async function () {
            const amount = ethers.parseEther("2000");
            const contractBalanceBefore = await mockStakingToken.balanceOf(
                await delegationManager.getAddress(),
            );
            const delegatorBalanceBefore = await mockStakingToken.balanceOf(delegatorA.address);

            await delegationManager.connect(delegatorA).delegate(resolverA.address, amount);

            const delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(amount);
            expect(delegation.resolver).to.equal(resolverA.address);
            expect(delegation.updatedAt).to.be.greaterThan(0);

            expect(await delegationManager.getTotalDelegated()).to.equal(amount);
            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(amount);

            const contractBalanceAfter = await mockStakingToken.balanceOf(
                await delegationManager.getAddress(),
            );
            const delegatorBalanceAfter = await mockStakingToken.balanceOf(delegatorA.address);
            const block = await ethers.provider.getBlock("latest");
            const currentTime = block!.timestamp;
            expect(delegation.updatedAt).to.equal(currentTime);
            expect(contractBalanceAfter - contractBalanceBefore).to.equal(amount);
            expect(delegatorBalanceBefore - delegatorBalanceAfter).to.equal(amount);
        });

        it("Should allow delegating more tokens to same resolver", async function () {
            const firstAmount = ethers.parseEther("1000");
            const secondAmount = ethers.parseEther("2000");

            await delegationManager.connect(delegatorA).delegate(resolverA.address, firstAmount);
            await delegationManager.connect(delegatorA).delegate(resolverA.address, secondAmount);

            const delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(firstAmount + secondAmount);
            expect(delegation.resolver).to.equal(resolverA.address);
            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(
                firstAmount + secondAmount,
            );
        });

        it("Should revert if resolver is zero address", async function () {
            const amount = ethers.parseEther("2000");
            await expect(
                delegationManager.connect(delegatorA).delegate(ethers.ZeroAddress, amount),
            ).to.be.revertedWithCustomError(delegationManager, "InvalidAddress");
        });

        it("Should revert if delegation amount is zero", async function () {
            await expect(
                delegationManager.connect(delegatorA).delegate(resolverA.address, 0),
            ).to.be.revertedWithCustomError(delegationManager, "InvalidDelegationAmount");
        });

        it("Should revert if resolver is not valid", async function () {
            const amount = ethers.parseEther("2000");
            await expect(
                delegationManager.connect(delegatorA).delegate(resolverC.address, amount),
            ).to.be.revertedWithCustomError(delegationManager, "NotValidResolver");
        });

        it("Should revert if delegator hasn't approved enough tokens", async function () {
            await mockStakingToken
                .connect(delegatorA)
                .approve(await delegationManager.getAddress(), 0);
            const amount = ethers.parseEther("2000");
            await expect(
                delegationManager.connect(delegatorA).delegate(resolverA.address, amount),
            ).to.be.revertedWithCustomError(mockStakingToken, "ERC20InsufficientAllowance");
        });

        it("Should revert if delegator has insufficient balance", async function () {
            await mockStakingToken
                .connect(delegatorA)
                .transfer(nonOwner.address, ethers.parseEther("9000"));
            const largeAmount = ethers.parseEther("2000");
            await expect(
                delegationManager.connect(delegatorA).delegate(resolverA.address, largeAmount),
            ).to.be.revertedWithCustomError(mockStakingToken, "ERC20InsufficientBalance");
        });

        it("Should revert if delegator already delegated to different resolver", async function () {
            const amount = ethers.parseEther("2000");
            await delegationManager.connect(delegatorA).delegate(resolverA.address, amount);
            await expect(
                delegationManager.connect(delegatorA).delegate(resolverB.address, amount),
            ).to.be.revertedWithCustomError(delegationManager, "OnlyOneDelegationAllowed");
        });
    });

    describe("undelegate", function () {
        const delegationAmount = ethers.parseEther("3000");

        beforeEach(async function () {
            await delegationManager
                .connect(delegatorA)
                .delegate(resolverA.address, delegationAmount);
        });

        it("Should emit Undelegated event on successful undelegation", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);

            await ethers.provider.send("evm_mine", []);
            const amount = ethers.parseEther("1000");
            await expect(delegationManager.connect(delegatorA).undelegate(amount))
                .to.emit(delegationManager, "Undelegated")
                .withArgs(delegatorA.address, amount);
        });

        it("Should transfer tokens and update state on successful undelegation", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            const amount = ethers.parseEther("1000");
            const contractBalanceBefore = await mockStakingToken.balanceOf(
                await delegationManager.getAddress(),
            );
            const delegatorBalanceBefore = await mockStakingToken.balanceOf(delegatorA.address);

            await delegationManager.connect(delegatorA).undelegate(amount);

            const delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(delegationAmount - amount);
            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(
                delegationAmount - amount,
            );
            expect(await delegationManager.getTotalDelegated()).to.equal(delegationAmount - amount);

            const block = await ethers.provider.getBlock("latest");
            const currentTime = block!.timestamp;
            expect(delegation.updatedAt).to.be.closeTo(currentTime, 20);

            const contractBalanceAfter = await mockStakingToken.balanceOf(
                await delegationManager.getAddress(),
            );
            const delegatorBalanceAfter = await mockStakingToken.balanceOf(delegatorA.address);
            expect(contractBalanceBefore - contractBalanceAfter).to.equal(amount);
            expect(delegatorBalanceAfter - delegatorBalanceBefore).to.equal(amount);
        });

        it("Should revert if undelegation amount is zero", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await expect(
                delegationManager.connect(delegatorA).undelegate(0),
            ).to.be.revertedWithCustomError(delegationManager, "InvalidUndelegationAmount");
        });

        it("Should revert if delegator has no delegation", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await expect(
                delegationManager.connect(nonOwner).undelegate(ethers.parseEther("1000")),
            ).to.be.revertedWithCustomError(delegationManager, "NotValidDelegation");
        });

        it("Should revert if undelegation amount exceeds delegated amount", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            const overAmount = delegationAmount + ethers.parseEther("1");
            await expect(
                delegationManager.connect(delegatorA).undelegate(overAmount),
            ).to.be.revertedWithCustomError(delegationManager, "InvalidUndelegationAmount");
        });

        it("Should revert if undelegation before freezing period", async function () {
            const amount = ethers.parseEther("1000");
            await expect(
                delegationManager.connect(delegatorA).undelegate(amount),
            ).to.be.revertedWithCustomError(delegationManager, "FreezingPeriodNotOver");
        });

        it("Should delete delegation when fully undelegated", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await delegationManager.connect(delegatorA).undelegate(delegationAmount);

            const delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(0);
            expect(delegation.resolver).to.equal(ethers.ZeroAddress);
            expect(delegation.updatedAt).to.equal(0);
            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(0);
            expect(await delegationManager.getTotalDelegated()).to.equal(0);
        });
    });

    describe("redelegate", function () {
        const delegationAmount = ethers.parseEther("3000");

        beforeEach(async function () {
            await delegationManager
                .connect(delegatorA)
                .delegate(resolverA.address, delegationAmount);
        });

        it("Should emit Redelegated event on successful redelegation", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await expect(delegationManager.connect(delegatorA).redelegate(resolverB.address))
                .to.emit(delegationManager, "Redelegated")
                .withArgs(delegatorA.address, resolverA.address, resolverB.address);
        });

        it("Should update state on successful redelegation", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            const totalDelegatedBefore = await delegationManager.getTotalDelegated();
            await delegationManager.connect(delegatorA).redelegate(resolverB.address);
            const totalDelegatedAfter = await delegationManager.getTotalDelegated();

            const delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.resolver).to.equal(resolverB.address);
            expect(delegation.delegatedAmount).to.equal(delegationAmount);

            const block = await ethers.provider.getBlock("latest");
            const currentTime = block!.timestamp;
            expect(delegation.updatedAt).to.equal(currentTime);

            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(0);
            expect(await delegationManager.delegationTo(resolverB.address)).to.equal(
                delegationAmount,
            );
            expect(totalDelegatedAfter).to.equal(totalDelegatedBefore);
        });

        it("Should revert if new resolver is not valid", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await expect(
                delegationManager.connect(delegatorA).redelegate(resolverC.address),
            ).to.be.revertedWithCustomError(delegationManager, "NotValidResolver");
        });

        it("Should revert if delegator has no delegation", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await expect(
                delegationManager.connect(nonOwner).redelegate(resolverB.address),
            ).to.be.revertedWithCustomError(delegationManager, "NotValidDelegation");
        });

        it("Should revert if redelegating to same resolver", async function () {
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await expect(
                delegationManager.connect(delegatorA).redelegate(resolverA.address),
            ).to.be.revertedWithCustomError(delegationManager, "InvalidNewResolver");
        });

        it("Should revert if redelegating before freezing period", async function () {
            await expect(
                delegationManager.connect(delegatorA).redelegate(resolverB.address),
            ).to.be.revertedWithCustomError(delegationManager, "FreezingPeriodNotOver");
        });
    });

    describe("claimReward", function () {
        const delegationAmount = ethers.parseEther("3000");

        beforeEach(async function () {
            await delegationManager
                .connect(delegatorA)
                .delegate(resolverA.address, delegationAmount);
        });

        it("Should emit RewardPaid event when claiming rewards", async function () {
            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);

            await expect(delegationManager.connect(delegatorA).claimReward())
                .to.emit(delegationManager, "RewardPaid")
                .withArgs(delegatorA.address, (amount: bigint) => amount > 0n);
        });

        it("Should receive all rewards if one delegator", async function () {
            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);

            const balanceBefore = await mockRewardToken.balanceOf(delegatorA.address);
            await delegationManager.connect(delegatorA).claimReward();
            const balanceAfter = await mockRewardToken.balanceOf(delegatorA.address);

            const claimedReward = BigInt(balanceAfter) - BigInt(balanceBefore);
            const tolerance = REWARD_AMOUNT / 10000n;

            expect(REWARD_AMOUNT - claimedReward).to.be.lessThan(tolerance);
            expect(await delegationManager.rewards(delegatorA.address)).to.equal(0);
        });

        it("Should distribute rewards correctly when second delegator joins halfway", async function () {
            const durationEnd = await delegationManager.durationEnd();

            const startTime = await delegationManager.lastUpdateTime();

            const halfDuration = (await delegationManager.rewardsDuration()) / 2n;

            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(startTime + halfDuration),
            ]);

            await ethers.provider.send("evm_mine", []);

            await delegationManager
                .connect(delegatorB)
                .delegate(resolverB.address, delegationAmount);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);

            await ethers.provider.send("evm_mine", []);

            const balanceABefore = await mockRewardToken.balanceOf(delegatorA.address);

            await delegationManager.connect(delegatorA).claimReward();

            const balanceAAfter = await mockRewardToken.balanceOf(delegatorA.address);

            const balanceBBefore = await mockRewardToken.balanceOf(delegatorB.address);

            await delegationManager.connect(delegatorB).claimReward();

            const balanceBAfter = await mockRewardToken.balanceOf(delegatorB.address);

            const rewardA = BigInt(balanceAAfter) - BigInt(balanceABefore);

            const rewardB = BigInt(balanceBAfter) - BigInt(balanceBBefore);

            const tolerance = REWARD_AMOUNT / 10000n;

            expect((REWARD_AMOUNT * 3n) / 4n - rewardA).to.be.lessThan(tolerance);

            expect(REWARD_AMOUNT / 4n - rewardB).to.be.lessThan(tolerance);

            expect(REWARD_AMOUNT - rewardA - rewardB).to.be.lessThan(tolerance);

            expect(await delegationManager.rewards(delegatorA.address)).to.equal(0);

            expect(await delegationManager.rewards(delegatorB.address)).to.equal(0);
        });

        it("Should not transfer when no claimable rewards", async function () {
            const rewardBefore = await delegationManager.earned(delegatorA.address);

            await ethers.provider.send("evm_increaseTime", [Number(REWARDS_DURATION)]);
            await ethers.provider.send("evm_mine", []);

            await delegationManager.connect(delegatorA).claimReward();
            const balanceBefore = await mockRewardToken.balanceOf(delegatorA.address);
            await delegationManager.connect(delegatorA).claimReward();
            const balanceAfter = await mockRewardToken.balanceOf(delegatorA.address);
            expect(balanceAfter - balanceBefore).to.equal(0);
        });
    });

    describe("exit", function () {
        const delegationAmount = ethers.parseEther("3000");

        beforeEach(async function () {
            await delegationManager
                .connect(delegatorA)
                .delegate(resolverA.address, delegationAmount);
        });

        it("Should exit successfully: undelegate all + claim rewards", async function () {
            await ethers.provider.send("evm_increaseTime", [Number(REWARDS_DURATION)]);
            await ethers.provider.send("evm_mine", []);

            const stakingBalanceBefore = await mockStakingToken.balanceOf(delegatorA.address);
            const rewardBalanceBefore = await mockRewardToken.balanceOf(delegatorA.address);

            await delegationManager.connect(delegatorA).exit();

            const delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(0);

            const stakingBalanceAfter = await mockStakingToken.balanceOf(delegatorA.address);
            expect(stakingBalanceAfter - stakingBalanceBefore).to.equal(delegationAmount);

            const rewardBalanceAfter = await mockRewardToken.balanceOf(delegatorA.address);
            expect(rewardBalanceAfter - rewardBalanceBefore).to.be.greaterThan(0);

            expect(await delegationManager.getTotalDelegated()).to.equal(0);
            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(0);
        });

        it("Should revert if exit before freezing period", async function () {
            await expect(
                delegationManager.connect(delegatorA).exit(),
            ).to.be.revertedWithCustomError(delegationManager, "FreezingPeriodNotOver");
        });
    });

    describe("notifyRewardAmount", function () {
        it("should update varibales correctly when notifying reward amount", async function () {
            const startTime = await delegationManager.lastUpdateTime();
            const endTime = await delegationManager.durationEnd();
            expect(endTime).to.equal(startTime + REWARDS_DURATION);
            const rewardRate = await delegationManager.rewardRate();
            expect(rewardRate).to.equal(REWARD_AMOUNT / REWARDS_DURATION);
        });

        it("Should add leftover when notifying before period ends", async function () {
            const rewardRateBefore = await delegationManager.rewardRate();
            const durationEndBefore = await delegationManager.durationEnd();
            const lastUpdateTimeBefore = await delegationManager.lastUpdateTime();
            expect(durationEndBefore).to.be.greaterThan(0);
            expect(rewardRateBefore).to.be.greaterThan(0);
            expect(lastUpdateTimeBefore).to.be.greaterThan(0);

            const newReward = ethers.parseEther("5000");
            await ethers.provider.send("evm_increaseTime", [
                Number((await delegationManager.rewardsDuration()) / 2n),
            ]);
            await ethers.provider.send("evm_mine", []);

            const remaining =
                durationEndBefore -
                BigInt(await ethers.provider.getBlock("latest").then((block) => block!.timestamp));

            const leftover = remaining * rewardRateBefore;
            const rewardsDuration = await delegationManager.rewardsDuration();
            const expectedRate = (newReward + leftover) / rewardsDuration;

            await expect(delegationManager.notifyRewardAmount(newReward))
                .to.emit(delegationManager, "RewardAdded")
                .withArgs(newReward);
            const rewardsRateAfter = await delegationManager.rewardRate();
            const durationEndAfter = await delegationManager.durationEnd();
            expect(rewardsRateAfter).to.be.closeTo(expectedRate, 10000000000n);
            expect(durationEndAfter).to.be.closeTo(
                BigInt(await ethers.provider.getBlock("latest").then((block) => block!.timestamp)) +
                    rewardsDuration,
                2n,
            );
        });

        it("Should set new reward rate when notifying after period ends", async function () {
            const newReward = ethers.parseEther("6000");
            await ethers.provider.send("evm_increaseTime", [
                Number((await delegationManager.rewardsDuration()) + 1n),
            ]);
            await ethers.provider.send("evm_mine", []);
            await delegationManager.notifyRewardAmount(newReward);
            const rewardsRateAfter = await delegationManager.rewardRate();
            const durationEndAfter = await delegationManager.durationEnd();
            expect(rewardsRateAfter).to.equal(
                newReward / (await delegationManager.rewardsDuration()),
            );
            expect(durationEndAfter).to.be.closeTo(
                BigInt(await ethers.provider.getBlock("latest").then((block) => block!.timestamp)) +
                    (await delegationManager.rewardsDuration()),
                2n,
            );
        });

        it("Should revert if reward amount is zero", async function () {
            await expect(delegationManager.notifyRewardAmount(0)).to.be.revertedWithCustomError(
                delegationManager,
                "InvalidRewardAmount",
            );
        });

        it("Should revert if reward amount exceeds contract balance", async function () {
            const tooHighReward = ethers.parseEther("10000000");
            await expect(
                delegationManager.notifyRewardAmount(tooHighReward),
            ).to.be.revertedWithCustomError(delegationManager, "RewardAmountTooHigh");
        });

        it("Should revert if not called by owner", async function () {
            const newReward = ethers.parseEther("5000");
            await expect(
                delegationManager.connect(nonOwner).notifyRewardAmount(newReward),
            ).to.be.revertedWithCustomError(delegationManager, "OwnableUnauthorizedAccount");
        });
    });

    describe("setFreezingPeriod", function () {
        it("Should emit FreezingPeriodUpdated event", async function () {
            const newFreezingPeriod = 20;
            await expect(delegationManager.setFreezingPeriod(newFreezingPeriod))
                .to.emit(delegationManager, "FreezingPeriodUpdated")
                .withArgs(newFreezingPeriod);
        });

        it("Should update freezingPeriod", async function () {
            const newFreezingPeriod = 20;
            await delegationManager.setFreezingPeriod(newFreezingPeriod);
            expect(await delegationManager.freezingPeriod()).to.equal(newFreezingPeriod);
        });

        it("Should revert if called by non-owner", async function () {
            await expect(
                delegationManager.connect(nonOwner).setFreezingPeriod(20),
            ).to.be.revertedWithCustomError(delegationManager, "OwnableUnauthorizedAccount");
        });
    });

    describe("View functions", function () {
        const delegationAmount = ethers.parseEther("3000");

        beforeEach(async function () {
            await delegationManager
                .connect(delegatorA)
                .delegate(resolverA.address, delegationAmount);
        });

        it("delegatedAmountOf should return correct amount", async function () {
            expect(await delegationManager.delegatedAmountOf(delegatorA.address)).to.equal(
                delegationAmount,
            );
        });

        it("delegatedAmountOf should return 0 for non-existent delegation", async function () {
            expect(await delegationManager.delegatedAmountOf(nonOwner.address)).to.equal(0);
        });

        it("getRewardForDuration should return correct value", async function () {
            const rewardRate = await delegationManager.rewardRate();
            const rewardsDuration = await delegationManager.rewardsDuration();
            expect(await delegationManager.getRewardForDuration()).to.equal(
                rewardRate * rewardsDuration,
            );
        });

        it("isValidDelegation should return true for valid delegation", async function () {
            expect(await delegationManager.isValidDelegation(delegatorA.address)).to.be.true;
        });

        it("isValidDelegation should return false for non-existent delegation", async function () {
            expect(await delegationManager.isValidDelegation(nonOwner.address)).to.be.false;
        });

        it("getTotalDelegated / rewardPerToken should return correct values when no delegations", async function () {
            expect(await delegationManager.getTotalDelegated()).to.equal(delegationAmount);
            const rewardPerTokenBefore = await delegationManager.rewardPerToken();
            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);
            await delegationManager.connect(delegatorA).undelegate(delegationAmount);
            expect(await delegationManager.getTotalDelegated()).to.equal(0);
            const rewardPerTokenAfter = await delegationManager.rewardPerToken();
            expect(rewardPerTokenAfter).to.be.greaterThan(rewardPerTokenBefore);
        });
    });

    describe("Reward calculation", function () {
        const delegationAmount = ethers.parseEther("3000");

        beforeEach(async function () {
            await delegationManager
                .connect(delegatorA)
                .delegate(resolverA.address, delegationAmount);
        });

        it("rewardPerToken should return stored value when totalDelegated == 0", async function () {
            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);
            await delegationManager.connect(delegatorA).claimReward();

            const storedBefore = await delegationManager.rewardPerTokenStored();

            for (let i = 0; i < FREEZING_PERIOD; i++) {
                await ethers.provider.send("evm_mine", []);
            }
            await delegationManager.connect(delegatorA).undelegate(delegationAmount);

            const rewardPerToken = await delegationManager.rewardPerToken();
            expect(rewardPerToken).to.equal(storedBefore);
        });

        it("rewardPerToken should calculate correctly when totalDelegated > 0", async function () {
            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);

            const rewardPerToken = await delegationManager.rewardPerToken();
            expect(rewardPerToken).to.be.greaterThan(0);
        });

        it("earned should return correct amount", async function () {
            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);

            const earned = await delegationManager.earned(delegatorA.address);
            expect(earned).to.be.greaterThan(0);
        });

        it("earned should return 0 when no rewards", async function () {
            const earned = await delegationManager.earned(delegatorA.address);
            expect(earned).to.equal(0);
        });

        it("updateReward should update rewards for delegator", async function () {
            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);

            await delegationManager.connect(delegatorA).claimReward();

            expect(await delegationManager.rewards(delegatorA.address)).to.equal(0);
            expect(
                await delegationManager.userRewardPerTokenPaid(delegatorA.address),
            ).to.be.greaterThan(0);
        });

        it("updateReward should skip user update when delegator is zero address", async function () {
            const newReward = ethers.parseEther("5000");
            await mockRewardToken.transfer(await delegationManager.getAddress(), newReward);

            const lastUpdateTimeBefore = await delegationManager.lastUpdateTime();
            await delegationManager.notifyRewardAmount(newReward);
            expect(await delegationManager.lastUpdateTime()).to.not.equal(lastUpdateTimeBefore);
        });
    });

    describe("Integration: Full lifecycle", function () {
        it("Should complete full delegation lifecycle", async function () {
            const delegationAmount = ethers.parseEther("3000");

            await expect(
                delegationManager.connect(delegatorA).delegate(resolverA.address, delegationAmount),
            )
                .to.emit(delegationManager, "Delegated")
                .withArgs(delegatorA.address, resolverA.address, delegationAmount);

            let delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(delegationAmount);
            expect(delegation.resolver).to.equal(resolverA.address);
            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(
                delegationAmount,
            );

            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);

            await expect(delegationManager.connect(delegatorA).redelegate(resolverB.address))
                .to.emit(delegationManager, "Redelegated")
                .withArgs(delegatorA.address, resolverA.address, resolverB.address);

            delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.resolver).to.equal(resolverB.address);
            expect(await delegationManager.delegationTo(resolverA.address)).to.equal(0);
            expect(await delegationManager.delegationTo(resolverB.address)).to.equal(
                delegationAmount,
            );

            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);

            await expect(delegationManager.connect(delegatorA).claimReward())
                .to.emit(delegationManager, "RewardPaid")
                .withArgs(delegatorA.address, (amount: bigint) => amount > 0n);

            await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
            await ethers.provider.send("evm_mine", []);

            await expect(delegationManager.connect(delegatorA).undelegate(delegationAmount))
                .to.emit(delegationManager, "Undelegated")
                .withArgs(delegatorA.address, delegationAmount);

            delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(0);
            expect(await delegationManager.delegationTo(resolverB.address)).to.equal(0);
            expect(await delegationManager.getTotalDelegated()).to.equal(0);
        });

        it("Should handle exit with rewards", async function () {
            const delegationAmount = ethers.parseEther("3000");

            await delegationManager
                .connect(delegatorA)
                .delegate(resolverA.address, delegationAmount);

            const durationEnd = await delegationManager.durationEnd();
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(durationEnd)]);
            await ethers.provider.send("evm_mine", []);

            const stakingBalanceBefore = await mockStakingToken.balanceOf(delegatorA.address);
            const rewardBalanceBefore = await mockRewardToken.balanceOf(delegatorA.address);

            await delegationManager.connect(delegatorA).exit();

            const stakingBalanceAfter = await mockStakingToken.balanceOf(delegatorA.address);
            expect(stakingBalanceAfter - stakingBalanceBefore).to.equal(delegationAmount);

            const rewardBalanceAfter = await mockRewardToken.balanceOf(delegatorA.address);
            expect(rewardBalanceAfter - rewardBalanceBefore).to.be.greaterThan(0);

            const delegation = await delegationManager.delegations(delegatorA.address);
            expect(delegation.delegatedAmount).to.equal(0);
        });
    });
});
