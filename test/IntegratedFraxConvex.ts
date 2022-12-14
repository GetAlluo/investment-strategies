import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { exec } from "child_process";
import { BigNumber } from "ethers";
import { AbiCoder, defaultAbiCoder, parseEther, parseUnits } from "ethers/lib/utils";
import { ethers, network, upgrades } from "hardhat";
import { CurveFraxConvexStrategyV2, ICvxBooster, IERC20Metadata, IExchange, IWrappedEther, IConvexStaking, ILocking, IStrategyHandler, IVoteExecutorMaster, CurveConvexStrategyNativeV2 } from "../typechain";

async function skipDays(d: number) {
    ethers.provider.send('evm_increaseTime', [d * 86400]);
    ethers.provider.send('evm_mine', []);
}

async function checkSpread(fact: BigNumber, expected: BigNumber, allowedSpread: number) {
    expect(fact).to.be.gte(expected.div(100).mul(100 - allowedSpread));
    expect(fact).to.be.lte(expected.div(100).mul(100 + allowedSpread));
};

async function getImpersonatedSigner(address: string): Promise<SignerWithAddress> {
    await ethers.provider.send(
        'hardhat_impersonateAccount',
        [address]
    );
    return await ethers.getSigner(address);
}


describe("Automated strategy execution", function () {
    let strategy: CurveFraxConvexStrategyV2;
    let strategyNative: CurveConvexStrategyNativeV2;
    let signers: SignerWithAddress[];
    let signer: SignerWithAddress;

    let usdc: IERC20Metadata, usdt: IERC20Metadata, crv: IERC20Metadata, cvx: IERC20Metadata,
        FXS: IERC20Metadata, weth: IERC20Metadata, poolRewards: IERC20Metadata;
    let cvxBooster: ICvxBooster;
    let exchange: IExchange;
    let frax: IERC20Metadata;
    let FraxPool: ILocking;
    let stakingToken: IConvexStaking;
    let handler: IStrategyHandler;
    let executor: IVoteExecutorMaster;

    const duration = 60 * 60 * 24 * 8;  //EIGHT_DAYS_IN_SECONDS;

    const ZERO_ADDR = ethers.constants.AddressZero;

    async function resetNetwork() {

        await network.provider.request({
            method: "hardhat_reset",
            params: [{
                forking: {
                    enabled: true,
                    jsonRpcUrl: "https://mainnet.gateway.tenderly.co/2jzMgDLzHFjAwvDkYqdzd4",
                    //you can fork from last block by commenting next line
                    blockNumber: 16169577,
                },
            },],
        });

        signers = await ethers.getSigners();
        signer = signers[0]

        usdc = await ethers.getContractAt("IERC20Metadata", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
        usdt = await ethers.getContractAt("IERC20Metadata", "0xdAC17F958D2ee523a2206206994597C13D831ec7");
        frax = await ethers.getContractAt('IERC20Metadata', '0x853d955acef822db058eb8505911ed77f175b99e');
        FraxPool = await ethers.getContractAt('ILocking', '0x963f487796d54d2f27bA6F3Fbe91154cA103b199');
        crv = await ethers.getContractAt("IERC20Metadata", "0xD533a949740bb3306d119CC777fa900bA034cd52");
        cvx = await ethers.getContractAt("IERC20Metadata", "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B");
        FXS = await ethers.getContractAt("IERC20Metadata", "0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0");
        weth = await ethers.getContractAt("IERC20Metadata", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")
        poolRewards = await ethers.getContractAt("IERC20Metadata", "0x7e880867363A7e321f5d260Cade2B0Bb2F717B02");
        cvxBooster = await ethers.getContractAt("contracts/interfaces/ICvxBooster.sol:ICvxBooster", "0xF403C135812408BFbE8713b5A23a04b3D48AAE31") as ICvxBooster;
        exchange = await ethers.getContractAt("contracts/interfaces/IExchange.sol:IExchange", "0x29c66CF57a03d41Cfe6d9ecB6883aa0E2AbA21Ec") as IExchange
        stakingToken = await ethers.getContractAt("IConvexStaking", "0x8a53ee42FB458D4897e15cc7dEa3F75D0F1c3475");

        const value = parseEther("200.0");

        await exchange.exchange(
            ZERO_ADDR, frax.address, value, 0, { value: value }
        )
        await exchange.exchange(
            ZERO_ADDR, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", value, 0, { value: value }
        )
        let wrappedEther = await ethers.getContractAt("contracts/interfaces/IWrappedEther.sol:IWrappedEther", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2") as IWrappedEther
        await wrappedEther.deposit({ value: ethers.utils.parseEther("100") })

    }

    before(async () => {

        upgrades.silenceWarnings();
        await resetNetwork();

    });

    describe("Testing FRAX strategies with ERC20 pool tokens", function () {

        const curvePool = "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2";
        const fraxPool = "0x963f487796d54d2f27bA6F3Fbe91154cA103b199";
        const usdcToken = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
        const wethToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        const poolSize = 2;
        const lpToken = '0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC';
        const tokenIndexInCurve = 1;

        beforeEach(async () => {

            await resetNetwork();

            const Strategy = await ethers.getContractFactory("CurveFraxConvexStrategyV2");
            const routerAddress = "0x24733D6EBdF1DA157d2A491149e316830443FC00"
            strategy = await upgrades.deployProxy(Strategy,
                [signers[0].address, ZERO_ADDR, ZERO_ADDR, routerAddress], {
                initializer: 'initialize',
                kind: 'uups',
                unsafeAllow: ["delegatecall"]
            }
            ) as CurveFraxConvexStrategyV2

            await strategy.grantRole("0x0000000000000000000000000000000000000000000000000000000000000000", "0x82e568c482df2c833dab0d38deb9fb01777a9e89");

        });

        it("Should add data to strategy handler ", async () => {
            const _codeName = "Convex: FRAX/USDC";
            const _strategyAddress = strategy.address;
            const _entryToken = usdcToken;
            const _assetId = 0;
            const _chainId = 1;
            const _entryData = await strategy.encodeEntryParams(
                curvePool, _entryToken, poolSize, tokenIndexInCurve, fraxPool, duration);
            const _rewardsData = await strategy.encodeRewardsParams(lpToken, fraxPool, 0);
            const _exitData = await strategy.encodeExitParams(curvePool, _entryToken, tokenIndexInCurve, fraxPool);
            const handler = await ethers.getContractAt("IStrategyHandler", "0x385AB598E7DBF09951ba097741d2Fa573bDe94A5");

            await handler.addLiquidityDirection(
                _codeName,
                _strategyAddress,
                _entryToken,
                _assetId,
                _chainId,
                _entryData,
                _exitData,
                _rewardsData
            );

            const request = await handler.liquidityDirection(10);
            expect(request.strategyAddress).to.be.eq(_strategyAddress);
            expect(request.entryToken).to.be.eq(_entryToken);
            expect(request.assetId).to.be.eq(_assetId);
            expect(request.chainId).to.be.eq(_chainId);
            expect(request.entryData).to.be.eq(_entryData);
            expect(request.exitData).to.be.eq(_exitData);
            expect(request.rewardsData).to.be.eq(_rewardsData);
            expect(request.latestAmount).to.be.eq(0);

        });

        it("Should submit, approve and execute liquidity direction", async () => {
            const _codeName = "Convex: FRAX/USDC";
            const _strategyAddress = strategy.address;
            const _entryToken = usdcToken;
            const _assetId = 0;
            const _chainId = 1;
            const _entryData = await strategy.encodeEntryParams(
                curvePool, _entryToken, poolSize, tokenIndexInCurve, fraxPool, duration);
            const _rewardsData = await strategy.encodeRewardsParams(lpToken, fraxPool, 0);
            const _exitData = await strategy.encodeExitParams(curvePool, _entryToken, tokenIndexInCurve, fraxPool);
            const handler = await ethers.getContractAt("IStrategyHandler", "0x385AB598E7DBF09951ba097741d2Fa573bDe94A5");
            const executor = await ethers.getContractAt("IVoteExecutorMaster", "0x82e568C482dF2C833dab0D38DeB9fb01777A9e89");
            const poolToken = await ethers.getContractAt("IERC20Metadata", _entryToken);
            const amount = parseUnits("1000", await poolToken.decimals());

            await handler.addLiquidityDirection(
                _codeName,
                _strategyAddress,
                _entryToken,
                _assetId,
                _chainId,
                _entryData,
                _exitData,
                _rewardsData
            );


            const executorBalanceBefore = await poolToken.balanceOf(executor.address);
            const request1 = await executor.callStatic.encodeLiquidityCommand(_codeName, 6000);
            const request2 = await executor.callStatic.encodeLiquidityCommand("Curve/Convex Mim+3CRV", 4000);
            const request5 = await executor.callStatic.encodeLiquidityCommand("Curve/Convex Frax+USDC", 0);
            const idx = request1[0];
            const messages = request1[1];

            const request3 = await executor.callStatic.encodeAllMessages([idx, request2[0], request5[0]], [messages, request2[1], request5[1]]);
            const inputData = request3[2];

            await executor.submitData(inputData);

            const admin = await getImpersonatedSigner('0x1F020A4943EB57cd3b2213A66b355CB662Ea43C3');
            await executor.connect(admin).setMinSigns(0);

            await executor.executeSpecificData(3);
            console.log('\n************* executed specific data *************\n');
            const executorBalanceAter = await poolToken.balanceOf(executor.address);
            console.log('Balance of executor before investing', ethers.utils.formatUnits(executorBalanceBefore, 6), "balance after withdrawal: ", ethers.utils.formatUnits(executorBalanceAter, 6), '\n**********************************');

            await executor.connect(admin).executeDeposits();

            const deployedAmount = ethers.utils.formatEther(await strategy.callStatic.getDeployedAmount(_rewardsData));
            console.log(deployedAmount);
            console.log('Balance of executor afer investing', ethers.utils.formatUnits((await poolToken.balanceOf(executor.address)), 6));
            checkSpread(ethers.utils.parseEther(deployedAmount), ethers.utils.parseEther(ethers.utils.formatUnits(executorBalanceBefore, 6)), 5);

            // expect(executorBalanceAter).to.be.eq((executorBalanceBefore).sub(amount));

        });


        it("Should try exiting before the end of locking period", async () => {
            const _codeName = "Convex: FRAX/USDC";
            const _strategyAddress = strategy.address;
            const _entryToken = usdcToken;
            const _assetId = 0;
            const _chainId = 1;
            const _entryData = await strategy.encodeEntryParams(
                curvePool, _entryToken, poolSize, tokenIndexInCurve, fraxPool, duration);
            const _rewardsData = await strategy.encodeRewardsParams(lpToken, fraxPool, 0);
            const _exitData = await strategy.encodeExitParams(curvePool, _entryToken, tokenIndexInCurve, fraxPool);
            const handler = await ethers.getContractAt("IStrategyHandler", "0x385AB598E7DBF09951ba097741d2Fa573bDe94A5");
            const executor = await ethers.getContractAt("IVoteExecutorMaster", "0x82e568C482dF2C833dab0D38DeB9fb01777A9e89");
            const poolToken = await ethers.getContractAt("IERC20Metadata", _entryToken);
            const amount = parseUnits("1000", await poolToken.decimals());

            await handler.addLiquidityDirection(
                _codeName,
                _strategyAddress,
                _entryToken,
                _assetId,
                _chainId,
                _entryData,
                _exitData,
                _rewardsData
            );


            const executorBalanceBefore = await poolToken.balanceOf(executor.address);
            // await poolToken.connect(signer).transfer(executor.address, amount);
            const request1 = await executor.callStatic.encodeLiquidityCommand(_codeName, 6000);
            const request2 = await executor.callStatic.encodeLiquidityCommand("Curve/Convex Mim+3CRV", 4000);
            const request5 = await executor.callStatic.encodeLiquidityCommand("Curve/Convex Frax+USDC", 0);
            const idx = request1[0];
            const messages = request1[1];

            const request3 = await executor.callStatic.encodeAllMessages([idx, request2[0], request5[0]], [messages, request2[1], request5[1]]);
            const inputData = request3[2];
            await executor.submitData(inputData);

            const admin = await getImpersonatedSigner('0x1F020A4943EB57cd3b2213A66b355CB662Ea43C3');
            await executor.connect(admin).setMinSigns(0);

            await executor.executeSpecificData(3);
            console.log('\n************* executed specific data *************\n');
            const executorBalanceAter = await poolToken.balanceOf(executor.address);
            console.log('Balance of executor before investing', ethers.utils.formatUnits(executorBalanceBefore, 6), "balance after withdrawal: ", ethers.utils.formatUnits(executorBalanceAter, 6), '\n**********************************');

            await executor.connect(admin).executeDeposits();
            console.log('\nDeposit executed!\n')

            // try to exit before 7 days end
            await executor.submitData(inputData);
            console.log('data submitted');
            const tx = executor.executeSpecificData(4);
            expect(tx).to.be.reverted;

            const txExit = strategy.exitAll(_exitData, 10000, poolToken.address, signer.address, true, true);
            expect(txExit).to.be.revertedWith("Stake is still locked!");

        });
    });

    describe("Testing strategies with native ETH", function () {

        const curvePool = "0xa1f8a6807c402e4a15ef4eba36528a3fed24e577";
        const fraxPool = "0xa537d64881b84faffb9Ae43c951EEbF368b71cdA";
        const wethToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        const poolSize = 2;
        const lpToken = '0xf43211935C781D5ca1a41d2041F397B8A7366C7A';
        const tokenIndexInCurve = 0;

        beforeEach(async () => {

            await resetNetwork();

            const Strategy = await ethers.getContractFactory("CurveConvexStrategyNativeV2");
            const routerAddress = "0x24733D6EBdF1DA157d2A491149e316830443FC00"
            strategyNative = await upgrades.deployProxy(Strategy,
                [signers[0].address, ZERO_ADDR, ZERO_ADDR, routerAddress], {
                initializer: 'initialize',
                kind: 'uups',
                unsafeAllow: ["delegatecall"]
            }
            ) as CurveConvexStrategyNativeV2

            await strategyNative.grantRole("0x0000000000000000000000000000000000000000000000000000000000000000", "0x82e568c482df2c833dab0d38deb9fb01777a9e89");

        });

        it("Should invest into ETH/frxETH pool", async () => {
            const _codeName = "Convex: ETH/frxETH";
            const _strategyAddress = strategyNative.address;
            const _entryToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
            const _assetId = 2;
            const _chainId = 1;
            const _entryData = await strategyNative.encodeEntryParams(
                curvePool, _entryToken, poolSize, tokenIndexInCurve, fraxPool, duration);
            const _rewardsData = await strategyNative.encodeRewardsParams(lpToken, fraxPool, 0);
            const _exitData = await strategyNative.encodeExitParams(curvePool, _entryToken, tokenIndexInCurve, fraxPool);
            const handler = await ethers.getContractAt("IStrategyHandler", "0x385AB598E7DBF09951ba097741d2Fa573bDe94A5");
            const executor = await ethers.getContractAt("IVoteExecutorMaster", "0x82e568C482dF2C833dab0D38DeB9fb01777A9e89");
            const poolToken = await ethers.getContractAt("IERC20Metadata", wethToken);
            const amount = parseUnits("100", await poolToken.decimals());

            await handler.addLiquidityDirection(
                _codeName,
                _strategyAddress,
                _entryToken,
                _assetId,
                _chainId,
                _entryData,
                _exitData,
                _rewardsData
            );


            const executorBalanceBefore = await poolToken.balanceOf(executor.address);
            console.log(executorBalanceBefore);
            // await poolToken.connect(signer).transfer(executor.address, amount);
            const rq1 = await executor.callStatic.encodeLiquidityCommand(_codeName, 6000);
            const rq2 = await executor.callStatic.encodeLiquidityCommand("Curve/Convex Mim+3CRV", 4000);
            const rq3 = await executor.callStatic.encodeLiquidityCommand("Curve/Convex Mim+3CRV", 0);
            const rq4 = await executor.callStatic.encodeLiquidityCommand(_codeName, 0);

            const encodedMmessages = await executor.callStatic.encodeAllMessages([rq1[0], rq2[0], rq3[0], rq4[0]], [rq1[1], rq2[1], rq3[1], rq4[1]]);
            const inputData = encodedMmessages[2];
            await executor.submitData(inputData);
            console.log('here');

            const admin = await getImpersonatedSigner('0x1F020A4943EB57cd3b2213A66b355CB662Ea43C3');
            await executor.connect(admin).setMinSigns(0);

            await executor.executeSpecificData(3);
            console.log('\n************* executed specific data *************\n');

            await poolToken.transfer(executor.address, amount);
            const executorBalanceAter = await poolToken.balanceOf(executor.address);

            console.log('Balance of executor before investing',
                ethers.utils.formatEther(executorBalanceBefore), "balance after withdrawal: ",
                ethers.utils.formatEther(executorBalanceAter),
                '\n**********************************');
            console.log(await poolToken.balanceOf(strategyNative.address));
            await executor.connect(admin).executeDeposits();
            // console.log('\nDeposit executed!\n');

        });
    });

    // Extend a locking period - add an admin function for that.

});
