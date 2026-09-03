// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IStakingManager
 * @notice Interface for resolver and operator eligibility checks.
 */
interface IStakingManager {
    function isValidResolver(address resolver) external view returns (bool);
    function isValidOperator(address resolver, address operator) external view returns (bool);
}
