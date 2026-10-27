// Finds the HyperCore-bound parts of a HyperEVM transaction.
// Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers
import { getAddress, hexToBigInt, isAddressEqual, keccak256, slice, toHex } from "viem";
import { CORE_WRITER, decodeRawActionLog, RAW_ACTION_TOPIC } from "./corewriter.ts";
import type { EvmEvent, EvmLog, EvmTx, Hex } from "./types.ts";

export const HYPE_SYSTEM_ADDRESS: Hex = "0x2222222222222222222222222222222222222222";
export const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

/** Token system addresses are 0x20, zeros, then the token index in the low bytes. */
export const systemAddressTokenIndex = (address: Hex): number | null => {
  if (!address.toLowerCase().startsWith("0x20")) return null;
  // The index is a uint64 in the low bytes; everything above it must be zero.
  const index = BigInt(`0x${address.slice(4)}`);
  return index < 2n ** 64n ? Number(index) : null;
};

const lower = (a: Hex): Hex => `0x${a.slice(2).toLowerCase()}`;
const topicAddress = (topic: Hex): Hex => getAddress(slice(topic, 12));

const coreWriterEvent = (log: EvmLog): EvmEvent | null => {
  const [topic0, user] = log.topics;
  if (!isAddressEqual(log.address, CORE_WRITER) || topic0 !== RAW_ACTION_TOPIC || !user) return null;
  return { kind: "coreWriter", user: lower(topicAddress(user)), action: decodeRawActionLog(log.data) };
};

const tokenToCoreEvent = (log: EvmLog): EvmEvent | null => {
  const [topic0, from, to] = log.topics;
  if (topic0 !== TRANSFER_TOPIC || !from || !to) return null;
  const tokenIndex = systemAddressTokenIndex(topicAddress(to));
  if (tokenIndex === null) return null;
  return { kind: "tokenToCore", from: lower(topicAddress(from)), token: log.address, tokenIndex, amount: hexToBigInt(log.data) };
};

const hypeToCoreEvent = (tx: EvmTx): EvmEvent[] =>
  tx.to && isAddressEqual(tx.to, HYPE_SYSTEM_ADDRESS) && tx.value > 0n ? [{ kind: "hypeToCore", from: tx.from, amountWei: tx.value }] : [];

export const classifyTx = (tx: EvmTx): EvmEvent[] => [
  ...hypeToCoreEvent(tx),
  ...tx.logs.map((log) => coreWriterEvent(log) ?? tokenToCoreEvent(log)).filter((e) => e !== null),
];
