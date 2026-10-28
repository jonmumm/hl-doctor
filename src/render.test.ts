import { describe, expect, it } from "vitest";
import { renderFindings, renderReport } from "./render.ts";

describe("renderFindings colours", () => {
  it.each([
    ["ok", "\x1b[32mOK  \x1b[0m"],
    ["info", "\x1b[36mINFO\x1b[0m"],
    ["warn", "\x1b[33mWARN\x1b[0m"],
    ["error", "\x1b[31mFAIL\x1b[0m"],
  ] as const)("%s gets its own colour", (severity, tag) => {
    expect(renderFindings([{ severity, title: "x" }], true)).toBe(`  ${tag} x`);
  });
});

describe("renderFindings order", () => {
  it("puts an error above a warning however they arrive", () => {
    expect(renderFindings([{ severity: "warn", title: "w" }, { severity: "error", title: "e" }], false)).toBe("  FAIL e\n  WARN w");
  });
});

describe("renderReport", () => {
  it("prints the target, summary lines, then each section", () => {
    const out = renderReport(
      { target: "0x1111111111111111111111111111111111111111", network: "mainnet", summary: ["  one"], sections: [{ heading: "Account", findings: [{ severity: "ok", title: "fine" }] }] },
      false,
    );
    expect(out).toBe("0x1111111111111111111111111111111111111111 on mainnet\n  one\n\nAccount\n  OK   fine");
  });
});
