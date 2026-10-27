import type { Finding, Severity } from "./types.ts";

const ICON: Record<Severity, string> = { ok: "OK  ", info: "INFO", warn: "WARN", error: "FAIL" };
const COLOR: Record<Severity, string> = { ok: "\x1b[32m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };
const RESET = "\x1b[0m";
const ORDER: Severity[] = ["error", "warn", "info", "ok"];

const indent = (text: string) => text.split("\n").map((l) => `       ${l}`).join("\n");

/** Most severe first, so the problem is at the top. */
export const renderFindings = (findings: Finding[], color = true): string =>
  [...findings]
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
    .map((f) => {
      const tag = color ? `${COLOR[f.severity]}${ICON[f.severity]}${RESET}` : ICON[f.severity];
      return [`  ${tag} ${f.title}`, f.detail && indent(f.detail), f.fix && indent(`→ ${f.fix}`)].filter(Boolean).join("\n");
    })
    .join("\n");

export const exitCode = (findings: Finding[]) => (findings.some((f) => f.severity === "error") ? 1 : 0);
