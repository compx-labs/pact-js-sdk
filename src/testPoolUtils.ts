import algosdk from "algosdk";

import { Asset } from "./asset";
import { PactClient } from "./client";
import { Pool, PoolType } from "./pool";
import {
  algod,
  createAsset,
  deployContract,
  newAccount,
  signAndSend,
} from "./testUtils";

export function deployConstantProductContract(
  account: algosdk.Account,
  primaryAssetIndex: bigint,
  secondaryAssetIndex: bigint,
  options: {
    feeBps?: bigint;
    pactFeeBps?: bigint;
  } = {},
) {
  return deployExchangeContract(
    account,
    "CONSTANT_PRODUCT",
    primaryAssetIndex,
    secondaryAssetIndex,
    options,
  );
}

export function deployNftConstantProductContract(
  account: algosdk.Account,
  primaryAssetIndex: bigint,
  secondaryAssetIndex: bigint,
  options: {
    feeBps?: bigint;
    pactFeeBps?: bigint;
  } = {},
) {
  return deployExchangeContract(
    account,
    "NFT_CONSTANT_PRODUCT",
    primaryAssetIndex,
    secondaryAssetIndex,
    options,
  );
}

export function deployStableswapContract(
  account: algosdk.Account,
  primaryAssetIndex: bigint,
  secondaryAssetIndex: bigint,
  options: {
    feeBps?: bigint;
    pactFeeBps?: bigint;
    amplifier?: bigint;
    version?: number;
  } = {},
) {
  return deployExchangeContract(
    account,
    "STABLESWAP",
    primaryAssetIndex,
    secondaryAssetIndex,
    options,
  );
}

export function deployExchangeContract(
  account: algosdk.Account,
  poolType: PoolType,
  primaryAssetIndex: bigint,
  secondaryAssetIndex: bigint,
  options: {
    feeBps?: bigint;
    pactFeeBps?: bigint;
    amplifier?: bigint;
    version?: number;
  } = {},
) {
  const command = [
    "exchange",
    `--contract-type=${poolType.toLowerCase()}`,
    `--primary_asset_id=${primaryAssetIndex}`,
    `--secondary_asset_id=${secondaryAssetIndex}`,
    `--fee_bps=${options.feeBps ?? 30n}`,
    `--pact_fee_bps=${options.pactFeeBps ?? 0n}`,
    `--amplifier=${(options.amplifier ?? 80n) * 1000n}`,
    `--admin_and_treasury_address=${account.addr}`,
  ];

  if (options.version) {
    command.push(`--version=${options.version}`);
  }

  return deployContract(account, command);
}

export async function addLiquidity(
  account: algosdk.Account,
  pool: Pool,
  primaryAssetAmount = 10_000n,
  secondaryAssetAmount = 10_000n,
  slippagePct = 0n,
) {
  const optInTx = await pool.liquidityAsset.prepareOptInTx(
    algosdk.encodeAddress(account.addr.publicKey),
  );
  await signAndSend(optInTx, account);

  const liquidityAddition = pool.prepareAddLiquidity({
    primaryAssetAmount,
    secondaryAssetAmount,
    slippagePct,
  });
  const addLiqTxGroup = await liquidityAddition.prepareTxGroup(
    algosdk.encodeAddress(account.addr.publicKey),
  );
  await signAndSend(addLiqTxGroup, account);
  await pool.updateState();
}

export type PoolTestBed = {
  account: algosdk.Account;
  pact: PactClient;
  algo: Asset;
  coin: Asset;
  pool: Pool;
};

export async function makeFreshPoolTestbed(
  options: {
    poolType?: PoolType;
    feeBps?: bigint;
    pactFeeBps?: bigint;
    amplifier?: bigint;
    version?: number;
  } = {},
): Promise<PoolTestBed> {
  const account = await newAccount();
  const pact = new PactClient(algod);

  const algo = await pact.fetchAsset(0n);
  const coinIndex = await createAsset(account);
  const coin = await pact.fetchAsset(coinIndex);

  const poolType = options.poolType ?? "CONSTANT_PRODUCT";

  const appId = await deployExchangeContract(
    account,
    poolType,
    algo.index,
    coin.index,
    {
      feeBps: options.feeBps,
      pactFeeBps: options.pactFeeBps,
      amplifier: options.amplifier,
      version: options.version,
    },
  );

  const pool = await pact.fetchPoolById(appId);

  return { account, pact, algo, coin, pool };
}
