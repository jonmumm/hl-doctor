// Dev tool (not shipped): scans recent HyperEVM blocks for txs that touch HyperCore and prints
// candidate tx hashes grouped by kind, to pick real cases for the replay fixtures.
// Usage: node scripts/find-cases.ts [--mainnet] [--blocks 20000]
import { hexToBigInt, numberToHex } from "viem";
import { z } from "zod";
import { CORE_WRITER } from "../src/corewriter.ts";
import { HYPE_SYSTEM_ADDRESS, TRANSFER_TOPIC } from "../src/evmtx.ts";
import { DEFAULT_ENDPOINTS } from "../src/fetch.ts";
import type { Hex, Network } from "../src/types.ts";
import { groupCandidates, type ScannedLog } from "./candidates.ts";

const MAX_RANGE = 1000; // the public RPC answers "query exceeds max block range 1000"
const PER_GROUP = 5;

const HexStr = z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v));
const Log = z.object({ address: HexStr, topics: z.array(HexStr), data: HexStr, transactionHash: HexStr });
const Response = z.union([z.object({ result: z.unknown() }), z.object({ error: z.object({ message: z.string() }) })]);

const argv = process.argv.slice(2);
const network: Network = argv.includes("--mainnet") ? "mainnet" : "testnet";
const blocksArg = argv.indexOf("--blocks");
const blocks = blocksArg >= 0 ? Number(argv[blocksArg + 1]) : 20_000;

const rpc = async <T>(method: string, params: unknown[], schema: z.ZodType<T>): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(DEFAULT_ENDPOINTS.rpc[network], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = Response.parse(await res.json());
    if (!("error" in body)) return schema.parse(body.result);
    if (body.error.message !== "rate limited" || attempt === 5) throw new Error(`${method}: ${body.error.message}`);
    process.stderr.write(`rate limited, retrying ${method}\n`);
    await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
  }
};

const logs = (from: bigint, to: bigint, filter: object) =>
  rpc("eth_getLogs", [{ fromBlock: numberToHex(from), toBlock: numberToHex(to), ...filter }], z.array(Log));

const head = hexToBigInt(await rpc("eth_blockNumber", [], HexStr));
const found: ScannedLog[] = [];
for (let to = head; to > head - BigInt(blocks); to -= BigInt(MAX_RANGE)) {
  const from = to - BigInt(MAX_RANGE) + 1n;
  found.push(...(await logs(from, to, { address: [CORE_WRITER, HYPE_SYSTEM_ADDRESS] })), ...(await logs(from, to, { topics: [TRANSFER_TOPIC] })));
  process.stderr.write(`scanned ${head - from + 1n}/${blocks} blocks\r`);
}
process.stderr.write("\n");

const groups = groupCandidates(found);
console.log(`${network}, blocks ${head - BigInt(blocks) + 1n}..${head}`);
for (const [group, hashes] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`\n${group} (${hashes.length})`);
  for (const h of hashes.slice(0, PER_GROUP)) console.log(`  ${h}`);
}
