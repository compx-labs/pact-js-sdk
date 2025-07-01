/**
This module container utilities for interacting with the farm contract.
 */

import algosdk from "algosdk";

import { Asset, fetchAssetByIndex, getCachedAsset } from "../asset";
import { decodeUint64Array, encodeArray } from "../encoding";
import { PactSdkError } from "../exceptions";
import { getGasStation } from "../gasStation";
import { mapToObject, parseState, spFee } from "../utils";
import { Escrow, buildDeployEscrowTxs, fetchEscrowById } from "./escrow";
import {
  FarmInternalState,
  FarmState,
  FarmUserState,
  FarmingRewards,
  formatRewards,
  formatRpt,
  internalStateToState,
  parseInternalState,
} from "./farmState";

const UPDATE_TX_FEE = 3000;
const MAX_REWARD_ASSETS = 7;

// update_global_state()void
const UPDATE_GLOBAL_STATE_SIG = new Uint8Array([53, 158, 130, 85]);

// update_state(application,account,account,asset)void
const UPDATE_STATE_SIG = new Uint8Array([195, 20, 10, 231]);

// claim_rewards(account,uint64[])void
const CLAIM_REWARDS_SIG = new Uint8Array([74, 174, 163, 242]);

// add_reward_asset(asset)void
const ADD_REWARD_ASSET_SIG = new Uint8Array([148, 140, 245, 128]);

// deposit_rewards(uint64[],uint64)void
const DEPOSIT_REWARDS_SIG = new Uint8Array([111, 232, 27, 155]);

export async function fetchFarmRawStateById(
  algod: algosdk.Algodv2,
  appId: bigint,
) {
  const appInfo = await algod.getApplicationByID(appId).do();
  return parseState(appInfo.params.globalState || []);
}

export function makeFarmFromRawState(
  algod: algosdk.Algodv2,
  appId: bigint,
  rawState: any,
): Farm {
  const internalState = parseInternalState(rawState);
  const state = internalStateToState(algod, internalState);

  return new Farm(algod, appId, rawState, internalState, state);
}

export async function fetchFarmById(algod: algosdk.Algodv2, appId: bigint) {
  const rawState = await fetchFarmRawStateById(algod, appId);
  return makeFarmFromRawState(algod, appId, rawState);
}

export class Farm {
  private _suggestedParams: algosdk.SuggestedParams | null = null;
  appAddress: string;

  constructor(
    public algod: algosdk.Algodv2,
    public appId: bigint,
    public rawState: any,
    public internalState: FarmInternalState,
    public state: FarmState,
  ) {
    this.appAddress = algosdk.getApplicationAddress(this.appId).toString();
  }

  setSuggestedParams(suggestedParams: algosdk.SuggestedParams) {
    this._suggestedParams = suggestedParams;
  }

  get suggestedParams(): algosdk.SuggestedParams {
    if (!this._suggestedParams) {
      throw new PactSdkError(
        "SuggestedParams not set. Use Farm.setSuggestedParams().",
      );
    }
    return this._suggestedParams;
  }

  async refreshSuggestedParams() {
    this.setSuggestedParams(await this.algod.getTransactionParams().do());
  }

  async fetchAllAssets() {
    this.state.stakedAsset = await fetchAssetByIndex(
      this.algod,
      this.state.stakedAsset.index,
    );
    this.state.rewardAssets = await Promise.all(
      this.state.rewardAssets.map((asset) =>
        fetchAssetByIndex(this.algod, asset.index),
      ),
    );
  }

  get stakedAsset() {
    return this.state.stakedAsset;
  }

  haveRewards(dt?: Date): boolean {
    const state = this.state;

    if (state.duration === 0n) {
      // Finished distributing rewards or there never were any rewards.
      return false;
    }

    if (state.totalStaked === 0n) {
      // The farm is paused and still has rewards.
      return true;
    }

    if (dt === undefined) {
      dt = new Date();
    }

    const durationMs = (state.duration + state.nextDuration) * 1000n;
    if (dt < new Date(Number(BigInt(state.updatedAt.getTime()) + durationMs))) {
      // The farm is going and still has rewards.
      return true;
    }

    // All the rewards will be distributed at the specified time.
    return false;
  }

  fetchEscrowById(appId: bigint): Promise<Escrow> {
    return fetchEscrowById(this.algod, appId, { farm: this });
  }

