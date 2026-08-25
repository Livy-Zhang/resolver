# Resolver Staking, Delegation, and Vesting Protocol

This Hardhat 3 project implements the core contracts for a resolver network: resolver self-staking, user delegation with time-based rewards, and token vesting. The contracts target Solidity `0.8.28` and use OpenZeppelin's `Ownable`, `ReentrancyGuard`, and `SafeERC20` utilities.

## Architecture

Core contracts:

- `contracts/StakingManager.sol` manages resolver self-stake, the unstaking delay, and resolver-authorized operators.
- `contracts/DelegationManager.sol` custody-holds delegated staking tokens, attributes them to one resolver per delegator, enforces a freezing period, and distributes owner-funded rewards over fixed reward periods.
- `contracts/TokenVesting.sol` creates one linear vesting schedule per beneficiary, supports claims, and allows the owner to revoke the unvested portion.
- `contracts/interface/IStakingManager.sol` exposes the resolver and operator eligibility checks used by `DelegationManager`.
- `contracts/mocks/MockERC20.sol` and `contracts/mocks/MockStakingManager.sol` are for tests and demonstration deployments only. They are not production token or resolver-registry implementations.

## Protocol Lifecycle

### Resolver self-staking

1. A resolver approves `StakingManager` to spend `STAKING_TOKEN`.
2. The resolver calls `stake(amount)`. After the call, its active self-stake must meet `minSelfStake`.
3. `isValidResolver(resolver)` returns `true` while the resolver meets that threshold.
4. The resolver calls `unstake(amount)` to move active stake into a locked balance. Only one locked withdrawal may exist at a time.
5. Once `thawingPeriod` has elapsed, the resolver calls `withdrawStaked(to)` to withdraw the full locked balance.

### Delegation and rewards

1. A user approves `DelegationManager` to spend `STAKING_TOKEN`.
2. The user calls `delegate(resolver, amount)` for a resolver that is eligible at that time. Each user may delegate to only one resolver, but may increase the amount delegated to that resolver.
3. After `freezingPeriod`, the user can call `undelegate(amount)` or `redelegate(newResolver)`. Redelegation moves the full position and starts a new freezing period.
4. The owner first transfers sufficient `REWARD_TOKEN` to `DelegationManager`, then calls `notifyRewardAmount(reward)` to start or replace a reward period. `notifyRewardAmount` does not pull tokens from the owner.
5. Delegators call `claimReward()` to receive accrued rewards, or `exit()` to withdraw their full delegation and claim rewards in one transaction.

### Token vesting

1. The owner approves `TokenVesting` to spend `VESTING_TOKEN`.
2. The owner calls `scheduleVesting(beneficiary, allocation, cliff, duration)`, which transfers the allocation into the contract.
3. No tokens vest during the cliff. The allocation then vests linearly until `startTime + duration`.
4. The beneficiary calls `claim()` to receive vested, unclaimed tokens.
5. The owner may call `revoke(beneficiary, refundAddress)`. The schedule's vested amount is fixed at revocation; unvested tokens are refunded and the vested balance remains claimable by the beneficiary.

## Eligibility and Governance Model

`StakingManager` determines resolver eligibility exclusively from active self-stake. `DelegationManager` checks that eligibility only when a user delegates or redelegates; it does not guarantee that a resolver remains eligible throughout an existing delegation.

**Delegators are responsible for monitoring the self-stake and eligibility of their chosen resolver.** A resolver can unstake and become ineligible while it still has attributed delegations. Delegators can undelegate or redelegate subject to the protocol's freezing-period rules.

The contract owner is a trusted governance role. It can set `minSelfStake`, `thawingPeriod`, and `freezingPeriod`, including zero values. In production, ownership should be held by an appropriate multisig or governance system.

Reward funding is an owner-operated process: reward tokens must be transferred to `DelegationManager` before calling `notifyRewardAmount`. The owner is responsible for keeping sufficient reward-token liquidity available.

## Deployment Scope

`ignition/modules/Resolver.ts` is a demonstration deployment module. It deploys:

- `MockERC20` with `1,000,000` tokens minted to the deployer;
- `TokenVesting` using that mock token;
- `StakingManager` with a `1,000` token minimum self-stake and a 7-day thawing period; and
- `DelegationManager` with the same mock token for staking and rewards, a 30-day reward period, and a 7-day freezing period.

The module does not set approvals, fund a reward period, transfer ownership, or replace the mock token. It is not a production deployment script. A production deployment should use audited token and resolver-registry addresses, assign governance ownership, and define a documented reward-funding process.

The Hardhat configuration supports an EDR-simulated local network and Sepolia. Sepolia deployments require `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`; contract verification additionally requires `ETHERSCAN_API_KEY`.

## Repository Layout

```text
contracts/
  DelegationManager.sol
  StakingManager.sol
  TokenVesting.sol
  interface/
    IStakingManager.sol
  mocks/
    MockERC20.sol
    MockStakingManager.sol
ignition/
  modules/
    Resolver.ts
test/
  DelegationManager.ts
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

The Mocha suite covers deployment validation, access control, token transfers, state transitions, events, reward accounting, vesting and revocation, and full lifecycle scenarios. The Solidity invariant suite checks accounting and token-conservation properties across all three protocol components.

This repository is not presented as an audited production deployment. Review the governance model, token behavior, reward-funding process, and application-level resolver monitoring before using real assets.
