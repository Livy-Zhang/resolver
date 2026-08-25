// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Test-only ERC-20 with a fixed initial supply.
 */
contract MockERC20 is ERC20 {
    /**
     * @notice Creates a mock token and mints the full initial supply.
     * @param initialOwner Recipient of the initial token supply.
     * @param initialSupply Amount minted at deployment.
     */
    constructor(address initialOwner, uint256 initialSupply) ERC20("MockToken", "MCK") {
        _mint(initialOwner, initialSupply);
    }
}
