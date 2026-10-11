# Resolver Staking, Delegation, and Vesting Protocol

This Hardhat 3 project implements the core contracts for a resolver network: resolver self-staking, user delegation, protocol-funded delegation rewards, resolver-operated delegation incentives, and token vesting. The contracts target Solidity `0.8.28` and use OpenZeppelin's `Ownable`, `Initializable`, `ReentrancyGuard`, and `SafeERC20` utilities.

## Architecture

Core contracts:

- `contracts/StakingManager.sol` manages resolver self-stake, the unstaking delay, and resolver-authorized operators.
- `contracts/DelegationManager.sol` custody-holds delegated staking tokens, attributes them to one resolver per delegator, enforces a freezing period, and distributes protocol-funded rewards over fixed reward periods.
- `contracts/RewardsDistributor.sol` is a clone implementation for a Resolver's optional, Merkle-proof-based delegation-incentive program. The Resolver funds each claimable epoch.
- `contracts/RewardsDistributorFactory.sol` lets an eligible Resolver create at most one `RewardsDistributor` clone and configures the implementation, reward token, and root publisher used by newly created clones.
- `contracts/TokenVesting.sol` creates one linear vesting schedule per beneficiary, supports claims, and allows the owner to revoke the unvested portion.
- `contracts/interface/IStakingManager.sol` exposes the resolver and operator eligibility checks; `contracts/interface/IRewardsDistributor.sol` exposes clone initialization.
- `contracts/mocks/` contains test and demonstration-only token, staking-manager, clone-factory, and distributor implementations. They are not production token or resolver-registry implementations.

## Protocol Lifecycle

### Resolver self-staking

1. A resolver approves `StakingManager` to spend `STAKING_TOKEN`.
2. The resolver calls `stake(amount)`. After the call, its active self-stake must meet `minSelfStake`.
3. `isValidResolver(resolver)` returns `true` while the resolver meets that threshold.
4. The resolver calls `unstake(amount)` to move active stake into a locked balance. Only one locked withdrawal may exist at a time: while `amountLocked` is non-zero, every additional `unstake` reverts with `LockedExist`.
5. Once `thawingPeriod` has elapsed, the resolver calls `withdrawStaked(to)` to withdraw the full locked balance. Reaching the unlock time alone does not permit another `unstake`; the resolver must first call `withdrawStaked`, which clears the locked balance.

### Delegation and protocol rewards

1. A user approves `DelegationManager` to spend `STAKING_TOKEN`.
2. The user calls `delegate(resolver, amount)` for a resolver that is eligible at that time. Each user may delegate to only one resolver, but may increase the amount delegated to that resolver at any time. Adding stake to the same Resolver resets the freezing-period start for the entire aggregated delegation.
3. `freezingPeriod` restricts only moves out of the current Resolver: after the latest `delegate` or `redelegate`, the user must wait for the period to call `undelegate(amount)`, `redelegate(newResolver)`, or `exit()`. It does not restrict an initial delegation or adding stake to the same Resolver. Redelegation moves the full position and starts a new freezing period.

`freezingPeriod` 约束的是资金离开当前 Resolver 的动作（撤回、转委托），不约束继续向当前 Resolver 委托/加仓。

4. Protocol governance first transfers sufficient `REWARD_TOKEN` to `DelegationManager`, then calls `notifyRewardAmount(reward)` to start or replace a protocol reward period. `notifyRewardAmount` does not pull tokens from the owner.
5. Delegators call `claimReward()` to receive accrued protocol rewards, or `exit()` to withdraw their full delegation and claim those rewards in one transaction.

### Optional Resolver delegation incentives

`RewardsDistributor` and `RewardsDistributorFactory` implement a separate reward system from `DelegationManager`. An eligible Resolver may, but is not required to, call `createDistributor(rewardRate)` on `RewardsDistributorFactory`. This creates one dedicated distributor clone for that Resolver; its stated APR is an input to the off-chain reward calculation and applies from the next calendar month's reward period after an update.

For each off-chain-defined epoch:

1. The configured `rootPublisher` submits a Merkle root and the total allocation to the Resolver's distributor.
2. The Resolver approves the distributor and calls `confirmRoot(epochId)`, transferring the exact epoch amount from the Resolver to its distributor. Until this confirmation, the epoch cannot be claimed.
3. Anyone may submit a valid proof through `claim`, but the distributor pays the allocation encoded in the leaf to its named delegator.

These incentives are funded by each Resolver, not by `DelegationManager` or protocol governance. They can be used to attract delegation. The protocol contracts do not calculate a Resolver's aggregate weight or allocate order flow: operational systems may use a Resolver's self-stake together with delegation attributed to it as an off-chain weight for order-flow allocation.

### Token vesting

1. The owner approves `TokenVesting` to spend `VESTING_TOKEN`.
2. The owner calls `scheduleVesting(beneficiary, allocation, cliff, duration)`, which transfers the allocation into the contract.
3. No tokens vest during the cliff. The allocation then vests linearly until `startTime + duration`.
4. The beneficiary calls `claim()` to receive vested, unclaimed tokens.
5. The owner may call `revoke(beneficiary, refundAddress)`. The schedule's vested amount is fixed at revocation; unvested tokens are refunded and the vested balance remains claimable by the beneficiary.

