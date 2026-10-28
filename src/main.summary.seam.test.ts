// The text-mode summary lines and tx-not-found handling, against a programmable fake of both APIs.
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { run } from "./main.ts";
import { startFakeServer, type ReplayServer } from "./replay-server.ts";

const USER = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"cd".repeat(32)}`;

const INFO: Record<string, unknown> = {
  userRole: { role: "user" },
  userAbstraction: "disabled",
  legalCheck: { acceptedTerms: true, userAllowed: true, restrictions: "n" },
  clearinghouseState: { marginSummary: { accountValue: "150" }, withdrawable: "120", assetPositions: [] },
  spotClearinghouseState: {
    balances: [
      { coin: "USDC", token: 0, total: "12.5", hold: "0", entryNtl: "0" },
      { coin: "HYPE", token: 150, total: "3", hold: "0", entryNtl: "0" },
    ],
  },
  userRateLimit: { cumVlm: "0", nRequestsUsed: 0, nRequestsCap: 10000, nRequestsSurplus: 0 },
  userNonFundingLedgerUpdates: [],
  historicalOrders: [],
  meta: { universe: [] },
};
const RPC: Record<string, unknown> = { eth_getBalance: "0x1bc16d674ec80000", eth_usingBigBlocks: false }; // 2 HYPE

const Body = z.object({ type: z.string().optional(), method: z.string().optional(), id: z.unknown().optional() });

let server: ReplayServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

type Rpc = (network: string, method: string) => { result: unknown } | { status: number };

const cli = async (argv: string[], info: Record<string, unknown> = {}, rpc: Rpc = (_, m) => ({ result: RPC[m] })) => {
  server = await startFakeServer(({ path, body }) => {
    const { type, method, id } = Body.parse(body);
    const network = path.split("/")[1] ?? "";
    if (path.endsWith("/evm")) {
      const r = rpc(network, method ?? "");
      return "status" in r ? { status: r.status, body: "down" } : { body: { jsonrpc: "2.0", id, result: r.result } };
    }
    const key = type ?? "";
    return { body: key in info ? info[key] : INFO[key] };
  });
  const out: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: () => {}, color: false }, server.endpoints);
  return { code, lines: out.join("\n").split("\n") };
};

describe("address summary", () => {
  it("lists every spot balance and the HyperEVM HYPE balance", async () => {
    const { lines } = await cli([USER]);
    expect(lines.slice(0, 3)).toEqual([
      `${USER} on testnet`,
      "  perps value 150 USDC, withdrawable 120; mode Manual / Standard",
      "  spot: 12.5 USDC, 3 HYPE; HyperEVM: 2 HYPE",
    ]);
  });

  it("says empty for no spot balances and leaves out HyperEVM when the RPC is down", async () => {
    const { lines } = await cli([USER], { spotClearinghouseState: { balances: [] } }, () => ({ status: 500 }));
    expect(lines[2]).toBe("  spot: empty");
  });
});

describe("tx not found", () => {
  const TX = { hash: HASH, from: USER, to: null, value: "0x0", blockNumber: "0x10" };
  const RECEIPT = { status: "0x1", blockNumber: "0x10", logs: [] };

  it("prints no summary line and points to the other network when the tx is there", async () => {
    const { lines } = await cli([HASH], {}, (network, m) =>
      network === "mainnet" ? { result: { eth_getTransactionByHash: TX, eth_getTransactionReceipt: RECEIPT, eth_getBlockByNumber: { timestamp: "0x1" } }[m] } : { result: null },
    );
    expect(lines).toEqual([`${HASH} on testnet`, "", "HyperCore effect", "  WARN This tx is on mainnet, not testnet", "       → Re-run with --mainnet."]);
  });

  it("treats a failed lookup on the other network as not found there", async () => {
    const { lines } = await cli([HASH], {}, (network) => (network === "mainnet" ? { status: 500 } : { result: null }));
    expect(lines[3]).toBe("  INFO Not a HyperEVM tx on testnet");
  });

  it("shows a contract creation in the summary", async () => {
    const { lines } = await cli([HASH], {}, (_, m) => ({ result: { eth_getTransactionByHash: TX, eth_getTransactionReceipt: RECEIPT, eth_getBlockByNumber: { timestamp: "0x1" } }[m] }));
    expect(lines[1]).toBe(`  block 16 at 1970-01-01T00:00:01.000Z, from ${USER} to (contract creation)`);
  });
});
