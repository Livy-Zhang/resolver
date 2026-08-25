import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

describe("StakingManager", function () {
    let stakingManager: any;
    let mockToken: any;
    let owner: any;
    let nonOwner: any;
    let resolverA: any;
    let resolverB: any;
    let operator: any;
    let other: any;

    let MIN_SELF_STAKE: bigint;
    let THAWING_PERIOD: number;

    beforeEach(async function () {
        MIN_SELF_STAKE = ethers.parseEther("1000");
        THAWING_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds
        [owner, nonOwner, resolverA, resolverB, operator, other] = await ethers.getSigners();

        mockToken = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        await mockToken.waitForDeployment();

        stakingManager = await ethers.deployContract("StakingManager", [
            MIN_SELF_STAKE,
            await mockToken.getAddress(),
            THAWING_PERIOD,
        ]);
        await stakingManager.waitForDeployment();

        await mockToken.transfer(resolverA.address, ethers.parseEther("10000"));
        await mockToken.transfer(resolverB.address, ethers.parseEther("10000"));

        await mockToken
            .connect(resolverA)
            .approve(await stakingManager.getAddress(), ethers.parseEther("50000"));
        await mockToken
            .connect(resolverB)
            .approve(await stakingManager.getAddress(), ethers.parseEther("50000"));
        await mockToken.approve(await stakingManager.getAddress(), ethers.parseEther("1000000"));
    });

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            expect(await stakingManager.STAKING_TOKEN()).to.equal(await mockToken.getAddress());
            expect(await stakingManager.minSelfStake()).to.equal(MIN_SELF_STAKE);
            expect(await stakingManager.thawingPeriod()).to.equal(THAWING_PERIOD);
        });

        it("Should set the correct owner", async function () {
            const contractOwner = await stakingManager.owner();
            expect(contractOwner).to.equal(owner.address);
        });

        it("Should revert if staking token is zero address", async function () {
            const factory = await ethers.getContractFactory("StakingManager");
            await expect(
                factory.deploy(MIN_SELF_STAKE, ethers.ZeroAddress, THAWING_PERIOD),
            ).to.be.revertedWithCustomError(factory, "InvalidAddress");
        });

        it("Should revert if minSelfStake is zero", async function () {
            const factory = await ethers.getContractFactory("StakingManager");
            await expect(
                factory.deploy(0, await mockToken.getAddress(), THAWING_PERIOD),
            ).to.be.revertedWithCustomError(factory, "InvalidMinSelfStake");
        });

        it("Should revert if thawingPeriod is zero", async function () {
            const factory = await ethers.getContractFactory("StakingManager");
            await expect(
                factory.deploy(MIN_SELF_STAKE, await mockToken.getAddress(), 0),
            ).to.be.revertedWithCustomError(factory, "InvalidThawingPeriod");
        });
    });

    describe("stake", function () {
        it("Should allow resolver to stake tokens", async function () {
            const stakeAmount = ethers.parseEther("2000");
            const contractBalanceBefore = await mockToken.balanceOf(
                await stakingManager.getAddress(),
            );
            const resolverBalanceBefore = await mockToken.balanceOf(resolverA.address);

            await expect(stakingManager.connect(resolverA).stake(stakeAmount))
                .to.emit(stakingManager, "Staked")
                .withArgs(resolverA.address, stakeAmount);

            const stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(stakeAmount);
            expect(stakeInfo.amountLocked).to.equal(0);
            expect(stakeInfo.unlockTime).to.equal(0);

            const contractBalanceAfter = await mockToken.balanceOf(
                await stakingManager.getAddress(),
            );
            const resolverBalanceAfter = await mockToken.balanceOf(resolverA.address);
            expect(contractBalanceAfter - contractBalanceBefore).to.equal(stakeAmount);
            expect(resolverBalanceBefore - resolverBalanceAfter).to.equal(stakeAmount);
        });

        it("Should allow stake exactly equal to minSelfStake", async function () {
            await stakingManager.connect(resolverA).stake(MIN_SELF_STAKE);
            const stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(MIN_SELF_STAKE);
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;
        });

        it("Should allow multiple staking by same resolver", async function () {
            const firstStake = ethers.parseEther("2000");
            const secondStake = ethers.parseEther("3000");

            await stakingManager.connect(resolverA).stake(firstStake);
            await stakingManager.connect(resolverA).stake(secondStake);

            const stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(firstStake + secondStake);
        });

        it("Should revert if staking amount is zero", async function () {
            await expect(stakingManager.connect(resolverA).stake(0)).to.be.revertedWithCustomError(
                stakingManager,
                "InvalidStakingAmount",
            );
        });

        it("Should revert if total staked is below minimum self stake", async function () {
            const smallAmount = ethers.parseEther("500");
            await expect(
                stakingManager.connect(resolverA).stake(smallAmount),
            ).to.be.revertedWithCustomError(stakingManager, "BelowMinSelfStake");
        });

        it("Should revert if resolver has insufficient balance", async function () {
            const largeAmount = ethers.parseEther("20000");
            await expect(
                stakingManager.connect(resolverA).stake(largeAmount),
            ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance");
        });

        it("Should revert if resolver hasn't approved enough tokens", async function () {
            await mockToken.connect(resolverA).approve(await stakingManager.getAddress(), 0);
            const amount = ethers.parseEther("2000");
            await expect(
                stakingManager.connect(resolverA).stake(amount),
            ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientAllowance");
        });
    });

    describe("unstake", function () {
        const stakeAmount = ethers.parseEther("3000");

        beforeEach(async function () {
            await stakingManager.connect(resolverA).stake(stakeAmount);
        });

        it("Should allow resolver to unstake tokens", async function () {
            const unstakeAmount = ethers.parseEther("1000");

            await expect(stakingManager.connect(resolverA).unstake(unstakeAmount))
                .to.emit(stakingManager, "Unstaked")
                .withArgs(resolverA.address, unstakeAmount);

            const stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(stakeAmount - unstakeAmount);
            expect(stakeInfo.amountLocked).to.equal(unstakeAmount);
            const block = await ethers.provider.getBlock("latest");
            expect(stakeInfo.unlockTime).to.equal(block!.timestamp + THAWING_PERIOD);
        });

        it("Should not allow multiple unstakes by same resolver", async function () {
            const firstUnstake = ethers.parseEther("500");
            const secondUnstake = ethers.parseEther("500");

            await stakingManager.connect(resolverA).unstake(firstUnstake);
            await expect(
                stakingManager.connect(resolverA).unstake(secondUnstake),
            ).to.be.revertedWithCustomError(stakingManager, "LockedExist");

            const stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(stakeAmount - firstUnstake);
            expect(stakeInfo.amountLocked).to.equal(firstUnstake);
        });

        it("Should revert if unstaking amount is zero", async function () {
            await expect(
                stakingManager.connect(resolverA).unstake(0),
            ).to.be.revertedWithCustomError(stakingManager, "InvalidStakingAmount");
        });

        it("Should revert if unstaking amount exceeds staked amount", async function () {
            const overAmount = stakeAmount + ethers.parseEther("1");
            await expect(
                stakingManager.connect(resolverA).unstake(overAmount),
            ).to.be.revertedWithCustomError(stakingManager, "InvalidStakingAmount");
        });

        it("Should allow unstaking down to below minSelfStake", async function () {
            const unstakeAmount = ethers.parseEther("2500");
            await stakingManager.connect(resolverA).unstake(unstakeAmount);

            const stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(ethers.parseEther("500"));
        });

        it("Should allow unstake after previous unstake was withdrawn", async function () {
            const firstUnstake = ethers.parseEther("500");
            await stakingManager.connect(resolverA).unstake(firstUnstake);

            const stakeInfo = await stakingManager.stakes(resolverA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);

            await stakingManager.connect(resolverA).withdrawStaked(resolverA.address);

            const secondUnstake = ethers.parseEther("500");
            await expect(stakingManager.connect(resolverA).unstake(secondUnstake))
                .to.emit(stakingManager, "Unstaked")
                .withArgs(resolverA.address, secondUnstake);

            const stakeInfoAfter = await stakingManager.stakes(resolverA.address);
            expect(stakeInfoAfter.amountActive).to.equal(
                stakeAmount - firstUnstake - secondUnstake,
            );
            expect(stakeInfoAfter.amountLocked).to.equal(secondUnstake);
        });
    });

    describe("withdrawStaked", function () {
        const stakeAmount = ethers.parseEther("3000");
        const unstakeAmount = ethers.parseEther("1000");

        beforeEach(async function () {
            await stakingManager.connect(resolverA).stake(stakeAmount);
            await stakingManager.connect(resolverA).unstake(unstakeAmount);
        });

        it("Should allow resolver to withdraw locked tokens after thawing period", async function () {
            const stakeInfo = await stakingManager.stakes(resolverA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);

            const contractBalanceBefore = await mockToken.balanceOf(
                await stakingManager.getAddress(),
            );
            const resolverBalanceBefore = await mockToken.balanceOf(resolverA.address);

            await expect(stakingManager.connect(resolverA).withdrawStaked(resolverA.address))
                .to.emit(stakingManager, "StakedWithdrawn")
                .withArgs(resolverA.address, resolverA.address, unstakeAmount);

            const stakeInfoAfter = await stakingManager.stakes(resolverA.address);
            expect(stakeInfoAfter.amountLocked).to.equal(0);
            expect(stakeInfoAfter.unlockTime).to.equal(0);

            const contractBalanceAfter = await mockToken.balanceOf(
                await stakingManager.getAddress(),
            );
            const resolverBalanceAfter = await mockToken.balanceOf(resolverA.address);
            expect(contractBalanceBefore - contractBalanceAfter).to.equal(unstakeAmount);
            expect(resolverBalanceAfter - resolverBalanceBefore).to.equal(unstakeAmount);
        });

        it("Should allow withdraw to different address", async function () {
            const stakeInfo = await stakingManager.stakes(resolverA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);

            const receiverBalanceBefore = await mockToken.balanceOf(operator.address);

            await stakingManager.connect(resolverA).withdrawStaked(operator.address);

            const receiverBalanceAfter = await mockToken.balanceOf(operator.address);
            expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(unstakeAmount);
        });

        it("Should revert if trying to withdraw before thawing period", async function () {
            await expect(
                stakingManager.connect(resolverA).withdrawStaked(resolverA.address),
            ).to.be.revertedWithCustomError(stakingManager, "NotAllowedToWithdraw");
        });

        it("Should revert if no locked tokens to withdraw", async function () {
            const newResolver = other;
            await mockToken.transfer(newResolver.address, ethers.parseEther("10000"));
            await mockToken
                .connect(newResolver)
                .approve(await stakingManager.getAddress(), ethers.parseEther("10000"));
            await stakingManager.connect(newResolver).stake(ethers.parseEther("2000"));

            await expect(
                stakingManager.connect(newResolver).withdrawStaked(newResolver.address),
            ).to.be.revertedWithCustomError(stakingManager, "NoLockedAmount");
        });

        it("Should revert if to address is zero", async function () {
            const stakeInfo = await stakingManager.stakes(resolverA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);

            await expect(
                stakingManager.connect(resolverA).withdrawStaked(ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(stakingManager, "InvalidAddress");
        });

        it("Should revert if called by non-resolver", async function () {
            const stakeInfo = await stakingManager.stakes(resolverA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);

            await expect(
                stakingManager.connect(nonOwner).withdrawStaked(nonOwner.address),
            ).to.be.revertedWithCustomError(stakingManager, "NoLockedAmount");
        });
    });

    describe("isValidResolver", function () {
        it("Should return false for address with no stake", async function () {
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.false;
        });

        it("Should return true for address with stake > minSelfStake", async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("2000"));
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;
        });

        it("Should return false for address with stake < minSelfStake", async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("1000"));
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;

            await stakingManager.connect(resolverA).unstake(ethers.parseEther("500"));
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.false;
        });

        it("Should return true for address with stake = minSelfStake", async function () {
            await stakingManager.connect(resolverA).stake(MIN_SELF_STAKE);
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;
        });
    });

    describe("setOperator", function () {
        beforeEach(async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("2000"));
        });

        it("Should allow resolver to set operator", async function () {
            await expect(stakingManager.connect(resolverA).setOperator(operator.address, true))
                .to.emit(stakingManager, "SetOperator")
                .withArgs(resolverA.address, operator.address, true);

            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .true;
        });

        it("Should allow resolver to remove operator", async function () {
            await stakingManager.connect(resolverA).setOperator(operator.address, true);
            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .true;

            await stakingManager.connect(resolverA).setOperator(operator.address, false);
            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .false;
        });

        it("Should allow resolver to set multiple operators", async function () {
            await stakingManager.connect(resolverA).setOperator(operator.address, true);
            await stakingManager.connect(resolverA).setOperator(other.address, true);

            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .true;
            expect(await stakingManager.isValidOperator(resolverA.address, other.address)).to.be
                .true;
        });

        it("Should allow resolver to revoke all operators", async function () {
            await stakingManager.connect(resolverA).setOperator(operator.address, true);
            await stakingManager.connect(resolverA).setOperator(other.address, true);

            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .true;
            expect(await stakingManager.isValidOperator(resolverA.address, other.address)).to.be
                .true;

            await stakingManager.connect(resolverA).setOperator(operator.address, false);
            await stakingManager.connect(resolverA).setOperator(other.address, false);

            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .false;
            expect(await stakingManager.isValidOperator(resolverA.address, other.address)).to.be
                .false;
        });

        it("Should revert if operator is zero address", async function () {
            await expect(
                stakingManager.connect(resolverA).setOperator(ethers.ZeroAddress, true),
            ).to.be.revertedWithCustomError(stakingManager, "InvalidOperator");
        });

        it("Should revert if caller is not a valid resolver", async function () {
            await expect(
                stakingManager.connect(nonOwner).setOperator(operator.address, true),
            ).to.be.revertedWithCustomError(stakingManager, "NotValidResolver");
        });
    });

    describe("isValidOperator", function () {
        beforeEach(async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("2000"));
            await stakingManager.connect(resolverA).setOperator(operator.address, true);
        });

        it("Should return true for authorized operator", async function () {
            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .true;
        });

        it("Should return false for unauthorized operator", async function () {
            expect(await stakingManager.isValidOperator(resolverA.address, other.address)).to.be
                .false;
        });

        it("Should return false if resolver is not valid", async function () {
            expect(await stakingManager.isValidOperator(resolverB.address, operator.address)).to.be
                .false;
        });

        it("Should return false if resolver has stake < minSelfStake", async function () {
            await stakingManager.connect(resolverA).unstake(ethers.parseEther("1500"));
            expect(await stakingManager.isValidOperator(resolverA.address, operator.address)).to.be
                .false;
        });
    });

    describe("getSelfStakedAmount", function () {
        it("Should return 0 for address with no stake", async function () {
            expect(await stakingManager.getSelfStakedAmount(resolverA.address)).to.equal(0);
        });

        it("Should return correct staked amount", async function () {
            const stakeAmount = ethers.parseEther("3000");
            await stakingManager.connect(resolverA).stake(stakeAmount);
            expect(await stakingManager.getSelfStakedAmount(resolverA.address)).to.equal(
                stakeAmount,
            );
        });

        it("Should return correct staked amount after multiple stakes", async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("1000"));
            await stakingManager.connect(resolverA).stake(ethers.parseEther("2000"));
            expect(await stakingManager.getSelfStakedAmount(resolverA.address)).to.equal(
                ethers.parseEther("3000"),
            );
        });

        it("Should return correct staked amount after unstake", async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("3000"));
            await stakingManager.connect(resolverA).unstake(ethers.parseEther("1000"));
            expect(await stakingManager.getSelfStakedAmount(resolverA.address)).to.equal(
                ethers.parseEther("2000"),
            );
        });
    });

    describe("totalStake", function () {
        it("Should return 0 when no resolver has staked", async function () {
            expect(await stakingManager.totalStake()).to.equal(0);
        });

        it("Should return total active stake after staking", async function () {
            const stakeA = ethers.parseEther("2000");
            const stakeB = ethers.parseEther("3000");

            await stakingManager.connect(resolverA).stake(stakeA);
            await stakingManager.connect(resolverB).stake(stakeB);

            expect(await stakingManager.totalStake()).to.equal(stakeA + stakeB);
            expect(await stakingManager.totalAmountActive()).to.equal(stakeA + stakeB);
            expect(await stakingManager.totalAmountLocked()).to.equal(0);
        });

        it("Should include locked amount after unstake", async function () {
            const stakeAmount = ethers.parseEther("3000");
            const unstakeAmount = ethers.parseEther("1000");

            await stakingManager.connect(resolverA).stake(stakeAmount);
            await stakingManager.connect(resolverA).unstake(unstakeAmount);

            expect(await stakingManager.totalAmountActive()).to.equal(ethers.parseEther("2000"));
            expect(await stakingManager.totalAmountLocked()).to.equal(unstakeAmount);
            expect(await stakingManager.totalStake()).to.equal(stakeAmount);
        });
    });

    describe("setMinSelfStake", function () {
        const newMinSelfStake = ethers.parseEther("5000");

        it("Should allow owner to update minSelfStake", async function () {
            await expect(stakingManager.setMinSelfStake(newMinSelfStake))
                .to.emit(stakingManager, "MinSelfStakeUpdated")
                .withArgs(newMinSelfStake);

            expect(await stakingManager.minSelfStake()).to.equal(newMinSelfStake);
        });

        it("Should revert if called by non-owner", async function () {
            await expect(stakingManager.connect(nonOwner).setMinSelfStake(newMinSelfStake))
                .to.be.revertedWithCustomError(stakingManager, "OwnableUnauthorizedAccount")
                .withArgs(nonOwner.address);
        });

        it("Should affect isValidResolver after update", async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("3000"));
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;

            await stakingManager.setMinSelfStake(ethers.parseEther("4000"));
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.false;

            await mockToken
                .connect(resolverA)
                .approve(await stakingManager.getAddress(), ethers.parseEther("2000"));
            await stakingManager.connect(resolverA).stake(ethers.parseEther("2000"));
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;
        });
    });

    describe("setThawingPeriod", function () {
        const newThawingPeriod = 14 * 24 * 60 * 60;

        it("Should allow owner to update thawingPeriod", async function () {
            await expect(stakingManager.setThawingPeriod(newThawingPeriod))
                .to.emit(stakingManager, "ThawingPeriodUpdated")
                .withArgs(newThawingPeriod);

            expect(await stakingManager.thawingPeriod()).to.equal(newThawingPeriod);
        });

        it("Should revert if called by non-owner", async function () {
            await expect(stakingManager.connect(nonOwner).setThawingPeriod(newThawingPeriod))
                .to.be.revertedWithCustomError(stakingManager, "OwnableUnauthorizedAccount")
                .withArgs(nonOwner.address);
        });

        it("Should affect unstake unlock time after update", async function () {
            await stakingManager.connect(resolverA).stake(ethers.parseEther("3000"));

            const newPeriod = 1 * 24 * 60 * 60;
            await stakingManager.setThawingPeriod(newPeriod);

            await stakingManager.connect(resolverA).unstake(ethers.parseEther("1000"));
            const stakeInfo = await stakingManager.stakes(resolverA.address);
            const block = await ethers.provider.getBlock("latest");
            expect(stakeInfo.unlockTime).to.equal(block!.timestamp + newPeriod);
        });
    });

    describe("Integration: Full lifecycle", function () {
        it("Should complete full staking lifecycle: stake -> unstake -> withdraw", async function () {
            const stakeAmount = ethers.parseEther("3000");
            const unstakeAmount = ethers.parseEther("1000");

            await stakingManager.connect(resolverA).stake(stakeAmount);
            let stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(stakeAmount);

            await stakingManager.connect(resolverA).unstake(unstakeAmount);
            stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(stakeAmount - unstakeAmount);
            expect(stakeInfo.amountLocked).to.equal(unstakeAmount);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);

            const balanceBefore = await mockToken.balanceOf(resolverA.address);
            await stakingManager.connect(resolverA).withdrawStaked(resolverA.address);
            const balanceAfter = await mockToken.balanceOf(resolverA.address);
            expect(balanceAfter - balanceBefore).to.equal(unstakeAmount);

            stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountLocked).to.equal(0);
            expect(stakeInfo.unlockTime).to.equal(0);
        });

        it("Should complete full lifecycle: stake -> unstake -> withdraw -> stake again", async function () {
            const stakeAmount = ethers.parseEther("2000");

            await stakingManager.connect(resolverA).stake(stakeAmount);
            let stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(stakeAmount);

            await stakingManager.connect(resolverA).unstake(stakeAmount);
            stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountLocked).to.equal(stakeAmount);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);

            await stakingManager.connect(resolverA).withdrawStaked(resolverA.address);
            stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountLocked).to.equal(0);
            expect(stakeInfo.unlockTime).to.equal(0);
            expect(stakeInfo.amountActive).to.equal(0);

            await stakingManager.connect(resolverA).stake(stakeAmount);
            const newStakeInfo = await stakingManager.stakes(resolverA.address);
            expect(newStakeInfo.amountActive).to.equal(stakeAmount);
            expect(newStakeInfo.amountLocked).to.equal(0);
            expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;
        });

        it("Should allow unstake after previous unstake was withdrawn", async function () {
            const stakeAmount = ethers.parseEther("3000");
            const firstUnstake = ethers.parseEther("1000");
            const secondUnstake = ethers.parseEther("1000");

            await stakingManager.connect(resolverA).stake(stakeAmount);

            await stakingManager.connect(resolverA).unstake(firstUnstake);
            let stakeInfo = await stakingManager.stakes(resolverA.address);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);
            await stakingManager.connect(resolverA).withdrawStaked(resolverA.address);

            await stakingManager.connect(resolverA).unstake(secondUnstake);
            stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountActive).to.equal(stakeAmount - firstUnstake - secondUnstake);
            expect(stakeInfo.amountLocked).to.equal(secondUnstake);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(stakeInfo.unlockTime)]);
            await ethers.provider.send("evm_mine", []);
            await stakingManager.connect(resolverA).withdrawStaked(resolverA.address);

            stakeInfo = await stakingManager.stakes(resolverA.address);
            expect(stakeInfo.amountLocked).to.equal(0);
            expect(stakeInfo.amountActive).to.equal(stakeAmount - firstUnstake - secondUnstake);
        });
    });
});
