// --order and the 24 h rejection summary, against real testnet orders found with scripts/find-cases.ts.
// Re-record against the live APIs with: HL_RECORD=1 pnpm vitest run src/orders.seam.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { run } from "./main.ts";
import { startReplayServer, type ReplayServer } from "./replay-server.ts";

const FILLED = { user: "0x08cb8ac0220911ed95944c14009d9f5281e168eb", oid: "63823780855", cloid: "0x77358a5efbdd32bf929b06785cf18c56" }; // CoreWriter ETH IOC buy
const REJECTED = { user: "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1", oid: "63367351019", at: 1792647637746 }; // SOL Alo buy below $10

const Finding = z.object({ severity: z.string(), title: z.string(), detail: z.string().optional(), fix: z.string().optional() }).strict();
const Report = z.object({ sections: z.array(z.object({ heading: z.string(), findings: z.array(Finding) })) });

let server: ReplayServer;

beforeAll(async () => {
  server = await startReplayServer(new URL("./__fixtures__/orders.json", import.meta.url).pathname);
});
afterAll(async () => {
  await server.close();
  expect(server.misses).toEqual([]);
});

const doctor = async (now: number, ...argv: string[]) => {
  const out: string[] = [];
  const code = await run([...argv, "--json"], { out: (s) => out.push(s), err: () => {}, color: false }, server.endpoints, now);
  const { sections } = Report.parse(JSON.parse(out.join("\n")));
  const account = sections[0].findings.filter((f) => f.title.includes("in the last 24 h"));
  return { code, account, order: sections.find((s) => s.heading.startsWith("Order ")) };
};

describe("--order", () => {
  const LATER = Date.UTC(2030, 0, 1);

  it("explains a filled order by oid", async () => {
    const { order } = await doctor(LATER, FILLED.user, "--order", FILLED.oid);
    expect(order).toEqual({
      heading: `Order ${FILLED.oid}`,
      findings: [{ severity: "ok", title: "ETH buy order filled", detail: `oid ${FILLED.oid}, cloid ${FILLED.cloid}: size 0.0056 at 2356.6, status since 2026-10-27T15:22:25.360Z` }],
    });
  });

  it("finds the same order by cloid", async () => {
    const { order } = await doctor(LATER, FILLED.user, "--order", FILLED.cloid);
    expect(order?.heading).toBe(`Order ${FILLED.cloid}`);
    expect(order?.findings.map((f) => f.title)).toEqual(["ETH buy order filled"]);
  });

  it("explains a rejected order and fails the run", async () => {
    const { order, code } = await doctor(LATER, REJECTED.user, "--order", REJECTED.oid);
    expect(order?.findings).toEqual([
      {
        severity: "error",
        title: "SOL buy order rejected (minTradeNtlRejected)",
        detail: `oid ${REJECTED.oid}: size 0.1 at 50.0, status since 2026-10-22T05:40:37.746Z\nThe order is below the $10 minimum notional.`,
      },
    ]);
    expect(code).toBe(1);
  });

  it("says when the address has no such order", async () => {
    const { order } = await doctor(LATER, FILLED.user, "--order", "1");
    expect(order?.findings.map((f) => [f.severity, f.title])).toEqual([["warn", "No order 1 for this address"]]);
  });
});

describe("rejections in the last 24 h", () => {
  it("summarises the rejected order within a day of it", async () => {
    const { account } = await doctor(REJECTED.at + 3_600_000, REJECTED.user);
    expect(account).toEqual([
      {
        severity: "warn",
        title: "1 order rejected in the last 24 h",
        detail: "1 × minTradeNtlRejected (SOL): The order is below the $10 minimum notional.",
        fix: "Run again with --order <oid> for one order's details.",
      },
    ]);
  });

  it("says none once the day has passed", async () => {
    const { account } = await doctor(REJECTED.at + 25 * 3_600_000, REJECTED.user);
    expect(account).toEqual([{ severity: "info", title: "No orders rejected in the last 24 h" }]);
  });
});
