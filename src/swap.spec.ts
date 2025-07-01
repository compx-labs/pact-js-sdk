import algosdk from "algosdk";

import { PactClient } from "./client";
import { PoolType, StableswapPoolParams } from "./pool";
import { PoolState } from "./poolState";
import { StableswapCalculator } from "./stableswapCalculator";
import { Swap } from "./swap";
import {
  addLiquidity,
  deployConstantProductContract,
  deployNftConstantProductContract,
  deployStableswapContract,
  makeFreshPoolTestbed,
} from "./testPoolUtils";
import { algod, createAsset, newAccount, signAndSend } from "./testUtils";
import { TransactionGroup } from "./transactionGroup";

async function testSwap(swap: Swap, account: algosdk.Account) {
  // Perform the swap.
  const oldState = swap.pool.state;
  const swapTxGroup = await swap.prepareTxGroup(
    algosdk.encodeAddress(account.addr.publicKey),
  );
  await signAndSend(swapTxGroup, account);
  await swap.pool.updateState();

  // Compare the simulated effect with what really happened on the blockchain.
  assertSwapEffect(swap, oldState, swap.pool.state);
}

function assertSwapEffect(
  swap: Swap,
  oldState: PoolState,
  newState: PoolState,
) {
  if (swap.assetDeposited === swap.pool.primaryAsset) {
    expect(swap.effect.amountDeposited).toBe(
      newState.totalPrimary - oldState.totalPrimary,
    );
    expect(swap.effect.amountReceived).toBe(
      oldState.totalSecondary - newState.totalSecondary,
    );
  } else {
    expect(swap.effect.amountReceived).toBe(
      oldState.totalPrimary - newState.totalPrimary,
    );
    expect(swap.effect.amountDeposited).toBe(
      newState.totalSecondary - oldState.totalSecondary,
    );
  }

  expect(swap.effect.minimumAmountReceived).toBe(
    Math.ceil(
      Number(
        swap.effect.amountReceived -
          swap.effect.amountReceived * (swap.slippagePct / 100n),
      ),
    ),
  );

  const diff_ratio = swap.assetDeposited.ratio / swap.assetReceived.ratio;
  expect(swap.effect.price).toBe(
    ((swap.effect.amountReceived + swap.effect.fee) /
      swap.effect.amountDeposited) *
      diff_ratio,
  );

  expect(swap.effect.primaryAssetPriceAfterSwap).toEqual(
    newState.primaryAssetPrice,
  );
  expect(swap.effect.secondaryAssetPriceAfterSwap).toEqual(
    newState.secondaryAssetPrice,
  );

  expect(swap.effect.primaryAssetPriceImpactPct).toBe(
    (newState.primaryAssetPrice * 100n) / oldState.primaryAssetPrice - 100n,
  );
  expect(swap.effect.secondaryAssetPriceImpactPct).toBe(
    (newState.secondaryAssetPrice * 100n) / oldState.secondaryAssetPrice - 100n,
  );
}

