import algosdk from "algosdk";

import { PactClient } from "./client";
import { addLiquidity, makeFreshPoolTestbed } from "./testPoolUtils";
import { algod, createAsset, signAndSend } from "./testUtils";

describe("zap", () => {
  it("Calculates all zap params", async () => {
    const { pool, account } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
      feeBps: 30n,
      pactFeeBps: 10n,
    });

    await addLiquidity(account, pool, 100_000n, 100_000n);
    await pool.updateState();

    // Perform a zap using primary asset.
    const zapPrimaryAdd = pool.prepareZap({
      amount: 10_000n,
      asset: pool.primaryAsset,
      slippagePct: 2n,
    });
    expect(zapPrimaryAdd.params).toEqual({
      swapDeposited: 4888n,
      primaryAddLiq: 5112n,
      secondaryAddLiq: 4645n,
    });
    expect(
      zapPrimaryAdd.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(4871);

    // Perform a zap using secondary asset.
    const zapSecondaryAdd = pool.prepareZap({
      amount: 10_000n,
      asset: pool.secondaryAsset,
      slippagePct: 2n,
    });
    expect(zapSecondaryAdd.params).toEqual({
      swapDeposited: 4888n,
      primaryAddLiq: 4645n,
      secondaryAddLiq: 5112n,
    });
    expect(
      zapSecondaryAdd.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(4871n);

    // Perform a zap on unbalanced pool.
    const { pool: unbalancedPool, account: acc2 } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
      feeBps: 30n,
      pactFeeBps: 10n,
    });

    await addLiquidity(acc2, unbalancedPool, 100_000n, 10_000n);
    await unbalancedPool.updateState();

    const unbalancedZap = unbalancedPool.prepareZap({
      amount: 20_000n,
      asset: unbalancedPool.secondaryAsset,
      slippagePct: 2n,
    });

    expect(unbalancedZap.params).toEqual({
      swapDeposited: 7336n,
      primaryAddLiq: 42188n,
      secondaryAddLiq: 12664n,
    });
    expect(
      unbalancedZap.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(23093n);

    const unbalancedZapSecondary = unbalancedPool.prepareZap({
      amount: 1_000_000n,
      asset: unbalancedPool.primaryAsset,
      slippagePct: 2n,
    });
    expect(unbalancedZapSecondary.params).toEqual({
      swapDeposited: 232549n,
      primaryAddLiq: 767451n,
      secondaryAddLiq: 6970n,
    });
    expect(
      unbalancedZapSecondary.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(72909n);
  });

  it("Validates pools and assets", async () => {
    // Zap should not be possible on Stableswaps.
    const { pool: stablePool } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
    });
    expect(() =>
      stablePool.prepareZap({
        amount: 10_000n,
        asset: stablePool.primaryAsset,
        slippagePct: 1n,
      }),
    ).toThrow("Zap can only be made on constant product pools.");

    // Zap should throw an error when wrong asset is passed.
    const { pool, account, algo } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });
    const pact = new PactClient(algod);
    const coinXIndex = await createAsset(account, {
      name: "COIN_X",
      decimals: 6n,
    });
    const coinX = await pact.fetchAsset(coinXIndex);

    expect(() =>
      pool.prepareZap({
        amount: 1_000n,
        asset: coinX,
        slippagePct: 10n,
      }),
    ).toThrow("Provided asset was not found in the pool.");

    // Zap should not be possible on empty pools.
    expect(() =>
      pool.prepareZap({
        amount: 1_000n,
        asset: algo,
        slippagePct: 10n,
      }),
    ).toThrowError("Cannot create a Zap on empty pool.");
  });

  it("Prepares tx group that can be signed and sent", async () => {
    const { pool, account } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });

    await addLiquidity(account, pool, 100_000n, 100_000n);
    await pool.updateState();
    const zapAmount = 10_000n;

    const zap = pool.prepareZap({
      amount: zapAmount,
      asset: pool.primaryAsset,
      slippagePct: 2n,
    });
    expect(zap.params.swapDeposited + zap.params.primaryAddLiq).toBe(
      BigInt(zapAmount),
    );
    const suggestedParams = await algod.getTransactionParams().do();

    // Txs can be made by using single function from Zap object or by building them from provided swap and liquidity addition.
    const zapTxGroup = await zap.prepareTxGroup(
      algosdk.encodeAddress(account.addr.publicKey),
    );
    const selfBuildZapTxs = [
      ...pool.buildSwapTxs({
        swap: zap.swap,
        address: algosdk.encodeAddress(account.addr.publicKey),
        suggestedParams,
      }),
      ...pool.buildAddLiquidityTxs({
        liquidityAddition: zap.liquidityAddition,
        address: algosdk.encodeAddress(account.addr.publicKey),
        suggestedParams,
      }),
    ];

    expect(zapTxGroup.transactions.length).toBe(5);
    expect(
      zapTxGroup.transactions.map((t) => ({ ...t, group: undefined })),
    ).toEqual(selfBuildZapTxs);

    await signAndSend(zapTxGroup, account);
    await pool.updateState();

    expect(pool.state).toEqual({
      primaryAssetPrice: 0.9090983472426772,
      secondaryAssetPrice: 1.099990999909999,
      totalLiquidity: 104871,
      totalPrimary: 109998,
      totalSecondary: 99999,
    });
  });
});
