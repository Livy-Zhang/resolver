import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

describe("DelegationManager and StakingManager integration", function () {
    let stakingToken: any;
    let rewardToken: any;
    let stakingManager: any;
    let delegationManager: any;
    let resolverA: any;
    let resolverB: any;
    let delegator: any;

    const MIN_SELF_STAKE = ethers.parseEther("1000");
    const RESOLVER_A_STAKE = ethers.parseEther("2000");
    const RESOLVER_A_UNSTAKE = ethers.parseEther("1500");
    const DELEGATION_AMOUNT = ethers.parseEther("3000");
    const FREEZING_PERIOD = 10;
    const THAWING_PERIOD = 7 * 24 * 60 * 60;

    beforeEach(async function () {
        const [owner, , delegatorSigner, resolverASigner, resolverBSigner] =
            await ethers.getSigners();
        delegator = delegatorSigner;
        resolverA = resolverASigner;
        resolverB = resolverBSigner;

        stakingToken = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        rewardToken = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        stakingManager = await ethers.deployContract("StakingManager", [
            MIN_SELF_STAKE,
            await stakingToken.getAddress(),
            THAWING_PERIOD,
        ]);
        delegationManager = await ethers.deployContract("DelegationManager", [
            await rewardToken.getAddress(),
            await stakingToken.getAddress(),
            await stakingManager.getAddress(),
            30n,
            FREEZING_PERIOD,
        ]);

        await stakingToken.transfer(resolverA.address, RESOLVER_A_STAKE);
        await stakingToken.transfer(resolverB.address, MIN_SELF_STAKE);
        await stakingToken.transfer(delegator.address, DELEGATION_AMOUNT);

        await stakingToken
            .connect(resolverA)
            .approve(await stakingManager.getAddress(), RESOLVER_A_STAKE);
        await stakingToken
            .connect(resolverB)
            .approve(await stakingManager.getAddress(), MIN_SELF_STAKE);
        await stakingToken
            .connect(delegator)
            .approve(await delegationManager.getAddress(), DELEGATION_AMOUNT);

        await stakingManager.connect(resolverA).stake(RESOLVER_A_STAKE);
        await stakingManager.connect(resolverB).stake(MIN_SELF_STAKE);
        expect(await stakingManager.isValidResolver(resolverA.address)).to.be.true;
        expect(await stakingManager.isValidResolver(resolverB.address)).to.be.true;

        await delegationManager.connect(delegator).delegate(resolverA.address, DELEGATION_AMOUNT);
        await stakingManager.connect(resolverA).unstake(RESOLVER_A_UNSTAKE);
    });

    async function expectExistingDelegationIsFrozen() {
        expect(await stakingManager.isValidResolver(resolverA.address)).to.be.false;

        const delegation = await delegationManager.delegations(delegator.address);
        expect(delegation.delegatedAmount).to.equal(DELEGATION_AMOUNT);
        expect(delegation.resolver).to.equal(resolverA.address);
        expect(await delegationManager.delegationTo(resolverA.address)).to.equal(DELEGATION_AMOUNT);
        expect(await delegationManager.getTotalDelegated()).to.equal(DELEGATION_AMOUNT);

        await expect(
            delegationManager.connect(delegator).undelegate(DELEGATION_AMOUNT),
        ).to.be.revertedWithCustomError(delegationManager, "FreezingPeriodNotOver");
        await expect(
            delegationManager.connect(delegator).redelegate(resolverB.address),
        ).to.be.revertedWithCustomError(delegationManager, "FreezingPeriodNotOver");
    }

    it("keeps an ineligible resolver's existing delegation redelegatable after its freezing period", async function () {
        await expectExistingDelegationIsFrozen();

        await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
        await ethers.provider.send("evm_mine", []);
        await delegationManager.connect(delegator).redelegate(resolverB.address);

        const delegation = await delegationManager.delegations(delegator.address);
        expect(delegation.delegatedAmount).to.equal(DELEGATION_AMOUNT);
        expect(delegation.resolver).to.equal(resolverB.address);
        expect(await delegationManager.delegationTo(resolverA.address)).to.equal(0);
        expect(await delegationManager.delegationTo(resolverB.address)).to.equal(DELEGATION_AMOUNT);
        expect(await delegationManager.getTotalDelegated()).to.equal(DELEGATION_AMOUNT);
    });

    it("keeps an ineligible resolver's existing delegation withdrawable after its freezing period", async function () {
        await expectExistingDelegationIsFrozen();

        await ethers.provider.send("evm_increaseTime", [FREEZING_PERIOD]);
        await ethers.provider.send("evm_mine", []);
        const balanceBefore = await stakingToken.balanceOf(delegator.address);
        await delegationManager.connect(delegator).undelegate(DELEGATION_AMOUNT);

        const delegation = await delegationManager.delegations(delegator.address);
        expect(delegation.delegatedAmount).to.equal(0);
        expect(delegation.resolver).to.equal(ethers.ZeroAddress);
        expect(await delegationManager.delegationTo(resolverA.address)).to.equal(0);
        expect(await delegationManager.getTotalDelegated()).to.equal(0);
        expect(await stakingToken.balanceOf(delegator.address)).to.equal(
            balanceBefore + DELEGATION_AMOUNT,
        );
    });
});
