// What to tell the user when Hyperliquid couldn't answer, instead of a stack trace.
import type { Network } from "./types.ts";

// Node's connect errors are often an AggregateError with an empty message: the reason is in .errors or .code.
const describe = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  if (e.message) return e.message;
  if (e instanceof AggregateError && e.errors.length > 0) return describe(e.errors[0]);
  return "code" in e ? String(e.code) : e.name;
};

const messages = (error: unknown): string[] => {
  const out: string[] = [];
  for (let e = error; e !== undefined; e = e instanceof Error ? e.cause : undefined) out.push(describe(e));
  return out;
};

const firstLine = (s: string) => s.split("\n")[0];

export const describeFailure = (error: unknown, network: Network): string => {
  const chain = messages(error);
  const any = (re: RegExp) => chain.some((m) => re.test(m));
  if (any(/\b429\b|rate.?limit/i))
    return `Hyperliquid's public ${network} endpoint is rate-limiting this machine (${firstLine(chain[0])}).\nNothing was diagnosed. Wait about 10 seconds and run it again.`;
  if (any(/fetch failed|timeout/i))
    return `Couldn't reach Hyperliquid ${network} (${firstLine(chain[chain.length - 1])}).\nNothing was diagnosed. Check your connection and run it again.`;
  return `Hyperliquid ${network} sent a response hl-doctor didn't expect (${firstLine(chain[0])}).\nNothing was diagnosed. If it keeps happening, please open an issue with the command you ran.`;
};
