import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.ts";

const ADDRESS = "0x963a323Bebea09Fe2B094D23144e7187f90514D0";
const BUILDER = "0xabc0000000000000000000000000000000000001";
const HASH = `0x${"ab".repeat(32)}`;

describe("parseArgs", () => {
  it("parses an address on testnet by default", () => {
    expect(parseArgs([ADDRESS])).toEqual({ kind: "address", target: ADDRESS, network: "testnet", json: false, builder: undefined, asBuilder: false });
  });

  it("parses a tx hash", () => {
    expect(parseArgs([HASH])).toEqual({ kind: "tx", target: HASH, network: "testnet", json: false });
  });

  it("--mainnet switches network", () => {
    expect(parseArgs([HASH, "--mainnet"])).toMatchObject({ kind: "tx", network: "mainnet" });
  });

  it("--json asks for JSON output in either mode", () => {
    expect(parseArgs(["--json", ADDRESS])).toMatchObject({ kind: "address", json: true });
    expect(parseArgs([HASH, "--json"])).toMatchObject({ kind: "tx", json: true });
  });

  it("--builder takes the next argument, before or after the target", () => {
    expect(parseArgs([ADDRESS, "--builder", BUILDER])).toMatchObject({ kind: "address", target: ADDRESS, builder: BUILDER });
    expect(parseArgs(["--builder", BUILDER, ADDRESS])).toMatchObject({ kind: "address", target: ADDRESS, builder: BUILDER });
  });

  it("--as-builder", () => {
    expect(parseArgs([ADDRESS, "--as-builder"])).toMatchObject({ kind: "address", asBuilder: true });
  });

  it("--help and -h win over everything else", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs([ADDRESS, "-h", "--bogus"])).toEqual({ kind: "help" });
  });

  it("--version and -v", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("rejects an unknown flag by name", () => {
    expect(parseArgs([ADDRESS, "--testnet"])).toEqual({ kind: "error", message: "Unknown option --testnet" });
  });

  it("rejects --builder without a value", () => {
    expect(parseArgs([ADDRESS, "--builder"])).toEqual({ kind: "error", message: "--builder needs a 0x address" });
  });

  it("rejects a --builder value that is not an address", () => {
    expect(parseArgs([ADDRESS, "--builder", "0x1234"])).toEqual({ kind: "error", message: "--builder needs a 0x address, got 0x1234" });
    expect(parseArgs([ADDRESS, "--builder", "--mainnet"])).toEqual({ kind: "error", message: "--builder needs a 0x address, got --mainnet" });
  });

  it("rejects builder flags on a tx hash", () => {
    expect(parseArgs([HASH, "--builder", BUILDER])).toEqual({ kind: "error", message: "--builder and --as-builder only apply to an address" });
    expect(parseArgs([HASH, "--as-builder"])).toEqual({ kind: "error", message: "--builder and --as-builder only apply to an address" });
  });

  it("needs a target", () => {
    expect(parseArgs([])).toEqual({ kind: "error", message: "Give an address or a HyperEVM tx hash" });
    expect(parseArgs(["--mainnet"])).toEqual({ kind: "error", message: "Give an address or a HyperEVM tx hash" });
  });

  it("rejects a target that is neither an address nor a tx hash", () => {
    expect(parseArgs(["0x1234"])).toEqual({ kind: "error", message: "Not an address (0x + 40 hex) or tx hash (0x + 64 hex): 0x1234" });
    expect(parseArgs(["alice"])).toEqual({ kind: "error", message: "Not an address (0x + 40 hex) or tx hash (0x + 64 hex): alice" });
  });

  it("rejects more than one target", () => {
    expect(parseArgs([ADDRESS, HASH])).toEqual({ kind: "error", message: `One target at a time, got ${ADDRESS} and ${HASH}` });
  });
});