## Eligibility and Governance Model

`StakingManager` determines resolver eligibility exclusively from active self-stake. `DelegationManager` checks that eligibility only when a user delegates or redelegates; it does not guarantee that a resolver remains eligible throughout an existing delegation.

**Delegators are responsible for monitoring the self-stake and eligibility of their chosen resolver.** A resolver can unstake and become ineligible while it still has attributed delegations. Delegators can undelegate or redelegate subject to the protocol's freezing-period rules.

### Resolver eligibility and existing delegations

Resolver eligibility is checked when a user creates a delegation and when the user selects the destination of a redelegation. It is not continuously enforced for an existing delegation. Therefore, if a resolver's active self-stake falls below `minSelfStake`, its existing delegations remain recorded and continue to be custody-held by `DelegationManager`; they are not automatically withdrawn or reassigned.

The delegator may move an existing position only after the delegation's own `freezingPeriod` has elapsed. At that point, the delegator can redelegate the full position to a currently eligible resolver, or undelegate/`exit()` to recover the staking tokens. This waiting period is independent of the resolver's `thawingPeriod`: the latter controls the resolver's locked self-stake withdrawal, not a delegator's ability to move their position. The real-contract integration tests in `test/DelegationStakingIntegration.ts` lock in this behavior.

The contract owner is a trusted governance role. It can set `minSelfStake`, `thawingPeriod`, and `freezingPeriod`, including zero values. In production, ownership should be held by an appropriate multisig or governance system.

Protocol reward funding is an owner-operated process: reward tokens must be transferred to `DelegationManager` before calling `notifyRewardAmount`. The owner is responsible for keeping sufficient reward-token liquidity available. Resolver incentive funding is separate: a Resolver must approve and fund its own `RewardsDistributor` for every epoch it confirms.

## Deployment Scope

`ignition/modules/Resolver.ts` is a demonstration deployment module. It deploys:

- `MockERC20` with `1,000,000` tokens minted to the deployer;
- separate mock staking and reward tokens;
- `TokenVesting` using the reward token;
- `StakingManager` with a `1,000` token minimum self-stake and a 7-day thawing period; and
- `DelegationManager` with a 30-day protocol-reward period and a 7-day freezing period;
- an uninitialized `RewardsDistributor` implementation; and
- `RewardsDistributorFactory`, configured with that implementation, the `StakingManager`, the deployer as the initial root publisher, and the reward token.

The module does not create a Resolver distributor, set approvals, fund either reward system, publish or confirm a root, transfer ownership, or replace the mock tokens. It is not a production deployment script. A production deployment should use audited token and resolver-registry addresses, assign governance ownership, define the protocol-reward funding process, and define the root-publication and Resolver-funding processes for optional incentives.

The Hardhat configuration supports an EDR-simulated local network and Sepolia. Sepolia deployments require `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`; contract verification additionally requires `ETHERSCAN_API_KEY`.

## Repository Layout

```text
contracts/
  DelegationManager.sol
  RewardsDistributor.sol
  RewardsDistributorFactory.sol
  StakingManager.sol
  TokenVesting.sol
  interface/
    IRewardsDistributor.sol
    IStakingManager.sol
  mocks/
    MockCloneFactory.sol
    MockERC20.sol
    MockRewardsDistributor.sol
    MockStakingManager.sol
ignition/
  modules/
    Resolver.ts
test/
  DelegationManager.ts
  DelegationStakingIntegration.ts
  RewardsDistributor.ts
  RewardsDistributorFactory.ts
  StakingManager.ts
  TokenVesting.ts
  invariant/
    DelegationManagerInvariant.t.sol
    StakingManagerInvariant.t.sol
    TokenVestingInvariant.t.sol
```

## Development

Install dependencies:

```shell
npm install
```

Build the Solidity contracts and generate Hardhat artifacts:

```shell
npx hardhat build
```

Type-check the TypeScript configuration and tests:

```shell
npx tsc --noEmit
```

Run the complete test suite:

```shell
npx hardhat test
```

Run only the Mocha and ethers integration tests:

```shell
npx hardhat test mocha
```

Run only Solidity invariant tests:

```shell
npx hardhat test solidity
```

The Solidity invariant suite contains 17 `invariant_*` tests. Hardhat runs each invariant using its configured run count, currently the default of 256 runs per invariant.

## Deployment

Deploy the demonstration module to the simulated local network:

```shell
npx hardhat ignition deploy ignition/modules/Resolver.ts
```

Deploy it to Sepolia after configuring the required environment variables:

```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Resolver.ts
```

Ignition retains `deployed_addresses.json` and `journal.jsonl` under `ignition/deployments/`. Reproducible artifacts and compiler build-info files are ignored by Git.

## Testing Notes

The Mocha suite covers deployment validation, access control, token transfers, state transitions, events, protocol-reward accounting, vesting and revocation, and full lifecycle scenarios. It also covers Resolver distributor cloning and initialization, resolver-only epoch funding and APR updates, root-publisher authorization, Merkle-proof claims, and claim-state protections. The Solidity invariant suite checks accounting and token-conservation properties for `DelegationManager`, `StakingManager`, and `TokenVesting`.

This repository is not presented as an audited production deployment. Review the governance model, token behavior, reward-funding process, and application-level resolver monitoring before using real assets.
