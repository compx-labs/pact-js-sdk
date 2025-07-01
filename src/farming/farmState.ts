import algosdk from "algosdk";

import { Asset, getCachedAsset } from "../asset";
import { decodeAddressFromGlobalState, decodeUint64Array } from "../encoding";

export type FarmingRewards = Record<number, bigint>;

export type FarmInternalState = {
  stakedAssetId: bigint;
  rewardAssetIds: bigint[];
  distributedRewards: bigint[];
  claimedRewards: bigint[];
  pendingRewards: bigint[];
  nextRewards: bigint[];
  rptFrac: bigint[];
  rpt: bigint[];
  duration: bigint;
  nextDuration: bigint;
  numStakers: bigint;
  totalStaked: bigint;
  updatedAt: number;
  admin: string;
  updater: string;
  version: number;
};

export type FarmState = {
  /** The asset the users are going to stake in the farm.*/
  stakedAsset: Asset;

  /** Assets that are distributed as rewards in the farm.*/
  rewardAssets: Asset[];

  /** Amounts of assets distributed so far. This includes tokens that are already claimed and tokens which are accrued and are awaiting claim.*/
  distributedRewards: FarmingRewards;

  /** Amounts of assets claimed by users so far.*/
  claimedRewards: FarmingRewards;

  /** Amounts of not yet distributed rewards in the farm.*/
  pendingRewards: FarmingRewards;

  /** Current rate per token for each asset.*/
  rpt: FarmingRewards;

  /** Time in seconds until current cycle ends. This is the time at which the rewards are depleted. Next cycle is automatically picked up if next_rewards are deposited.*/
  duration: bigint;

  /** The duration of the next cycle.*/
  nextDuration: bigint;

  /** Amounts of rewards deposited for the next cycle.*/
  nextRewards: FarmingRewards;

  /** The number of active stakers. Active staker stakes at least 1 token.*/
  numStakers: bigint;

  /** The sum of all stakers deposits.*/
  totalStaked: bigint;

  /** The time the farm was last updated.*/
  updatedAt: Date;

  /** The address of the farm's admin account. The admin can deposit new rewards and destroy the farm after it is deprecated.*/
  admin: string;

  /** The address of farm's updater. The updater can update the farm's contract to a new version.*/
  updater: string;

  /** Contract version. */
  version: number;
};

export type FarmUserState = {
  /** The app id of the user's escrow contract.*/
  escrowId: bigint;

  /** The amount of staked asset the user has deposited in the escrow.*/
  staked: bigint;

  /** Amounts of rewards the user has accrued and can claim.*/
  accruedRewards: FarmingRewards;

  /** Amounts of rewards the user has already claimed.*/
  claimedRewards: FarmingRewards;

  /** Current rate per token for each asset.*/
  rpt: FarmingRewards;
};

export function parseInternalState(rawState: any): FarmInternalState {
  return {
    claimedRewards: decodeUint64Array(rawState["ClaimedRewards"]),
    duration: rawState["Duration"],
    nextDuration: rawState["NextDuration"],
    nextRewards: decodeUint64Array(rawState["NextRewards"]),
    numStakers: rawState["NumStakers"],
    pendingRewards: decodeUint64Array(rawState["PendingRewards"]),
    rpt: decodeUint64Array(rawState["RPT"]),
    rptFrac: decodeUint64Array(rawState["RPT_frac"]),
    rewardAssetIds: decodeUint64Array(rawState["RewardAssetIDs"]),
    stakedAssetId: rawState["StakedAssetID"],
    distributedRewards: decodeUint64Array(rawState["TotalRewards"]),
    totalStaked: rawState["TotalStaked"],
    updatedAt: rawState["UpdatedAt"],
    admin: decodeAddressFromGlobalState(rawState["Admin"]),
    updater: decodeAddressFromGlobalState(rawState["Updater"]),
    version: rawState["VERSION"],
  };
}

export function internalStateToState(
  algod: algosdk.Algodv2,
  internalState: FarmInternalState,
): FarmState {
  const stakedAsset = getCachedAsset(algod, internalState.stakedAssetId, 0);

  const rewardAssets = internalState.rewardAssetIds.map((assetId) =>
    getCachedAsset(algod, assetId, 0),
  );

  const rpt = formatRpt(internalState.rpt, internalState.rptFrac);

  return {
    stakedAsset,
    rewardAssets,
    distributedRewards: formatRewards(
      rewardAssets,
      internalState.distributedRewards,
    ),
    claimedRewards: formatRewards(rewardAssets, internalState.claimedRewards),
    pendingRewards: formatRewards(rewardAssets, internalState.pendingRewards),
    nextRewards: formatRewards(rewardAssets, internalState.nextRewards),
    rpt: formatRewards(rewardAssets, rpt),
    duration: internalState.duration,
    nextDuration: internalState.nextDuration,
    numStakers: internalState.numStakers,
    totalStaked: internalState.totalStaked,
    updatedAt: new Date(internalState.updatedAt * 1000),
    admin: internalState.admin,
    updater: internalState.updater,
    version: internalState.version,
  };
}

export function formatRewards(
  assets: Asset[],
  amounts: bigint[],
): FarmingRewards {
  const rewards: FarmingRewards = {};
  for (let i = 0; i < assets.length; i++) {
    rewards[Number(assets[i].index)] = BigInt(amounts[i]);
  }
  return rewards;
}

export function formatRpt(rptWhole: bigint[], rptFrac: bigint[]): bigint[] {
  return rptWhole.map(
    (whole, index) => whole + BigInt(rptFrac[index]) / BigInt(2 ** 64),
  );
}
