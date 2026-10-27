// Groups HyperEVM logs into the kinds of HyperCore interaction hl-doctor explains, so we can pick real txs to test against.
import { getAddress, isAddressEqual, slice } from "viem";
import { CORE_WRITER, decodeRawActionLog, RAW_ACTION_TOPIC } from "../src/corewriter.ts";
import { HYPE_SYSTEM_ADDRESS, systemAddressTokenIndex, TRANSFER_TOPIC } from "../src/evmtx.ts";
import type { EvmLog, Hex } from "../src/types.ts";

export interface ScannedLog extends EvmLog {
  transactionHash: Hex;
}

const coreWriterGroup = (l: ScannedLog): string | null => {
  if (!isAddressEqual(l.address, CORE_WRITER) || l.topics[0] !== RAW_ACTION_TOPIC) return null;
  const action = decodeRawActionLog(l.data);
  return action.ok ? `coreWriter:${action.name}` : `coreWriter:undecodable(${action.id})`;
};

const tokenToCoreGroup = (l: ScannedLog): string | null => {
  const to = l.topics[2];
  if (l.topics[0] !== TRANSFER_TOPIC || !to) return null;
  const index = systemAddressTokenIndex(getAddress(slice(to, 12)));
  return index === null ? null : `tokenToCore:${index}`;
};

const groupOf = (l: ScannedLog): string | null =>
  isAddressEqual(l.address, HYPE_SYSTEM_ADDRESS) ? "hypeToCore" : (coreWriterGroup(l) ?? tokenToCoreGroup(l));

/** Group name -> tx hashes, each listed once, in first-seen order. */
export const groupCandidates = (logs: ScannedLog[]): Record<string, Hex[]> => {
  const groups: Record<string, Hex[]> = {};
  for (const l of logs) {
    const g = groupOf(l);
    if (g === null) continue;
    const hashes = (groups[g] ??= []);
    if (!hashes.includes(l.transactionHash)) hashes.push(l.transactionHash);
  }
  return groups;
};