function swapTestCase(poolType: PoolType) {
  it("empty liquidity", async () => {
    const { algo, pool } = await makeFreshPoolTestbed({ poolType: poolType });

    expect(() =>
      pool.prepareSwap({
        amount: 1000n,
        asset: algo,
        slippagePct: 10n,
      }),
    ).toThrow("Pool is empty and swaps are impossible.");
  });

  it("asset not in the pool", async () => {
    const { pact, pool, account } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const shitcoinIndex = await createAsset(account);
    const shitcoin = await pact.fetchAsset(shitcoinIndex);

    expect(() =>
      pool.prepareSwap({
        amount: 1000n,
        asset: shitcoin,
        slippagePct: 10n,
      }),
    ).toThrow(`Asset with index ${shitcoin.index} is not a pool asset.`);
  });

  it("primary with equal liquidity", async () => {
    const { account, algo, coin, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [10_000n, 10_000n, 1_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10n,
    });

    expect(swap.assetReceived).toBe(coin);
    expect(swap.assetDeposited).toBe(algo);
    expect(swap.slippagePct).toBe(10);

    await testSwap(swap, account);
  });

  it("primary with not equal liquidity", async () => {
    const { account, algo, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000n, 25_000n, 1_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10n,
    });

    await testSwap(swap, account);
  });

  it("secondary with equal liquidity", async () => {
    const { account, coin, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000n, 20_000n, 1_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10n,
    });

    await testSwap(swap, account);
  });

  it("secondary with not equal liquidity", async () => {
    const { account, coin, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [25_000n, 20_000n, 1_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10n,
    });

    await testSwap(swap, account);
  });

  it("with custom fee bps", async () => {
    const TestBedA = await makeFreshPoolTestbed({
      poolType: poolType,
      feeBps: 10n,
    });
    const TestBedB = await makeFreshPoolTestbed({
      poolType: poolType,
      feeBps: 2000n,
    });

    expect(TestBedA.pool.params.feeBps).toBe(10n);
    expect(TestBedB.pool.params.feeBps).toBe(2000n);

    await addLiquidity(TestBedA.account, TestBedA.pool, 20_000n, 20_000n);
    await addLiquidity(TestBedB.account, TestBedB.pool, 20_000n, 20_000n);

    const swapA = TestBedA.pool.prepareSwap({
      amount: 10_000n,
      asset: TestBedA.algo,
      slippagePct: 10n,
    });
    const swapB = TestBedB.pool.prepareSwap({
      amount: 10_000n,
      asset: TestBedB.algo,
      slippagePct: 10n,
    });

    expect(swapB.effect.price).toBe(swapA.effect.price);
    expect(swapB.effect.fee).toBeGreaterThan(swapA.effect.fee);
    expect(swapB.effect.amountReceived).toBeLessThan(
      swapA.effect.amountReceived,
    );

    // Perform the swaps and check if the simulated effect matches what really happened in the blockchain.

    const swapATxGroup = await swapA.prepareTxGroup(
      algosdk.encodeAddress(TestBedA.account.addr.publicKey),
    );
    await signAndSend(swapATxGroup, TestBedA.account);
    await TestBedA.pool.updateState();

    const swapBTxGroup = await swapB.prepareTxGroup(
      algosdk.encodeAddress(TestBedB.account.addr.publicKey),
    );
    await signAndSend(swapBTxGroup, TestBedB.account);
    await TestBedB.pool.updateState();

    expect(TestBedA.pool.state.totalSecondary).toBe(
      20_000n - swapA.effect.amountReceived,
    );
    expect(TestBedB.pool.state.totalSecondary).toBe(
      20_000n - swapB.effect.amountReceived,
    );
  });

  it("with different slippage", async () => {
    const { account, algo, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    await addLiquidity(account, pool, 20_000n, 20_000n);

    expect(() =>
      pool.prepareSwap({
        amount: 10_000n,
        asset: algo,
        slippagePct: -1n,
      }),
    ).toThrow("Splippage must be between 0 and 100");

    const swapA = pool.prepareSwap({
      amount: 10_000n,
      asset: algo,
      slippagePct: 0n,
    });
    const swapB = pool.prepareSwap({
      amount: 10_000n,
      asset: algo,
      slippagePct: 2n,
    });
    const swapC = pool.prepareSwap({
      amount: 10_000n,
      asset: algo,
      slippagePct: 60n,
    });
    const swapD = pool.prepareSwap({
      amount: 10_000n,
      asset: algo,
      slippagePct: 100n,
    });

    expect(swapA.effect.minimumAmountReceived).toBe(
      swapA.effect.amountReceived,
    );

    expect(swapB.effect.minimumAmountReceived).toBeLessThan(
      swapB.effect.amountReceived,
    );
    expect(swapB.effect.minimumAmountReceived).toBeGreaterThan(0);

    expect(swapC.effect.minimumAmountReceived).toBeLessThan(
      swapC.effect.amountReceived,
    );
    expect(swapC.effect.minimumAmountReceived).toBeLessThan(
      swapB.effect.minimumAmountReceived,
    );
    expect(swapC.effect.minimumAmountReceived).toBeGreaterThan(0);

    expect(swapD.effect.minimumAmountReceived).toBe(0);

    // Now let's do a swap that change the price.
    const swap = pool.prepareSwap({
      amount: 10_000n,
      asset: algo,
      slippagePct: 0n,
    });
    const swapTxGroup = await swap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(swapTxGroup, account);

    // Swap A and B should fail because slippage is too low.
    const swapATxGroup = await swapA.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(() => signAndSend(swapATxGroup, account)).rejects.toMatchObject({
      status: 400,
    });
    const swapBTxGroup = await swapB.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(() => signAndSend(swapBTxGroup, account)).rejects.toMatchObject({
      status: 400,
    });

    await pool.updateState();
    expect(pool.state.totalSecondary).toBe(
      20_000n - swap.effect.amountReceived,
    ); // no change yet

    // Swap C and D should pass;
    const swapCTxGroup = await swapC.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(swapCTxGroup, account);
    await pool.updateState();
    const swappedCAmount =
      20_000n - swap.effect.amountReceived - pool.state.totalSecondary;
    expect(swappedCAmount).toBeLessThan(swapC.effect.amountReceived);
    expect(swappedCAmount).toBeGreaterThan(swapC.effect.minimumAmountReceived);

    const swapDTxGroup = await swapD.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(swapDTxGroup, account);
    await pool.updateState();
    const swappedDAmount =
      20_000n -
      swap.effect.amountReceived -
      swappedCAmount -
      pool.state.totalSecondary;
    expect(swappedDAmount).toBeLessThan(swapD.effect.amountReceived);
    expect(swappedDAmount).toBeGreaterThan(swapD.effect.minimumAmountReceived);
  });

  it("swap for exact primary with equal liquidity", async () => {
    const { account, algo, coin, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000n, 20_000n, 1_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const reversedSwap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10n,
      swapForExact: true,
    });

    expect(reversedSwap.assetReceived).toBe(coin);
    expect(reversedSwap.assetDeposited).toBe(algo);
    expect(reversedSwap.slippagePct).toBe(10n);
    expect(reversedSwap.effect.amountReceived).toBe(1000n);
    expect(reversedSwap.effect.amountDeposited).toBeGreaterThan(1000n);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountDeposited,
      asset: algo,
      slippagePct: 10n,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountDeposited).toBe(
      reversedSwap.effect.amountDeposited,
    );
    expect(swap.effect.amountReceived).toBe(reversedSwap.effect.amountReceived);

    await testSwap(reversedSwap, account);
  });

  it("swap for exact secondary with equal liquidity", async () => {
    const { account, algo, coin, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000n, 20_000n, 1_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const reversedSwap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10n,
      swapForExact: true,
    });

    expect(reversedSwap.assetReceived).toBe(algo);
    expect(reversedSwap.assetDeposited).toBe(coin);
    expect(reversedSwap.slippagePct).toBe(10n);
    expect(reversedSwap.effect.amountReceived).toBe(1000n);
    expect(reversedSwap.effect.amountDeposited).toBeGreaterThan(1000n);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountDeposited,
      asset: coin,
      slippagePct: 10n,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountDeposited).toBe(
      reversedSwap.effect.amountDeposited,
    );
    expect(swap.effect.amountReceived).toBe(reversedSwap.effect.amountReceived);

    await testSwap(reversedSwap, account);
  });

  it("swap for exact primary with not equal liquidity", async () => {
    const { account, algo, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [15_000n, 25_000n, 2_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const reversedSwap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10n,
      swapForExact: true,
    });

    expect(reversedSwap.effect.amountReceived).toBe(2000n);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountDeposited,
      asset: algo,
      slippagePct: 10n,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountDeposited).toBe(
      reversedSwap.effect.amountDeposited,
    );
    expect(swap.effect.amountReceived).toBe(reversedSwap.effect.amountReceived);

    await testSwap(reversedSwap, account);
  });

  it("swap for exact secondary with not equal liquidity", async () => {
    const { account, coin, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [15_000n, 25_000n, 2_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const reversedSwap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10n,
      swapForExact: true,
    });

    expect(reversedSwap.effect.amountReceived).toBe(2000n);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountDeposited,
      asset: coin,
      slippagePct: 10n,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountDeposited).toBe(
      reversedSwap.effect.amountDeposited,
    );
    expect(swap.effect.amountReceived).toBe(reversedSwap.effect.amountReceived);

    await testSwap(reversedSwap, account);
  });

  it("swap for exact liquidity surpassed", async () => {
    const { account, algo, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });
    await addLiquidity(account, pool, 25_000n, 15_000n);

    // NFT product consumes fee only from primary asset, in case of that we need to change values
    const amounts =
      poolType === "NFT_CONSTANT_PRODUCT"
        ? [20_000n, 15_000n]
        : [20_000n, 15_000n, 14_990n];
    for (const amount of amounts) {
      expect(() =>
        pool.prepareSwap({
          amount,
          asset: algo,
          slippagePct: 10n,
          swapForExact: true,
        }),
      ).toThrow("Current liquidity doesn't allow to swap for this amount.");
    }

    // This swap works.
    const swap = pool.prepareSwap({
      amount: 14_500n,
      asset: algo,
      slippagePct: 10n,
      swapForExact: true,
    });
    expect(swap.effect.amountDeposited).toBeGreaterThan(0);
  });

  it("swap and optin in a single group", async () => {
    const otherAccount = await newAccount();
    const { pact, account, coin, algo, pool } = await makeFreshPoolTestbed({
      poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000n, 20_000n, 1_000n];
    await addLiquidity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10n,
    });

    const suggestedParams = await pact.algod.getTransactionParams().do();
    const optInTx = coin.buildOptInTx(
      algosdk.encodeAddress(otherAccount.addr.publicKey),
      suggestedParams,
    );
    const txs = [
      optInTx,
      ...pool.buildSwapTxs({
        swap,
        address: algosdk.encodeAddress(otherAccount.addr.publicKey),
        suggestedParams,
      }),
    ];

    const group = new TransactionGroup(txs);
    await signAndSend(group, otherAccount);
  });
}

