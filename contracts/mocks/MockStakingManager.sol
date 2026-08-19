// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockStakingManager {
    mapping(address => bool) public validResolvers;

    function setResolver(address resolver, bool valid) external {
        validResolvers[resolver] = valid;
    }

    function isValidResolver(address resolver) external view returns (bool) {
        return validResolvers[resolver];
    }
}
