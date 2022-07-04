// SPDX-License-Identifier: MIT
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";

import "./../../IAlluoStrategy.sol";
import "../../interfaces/IExchange.sol";
import "./interfaces/IHarvestVault.sol";
import "./interfaces/IHarvestPool.sol";
import "hardhat/console.sol";

contract CurveHarvestEurStrategy is AccessControl, IAlluoStrategy {
    using Address for address;
    using SafeERC20 for IERC20;
    IHarvestVault public constant harvestVault =
        IHarvestVault(0xDDe43710DefEf6CbCf820B18DeBfC3cF9a4f449F);
    IHarvestPool public constant harvestPool =
        IHarvestPool(0xf74E8CFe03421D071c7dCCc3E5ecB6dDDede2f07);
    // miFARM
    IERC20 public constant harvestReward =
        IERC20(0xab0b2ddB9C7e440fAc8E140A89c0dbCBf2d7Bbff);

    IExchange public constant exchange = IExchange(0x6b45B9Ab699eFbb130464AcEFC23D49481a05773);

    uint8 public constant unwindDecimals = 2;

    constructor(
        address voteExecutor,
        address gnosis
    ) {
        require(
            voteExecutor.isContract(),
            "CurveHarvestEurStrategy: 1!contract"
        );
        require(gnosis.isContract(), "CurveHarvestEurStrategy: 2!contract");
        _grantRole(DEFAULT_ADMIN_ROLE, gnosis);
        _grantRole(DEFAULT_ADMIN_ROLE, voteExecutor);
    }

    function invest(bytes calldata data, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (bytes memory)
    {
        (
            address curvePool,
            IERC20 lpToken,
            IERC20 poolToken,
            uint8 poolSize,
            uint8 tokenIndexInCurve,
            uint256 poolId
        ) = decodeEntryParams(data);

        // Prepare amounts array for curve, assuming that only depositing in 1 token (jeur etc).
        uint256[4] memory fourPoolTokensAmount;
        fourPoolTokensAmount[tokenIndexInCurve] = amount;

        // approve tokens to curve pool
        poolToken.safeIncreaseAllowance(curvePool, amount);

        bytes memory curveCall = abi.encodeWithSelector(
            0x029b2f34,
            fourPoolTokensAmount,
            0
        );
        curvePool.functionCall(curveCall);

        // If poolId is set to max uint256, do not invest in harvest.
        if (poolId != type(uint256).max) {
            // Invest LP tokens into harvest to receive Vault tokens, then stake them.
            uint256 lpAmount = lpToken.balanceOf(address(this));
            lpToken.safeIncreaseAllowance(address(harvestVault), lpAmount);
            harvestVault.deposit(lpAmount);
            uint256 amountVault = harvestVault.balanceOf(address(this));
            harvestVault.approve(address(harvestPool), amountVault);
            harvestPool.stake(amountVault);
        }

        return
            encodeExitParams(
                curvePool,
                address(poolToken),
                address(lpToken),
                tokenIndexInCurve,
                poolId
            );
    }

    function exitAll(
        bytes calldata data,
        uint256 unwindPercent,
        address outputCoin,
        address receiver,
        bool swapRewards
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        (
            address curvePool,
            IERC20 poolToken,
            IERC20 lpToken,
            uint8 tokenIndexInCurve,
            uint256 harvestPoolId
        ) = decodeExitParams(data);

        uint256 lpAmount;
        if (harvestPoolId != type(uint256).max) {
            lpAmount =
                (harvestPool.balanceOf(address(this)) * unwindPercent) /
                (10**(2 + unwindDecimals));

            // withdraw everything from the pool
            harvestPool.withdraw(lpAmount);
            harvestVault.withdraw(lpAmount);
        } else {
            lpAmount = lpToken.balanceOf(address(this));
        }
        harvestPool.getReward();

        if (lpAmount == 0) return;
        // exit with coin that we used for entry
        bytes memory curveCall = abi.encodeWithSignature(
            "remove_liquidity_one_coin(uint256,int128,uint256)",
            lpAmount,
            tokenIndexInCurve,
            0
        );
        curvePool.functionCall(curveCall);

        // execute exchanges and transfer all tokens to receiver
        exchangeAll(poolToken, IERC20(outputCoin));
        manageRewardsAndWithdraw(swapRewards, IERC20(outputCoin), receiver);
    }

    function exitOnlyRewards(
        bytes calldata data,
        address outputCoin,
        address receiver,
        bool swapRewards
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        harvestPool.getReward();
        manageRewardsAndWithdraw(swapRewards, IERC20(outputCoin), receiver);
    }

    function multicall(
        address[] calldata destinations,
        bytes[] calldata calldatas
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 length = destinations.length;
        require(length == calldatas.length, "CurveHarvestEur: Length mismatch");
        for (uint256 i = 0; i < length; i++) {
            destinations[i].functionCall(calldatas[i]);
        }
    }

    function encodeEntryParams(
        address curvePool,
        address lpToken,
        address poolToken,
        uint8 poolSize,
        uint8 tokenIndexInCurve,
        uint256 harvestPoolId
    ) external pure returns (bytes memory) {
        return
            abi.encode(
                curvePool,
                lpToken,
                poolToken,
                poolSize,
                tokenIndexInCurve,
                harvestPoolId
            );
    }

    function encodeExitParams(
        address curvePool,
        address poolToken,
        address lpToken,
        uint8 tokenIndexInCurve,
        uint256 harvestPoolId
    ) public pure returns (bytes memory) {
        return
            abi.encode(
                curvePool,
                poolToken,
                lpToken,
                tokenIndexInCurve,
                harvestPoolId
            );
    }

    function decodeEntryParams(bytes calldata data)
        public
        pure
        returns (
            address,
            IERC20,
            IERC20,
            uint8,
            uint8,
            uint256
        )
    {
        require(data.length == 32 * 6, "CurveHarvestEurStrategy: length en");
        return
            abi.decode(data, (address, IERC20, IERC20, uint8, uint8, uint256));
    }

    function decodeExitParams(bytes calldata data)
        public
        pure
        returns (
            address,
            IERC20,
            IERC20,
            uint8,
            uint256
        )
    {
        require(data.length == 32 * 5, "CurveHarvestEurStrategy: length ex");
        return abi.decode(data, (address, IERC20, IERC20, uint8, uint256));
    }

    function exchangeAll(IERC20 fromCoin, IERC20 toCoin) private {
        if (fromCoin == toCoin) return;
        uint256 amount = IERC20(fromCoin).balanceOf(address(this));
        if (amount == 0) return;

        fromCoin.safeApprove(address(exchange), amount);
        exchange.exchange(address(fromCoin), address(toCoin), amount, 0);
    }

    function manageRewardsAndWithdraw(
        bool swapRewards,
        IERC20 outputCoin,
        address receiver
    ) private {
        if (swapRewards) {
            exchangeAll(harvestReward, outputCoin);
        } else {
            harvestReward.safeTransfer(
                receiver,
                harvestReward.balanceOf(address(this))
            );
        }
        outputCoin.safeTransfer(receiver, outputCoin.balanceOf(address(this)));
    }
}
