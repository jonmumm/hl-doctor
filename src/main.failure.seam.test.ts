// The CLI when Hyperliquid can't answer: a clear message on stderr and exit code 3, never a stack trace.
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./main.ts";
import { startFakeServer, type ReplayServer } from "./replay-server.ts";
import type { Endpoints } from "./fetch.ts";

const FRESH = "0x963a323Bebea09Fe2B094D23144e7187f90514D0";
const TX = `0x${"ab".repeat(32)}`;
const DEAD: Endpoints = {
  api: { testnet: "http://127.0.0.1:9", mainnet: "http://127.0.0.1:9" },
  rpc: { testnet: "http://127.0.0.1:9/evm", mainnet: "http://127.0.0.1:9/evm" },
};

let server: ReplayServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const cli = async (ep: Endpoints, ...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), color: false }, ep);
  return { code, out: out.join("\n"), err: err.join("\n") };
};

const rateLimited = async () => {
  server = await startFakeServer(() => ({ status: 429, body: "rate limited" }));
  return server.endpoints;
};

describe("run when Hyperliquid can't answer", () => {
  it.each([[[FRESH]], [[FRESH, "--json"]], [[TX]], [[FRESH, "--mainnet"]]])("unreachable %j: message on stderr, nothing on stdout, exit 3", async (argv) => {
    const r = await cli(DEAD, ...argv);
    expect(r.code).toBe(3);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/^hl-doctor: Couldn't reach Hyperliquid (testnet|mainnet) \(.+\)\.\nNothing was diagnosed\./);
    expect(r.err).not.toMatch(/\n\s+at /);
  });

  it("an address on a rate-limited API says to wait", async () => {
    const r = await cli(await rateLimited(), FRESH);
    expect(r).toMatchObject({ code: 3, out: "" });
    expect(r.err).toMatch(/^hl-doctor: Hyperliquid's public testnet endpoint is rate-limiting this machine \(.*429.*\)\.\nNothing was diagnosed\. Wait about 10 seconds/);
  });

  it("a tx on a rate-limited RPC says to wait", async () => {
    const r = await cli(await rateLimited(), TX);
    expect(r).toMatchObject({ code: 3, out: "" });
    expect(r.err).toMatch(/rate-limiting this machine \(eth_get\w+: HTTP 429 "rate limited"\)/);
  });
});