  async fetchEscrowByAddress(address: string): Promise<Escrow | null> {
    const userState = await this.fetchUserState(address);
    if (!userState) {
      return null;
    }
    return fetchEscrowById(this.algod, userState.escrowId, { farm: this });
  }

  fetchEscrowFromAccountInfo(accountInfo: any): Promise<Escrow | null> {
    const userState = this.getUserStateFromAccountInfo(accountInfo);
    if (!userState) {
      return Promise.resolve(null);
    }
    return fetchEscrowById(this.algod, userState.escrowId, { farm: this });
  }

  async updateState() {
    const appInfo = await this.algod.getApplicationByID(this.appId).do();
    this.rawState = parseState(appInfo.params.globalState || []);
    this.internalState = parseInternalState(this.rawState);
    this.state = internalStateToState(this.algod, this.internalState);
  }

  async fetchUserState(address: string): Promise<FarmUserState | null> {
    const accountInfo = await this.algod.accountInformation(address).do();
    return this.getUserStateFromAccountInfo(accountInfo);
  }

  getUserStateFromAccountInfo(
    accountInfo: algosdk.modelsv2.Account,
  ): FarmUserState | null {
    const appsState: any[] = accountInfo.appsLocalState || [];
    if (!appsState || appsState.length === 0) {
      return null;
    }
    const appInfo = appsState.find((state) => state.id === this.appId);

    if (!appInfo) {
      return null;
    }

    const rawState = parseState(appInfo.keyValue || []);

    const rpt = formatRpt(
      decodeUint64Array(rawState.RPT),
      decodeUint64Array(rawState.RPT_frac),
    );

    return {
      escrowId: rawState.EscrowID,
      staked: rawState.Staked,
      accruedRewards: formatRewards(
        this.state.rewardAssets,
        decodeUint64Array(rawState.AccruedRewards),
      ),
      claimedRewards: formatRewards(
        this.state.rewardAssets,
        decodeUint64Array(rawState.ClaimedRewards),
      ),
      rpt: formatRewards(this.state.rewardAssets, rpt),
    };
  }

  estimateAccruedRewards(
    atTime: Date,
    userState: FarmUserState,
  ): FarmingRewards {
    const pastAccruedRewards = this.calculatePastAccruedRewards(
      userState.staked,
      userState.rpt,
    ) as unknown as FarmingRewards;

    const estimatedRewards = this.simulateAccruedRewards(
      atTime,
      userState.staked,
      this.state.totalStaked,
    );

    const rewards = this.sumRewards(estimatedRewards, userState.accruedRewards);

    return this.sumRewards(rewards, pastAccruedRewards);
  }

  simulateNewStaker(atTime: Date, stakedAmount: bigint): FarmingRewards {
    return this.simulateAccruedRewards(
      atTime,
      stakedAmount,
      this.state.totalStaked + stakedAmount,
      { extrapolateFutureRewards: true },
    );
  }

  simulateAccruedRewards(
    atTime: Date,
    stakedAmount: bigint,
    totalStaked: bigint,
    options: { extrapolateFutureRewards?: boolean } = {},
  ): FarmingRewards {
    let duration = BigInt(
      Math.floor(atTime.getTime() - this.state.updatedAt.getTime()) / 1000,
    );

    if (totalStaked === 0n) {
      return mapToObject(this.state.rewardAssets, (asset) => [
        Number(asset.index),
        0n,
      ]);
    }

    const stakeRatio = stakedAmount / totalStaked;

    // Simulate pending rewards.
    let rewards = this.simulateCycleRewards(
      stakeRatio,
      this.state.pendingRewards,
      duration,
      this.state.duration,
    );

    duration -= this.state.duration;
    if (duration <= 0) {
      return rewards;
    }

    if (this.state.nextDuration) {
      // Simulate next rewards if needed.
      const rewardsB = this.simulateCycleRewards(
        stakeRatio,
        this.state.nextRewards,
        duration,
        this.state.nextDuration,
      );
      rewards = this.sumRewards(rewards, rewardsB);

      duration -= this.state.nextDuration;
      if (duration <= 0) {
        return rewards;
      }
    }

    if (!options.extrapolateFutureRewards) {
      return rewards;
    }

    const nextDuration = this.state.nextDuration || this.state.duration;
    if (nextDuration === 0n) {
      return rewards;
    }

    const nextRewards = this.state.nextDuration
      ? this.state.nextRewards
      : this.state.pendingRewards;

    const nextNextRewards = mapToObject(
      Object.entries(nextRewards),
      (assetAndAmount) => {
        return [
          assetAndAmount[0],
          BigInt(
            Math.floor(
              Number(assetAndAmount[1]) * Number(duration / nextDuration),
            ),
          ),
        ];
      },
    );

    // Extrapolate rewards for the future.
    const rewards_c = this.simulateCycleRewards(
      stakeRatio,
      nextNextRewards,
      duration,
      duration,
    );
    return this.sumRewards(rewards, rewards_c);
  }

