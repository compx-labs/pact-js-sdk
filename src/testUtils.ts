import { exec } from "child_process";

import * as algokit from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";

import { encode } from "./encoding";
import { TransactionGroup } from "./transactionGroup";

export const ROOT_ACCOUNT = algosdk.mnemonicToSecretKey(
  "jelly swear alcohol hybrid wrong camp prize attack hurdle shaft solar entry inner arm region economy awful inch they squirrel sort renew legend absorb giant",
);

const ALGOD_DEFAULT_URL = "http://localhost:8787";
const ALGOD_DEFAULT_TOKEN =
  "8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3";

type ParsedEndpoint = {
  server: string;
  port?: number;
};

function parseEndpoint(rawUrl: string): ParsedEndpoint {
  try {
    const normalized = rawUrl.includes("://") ? rawUrl : `http://${rawUrl}`;
    const url = new URL(normalized);
    return {
      server: `${url.protocol}//${url.hostname}`,
      port: url.port ? Number(url.port) : undefined,
    };
  } catch {
    return { server: rawUrl };
  }
}

const resolvedFromUrl = parseEndpoint(
  process.env.ALGOD_URL ?? process.env.ALGOD_SERVER ?? ALGOD_DEFAULT_URL,
);

const resolvedFromServer = process.env.ALGOD_SERVER
  ? parseEndpoint(process.env.ALGOD_SERVER)
  : null;

const algodServer = resolvedFromServer?.server ?? resolvedFromUrl.server;

let algodPort =
  process.env.ALGOD_PORT !== undefined
    ? Number(process.env.ALGOD_PORT)
    : resolvedFromServer?.port ?? resolvedFromUrl.port;

if (
  algodPort === undefined &&
  !process.env.ALGOD_SERVER &&
  !process.env.ALGOD_URL
) {
  algodPort = 8787;
}

const algorand = algokit.AlgorandClient.fromConfig({
  algodConfig: {
    server: algodServer,
    port: algodPort,
    token: process.env.ALGOD_TOKEN ?? ALGOD_DEFAULT_TOKEN,
  },
});

algorand.setDefaultValidityWindow(1000);
export const algod = algorand.client.algod;

export async function signAndSend(
  txToSend: algosdk.Transaction | TransactionGroup,
  account: algosdk.Account,
) {
  const signedTx = txToSend.signTxn(account.sk);
  return await algod.sendRawTransaction(signedTx).do();
}

export type AssetCreateOptions = {
  name: string | undefined;
  unitName: string | null;
  decimals: bigint;
  totalIssuance: bigint;
};

const DEFAULT_ASSET_CREATE_OPTIONS: AssetCreateOptions = {
  name: "COIN",
  unitName: null,
  decimals: 60n,
  totalIssuance: 100_000_000n,
};

export async function createAsset(
  account: algosdk.Account,
  options: Partial<AssetCreateOptions> = {},
): Promise<bigint> {
  const allOptions = { ...DEFAULT_ASSET_CREATE_OPTIONS, ...options };
  const suggestedParams = await algod.getTransactionParams().do();

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    total: BigInt(allOptions.totalIssuance),
    decimals: allOptions.decimals,
    manager: account.addr,
    reserve: account.addr,
    clawback: account.addr,
    freeze: account.addr,
    assetName: allOptions.name,
    unitName: allOptions.unitName ?? allOptions.name,
    defaultFrozen: false,
    suggestedParams,
  });

  const tx = await signAndSend(txn, account);
  const ptx = await algod.pendingTransactionInformation(tx.txid).do();
  return ptx.assetIndex || 0n;
}

export function deployContract(
  account: algosdk.Account,
  command: string[],
): Promise<bigint> {
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);

  command = [
    "cd algorand-testbed &&",
    "ALGOD_URL=http://localhost:8787",
    "ALGOD_TOKEN=8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3",
    `DEPLOYER_MNEMONIC="${mnemonic}"`,
    "poetry",
    "run",
    "python",
    "scripts/deploy.py",
    ...command,
  ];

  return new Promise((resolve, reject) => {
    exec(command.join(" "), (error, stdout, stderr) => {
      if (error) {
        reject(error.message);
        return;
      }
      if (stderr) {
        reject(stderr);
        return;
      }
      const idRegex = /APP ID: (\d+)/;
      const match = idRegex.exec(stdout);
      if (!match) {
        reject("Can't find app id in std out.");
        return;
      }

      resolve(BigInt(parseInt(match[1])));
    });
  });
}

export async function newAccount() {
  const account = algosdk.generateAccount();
  await fundAccountWithAlgos(account, 10_000_000);
  return account;
}

export async function fundAccountWithAlgos(
  account: algosdk.Account,
  amount: number,
) {
  const suggestedParams = await algod.getTransactionParams().do();
  const tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: ROOT_ACCOUNT.addr,
    receiver: account.addr,
    amount: amount,
    suggestedParams,
  });
  await signAndSend(tx, ROOT_ACCOUNT);
}

export async function deployGasStation() {
  const gasStationId = await deployContract(ROOT_ACCOUNT, ["gas-station"]);
  const suggestedParams = await algod.getTransactionParams().do();
  const tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: ROOT_ACCOUNT.addr,
    receiver: algosdk.getApplicationAddress(gasStationId),
    amount: 100_000,
    suggestedParams,
  });
  await signAndSend(tx, ROOT_ACCOUNT);

  return gasStationId;
}

export async function waitRounds(rounds: number, account: algosdk.Account) {
  const suggestedParams = await algod.getTransactionParams().do();
  for (let i = 0; i < rounds; i++) {
    const tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: account.addr,
      amount: 0,
      suggestedParams,
      note: encode(i.toString()),
    });
    await signAndSend(tx, account);
  }
}

export async function getLastBlock() {
  const statusData = await algod.status().do();
  return statusData.lastRound;
}
