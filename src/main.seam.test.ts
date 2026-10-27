// The whole CLI, argv to output and exit code, against recorded Hyperliquid responses.
// Re-record against the live APIs with: HL_RECORD=1 pnpm vitest run src/main.seam.test.ts
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { USAGE } from "./args.ts";
import { run } from "./main.ts";
import { startReplayServer, type ReplayServer } from "./replay-server.ts";

const FRESH = "0x963a323Bebea09Fe2B094D23144e7187f90514D0"; // playground wallet: never funded
const HLP = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"; // mainnet HLP vault
const DELEGATE_TX = "0xbda23c808243e1ba530c4035f4188bb6d63cb32c6a24a9e8d976d3201dafa24a"; // testnet CoreWriter tokenDelegate
const UNKNOWN_TX = `0x${"ab".repeat(32)}`;
const PACKAGE_VERSION = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))).version;

const Finding = z.object({ severity: z.enum(["ok", "info", "warn", "error"]), title: z.string(), detail: z.string().optional(), fix: z.string().optional() }).strict();
const JsonReport = z.object({ target: z.string(), network: z.enum(["testnet", "mainnet"]), sections: z.array(z.object({ heading: z.string(), findings: z.array(Finding) }).strict()) }).strict();

let server: ReplayServer;

beforeAll(async () => {
  server = await startReplayServer(new URL("./__fixtures__/cli.json", import.meta.url).pathname);
});
afterAll(async () => {
  await server.close();
  expect(server.misses).toEqual([]);
});

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), color: false }, server.endpoints);
  return { code, out: out.join("\n"), err: err.join("\n") };
};

const json = async (...argv: string[]) => {
  const r = await cli(...argv, "--json");
  return { ...r, report: JsonReport.parse(JSON.parse(r.out)) };
};

const failing = (report: z.infer<typeof JsonReport>) => report.sections.some((s) => s.findings.some((f) => f.severity === "error"));

describe("run", () => {
  it("--help prints usage with examples and exits 0", async () => {
    expect(await cli("--help")).toEqual({ code: 0, out: USAGE, err: "" });
    expect(USAGE).toContain("Examples:");
  });

  it("--version prints the package.json version and exits 0", async () => {
    expect(await cli("--version")).toEqual({ code: 0, out: PACKAGE_VERSION, err: "" });
  });

  it("a usage error goes to stderr with a pointer to --help and exits 2", async () => {
    expect(await cli(FRESH, "--bogus")).toEqual({ code: 2, out: "", err: "hl-doctor: Unknown option --bogus\nRun hl-doctor --help for usage." });
    expect(await cli(FRESH, "--builder", "nope")).toMatchObject({ code: 2, out: "", err: expect.stringContaining("--builder needs a 0x address, got nope") });
  });

  it("prints an address report as text", async () => {
    const { code, out } = await cli(FRESH);
    const lines = out.split("\n");
    expect(lines[0]).toBe(`${FRESH} on testnet`);
    expect(lines[1]).toMatch(/^ {2}perps value \S+ USDC, withdrawable \S+; mode /);
    expect(lines[2]).toMatch(/^ {2}spot: /);
    expect(lines.slice(3, 5)).toEqual(["", "Account"]);
    expect(out).not.toContain("\x1b[");
    expect(code).toBe((await json(FRESH)).code);
  });

  it("--json prints only { target, network, sections } for an address", async () => {
    const { code, out, report } = await json(FRESH);
    expect(report.target).toBe(FRESH);
    expect(report.network).toBe("testnet");
    expect(report.sections.map((s) => s.heading)).toEqual(["Account"]);
    expect(report.sections[0].findings.length).toBeGreaterThan(0);
    expect(out).not.toContain("\x1b[");
    expect(code).toBe(failing(report) ? 1 : 0);
  });

  it("--json includes the builder sections and keeps the exit code", async () => {
    const { code, report } = await json(HLP, "--mainnet", "--builder", HLP, "--as-builder");
    expect(report.network).toBe("mainnet");
    expect(report.sections.map((s) => s.heading)).toEqual(["Account", `Builder ${HLP}`, "As a builder"]);
    expect(code).toBe(failing(report) ? 1 : 0);
  });

  it("--json for a HyperEVM tx", async () => {
    const { code, report } = await json(DELEGATE_TX);
    expect(report.target).toBe(DELEGATE_TX);
    expect(report.sections.map((s) => s.heading)).toEqual(["HyperCore effect"]);
    expect(report.sections[0].findings.length).toBeGreaterThan(0);
    expect(code).toBe(failing(report) ? 1 : 0);
  });

  it("prints a tx report as text", async () => {
    const { out } = await cli(DELEGATE_TX);
    const lines = out.split("\n");
    expect(lines[0]).toBe(`${DELEGATE_TX} on testnet`);
    expect(lines[1]).toMatch(/^ {2}block \d+ at \S+, from 0x[0-9a-fA-F]{40} to 0x[0-9a-fA-F]{40}$/);
    expect(lines.slice(2, 4)).toEqual(["", "HyperCore effect"]);
  });

  it("a tx on neither network points at the HyperCore explorer", async () => {
    const { code, report } = await json(UNKNOWN_TX);
    expect(code).toBe(0);
    expect(report.sections).toEqual([
      {
        heading: "HyperCore effect",
        findings: [
          {
            severity: "info",
            title: "Not a HyperEVM tx on testnet",
            detail: "It may be a HyperCore (L1) tx hash, or not mined yet.",
            fix: `Open it in the HyperCore explorer: https://app.hyperliquid-testnet.xyz/explorer/tx/${UNKNOWN_TX}`,
          },
        ],
      },
    ]);
  });
});
