import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();
const REWARD_RATE = 50_000_000_000_000_000n;

function hashPair(left: string, right: string): string {
    return BigInt(left) < BigInt(right)
        ? ethers.keccak256(ethers.concat([left, right]))
        : ethers.keccak256(ethers.concat([right, left]));
}

describe("RewardsDistributor", function () {
    async function deployFixture() {
        const [owner, updater, resolver, alice, bob] = await ethers.getSigners();
        const token: any = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        const implementation: any = await ethers.deployContract("RewardsDistributor");
        const cloneFactory: any = await ethers.deployContract("MockCloneFactory");
        const { distributor } = await cloneAndInitialize(
            cloneFactory,
            implementation,
            resolver.address,
            updater.address,
            await token.getAddress(),
        );
        await token.transfer(resolver.address, ethers.parseEther("1000"));

        return { owner, updater, resolver, alice, bob, token, distributor };
    }

    async function cloneAndInitialize(
        cloneFactory: any,
        implementation: any,
        resolver: string,
        updater: string,
        token: string,
        rewardRate = REWARD_RATE,
    ) {
        const tx = await cloneFactory.cloneAndInitialize(
            await implementation.getAddress(),
            resolver,
            updater,
            token,
            rewardRate,
        );
        const receipt = await tx.wait();
        const event = receipt!.logs
            .map((log: any) => {
                try {
                    return cloneFactory.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find((parsed: any) => parsed?.name === "CloneCreated");
        return {
            distributor: (await ethers.getContractAt(
                "RewardsDistributor",
                event!.args.clone,
            )) as any,
            receipt,
        };
    }

    function allocationLeaf(
        distributorAddress: string,
        chainId: bigint,
        epochId: bigint,
        account: string,
        amount: bigint,
    ): string {
        return ethers.solidityPackedKeccak256(
            ["uint256", "address", "uint256", "address", "uint256"],
            [chainId, distributorAddress, epochId, account, amount],
        );
    }

    it("emits every lifecycle event and supports permissionless claims", async function () {
        const { updater, resolver, alice, bob, token, distributor } = await deployFixture();
        const epochId = 1n;
        const aliceReward = ethers.parseEther("40");
        const bobReward = ethers.parseEther("60");
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const aliceLeaf = allocationLeaf(
            await distributor.getAddress(),
            chainId,
            epochId,
            alice.address,
            aliceReward,
        );
        const bobLeaf = allocationLeaf(
            await distributor.getAddress(),
            chainId,
            epochId,
            bob.address,
            bobReward,
        );
        expect(await distributor.leaf(epochId, alice.address, aliceReward)).to.equal(aliceLeaf);
        expect(await distributor.leaf(epochId, bob.address, bobReward)).to.equal(bobLeaf);
        const root = hashPair(aliceLeaf, bobLeaf);

        await expect(
            distributor.connect(updater).submitRoot(epochId, root, aliceReward + bobReward),
        )
            .to.emit(distributor, "RootSubmitted")
            .withArgs(epochId, root, aliceReward + bobReward);
        expect((await distributor.epochs(epochId)).status).to.equal(1n);

        await expect(
            distributor.connect(alice).claim(epochId, alice.address, aliceReward, [bobLeaf]),
        ).to.be.revertedWithCustomError(distributor, "EpochNotClaimable");
        await expect(
            distributor.connect(resolver).confirmRoot(epochId),
        ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

        await token
            .connect(resolver)
            .approve(await distributor.getAddress(), aliceReward + bobReward);
        await expect(distributor.connect(resolver).confirmRoot(epochId))
            .to.emit(distributor, "RootConfirmed")
            .withArgs(epochId, resolver.address, aliceReward + bobReward);
        expect((await distributor.epochs(epochId)).status).to.equal(2n);
        expect(await token.balanceOf(await distributor.getAddress())).to.equal(
            aliceReward + bobReward,
        );

        await expect(
            distributor.connect(bob).claim(epochId, alice.address, aliceReward, []),
        ).to.be.revertedWithCustomError(distributor, "InvalidProof");
        await expect(distributor.connect(bob).claim(epochId, alice.address, aliceReward, [bobLeaf]))
            .to.emit(distributor, "RewardClaimed")
            .withArgs(epochId, alice.address, aliceReward);
        expect(await distributor.claimed(epochId, alice.address)).to.equal(true);
        expect(await token.balanceOf(alice.address)).to.equal(aliceReward);
        expect(await token.balanceOf(bob.address)).to.equal(0n);
        await expect(
            distributor.connect(bob).claim(epochId, alice.address, aliceReward, [bobLeaf]),
        ).to.be.revertedWithCustomError(distributor, "AlreadyClaimed");
    });

    it("returns different leaves when any allocation field differs", async function () {
        const { owner, alice, bob, distributor } = await deployFixture();
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const distributorAddress = await distributor.getAddress();
        const epochId = 10n;
        const amount = 1n;
        const leaf = await distributor.leaf(epochId, alice.address, amount);

        expect(await distributor.leaf(epochId + 1n, alice.address, amount)).to.not.equal(leaf);
        expect(await distributor.leaf(epochId, bob.address, amount)).to.not.equal(leaf);
        expect(await distributor.leaf(epochId, alice.address, amount + 1n)).to.not.equal(leaf);
        expect(
            allocationLeaf(distributorAddress, chainId + 1n, epochId, alice.address, amount),
        ).to.not.equal(leaf);
        expect(allocationLeaf(owner.address, chainId, epochId, alice.address, amount)).to.not.equal(
            leaf,
        );
    });

    it("does not allow claims or confirmations for an epoch that was never submitted", async function () {
        const { resolver, alice, distributor } = await deployFixture();
        const epochId = 11n;

        await expect(
            distributor.claim(epochId, alice.address, 1n, []),
        ).to.be.revertedWithCustomError(distributor, "EpochNotClaimable");
        await expect(
            distributor.connect(resolver).confirmRoot(epochId),
        ).to.be.revertedWithCustomError(distributor, "EpochNotPending");
    });

    it("does not allow claims for a submitted epoch before it is confirmed", async function () {
        const { updater, alice, distributor } = await deployFixture();
        const epochId = 12n;
        const amount = 1n;
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const root = allocationLeaf(
            await distributor.getAddress(),
            chainId,
            epochId,
            alice.address,
            amount,
        );
        await distributor.connect(updater).submitRoot(epochId, root, amount);

        await expect(
            distributor.claim(epochId, alice.address, amount, []),
        ).to.be.revertedWithCustomError(distributor, "EpochNotClaimable");
    });

    it("rejects proofs built with incorrect leaf domain fields", async function () {
        const { owner, updater, resolver, alice, bob, token, distributor } = await deployFixture();
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const distributorAddress = await distributor.getAddress();
        const amount = 1n;
        const firstEpochId = 20n;
        const invalidRoots = [
            allocationLeaf(distributorAddress, chainId + 1n, firstEpochId, alice.address, amount),
            allocationLeaf(owner.address, chainId, firstEpochId + 1n, alice.address, amount),
            allocationLeaf(distributorAddress, chainId, firstEpochId + 3n, alice.address, amount),
            allocationLeaf(distributorAddress, chainId, firstEpochId + 3n, bob.address, amount),
            allocationLeaf(
                distributorAddress,
                chainId,
                firstEpochId + 4n,
                alice.address,
                amount + 1n,
            ),
        ];

        await token.connect(resolver).approve(distributorAddress, BigInt(invalidRoots.length));
        for (let index = 0; index < invalidRoots.length; index++) {
            const epochId = firstEpochId + BigInt(index);
            await distributor.connect(updater).submitRoot(epochId, invalidRoots[index], amount);
            await distributor.connect(resolver).confirmRoot(epochId);
            await expect(
                distributor.claim(epochId, alice.address, amount, []),
            ).to.be.revertedWithCustomError(distributor, "InvalidProof");
        }
    });

    it("only accepts roots from the configured updater and a valid proof from the claimant", async function () {
        const { resolver, alice, token, distributor } = await deployFixture();
        const epochId = 2n;
        const amount = ethers.parseEther("10");
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const root = allocationLeaf(
            await distributor.getAddress(),
            chainId,
            epochId,
            alice.address,
            amount,
        );

        await expect(
            distributor.connect(resolver).submitRoot(epochId, root, amount),
        ).to.be.revertedWithCustomError(distributor, "Unauthorized");
        await expect(
            distributor.connect(resolver).confirmRoot(epochId),
        ).to.be.revertedWithCustomError(distributor, "EpochNotPending");
    });

    it("rejects invalid initialization and emits DistributorInitialized for a valid clone", async function () {
        const [owner, updater, resolver] = await ethers.getSigners();
        const token: any = await ethers.deployContract("MockERC20", [owner.address, 1n]);
        const implementation: any = await ethers.deployContract("RewardsDistributor");
        const cloneFactory: any = await ethers.deployContract("MockCloneFactory");

        await expect(
            cloneFactory.cloneAndInitialize(
                await implementation.getAddress(),
                ethers.ZeroAddress,
                updater.address,
                await token.getAddress(),
                REWARD_RATE,
            ),
        ).to.be.revertedWithCustomError(implementation, "InvalidAddress");
        await expect(
            cloneFactory.cloneAndInitialize(
                await implementation.getAddress(),
                resolver.address,
                ethers.ZeroAddress,
                await token.getAddress(),
                REWARD_RATE,
            ),
        ).to.be.revertedWithCustomError(implementation, "InvalidAddress");
        await expect(
            cloneFactory.cloneAndInitialize(
                await implementation.getAddress(),
                resolver.address,
                updater.address,
                ethers.ZeroAddress,
                REWARD_RATE,
            ),
        ).to.be.revertedWithCustomError(implementation, "InvalidAddress");
        await expect(
            cloneFactory.cloneAndInitialize(
                await implementation.getAddress(),
                resolver.address,
                updater.address,
                await token.getAddress(),
                0n,
            ),
        ).to.be.revertedWithCustomError(implementation, "InvalidRewardRate");

        const { distributor, receipt } = await cloneAndInitialize(
            cloneFactory,
            implementation,
            resolver.address,
            updater.address,
            await token.getAddress(),
            REWARD_RATE,
        );
        const initializedEvent = receipt!.logs
            .map((log: any) => {
                try {
                    return distributor.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find((parsed: any) => parsed?.name === "DistributorInitialized");
        expect(initializedEvent!.args).to.deep.equal([
            resolver.address,
            updater.address,
            await token.getAddress(),
            REWARD_RATE,
        ]);
        expect(await distributor.resolver()).to.equal(resolver.address);
        expect(await distributor.rewardsUpdater()).to.equal(updater.address);
        expect(await distributor.rewardToken()).to.equal(await token.getAddress());
        expect(await distributor.rewardRate()).to.equal(REWARD_RATE);
    });

    it("rejects invalid epochs and duplicate roots", async function () {
        const { updater, resolver, alice, distributor } = await deployFixture();
        const epochId = 3n;
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const root = allocationLeaf(
            await distributor.getAddress(),
            chainId,
            epochId,
            alice.address,
            1n,
        );

        await expect(
            distributor.connect(updater).submitRoot(0n, root, 1n),
        ).to.be.revertedWithCustomError(distributor, "InvalidEpochId");
        await expect(
            distributor.connect(updater).submitRoot(epochId, ethers.ZeroHash, 1n),
        ).to.be.revertedWithCustomError(distributor, "InvalidMerkleRoot");
        await expect(
            distributor.connect(updater).submitRoot(epochId, root, 0n),
        ).to.be.revertedWithCustomError(distributor, "InvalidTotalReward");
        await distributor.connect(updater).submitRoot(epochId, root, 1n);
        await expect(
            distributor.connect(updater).submitRoot(epochId, root, 1n),
        ).to.be.revertedWithCustomError(distributor, "EpochAlreadyExists");
        await expect(
            distributor.connect(resolver).confirmRoot(epochId + 1n),
        ).to.be.revertedWithCustomError(distributor, "EpochNotPending");
    });

    it("rejects unauthorized confirmation", async function () {
        const { updater, alice, bob, distributor } = await deployFixture();
        const epochId = 4n;
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const root = allocationLeaf(
            await distributor.getAddress(),
            chainId,
            epochId,
            alice.address,
            1n,
        );
        await distributor.connect(updater).submitRoot(epochId, root, 1n);

        await expect(distributor.connect(bob).confirmRoot(epochId)).to.be.revertedWithCustomError(
            distributor,
            "Unauthorized",
        );
    });

    it("allows only the resolver to update or disable the reward rate", async function () {
        const { resolver, bob, distributor } = await deployFixture();
        const newRewardRate = 75_000_000_000_000_000n;

        await expect(
            distributor.connect(bob).setRewardRate(newRewardRate),
        ).to.be.revertedWithCustomError(distributor, "Unauthorized");
        await expect(distributor.connect(resolver).setRewardRate(0n))
            .to.emit(distributor, "RewardRateUpdated")
            .withArgs(REWARD_RATE, 0n);
        expect(await distributor.rewardRate()).to.equal(0n);
        await expect(distributor.connect(resolver).setRewardRate(newRewardRate))
            .to.emit(distributor, "RewardRateUpdated")
            .withArgs(0n, newRewardRate);
        expect(await distributor.rewardRate()).to.equal(newRewardRate);
    });
});