  private simulateCycleRewards(
    stakeRatio: bigint,
    rewards: FarmingRewards,
    stakeDuration: bigint,
    cycleDuration: bigint,
  ): FarmingRewards {
    if (cycleDuration === 0n) {
      const fr: FarmingRewards = mapToObject(
        this.state.rewardAssets,
        (asset) => [Number(asset.index), 0n],
      );
      return fr;
    }

    stakeDuration = BigInt(
      Math.min(Number(stakeDuration), Number(cycleDuration)),
    );

    return mapToObject(this.state.rewardAssets, (asset) => [
      Number(asset.index),
      BigInt(
        Math.floor(
          Number(stakeRatio) *
            Number(rewards[Number(asset.index)] ?? 0n) *
            (Number(stakeDuration) / Number(cycleDuration)),
        ),
      ),
    ]);
  }

  calculatePastAccruedRewards(stakedAmount: bigint, userRpt: FarmingRewards) {
    return mapToObject(this.state.rewardAssets, (asset) => [
      Number(asset.index),
      Math.floor(
        Math.max(
          0,
          Number(this.state.rpt[Number(asset.index)] ?? 0n) -
            Number(userRpt[Number(asset.index)] ?? 0n),
        ) * Number(stakedAmount),
      ),
    ]);
  }

  sumRewards(
    rewardsA: FarmingRewards,
    rewardsB: FarmingRewards,
  ): FarmingRewards {
    return mapToObject(Object.keys(rewardsA) as any, (assetIndex: number) => [
      assetIndex,
      (rewardsA[assetIndex] ?? 0) + (rewardsB[assetIndex] ?? 0),
    ]);
  }

  async prepareDeployEscrowTxs(sender: string): Promise<algosdk.Transaction[]> {
    return buildDeployEscrowTxs(
      sender,
      this.appId,
      this.stakedAsset.index,
      this.suggestedParams,
    );
  }

  buildUpdateIncreaseOpcodeQuotaTx(sender: string): algosdk.Transaction | null {
    const secondsPassed = Math.floor(
      (new Date().getTime() - this.state.updatedAt.getTime()) / 1000,
    );
    const opcodesCost =
      secondsPassed > this.state.duration && this.state.duration > 0
        ? 671
        : 513;
    const count = Math.floor(
      (opcodesCost * this.state.rewardAssets.length) / 700,
    );
    if (count === 0) {
      return null;
    }

    return getGasStation().buildIncreaseOpcodeQuotaTx(
      sender,
      count,
      this.suggestedParams,
    );
  }

  buildUpdateWithOpcodeIncreaseTxs(escrow: Escrow): algosdk.Transaction[] {
    const txs = [this.buildUpdateTx(escrow)];

    const increaseOpcodeQuotaTx = this.buildUpdateIncreaseOpcodeQuotaTx(
      escrow.userAddress,
    );

    if (increaseOpcodeQuotaTx) {
      txs.unshift(increaseOpcodeQuotaTx);
    }

    return txs;
  }

  buildUpdateTx(escrow: Escrow): algosdk.Transaction {
    const appArgs = [
      new algosdk.ABIUintType(8).encode(1),
      new algosdk.ABIUintType(8).encode(1),
      new algosdk.ABIUintType(8).encode(0),
      new algosdk.ABIUintType(8).encode(0),
    ];

    return algosdk.makeApplicationNoOpTxnFromObject({
      sender: escrow.userAddress,
      appIndex: this.appId,
      foreignAssets: [this.stakedAsset.index],
      foreignApps: [escrow.appId],
      accounts: [escrow.address],
      appArgs: [UPDATE_STATE_SIG, ...appArgs],
      suggestedParams: spFee(this.suggestedParams, UPDATE_TX_FEE),
    });
  }

