// Address mode: when the address has no account on the chosen network, the CLI checks the other one.
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { run } from "./main.ts";
import { startFakeServer, type ReplayServer } from "./replay-server.ts";
import type { Network } from "./types.ts";

const USER = "0x1111111111111111111111111111111111111111";

const INFO: Record<string, unknown> = {
  userAbstraction: "default",
  legalCheck: { acceptedTerms: false, userAllowed: true, restrictions: "n" },
  clearinghouseState: { marginSummary: { accountValue: "0" }, withdrawable: "0", assetPositions: [] },
  spotClearinghouseState: { balances: [], evmEscrows: [] },
  userRateLimit: { cumVlm: "0", nRequestsUsed: 0, nRequestsCap: 10000, nRequestsSurplus: 0 },
  userNonFundingLedgerUpdates: [],
};

const RPC: Record<string, unknown> = { eth_getBalance: "0x0", eth_usingBigBlocks: false };

const Body = z.object({ type: z.string().optional(), method: z.string().optional(), id: z.unknown().optional() });
const Finding = z.looseObject({ severity: z.string(), title: z.string(), fix: z.string().optional() });
const Report = z.object({ sections: z.array(z.object({ findings: z.array(Finding) })) });

let server: ReplayServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** roles: the userRole each network reports; a network set to "down" answers 500. */
const doctor = async (roles: Record<Network, string>, ...argv: string[]) => {
  const roleQueries: string[] = [];
  server = await startFakeServer(({ path, body }) => {
    const { type, method, id } = Body.parse(body);
    const network = path.split("/")[1] === "mainnet" ? "mainnet" : "testnet";
    if (path.endsWith("/evm")) return { body: { jsonrpc: "2.0", id, result: RPC[method ?? ""] } };
    if (type !== "userRole") return { body: INFO[type ?? ""] };
    roleQueries.push(network);
    return roles[network] === "down" ? { status: 500, body: "down" } : { body: { role: roles[network] } };
  });
  const out: string[] = [];
  const code = await run([USER, ...argv, "--json"], { out: (s) => out.push(s), err: () => {}, color: false }, server.endpoints);
  const findings = Report.parse(JSON.parse(out.join(""))).sections.flatMap((s) => s.findings);
  return { code, findings, hints: findings.filter((f) => f.title.startsWith("This address is active on")), roleQueries };
};

describe("network hint for an address", () => {
  it("points a testnet run at mainnet when the account lives there", async () => {
    const { hints, code } = await doctor({ testnet: "missing", mainnet: "user" });
    expect(hints).toEqual([{ severity: "warn", title: "This address is active on mainnet, not testnet", fix: "Re-run with --mainnet." }]);
    expect(code).toBe(1);
  });

  it("points a mainnet run at testnet when the account lives there", async () => {
    const { hints } = await doctor({ testnet: "user", mainnet: "missing" }, "--mainnet");
    expect(hints).toEqual([{ severity: "warn", title: "This address is active on testnet, not mainnet", fix: "Re-run without --mainnet." }]);
  });

  it("gives no hint when neither network has the account", async () => {
    const { hints, findings } = await doctor({ testnet: "missing", mainnet: "missing" }, "--mainnet");
    expect(hints).toEqual([]);
    expect(findings.map((f) => f.title)).toContain("No HyperCore account on mainnet");
  });

  it("ignores a failed lookup on the other network", async () => {
    const { hints, findings } = await doctor({ testnet: "missing", mainnet: "down" });
    expect(hints).toEqual([]);
    expect(findings.map((f) => f.title)).toContain("No HyperCore account on testnet");
  });

  it("does not query the other network when the account exists", async () => {
    const { hints, roleQueries } = await doctor({ testnet: "missing", mainnet: "user" }, "--mainnet");
    expect(hints).toEqual([]);
    expect(roleQueries).toEqual(["mainnet"]);
  });
});
