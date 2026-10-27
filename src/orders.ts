// Pure checks: what an order status means, for one order or for the last day's rejections.
// Statuses and their meanings: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-order-status-by-oid-or-cloid
// (as listed in @nktkas/hyperliquid's OrderStatusResponse).
import type { Finding, OrderRecord } from "./types.ts";

export const REJECTIONS: Record<string, string> = {
  perpMarginRejected: "Not enough margin in the perps account for this order.",
  insufficientSpotBalanceRejected: "Not enough spot balance for this order.",
  tickRejected: "The price is not a multiple of the tick size.",
  minTradeNtlRejected: "The order is below the $10 minimum notional.",
  badAloPxRejected: "A post-only (Alo) order would have crossed the book.",
  iocCancelRejected: "An IOC order found nothing to fill against at that price.",
  marketOrderNoLiquidityRejected: "No liquidity to fill a market order.",
  reduceOnlyRejected: "Reduce-only order would have increased the position.",
  oracleRejected: "The price is too far from the oracle price.",
  tooManyOpenOrdersRejected: "The account has too many open orders.",
  perpMaxPositionRejected: "The order would exceed the maximum position size.",
  openInterestIncreaseRejected: "The market is at its open interest cap.",
  badTriggerPxRejected: "The TP/SL trigger price is invalid.",
  positionIncreaseAtOpenInterestCapRejected: "The market is at its open interest cap, so the position can't grow.",
  positionFlipAtOpenInterestCapRejected: "The market is at its open interest cap, so the position can't flip sides.",
  tooAggressiveAtOpenInterestCapRejected: "The market is at its open interest cap and the price is too aggressive.",
};

export const CANCELS: Record<string, string> = {
  marginCanceled: "The account no longer had the margin for it.",
  vaultWithdrawalCanceled: "A withdrawal from the vault canceled it.",
  openInterestCapCanceled: "It was too aggressive while the market was at its open interest cap.",
  selfTradeCanceled: "Self-trade prevention: it would have matched the account's own order.",
  reduceOnlyCanceled: "A reduce-only order would no longer reduce the position.",
  siblingFilledCanceled: "Its sibling TP/SL order filled.",
  delistedCanceled: "The asset was delisted.",
  liquidatedCanceled: "The account was liquidated.",
  outcomeSettledCanceled: "The outcome market settled.",
  scheduledCancel: "The scheduled cancel (dead man's switch) deadline passed.",
  internalCancel: "An internal HyperCore error canceled it.",
};

const DAY_MS = 86_400_000;

export const isRejected = (status: string) => status === "rejected" || status.endsWith("Rejected");

export const rejectionReason = (status: string) => REJECTIONS[status] ?? "HyperCore rejected the order.";

const verdict = (status: string): Pick<Finding, "severity" | "title"> & { why?: string } => {
  if (isRejected(status)) return { severity: "error", title: `rejected (${status})`, why: rejectionReason(status) };
  if (status in CANCELS) return { severity: "warn", title: `canceled by HyperCore (${status})`, why: CANCELS[status] };
  if (status === "canceled") return { severity: "info", title: status, why: "Canceled by the user." };
  if (["filled", "open", "triggered"].includes(status)) return { severity: "ok", title: status };
  return { severity: "warn", title: status, why: "hl-doctor does not know this status yet." };
};

/** `query` is the oid or cloid the user asked about; `order` is null when HyperCore answered unknownOid. */
export const diagnoseOrder = (query: string, order: OrderRecord | null): Finding[] => {
  if (!order) {
    return [
      {
        severity: "warn",
        title: `No order ${query} for this address`,
        detail: "HyperCore answered unknownOid on this network.",
        fix: "Check the network (--mainnet) and that this address placed it: orders sent by an API (agent) wallet belong to the owner's address.",
      },
    ];
  }
  const v = verdict(order.status);
  const id = order.cloid ? `oid ${order.oid}, cloid ${order.cloid}` : `oid ${order.oid}`;
  const facts = `${id}: size ${order.origSz} at ${order.limitPx}, status since ${new Date(order.statusTimestamp).toISOString()}`;
  const side = order.side === "B" ? "buy" : "sell";
  return [{ severity: v.severity, title: `${order.coin} ${side} order ${v.title}`, detail: v.why ? `${facts}\n${v.why}` : facts }];
};

/** Rejections in the 24 h before `now`, grouped by status. historicalOrders holds at most the latest 2000 orders. */
export const recentRejections = (orders: Pick<OrderRecord, "coin" | "status" | "statusTimestamp">[], now: number): Finding[] => {
  const rejected = orders.filter((o) => isRejected(o.status) && o.statusTimestamp >= now - DAY_MS);
  if (rejected.length === 0) return [{ severity: "info", title: "No orders rejected in the last 24 h" }];
  const groups = new Map<string, typeof rejected>();
  for (const o of rejected) groups.set(o.status, [...(groups.get(o.status) ?? []), o]);
  const lines = [...groups]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([status, os]) => `${os.length} × ${status} (${[...new Set(os.map((o) => o.coin))].join(", ")}): ${rejectionReason(status)}`);
  return [
    {
      severity: "warn",
      title: `${rejected.length} order${rejected.length === 1 ? "" : "s"} rejected in the last 24 h`,
      detail: lines.join("\n"),
      fix: "Run again with --order <oid> for one order's details.",
    },
  ];
};
