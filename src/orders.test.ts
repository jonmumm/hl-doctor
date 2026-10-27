import { describe, expect, it } from "vitest";
import { CANCELS, diagnoseOrder, recentRejections, REJECTIONS } from "./orders.ts";
import type { OrderRecord } from "./types.ts";

const order: OrderRecord = {
  oid: 63823780855,
  cloid: null,
  coin: "ETH",
  side: "B",
  limitPx: "2356.6",
  origSz: "0.0056",
  status: "filled",
  statusTimestamp: Date.UTC(2026, 9, 27, 8, 0),
};
const at = (status: string, over: Partial<OrderRecord> = {}) => diagnoseOrder("63823780855", { ...order, status, ...over });

describe("diagnoseOrder", () => {
  it("a filled order is ok and shows coin, side, size and price", () => {
    expect(at("filled")).toEqual([
      { severity: "ok", title: "ETH buy order filled", detail: "oid 63823780855: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z" },
    ]);
  });

  it("an open order is ok, and a sell shows as sell with its cloid", () => {
    expect(at("open", { side: "A", cloid: "0x77358a5efbdd32bf929b06785cf18c56" })).toEqual([
      {
        severity: "ok",
        title: "ETH sell order open",
        detail: "oid 63823780855, cloid 0x77358a5efbdd32bf929b06785cf18c56: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z",
      },
    ]);
  });

  it("a triggered order is ok", () => {
    expect(at("triggered")[0].severity).toBe("ok");
  });

  it("a user cancel is info", () => {
    expect(at("canceled")).toEqual([
      { severity: "info", title: "ETH buy order canceled", detail: "oid 63823780855: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z\nCanceled by the user." },
    ]);
  });

  it("a cancel by HyperCore is a warning with the reason", () => {
    expect(at("reduceOnlyCanceled")).toEqual([
      {
        severity: "warn",
        title: "ETH buy order canceled by HyperCore (reduceOnlyCanceled)",
        detail: "oid 63823780855: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z\nA reduce-only order would no longer reduce the position.",
      },
    ]);
  });

  it.each(Object.entries(CANCELS))("%s is a warning with its reason", (status, why) => {
    expect(at(status)).toEqual([
      { severity: "warn", title: `ETH buy order canceled by HyperCore (${status})`, detail: `oid 63823780855: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z\n${why}` },
    ]);
  });

  it.each(Object.entries(REJECTIONS))("%s is an error with its explanation", (status, why) => {
    expect(at(status)).toEqual([
      { severity: "error", title: `ETH buy order rejected (${status})`, detail: `oid 63823780855: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z\n${why}` },
    ]);
  });

  it("an unmapped rejection is still an error", () => {
    expect(at("rejected")).toEqual([
      { severity: "error", title: "ETH buy order rejected (rejected)", detail: "oid 63823780855: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z\nHyperCore rejected the order." },
    ]);
  });

  it("an unknown status is a warning that says so", () => {
    expect(at("brandNewStatus")).toEqual([
      {
        severity: "warn",
        title: "ETH buy order brandNewStatus",
        detail: "oid 63823780855: size 0.0056 at 2356.6, status since 2026-10-27T08:00:00.000Z\nhl-doctor does not know this status yet.",
      },
    ]);
  });

  it("an unknown order says where else to look", () => {
    expect(diagnoseOrder("0x77358a5efbdd32bf929b06785cf18c56", null)).toEqual([
      {
        severity: "warn",
        title: "No order 0x77358a5efbdd32bf929b06785cf18c56 for this address",
        detail: "HyperCore answered unknownOid on this network.",
        fix: "Check the network (--mainnet) and that this address placed it: orders sent by an API (agent) wallet belong to the owner's address.",
      },
    ]);
  });
});

describe("recentRejections", () => {
  const now = Date.UTC(2026, 9, 27, 12, 0);
  const H = 3_600_000;
  const o = (coin: string, status: string, hoursAgo: number) => ({ coin, status, statusTimestamp: now - hoursAgo * H });

  it("says none when nothing was rejected in the last 24 h", () => {
    expect(recentRejections([o("ETH", "filled", 1), o("ETH", "tickRejected", 25), o("ETH", "canceled", 2)], now)).toEqual([
      { severity: "info", title: "No orders rejected in the last 24 h" },
    ]);
  });

  it("says none for an account with no orders", () => {
    expect(recentRejections([], now)).toEqual([{ severity: "info", title: "No orders rejected in the last 24 h" }]);
  });

  it("groups rejections by status, most frequent first, with coins and explanations", () => {
    const orders = [o("SOL", "minTradeNtlRejected", 1), o("ETH", "tickRejected", 2), o("BTC", "tickRejected", 3), o("ETH", "tickRejected", 24), o("ETH", "rejected", 4)];
    expect(recentRejections(orders, now)).toEqual([
      {
        severity: "warn",
        title: "5 orders rejected in the last 24 h",
        detail: [
          "3 × tickRejected (ETH, BTC): The price is not a multiple of the tick size.",
          "1 × minTradeNtlRejected (SOL): The order is below the $10 minimum notional.",
          "1 × rejected (ETH): HyperCore rejected the order.",
        ].join("\n"),
        fix: "Run again with --order <oid> for one order's details.",
      },
    ]);
  });

  it("uses the singular for one rejection", () => {
    expect(recentRejections([o("SOL", "minTradeNtlRejected", 1)], now)[0].title).toBe("1 order rejected in the last 24 h");
  });
});
