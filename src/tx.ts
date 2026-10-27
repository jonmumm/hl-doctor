// Pure checks: did each HyperCore-bound part of an EVM tx have the effect it should?
import { formatUnits, numberToHex } from "viem";
import { isRejected, rejectionReason } from "./orders.ts";
import type { CoreActivity, DecodedAction, EvmEvent, EvmTx, FieldValue, Finding, Hex, Network } from "./types.ts";

const QUEUE_GRACE_MS = 10_000; // CoreWriter orders and vault transfers are delayed "a few seconds" (docs)
const CLOCK_SKEW_MS = 1_000;
const SCALING_NOTE = "CoreWriter limitPx and sz are 10^8 × the human value, and the price must still fit the tick (5 significant figures, ≤ 6 - szDecimals decimals).";

const MOVES_FUNDS = new Set(["sendAsset", "spotSend", "usdClassTransfer", "vaultTransfer", "stakingDeposit", "stakingWithdraw"]);

const show = (fields: Record<string, FieldValue>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");

type Order = CoreActivity["orders"][number];
type OkAction = Extract<DecodedAction, { ok: true }>;

const matchOrder = (action: OkAction, a: CoreActivity, blockTime: number): Order | undefined => {
  const cloid = action.fields.cloid;
  const after = a.orders.filter((o) => o.statusTimestamp >= blockTime - CLOCK_SKEW_MS);
  if (typeof cloid === "bigint" && cloid !== 0n) {
    const hex = numberToHex(cloid, { size: 16 });
    return after.find((o) => o.cloid?.toLowerCase() === hex);
  }
  const coin = a.assetNames.get(Number(action.fields.asset));
  return after.find((o) => o.coin === coin);
};

const matchedOrderFinding = (o: Order): Finding => {
  if (isRejected(o.status)) {
    return {
      severity: "error",
      title: `${o.coin} order rejected (${o.status})`,
      detail: rejectionReason(o.status),
      fix: o.status === "tickRejected" ? SCALING_NOTE : undefined,
    };
  }
  const fine = ["filled", "open", "triggered"].includes(o.status);
  return { severity: fine ? "ok" : "warn", title: `${o.coin} order ${o.status}`, detail: `oid ${o.oid}` };
};

const missingOrderFinding = (asset: number, a: CoreActivity): Finding => {
  const coin = a.assetNames.get(asset);
  const causes = [
    coin === undefined ? `asset ${asset} is not a perp market on this network (spot pairs are 10000 + index).` : null,
    a.perpWithdrawable === 0 ? "perps withdrawable is 0, so there is no margin for a new order." : null,
    "the price or size was not scaled by 10^8 or was off-tick.",
  ].filter((c) => c !== null);
  return {
    severity: "error",
    title: `No matching order on HyperCore for ${coin ?? `asset ${asset}`}`,
    detail: `HyperCore shows no order from this account after the tx. Likely causes:\n- ${causes.join("\n- ")}`,
    fix: SCALING_NOTE,
  };
};

const QUEUED_ORDER: Finding = {
  severity: "info",
  title: "Order may still be queued",
  detail: "CoreWriter orders are delayed a few seconds before HyperCore runs them. Check again shortly.",
};

const orderFindings = (action: OkAction, a: CoreActivity, blockTime: number, age: number): Finding => {
  const match = matchOrder(action, a, blockTime);
  if (match) return matchedOrderFinding(match);
  return age < QUEUE_GRACE_MS ? QUEUED_ORDER : missingOrderFinding(Number(action.fields.asset), a);
};

const noAccountFinding = (user: Hex, label: string): Finding => ({
  severity: "error",
  title: `${user} has no HyperCore account`,
  detail: `CoreWriter actions run as the address that emitted them (${user}). If that's a contract, it is not the wallet that sent the tx: the contract needs its own HyperCore account, or HyperCore drops the action. Action: ${label}`,
  fix: "Activate the contract's HyperCore account first (send it USDC or HYPE on HyperCore).",
});

const fundsFinding = (action: OkAction, label: string, a: CoreActivity, blockTime: number, age: number): Finding => {
  const entry = a.ledger.find((l) => l.time >= blockTime - CLOCK_SKEW_MS);
  if (entry) return { severity: "ok", title: `${action.name}: landed on HyperCore (${entry.type})`, detail: label };
  if (age < QUEUE_GRACE_MS) return { severity: "info", title: `${action.name}: may still be queued`, detail: label };
  return {
    severity: "warn",
    title: `${action.name}: nothing landed on HyperCore`,
    detail: `${label}\nThe EVM tx succeeded, but HyperCore checks the action when it runs it. Likely causes:\n- not enough balance of that token on the sending HyperCore account\n- the destination has no HyperCore account (sending to a new address costs a 1 USDC activation fee)\n- wrong token index or dex`,
  };
};

const coreWriterFindings = (user: Hex, action: DecodedAction, a: CoreActivity | undefined, blockTime: number, age: number): Finding => {
  if (!action.ok) return { severity: "error", title: `CoreWriter action ${action.id} could not be decoded`, detail: action.reason };
  const label = `${action.name}(${show(action.fields)})`;
  if (!a || a.role.role === "missing") return noAccountFinding(user, label);
  if (action.name === "limitOrder") return orderFindings(action, a, blockTime, age);
  if (MOVES_FUNDS.has(action.name)) return fundsFinding(action, label, a, blockTime, age);
  return { severity: "info", title: `${action.name}: decoded, effect not verified`, detail: label };
};

const isEscrowed = (a: CoreActivity | undefined, escrowCoin: string | null) =>
  a?.evmEscrows.some((e) => e.total > 0 && (escrowCoin === null || e.coin === escrowCoin)) ?? false;

const transferFindings = (coin: string, amount: string, escrowCoin: string | null, a: CoreActivity | undefined): Finding => {
  const what = `${amount} ${coin}`;
  const escrowed = isEscrowed(a, escrowCoin);
  const missing = !a || a.role.role === "missing";
  if (!escrowed && !missing) return { severity: "ok", title: `${what} reached HyperCore (no escrow)` };
  if (!missing) {
    return {
      severity: "warn",
      title: `${what} waiting in EVM escrow`,
      detail: "The funds are in escrow and not yet in the spot balance.",
      fix: "Escrow normally clears within seconds. If not, open a Discord ticket with this tx hash.",
    };
  }
  return {
    severity: "error",
    title: escrowed ? `${what} waiting in EVM escrow` : `${what} sent, but the sender has no HyperCore account`,
    detail: "HyperCore credits EVM→Core transfers to the same address on HyperCore. That address has no HyperCore account, so the funds sit in escrow.",
    fix: "Activate the HyperCore account, then check again.",
  };
};

export const diagnoseTx = (p: {
  tx: EvmTx;
  events: EvmEvent[];
  blockTime: number;
  now: number;
  activity: Map<Hex, CoreActivity>;
}): Finding[] => {
  if (p.tx.status === "reverted") {
    return [
      {
        severity: "error",
        title: "The EVM tx reverted, so HyperCore never saw it",
        detail: "A precompile called with an invalid asset or vault reverts and consumes all the gas passed to it. Check the revert reason in an explorer.",
      },
    ];
  }
  if (p.events.length === 0) {
    return [{ severity: "info", title: "No HyperCore interaction in this tx", detail: "No CoreWriter action, no HYPE sent to 0x2222…, no token sent to a 0x20… system address." }];
  }
  const age = p.now - p.blockTime;
  return p.events.flatMap((e): Finding[] => {
    switch (e.kind) {
      case "coreWriter":
        return [coreWriterFindings(e.user, e.action, p.activity.get(e.user), p.blockTime, age)];
      case "hypeToCore":
        return [transferFindings("HYPE", formatUnits(e.amountWei, 18), "HYPE", p.activity.get(e.from))];
      case "tokenToCore":
        return [transferFindings(`of token ${e.tokenIndex} (raw units)`, String(e.amount), null, p.activity.get(e.from))];
    }
  });
};

export const otherNetwork = (network: Network): Network => (network === "testnet" ? "mainnet" : "testnet");

/** The fix for a target that lives on the other network. */
export const rerunOnOther = (network: Network): string => (network === "testnet" ? "Re-run with --mainnet." : "Re-run without --mainnet.");

// A hash that isn't a HyperEVM tx on this network: either it's on the other one, or it's a HyperCore tx.
export const txNotFound = (p: { network: Network; elsewhere: boolean; explorerUrl: string }): Finding[] => {
  const other = otherNetwork(p.network);
  return [
    p.elsewhere
      ? { severity: "warn", title: `This tx is on ${other}, not ${p.network}`, fix: rerunOnOther(p.network) }
      : {
          severity: "info",
          title: `Not a HyperEVM tx on ${p.network}`,
          detail: "It may be a HyperCore (L1) tx hash, or not mined yet.",
          fix: `Open it in the HyperCore explorer: ${p.explorerUrl}`,
        },
  ];
};

// The HyperCore accounts a tx touches: CoreWriter senders and EVM→Core transfer senders.
export const txUsers = (events: EvmEvent[]): Hex[] => [
  ...new Set(events.map((e): Hex => `0x${(e.kind === "coreWriter" ? e.user : e.from).slice(2).toLowerCase()}`)),
];
