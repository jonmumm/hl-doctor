import { encodeAbiParameters, keccak256, pad, parseAbiParameters, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { CORE_WRITER, RAW_ACTION_TOPIC } from "../src/corewriter.ts";
import { HYPE_SYSTEM_ADDRESS } from "../src/evmtx.ts";
import type { Hex } from "../src/types.ts";
import { groupCandidates, type ScannedLog } from "./candidates.ts";

const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const USER = "0x1111111111111111111111111111111111111111";
const topic = (a: `0x${string}`) => pad(a, { size: 32 });
const rawAction = (payload: `0x${string}`) => encodeAbiParameters(parseAbiParameters("bytes"), [payload]);
// version 1, action 4 (stakingDeposit), wei = 5
const STAKING_DEPOSIT: Hex = `0x01000004${(5).toString(16).padStart(64, "0")}`;

const log = (hash: string, l: Omit<ScannedLog, "transactionHash">): ScannedLog => ({ transactionHash: `0x${hash.repeat(64)}`, ...l });

describe("groupCandidates", () => {
  it("groups CoreWriter actions by decoded name and undecodable ones by id", () => {
    const logs = [
      log("a", { address: CORE_WRITER, topics: [RAW_ACTION_TOPIC, topic(USER)], data: rawAction(STAKING_DEPOSIT) }),
      log("b", { address: CORE_WRITER, topics: [RAW_ACTION_TOPIC, topic(USER)], data: rawAction("0x010000ff") }),
    ];
    expect(groupCandidates(logs)).toEqual({ "coreWriter:stakingDeposit": [`0x${"a".repeat(64)}`], "coreWriter:undecodable(255)": [`0x${"b".repeat(64)}`] });
  });

  it("finds token transfers to 0x20… system addresses and ignores other transfers", () => {
    const system = "0x2000000000000000000000000000000000000005";
    const logs = [
      log("c", { address: "0x9999999999999999999999999999999999999999", topics: [TRANSFER, topic(USER), topic(system)], data: toHex(7n, { size: 32 }) }),
      log("d", { address: "0x9999999999999999999999999999999999999999", topics: [TRANSFER, topic(USER), topic(USER)], data: toHex(7n, { size: 32 }) }),
    ];
    expect(groupCandidates(logs)).toEqual({ "tokenToCore:5": [`0x${"c".repeat(64)}`] });
  });

  it("counts any log from 0x2222… as a HYPE transfer to HyperCore", () => {
    const logs = [log("e", { address: HYPE_SYSTEM_ADDRESS, topics: [keccak256(toHex("Received(address,uint256)")), topic(USER)], data: toHex(1n, { size: 32 }) })];
    expect(groupCandidates(logs)).toEqual({ hypeToCore: [`0x${"e".repeat(64)}`] });
  });

  it("lists each tx once per group, in first-seen order", () => {
    const l = { address: CORE_WRITER, topics: [RAW_ACTION_TOPIC, topic(USER)], data: rawAction(STAKING_DEPOSIT) };
    expect(groupCandidates([log("a", l), log("f", l), log("a", l)])).toEqual({ "coreWriter:stakingDeposit": [`0x${"a".repeat(64)}`, `0x${"f".repeat(64)}`] });
  });
});
