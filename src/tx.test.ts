import { describe, expect, it } from "vitest";
import { diagnoseTx } from "./tx.ts";
import type { CoreActivity, DecodedAction, EvmEvent, EvmTx, Finding } from "./types.ts";

const USER = "0xb2308b58a6dfe69f3d46e4cc0c354f6ad5277ca2";
const T0 = 1_800_000_000_000;

const tx: EvmTx = {
  hash: "0xaa",
  from: "0x5d6f48bb58e3f4dca32455eccf7e2cec6e844af9",
  to: USER,
  value: 0n,
  status: "success",
  blockNumber: 1n,
  logs: [],
};

const activity = (over: Partial<CoreActivity> = {}): CoreActivity => ({
  user: USER,
  role: { role: "user" },
  orders: [],
  ledger: [],
  evmEscrows: [],
  perpWithdrawable: 100,
  assetNames: new Map([[0, "BTC"], [1, "ETH"]]),
  ...over,
});

const order = (fields: Partial<Record<string, unknown>> = {}): DecodedAction => ({
  ok: true,
  version: 1,
  id: 1,
  name: "limitOrder",
  fields: { asset: 0, isBuy: true, limitPx: "75000", sz: "0.001", reduceOnly: false, tif: "Gtc", cloid: 0n, ...fields } as Record<string, string | number | boolean | bigint>,
});

const cw = (action: DecodedAction): EvmEvent => ({ kind: "coreWriter", user: USER, action });
const run = (events: EvmEvent[], a: CoreActivity = activity(), age = 120_000) =>
  diagnoseTx({ tx, events, blockTime: T0, now: T0 + age, activity: new Map([[USER, a]]) });
const find = (fs: Finding[], re: RegExp) => fs.find((f) => re.test(f.title));

describe("the EVM side", () => {
  it("errors on a reverted tx: HyperCore never saw it", () => {
    const fs = diagnoseTx({ tx: { ...tx, status: "reverted" }, events: [], blockTime: T0, now: T0, activity: new Map() });
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ severity: "error", title: expect.stringMatching(/reverted/) });
    expect(fs[0].detail).toMatch(/precompile/);
  });

  it("says when a successful tx has nothing to do with HyperCore", () => {
    expect(find(run([]), /No HyperCore interaction/)?.severity).toBe("info");
  });

  it("reports an undecodable CoreWriter payload", () => {
    const f = find(run([cw({ ok: false, version: 2, id: 7, reason: "unsupported version 2 (only 1 exists)" })]), /could not be decoded/);
    expect(f?.severity).toBe("error");
    expect(f?.detail).toContain("unsupported version 2");
  });
});

describe("CoreWriter: the sender must be a HyperCore user", () => {
  it("errors when the emitting contract has no Core account, whatever the action", () => {
    const f = find(run([cw(order())], activity({ role: { role: "missing" } })), /has no HyperCore account/);
    expect(f?.severity).toBe("error");
    expect(f?.detail).toContain(USER);
    expect(f?.detail).toMatch(/contract/);
  });
});

