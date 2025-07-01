import { Asset } from "./asset";
import { PactSdkError } from "./exceptions";
import { Pool } from "./pool";
import { StableswapCalculator, getTxFee } from "./stableswapCalculator";
import { TransactionGroup } from "./transactionGroup";

export class SwapValidationError extends PactSdkError {}

export class LiquiditySurpassedError extends SwapValidationError {
  constructor() {
    super("Current liquidity doesn't allow to swap for this amount.");
  }
}

/**
 * Swap Effect are the basic details of the effect on the pool of performing the swap.
 */
export type SwapEffect = {
  amountReceived: bigint;
  amountDeposited: bigint;
  minimumAmountReceived: bigint;
  primaryAssetPriceAfterSwap: bigint;
  secondaryAssetPriceAfterSwap: bigint;
  primaryAssetPriceImpactPct: bigint;
  secondaryAssetPriceImpactPct: bigint;
  fee: bigint;
  price: bigint;
  txFee: bigint;

  /** Stableswap only. Zero otherwise. */
  amplifier: bigint;
};

/**
 * Swap class represents a swap trade on a particular pool.
 *
 * Typically, users don't have to manually instantiate this class. Use [[Pool.prepareSwap]] instead.
 */
export class Swap {
  /**
   * The pool the swap is going to be performed in.
   */
  pool: Pool;

  /**
   * The effect of the swap computed at the time of construction.
   */
  effect: SwapEffect;

  /**
   * The asset that will be swapped (deposited in the contract).
   */
  assetDeposited: Asset;

  /**
   * The asset that will be received.
   */
  assetReceived: Asset;

  /**
   * Either the amount to swap (deposit) or the amount to receive depending on the `swapForExact` parameter.
   */
  amount: bigint;

  /**
   * The maximum amount of slippage allowed in performing the swap.
   */
  slippagePct: bigint;

  /**
   * If `true` then `amount` is what you want to receive from the swap. Otherwise, it's an amount that you want to swap (deposit). Note that the contracts do not support the "swap exact for" swap. It works by calculating the amount to deposit on the client side and doing a normal swap on the exchange.
   */
  swapForExact = false;

  /**
   * @param pool The pool the swap is going to be performed in.
   * @param assetDeposited The asset that will be swapped (deposited in the contract).
   * @param amount Either the amount to swap (deposit) or the amount to receive depending on the `swapForExact` parameter.
   * @param slippagePct The maximum amount of slippage allowed in performing the swap.
   * @param swapForExact If `true` then `amount` is what you want to receive from the swap. Otherwise, it's an amount that you want to swap (deposit).
   */
  constructor(
    pool: Pool,
    assetDeposited: Asset,
    amount: bigint,
    slippagePct: bigint,
    swapForExact = false,
  ) {
    this.pool = pool;
    this.assetDeposited = assetDeposited;
    this.assetReceived = this.pool.getOtherAsset(this.assetDeposited);
    this.amount = amount;
    this.slippagePct = slippagePct;
    this.swapForExact = swapForExact;

    this.validateSwap();
    this.effect = this.buildEffect();

    if (this.swapForExact && this.effect.amountDeposited < 0) {
      throw new LiquiditySurpassedError();
    }
  }

  /**
   * Creates the transactions needed to perform the swap trade and returns them as a transaction group ready to be signed and committed.
   *
   * @param address The account that will be performing the swap.
   *
   * @returns A transaction group that when executed will perform the swap.
   */
  prepareTxGroup(address: string): Promise<TransactionGroup> {
    return this.pool.prepareSwapTxGroup({ swap: this, address });
  }

  private validateSwap() {
    if (this.slippagePct < 0 || this.slippagePct > 100) {
      throw new SwapValidationError("Splippage must be between 0 and 100.");
    }
    if (this.pool.calculator.isEmpty) {
      throw new SwapValidationError("Pool is empty and swaps are impossible.");
    }
    if (this.swapForExact) {
      const maxAmount =
        this.assetDeposited.index === this.pool.primaryAsset.index
          ? this.pool.state.totalSecondary
          : this.pool.state.totalPrimary;
      if (this.amount >= maxAmount) {
        throw new LiquiditySurpassedError();
      }
    }
  }

  private buildEffect(): SwapEffect {
    const calc = this.pool.calculator;

    let amountReceived: bigint;
    let amountDeposited: bigint;
    if (this.swapForExact) {
      amountReceived = this.amount;
      amountDeposited = BigInt(
        calc.netAmountReceivedToAmountDeposited(
          this.assetDeposited,
          BigInt(this.amount),
        ),
      );
    } else {
      amountReceived = BigInt(
        calc.amountDepositedToNetAmountReceived(
          this.assetDeposited,
          BigInt(this.amount),
        ),
      );
      amountDeposited = this.amount;
    }

    let primaryLiqChange, secondaryLiqChange: bigint;
    if (this.assetDeposited.index === this.pool.primaryAsset.index) {
      primaryLiqChange = amountDeposited;
      secondaryLiqChange = -amountReceived;
    } else {
      primaryLiqChange = -amountReceived;
      secondaryLiqChange = amountDeposited;
    }

    const primaryAssetPriceAfterSwap = calc.getAssetPriceAfterLiqChange(
      this.pool.primaryAsset,
      primaryLiqChange,
      secondaryLiqChange,
    );
    const secondaryAssetPriceAfterSwap = calc.getAssetPriceAfterLiqChange(
      this.pool.secondaryAsset,
      primaryLiqChange,
      secondaryLiqChange,
    );

    let amplifier = 0n;
    let txFee = 2000n;
    const swapCalc = this.pool.calculator.swapCalculator;

    if (swapCalc instanceof StableswapCalculator) {
      amplifier =
        BigInt(swapCalc.getAmplifier()) /
        (this.pool.internalState.PRECISION ?? 1n);
      txFee = getTxFee(swapCalc.swapInvariantIterations, 1n);
    }

    return {
      amountDeposited,
      amountReceived,
      minimumAmountReceived: BigInt(
        calc.getMinimumAmountReceived(
          this.assetDeposited,
          BigInt(amountDeposited),
          BigInt(Math.round(Number(this.slippagePct * 100n))),
        ),
      ),
      price: calc.getSwapPrice(this.assetDeposited, BigInt(amountDeposited)),
      primaryAssetPriceAfterSwap,
      secondaryAssetPriceAfterSwap,
      primaryAssetPriceImpactPct: calc.getPriceImpactPct(
        this.pool.primaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      ),
      secondaryAssetPriceImpactPct: calc.getPriceImpactPct(
        this.pool.secondaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      ),
      fee: calc.getFee(this.assetDeposited, BigInt(amountDeposited)),
      txFee,
      amplifier,
    };
  }
}
