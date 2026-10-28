// Test helper: a local HTTP server standing in for the Hyperliquid info API and HyperEVM RPC.
// Record mode (HL_RECORD=1) proxies to the real endpoints and saves every response;
// replay mode serves the saved responses, so seam tests are offline and deterministic.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { DEFAULT_ENDPOINTS, type Endpoints } from "./fetch.ts";
import type { Network } from "./types.ts";

const Fixture = z.record(z.string(), z.object({ status: z.number(), body: z.string() }));
type Fixture = z.infer<typeof Fixture>;

const upstream = (path: string): string | null => {
  const [, network, kind] = path.split("/");
  if (network !== "testnet" && network !== "mainnet") return null;
  return kind === "evm" ? DEFAULT_ENDPOINTS.rpc[network] : `${DEFAULT_ENDPOINTS.api[network]}/${kind}`;
};

/** JSON-RPC ids vary between runs; everything else in the request must match exactly. */
const keyFor = (path: string, body: string) => {
  try {
    const { id: _, ...rest } = z.record(z.string(), z.unknown()).parse(JSON.parse(body));
    return `${path} ${JSON.stringify(rest)}`;
  } catch {
    return `${path} ${body}`;
  }
};

export type FakeHandler = (req: { path: string; contentType: string | undefined; body: unknown }) => { status?: number; body: unknown };

const listen = async (handle: (path: string, contentType: string | undefined, body: string) => Promise<{ status: number; body: string } | null>, misses: string[]) => {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks).toString();
    const path = req.url ?? "/";
    const hit = await handle(path, req.headers["content-type"], body);
    if (!hit) {
      misses.push(keyFor(path, body));
      res.writeHead(599).end("no recording");
      return;
    }
    res.writeHead(hit.status, { "content-type": "application/json" }).end(hit.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = z.custom<AddressInfo>((a) => typeof a === "object" && a !== null && "port" in a).parse(server.address());
  const net = (n: Network) => `http://127.0.0.1:${port}/${n}`;
  const endpoints: Endpoints = { api: { testnet: net("testnet"), mainnet: net("mainnet") }, rpc: { testnet: `${net("testnet")}/evm`, mainnet: `${net("mainnet")}/evm` } };
  return { server, endpoints };
};

// The public endpoints throttle bursts; a throttled reply must never be saved as a fixture.
const isThrottled = (r: { status: number; body: string }) => r.status === 429 || r.body.includes("rate limited");

export const fetchUpstream = async (target: string, body: string, backoffMs = 2_000) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body });
    const r = { status: res.status, body: await res.text() };
    if (!isThrottled(r) || attempt === 6) return r;
    await new Promise((done) => setTimeout(done, backoffMs * 2 ** attempt));
  }
};

export interface ReplayServer {
  endpoints: Endpoints;
  /** Requests that had no recording, so tests can fail loudly instead of hanging on the network. */
  misses: string[];
  close: () => Promise<void>;
}

export const startReplayServer = async (fixturePath: string, record = process.env.HL_RECORD === "1"): Promise<ReplayServer> => {
  const fixture: Fixture = record ? {} : Fixture.parse(JSON.parse(readFileSync(fixturePath, "utf8")));
  const misses: string[] = [];
  const { server, endpoints } = await listen(async (path, _contentType, body) => {
    const key = keyFor(path, body);
    const target = upstream(path);
    if (record && target) fixture[key] = await fetchUpstream(target, body);
    return fixture[key] ?? null;
  }, misses);
  return {
    endpoints,
    misses,
    close: async () => {
      await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
      if (record) writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    },
  };
};

/** A programmable stand-in for responses no real account produces on demand (pending tx, bad hex, …). */
export const startFakeServer = async (handler: FakeHandler): Promise<ReplayServer> => {
  const misses: string[] = [];
  const { server, endpoints } = await listen(async (path, contentType, body) => {
    const r = handler({ path, contentType, body: JSON.parse(body) });
    return { status: r.status ?? 200, body: JSON.stringify(r.body) };
  }, misses);
  return { endpoints, misses, close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }) };
};
