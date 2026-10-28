// What to tell the user when Hyperliquid couldn't answer, instead of a stack trace.
import type { Network } from "./types.ts";

const messages = (error: unknown): string[] => {
  const out: string[] = [];
  for (let e = error; e !== undefined; e = e instanceof Error ? e.cause : undefined) out.push(e instanceof Error ? e.message : String(e));
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