  buildClaimRewardsTx(escrow: Escrow, assets?: Asset[]): algosdk.Transaction {
    if (!assets) {
      assets = this.state.rewardAssets;
    }

    const appArgs = [
      new algosdk.ABIUintType(8).encode(0),
      new algosdk.ABIArrayDynamicType(new algosdk.ABIUintType(64)).encode(
        assets.map((asset) =>
          this.state.rewardAssets.findIndex(
            (rewardAsset) => rewardAsset.index === asset.index,
          ),
        ),
      ),
    ];

    return algosdk.makeApplicationNoOpTxnFromObject({
      sender: escrow.userAddress,
      appIndex: this.appId,
      foreignAssets: assets.map((asset) => asset.index),
      foreignApps: [escrow.appId],
      accounts: [escrow.userAddress],
      appArgs: [CLAIM_REWARDS_SIG, ...appArgs],
      suggestedParams: spFee(this.suggestedParams, 1000 * (assets.length + 1)),
    });
  }

  buildUpdateGlobalStateTx(sender: string) {
    return algosdk.makeApplicationNoOpTxnFromObject({
      sender: sender,
      appIndex: this.appId,
      appArgs: [UPDATE_GLOBAL_STATE_SIG],
      suggestedParams: this.suggestedParams,
    });
  }

  adminBuildAddRewardAssetTx(asset: Asset): algosdk.Transaction {
    return algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.state.admin,
      suggestedParams: spFee(this.suggestedParams, 2000),
      appIndex: this.appId,
      foreignAssets: [asset.index],
      appArgs: [ADD_REWARD_ASSET_SIG, ...encodeArray([0])],
    });
  }

  adminBuildDepositRewardsTxs(
    rewards: FarmingRewards,
    duration: number,
  ): algosdk.Transaction[] {
    const rewardAssets = Object.keys(rewards).map((asset) =>
      getCachedAsset(this.algod, BigInt(asset), 0),
    );

    const assetIndexToAsset = mapToObject(rewardAssets, (asset) => [
      Number(asset.index),
      asset,
    ]);

    const assetsToOptIn = rewardAssets.filter(
      (assetA) =>
        !this.state.rewardAssets.find(
          (assetB) => assetA.index === assetB.index,
        ),
    );

    if (this.state.nextDuration > 0) {
      throw new PactSdkError(
        "Cannot deposit next rewards if farm already have next rewards",
      );
    }

    if (
      this.state.rewardAssets.length + assetsToOptIn.length >
      MAX_REWARD_ASSETS
    ) {
      throw new PactSdkError(
        `Maximum number of reward assets per farm is ${MAX_REWARD_ASSETS}`,
      );
    }

    let increaseOpcodeTx: algosdk.Transaction | null = null;
    if (this.state.totalStaked) {
      increaseOpcodeTx = this.buildUpdateIncreaseOpcodeQuotaTx(
        this.state.admin,
      );
    }

    const updateTx = this.buildUpdateGlobalStateTx(this.state.admin);

    //Fund farm with minimal ALGO balance required for assets opt-ins.
    let optInTxs: algosdk.Transaction[] = [
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: this.state.admin,
        receiver: this.appAddress,
        amount: assetsToOptIn.length * 100_000,
        suggestedParams: this.suggestedParams,
      }),
    ];

    if (assetsToOptIn) {
      optInTxs = optInTxs.concat(
        assetsToOptIn.map((asset) => this.adminBuildAddRewardAssetTx(asset)),
      );
    }

    for (const asset of assetsToOptIn) {
      this.state.rewardAssets.push(asset);
    }

    const transferTxs = Object.keys(rewards).map((assetIndex) =>
      assetIndexToAsset[Number(assetIndex)].buildTransferTx(
        this.state.admin,
        this.appAddress,
        Number(rewards[Number(assetIndex)]),
        this.suggestedParams,
      ),
    );

    const appArgs = [
      new algosdk.ABIArrayDynamicType(new algosdk.ABIUintType(64)).encode(
        rewardAssets.map((assetA) =>
          this.state.rewardAssets.findIndex(
            (assetB) => assetA.index === assetB.index,
          ),
        ),
      ),
      new algosdk.ABIUintType(64).encode(duration),
    ];

    const depositRewardsTx = algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.state.admin,
      suggestedParams: this.suggestedParams,
      appIndex: this.appId,
      appArgs: [DEPOSIT_REWARDS_SIG, ...appArgs],
    });

    const txs = [updateTx, ...optInTxs, ...transferTxs, depositRewardsTx];
    if (increaseOpcodeTx) {
      txs.unshift(increaseOpcodeTx);
    }

    return txs;
  }
}
