import { concatHex, encodeAbiParameters, getAddress, numberToHex, parseAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { decodeRawAction, decodeRawActionLog, RAW_ACTION_TOPIC, toField } from "./corewriter.ts";

const action = (id: number, types: string, values: readonly unknown[]) =>
  concatHex(["0x01", numberToHex(id, { size: 3 }), encodeAbiParameters(parseAbiParameters(types), values)]);

describe("decodeRawAction", () => {
  it("decodes a limit order, scaling price and size by 1e8 and naming the TIF", () => {
    const payload = action(1, "uint32, bool, uint64, uint64, bool, uint8, uint128", [
      0, true, 7_500_000_000_000n, 1_500_000n, false, 2, 0n,
    ]);
    expect(decodeRawAction(payload)).toEqual({
      ok: true,
      version: 1,
      id: 1,
      name: "limitOrder",
      fields: { asset: 0, isBuy: true, limitPx: "75000", sz: "0.015", reduceOnly: false, tif: "Gtc", cloid: 0n },
    });
  });

  it("names Alo and Ioc time-in-force", () => {
    const tif = (n: number) => {
      const d = decodeRawAction(action(1, "uint32, bool, uint64, uint64, bool, uint8, uint128", [0, true, 1n, 1n, false, n, 0n]));
      return d.ok ? d.fields.tif : null;
    };
    expect(tif(1)).toBe("Alo");
    expect(tif(3)).toBe("Ioc");
    expect(tif(9)).toBe("unknown(9)");
  });

  it("decodes sendAsset", () => {
    const dest = "0x2000000000000000000000000000000000000000";
    const sub = "0x0000000000000000000000000000000000000000";
    const d = decodeRawAction(action(13, "address, address, uint32, uint32, uint64, uint64", [dest, sub, 0, 4294967295, 0, 5_000_000n]));
    expect(d).toMatchObject({ ok: true, name: "sendAsset", fields: { destination: dest, token: 0n, amountWei: 5_000_000n } });
  });

  it("decodes usdClassTransfer", () => {
    const d = decodeRawAction(action(7, "uint64, bool", [2_000_000n, true]));
    expect(d).toMatchObject({ ok: true, name: "usdClassTransfer", fields: { ntl: 2_000_000n, toPerp: true } });
  });

  it("rejects an unsupported version", () => {
    const payload = concatHex(["0x02", numberToHex(7, { size: 3 }), encodeAbiParameters(parseAbiParameters("uint64, bool"), [1n, true])]);
    expect(decodeRawAction(payload)).toEqual({ ok: false, version: 2, id: 7, reason: "unsupported version 2 (only 1 exists)" });
  });

  it("rejects an unknown action id", () => {
    expect(decodeRawAction(action(99, "uint64", [1n]))).toEqual({ ok: false, version: 1, id: 99, reason: "unknown action id 99" });
  });

  it("rejects params that don't match the action's ABI", () => {
    const d = decodeRawAction(concatHex(["0x01", numberToHex(7, { size: 3 }), "0x1234"]));
    expect(d).toMatchObject({ ok: false, id: 7, reason: expect.stringMatching(/does not match usdClassTransfer/) });
  });

  it("rejects a payload shorter than the 4-byte header", () => {
    expect(decodeRawAction("0x0100")).toEqual({ ok: false, version: 1, id: -1, reason: "payload shorter than 4 bytes" });
  });
});

describe("decodeRawActionLog", () => {
  it("is keyed by the RawAction(address,bytes) topic", () => {
    expect(RAW_ACTION_TOPIC).toBe("0x8c7f585fb295f7eb1e6aeb8fba61b23a4fe60beda405f0045073b185c74412e3");
  });

  it("decodes a real testnet log (token delegate)", () => {
    // tx 0xbda23c80…a24a on HyperEVM testnet, captured 2026-10-27
    const data =
      "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000064010000030000000000000000000000004f6a406d1f1784acddbee2989ca6d09d6593d4070000000000000000000000000000000000000000000000000000000000008207000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000";
    const d = decodeRawActionLog(data);
    expect(d).toMatchObject({
      ok: true,
      id: 3,
      name: "tokenDelegate",
      fields: { validator: getAddress("0x4f6a406d1f1784acddbee2989ca6d09d6593d407"), wei: 33_287n, isUndelegate: true },
    });
  });
});

describe("every documented action decodes to its named fields", () => {
  const A = getAddress("0x1111111111111111111111111111111111111111");
  const B = getAddress("0x2222222222222222222222222222222222222222");
  const table: [number, string, string, readonly unknown[], string[]][] = [
    [2, "vaultTransfer", "address, bool, uint64", [A, true, 5n], ["vault", "isDeposit", "usd"]],
    [3, "tokenDelegate", "address, uint64, bool", [A, 6n, false], ["validator", "wei", "isUndelegate"]],
    [4, "stakingDeposit", "uint64", [7n], ["wei"]],
    [5, "stakingWithdraw", "uint64", [8n], ["wei"]],
    [6, "spotSend", "address, uint64, uint64", [A, 1n, 9n], ["destination", "token", "wei"]],
    [7, "usdClassTransfer", "uint64, bool", [10n, false], ["ntl", "toPerp"]],
    [8, "finalizeEvmContract", "uint64, uint8, uint64", [2n, 1, 3n], ["token", "variant", "createNonce"]],
    [9, "addApiWallet", "address, string", [A, "bot"], ["apiWallet", "name"]],
    [10, "cancelByOid", "uint32, uint64", [4, 11n], ["asset", "oid"]],
    [11, "cancelByCloid", "uint32, uint128", [4, 12n], ["asset", "cloid"]],
    [12, "approveBuilderFee", "uint64, address", [10n, A], ["maxFeeRate", "builder"]],
    [13, "sendAsset", "address, address, uint32, uint32, uint64, uint64", [A, B, 0, 1, 2n, 3n], ["destination", "subAccount", "sourceDex", "destinationDex", "token", "amountWei"]],
    [15, "borrowLend", "uint8, uint64, uint64", [1, 2n, 3n], ["operation", "token", "wei"]],
    [16, "setAbstraction", "address, uint8", [A, 2], ["user", "abstraction"]],
    [17, "outcomeOperation", "uint8, uint32, uint32, uint64", [1, 2, 3, 4n], ["operation", "a", "b", "amount"]],
  ];
  it.each(table)("action %i -> %s", (id, name, abi, values, names) => {
    expect(decodeRawAction(action(id, abi, values))).toEqual({
      ok: true,
      version: 1,
      id,
      name,
      fields: Object.fromEntries(names.map((n, i) => [n, values[i]])),
    });
  });
  it("has no action 14", () => {
    expect(decodeRawAction(action(14, "uint64", [1n]))).toMatchObject({ ok: false, reason: "unknown action id 14" });
  });
});

describe("decodeRawAction edge cases", () => {
  it("treats an empty payload as too short", () => {
    expect(decodeRawAction("0x")).toEqual({ ok: false, version: -1, id: -1, reason: "payload shorter than 4 bytes" });
  });
  it("accepts a header-only payload as 4 bytes, then fails on the missing params", () => {
    const d = decodeRawAction("0x01000004");
    expect(d).toMatchObject({ ok: false, version: 1, id: 4 });
    expect(d.ok ? "" : d.reason).toMatch(/^payload does not match stakingDeposit\(uint64\): /);
  });
  it("keeps the decode error to one line", () => {
    const d = decodeRawAction(concatHex(["0x01", numberToHex(7, { size: 3 }), "0x1234"]));
    expect(d.ok ? "" : d.reason).not.toContain("\n");
  });
});

describe("toField", () => {
  it.each([[1n], [true], [3], ["0xabc"]])("passes %s through", (v) => expect(toField(v)).toBe(v));
  it("refuses anything the ABI decoder should never produce", () => {
    expect(() => toField({})).toThrow("unexpected ABI value [object Object]");
  });
});
