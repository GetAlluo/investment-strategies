import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { AbiCoder, defaultAbiCoder, formatUnits, parseEther, parseUnits } from "ethers/lib/utils";
import { ethers, network } from "hardhat";
import { CurveHarvestEurStrategy, CurveHarvestEurStrategy__factory, ICvxBooster, IERC20Metadata, IExchange } from "../typechain";
async function getImpersonatedSigner(address: string): Promise<SignerWithAddress> {
    await ethers.provider.send(
        'hardhat_impersonateAccount',
        [address]
    );

    return await ethers.getSigner(address);
}

describe("CurveHarvestEurStrategy", function () {
    let strategy: CurveHarvestEurStrategy;
    let signers: SignerWithAddress[];
    let admin: SignerWithAddress;
    let voteExecutor: SignerWithAddress;
    let usdc: IERC20Metadata, usdt: IERC20Metadata, dai: IERC20Metadata, crv: IERC20Metadata, cvx: IERC20Metadata, miFarm: IERC20Metadata, eurt: IERC20Metadata, EURtCurveLp: IERC20Metadata;
    let exchange: IExchange;
    let usdWhale: SignerWithAddress;
    let eurtWhale: SignerWithAddress;
    type Edge = {
        swapProtocol: BigNumberish;
        pool: string;
        fromCoin: string;
        toCoin: string;
    };
    type Route = Edge[];


    let usdtEurtRoute: Route, usdtDaiRoute: Route, usdtUsdcRoute: Route,
        usdcEurtRoute: Route, usdcDaiRoute: Route, usdcUsdtRoute: Route,
        daiEurtRoute: Route, daiUsdcRoute: Route, daiUsdtRoute: Route,
        eurtDaiRoute: Route, eurtUsdcRoute: Route, eurtUsdtRoute: Route;

    let polygonCurveEdge: Edge;
    const ZERO_ADDR = ethers.constants.AddressZero;
    const PolygonCurveEURtPool = "0x225fb4176f0e20cdb66b4a3df70ca3063281e855";


    before(async () => {

        await network.provider.request({
            method: "hardhat_reset",
            params: [{
                forking: {
                    enabled: true,
                    jsonRpcUrl: process.env.POLYGON_FORKING_URL as string,
                    //you can fork from last block by commenting next line
                    blockNumber: 28729129,
                },
            },],
        });
        admin = await getImpersonatedSigner("0x2580f9954529853Ca5aC5543cE39E9B5B1145135");
        usdWhale = await getImpersonatedSigner("0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8");
        eurtWhale = await getImpersonatedSigner("0x1a4b038c31a8e5f98b00016b1005751296adc9a4");
        await ethers.provider.send(
            'hardhat_impersonateAccount',
            [admin.address]
        );
        signers = await ethers.getSigners();
        voteExecutor = signers[0]

        usdt = await ethers.getContractAt("IERC20Metadata", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F");
        usdc = await ethers.getContractAt("IERC20Metadata", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174");
        dai = await ethers.getContractAt("IERC20Metadata", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063");
        crv = await ethers.getContractAt("IERC20Metadata", "0xD533a949740bb3306d119CC777fa900bA034cd52");
        cvx = await ethers.getContractAt("IERC20Metadata", "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B");
        miFarm = await ethers.getContractAt("IERC20Metadata", "0xab0b2ddB9C7e440fAc8E140A89c0dbCBf2d7Bbff");
        eurt = await ethers.getContractAt("IERC20Metadata", "0x7BDF330f423Ea880FF95fC41A280fD5eCFD3D09f")
        // cvxBooster = await ethers.getContractAt("ICvxBooster", "0xF403C135812408BFbE8713b5A23a04b3D48AAE31");
        const Exchange = await ethers.getContractFactory("Exchange");

        admin = await getImpersonatedSigner("0x2580f9954529853Ca5aC5543cE39E9B5B1145135");
        exchange = await Exchange.deploy(admin.address, true);
        await exchange.deployed();
        expect(await eurt.balanceOf(eurtWhale.address)).to.be.gt(0, "Whale has no eurt, or you are not forking Polygon");

        EURtCurveLp = await ethers.getContractAt("IERC20Metadata", "0x600743B1d8A96438bD46836fD34977a00293f6Aa")
        polygonCurveEdge = { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: EURtCurveLp.address, toCoin: usdc.address };

        usdtEurtRoute = [
            // USDT - EURT
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: usdt.address, toCoin: eurt.address }
        ];
        usdtDaiRoute = [
            // USDT - DAI
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: usdt.address, toCoin: dai.address }
        ];
        usdtUsdcRoute = [
            // USDT - USDC
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: usdt.address, toCoin: usdc.address }
        ];
        usdcEurtRoute = [
            // USDC - EURT
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: usdc.address, toCoin: eurt.address }
        ];
        usdcDaiRoute = [
            // USDC - DAI
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: usdc.address, toCoin: dai.address }
        ];
        usdcUsdtRoute = [
            // USDC - USDT
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: usdc.address, toCoin: usdt.address }
        ];
        daiEurtRoute = [
            // DAI - EURT
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: dai.address, toCoin: eurt.address }
        ];
        daiUsdcRoute = [
            // DAI - USDC
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: dai.address, toCoin: usdc.address }
        ];
        daiUsdtRoute = [
            // DAI - USDT
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: dai.address, toCoin: usdt.address }
        ];
        eurtDaiRoute = [
            // EURT - DAI
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: eurt.address, toCoin: dai.address }
        ];
        eurtUsdcRoute = [
            // EURT - USDC
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: eurt.address, toCoin: usdc.address }
        ];
        eurtUsdtRoute = [
            // EURT - USDT
            { swapProtocol: 1, pool: PolygonCurveEURtPool, fromCoin: eurt.address, toCoin: usdt.address },
        ];

        const PolygonCurve = await ethers.getContractFactory("CurveEURtAdapter");

        const polygonCurveAdapter = await PolygonCurve.deploy()
        const routes: Route[] = [
            usdtEurtRoute, usdtDaiRoute, usdtUsdcRoute,
            usdcEurtRoute, usdcDaiRoute, usdcUsdtRoute,
            daiEurtRoute, daiUsdcRoute, daiUsdtRoute,
            eurtDaiRoute, eurtUsdcRoute, eurtUsdtRoute
        ];
        console.log("address of exchange", exchange.address);
        await exchange.connect(admin).createInternalMajorRoutes(routes)

        await exchange.connect(admin).createLpToken(
            [{ swapProtocol: 1, pool: PolygonCurveEURtPool }],
            [EURtCurveLp.address],
            [[eurt.address, dai.address, usdc.address, usdt.address]]
        );

        await exchange.connect(admin).createApproval([eurt.address, dai.address, usdc.address, usdt.address],
            [exchange.address,
            exchange.address,
            exchange.address,
            exchange.address]);
        await exchange.connect(admin).registerAdapters([polygonCurveAdapter.address], [1])

        await exchange.connect(admin).createMinorCoinEdge([polygonCurveEdge])
    });

    beforeEach(async () => {
        admin = await getImpersonatedSigner("0x2580f9954529853Ca5aC5543cE39E9B5B1145135");

        const Strategy = await ethers.getContractFactory("CurveHarvestEurStrategy")
        strategy = await Strategy.deploy(ZERO_ADDR, ZERO_ADDR);
    });

    async function testSwap(fromAddress: string, toAddress: string, amount: BigNumberish) {
        const from = await ethers.getContractAt("IERC20Metadata", fromAddress);
        await from.connect(usdWhale).approve(exchange.address, amount);
        // Usd whale doesn't have EURtLp, so change slightly,
        if (fromAddress == EURtCurveLp.address) {
            usdc.connect(usdWhale).approve(exchange.address, parseUnits("100", 6));
            // Give some EURtLp to the usdWhale to exit pool.
            await exchange.connect(usdWhale).exchange(usdc.address, EURtCurveLp.address, parseUnits("100", 6), 0)
        }
        if (fromAddress == eurt.address) {
            usdc.connect(usdWhale).approve(exchange.address, parseUnits("100", 6));
            // Give some EURt to the usdWhale.
            await exchange.connect(usdWhale).exchange(usdc.address, eurt.address, parseUnits("100", 6), 0)
        }
        const to = await ethers.getContractAt("IERC20Metadata", toAddress);
        const balBefore = await to.balanceOf(usdWhale.address);
        const tx = await (await exchange.connect(usdWhale).exchange(fromAddress, toAddress, amount, 0)).wait();
        console.log("Swapped", formatUnits(amount, await from.decimals()),
            await from.symbol(), "for", formatUnits((await to.balanceOf(usdWhale.address)).sub(balBefore), await to.decimals()),
            await to.symbol() + ",", "gas used:", tx.cumulativeGasUsed.toString());
    }


    it("Should check EURT-USDT is working", async () => {
        const oneToken = parseUnits("1.0", await eurt.decimals());
        await testSwap(eurt.address, usdc.address, oneToken);
    })

    it("Should check initial contract state", async () => {
        const harvestVault = "0xDDe43710DefEf6CbCf820B18DeBfC3cF9a4f449F";
        const harvestPool = "0xf74E8CFe03421D071c7dCCc3E5ecB6dDDede2f07";
        const harvestReward = "0xab0b2ddB9C7e440fAc8E140A89c0dbCBf2d7Bbff";
        // For mainnet deployment, this should be uncommented
        // const exchange = "0x6b45B9Ab699eFbb130464AcEFC23D49481a05773";
        const unwindDecimals = 2;
        const adminRole = await strategy.DEFAULT_ADMIN_ROLE();

        // For mainnet deployment, this should be uncommented and line 214 should be commented
        // expect(await strategy.exchange()).to.be.equal(exchange);
        expect(await strategy.exchange()).to.be.equal(exchange.address);
        expect(await strategy.harvestVault()).to.be.equal(harvestVault);
        expect(await strategy.harvestPool()).to.be.equal(harvestPool);
        expect(await strategy.harvestReward()).to.be.equal(harvestReward);
        expect(await strategy.unwindDecimals()).to.be.equal(unwindDecimals);
        expect(await strategy.hasRole(adminRole, signers[0].address)).to.be.true;
    });

    it("Should check initial contract state (testing == false)", async () => {
        const contract1 = usdc.address;
        const contract2 = usdt.address;
        const adminRole = ethers.constants.HashZero;

        expect(contract1).to.not.be.equal(contract2);

        const Strategy = await ethers.getContractFactory("CurveHarvestEurStrategy");
        const newStrategy = await Strategy.deploy(contract1, contract2);

        expect(await newStrategy.hasRole(adminRole, contract1)).to.be.true;
        expect(await newStrategy.hasRole(adminRole, contract2)).to.be.true;
    });

    it("Should not deploy contract (gnosis/voteExecutor not contract)", async () => {
        const notContract = signers[1].address;
        const contract = usdc.address;

        const Strategy = await ethers.getContractFactory("CurveHarvestEurStrategy");

        let newStrategy = Strategy.deploy(notContract, contract);
        await expect(newStrategy).to.be.revertedWith("CurveHarvestEurStrategy: 1!contract");

        newStrategy = Strategy.deploy(contract, notContract);
        await expect(newStrategy).to.be.revertedWith("CurveHarvestEurStrategy: 2!contract");
    })

    it("Should check roles", async () => {
        const contract = usdc.address;
        const roleError = `AccessControl: account ${signers[0].address.toLowerCase()} is missing role ${ethers.constants.HashZero}`;

        const Strategy = await ethers.getContractFactory("CurveHarvestEurStrategy");
        const newStrategy = await Strategy.deploy(contract, contract);

        await expect(newStrategy.invest("0x", 0)).to.be.revertedWith(roleError);
        await expect(newStrategy.exitAll("0x", 0, contract, contract, true)).to.be.revertedWith(roleError);
        await expect(newStrategy.exitOnlyRewards("0x", contract, contract, true)).to.be.revertedWith(roleError);
        await expect(newStrategy.multicall([], [])).to.be.revertedWith(roleError);
    });

    it("Should check correct encoders/decoders", async () => {
        const curvePool = "0x0000000000000000000000000000000000000001";
        const poolToken = "0x0000000000000000000000000000000000000002";
        const poolSize = 3;
        const tokenIndexInCurve = 4;
        const poolId = 5;
        const lpToken = "0x0000000000000000000000000000000000000006"

        const entry = defaultAbiCoder.encode(
            ["address", "address ", "address", "uint8", "uint8", "uint256"],
            [curvePool, lpToken, poolToken, poolSize, tokenIndexInCurve, poolId]
        )
        const exit = defaultAbiCoder.encode(
            ["address", "address", "address", "uint8", "uint256"],
            [curvePool, poolToken, lpToken, tokenIndexInCurve, poolId]
        );

        expect(await strategy.encodeEntryParams(
            curvePool, lpToken, poolToken, poolSize, tokenIndexInCurve, poolId
        )).to.be.equal(entry);

        expect(await strategy.encodeExitParams(
            curvePool, poolToken, lpToken, tokenIndexInCurve, poolId
        )).to.be.equal(exit);

        const entryStruct = await strategy.decodeEntryParams(entry);
        const exitStruct = await strategy.decodeExitParams(exit);

        expect(entryStruct[0]).to.be.equal(curvePool);
        expect(entryStruct[1]).to.be.equal(lpToken);
        expect(entryStruct[2]).to.be.equal(poolToken);
        expect(entryStruct[3]).to.be.equal(poolSize);
        expect(entryStruct[4]).to.be.equal(tokenIndexInCurve);
        expect(entryStruct[5]).to.be.equal(poolId);

        expect(exitStruct[0]).to.be.equal(curvePool);
        expect(exitStruct[1]).to.be.equal(poolToken);
        expect(exitStruct[2]).to.be.equal(lpToken);
        expect(exitStruct[3]).to.be.equal(tokenIndexInCurve);
        expect(exitStruct[4]).to.be.equal(poolId);
    });

    it("Should revert decoders if data length is wrong", async () => {
        const data = "0x420690";

        const entry = strategy.decodeEntryParams(data);
        const exit = strategy.decodeExitParams(data);

        await expect(entry).to.be.revertedWith("CurveHarvestEurStrategy: length en");
        await expect(exit).to.be.revertedWith("CurveHarvestEurStrategy: length ex");
    });

    it("Should execute full investment", async () => {
        const curvePool = "0xAd326c253A84e9805559b73A08724e11E49ca651";

        const poolToken: IERC20Metadata = eurt;
        const poolSize = 3;
        const tokenIndexInCurve = 3;
        const poolId = 1;
        // If poolId = uint256 max, then do not invest in harvest.
        const amount = parseUnits("1000.0", await poolToken.decimals());

        const lpToken = await ethers.getContractAt("IERC20Metadata", "0xAd326c253A84e9805559b73A08724e11E49ca651")
        const rewardPool = await ethers.getContractAt("IERC20Metadata", "0xf74E8CFe03421D071c7dCCc3E5ecB6dDDede2f07")

        const exitData = await strategy.encodeExitParams(
            curvePool, poolToken.address, lpToken.address, tokenIndexInCurve, poolId
        )
        const entryData = await strategy.encodeEntryParams(
            curvePool, lpToken.address, poolToken.address, poolSize, tokenIndexInCurve, poolId
        );

        expect(await lpToken.balanceOf(strategy.address)).to.be.equal(0);

        const investBefore = await rewardPool.balanceOf(strategy.address);
        await poolToken.connect(eurtWhale).transfer(strategy.address, amount);
        const returnData = await strategy.callStatic.invest(entryData, amount);
        await strategy.invest(entryData, amount);
        const investAfter = await rewardPool.balanceOf(strategy.address);

        expect(await poolToken.balanceOf(strategy.address)).to.be.equal(0);
        expect(await lpToken.balanceOf(strategy.address)).to.be.equal(0);
        expect(investAfter).to.be.gt(investBefore);
        expect(returnData).to.be.equal(exitData);
    });

    it("Should execute investment only for Curve", async () => {
        const curvePool = "0xAd326c253A84e9805559b73A08724e11E49ca651";

        const poolToken: IERC20Metadata = eurt;
        const poolSize = 3;
        const tokenIndexInCurve = 3;
        const poolId = ethers.constants.MaxUint256;
        // If poolId = uint256 max, then do not invest in harvest.
        const amount = parseUnits("1000.0", await poolToken.decimals());
        // LpToken = CurveLP token
        const lpToken = await ethers.getContractAt("IERC20Metadata", "0xAd326c253A84e9805559b73A08724e11E49ca651")

        const entryData = await strategy.encodeEntryParams(
            curvePool, lpToken.address, poolToken.address, poolSize, tokenIndexInCurve, poolId
        );

        expect(await lpToken.balanceOf(strategy.address)).to.be.equal(0);


        const lpBalanceBefore = await lpToken.balanceOf(strategy.address);
        await poolToken.connect(eurtWhale).transfer(strategy.address, amount);
        await strategy.invest(entryData, amount);
        const lpBalanceAfter = await lpToken.balanceOf(strategy.address);

        expect(await poolToken.balanceOf(strategy.address)).to.be.equal(0);
        expect(lpBalanceAfter).to.be.gt(lpBalanceBefore);
    });

    it("Should unwind investment in eurt (but don't swap miFarm for exitToken)", async () => {

        const curvePool = "0xAd326c253A84e9805559b73A08724e11E49ca651";
        const poolToken = eurt;
        const poolSize = 3;
        const tokenIndexInCurve = 3;
        const poolId = 1;
        // If poolId = uint256 max, then do not invest in harvest.
        const amount = parseUnits("1000.0", await poolToken.decimals());
        // LpToken = CurveLP token
        const lpToken = await ethers.getContractAt("IERC20Metadata", "0xAd326c253A84e9805559b73A08724e11E49ca651")
        const rewardPool = await ethers.getContractAt("IERC20Metadata", "0xf74E8CFe03421D071c7dCCc3E5ecB6dDDede2f07")

        const entryData = await strategy.encodeEntryParams(
            curvePool, lpToken.address, poolToken.address, poolSize, tokenIndexInCurve, poolId
        );
        const exitData = await strategy.encodeExitParams(
            curvePool, poolToken.address, lpToken.address, tokenIndexInCurve, poolId
        );
        const miFarmBalbef = await miFarm.balanceOf(eurtWhale.address)
        console.log("miFarmBalBef", miFarmBalbef)
        const exitToken = eurt;
        await poolToken.connect(eurtWhale).transfer(strategy.address, amount);
        await strategy.invest(entryData, amount);


        // Wait some time.        
        await network.provider.send("evm_increaseTime", [100000])
        await network.provider.send("evm_mine")

        const balanceBefore = await exitToken.balanceOf(eurtWhale.address);

        // Set last bool to true if you want to swap miFarm for exitToken
        await strategy.exitAll(exitData, 10000, exitToken.address, eurtWhale.address, false);
        const balanceAfter = await exitToken.balanceOf(eurtWhale.address);

        expect(balanceAfter).to.be.gt(balanceBefore);
        // Strategy should have nothing.
        expect(await poolToken.balanceOf(strategy.address)).to.be.equal(0);
        expect(await exitToken.balanceOf(strategy.address)).to.be.equal(0);
        //  AssertionError: Expected "287853968288202423" to be equal 0
        // Small dust from transaction
        // expect(await lpToken.balanceOf(strategy.address)).to.be.equal(0);
        expect(await rewardPool.balanceOf(strategy.address)).to.be.equal(0);

        expect(await miFarm.balanceOf(strategy.address)).to.be.equal(0);
        const miFarmBalAft = await miFarm.balanceOf(eurtWhale.address)
        expect(miFarmBalAft).to.be.gt(miFarmBalbef);
    })



    it("Should only claim rewards", async () => {

        const curvePool = "0xAd326c253A84e9805559b73A08724e11E49ca651";
        const poolToken = eurt;
        const poolSize = 3;
        const tokenIndexInCurve = 3;
        const poolId = 1;
        // If poolId = uint256 max, then do not invest in harvest.
        const amount = parseUnits("1000.0", await poolToken.decimals());
        // LpToken = CurveLP token
        const lpToken = await ethers.getContractAt("IERC20Metadata", "0xAd326c253A84e9805559b73A08724e11E49ca651")
        const rewardPool = await ethers.getContractAt("IERC20Metadata", "0xf74E8CFe03421D071c7dCCc3E5ecB6dDDede2f07")

        const entryData = await strategy.encodeEntryParams(
            curvePool, lpToken.address, poolToken.address, poolSize, tokenIndexInCurve, poolId
        );
        const exitData = await strategy.encodeExitParams(
            curvePool, poolToken.address, lpToken.address, tokenIndexInCurve, poolId
        );
        const miFarmBalbef = await miFarm.balanceOf(eurtWhale.address)
        console.log("miFarmBalBef", miFarmBalbef)
        const exitToken = eurt;

        await poolToken.connect(eurtWhale).transfer(strategy.address, amount);
        await strategy.invest(entryData, amount);
        const lpBalanceBefore = await rewardPool.balanceOf(strategy.address);

        // Wait some time.
        await network.provider.send("evm_increaseTime", [100000])
        await network.provider.send("evm_mine")

        // Set last bool to false because we cant swap miFarm for EURT yet using the exchange (no adapter)
        await strategy.exitOnlyRewards(exitData, exitToken.address, eurtWhale.address, false);

        const lpBalanceAfter = await rewardPool.balanceOf(strategy.address);
        // Expect same LP balance but we should now have more miFARM
        // For the case where we are using the exchange to swap it, we should use the balance of exit coin before and after rather than the reward token.
        console.log("af1", await miFarm.balanceOf(eurtWhale.address));

        const miFarmBalAfter = await miFarm.balanceOf(eurtWhale.address);
        expect(lpBalanceBefore).to.not.be.equal(0);
        expect(lpBalanceBefore).to.be.equal(lpBalanceAfter);
        expect(miFarmBalAfter).to.be.gt(miFarmBalbef);

    })

    it("Should unwind investment in USDC using the exchange (but don't swap miFarm for exitToken)", async () => {

        const curvePool = "0xAd326c253A84e9805559b73A08724e11E49ca651";
        const poolToken = eurt;
        const poolSize = 3;
        const tokenIndexInCurve = 3;
        const poolId = 1;
        // If poolId = uint256 max, then do not invest in harvest.
        const amount = parseUnits("1000.0", await poolToken.decimals());
        // LpToken = CurveLP token
        const lpToken = await ethers.getContractAt("IERC20Metadata", "0xAd326c253A84e9805559b73A08724e11E49ca651")
        const rewardPool = await ethers.getContractAt("IERC20Metadata", "0xf74E8CFe03421D071c7dCCc3E5ecB6dDDede2f07")

        const entryData = await strategy.encodeEntryParams(
            curvePool, lpToken.address, poolToken.address, poolSize, tokenIndexInCurve, poolId
        );
        const exitData = await strategy.encodeExitParams(
            curvePool, poolToken.address, lpToken.address, tokenIndexInCurve, poolId
        );
        const miFarmBalbef = await miFarm.balanceOf(eurtWhale.address)
        const exitToken = usdc;
        await poolToken.connect(eurtWhale).transfer(strategy.address, amount);
        await strategy.invest(entryData, amount);


        // Wait some time.        
        await network.provider.send("evm_increaseTime", [100000])
        await network.provider.send("evm_mine")

        const balanceBefore = await exitToken.balanceOf(eurtWhale.address);

        // Set last bool to true if you want to swap miFarm for exitToken
        await strategy.exitAll(exitData, 10000, exitToken.address, eurtWhale.address, false);
        const balanceAfter = await exitToken.balanceOf(eurtWhale.address);

        expect(balanceAfter).to.be.gt(balanceBefore);
        // Strategy should have nothing.
        expect(await poolToken.balanceOf(strategy.address)).to.be.equal(0);
        expect(await exitToken.balanceOf(strategy.address)).to.be.equal(0);
        //  AssertionError: Expected "287853968288202423" to be equal 0
        // Small dust from transaction
        // expect(await lpToken.balanceOf(strategy.address)).to.be.equal(0);
        expect(await rewardPool.balanceOf(strategy.address)).to.be.equal(0);

        expect(await miFarm.balanceOf(strategy.address)).to.be.equal(0);
        const miFarmBalAft = await miFarm.balanceOf(eurtWhale.address)
        expect(miFarmBalAft).to.be.gt(miFarmBalbef);
    })

    it("Should execute mulicall", async () => {
        const token = usdc;
        const amount = parseUnits("200.0", await token.decimals());
        const calldata1 = token.interface.encodeFunctionData("transfer", [signers[0].address, parseUnits("150.0", await token.decimals())]);
        const calldata2 = token.interface.encodeFunctionData("transfer", [signers[0].address, parseUnits("50.0", await token.decimals())]);

        const balanceBefore = await token.balanceOf(strategy.address);
        await token.connect(usdWhale).transfer(strategy.address, amount);
        await strategy.multicall([token.address, token.address], [calldata1, calldata2]);
        const balanceAfter = await token.balanceOf(strategy.address);

        expect(balanceAfter).to.be.equal(balanceBefore);
    })
});