import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();
const REWARD_RATE = 50_000_000_000_000_000n;

describe("RewardsDistributorFactory", function () {
    async function deployFixture() {
        const [owner, rootPublisher, newRootPublisher, resolver, other] = await ethers.getSigners();
        const stakingManager = await ethers.deployContract("MockStakingManager");
        const implementation = await ethers.deployContract("MockRewardsDistributor");
        const rewardToken = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        const factory = await ethers.deployContract("RewardsDistributorFactory", [
            await implementation.getAddress(),
            await stakingManager.getAddress(),
            rootPublisher.address,
            await rewardToken.getAddress(),
        ]);

        return {
            owner,
            rootPublisher,
            newRootPublisher,
            resolver,
            other,
            stakingManager,
            implementation,
            rewardToken,
            factory,
        };
    }

    it("creates and initializes a clone for an eligible resolver", async function () {
        const { resolver, rootPublisher, rewardToken, stakingManager, factory } =
            await deployFixture();
        await stakingManager.setResolver(resolver.address, true);

        await expect((factory.connect(resolver) as any).createDistributor(REWARD_RATE))
            .to.emit(factory, "DistributorCreated")
            .withArgs(
                resolver.address,
                (address: string) => address !== ethers.ZeroAddress,
                rootPublisher.address,
                await rewardToken.getAddress(),
                REWARD_RATE,
            );

        const distributorAddress = await factory.distributorOf(resolver.address);
        expect(distributorAddress).to.not.equal(ethers.ZeroAddress);
        expect(await factory.distributorOf(resolver.address)).to.equal(distributorAddress);
        const distributor = await ethers.getContractAt(
            "MockRewardsDistributor",
            distributorAddress,
        );
        expect(await distributor.resolver()).to.equal(resolver.address);
        expect(await distributor.rootPublisher()).to.equal(rootPublisher.address);
        expect(await distributor.rewardToken()).to.equal(await rewardToken.getAddress());
        expect(await distributor.rewardRate()).to.equal(REWARD_RATE);
        expect(await distributor.initialized()).to.equal(true);
    });

    it("rejects creation by an ineligible resolver and duplicate creation", async function () {
        const { resolver, factory, stakingManager } = await deployFixture();
        await expect(
            (factory.connect(resolver) as any).createDistributor(REWARD_RATE),
        ).to.be.revertedWithCustomError(factory, "NotValidResolver");

        await stakingManager.setResolver(resolver.address, true);
        await (factory.connect(resolver) as any).createDistributor(REWARD_RATE);
        await expect(
            (factory.connect(resolver) as any).createDistributor(REWARD_RATE),
        ).to.be.revertedWithCustomError(factory, "DistributorAlreadyExists");
    });

    it("rejects a zero initial reward rate", async function () {
        const { resolver, factory, stakingManager } = await deployFixture();
        await stakingManager.setResolver(resolver.address, true);

        await expect(
            (factory.connect(resolver) as any).createDistributor(0),
        ).to.be.revertedWithCustomError(factory, "InvalidRewardRate");
    });

    it("uses the latest root publisher for future distributors only", async function () {
        const { resolver, other, rootPublisher, newRootPublisher, stakingManager, factory } =
            await deployFixture();
        await stakingManager.setResolver(resolver.address, true);
        await stakingManager.setResolver(other.address, true);

        await (factory.connect(resolver) as any).createDistributor(REWARD_RATE);
        await expect(factory.setRootPublisher(newRootPublisher.address))
            .to.emit(factory, "RootPublisherUpdated")
            .withArgs(rootPublisher.address, newRootPublisher.address);
        await (factory.connect(other) as any).createDistributor(REWARD_RATE);

        const first = await ethers.getContractAt(
            "MockRewardsDistributor",
            await factory.distributorOf(resolver.address),
        );
        const second = await ethers.getContractAt(
            "MockRewardsDistributor",
            await factory.distributorOf(other.address),
        );
        expect(await first.rootPublisher()).to.equal(rootPublisher.address);
        expect(await second.rootPublisher()).to.equal(newRootPublisher.address);
    });

    it("rejects every invalid constructor address", async function () {
        const { implementation, stakingManager, rootPublisher, rewardToken } =
            await deployFixture();
        const implementationAddress = await implementation.getAddress();
        const stakingManagerAddress = await stakingManager.getAddress();
        const rewardTokenAddress = await rewardToken.getAddress();

        await expect(
            ethers.deployContract("RewardsDistributorFactory", [
                implementationAddress,
                ethers.ZeroAddress,
                rootPublisher.address,
                rewardTokenAddress,
            ]),
        ).to.be.revertedWithCustomError(
            await ethers.getContractFactory("RewardsDistributorFactory"),
            "InvalidAddress",
        );
        await expect(
            ethers.deployContract("RewardsDistributorFactory", [
                implementationAddress,
                stakingManagerAddress,
                ethers.ZeroAddress,
                rewardTokenAddress,
            ]),
        ).to.be.revertedWithCustomError(
            await ethers.getContractFactory("RewardsDistributorFactory"),
            "InvalidAddress",
        );
        await expect(
            ethers.deployContract("RewardsDistributorFactory", [
                implementationAddress,
                stakingManagerAddress,
                rootPublisher.address,
                ethers.ZeroAddress,
            ]),
        ).to.be.revertedWithCustomError(
            await ethers.getContractFactory("RewardsDistributorFactory"),
            "InvalidAddress",
        );
    });

    it("rejects an implementation address without code", async function () {
        const { owner, stakingManager, rootPublisher, rewardToken } = await deployFixture();
        const factoryContract = await ethers.getContractFactory("RewardsDistributorFactory");

        await expect(
            factoryContract.deploy(
                owner.address,
                await stakingManager.getAddress(),
                rootPublisher.address,
                await rewardToken.getAddress(),
            ),
        ).to.be.revertedWithCustomError(factoryContract, "InvalidImplementation");
    });

    it("rejects a zero root publisher update", async function () {
        const { factory } = await deployFixture();
        await expect(factory.setRootPublisher(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            factory,
            "InvalidAddress",
        );
    });

    it("allows only the owner to update the root publisher", async function () {
        const { other, newRootPublisher, factory } = await deployFixture();

        await expect((factory.connect(other) as any).setRootPublisher(newRootPublisher.address))
            .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount")
            .withArgs(other.address);
    });
});