describe("CoreWriter limit orders", () => {
  it("is ok when a matching order filled", () => {
    const fs = run([cw(order())], activity({ orders: [{ oid: 1, cloid: null, coin: "BTC", status: "filled", statusTimestamp: T0 + 3000 }] }));
    expect(find(fs, /BTC order/)?.severity).toBe("ok");
    expect(find(fs, /BTC order/)?.title).toContain("filled");
  });

  it("explains a margin rejection", () => {
    const f = find(run([cw(order())], activity({ orders: [{ oid: 1, cloid: null, coin: "BTC", status: "perpMarginRejected", statusTimestamp: T0 + 3000 }] })), /rejected/);
    expect(f?.severity).toBe("error");
    expect(f?.detail).toMatch(/margin/);
  });

  it("explains a tick rejection and reminds about 1e8 scaling", () => {
    const f = find(run([cw(order())], activity({ orders: [{ oid: 1, cloid: null, coin: "BTC", status: "tickRejected", statusTimestamp: T0 + 3000 }] })), /rejected/);
    expect(f?.fix).toMatch(/10\^8/);
  });

  it("shows an unknown status verbatim", () => {
    const f = find(run([cw(order())], activity({ orders: [{ oid: 1, cloid: null, coin: "BTC", status: "somethingNewRejected", statusTimestamp: T0 + 3000 }] })), /BTC order/);
    expect(f?.title).toContain("somethingNewRejected");
  });

  it("matches by cloid when one was set, ignoring other orders on the same coin", () => {
    const fs = run(
      [cw(order({ cloid: 255n }))],
      activity({
        orders: [
          { oid: 1, cloid: null, coin: "BTC", status: "filled", statusTimestamp: T0 + 1000 },
          { oid: 2, cloid: "0x000000000000000000000000000000ff", coin: "BTC", status: "minTradeNtlRejected", statusTimestamp: T0 + 2000 },
        ],
      }),
    );
    expect(find(fs, /BTC order/)?.title).toContain("minTradeNtlRejected");
  });

  it("ignores orders from before the tx", () => {
    const fs = run([cw(order())], activity({ orders: [{ oid: 1, cloid: null, coin: "BTC", status: "filled", statusTimestamp: T0 - 60_000 }] }));
    expect(find(fs, /No matching order/)).toBeDefined();
  });

  it("lists likely causes when no order shows up", () => {
    const f = find(run([cw(order())], activity({ perpWithdrawable: 0 })), /No matching order/);
    expect(f?.severity).toBe("error");
    expect(f?.detail).toMatch(/withdrawable is 0/);
  });

  it("flags an asset index the exchange doesn't have", () => {
    const f = find(run([cw(order({ asset: 9999 }))]), /No matching order/);
    expect(f?.detail).toMatch(/asset 9999/);
  });

  it("asks to wait when the tx is only seconds old (CoreWriter orders are delayed)", () => {
    expect(find(run([cw(order())], activity(), 3_000), /still be queued/)?.severity).toBe("info");
  });
});

describe("CoreWriter transfers and other actions", () => {
  const send: DecodedAction = { ok: true, version: 1, id: 13, name: "sendAsset", fields: { destination: "0x1", token: 0n, amountWei: 1n } };
  it("is ok when a ledger entry appears after the tx", () => {
    expect(find(run([cw(send)], activity({ ledger: [{ time: T0 + 2000, type: "send" }] })), /sendAsset/)?.severity).toBe("ok");
  });
  it("warns with likely causes when nothing landed", () => {
    const f = find(run([cw(send)]), /sendAsset/);
    expect(f?.severity).toBe("warn");
    expect(f?.detail).toMatch(/balance/);
  });
  it("only describes actions it can't verify", () => {
    const delegate: DecodedAction = { ok: true, version: 1, id: 3, name: "tokenDelegate", fields: { validator: "0x1", wei: 1n, isUndelegate: true } };
    expect(find(run([cw(delegate)]), /tokenDelegate/)?.severity).toBe("info");
  });
});

describe("EVM → Core transfers", () => {
  const hype: EvmEvent = { kind: "hypeToCore", from: USER, amountWei: 2n * 10n ** 16n };
  it("errors when the recipient has no Core account and funds are escrowed", () => {
    const fs = run([hype], activity({ role: { role: "missing" }, evmEscrows: [{ coin: "HYPE", total: 0.02 }] }));
    const f = find(fs, /escrow/);
    expect(f?.severity).toBe("error");
    expect(f?.title).toContain("0.02 HYPE");
  });
  it("is ok once there is no escrow and the account exists", () => {
    expect(find(run([hype]), /0.02 HYPE/)?.severity).toBe("ok");
  });
  it("reports token transfers by index", () => {
    const fs = run([{ kind: "tokenToCore", from: USER, token: "0x1111111111111111111111111111111111111111", tokenIndex: 200, amount: 5n }]);
    expect(find(fs, /token 200/)).toBeDefined();
  });
});

