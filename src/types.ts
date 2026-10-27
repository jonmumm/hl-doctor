export type Hex = `0x${string}`;
export type Network = "testnet" | "mainnet";
export type Severity = "ok" | "info" | "warn" | "error";

export interface Finding {
  severity: Severity;
  title: string;
  detail?: string;
  fix?: string;
}

export type Role =
  | { role: "missing" | "user" | "vault" }
  | { role: "agent"; data: { user: Hex } }
  | { role: "subAccount"; data: { master: Hex } };

/** Everything the address checks need, already fetched and parsed. */
export interface AddressSnapshot {
  network: Network;
  address: Hex;
  role: Role;
  /** Raw userAbstraction value: "disabled" | "default" | "unifiedAccount" | "portfolioMargin" | ... */
  abstraction: string;
  legal: { acceptedTerms: boolean; userAllowed: boolean };
  perp: { accountValue: number; withdrawable: number };
  spot: {
    balances: { coin: string; total: number; hold: number }[];
    evmEscrows: { coin: string; total: number }[];
  };
  /** userRateLimit: nRequestsUsed, nRequestsCap, cumVlm (USDC traded), nRequestsSurplus. */
  rateLimit: { used: number; cap: number; cumVlm?: number; surplus?: number };
  /** null when the HyperEVM RPC could not be reached. */
  evm: { hype: number; usingBigBlocks: boolean } | null;
  /** Testnet only: whether the same address has a mainnet deposit (faucet requirement). */
  mainnetDeposited: boolean | null;
}

export interface BuilderSnapshot {
  user: Hex;
  builder: Hex;
  /** maxBuilderFee: tenths of a basis point. 0 = not approved. */
  approvedMaxFee: number;
  builderRole: Role;
  builderAccountValue: number;
  builderAbstraction: string;
}

export interface EvmLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
}

export interface EvmTx {
  hash: Hex;
  from: Hex;
  to: Hex | null;
  value: bigint;
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: EvmLog[];
}

export type FieldValue = string | number | boolean | bigint;

export type DecodedAction =
  | { ok: true; version: number; id: number; name: string; fields: Record<string, FieldValue> }
  | { ok: false; version: number; id: number; reason: string };

export type EvmEvent =
  | { kind: "coreWriter"; user: Hex; action: DecodedAction }
  | { kind: "hypeToCore"; from: Hex; amountWei: bigint }
  | { kind: "tokenToCore"; from: Hex; token: Hex; tokenIndex: number; amount: bigint };

/** HyperCore activity for one user in a time window around the EVM tx. */
export interface CoreActivity {
  user: Hex;
  role: Role;
  orders: { oid: number; cloid: string | null; coin: string; status: string; statusTimestamp: number }[];
  ledger: { time: number; type: string }[];
  evmEscrows: { coin: string; total: number }[];
  perpWithdrawable: number;
  /** Perp asset index -> coin name, for matching CoreWriter limit orders. */
  assetNames: Map<number, string>;
}
