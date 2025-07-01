import algosdk from "algosdk";

import { Asset } from "./asset";
import { PactClient } from "./client";
import { Pool } from "./pool";
import { StableswapPoolParams } from "./pool";
import {
  PoolTestBed,
  deployConstantProductContract,
  deployStableswapContract,
  makeFreshPoolTestbed,
} from "./testPoolUtils";
import { algod, createAsset, newAccount, signAndSend } from "./testUtils";

let poolsApiResults: any[];

function get_api_pool_data() {
  return { results: poolsApiResults };
}

jest.mock("./crossFetch", () => {
  return {
    crossFetch: () => Promise.resolve(get_api_pool_data()),
  };
});

describe("Generic pool", () => {
  let testBed: PoolTestBed;

  beforeAll(async () => {
    testBed = await makeFreshPoolTestbed();

    poolsApiResults = [
      {
        on_chain_id: testBed.pool.appId.toString(),
        primary_asset: { on_chain_id: "0" },
        secondary_asset: { on_chain_id: testBed.coin.index.toString() },
      },
    ];
  });

  it("listing pools", async () => {
    const pact = new PactClient(algod);

    const pools = await pact.listPools();
    expect(pools).toEqual({
      results: [
        {
          on_chain_id: testBed.pool.appId.toString(),
          primary_asset: { on_chain_id: "0" },
          secondary_asset: { on_chain_id: testBed.coin.index.toString() },
        },
      ],
    });
  });

  it("fetching pool by assets", async () => {
    const pact = new PactClient(algod);

    const pools = await pact.fetchPoolsByAssets(testBed.algo, testBed.coin);

    expect(pools.length === 1);
    expect(pools[0].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[0].secondaryAsset.index).toBe(testBed.coin.index);
    expect(pools[0].liquidityAsset.index).toBe(
      testBed.pool.liquidityAsset.index,
    );
    expect(pools[0].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[0].appId).toBe(testBed.pool.appId);

    expect(pools[0].getEscrowAddress()).toBeTruthy();

    // Can fetch by ids.
    const pools2 = await pact.fetchPoolsByAssets(
      testBed.algo.index,
      testBed.coin.index,
    );
    expect(pools2.length === 1);
    expect(pools2[0].primaryAsset.index).toBe(testBed.algo.index);
  });

  it("fetching pool by assets with reversed order", async () => {
    const pact = new PactClient(algod);

    // We reverse the assets order here.
    const pools = await pact.fetchPoolsByAssets(testBed.coin, testBed.algo);

    expect(pools.length === 1);
    expect(pools[0].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[0].secondaryAsset.index).toBe(testBed.coin.index);
    expect(pools[0].liquidityAsset.index).toBe(
      testBed.pool.liquidityAsset.index,
    );
    expect(pools[0].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[0].appId).toBe(testBed.pool.appId);
  });

  it("fetching pool by assets with multiple results", async () => {
    const second_app_id = await deployConstantProductContract(
      testBed.account,
      testBed.algo.index,
      testBed.coin.index,
      { feeBps: 100n },
    );

    poolsApiResults = [
      {
        on_chain_id: testBed.pool.appId.toString(),
        primary_asset: { on_chain_id: "0" },
        secondary_asset: { on_chain_id: testBed.coin.index.toString() },
      },
      {
        on_chain_id: second_app_id.toString(),
        primary_asset: { on_chain_id: "0" },
        secondary_asset: { on_chain_id: testBed.coin.index.toString() },
      },
    ];

    const pact = new PactClient(algod);

    const pools = await pact.fetchPoolsByAssets(testBed.algo, testBed.coin);

    expect(pools.length === 2);

    expect(pools[0].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[0].secondaryAsset.index).toBe(testBed.coin.index);
    expect(
      pools[0].liquidityAsset.index === testBed.pool.liquidityAsset.index,
    ).toBe(true);
    expect(pools[0].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[0].appId).toBe(testBed.pool.appId);
    expect(pools[0].params.feeBps).toBe(30);

    expect(pools[1].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[1].secondaryAsset.index).toBe(testBed.coin.index);
    expect(
      pools[1].liquidityAsset.index === testBed.pool.liquidityAsset.index,
    ).toBe(false);
    expect(pools[1].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[1].appId).toBe(second_app_id);
    expect(pools[1].params.feeBps).toBe(100);
  });

  it("fetching by assets not existing pool", async () => {
    poolsApiResults = [];
    const pact = new PactClient(algod);

    const coin = new Asset(pact.algod, 999999999n);

    const pools = await pact.fetchPoolsByAssets(testBed.algo, coin);
    expect(pools).toEqual([]);
  });

  it("fetching pool by id", async () => {
    const pact = new PactClient(algod);

    const pool = await pact.fetchPoolById(testBed.pool.appId);

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);
    expect(pool.liquidityAsset.index).toBe(testBed.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testBed.pool.appId);
  });

  it("fetching pool by id not existing", async () => {
    const pact = new PactClient(algod);

    await expect(() => pact.fetchPoolById(9999999n)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("get other asset", async () => {
    expect(testBed.pool.getOtherAsset(testBed.algo)).toBe(testBed.coin);
    expect(testBed.pool.getOtherAsset(testBed.coin)).toBe(testBed.algo);

    const shitcoin = new Asset(testBed.pact.algod, testBed.coin.index + 1n);
    expect(() => testBed.pool.getOtherAsset(shitcoin)).toThrow(
      `Asset with index ${shitcoin.index} is not a pool asset.`,
    );
  });
});

function test_parsing_state(
  testBed: PoolTestBed,
  pool: Pool,
  version: number,
  state: object,
  poolType: string,
) {
  expect(pool.primaryAsset.index).toBe(testBed.algo.index);
  expect(pool.secondaryAsset.index).toBe(testBed.coin.index);

  expect(pool.poolType).toBe(poolType);
  expect(pool.version).toBe(version);

  expect(pool.internalState).toEqual(state);
}

describe("Constant product pool", () => {
  it("parsing state version 1", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
      version: 1,
    });
    const pool = testBed.pool;
    const state = {
      A: 0,
      ASSET_A: pool.primaryAsset.index,
      ASSET_B: pool.secondaryAsset.index,
      LTID: pool.liquidityAsset.index,
      B: 0,
      FEE_BPS: pool.feeBps,
      L: 0,
    };
    test_parsing_state(testBed, pool, 0, state, "CONSTANT_PRODUCT");
  });

  it("parsing state", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });
    const pool = testBed.pool;
    const state = {
      A: 0,
      ADMIN: testBed.account.addr,
      ASSET_A: pool.primaryAsset.index,
      ASSET_B: pool.secondaryAsset.index,
      LTID: pool.liquidityAsset.index,
      B: 0,
      CONTRACT_NAME: "PACT AMM",
      FEE_BPS: pool.feeBps,
      L: 0,
      PACT_FEE_BPS: 0,
      TREASURY: testBed.account.addr,
      VERSION: 201,
    };
    test_parsing_state(testBed, pool, 201, state, "CONSTANT_PRODUCT");
  });

  it("parsing state v2", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
      version: 2,
    });
    const pool = testBed.pool;
    const state = {
      A: 0,
      ADMIN: testBed.account.addr,
      ASSET_A: pool.primaryAsset.index,
      ASSET_B: pool.secondaryAsset.index,
      LTID: pool.liquidityAsset.index,
      B: 0,
      CONTRACT_NAME: "PACT AMM",
      FEE_BPS: pool.feeBps,
      L: 0,
      PACT_FEE_BPS: 0,
      PRIMARY_FEES: 0,
      SECONDARY_FEES: 0,
      TREASURY: testBed.account.addr,
      VERSION: 2,
    };
    test_parsing_state(testBed, pool, 2, state, "CONSTANT_PRODUCT");
  });

  it("parsing state nft", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "NFT_CONSTANT_PRODUCT",
    });
    const pool = testBed.pool;
    const state = {
      A: 0,
      ADMIN: testBed.account.addr,
      ASSET_A: pool.primaryAsset.index,
      ASSET_B: pool.secondaryAsset.index,
      LTID: pool.liquidityAsset.index,
      B: 0,
      CONTRACT_NAME: "PACT AMM [NFT]",
      FEE_BPS: pool.feeBps,
      L: 0,
      PACT_FEE_BPS: 0,
      TREASURY: testBed.account.addr,
      VERSION: 200,
    };
    test_parsing_state(testBed, pool, 200, state, "NFT_CONSTANT_PRODUCT");
  });

  async function e2e_scenario(testBed: PoolTestBed) {
    const { account, algo, coin, pool } = testBed;
    expect(pool.state).toEqual({
      totalLiquidity: 0,
      totalPrimary: 0,
      totalSecondary: 0,
      primaryAssetPrice: 0,
      secondaryAssetPrice: 0,
    });

    // Opt in for liquidity asset.
    const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(liqOptInTx, account);

    // Add liquidity.
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 100_000n,
      secondaryAssetAmount: 100_000n,
      slippagePct: 0n,
    });
    const addLiqTxGroup = await liquidityAddition.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(addLiqTxGroup.transactions.length).toBe(3);
    await signAndSend(addLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state).toEqual({
      totalLiquidity: 100_000,
      totalPrimary: 100_000,
      totalSecondary: 100_000,
      primaryAssetPrice: 1,
      secondaryAssetPrice: 1,
    });

    // Remove liquidity.
    const removeLiqTxGroup = await pool.prepareRemoveLiquidityTxGroup({
      address: algosdk.encodeAddress(account.addr.publicKey),
      amount: 10_000n,
    });
    expect(removeLiqTxGroup.transactions.length).toBe(2);
    await signAndSend(removeLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state).toEqual({
      totalLiquidity: 90_000n,
      totalPrimary: 90_000n,
      totalSecondary: 90_000n,
      primaryAssetPrice: 1n,
      secondaryAssetPrice: 1n,
    });

    // Swap algo.
    const algoSwap = await pool.prepareSwap({
      asset: algo,
      amount: 20_000n,
      slippagePct: 2n,
    });
    const algoSwapTxGroup = await algoSwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(algoSwapTxGroup.transactions.length).toBe(2);
    await signAndSend(algoSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(90_000);
    expect(pool.state.totalPrimary > 100_000).toBe(true);
    expect(pool.state.totalSecondary < 100_000).toBe(true);
    expect(pool.state.primaryAssetPrice < 1).toBe(true);
    expect(pool.state.secondaryAssetPrice > 1).toBe(true);

    // Swap secondary.
    const coinSwap = await pool.prepareSwap({
      asset: coin,
      amount: 50_000n,
      slippagePct: 2n,
    });
    const coinSwapTxGroup = await coinSwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(coinSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(90_000);
    expect(pool.state.totalPrimary < 100_000).toBe(true);
    expect(pool.state.totalSecondary > 100_000).toBe(true);
    expect(pool.state.primaryAssetPrice > 1).toBe(true);
    expect(pool.state.secondaryAssetPrice < 1).toBe(true);
  }

  it("e2e scenario version 1", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
      version: 1,
    });
    e2e_scenario(testBed);
  });

  it("e2e scenario", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });
    e2e_scenario(testBed);
  });
  it("e2e scenario nft", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "NFT_CONSTANT_PRODUCT",
    });
    e2e_scenario(testBed);
  });

  it("Pool e2e scenario for asset with 19 decimals", async () => {
    const testBed = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });
    const { account, algo, pact } = testBed;

    const coinBIndex = await createAsset(account, {
      name: "coinA",
      decimals: 19n,
      totalIssuance: 10n ** 19n,
    });

    const appId = await deployConstantProductContract(
      account,
      algo.index,
      coinBIndex,
    );
    const pool = await pact.fetchPoolById(appId);

    expect(pool.calculator.isEmpty).toBe(true);
    expect(pool.secondaryAsset.decimals).toBe(19);

    expect(pool.state).toEqual({
      totalLiquidity: 0n,
      totalPrimary: 0n,
      totalSecondary: 0n,
      primaryAssetPrice: 0n,
      secondaryAssetPrice: 0n,
    });

    // Opt in for liquidity asset.
    const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(liqOptInTx, account);

    // Add liquidity.
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 100_000n,
      secondaryAssetAmount: 10n ** 18n,
      slippagePct: 0n,
    });
    const addLiqTxGroup = await liquidityAddition.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(addLiqTxGroup.transactions.length).toBe(3n);
    await signAndSend(addLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalSecondary).toBe(10n ** 18n);
    let lastState = pool.state;

    // Swap algo.
    const algoSwap = await pool.prepareSwap({
      asset: algo,
      amount: 20_000n,
      slippagePct: 2n,
    });
    const algoSwapTxGroup = await algoSwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(algoSwapTxGroup.transactions.length).toBe(2n);
    await signAndSend(algoSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalPrimary).toBeGreaterThan(lastState.totalPrimary);
    expect(pool.state.totalSecondary).toBeLessThan(lastState.totalSecondary);
    expect(pool.state.totalLiquidity).toBe(lastState.totalLiquidity);
    lastState = pool.state;

    // Swap secondary.
    const coinSwap = await pool.prepareSwap({
      asset: pool.secondaryAsset,
      amount: 10n ** 18n,
      slippagePct: 2n,
    });
    const coinSwapTxGroup = await coinSwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(coinSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalPrimary).toBeLessThan(lastState.totalPrimary);
    expect(pool.state.totalSecondary).toBeGreaterThan(lastState.totalSecondary);
    expect(pool.state.totalLiquidity).toBe(lastState.totalLiquidity);

    // Remove liquidity.
    const removeLiqTxGroup = await pool.prepareRemoveLiquidityTxGroup({
      address: algosdk.encodeAddress(account.addr.publicKey),
      amount: pool.state.totalLiquidity - 1000n,
    });
    expect(removeLiqTxGroup.transactions.length).toBe(2n);
    await signAndSend(removeLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(1000n);
  });

  it("Pool e2e scenario triggering slippage error", async () => {
    const { account, algo, pool } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });

    expect(pool.calculator.isEmpty).toBe(true);

    // Opt in for liquidity asset.
    const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(liqOptInTx, account);

    // Add liquidity.
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 100_000n,
      secondaryAssetAmount: 100_000n,
      slippagePct: 0n,
    });
    const addLiqTxGroup = await liquidityAddition.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(addLiqTxGroup.transactions.length).toBe(3n);
    await signAndSend(addLiqTxGroup, account);
    await pool.updateState();
    const lastState = pool.state;

    // Second add liquidity that should fail when executed after swap.
    const secondLiquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 50_000n,
      secondaryAssetAmount: 50_000n,
      slippagePct: 0n,
    });

    // Swap algo.
    const algoSwap = pool.prepareSwap({
      asset: algo,
      amount: 20_000n,
      slippagePct: 2n,
    });
    const algoSwapTxGroup = await algoSwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(algoSwapTxGroup.transactions.length).toBe(2n);
    await signAndSend(algoSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalPrimary).toBeGreaterThan(lastState.totalPrimary);
    expect(pool.state.totalSecondary).toBeLessThan(lastState.totalSecondary);

    // Execute add liquidity after changing ratio in pool.
    const failingAddLiqTxGroup = await secondLiquidityAddition.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(failingAddLiqTxGroup.transactions.length).toBe(3n);
    await expect(() =>
      signAndSend(failingAddLiqTxGroup, account),
    ).rejects.toThrow("would result negative");
  });
});

