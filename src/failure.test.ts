import { describe, expect, it } from "vitest";
import { describeFailure } from "./failure.ts";

const chain = (...messages: string[]) =>
  messages.reduceRight<Error | undefined>((cause, m) => new Error(m, cause ? { cause } : undefined), undefined);

describe("describeFailure", () => {
  it("names a rate limit from an HTTP 429 and says to wait", () => {
    expect(describeFailure(new Error('429 Too Many Requests - "rate limited"'), "testnet")).toBe(
      "Hyperliquid's public testnet endpoint is rate-limiting this machine (429 Too Many Requests - \"rate limited\").\n" +
        "Nothing was diagnosed. Wait about 10 seconds and run it again.",
    );
  });

  it("names a rate limit from a JSON-RPC 'rate limited' message on mainnet", () => {
    expect(describeFailure(new Error("eth_getBalance: rate limited"), "mainnet")).toMatch(/^Hyperliquid's public mainnet endpoint is rate-limiting/);
  });

  it.each([["ratelimit exceeded"], ["Rate limited"], ["rate-limit hit"]])("treats %j as a rate limit", (m) => {
    expect(describeFailure(new Error(m), "testnet")).toMatch(/rate-limiting this machine/);
  });

  it("finds a rate limit in a cause, not just the top error", () => {
    expect(describeFailure(chain("request failed", "HTTP 429"), "testnet")).toMatch(/rate-limiting this machine \(request failed\)/);
  });

  it("says the API is unreachable when fetch failed, showing the root cause", () => {
    expect(describeFailure(chain("Unknown HTTP request error: fetch failed", "fetch failed", "getaddrinfo ENOTFOUND api.hyperliquid-testnet.xyz"), "testnet")).toBe(
      "Couldn't reach Hyperliquid testnet (getaddrinfo ENOTFOUND api.hyperliquid-testnet.xyz).\n" +
        "Nothing was diagnosed. Check your connection and run it again.",
    );
  });

  it("treats a timeout as unreachable", () => {
    expect(describeFailure(new Error("The operation was aborted due to timeout"), "mainnet")).toMatch(/^Couldn't reach Hyperliquid mainnet \(The operation was aborted due to timeout\)/);
  });

  it("reports anything else as an unexpected response, first line only", () => {
    expect(describeFailure(new Error("Invalid input\nat path [0].coin"), "testnet")).toBe(
      "Hyperliquid testnet sent a response hl-doctor didn't expect (Invalid input).\n" +
        "Nothing was diagnosed. If it keeps happening, please open an issue with the command you ran.",
    );
  });

  it("copes with a thrown non-Error", () => {
    expect(describeFailure("boom", "testnet")).toMatch(/didn't expect \(boom\)/);
  });
});
