// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStakingManager {
    function minSelfStake() external view returns (uint256);
    function thawingPeriod() external view returns (uint256);
    function stakes(
        address resolver
    )
        external
        view
        returns (
            uint256 amountStaked,
            uint256 lockDuration,
            uint256 amountLocked,
            uint256 unlockTime
        );
    function fillOrderOperators(address resolver, address operator) external view returns (bool);
    function isValidResolver(address resolver) external view returns (bool);
}
