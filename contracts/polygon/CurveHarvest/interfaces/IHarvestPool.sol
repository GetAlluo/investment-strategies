// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.14;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IHarvestPool is IERC20 {
    function stake(uint256 amount) external;
    function getReward() external;
    function withdraw(uint256 amount) external;
    function exit() external;
    function stakedBalanceOf(address) external view returns (uint256);
}
