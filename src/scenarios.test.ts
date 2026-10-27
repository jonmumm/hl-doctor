// Pins the exact wording of every finding. A wording change should be a deliberate snapshot update.
import { describe, expect, it } from "vitest";
import { builderEligibility, diagnoseAddress, diagnoseBuilderApproval } from "./address.ts";
import { renderFindings } from "./render.ts";
import { diagnoseTx } from "./tx.ts";
import type { AddressSnapshot, CoreActivity, DecodedAction, EvmEvent, EvmTx } from "./types.ts";

const base: AddressSnapshot = {
  network: "testnet",
  address: "0x963a323Bebea09Fe2B094D23144e7187f90514D0",
  role: { role: "user" },
  abstraction: "disabled",
  legal: { acceptedTerms: true, userAllowed: true },
  perp: { accountValue: 500, withdrawable: 500 },
  spot: { balances: [{ coin: "USDC", total: 10, hold: 0 }, { coin: "HYPE", total: 1, hold: 0 }], evmEscrows: [] },
  rateLimit: { used: 10, cap: 10_000 },
  evm: { hype: 0.5, usingBigBlocks: false },
  mainnetDeposited: true,
};

const addressCases: Record<string, Partial<AddressSnapshot>> = {
  healthy: {},
  "brand new address": { role: { role: "missing" }, legal: { acceptedTerms: false, userAllowed: true }, perp: { accountValue: 0, withdrawable: 0 }, spot: { balances: [], evmEscrows: [{ coin: "HYPE", total: 0.02 }] }, evm: { hype: 0, usingBigBlocks: false }, mainnetDeposited: false },
  agent: { role: { role: "agent", data: { user: "0xabc0000000000000000000000000000000000001" } } },
  "sub-account": { role: { role: "subAccount", data: { master: "0xabc0000000000000000000000000000000000002" } } },
  vault: { role: { role: "vault" }, network: "mainnet", mainnetDeposited: null },
  restricted: { legal: { acceptedTerms: true, userAllowed: false } },
  "terms not accepted": { legal: { acceptedTerms: false, userAllowed: true } },
  "escrow on an existing account": { spot: { balances: [], evmEscrows: [{ coin: "USDC", total: 3 }] } },
  "USDC stranded on spot": { perp: { accountValue: 0, withdrawable: 0 }, spot: { balances: [{ coin: "USDC", total: 50, hold: 0 }], evmEscrows: [] } },
  "no gas for Core→EVM": { spot: { balances: [{ coin: "PURR", total: 100, hold: 0 }], evmEscrows: [] } },
  "RPC down": { evm: null },
  "big blocks": { evm: { hype: 1, usingBigBlocks: true } },
  "rate limited": { rateLimit: { used: 10_000, cap: 10_000 } },
  "rate limit 80%": { rateLimit: { used: 8_500, cap: 10_000 } },
};

describe("address findings", () => {
  it.each(Object.entries(addressCases))("%s", (_, over) => {
    expect(diagnoseAddress({ ...base, ...over })).toMatchSnapshot();
  });
});

describe("builder findings", () => {
  it.each([
    ["eligible", { accountValue: 150, abstraction: "disabled" }],
    ["too small", { accountValue: 20, abstraction: "disabled" }],
    ["unified", { accountValue: 150, abstraction: "unifiedAccount" }],
    ["unknown mode", { accountValue: 150, abstraction: "default" }],
  ])("%s", (_, b) => {
    expect(builderEligibility({ ...b, role: { role: "user" } })).toMatchSnapshot();
  });
  it("missing", () => expect(builderEligibility({ accountValue: 0, abstraction: "default", role: { role: "missing" } })).toMatchSnapshot());
  it.each([["approved", 25], ["not approved", 0]])("approval %s", (_, fee) => {
    expect(
      diagnoseBuilderApproval({ user: base.address, builder: "0xbb67021fA3e62ab4DA985bb5a55c5c1884381068", approvedMaxFee: fee, builderRole: { role: "user" }, builderAccountValue: 220, builderAbstraction: "disabled" }),
    ).toMatchSnapshot();
  });
});

