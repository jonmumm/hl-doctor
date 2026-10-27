import { concatHex, encodeAbiParameters, numberToHex, pad, parseAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { classifyTx, systemAddressTokenIndex } from "./evmtx.ts";
import { RAW_ACTION_TOPIC } from "./corewriter.ts";
import type { EvmTx, Hex } from "./types.ts";

const EOA: Hex = "0x5d6f48bb58e3f4dca32455eccf7e2cec6e844af9";
const CONTRACT: Hex = "0xb2308b58a6dfe69f3d46e4cc0c354f6ad5277ca2";
const TOKEN: Hex = "0x1111111111111111111111111111111111111111";
const TRANSFER: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const tx = (over: Partial<EvmTx>): EvmTx => ({
  hash: "0xaa",
  from: EOA,
  to: CONTRACT,
  value: 0n,
  status: "success",
  blockNumber: 1n,
  logs: [],
  ...over,
});

const rawActionLog = (user: `0x${string}`) => ({
  address: "0x3333333333333333333333333333333333333333" as const,
  topics: [RAW_ACTION_TOPIC, pad(user)],
  data: encodeAbiParameters(parseAbiParameters("bytes"), [
    concatHex(["0x01", numberToHex(7, { size: 3 }), encodeAbiParameters(parseAbiParameters("uint64, bool"), [5n, true])]),
  ]),
});

describe("systemAddressTokenIndex", () => {
  it("reads the token index from a 0x20… system address", () => {
    expect(systemAddressTokenIndex("0x20000000000000000000000000000000000000c8")).toBe(200);
    expect(systemAddressTokenIndex("0x2000000000000000000000000000000000000000")).toBe(0);
  });
  it("is null for ordinary addresses and for the HYPE address", () => {
    expect(systemAddressTokenIndex(EOA)).toBeNull();
    expect(systemAddressTokenIndex("0x2222222222222222222222222222222222222222")).toBeNull();
    // 0x20 prefix but junk in the high bytes: not a system address.
    expect(systemAddressTokenIndex("0x2011000000000000000000000000000000000001")).toBeNull();
  });
});

describe("classifyTx", () => {
  it("finds a CoreWriter action and attributes it to the emitting user (the contract, not the EOA)", () => {
    const events = classifyTx(tx({ logs: [rawActionLog(CONTRACT)] }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "coreWriter", user: CONTRACT, action: { ok: true, name: "usdClassTransfer" } });
  });

  it("ignores logs from other contracts that reuse the topic", () => {
    const fake = { ...rawActionLog(CONTRACT), address: TOKEN };
    expect(classifyTx(tx({ logs: [fake] }))).toEqual([]);
  });

  it("finds native HYPE sent to 0x2222…", () => {
    const events = classifyTx(tx({ to: "0x2222222222222222222222222222222222222222", value: 10n ** 16n }));
    expect(events).toEqual([{ kind: "hypeToCore", from: EOA, amountWei: 10n ** 16n }]);
  });

  it("does not report a zero-value call to 0x2222… as a transfer", () => {
    expect(classifyTx(tx({ to: "0x2222222222222222222222222222222222222222", value: 0n }))).toEqual([]);
  });

  it("finds an ERC20 Transfer to a token system address", () => {
    const log = {
      address: TOKEN,
      topics: [TRANSFER, pad(EOA), pad("0x20000000000000000000000000000000000000c8")] as `0x${string}`[],
      data: numberToHex(5_000_000n, { size: 32 }),
    };
    expect(classifyTx(tx({ logs: [log] }))).toEqual([
      { kind: "tokenToCore", from: EOA, token: TOKEN, tokenIndex: 200, amount: 5_000_000n },
    ]);
  });

  it("ignores ERC20 transfers to ordinary addresses", () => {
    const log = {
      address: TOKEN,
      topics: [TRANSFER, pad(EOA), pad(CONTRACT)] as `0x${string}`[],
      data: numberToHex(1n, { size: 32 }),
    };
    expect(classifyTx(tx({ logs: [log] }))).toEqual([]);
  });

  it("keeps events in log order", () => {
    const transfer = {
      address: TOKEN,
      topics: [TRANSFER, pad(CONTRACT), pad("0x2000000000000000000000000000000000000000")] as `0x${string}`[],
      data: numberToHex(1n, { size: 32 }),
    };
    expect(classifyTx(tx({ logs: [transfer, rawActionLog(CONTRACT)] })).map((e) => e.kind)).toEqual(["tokenToCore", "coreWriter"]);
  });
});

describe("classifyTx edge cases", () => {
  it("ignores a contract creation (no `to`) that carries value", () => {
    expect(classifyTx(tx({ to: null, value: 5n }))).toEqual([]);
  });
  it("ignores a CoreWriter log with a different topic", () => {
    const log = { ...rawActionLog(CONTRACT), topics: [TRANSFER, pad(CONTRACT)] };
    expect(classifyTx(tx({ logs: [log] }))).toEqual([]);
  });
  it("ignores a non-Transfer log whose second topic looks like a system address", () => {
    const log = { address: TOKEN, topics: [RAW_ACTION_TOPIC, pad(EOA), pad("0x2000000000000000000000000000000000000001")], data: numberToHex(1n, { size: 32 }) };
    expect(classifyTx(tx({ logs: [log] }))).toEqual([]);
  });
  it("ignores a Transfer log without a recipient topic", () => {
    const log = { address: TOKEN, topics: [TRANSFER, pad(EOA)], data: numberToHex(1n, { size: 32 }) };
    expect(classifyTx(tx({ logs: [log] }))).toEqual([]);
  });
});

describe("systemAddressTokenIndex edge cases", () => {
  it("needs the 0x20 prefix even when the rest is a valid index", () => {
    expect(systemAddressTokenIndex("0x1000000000000000000000000000000000000005")).toBeNull();
  });
  it("rejects junk between the prefix and the index", () => {
    expect(systemAddressTokenIndex("0x2000000000000000000010000000000000000005")).toBeNull();
  });
  it("accepts the largest uint64 index", () => {
    expect(systemAddressTokenIndex("0x200000000000000000000000ffffffffffffffff")).toBe(Number(2n ** 64n - 1n));
  });
  it("rejects an index one past uint64", () => {
    expect(systemAddressTokenIndex("0x2000000000000000000000010000000000000000")).toBeNull();
  });
});
