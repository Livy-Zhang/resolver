// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockStakingManager
 * @notice Test-only resolver eligibility registry.
 */
contract MockStakingManager {
    mapping(address => bool) public validResolvers;

    /**
     * @notice Sets a resolver's test eligibility status.
     * @param resolver Resolver address to update.
     * @param valid Eligibility status to assign.
     */
    function setResolver(address resolver, bool valid) external {
        validResolvers[resolver] = valid;
    }

    /**
     * @notice Returns a resolver's test eligibility status.
     * @param resolver Resolver address to query.
     * @return valid Current mock eligibility status.
     */
    function isValidResolver(address resolver) external view returns (bool) {
        return validResolvers[resolver];
    }
}
