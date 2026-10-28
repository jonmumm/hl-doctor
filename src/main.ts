// The CLI as a function: argv in, output through `io`, exit code out. src/cli.ts wires it to the process.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { activeElsewhere, builderEligibility, describeAbstraction, diagnoseAddress, diagnoseBuilderApproval } from "./address.ts";
import { parseArgs, USAGE, type OrderId } from "./args.ts";
import { classifyTx } from "./evmtx.ts";
import {
  DEFAULT_ENDPOINTS,
  explorerTxUrl,
  fetchAddressSnapshot,
  fetchBuilderSnapshot,
  fetchCoreActivity,
  fetchEvmTx,
  fetchOrder,
  fetchOrderHistory,
  hasCoreAccount,
  type Endpoints,
} from "./fetch.ts";
import { describeFailure } from "./failure.ts";
import { diagnoseOrder, recentRejections } from "./orders.ts";
import { renderReport, reportExitCode, reportJson, type Report, type Section } from "./render.ts";
import { diagnoseTx, otherNetwork, txNotFound, txUsers } from "./tx.ts";
import type { AddressSnapshot, CoreActivity, Hex, Network } from "./types.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  color: boolean;
}

// package.json sits one level above both src/ and dist/.
const packageVersion = () =>
  z.object({ version: z.string() }).parse(JSON.parse(String(readFileSync(new URL("../package.json", import.meta.url))))).version;

interface AddressRequest {
  target: Hex;
  network: Network;
  builder: Hex | undefined;
  asBuilder: boolean;
  order: OrderId | undefined;
}

const addressSummary = (s: AddressSnapshot): string[] => {
  const spot = s.spot.balances.map((b) => `${b.total} ${b.coin}`).join(", ") || "empty";
  return [
    `  perps value ${s.perp.accountValue} USDC, withdrawable ${s.perp.withdrawable}; mode ${describeAbstraction(s.abstraction)}`,
    `  spot: ${spot}${s.evm ? `; HyperEVM: ${s.evm.hype} HYPE` : ""}`,
  ];
};

const doctorAddress = async ({ target, network, builder, asBuilder, order }: AddressRequest, ep: Endpoints, now: number): Promise<Report> => {
  const [s, history] = await Promise.all([fetchAddressSnapshot(network, target, ep), fetchOrderHistory(network, target, ep)]);
  // Only a missing account needs the other network; a failed lookup there just means no hint.
  const elsewhere = s.role.role === "missing" && (await hasCoreAccount(otherNetwork(network), target, ep));
  const orders = history ? recentRejections(history, now) : [];
  const sections: Section[] = [{ heading: "Account", findings: [...diagnoseAddress(s), ...activeElsewhere({ network, elsewhere }), ...orders] }];
  if (order !== undefined) sections.push({ heading: `Order ${order}`, findings: diagnoseOrder(String(order), await fetchOrder(network, target, order, ep)) });
  if (builder) sections.push({ heading: `Builder ${builder}`, findings: diagnoseBuilderApproval(await fetchBuilderSnapshot(network, target, builder, ep)) });
  if (asBuilder) sections.push({ heading: "As a builder", findings: builderEligibility({ accountValue: s.perp.accountValue, abstraction: s.abstraction, role: s.role }) });
  return { target, network, summary: addressSummary(s), sections };
};

const doctorTx = async (target: Hex, network: Network, ep: Endpoints): Promise<Report> => {
  const found = await fetchEvmTx(network, target, ep);
  if (!found) {
    const elsewhere = await fetchEvmTx(otherNetwork(network), target, ep).catch(() => null);
    const findings = txNotFound({ network, elsewhere: elsewhere !== null, explorerUrl: explorerTxUrl(network, target) });
    return { target, network, summary: [], sections: [{ heading: "HyperCore effect", findings }] };
  }
  const { tx, blockTime } = found;
  const events = classifyTx(tx);
  const users = txUsers(events);
  const activity = new Map<Hex, CoreActivity>(
    await Promise.all(users.map(async (u): Promise<[Hex, CoreActivity]> => [u, await fetchCoreActivity(network, u, blockTime, ep)])),
  );
  const findings = diagnoseTx({ tx, events, blockTime, now: Date.now(), activity });
  const summary = [`  block ${tx.blockNumber} at ${new Date(blockTime).toISOString()}, from ${tx.from} to ${tx.to ?? "(contract creation)"}`];
  return { target, network, summary, sections: [{ heading: "HyperCore effect", findings }] };
};

export const run = async (argv: string[], io: Io, ep = DEFAULT_ENDPOINTS, now = Date.now()): Promise<number> => {
  const args = parseArgs(argv);
  if (args.kind === "help") return io.out(USAGE), 0;
  if (args.kind === "version") return io.out(packageVersion()), 0;
  if (args.kind === "error") return io.err(`hl-doctor: ${args.message}\nRun hl-doctor --help for usage.`), 2;
  let report: Report;
  try {
    report = args.kind === "address" ? await doctorAddress(args, ep, now) : await doctorTx(args.target, args.network, ep);
  } catch (error) {
    return io.err(`hl-doctor: ${describeFailure(error, args.network)}`), 3;
  }
  io.out(args.json ? reportJson(report) : renderReport(report, io.color));
  return reportExitCode(report);
};
