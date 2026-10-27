import type { Finding, Hex, Network, Severity } from "./types.ts";

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

export interface Section {
  heading: string;
  findings: Finding[];
}

export interface Report {
  target: Hex;
  network: Network;
  /** One-line facts printed under the target in text mode (balances, block, ...). */
  summary: string[];
  sections: Section[];
}

export const renderReport = (r: Report, color = true): string =>
  [`${r.target} on ${r.network}`, ...r.summary, ...r.sections.flatMap((s) => [`\n${s.heading}`, renderFindings(s.findings, color)])].join("\n");

/** Machine-readable output: no summary lines, no colour. */
export const reportJson = ({ target, network, sections }: Report): string => JSON.stringify({ target, network, sections }, null, 2);

export const reportExitCode = (r: Report) => exitCode(r.sections.flatMap((s) => s.findings));
