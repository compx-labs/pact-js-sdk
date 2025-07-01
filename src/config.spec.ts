import { PactClient } from "./client";
import { getGasStation } from "./gasStation";
import { algod } from "./testUtils";

describe("config", () => {
  it("change client config", () => {
    let pact = new PactClient(algod);
    expect(pact.config).toEqual({
      apiUrl: "https://api.pact.fi",
      gasStationId: 1027956681n,
      factoryConstantProductId: 1072843805n,
      factoryNftConstantProductId: 1076423760n,
      folksLendingPoolAdapterId: 1123472996n,
    });
    expect(getGasStation().appId).toBe(1027956681);

    pact = new PactClient(algod, { network: "mainnet" });
    expect(pact.config).toEqual({
      apiUrl: "https://api.pact.fi",
      gasStationId: 1027956681n,
      factoryConstantProductId: 1072843805n,
      factoryNftConstantProductId: 1076423760n,
      folksLendingPoolAdapterId: 1123472996n,
    });

    pact = new PactClient(algod, { network: "testnet" });
    expect(pact.config).toEqual({
      apiUrl: "https://api.testnet.pact.fi",
      gasStationId: 156575978n,
      factoryConstantProductId: 166540424n,
      factoryNftConstantProductId: 190269485n,
      folksLendingPoolAdapterId: 228284187n,
    });

    pact = new PactClient(algod, { network: "dev" });
    expect(pact.config).toEqual({
      apiUrl: "",
      gasStationId: 0n,
      factoryConstantProductId: 0n,
      factoryNftConstantProductId: 0n,
      folksLendingPoolAdapterId: 0n,
    });

    pact = new PactClient(algod, { apiUrl: "overwritten_url" });
    expect(pact.config).toEqual({
      apiUrl: "overwritten_url",
      gasStationId: 1027956681n,
      factoryConstantProductId: 1072843805n,
      factoryNftConstantProductId: 1076423760n,
      folksLendingPoolAdapterId: 1123472996n,
    });

    pact = new PactClient(algod, {
      network: "dev",
      factoryConstantProductId: 123n,
    });
    expect(pact.config).toEqual({
      apiUrl: "",
      gasStationId: 0n,
      factoryConstantProductId: 123n,
      factoryNftConstantProductId: 0n,
      folksLendingPoolAdapterId: 0n,
    });
  });
});
