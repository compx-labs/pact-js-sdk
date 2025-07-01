import algosdk from "algosdk";

import { LendingSwap } from "./folksLendingPool";
import {
  LendingPoolAdapterTestBed,
  makeFreshLendingPoolTestbed,
} from "./testLendingPoolUtils";
import { signAndSend } from "./testUtils";

async function assertSwap(
  testbed: LendingPoolAdapterTestBed,
  swap: LendingSwap,
) {
  const oldState = testbed.lendingPoolAdapter.pactPool.state;
  const oldPrimaryHolding = await testbed.algo.getHolding(
    algosdk.encodeAddress(testbed.account.addr.publicKey),
  );
  const oldSecondaryHolding = await testbed.originalAsset.getHolding(
    algosdk.encodeAddress(testbed.account.addr.publicKey),
  );

  const txGroup = await testbed.lendingPoolAdapter.prepareSwapTxGroup({
    swap,
    address: algosdk.encodeAddress(testbed.account.addr.publicKey),
  });
  await signAndSend(txGroup, testbed.account);

  await testbed.lendingPoolAdapter.pactPool.updateState();

  const newState = testbed.lendingPoolAdapter.pactPool.state;
  const newPrimaryHolding = await testbed.algo.getHolding(
    algosdk.encodeAddress(testbed.account.addr.publicKey),
  );
  const newSecondaryHolding = await testbed.originalAsset.getHolding(
    algosdk.encodeAddress(testbed.account.addr.publicKey),
  );

  if (swap.assetDeposited.index === testbed.algo.index) {
    expect(
      Math.abs(Number(newState.totalPrimary - oldState.totalPrimary)),
    ).toBe(swap.fSwap.effect.amountDeposited);
    expect(
      Math.abs(Number(oldState.totalSecondary - newState.totalSecondary)),
    ).toBe(swap.fSwap.effect.minimumAmountReceived);

    expect(Math.abs(oldPrimaryHolding! - newPrimaryHolding!)).toBe(
      swap.amountDeposited + swap.txFee,
    );
    expect(Math.abs(newSecondaryHolding! - oldSecondaryHolding!)).toBe(
      swap.minimumAmountReceived,
    );
  } else {
    expect(
      Math.abs(Number(oldState.totalSecondary - newState.totalSecondary)),
    ).toBe(swap.fSwap.effect.amountDeposited);
    expect(
      Math.abs(Number(newState.totalPrimary - oldState.totalPrimary)),
    ).toBe(swap.fSwap.effect.minimumAmountReceived);

    expect(Math.abs(newSecondaryHolding! - oldSecondaryHolding!)).toBe(
      swap.amountDeposited,
    );
    expect(Math.abs(oldPrimaryHolding! - newPrimaryHolding!)).toBe(
      Math.abs(Number(swap.minimumAmountReceived - swap.txFee)),
    );
  }
}

describe("FolksLendingPool", () => {
  it("add and remove liquidity", async () => {
    const testbed = await makeFreshLendingPoolTestbed();

    // Add liquidity
    const lendingLiquidityAddition =
      await testbed.lendingPoolAdapter.prepareAddLiquidity({
        primaryAssetAmount: 100_000n,
        secondaryAssetAmount: 50_000n,
        slippagePct: 0n,
      });
    let txGroup = await testbed.lendingPoolAdapter.prepareAddLiquidityTxGroup({
      address: algosdk.encodeAddress(testbed.account.addr.publicKey),
      liquidityAddition: lendingLiquidityAddition,
    });

    await signAndSend(txGroup, testbed.account);

    await testbed.lendingPoolAdapter.pactPool.updateState();
    // Check tokens deposited in Folks contracts.
    expect(
      await testbed.lendingPoolAdapter.primaryLendingPool.originalAsset.getHolding(
        testbed.lendingPoolAdapter.primaryLendingPool.escrowAddress,
      ),
    ).toBe(100_000 + 300_000); // (+ min balance ALGO)
    expect(
      await testbed.lendingPoolAdapter.secondaryLendingPool.originalAsset.getHolding(
        testbed.lendingPoolAdapter.secondaryLendingPool.escrowAddress,
      ),
    ).toBe(50_000);

    const poolLiqudityAddition = lendingLiquidityAddition.liquidityAddition;
    expect(poolLiqudityAddition.primaryAssetAmount).toBe(96674);
    expect(poolLiqudityAddition.secondaryAssetAmount).toBe(49860);

    // Check Pact pool state.
    expect(testbed.lendingPoolAdapter.pactPool.state.totalPrimary).toBe(
      poolLiqudityAddition.primaryAssetAmount,
    );
    expect(testbed.lendingPoolAdapter.pactPool.state.totalSecondary).toBe(
      poolLiqudityAddition.secondaryAssetAmount,
    );

    // Check LP the user received.
    expect(
      await testbed.lendingPoolAdapter.pactPool.liquidityAsset.getHolding(
        algosdk.encodeAddress(testbed.account.addr.publicKey),
      ),
    ).toBe(poolLiqudityAddition.effect.mintedLiquidityTokens - 1000n); // - blocked LP for first liquidity

    // Remove
    txGroup = await testbed.lendingPoolAdapter.prepareRemoveLiquidityTxGroup({
      address: algosdk.encodeAddress(testbed.account.addr.publicKey),
      amount: 20_000n,
    });
    await signAndSend(txGroup, testbed.account);

    await testbed.lendingPoolAdapter.pactPool.updateState();
    expect(testbed.lendingPoolAdapter.pactPool.state.totalLiquidity).toBe(
      poolLiqudityAddition.effect.mintedLiquidityTokens - 20_000n,
    );
  });

  it("swap primary exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = await testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000n,
      asset: testbed.lendingPoolAdapter.primaryLendingPool.originalAsset,
      slippagePct: 0n,
    });

    expect(swap.amountDeposited).toBe(10_000n);
    expect(swap.fSwap.effect.amountDeposited).toBe(9667n);
    expect(swap.amountReceived).toBe(4530n);
    expect(swap.fSwap.effect.amountReceived).toBe(4518n);

    await assertSwap(testbed, swap);
  });

  it("swap secondary exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000n,
      asset: testbed.lendingPoolAdapter.secondaryLendingPool.originalAsset,
      slippagePct: 0n,
    });

    expect(swap.amountDeposited).toBe(10_000n);
    expect(swap.fSwap.effect.amountDeposited).toBe(9972n);
    expect(swap.amountReceived).toBe(16615n);
    expect(swap.fSwap.effect.amountReceived).toBe(16063n);

    await assertSwap(testbed, swap);
  });

  it("swap primary for exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = await testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000n,
      asset: testbed.lendingPoolAdapter.primaryLendingPool.originalAsset,
      slippagePct: 0n,
      swapForExact: true,
    });

    expect(swap.amountDeposited).toBe(25098n);
    expect(swap.fSwap.effect.amountDeposited).toBe(24263n);
    expect(swap.amountReceived).toBe(10_000n);
    expect(swap.fSwap.effect.amountReceived).toBe(9972n);

    await assertSwap(testbed, swap);
  });

  it("swap secondary for exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = await testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000n,
      asset: testbed.lendingPoolAdapter.secondaryLendingPool.originalAsset,
      slippagePct: 0n,
      swapForExact: true,
    });

    expect(swap.amountDeposited).toBe(5575n);
    expect(swap.fSwap.effect.amountDeposited).toBe(5559n);
    expect(swap.amountReceived).toBe(10_000n);
    expect(swap.fSwap.effect.amountReceived).toBe(9667n);

    await assertSwap(testbed, swap);
  });
});