describe("limit-order matching edge cases", () => {
  const at = (status: string, dt: number, coin = "BTC", cloid: string | null = null) => ({ oid: 7, cloid, coin, status, statusTimestamp: T0 + dt });
  it("counts an order stamped up to 1s before the block (clock skew)", () => {
    expect(find(run([cw(order())], activity({ orders: [at("filled", -1000)] })), /BTC order filled/)).toBeDefined();
  });
  it("ignores an order stamped more than 1s before the block", () => {
    expect(find(run([cw(order())], activity({ orders: [at("filled", -1001)] })), /No matching order/)).toBeDefined();
  });
  it("ignores orders on other coins", () => {
    expect(find(run([cw(order())], activity({ orders: [at("filled", 1000, "ETH")] })), /No matching order/)).toBeDefined();
  });
  it("falls back to coin matching when the action has no cloid field", () => {
    const noCloid: DecodedAction = { ok: true, version: 1, id: 1, name: "limitOrder", fields: { asset: 0, isBuy: true, limitPx: "1", sz: "1", reduceOnly: false, tif: "Gtc" } };
    expect(find(run([cw(noCloid)], activity({ orders: [at("open", 1000)] })), /BTC order open/)).toBeDefined();
  });
  it("treats a plain 'rejected' status as a rejection", () => {
    expect(find(run([cw(order())], activity({ orders: [at("rejected", 1000)] })), /rejected/)?.severity).toBe("error");
  });
  it.each(["open", "triggered"])("is ok for %s", (status) => {
    expect(find(run([cw(order())], activity({ orders: [at(status, 1000)] })), /BTC order/)?.severity).toBe("ok");
  });
  it("warns for a cancel", () => {
    expect(find(run([cw(order())], activity({ orders: [at("marginCanceled", 1000)] })), /BTC order/)?.severity).toBe("warn");
  });
  it("only gives the scaling hint for tick rejections", () => {
    expect(find(run([cw(order())], activity({ orders: [at("perpMarginRejected", 1000)] })), /rejected/)?.fix).toBeUndefined();
  });
  it("stops treating the order as queued at 10s", () => {
    expect(find(run([cw(order())], activity(), 9_999), /still be queued/)).toBeDefined();
    expect(find(run([cw(order())], activity(), 10_000), /No matching order/)).toBeDefined();
  });
});

describe("fund-moving actions edge cases", () => {
  const send: DecodedAction = { ok: true, version: 1, id: 6, name: "spotSend", fields: { destination: "0x1", token: 0n, wei: 1n } };
  it("ignores ledger entries from before the tx", () => {
    expect(find(run([cw(send)], activity({ ledger: [{ time: T0 - 1001, type: "send" }] })), /nothing landed/)).toBeDefined();
  });
  it("counts a ledger entry up to 1s before the block", () => {
    expect(find(run([cw(send)], activity({ ledger: [{ time: T0 - 1000, type: "send" }] })), /^spotSend: landed on HyperCore/)).toBeDefined();
  });
  it("reports queued when only seconds old, and stops at 10s", () => {
    expect(find(run([cw(send)], activity(), 9_999), /may still be queued/)?.severity).toBe("info");
    expect(find(run([cw(send)], activity(), 10_000), /nothing landed/)?.severity).toBe("warn");
  });
  it.each(["sendAsset", "spotSend", "usdClassTransfer", "vaultTransfer", "stakingDeposit", "stakingWithdraw"])("checks the ledger for %s", (name) => {
    const a: DecodedAction = { ok: true, version: 1, id: 0, name, fields: {} };
    expect(find(run([cw(a)]), /nothing landed/)?.title).toBe(`${name}: nothing landed on HyperCore`);
  });
});

describe("EVM → Core transfer edge cases", () => {
  const hype: EvmEvent = { kind: "hypeToCore", from: USER, amountWei: 10n ** 18n };
  it("doesn't count a USDC escrow against a HYPE transfer", () => {
    expect(find(run([hype], activity({ evmEscrows: [{ coin: "USDC", total: 5 }] })), /reached HyperCore/)?.severity).toBe("ok");
  });
  it("ignores an escrow entry of zero", () => {
    expect(find(run([hype], activity({ evmEscrows: [{ coin: "HYPE", total: 0 }] })), /reached HyperCore/)).toBeDefined();
  });
  it("warns (not errors) on escrow when the account exists", () => {
    expect(find(run([hype], activity({ evmEscrows: [{ coin: "HYPE", total: 1 }] })), /escrow/)?.severity).toBe("warn");
  });
  it("errors when the account is missing even with no escrow yet", () => {
    expect(find(run([hype], activity({ role: { role: "missing" } })), /no HyperCore account/)?.severity).toBe("error");
  });
  it("errors when there is no activity record for the sender at all", () => {
    const fs = diagnoseTx({ tx, events: [hype], blockTime: T0, now: T0 + 60_000, activity: new Map() });
    expect(fs[0]).toMatchObject({ severity: "error", title: "1 HYPE sent, but the sender has no HyperCore account" });
  });
  it("counts any escrowed coin for a token transfer", () => {
    const token: EvmEvent = { kind: "tokenToCore", from: USER, token: "0x1111111111111111111111111111111111111111", tokenIndex: 200, amount: 5n };
    expect(find(run([token], activity({ evmEscrows: [{ coin: "PURR", total: 5 }] })), /escrow/)?.severity).toBe("warn");
  });
});
