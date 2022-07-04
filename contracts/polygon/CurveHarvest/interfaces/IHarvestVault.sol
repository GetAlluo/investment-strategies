// SPDX-License-Identifier: MIT
pragma solidity ^0.8.14;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IHarvestVault is IERC20 {
    function deposit(uint256 amount) external;
    function withdrawAll() external;
    function withdraw(uint256 numberOfShares) external;
}