const USER = "0xb2308b58a6dfe69f3d46e4cc0c354f6ad5277ca2";
const T0 = 1_800_000_000_000;
const tx: EvmTx = { hash: "0xaa", from: "0x5d6f48bb58e3f4dca32455eccf7e2cec6e844af9", to: USER, value: 0n, status: "success", blockNumber: 1n, logs: [] };
const act = (over: Partial<CoreActivity> = {}): CoreActivity => ({ user: USER, role: { role: "user" }, orders: [], ledger: [], evmEscrows: [], perpWithdrawable: 100, assetNames: new Map([[0, "BTC"]]), ...over });
const limit = (fields: Record<string, string | number | boolean | bigint> = {}): DecodedAction => ({ ok: true, version: 1, id: 1, name: "limitOrder", fields: { asset: 0, isBuy: true, limitPx: "75000", sz: "0.001", reduceOnly: false, tif: "Gtc", cloid: 0n, ...fields } });
const cw = (action: DecodedAction): EvmEvent => ({ kind: "coreWriter", user: USER, action });
const order = (status: string) => ({ oid: 9, cloid: null, coin: "BTC", status, statusTimestamp: T0 + 2000 });
const send: DecodedAction = { ok: true, version: 1, id: 13, name: "sendAsset", fields: { destination: "0x1", token: 0n, amountWei: 1n } };

const txCases: [string, EvmEvent[], CoreActivity, number?][] = [
  ["no HyperCore interaction", [], act()],
  ["undecodable", [cw({ ok: false, version: 2, id: 7, reason: "unsupported version 2 (only 1 exists)" })], act()],
  ["sender has no account", [cw(limit())], act({ role: { role: "missing" } })],
  ...["filled", "open", "marginCanceled", ...Object.keys({ perpMarginRejected: 1, insufficientSpotBalanceRejected: 1, tickRejected: 1, minTradeNtlRejected: 1, badAloPxRejected: 1, iocCancelRejected: 1, marketOrderNoLiquidityRejected: 1, reduceOnlyRejected: 1, oracleRejected: 1, tooManyOpenOrdersRejected: 1, perpMaxPositionRejected: 1, openInterestIncreaseRejected: 1, rejected: 1 })].map(
    (s): [string, EvmEvent[], CoreActivity] => [`order ${s}`, [cw(limit())], act({ orders: [order(s)] })],
  ),
  ["order missing, everything plausible", [cw(limit())], act()],
  ["order missing, no margin and bad asset", [cw(limit({ asset: 9999 }))], act({ perpWithdrawable: 0 })],
  ["order queued", [cw(limit())], act(), 2_000],
  ["sendAsset landed", [cw(send)], act({ ledger: [{ time: T0 + 1000, type: "send" }] })],
  ["sendAsset missing", [cw(send)], act()],
  ["sendAsset queued", [cw(send)], act(), 2_000],
  ["delegate", [cw({ ok: true, version: 1, id: 3, name: "tokenDelegate", fields: { validator: "0x1", wei: 1n, isUndelegate: true } })], act()],
  ["HYPE escrowed, no account", [{ kind: "hypeToCore", from: USER, amountWei: 2n * 10n ** 16n }], act({ role: { role: "missing" }, evmEscrows: [{ coin: "HYPE", total: 0.02 }] })],
  ["HYPE escrowed, account exists", [{ kind: "hypeToCore", from: USER, amountWei: 2n * 10n ** 16n }], act({ evmEscrows: [{ coin: "HYPE", total: 0.02 }] })],
  ["HYPE sent, no account, no escrow", [{ kind: "hypeToCore", from: USER, amountWei: 10n ** 18n }], act({ role: { role: "missing" } })],
  ["token arrived", [{ kind: "tokenToCore", from: USER, token: "0x1111111111111111111111111111111111111111", tokenIndex: 200, amount: 5n }], act()],
];

describe("tx findings", () => {
  it.each(txCases)("%s", (_, events, a, age = 60_000) => {
    expect(diagnoseTx({ tx, events, blockTime: T0, now: T0 + age, activity: new Map([[USER, a]]) })).toMatchSnapshot();
  });
  it("reverted", () => {
    expect(diagnoseTx({ tx: { ...tx, status: "reverted" }, events: [], blockTime: T0, now: T0, activity: new Map() })).toMatchSnapshot();
  });
});

describe("rendering", () => {
  it("sorts most severe first, indents detail and fix, no color", () => {
    expect(
      renderFindings(
        [
          { severity: "ok", title: "fine" },
          { severity: "error", title: "broken", detail: "line one\nline two", fix: "do this" },
          { severity: "info", title: "fyi" },
          { severity: "warn", title: "careful" },
        ],
        false,
      ),
    ).toMatchInlineSnapshot(`
      "  FAIL broken
             line one
             line two
             → do this
        WARN careful
        INFO fyi
        OK   fine"
    `);
  });
  it("colors the tag when asked", () => {
    expect(renderFindings([{ severity: "warn", title: "x" }], true)).toBe("  \x1b[33mWARN\x1b[0m x");
  });
});
