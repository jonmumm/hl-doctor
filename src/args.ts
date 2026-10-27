// Pure command-line parsing: argv in, a typed request (or a user-facing error) out.
import type { Hex, Network } from "./types.ts";

export type Args =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string }
  | { kind: "address"; target: Hex; network: Network; json: boolean; builder: Hex | undefined; asBuilder: boolean }
  | { kind: "tx"; target: Hex; network: Network; json: boolean };

export const USAGE = `Usage: hl-doctor <address | evm tx hash> [options]

Explains why money or actions didn't land on Hyperliquid's HyperCore. Read-only.

Options:
  --mainnet              check mainnet instead of testnet
  --builder <address>    also check the address's builder-code approval for <address>
  --as-builder           also check whether this address can collect builder fees
  --json                 print { target, network, sections: [{ heading, findings }] }
  -h, --help             show this help
  -v, --version          show the version

Examples:
  hl-doctor 0x963a323Bebea09Fe2B094D23144e7187f90514D0
  hl-doctor 0x963a323Bebea09Fe2B094D23144e7187f90514D0 --mainnet --json
  hl-doctor 0xbda23c808243e1ba530c4035f4188bb6d63cb32c6a24a9e8d976d3201dafa24a

Exit code: 0 when no check fails, 1 when one does, 2 for a usage error.`;

const isAddress = (v: string): v is Hex => /^0x[0-9a-fA-F]{40}$/.test(v);
const isTxHash = (v: string): v is Hex => /^0x[0-9a-fA-F]{64}$/.test(v);
const BOOLEAN_FLAGS = new Set(["--mainnet", "--json", "--as-builder"]);

interface Scanned {
  flags: Set<string>;
  builder: string | null | undefined;
  positionals: string[];
  unknown: string | undefined;
}

/** Splits argv into flags, the --builder value (null when missing) and positionals. */
const scan = (argv: string[]): Scanned => {
  const s: Scanned = { flags: new Set(), builder: undefined, positionals: [], unknown: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--builder") s.builder = argv[++i] ?? null;
    else if (BOOLEAN_FLAGS.has(a)) s.flags.add(a);
    else if (a.startsWith("-")) s.unknown ??= a;
    else s.positionals.push(a);
  }
  return s;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (message: string): Parsed<never> => ({ ok: false, message });

const parseBuilder = (builder: string | null | undefined): Parsed<Hex | undefined> => {
  if (builder === null) return fail("--builder needs a 0x address");
  if (builder === undefined || isAddress(builder)) return ok(builder);
  return fail(`--builder needs a 0x address, got ${builder}`);
};

const parseTarget = ([target, extra]: string[]): Parsed<Hex> => {
  if (target === undefined) return fail("Give an address or a HyperEVM tx hash");
  if (extra !== undefined) return fail(`One target at a time, got ${target} and ${extra}`);
  if (isAddress(target) || isTxHash(target)) return ok(target);
  return fail(`Not an address (0x + 40 hex) or tx hash (0x + 64 hex): ${target}`);
};

const request = (flags: Set<string>, target: Hex, builder: Hex | undefined): Args => {
  const network: Network = flags.has("--mainnet") ? "mainnet" : "testnet";
  const json = flags.has("--json");
  const asBuilder = flags.has("--as-builder");
  if (isAddress(target)) return { kind: "address", target, network, json, builder, asBuilder };
  if (builder !== undefined || asBuilder) return { kind: "error", message: "--builder and --as-builder only apply to an address" };
  return { kind: "tx", target, network, json };
};

export const parseArgs = (argv: string[]): Args => {
  if (argv.some((a) => a === "--help" || a === "-h")) return { kind: "help" };
  if (argv.some((a) => a === "--version" || a === "-v")) return { kind: "version" };
  const s = scan(argv);
  if (s.unknown) return { kind: "error", message: `Unknown option ${s.unknown}` };
  const builder = parseBuilder(s.builder);
  if (!builder.ok) return { kind: "error", message: builder.message };
  const target = parseTarget(s.positionals);
  if (!target.ok) return { kind: "error", message: target.message };
  return request(s.flags, target.value, builder.value);
};