describe("Stableswap pool", () => {
  it("parsing state", async () => {
    const testBed = await makeFreshPoolTestbed({ poolType: "STABLESWAP" });
    const pact = new PactClient(algod);

    const pool = await pact.fetchPoolById(testBed.pool.appId);

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);

    expect(pool.poolType).toBe("STABLESWAP");
    expect(pool.version).toBe(1n);

    const timestamp = pool.internalState.INITIAL_A_TIME;

    expect(pool.internalState).toEqual({
      A: 0n,
      ADMIN: testBed.account.addr,
      ASSET_A: pool.primaryAsset.index,
      ASSET_B: pool.secondaryAsset.index,
      LTID: pool.liquidityAsset.index,
      B: 0n,
      CONTRACT_NAME: "[SI] PACT AMM",
      FEE_BPS: pool.feeBps,
      L: 0n,
      PACT_FEE_BPS: 0n,
      PRIMARY_FEES: 0n,
      SECONDARY_FEES: 0n,
      TREASURY: testBed.account.addr,
      VERSION: 1n,
      INITIAL_A: 80000n,
      INITIAL_A_TIME: timestamp,
      FUTURE_A: 80000n,
      FUTURE_A_TIME: timestamp,
      PRECISION: 1000n,
    });
  });

  it("e2e scenario", async () => {
    const account = await newAccount();
    const pact = new PactClient(algod);

    const coinAIndex = await createAsset(account, {
      name: "COIN_A",
      decimals: 6n,
      totalIssuance: 10n ** 10n,
    });
    const coinBIndex = await createAsset(account, {
      name: "COIN_B",
      decimals: 6n,
      totalIssuance: 10n ** 10n,
    });

    const appId = await deployStableswapContract(
      account,
      coinAIndex,
      coinBIndex,
      { amplifier: 20n, feeBps: 60n },
    );
    const pool = await pact.fetchPoolById(appId);

    expect(pool.state).toEqual({
      totalLiquidity: 0n,
      totalPrimary: 0n,
      totalSecondary: 0n,
      primaryAssetPrice: 0n,
      secondaryAssetPrice: 0n,
    });

    // Opt in for liquidity asset.
    const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(liqOptInTx, account);

    // Add liquidity.
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 100_000_000n,
      secondaryAssetAmount: 100_000_000n,
      slippagePct: 0n,
    });
    const addLiqTxGroup = await liquidityAddition.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(addLiqTxGroup.transactions.length).toBe(3n);
    await signAndSend(addLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state).toMatchObject({
      totalLiquidity: 100_000_000n,
      totalPrimary: 100_000_000n,
      totalSecondary: 100_000_000n,
    });
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("1.00");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("1.00");

    // Remove liquidity.
    const removeLiqTxGroup = await pool.prepareRemoveLiquidityTxGroup({
      address: algosdk.encodeAddress(account.addr.publicKey),
      amount: 1_000_000n,
    });
    expect(removeLiqTxGroup.transactions.length).toBe(2n);
    await signAndSend(removeLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state).toMatchObject({
      totalLiquidity: 99_000_000n,
      totalPrimary: 99_000_000n,
      totalSecondary: 99_000_000n,
    });
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("1.00");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("1.00");

    // Swap coinA.
    const coinASwap = await pool.prepareSwap({
      asset: pool.primaryAsset,
      amount: 2_000_000n,
      slippagePct: 2n,
    });
    const algoSwapTxGroup = await coinASwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    expect(algoSwapTxGroup.transactions.length).toBe(2);
    await signAndSend(algoSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(99_000_000);
    expect(pool.state.totalPrimary > 99_000_000).toBe(true);
    expect(pool.state.totalSecondary < 99_000_000).toBe(true);
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("1.00");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("1.00");

    // Swap coinB.
    const coinBSwap = await pool.prepareSwap({
      asset: pool.secondaryAsset,
      amount: 5_000_000n,
      slippagePct: 2n,
    });
    const coinSwapTxGroup = await coinBSwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(coinSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(99_000_000);
    expect(pool.state.totalPrimary < 99_000_000n).toBe(true);
    expect(pool.state.totalSecondary > 99_000_000n).toBe(true);
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("1.00");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("1.00");

    // Only big swaps should affect the price.
    const bigCoinBSwap = await pool.prepareSwap({
      asset: pool.secondaryAsset,
      amount: 90_000_000n,
      slippagePct: 2n,
    });
    const bigCoinSwapTxGroup = await bigCoinBSwap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    await signAndSend(bigCoinSwapTxGroup, account);
    await pool.updateState();
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("1.61");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("0.62");

    // Check different amplifiers.
    const poolParams = pool.params as StableswapPoolParams;
    poolParams.futureA = 1n;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("13.97");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("0.07");

    poolParams.futureA = 1000n;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("5.15");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("0.20");

    poolParams.futureA = 5n * 1000n;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("2.78");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("0.36");

    poolParams.futureA = 100n * 1000n;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("1.14");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("0.88");

    poolParams.futureA = 1000n * 1000n;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(Number(pool.state.primaryAssetPrice).toFixed(2)).toBe("1.01");
    expect(Number(pool.state.secondaryAssetPrice).toFixed(2)).toBe("0.99");
  });
});
