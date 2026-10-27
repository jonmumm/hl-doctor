#!/usr/bin/env node
// Testnet doctor: explains why money or actions didn't land on HyperCore.
//   hl-doctor <address>                       account health
//   hl-doctor <address> --builder <address>   + builder-code approval and builder eligibility
//   hl-doctor <address> --as-builder          + can this address collect builder fees?
//   hl-doctor <evm tx hash>                   what a HyperEVM tx did (or didn't do) on HyperCore
//   add --mainnet to check mainnet instead of testnet
import { z } from "zod";
import { builderEligibility, diagnoseAddress, diagnoseBuilderApproval, describeAbstraction } from "./address.ts";
import { classifyTx } from "./evmtx.ts";
import { explorerTxUrl, fetchAddressSnapshot, fetchBuilderSnapshot, fetchCoreActivity, fetchEvmTx } from "./fetch.ts";
import { exitCode, renderFindings } from "./render.ts";
import { diagnoseTx } from "./tx.ts";
import type { CoreActivity, Finding, Hex, Network } from "./types.ts";

const Address = z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v), "expected a 0x address");
const TxHash = z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v), "expected a 0x tx hash");
const lower = (a: Hex): Hex => `0x${a.slice(2).toLowerCase()}`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const network: Network = flag("--mainnet") ? "mainnet" : "testnet";
const target = args.find((a) => a.startsWith("0x") && a !== option("--builder"));

const usage = () => {
  console.log("Usage: hl-doctor <address | evm tx hash> [--builder <address>] [--as-builder] [--mainnet]");
  process.exit(2);
};

const print = (heading: string, findings: Finding[]) => {
  console.log(`\n${heading}`);
  console.log(renderFindings(findings, process.stdout.isTTY === true));
};

const doctorAddress = async (address: Hex) => {
  const s = await fetchAddressSnapshot(network, address);
  const findings = diagnoseAddress(s);
  console.log(`${address} on ${network}`);
  console.log(`  perps value ${s.perp.accountValue} USDC, withdrawable ${s.perp.withdrawable}; mode ${describeAbstraction(s.abstraction)}`);
  console.log(`  spot: ${s.spot.balances.map((b) => `${b.total} ${b.coin}`).join(", ") || "empty"}${s.evm ? `; HyperEVM: ${s.evm.hype} HYPE` : ""}`);
  print("Account", findings);
  const all = [...findings];
  const builder = option("--builder");
  if (builder) {
    const b = diagnoseBuilderApproval(await fetchBuilderSnapshot(network, address, Address.parse(builder)));
    print(`Builder ${builder}`, b);
    all.push(...b);
  }
  if (flag("--as-builder")) {
    const b = builderEligibility({ accountValue: s.perp.accountValue, abstraction: s.abstraction, role: s.role });
    print("As a builder", b);
    all.push(...b);
  }
  return all;
};

const doctorTx = async (hash: Hex) => {
  const found = await fetchEvmTx(network, hash);
  if (!found) {
    const other: Network = network === "testnet" ? "mainnet" : "testnet";
    const elsewhere = await fetchEvmTx(other, hash).catch(() => null);
    const findings: Finding[] = [
      elsewhere
        ? { severity: "warn", title: `This tx is on ${other}, not ${network}`, fix: `Re-run with${other === "mainnet" ? " --mainnet" : "out --mainnet"}.` }
        : {
            severity: "info",
            title: `Not a HyperEVM tx on ${network}`,
            detail: "It may be a HyperCore (L1) tx hash, or not mined yet.",
            fix: `Open it in the HyperCore explorer: ${explorerTxUrl(network, hash)}`,
          },
    ];
    print(`${hash} on ${network}`, findings);
    return findings;
  }
  const { tx, blockTime } = found;
  const events = classifyTx(tx);
  const users = [...new Set(events.map((e) => lower(e.kind === "coreWriter" ? e.user : e.from)))];
  const activity = new Map<Hex, CoreActivity>(
    await Promise.all(users.map(async (u): Promise<[Hex, CoreActivity]> => [u, await fetchCoreActivity(network, u, blockTime)])),
  );
  const findings = diagnoseTx({ tx, events, blockTime, now: Date.now(), activity });
  console.log(`${hash} on ${network}`);
  console.log(`  block ${tx.blockNumber} at ${new Date(blockTime).toISOString()}, from ${tx.from} to ${tx.to ?? "(contract creation)"}`);
  print("HyperCore effect", findings);
  return findings;
};

if (!target) usage();
else {
  const findings = Address.safeParse(target).success
    ? await doctorAddress(Address.parse(target))
    : TxHash.safeParse(target).success
      ? await doctorTx(TxHash.parse(target))
      : (usage(), []);
  process.exitCode = exitCode(findings);
}