describe("nft constant product swap", () => {
  swapTestCase("NFT_CONSTANT_PRODUCT");

  it("ASA to ASA", async () => {
    const account = await newAccount();
    const pact = new PactClient(algod);

    const coinAIndex = await createAsset(account, {
      name: "COIN_A",
      decimals: 3n,
    });
    const coinBIndex = await createAsset(account, {
      name: "COIN_B",
      decimals: 2n,
    });

    const appId = await deployNftConstantProductContract(
      account,
      coinAIndex,
      coinBIndex,
    );
    const pool = await pact.fetchPoolById(appId);

    await addLiquidity(account, pool, 20_000n, 20_000n);
    await pool.updateState();
    expect(pool.state).toEqual({
      primaryAssetPrice: 10n, // because different decimal places for both assets.
      secondaryAssetPrice: 1n,
      totalLiquidity: 20000n,
      totalPrimary: 20000n,
      totalSecondary: 20000n,
    });

    const swap = pool.prepareSwap({
      amount: 1000n,
      asset: pool.primaryAsset,
      slippagePct: 10n,
    });
    expect(swap.effect.amplifier).toBe(0n);
    await testSwap(swap, account);
  });
});

describe("stable swap", () => {
  swapTestCase("STABLESWAP");

  it("changing amplifier", async () => {
    const { pool } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
      amplifier: 10n,
    });

    const aPrecision = 1000n;

    const params = pool.params as StableswapPoolParams;
    const swapCalculator = pool.calculator
      .swapCalculator as StableswapCalculator;

    let initialTime = params.initialATime;

    jest.useFakeTimers("modern");
    jest.setSystemTime(Number(initialTime));

    expect(swapCalculator.getAmplifier()).toBe(10n * aPrecision);

    // Let's increase the amplifier.
    params.futureA = 20n * 1000n;
    params.futureATime += 1000n;

    const swapArgs: [bigint, bigint, bigint] = [2000n, 1500n, 1000n];

    expect(swapCalculator.getAmplifier()).toBe(10n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(933n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1084n);

    jest.setSystemTime(Number((initialTime + 1000n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(11n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(938n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1077n);

    jest.setSystemTime(Number((initialTime + 500n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(15n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(952n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1056n);

    jest.setSystemTime(Number((initialTime + 1000n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(20n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(962n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1043n);

    jest.setSystemTime(Number((initialTime + 2000n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(20n * aPrecision);

    // Let's decrease the amplifier.
    params.initialA = params.futureA;
    params.initialATime = BigInt(Date.now());
    params.futureA = 15n * 1000n;
    params.futureATime = params.initialATime + 2000n;
    initialTime = params.initialATime;

    expect(swapCalculator.getAmplifier()).toBe(20n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(962n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1043n);

    jest.setSystemTime(Number((initialTime + 100n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(19750n);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(962n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1044n);

    jest.setSystemTime(Number((initialTime + 1000n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(17500n);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(957n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1050n);

    jest.setSystemTime(Number((initialTime + 2000n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(15n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(952n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1056n);

    jest.setSystemTime(Number((initialTime + 3000n) * 1000n));
    expect(swapCalculator.getAmplifier()).toBe(15n * aPrecision);

    params.futureA = 100n * 1000n;
    expect(swapCalculator.getAmplifier()).toBe(100n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(992n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1008n);
  });

  it("swap with big amplifier", async () => {
    const { account, pool, algo } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
      amplifier: 200n,
    });

    await addLiquidity(account, pool, 20000n, 15000n);

    const swap = pool.prepareSwap({
      amount: 1000n,
      asset: algo,
      slippagePct: 0n,
    });

    expect(swap.effect.amountReceived + swap.effect.fee).toBe(999n);
    expect(swap.effect.amplifier).toBe(200n);

    await testSwap(swap, account);
  });

  it("ASA to ASA", async () => {
    const account = await newAccount();
    const pact = new PactClient(algod);

    const coinAIndex = await createAsset(account, {
      name: "COIN_A",
      decimals: 2n,
    });
    const coinBIndex = await createAsset(account, {
      name: "COIN_B",
      decimals: 2n,
    });

    const appId = await deployStableswapContract(
      account,
      coinAIndex,
      coinBIndex,
    );
    const pool = await pact.fetchPoolById(appId);

    await addLiquidity(account, pool, 1_000_000n, 1_000_000n);
    await pool.updateState();
    expect(pool.state).toMatchObject({
      totalLiquidity: 1_000_000n,
      totalPrimary: 1_000_000n,
      totalSecondary: 1_000_000n,
      primaryAssetPrice: 1n,
      secondaryAssetPrice: 1n,
    });

    const swap = pool.prepareSwap({
      amount: 100_000n,
      asset: pool.primaryAsset,
      slippagePct: 10n,
    });

    await testSwap(swap, account);
  });
});
