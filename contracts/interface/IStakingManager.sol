// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IStakingManager
 * @notice Interface for resolver and operator eligibility checks.
 */
interface IStakingManager {
    /**
     * @notice Returns whether a resolver currently meets the active self-stake requirement.
     * @param resolver Resolver address to check.
     * @return valid True when the resolver is eligible.
     */
    function isValidResolver(address resolver) external view returns (bool);

    /**
     * @notice Returns whether an operator is authorized by an eligible resolver.
     * @param resolver Resolver that authorized the operator.
     * @param operator Operator address to check.
     * @return valid True when authorization and resolver eligibility both hold.
     */
    function isValidOperator(address resolver, address operator) external view returns (bool);
}
