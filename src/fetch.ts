// The seam: fetches live data from the Hyperliquid info API and the HyperEVM JSON-RPC,
// parses it at the boundary, and returns the plain snapshots the pure checks take.
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatEther, hexToBigInt } from "viem";
import { z } from "zod";
import type { AddressSnapshot, BuilderSnapshot, CoreActivity, EvmTx, Hex, Network } from "./types.ts";

export interface Endpoints {
  api: Record<Network, string>;
  rpc: Record<Network, string>;
}

export const DEFAULT_ENDPOINTS: Endpoints = {
  api: { testnet: "https://api.hyperliquid-testnet.xyz", mainnet: "https://api.hyperliquid.xyz" },
  rpc: { testnet: "https://rpc.hyperliquid-testnet.xyz/evm", mainnet: "https://rpc.hyperliquid.xyz/evm" },
};

export const explorerTxUrl = (network: Network, hash: Hex) =>
  `https://app.hyperliquid${network === "testnet" ? "-testnet" : ""}.xyz/explorer/tx/${hash}`;

// apiUrl picks the network; info requests need nothing else from the transport.
const info = (network: Network, ep: Endpoints) => new InfoClient({ transport: new HttpTransport({ apiUrl: ep.api[network] }) });

const HexStr = z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v), "expected hex");
const RpcResponse = z.union([z.object({ result: z.unknown() }), z.object({ error: z.object({ message: z.string() }) })]);

const rpc = async <T>(ep: Endpoints, network: Network, method: string, params: unknown[], schema: z.ZodType<T>): Promise<T> => {
  const res = await fetch(ep.rpc[network], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = RpcResponse.parse(await res.json());
  if ("error" in body) throw new Error(`${method}: ${body.error.message}`);
  return schema.parse(body.result);
};

const num = (s: string) => Number(s);

const evmState = async (ep: Endpoints, network: Network, address: Hex) => {
  try {
    const [balance, usingBigBlocks] = await Promise.all([
      rpc(ep, network, "eth_getBalance", [address, "latest"], HexStr),
      rpc(ep, network, "eth_usingBigBlocks", [address], z.boolean()),
    ]);
    return { hype: Number(formatEther(hexToBigInt(balance))), usingBigBlocks };
  } catch {
    return null;
  }
};

const hasMainnetDeposit = async (ep: Endpoints, address: Hex): Promise<boolean> => {
  const m = info("mainnet", ep);
  if ((await m.userRole({ user: address })).role === "missing") return false;
  const ledger = await m.userNonFundingLedgerUpdates({ user: address, startTime: 0 });
  return ledger.some((l) => l.delta.type === "deposit");
};

export const fetchAddressSnapshot = async (network: Network, address: Hex, ep = DEFAULT_ENDPOINTS): Promise<AddressSnapshot> => {
  const c = info(network, ep);
  const [role, abstraction, legal, perp, spot, rate, evm, mainnetDeposited] = await Promise.all([
    c.userRole({ user: address }),
    c.userAbstraction({ user: address }),
    c.legalCheck({ user: address }),
    c.clearinghouseState({ user: address }),
    c.spotClearinghouseState({ user: address }),
    c.userRateLimit({ user: address }),
    evmState(ep, network, address),
    network === "testnet" ? hasMainnetDeposit(ep, address).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    network,
    address,
    role,
    abstraction,
    legal: { acceptedTerms: legal.acceptedTerms, userAllowed: legal.userAllowed },
    perp: { accountValue: num(perp.marginSummary.accountValue), withdrawable: num(perp.withdrawable) },
    spot: {
      balances: spot.balances.map((b) => ({ coin: b.coin, total: num(b.total), hold: num(b.hold) })),
      evmEscrows: (spot.evmEscrows ?? []).map((e) => ({ coin: e.coin, total: num(e.total) })),
    },
    rateLimit: { used: rate.nRequestsUsed, cap: rate.nRequestsCap, cumVlm: num(rate.cumVlm), surplus: rate.nRequestsSurplus },
    evm,
    mainnetDeposited,
  };
};

/** Whether HyperCore has an account (of any role) for this address on this network; false if the lookup fails. */
export const hasCoreAccount = async (network: Network, address: Hex, ep = DEFAULT_ENDPOINTS): Promise<boolean> => {
  try {
    return (await info(network, ep).userRole({ user: address })).role !== "missing";
  } catch {
    return false;
  }
};

export const fetchBuilderSnapshot = async (network: Network, user: Hex, builder: Hex, ep = DEFAULT_ENDPOINTS): Promise<BuilderSnapshot> => {
  const c = info(network, ep);
  const [approvedMaxFee, builderRole, builderAbstraction, perp] = await Promise.all([
    c.maxBuilderFee({ user, builder }),
    c.userRole({ user: builder }),
    c.userAbstraction({ user: builder }),
    c.clearinghouseState({ user: builder }),
  ]);
  return { user, builder, approvedMaxFee, builderRole, builderAbstraction, builderAccountValue: num(perp.marginSummary.accountValue) };
};

const RpcTx = z.object({ hash: HexStr, from: HexStr, to: HexStr.nullable(), value: HexStr, blockNumber: HexStr.nullable() });
const RpcReceipt = z.object({
  status: HexStr,
  blockNumber: HexStr,
  logs: z.array(z.object({ address: HexStr, topics: z.array(HexStr), data: HexStr })),
});
const RpcBlock = z.object({ timestamp: HexStr });

/** null when the hash is not a mined HyperEVM tx on this network. */
export const fetchEvmTx = async (network: Network, hash: Hex, ep = DEFAULT_ENDPOINTS): Promise<{ tx: EvmTx; blockTime: number } | null> => {
  const [t, r] = await Promise.all([
    rpc(ep, network, "eth_getTransactionByHash", [hash], RpcTx.nullable()),
    rpc(ep, network, "eth_getTransactionReceipt", [hash], RpcReceipt.nullable()),
  ]);
  if (!t || !r) return null;
  const block = await rpc(ep, network, "eth_getBlockByNumber", [r.blockNumber, false], RpcBlock);
  return {
    tx: {
      hash: t.hash,
      from: t.from,
      to: t.to,
      value: hexToBigInt(t.value),
      status: r.status === "0x1" ? "success" : "reverted",
      blockNumber: hexToBigInt(r.blockNumber),
      logs: r.logs,
    },
    blockTime: Number(hexToBigInt(block.timestamp)) * 1000,
  };
};

export const fetchCoreActivity = async (network: Network, user: Hex, since: number, ep = DEFAULT_ENDPOINTS): Promise<CoreActivity> => {
  const c = info(network, ep);
  const [role, orders, ledger, spot, perp, meta] = await Promise.all([
    c.userRole({ user }),
    c.historicalOrders({ user }),
    c.userNonFundingLedgerUpdates({ user, startTime: Math.max(0, since - 5_000) }),
    c.spotClearinghouseState({ user }),
    c.clearinghouseState({ user }),
    c.meta(),
  ]);
  return {
    user,
    role,
    orders: orders.map((o) => ({ oid: o.order.oid, cloid: o.order.cloid, coin: o.order.coin, status: o.status, statusTimestamp: o.statusTimestamp })),
    ledger: ledger.map((l) => ({ time: l.time, type: l.delta.type })),
    evmEscrows: (spot.evmEscrows ?? []).map((e) => ({ coin: e.coin, total: num(e.total) })),
    perpWithdrawable: num(perp.withdrawable),
    assetNames: new Map(meta.universe.map((m, i) => [i, m.name])),
  };
};
