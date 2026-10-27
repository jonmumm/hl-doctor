// Seam tests: real HTTP through the SDK and fetch(), against recorded Hyperliquid responses.
// Re-record against the live APIs with: HL_RECORD=1 pnpm vitest run src/doctor/fetch.seam.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchAddressSnapshot, fetchBuilderSnapshot, fetchCoreActivity, fetchEvmTx, type Endpoints } from "./fetch.ts";
import { startReplayServer, type ReplayServer } from "./replay-server.ts";

const FRESH = "0x963a323Bebea09Fe2B094D23144e7187f90514D0"; // playground wallet: never funded
const HLP = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"; // mainnet HLP vault
const DELEGATE_TX = "0xbda23c808243e1ba530c4035f4188bb6d63cb32c6a24a9e8d976d3201dafa24a"; // testnet CoreWriter tokenDelegate
const DELEGATE_CONTRACT = "0xb2308b58a6dfe69f3d46e4cc0c354f6ad5277ca2";
const UNKNOWN_TX = `0x${"ab".repeat(32)}` as const;

let server: ReplayServer;
let ep: Endpoints;

beforeAll(async () => {
  server = await startReplayServer(new URL("./__fixtures__/hyperliquid.json", import.meta.url).pathname);
  ep = server.endpoints;
});
afterAll(async () => {
  await server.close();
  expect(server.misses).toEqual([]);
});

describe("fetchAddressSnapshot", () => {
  it("parses a never-funded testnet address", async () => {
    expect(await fetchAddressSnapshot("testnet", FRESH, ep)).toEqual({
      network: "testnet",
      address: FRESH,
      role: { role: "missing" },
      abstraction: "default",
      legal: { acceptedTerms: false, userAllowed: true },
      perp: { accountValue: 0, withdrawable: 0 },
      spot: { balances: [], evmEscrows: [] },
      rateLimit: { used: 0, cap: 10_000, cumVlm: 0, surplus: 0 },
      evm: { hype: 0, usingBigBlocks: false },
      mainnetDeposited: false,
    });
  });

  it("parses a large mainnet vault, skipping the faucet lookup", async () => {
    const s = await fetchAddressSnapshot("mainnet", HLP, ep);
    expect(s.role).toEqual({ role: "vault" });
    expect(s.perp.accountValue).toBeGreaterThan(1_000_000);
    expect(s.mainnetDeposited).toBeNull();
    expect(s.evm?.usingBigBlocks).toBe(false);
  });

  it("reports the EVM side as unreachable instead of failing", async () => {
    const broken = { ...ep, rpc: { testnet: "http://127.0.0.1:9/evm", mainnet: "http://127.0.0.1:9/evm" } };
    expect((await fetchAddressSnapshot("testnet", FRESH, broken)).evm).toBeNull();
  });

  it("reports the faucet check as unknown when the mainnet lookup fails", async () => {
    const broken = { ...ep, api: { ...ep.api, mainnet: "http://127.0.0.1:9" } };
    expect((await fetchAddressSnapshot("testnet", FRESH, broken)).mainnetDeposited).toBeNull();
  });
});

describe("fetchBuilderSnapshot", () => {
  it("reads approval and the builder's own state", async () => {
    expect(await fetchBuilderSnapshot("mainnet", FRESH, HLP, ep)).toMatchObject({
      user: FRESH,
      builder: HLP,
      approvedMaxFee: 0,
      builderRole: { role: "vault" },
      builderAbstraction: "default",
    });
  });
});

describe("fetchEvmTx", () => {
  it("parses a real CoreWriter tx with its block time", async () => {
    const found = await fetchEvmTx("testnet", DELEGATE_TX, ep);
    expect(found?.tx).toMatchObject({ hash: DELEGATE_TX, status: "success", blockNumber: 67_995_814n, value: 0n });
    expect(found?.tx.logs[0]?.address).toBe("0x3333333333333333333333333333333333333333");
    expect(found?.blockTime).toBe(Date.parse("2026-10-27T05:23:08.000Z"));
  });

  it("returns null for a hash that isn't a HyperEVM tx", async () => {
    expect(await fetchEvmTx("testnet", UNKNOWN_TX, ep)).toBeNull();
  });

  it("surfaces a JSON-RPC error message", async () => {
    await expect(fetchEvmTx("testnet", "0x1234", ep)).rejects.toThrow(/^eth_getTransactionByHash: /);
  });
});

describe("fetchCoreActivity", () => {
  it("collects the emitting contract's HyperCore state", async () => {
    const a = await fetchCoreActivity("testnet", DELEGATE_CONTRACT, Date.parse("2026-10-27T05:23:08.000Z"), ep);
    expect(a.user).toBe(DELEGATE_CONTRACT);
    expect(a.role.role).not.toBe("missing");
    // Asset indexes differ by network: on testnet, perp 0 is SOL, not BTC.
    expect(a.assetNames.get(0)).toBe("SOL");
    expect(Array.isArray(a.orders)).toBe(true);
  });
});
