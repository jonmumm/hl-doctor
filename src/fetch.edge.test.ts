// Parsing edge cases at the seam, using a programmable fake of the info API and JSON-RPC.
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENDPOINTS, explorerTxUrl, fetchAddressSnapshot, fetchCoreActivity, fetchEvmTx, fetchOrder, fetchOrderHistory, hasCoreAccount } from "./fetch.ts";
import { startFakeServer, type ReplayServer } from "./replay-server.ts";
import type { Hex } from "./types.ts";

const USER: Hex = "0x1111111111111111111111111111111111111111";
const HASH: Hex = `0x${"cd".repeat(32)}`;

type Body = Record<string, unknown>;
const isBody = (b: unknown): b is Body => typeof b === "object" && b !== null;

const INFO: Record<string, unknown> = {
  userRole: { role: "user" },
  userAbstraction: "disabled",
  legalCheck: { acceptedTerms: true, userAllowed: true, restrictions: "n" },
  clearinghouseState: { marginSummary: { accountValue: "99.5" }, withdrawable: "40", assetPositions: [] },
  spotClearinghouseState: {
    balances: [{ coin: "USDC", token: 0, total: "12.5", hold: "2", entryNtl: "0" }],
    evmEscrows: [{ coin: "HYPE", token: 150, total: "0.02" }],
  },
  userRateLimit: { cumVlm: "1234.5", nRequestsUsed: 5, nRequestsCap: 11234, nRequestsSurplus: 7 },
  userNonFundingLedgerUpdates: [
    { time: 1, hash: "0x0", delta: { type: "withdraw", usdc: "1" } },
    { time: 9, hash: "0x0", delta: { type: "deposit", usdc: "5" } },
  ],
  historicalOrders: [{ order: { oid: 5, cloid: "0x000000000000000000000000000000ff", coin: "ETH" }, status: "filled", statusTimestamp: 123 }],
  meta: { universe: [{ name: "SOL" }, { name: "BTC" }] },
};

const TX = { hash: HASH, from: USER, to: USER, value: "0x0", blockNumber: "0x10" };
const RECEIPT = { status: "0x1", blockNumber: "0x10", logs: [] };
const RPC: Record<string, unknown> = {
  eth_getBalance: "0xde0b6b3a7640000", // 1 HYPE
  eth_usingBigBlocks: true,
  eth_getTransactionByHash: TX,
  eth_getTransactionReceipt: RECEIPT,
  eth_getBlockByNumber: { timestamp: "0x6ae0353c" },
};

let server: ReplayServer;
const contentTypes: (string | undefined)[] = [];

const pick = (overrides: Record<string, unknown>, defaults: Record<string, unknown>, key: string) =>
  key in overrides ? overrides[key] : defaults[key];

const rpcReply = (id: unknown, result: unknown) =>
  result instanceof Error ? { jsonrpc: "2.0", id, error: { message: result.message } } : { jsonrpc: "2.0", id, result };

const fake = async (info: Record<string, unknown> = {}, rpc: Record<string, unknown> = {}) => {
  server = await startFakeServer(({ path, contentType, body }) => {
    if (!isBody(body)) return { status: 400, body: "bad" };
    if (path.endsWith("/evm")) {
      contentTypes.push(contentType);
      return { body: rpcReply(body.id, pick(rpc, RPC, String(body.method))) };
    }
    return { body: pick(info, INFO, String(body.type)) };
  });
  return server.endpoints;
};

afterEach(async () => {
  await server.close();
  contentTypes.length = 0;
});

