import algosdk from "algosdk";

import { PactClient } from "./client";
import { algod, createAsset, newAccount, signAndSend } from "./testUtils";

describe("Asset", () => {
  it("fetch ALGO", async () => {
    const pact = new PactClient(algod);
    const asset = await pact.fetchAsset(0n);

    expect(asset.decimals).toBe(6n);
    expect(asset.index).toBe(0n);
    expect(asset.name).toBe("Algo");
    expect(asset.unitName).toBe("ALGO");
    expect(asset.ratio).toBe(10n ** 6n);
  });

  it("fetch ASA", async () => {
    const pact = new PactClient(algod);
    const account = await newAccount();
    const assetIndex = await createAsset(account, {
      name: "JAMNIK",
      decimals: 10n,
    });
    const asset = await pact.fetchAsset(assetIndex);

    expect(asset.decimals).toBe(10n);
    expect(asset.index).toBe(assetIndex);
    expect(asset.name).toBe("JAMNIK");
    expect(asset.unitName).toBe("JAMNIK");
    expect(asset.ratio).toBe(10n ** 10n);
  });

  it("fetch ASA with no name", async () => {
    const pact = new PactClient(algod);
    const account = await newAccount();
    const assetIndex = await createAsset(account, {
      name: undefined,
      decimals: 10n,
    });
    const asset = await pact.fetchAsset(assetIndex);

    expect(asset.decimals).toBe(10n);
    expect(asset.index).toBe(assetIndex);
    expect(asset.name).toBeUndefined();
    expect(asset.unitName).toBeUndefined();
    expect(asset.ratio).toBe(10n ** 10n);
  });

  it("fetch not existing asset", async () => {
    const pact = new PactClient(algod);

    await expect(pact.fetchAsset(99999999n)).rejects.toMatchObject({
      status: 404,
      response: { body: { message: "asset does not exist" } },
    });
  });

  it("opt in for an asset", async () => {
    const pact = new PactClient(algod);
    const creator = await newAccount();
    const assetIndex = await createAsset(creator, {
      name: "test",
      decimals: 10n,
    });
    const asset = await pact.fetchAsset(assetIndex);

    const user = await newAccount();
    expect(
      await asset.isOptedIn(algosdk.encodeAddress(user.addr.publicKey)),
    ).toBe(false);

    const optInTx = await asset.prepareOptInTx(
      algosdk.encodeAddress(user.addr.publicKey),
    );
    await signAndSend(optInTx, user);

    expect(
      await asset.isOptedIn(algosdk.encodeAddress(user.addr.publicKey)),
    ).toBe(true);
  });
});
