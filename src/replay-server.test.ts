// Record mode must never save a throttled reply as a fixture.
import { afterEach, describe, expect, it } from "vitest";
import { fetchUpstream, startFakeServer, type ReplayServer } from "./replay-server.ts";

let server: ReplayServer;
afterEach(() => server.close());

const throttleFirst = async (n: number, reply: { status?: number; body: unknown }) => {
  let calls = 0;
  server = await startFakeServer(() => (++calls <= n ? reply : { body: { result: "ok" } }));
  return { url: server.endpoints.api.testnet, calls: () => calls };
};

describe("fetchUpstream", () => {
  it("retries an HTTP 429 until the upstream answers", async () => {
    const up = await throttleFirst(2, { status: 429, body: "slow down" });
    expect(await fetchUpstream(up.url, "{}", 0)).toEqual({ status: 200, body: '{"result":"ok"}' });
    expect(up.calls()).toBe(3);
  });

  it("retries a JSON-RPC 'rate limited' error", async () => {
    const up = await throttleFirst(1, { body: { error: { code: -32005, message: "rate limited" } } });
    expect(await fetchUpstream(up.url, "{}", 0)).toEqual({ status: 200, body: '{"result":"ok"}' });
    expect(up.calls()).toBe(2);
  });

  it("gives up after 7 attempts and returns the last reply", async () => {
    const up = await throttleFirst(100, { status: 429, body: "slow down" });
    expect(await fetchUpstream(up.url, "{}", 0)).toEqual({ status: 429, body: '"slow down"' });
    expect(up.calls()).toBe(7);
  });
});