describe("fetchAddressSnapshot parsing", () => {
  it("maps every field it reads", async () => {
    expect(await fetchAddressSnapshot("testnet", USER, await fake())).toEqual({
      network: "testnet",
      address: USER,
      role: { role: "user" },
      abstraction: "disabled",
      legal: { acceptedTerms: true, userAllowed: true },
      perp: { accountValue: 99.5, withdrawable: 40 },
      spot: { balances: [{ coin: "USDC", total: 12.5, hold: 2 }], evmEscrows: [{ coin: "HYPE", total: 0.02 }] },
      rateLimit: { used: 5, cap: 11234, cumVlm: 1234.5, surplus: 7 },
      evm: { hype: 1, usingBigBlocks: true },
      mainnetDeposited: true,
    });
  });

  it("sends JSON-RPC requests as application/json", async () => {
    await fetchAddressSnapshot("testnet", USER, await fake());
    expect(contentTypes.length).toBeGreaterThan(0);
    expect(new Set(contentTypes)).toEqual(new Set(["application/json"]));
  });

  it("finds no mainnet deposit when the ledger only has withdrawals", async () => {
    const ep = await fake({ userNonFundingLedgerUpdates: [{ time: 1, hash: "0x0", delta: { type: "withdraw", usdc: "1" } }] });
    expect((await fetchAddressSnapshot("testnet", USER, ep)).mainnetDeposited).toBe(false);
  });

  it("treats a missing evmEscrows field as no escrow", async () => {
    const ep = await fake({ spotClearinghouseState: { balances: [] } });
    expect((await fetchAddressSnapshot("testnet", USER, ep)).spot.evmEscrows).toEqual([]);
  });

  it("reports the EVM side as unreachable when the RPC returns garbage", async () => {
    const ep = await fake({}, { eth_getBalance: "not hex" });
    expect((await fetchAddressSnapshot("testnet", USER, ep)).evm).toBeNull();
  });
});

describe("fetchEvmTx parsing", () => {
  it("returns null while the receipt is missing (pending tx)", async () => {
    expect(await fetchEvmTx("testnet", HASH, await fake({}, { eth_getTransactionReceipt: null }))).toBeNull();
  });
  it("returns null when the node has a receipt but not the tx", async () => {
    expect(await fetchEvmTx("testnet", HASH, await fake({}, { eth_getTransactionByHash: null }))).toBeNull();
  });
  it("marks status 0x0 as reverted and converts block time to ms", async () => {
    const found = await fetchEvmTx("testnet", HASH, await fake({}, { eth_getTransactionReceipt: { ...RECEIPT, status: "0x0" } }));
    expect(found).toEqual({
      tx: { hash: HASH, from: USER, to: USER, value: 0n, status: "reverted", blockNumber: 16n, logs: [] },
      blockTime: 0x6ae0353c * 1000,
    });
  });
  it("marks status 0x1 as success", async () => {
    expect((await fetchEvmTx("testnet", HASH, await fake()))?.tx.status).toBe("success");
  });
  it.each([["12"], ["0x12zz"], ["zz0x12"], [12], [["0x12"]]])("rejects a non-hex value %j", async (value) => {
    await expect(fetchEvmTx("testnet", HASH, await fake({}, { eth_getTransactionByHash: { ...TX, value } }))).rejects.toThrow(/expected hex/);
  });
  it("surfaces the JSON-RPC error message", async () => {
    await expect(fetchEvmTx("testnet", HASH, await fake({}, { eth_getTransactionByHash: new Error("boom") }))).rejects.toThrow("eth_getTransactionByHash: boom");
  });
});

describe("fetchCoreActivity parsing", () => {
  it("maps orders, ledger, escrow, margin and asset names", async () => {
    const a = await fetchCoreActivity("testnet", USER, 1_000, await fake());
    expect(a).toEqual({
      user: USER,
      role: { role: "user" },
      orders: [{ oid: 5, cloid: "0x000000000000000000000000000000ff", coin: "ETH", status: "filled", statusTimestamp: 123 }],
      ledger: [{ time: 1, type: "withdraw" }, { time: 9, type: "deposit" }],
      evmEscrows: [{ coin: "HYPE", total: 0.02 }],
      perpWithdrawable: 40,
      assetNames: new Map([[0, "SOL"], [1, "BTC"]]),
    });
  });
  it("treats a missing evmEscrows field as no escrow", async () => {
    const a = await fetchCoreActivity("testnet", USER, 1_000, await fake({ spotClearinghouseState: { balances: [] } }));
    expect(a.evmEscrows).toEqual([]);
  });
});

