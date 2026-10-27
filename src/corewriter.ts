// CoreWriter (0x3333…3333) action decoding.
// Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore
// Payload = 1 version byte + 3-byte big-endian action id + ABI-encoded params.
import { BaseError, decodeAbiParameters, formatUnits, hexToNumber, keccak256, parseAbiParameters, size, slice, toHex } from "viem";
import type { DecodedAction, FieldValue, Hex } from "./types.ts";

export const CORE_WRITER: Hex = "0x3333333333333333333333333333333333333333";
export const RAW_ACTION_TOPIC = keccak256(toHex("RawAction(address,bytes)"));

const TIF: Record<number, string> = { 1: "Alo", 2: "Gtc", 3: "Ioc" };

type Fields = Record<string, FieldValue>;
type Spec = { name: string; abi: string; fields: string[]; humanize?: (f: Fields) => Fields };

const ACTIONS: Record<number, Spec> = {
  1: {
    name: "limitOrder",
    abi: "uint32, bool, uint64, uint64, bool, uint8, uint128",
    fields: ["asset", "isBuy", "limitPx", "sz", "reduceOnly", "tif", "cloid"],
    // Price and size are sent as 10^8 × the human value.
    humanize: (f) => ({
      ...f,
      limitPx: formatUnits(BigInt(f.limitPx), 8),
      sz: formatUnits(BigInt(f.sz), 8),
      tif: TIF[Number(f.tif)] ?? `unknown(${f.tif})`,
    }),
  },
  2: { name: "vaultTransfer", abi: "address, bool, uint64", fields: ["vault", "isDeposit", "usd"] },
  3: { name: "tokenDelegate", abi: "address, uint64, bool", fields: ["validator", "wei", "isUndelegate"] },
  4: { name: "stakingDeposit", abi: "uint64", fields: ["wei"] },
  5: { name: "stakingWithdraw", abi: "uint64", fields: ["wei"] },
  6: { name: "spotSend", abi: "address, uint64, uint64", fields: ["destination", "token", "wei"] },
  7: { name: "usdClassTransfer", abi: "uint64, bool", fields: ["ntl", "toPerp"] },
  8: { name: "finalizeEvmContract", abi: "uint64, uint8, uint64", fields: ["token", "variant", "createNonce"] },
  9: { name: "addApiWallet", abi: "address, string", fields: ["apiWallet", "name"] },
  10: { name: "cancelByOid", abi: "uint32, uint64", fields: ["asset", "oid"] },
  11: { name: "cancelByCloid", abi: "uint32, uint128", fields: ["asset", "cloid"] },
  12: { name: "approveBuilderFee", abi: "uint64, address", fields: ["maxFeeRate", "builder"] },
  13: {
    name: "sendAsset",
    abi: "address, address, uint32, uint32, uint64, uint64",
    fields: ["destination", "subAccount", "sourceDex", "destinationDex", "token", "amountWei"],
  },
  15: { name: "borrowLend", abi: "uint8, uint64, uint64", fields: ["operation", "token", "wei"] },
  16: { name: "setAbstraction", abi: "address, uint8", fields: ["user", "abstraction"] },
  17: { name: "outcomeOperation", abi: "uint8, uint32, uint32, uint64", fields: ["operation", "a", "b", "amount"] },
};

export const toField = (v: unknown): FieldValue => {
  if (typeof v === "bigint" || typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  throw new Error(`unexpected ABI value ${String(v)}`);
};

export const decodeRawAction = (payload: Hex): DecodedAction => {
  if (size(payload) < 4) {
    const version = size(payload) > 0 ? hexToNumber(slice(payload, 0, 1)) : -1;
    return { ok: false, version, id: -1, reason: "payload shorter than 4 bytes" };
  }
  const version = hexToNumber(slice(payload, 0, 1));
  const id = hexToNumber(slice(payload, 1, 4));
  if (version !== 1) return { ok: false, version, id, reason: `unsupported version ${version} (only 1 exists)` };
  const spec = ACTIONS[id];
  if (!spec) return { ok: false, version, id, reason: `unknown action id ${id}` };
  try {
    const values = decodeAbiParameters(parseAbiParameters(spec.abi), slice(payload, 4));
    const named: Fields = Object.fromEntries(spec.fields.map((f, i) => [f, toField(values[i])]));
    return { ok: true, version, id, name: spec.name, fields: spec.humanize ? spec.humanize(named) : named };
  } catch (e) {
    return { ok: false, version, id, reason: `payload does not match ${spec.name}(${spec.abi}): ${e instanceof BaseError ? e.shortMessage : String(e)}` };
  }
};

/** A RawAction log's data is the ABI encoding of a single `bytes`. */
export const decodeRawActionLog = (data: Hex): DecodedAction => {
  const [payload] = decodeAbiParameters(parseAbiParameters("bytes"), data);
  return decodeRawAction(payload);
};
