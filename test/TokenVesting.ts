import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

describe("TokenVesting", function () {
    let tokenVesting: any;
    let mockToken: any;
    let owner: any;
    let nonOwner: any;
    let beneficiaryA: any;
    let beneficiaryB: any;
    let refundAddress: any;

    beforeEach(async function () {
        [owner, nonOwner, beneficiaryA, beneficiaryB, refundAddress] = await ethers.getSigners();

        mockToken = await ethers.deployContract("MockERC20", [
            owner.address,
            ethers.parseEther("1000000"),
        ]);
        await mockToken.waitForDeployment();

        tokenVesting = await ethers.deployContract("TokenVesting", [await mockToken.getAddress()]);
        await tokenVesting.waitForDeployment();

        await mockToken.approve(await tokenVesting.getAddress(), ethers.parseEther("1000000000"));
    });

    describe("Deployment", function () {
        it("Should revert if vesting token is zero address", async function () {
            const tokenVestingFactory = await ethers.getContractFactory("TokenVesting");
            await expect(
                tokenVestingFactory.deploy(ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(tokenVestingFactory, "InvalidToken");
        });
        it("Should deploy with correct vesting token", async function () {
            const storedToken = await tokenVesting.VESTING_TOKEN();
            expect(storedToken).to.equal(await mockToken.getAddress());
        });

        it("Should set the correct owner", async function () {
            const contractOwner = await tokenVesting.owner();
            expect(contractOwner).to.equal(owner.address);
        });

        it("Should have zero total vesting allocation initially", async function () {
            const totalAllocation = await tokenVesting.totalVestingAllocation();
            expect(totalAllocation).to.equal(0n);
        });
    });

    describe("scheduleVesting", function () {
        let amountA: bigint;
        const cliffDurationA = 30 * 24 * 60 * 60;
        const vestingDurationA = 365 * 24 * 60 * 60;

        let amountB: bigint;
        const cliffDurationB = 60 * 24 * 60 * 60;
        const vestingDurationB = 800 * 24 * 60 * 60;

        beforeEach(async function () {
            amountA = ethers.parseEther("1000");
            amountB = ethers.parseEther("1000");
        });

        it("Should create a vesting schedule for beneficiaryA", async function () {
            var currentBlock = await ethers.provider.getBlock("latest");
            var currentTime = currentBlock!.timestamp;
            console.log("timestamp:", currentTime);

            const contractBalanceBefore = await mockToken.balanceOf(
                await tokenVesting.getAddress(),
            );
            const ownerBalanceBefore = await mockToken.balanceOf(owner.address);

            const latestBlock = await ethers.provider.getBlock("latest");
            const expectedStartTime = latestBlock!.timestamp;
            console.log("Expected Start Time:", expectedStartTime);
            await expect(
                tokenVesting.scheduleVesting(
                    beneficiaryA.address,
                    amountA,
                    cliffDurationA,
                    vestingDurationA,
                ),
            )
                .to.emit(tokenVesting, "VestingScheduled")
                .withArgs(
                    beneficiaryA.address,
                    amountA,
                    (startTime: bigint) => {
                        expect(startTime).to.be.closeTo(expectedStartTime, 2);
                        return true;
                    },
                    cliffDurationA,
                    vestingDurationA,
                );
            currentBlock = await ethers.provider.getBlock("latest");
            currentTime = currentBlock!.timestamp;
            console.log("timestamp:", currentTime);

            const scheduleA = await tokenVesting.vestingSchedules(beneficiaryA.address);
            expect(scheduleA.totalAllocation).to.equal(amountA);
            expect(scheduleA.startTime).to.be.closeTo(expectedStartTime, 2);
            expect(scheduleA.cliffDuration).to.equal(cliffDurationA);
            expect(scheduleA.vestingDuration).to.equal(vestingDurationA);
            expect(scheduleA.amountClaimed).to.equal(0);
            expect(scheduleA.revoked).to.equal(false);

            currentBlock = await ethers.provider.getBlock("latest");
            currentTime = currentBlock!.timestamp;
            console.log("timestamp:", currentTime);

            const totalVestingAllocation = await tokenVesting.totalVestingAllocation();
            expect(totalVestingAllocation).to.equal(amountA);

            const contractBalanceAfter = await mockToken.balanceOf(await tokenVesting.getAddress());
            const ownerBalanceAfter = await mockToken.balanceOf(owner.address);
            expect(contractBalanceAfter - contractBalanceBefore).to.equal(amountA);
            expect(ownerBalanceBefore - ownerBalanceAfter).to.equal(amountA);
        });

        it("Should allow multiple beneficiaries", async function () {
            const contractBalanceBefore = await mockToken.balanceOf(
                await tokenVesting.getAddress(),
            );
            const ownerBalanceBefore = await mockToken.balanceOf(owner.address);

            const latestBlock = await ethers.provider.getBlock("latest");
            const expectedStartTime = latestBlock!.timestamp;

            await tokenVesting.scheduleVesting(
                beneficiaryA.address,
                amountA,
                cliffDurationA,
                vestingDurationA,
            );

            const scheduleA = await tokenVesting.vestingSchedules(beneficiaryA.address);
            expect(scheduleA.totalAllocation).to.equal(amountA);
            expect(scheduleA.startTime).to.be.closeTo(expectedStartTime, 2);
            expect(scheduleA.cliffDuration).to.equal(cliffDurationA);
            expect(scheduleA.vestingDuration).to.equal(vestingDurationA);
            expect(scheduleA.amountClaimed).to.equal(0);
            expect(scheduleA.revoked).to.equal(false);

            var totalVestingAllocation = await tokenVesting.totalVestingAllocation();
            expect(totalVestingAllocation).to.equal(amountA);

            var contractBalanceAfter = await mockToken.balanceOf(await tokenVesting.getAddress());
            var ownerBalanceAfter = await mockToken.balanceOf(owner.address);
            expect(contractBalanceAfter - contractBalanceBefore).to.equal(amountA);
            expect(ownerBalanceBefore - ownerBalanceAfter).to.equal(amountA);

            await tokenVesting.scheduleVesting(
                beneficiaryB.address,
                amountB,
                cliffDurationB,
                vestingDurationB,
            );

            const scheduleB = await tokenVesting.vestingSchedules(beneficiaryB.address);
            expect(scheduleB.totalAllocation).to.equal(amountB);
            expect(scheduleB.startTime).to.be.closeTo(expectedStartTime, 2);
            expect(scheduleB.cliffDuration).to.equal(cliffDurationB);
            expect(scheduleB.vestingDuration).to.equal(vestingDurationB);
            expect(scheduleB.amountClaimed).to.equal(0);
            expect(scheduleB.revoked).to.equal(false);

            totalVestingAllocation = await tokenVesting.totalVestingAllocation();
            expect(totalVestingAllocation).to.equal(amountA + amountB);

            contractBalanceAfter = await mockToken.balanceOf(await tokenVesting.getAddress());
            ownerBalanceAfter = await mockToken.balanceOf(owner.address);
            expect(contractBalanceAfter - contractBalanceBefore).to.equal(amountA + amountB);
            expect(ownerBalanceBefore - ownerBalanceAfter).to.equal(amountA + amountB);
        });

        it("Should revert if beneficiary is zero address", async function () {
            await expect(
                tokenVesting.scheduleVesting(
                    ethers.ZeroAddress,
                    amountA,
                    cliffDurationA,
                    vestingDurationA,
                ),
            ).to.be.revertedWithCustomError(tokenVesting, "InvalidBeneficiaryAddress");
        });

        it("Should revert if vestingDuration is zero", async function () {
            await expect(
                tokenVesting.scheduleVesting(beneficiaryA.address, amountA, cliffDurationA, 0),
            ).to.be.revertedWithCustomError(tokenVesting, "InvalidVestingDuration");
        });

        it("Should revert if cliffDuration >= vestingDuration", async function () {
            await expect(
                tokenVesting.scheduleVesting(
                    beneficiaryA.address,
                    amountA,
                    vestingDurationA,
                    vestingDurationA,
                ),
            ).to.be.revertedWithCustomError(tokenVesting, "InvalidCliffDuration");

            await expect(
                tokenVesting.scheduleVesting(
                    beneficiaryA.address,
                    amountA,
                    vestingDurationA + 100,
                    vestingDurationA,
                ),
            ).to.be.revertedWithCustomError(tokenVesting, "InvalidCliffDuration");
        });

        it("Should revert if beneficiary already has a schedule", async function () {
            await tokenVesting.scheduleVesting(
                beneficiaryA.address,
                amountA,
                cliffDurationA,
                vestingDurationA,
            );

            await expect(
                tokenVesting.scheduleVesting(
                    beneficiaryA.address,
                    amountA,
                    cliffDurationA,
                    vestingDurationA,
                ),
            ).to.be.revertedWithCustomError(tokenVesting, "ScheduleAlreadyExists");
        });

        it("Should revert if called by non-owner", async function () {
            await expect(
                tokenVesting
                    .connect(nonOwner)
                    .scheduleVesting(nonOwner.address, amountA, cliffDurationA, vestingDurationA),
            )
                .to.be.revertedWithCustomError(tokenVesting, "OwnableUnauthorizedAccount")
                .withArgs(nonOwner.address);
        });

        it("Should revert if owner has insufficient token balance", async function () {
            const largeAmount = ethers.parseEther("10000000");
            await expect(
                tokenVesting.scheduleVesting(
                    beneficiaryA.address,
                    largeAmount,
                    cliffDurationA,
                    vestingDurationA,
                ),
            ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance");
        });

        it("Should revert if owner hasn't approved enough tokens", async function () {
            await mockToken.approve(await tokenVesting.getAddress(), 0);
            await expect(
                tokenVesting.scheduleVesting(
                    beneficiaryA.address,
                    amountA,
                    cliffDurationA,
                    vestingDurationA,
                ),
            ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientAllowance");
        });
    });

    describe("getVestedAmount", function () {
        beforeEach(async function () {
            await createSchedules();
        });

        it("Should return 0 before cliff", async function () {
            const vestedA = await tokenVesting.getVestedAmount(beneficiaryA.address);
            expect(vestedA).to.equal(0);

            const vestedB = await tokenVesting.getVestedAmount(beneficiaryB.address);
            expect(vestedB).to.equal(0);

            const scheduleA = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const cliffEndA = scheduleA.startTime + scheduleA.cliffDuration;
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEndA)]);
            await ethers.provider.send("evm_mine", []);

            const vestedAfterAdvance = await tokenVesting.getVestedAmount(beneficiaryA.address);
            expect(vestedAfterAdvance).to.equal(0);
        });

        it("Should return partial amount after cliff for schedule A", async function () {
            const scheduleA = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const cliffEndA = scheduleA.startTime + scheduleA.cliffDuration;

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEndA + 1n)]);
            await ethers.provider.send("evm_mine", []);

            const vested = await tokenVesting.getVestedAmount(beneficiaryA.address);

            expect(vested).to.be.greaterThan(0);
            expect(vested).to.be.lessThan(scheduleA.totalAllocation);

            const expected =
                (scheduleA.totalAllocation * 1n) /
                (BigInt(scheduleA.vestingDuration) - BigInt(scheduleA.cliffDuration));
            expect(vested).to.equal(expected);
        });

        it("Should return partial amount immediately for schedule B (cliff = 0)", async function () {
            const scheduleB = await tokenVesting.vestingSchedules(beneficiaryB.address);
            const cliffEndB = scheduleB.startTime + scheduleB.cliffDuration;

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEndB + 1n)]);
            await ethers.provider.send("evm_mine", []);

            const vested = await tokenVesting.getVestedAmount(beneficiaryB.address);

            expect(vested).to.be.greaterThan(0);
            expect(vested).to.be.lessThan(scheduleB.totalAllocation);

            const expected =
                (scheduleB.totalAllocation *
                    (BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp)) -
                        cliffEndB)) /
                (BigInt(scheduleB.vestingDuration) - BigInt(scheduleB.cliffDuration));
            expect(vested).to.equal(expected);
        });

        it("Should return increasing amount over time for schedule A", async function () {
            const scheduleA = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const cliffEndA = scheduleA.startTime + scheduleA.cliffDuration;

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEndA + 100n)]);
            await ethers.provider.send("evm_mine", []);

            const vested1 = await tokenVesting.getVestedAmount(beneficiaryA.address);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEndA + 200n)]);
            await ethers.provider.send("evm_mine", []);

            const vested2 = await tokenVesting.getVestedAmount(beneficiaryA.address);
            expect(vested2).to.be.greaterThan(vested1);
            expect(vested2).to.be.lessThan(scheduleA.totalAllocation);
        });

        it("Should return increasing amount over time for schedule B", async function () {
            const scheduleB = await tokenVesting.vestingSchedules(beneficiaryB.address);
            const cliffEndB = scheduleB.startTime + scheduleB.cliffDuration;

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEndB + 100n)]);
            await ethers.provider.send("evm_mine", []);

            const vested1 = await tokenVesting.getVestedAmount(beneficiaryB.address);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEndB + 200n)]);
            await ethers.provider.send("evm_mine", []);

            const vested2 = await tokenVesting.getVestedAmount(beneficiaryB.address);
            expect(vested2).to.be.greaterThan(vested1);
            expect(vested2).to.be.lessThan(scheduleB.totalAllocation);
        });

        it("Should return full amount after vesting period for schedule A", async function () {
            const scheduleA = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const vestingEndA = scheduleA.startTime + scheduleA.vestingDuration;

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(vestingEndA)]);
            await ethers.provider.send("evm_mine", []);

            const vested = await tokenVesting.getVestedAmount(beneficiaryA.address);
            expect(vested).to.equal(scheduleA.totalAllocation);
        });

        it("Should return full amount after vesting period for schedule B", async function () {
            const scheduleB = await tokenVesting.vestingSchedules(beneficiaryB.address);
            const vestingEndB = scheduleB.startTime + scheduleB.vestingDuration;

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(vestingEndB)]);
            await ethers.provider.send("evm_mine", []);

            const vested = await tokenVesting.getVestedAmount(beneficiaryB.address);
            expect(vested).to.equal(scheduleB.totalAllocation);
        });

        it("Should return 0 if beneficiary does not exist", async function () {
            const nonExistentBeneficiary = nonOwner.address;
            const vested = await tokenVesting.getVestedAmount(nonExistentBeneficiary);
            expect(vested).to.equal(0);
        });

        it("Should revoke scheduleA before cliff with zero vested tokens", async function () {
            const scheduleBefore = await tokenVesting.vestingSchedules(beneficiaryA.address);

            const refundBalanceBefore = await mockToken.balanceOf(refundAddress.address);

            await tokenVesting.revoke(beneficiaryA.address, refundAddress.address);

            const scheduleAfter = await tokenVesting.vestingSchedules(beneficiaryA.address);

            expect(scheduleAfter.revoked).to.be.true;
            expect(scheduleAfter.totalAllocation).to.equal(0n);
            expect(await tokenVesting.getVestedAmount(beneficiaryA.address)).to.equal(0n);

            expect(await mockToken.balanceOf(refundAddress.address)).to.equal(
                refundBalanceBefore + scheduleBefore.totalAllocation,
            );
        });

        it("Should preserve vested tokens when scheduleB is revoked", async function () {
            const scheduleBefore = await tokenVesting.vestingSchedules(beneficiaryB.address);

            const refundBalanceBefore = await mockToken.balanceOf(refundAddress.address);

            await tokenVesting.revoke(beneficiaryB.address, refundAddress.address);

            const scheduleAfter = await tokenVesting.vestingSchedules(beneficiaryB.address);

            expect(scheduleAfter.revoked).to.be.true;
            expect(scheduleAfter.totalAllocation).to.be.greaterThan(0n);
            expect(scheduleAfter.totalAllocation).to.be.lessThan(scheduleBefore.totalAllocation);

            expect(await tokenVesting.getVestedAmount(beneficiaryB.address)).to.equal(
                scheduleAfter.totalAllocation,
            );

            const expectedRefund = scheduleBefore.totalAllocation - scheduleAfter.totalAllocation;

            expect(await mockToken.balanceOf(refundAddress.address)).to.equal(
                refundBalanceBefore + expectedRefund,
            );
        });
    });

    describe("claim", function () {
        beforeEach(async function () {
            await createSchedules();
        });

        it("Should revert when there is no claimable amount", async function () {
            await expect(tokenVesting.connect(beneficiaryA).claim()).to.be.revertedWithCustomError(
                tokenVesting,
                "NotClaimable",
            );
        });

        it("Should claim vested tokens and update the schedule", async function () {
            const scheduleBefore = await tokenVesting.vestingSchedules(beneficiaryA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(scheduleBefore.startTime + scheduleBefore.cliffDuration + 1000n),
            ]);
            await ethers.provider.send("evm_mine", []);

            const balanceBefore = await mockToken.balanceOf(beneficiaryA.address);

            await expect(tokenVesting.connect(beneficiaryA).claim())
                .to.emit(tokenVesting, "TokensClaimed")
                .withArgs(beneficiaryA.address, (amount: bigint) => amount > 0n);

            const scheduleAfter = await tokenVesting.vestingSchedules(beneficiaryA.address);
            expect(scheduleAfter.amountClaimed).to.be.greaterThan(0n);
            expect(await mockToken.balanceOf(beneficiaryA.address)).to.equal(
                balanceBefore + scheduleAfter.amountClaimed,
            );
        });

        it("Should claim the full remaining amount after vesting duration", async function () {
            const schedule = await tokenVesting.vestingSchedules(beneficiaryA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(schedule.startTime + schedule.vestingDuration + 1n),
            ]);
            await ethers.provider.send("evm_mine", []);

            const claimable = await tokenVesting.getClaimableAmount(beneficiaryA.address);
            const balanceBefore = await mockToken.balanceOf(beneficiaryA.address);

            await expect(tokenVesting.connect(beneficiaryA).claim())
                .to.emit(tokenVesting, "TokensClaimed")
                .withArgs(beneficiaryA.address, claimable);

            expect(claimable).to.equal(schedule.totalAllocation);
            const scheduleAfter = await tokenVesting.vestingSchedules(beneficiaryA.address);
            expect(scheduleAfter.amountClaimed).to.equal(schedule.totalAllocation);
            expect(await mockToken.balanceOf(beneficiaryA.address)).to.equal(
                balanceBefore + schedule.totalAllocation,
            );
        });

        it("Should revert when claiming twice without new vested tokens", async function () {
            const schedule = await tokenVesting.vestingSchedules(beneficiaryA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(schedule.startTime + schedule.vestingDuration + 1n),
            ]);
            await ethers.provider.send("evm_mine", []);

            await tokenVesting.connect(beneficiaryA).claim();
            await expect(tokenVesting.connect(beneficiaryA).claim()).to.be.revertedWithCustomError(
                tokenVesting,
                "NotClaimable",
            );
        });

        it("Should revert when called by a non-beneficiary", async function () {
            await expect(tokenVesting.connect(nonOwner).claim()).to.be.revertedWithCustomError(
                tokenVesting,
                "NotClaimable",
            );
        });
    });

    describe("vestingSchedulesOf", function () {
        beforeEach(async function () {
            await createSchedules();
        });

        it("Should return an existing vesting schedule", async function () {
            const schedule = await tokenVesting.vestingSchedulesOf(beneficiaryA.address);

            expect(schedule.totalAllocation).to.equal(ethers.parseEther("1000"));
            expect(schedule.startTime).to.be.greaterThan(0n);
            expect(schedule.cliffDuration).to.equal(30 * 24 * 60 * 60);
            expect(schedule.vestingDuration).to.equal(365 * 24 * 60 * 60);
            expect(schedule.amountClaimed).to.equal(0n);
            expect(schedule.revoked).to.be.false;
        });

        it("Should return an empty schedule for a nonexistent beneficiary", async function () {
            const schedule = await tokenVesting.vestingSchedulesOf(nonOwner.address);

            expect(schedule.totalAllocation).to.equal(0n);
            expect(schedule.startTime).to.equal(0n);
            expect(schedule.cliffDuration).to.equal(0n);
            expect(schedule.vestingDuration).to.equal(0n);
            expect(schedule.amountClaimed).to.equal(0n);
            expect(schedule.revoked).to.be.false;
        });
    });

    describe("getClaimableAmount", function () {
        beforeEach(async function () {
            await createSchedules();
        });

        it("Should return 0 for a nonexistent schedule", async function () {
            expect(await tokenVesting.getClaimableAmount(nonOwner.address)).to.equal(0n);
        });

        it("Should return 0 for a schedule revoked before its cliff", async function () {
            await tokenVesting.revoke(beneficiaryA.address, refundAddress.address);

            expect(await tokenVesting.getClaimableAmount(beneficiaryA.address)).to.equal(0n);
        });

        it("Should return the vested unclaimed amount during vesting", async function () {
            const schedule = await tokenVesting.vestingSchedules(beneficiaryB.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(schedule.startTime + 1000n),
            ]);
            await ethers.provider.send("evm_mine", []);

            const vested = await tokenVesting.getVestedAmount(beneficiaryB.address);
            const claimable = await tokenVesting.getClaimableAmount(beneficiaryB.address);

            expect(claimable).to.equal(vested);
            expect(claimable).to.be.greaterThan(0n);
            expect(claimable).to.be.lessThan(schedule.totalAllocation);
        });
    });

    describe("revoke", function () {
        beforeEach(async function () {
            await createSchedules();
        });

        it("Should revert if schedule does not exist", async function () {
            await expect(
                tokenVesting.revoke(nonOwner.address, refundAddress.address),
            ).to.be.revertedWithCustomError(tokenVesting, "ScheduleDoesNotExist");
        });

        it("Should revert if schedule is revoked twice", async function () {
            await tokenVesting.revoke(beneficiaryA.address, refundAddress.address);
            await expect(
                tokenVesting.revoke(beneficiaryA.address, refundAddress.address),
            ).to.be.revertedWithCustomError(tokenVesting, "ScheduleAlreadyRevoked");
        });

        it("Should revoke normally, emit event, update state, and refund unvested tokens", async function () {
            const scheduleBefore = await tokenVesting.vestingSchedules(beneficiaryA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(scheduleBefore.startTime + scheduleBefore.cliffDuration + 1000n),
            ]);
            await ethers.provider.send("evm_mine", []);

            const revokeTx = tokenVesting.revoke(beneficiaryA.address, refundAddress.address);
            const receipt = await (await revokeTx).wait();
            const block = await ethers.provider.getBlock(receipt!.blockNumber);
            const vested =
                (scheduleBefore.totalAllocation *
                    (BigInt(block!.timestamp) -
                        (scheduleBefore.startTime + scheduleBefore.cliffDuration))) /
                (BigInt(scheduleBefore.vestingDuration) - BigInt(scheduleBefore.cliffDuration));
            const unvested = scheduleBefore.totalAllocation - vested;

            await expect(revokeTx)
                .to.emit(tokenVesting, "ScheduleRevoked")
                .withArgs(beneficiaryA.address, refundAddress.address, unvested);

            const scheduleAfter = await tokenVesting.vestingSchedules(beneficiaryA.address);
            expect(scheduleAfter.revoked).to.be.true;
            expect(scheduleAfter.totalAllocation).to.equal(vested);
            expect(await mockToken.balanceOf(refundAddress.address)).to.equal(unvested);
        });

        it("Should not increase vested amount after revocation", async function () {
            const schedule = await tokenVesting.vestingSchedules(beneficiaryA.address);
            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(schedule.startTime + schedule.cliffDuration + 1000n),
            ]);
            await ethers.provider.send("evm_mine", []);

            await tokenVesting.revoke(beneficiaryA.address, refundAddress.address);
            const vestedAfterRevoke = await tokenVesting.getVestedAmount(beneficiaryA.address);

            await ethers.provider.send("evm_setNextBlockTimestamp", [
                Number(schedule.startTime + schedule.cliffDuration + 2000n),
            ]);
            await ethers.provider.send("evm_mine", []);

            const vestedAfterTimeAdvance = await tokenVesting.getVestedAmount(beneficiaryA.address);
            expect(vestedAfterTimeAdvance).to.equal(vestedAfterRevoke);
        });
    });

    describe("Integration: Full lifecycle", function () {
        it("Should complete full vesting lifecycle: schedule -> claim -> revoke", async function () {
            const amount = ethers.parseEther("1000");
            const cliff = 30 * 24 * 60 * 60;
            const vesting = 365 * 24 * 60 * 60;

            const contractBalanceBefore = await mockToken.balanceOf(
                await tokenVesting.getAddress(),
            );
            await tokenVesting.scheduleVesting(beneficiaryA.address, amount, cliff, vesting);
            const contractBalanceAfter = await mockToken.balanceOf(await tokenVesting.getAddress());
            expect(contractBalanceAfter - contractBalanceBefore).to.equal(amount);

            let schedule = await tokenVesting.vestingSchedules(beneficiaryA.address);
            expect(schedule.totalAllocation).to.equal(amount);
            expect(schedule.revoked).to.be.false;

            const cliffEnd = schedule.startTime + BigInt(cliff);
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEnd + 1000n)]);
            await ethers.provider.send("evm_mine", []);

            const balanceBefore = await mockToken.balanceOf(beneficiaryA.address);
            await tokenVesting.connect(beneficiaryA).claim();
            const balanceAfter = await mockToken.balanceOf(beneficiaryA.address);
            const claimedAmount = balanceAfter - balanceBefore;
            expect(claimedAmount).to.be.greaterThan(0);
            expect(claimedAmount).to.be.lessThan(amount);

            schedule = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const vestingEnd = schedule.startTime + BigInt(vesting);
            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(vestingEnd + 1n)]);
            await ethers.provider.send("evm_mine", []);

            const balanceBeforeFull = await mockToken.balanceOf(beneficiaryA.address);
            const claimable = await tokenVesting.getClaimableAmount(beneficiaryA.address);
            await tokenVesting.connect(beneficiaryA).claim();
            const balanceAfterFull = await mockToken.balanceOf(beneficiaryA.address);
            expect(balanceAfterFull - balanceBeforeFull).to.equal(claimable);

            schedule = await tokenVesting.vestingSchedules(beneficiaryA.address);
            expect(schedule.amountClaimed).to.equal(amount);
            expect(schedule.totalAllocation).to.equal(amount);
            expect(await tokenVesting.getClaimableAmount(beneficiaryA.address)).to.equal(0);

            const contractBalanceFinal = await mockToken.balanceOf(await tokenVesting.getAddress());
            expect(contractBalanceFinal).to.equal(0);
        });

        it("Should handle revocation during vesting period", async function () {
            const amount = ethers.parseEther("1000");
            const cliff = 30 * 24 * 60 * 60;
            const vesting = 365 * 24 * 60 * 60;

            await tokenVesting.scheduleVesting(beneficiaryA.address, amount, cliff, vesting);

            let schedule = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const cliffEnd = schedule.startTime + BigInt(cliff);

            await ethers.provider.send("evm_setNextBlockTimestamp", [Number(cliffEnd + 1000n)]);
            await ethers.provider.send("evm_mine", []);

            const balanceBeforeClaim = await mockToken.balanceOf(beneficiaryA.address);
            await tokenVesting.connect(beneficiaryA).claim();
            const balanceAfterClaim = await mockToken.balanceOf(beneficiaryA.address);
            const claimedAmount = balanceAfterClaim - balanceBeforeClaim;
            expect(claimedAmount).to.be.greaterThan(0);

            const scheduleBeforeRevoke = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const contractBalanceBefore = await mockToken.balanceOf(
                await tokenVesting.getAddress(),
            );
            const refundBalanceBefore = await mockToken.balanceOf(refundAddress.address);

            await tokenVesting.revoke(beneficiaryA.address, refundAddress.address);

            const scheduleAfterRevoke = await tokenVesting.vestingSchedules(beneficiaryA.address);
            const refundBalanceAfter = await mockToken.balanceOf(refundAddress.address);
            const contractBalanceAfter = await mockToken.balanceOf(await tokenVesting.getAddress());

            expect(scheduleAfterRevoke.revoked).to.be.true;

            const expectedRefund =
                scheduleBeforeRevoke.totalAllocation - scheduleAfterRevoke.totalAllocation;
            expect(refundBalanceAfter - refundBalanceBefore).to.equal(expectedRefund);
            expect(contractBalanceBefore - contractBalanceAfter).to.equal(expectedRefund);

            const balanceAfterRevoke = await mockToken.balanceOf(beneficiaryA.address);
            expect(balanceAfterRevoke - balanceAfterClaim).to.equal(0);
        });
    });

    async function createSchedules() {
        const amountA = ethers.parseEther("1000");
        const cliffA = 30 * 24 * 60 * 60;
        const vestingA = 365 * 24 * 60 * 60;

        await tokenVesting.scheduleVesting(beneficiaryA.address, amountA, cliffA, vestingA);

        const amountB = ethers.parseEther("2000");
        const cliffB = 0;
        const vestingB = 180 * 24 * 60 * 60;

        await tokenVesting.scheduleVesting(beneficiaryB.address, amountB, cliffB, vestingB);
    }
});