describe("endpoints", () => {
  it("defaults to the documented public endpoints", async () => {
    await fake();
    expect(DEFAULT_ENDPOINTS).toEqual({
      api: { testnet: "https://api.hyperliquid-testnet.xyz", mainnet: "https://api.hyperliquid.xyz" },
      rpc: { testnet: "https://rpc.hyperliquid-testnet.xyz/evm", mainnet: "https://rpc.hyperliquid.xyz/evm" },
    });
  });
  it("links HyperCore txs to the right explorer", async () => {
    await fake();
    expect(explorerTxUrl("testnet", HASH)).toBe(`https://app.hyperliquid-testnet.xyz/explorer/tx/${HASH}`);
    expect(explorerTxUrl("mainnet", HASH)).toBe(`https://app.hyperliquid.xyz/explorer/tx/${HASH}`);
  });
});

describe("ledger window", () => {
  it("asks for ledger entries from 5s before the tx", async () => {
    const starts: unknown[] = [];
    server = await startFakeServer(({ body }) => {
      if (isBody(body) && body.type === "userNonFundingLedgerUpdates") starts.push(body.startTime);
      return { body: isBody(body) && typeof body.type === "string" ? INFO[body.type] : null };
    });
    await fetchCoreActivity("testnet", USER, 1_800_000_000_000, server.endpoints);
    expect(starts).toEqual([1_799_999_995_000]);
  });
  it("never asks for a negative start time", async () => {
    const starts: unknown[] = [];
    server = await startFakeServer(({ body }) => {
      if (isBody(body) && body.type === "userNonFundingLedgerUpdates") starts.push(body.startTime);
      return { body: isBody(body) && typeof body.type === "string" ? INFO[body.type] : null };
    });
    await fetchCoreActivity("testnet", USER, 1_000, server.endpoints);
    expect(starts).toEqual([0]);
  });
});

describe("orders", () => {
  const ORDER = { coin: "BTC", side: "A", limitPx: "65000.0", sz: "0.0", origSz: "0.01", oid: 7, cloid: null, timestamp: 1 };

  it("maps historicalOrders to order records", async () => {
    const ep = await fake({ historicalOrders: [{ order: ORDER, status: "tickRejected", statusTimestamp: 99 }] });
    expect(await fetchOrderHistory("testnet", USER, ep)).toEqual([
      { oid: 7, cloid: null, coin: "BTC", side: "A", limitPx: "65000.0", origSz: "0.01", status: "tickRejected", statusTimestamp: 99 },
    ]);
  });

  it("hasCoreAccount is false (not just falsy) when the lookup fails", async () => {
    server = await startFakeServer(() => ({ status: 500, body: "down" }));
    expect(await hasCoreAccount("testnet", USER, server.endpoints)).toBe(false);
  });

  it("gives no history when the lookup fails", async () => {
    server = await startFakeServer(() => ({ status: 500, body: "down" }));
    expect(await fetchOrderHistory("testnet", USER, server.endpoints)).toBeNull();
  });

  it("maps a found order and asks for it by oid", async () => {
    const asked: unknown[] = [];
    server = await startFakeServer(({ body }) => (asked.push(body), { body: { status: "order", order: { order: ORDER, status: "open", statusTimestamp: 5 } } }));
    expect(await fetchOrder("mainnet", USER, 7, server.endpoints)).toMatchObject({ oid: 7, status: "open", statusTimestamp: 5 });
    expect(asked).toEqual([{ type: "orderStatus", user: USER, oid: 7 }]);
  });

  it("returns null for unknownOid", async () => {
    const ep = await fake({ orderStatus: { status: "unknownOid" } });
    expect(await fetchOrder("testnet", USER, "0x000000000000000000000000000000ff", ep)).toBeNull();
  });
});
