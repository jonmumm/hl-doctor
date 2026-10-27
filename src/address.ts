// Pure checks on an address snapshot. Each rule cites where its threshold comes from.
import { otherNetwork, rerunOnOther } from "./tx.ts";
import type { AddressSnapshot, BuilderSnapshot, Finding, Network, Role } from "./types.ts";

const ACTIVATION_FEE_USDC = 1; // preTransferCheck reports fee "1.0" for a transfer to a new address
const BUILDER_MIN_PERP_VALUE = 100; // builder-codes docs
const SMALL_BLOCK_GAS = "3M"; // dual-block-architecture docs: small blocks 3M gas / 1s, big blocks 30M / 1min
const STANDARD_MODES = new Set(["disabled"]); // userAbstraction value for Manual / Standard (inferred: not listed in docs)
const SHARED_BALANCE_MODES = new Set(["unifiedAccount", "portfolioMargin"]);

const fmt = (n: number) => String(Number(n.toPrecision(6)));

export const describeAbstraction = (raw: string): string =>
  ({
    disabled: "Manual / Standard",
    unifiedAccount: "Unified account",
    portfolioMargin: "Portfolio margin",
    default: "default (no mode chosen)",
  })[raw] ?? raw;

const roleFindings = (s: AddressSnapshot): Finding[] => {
  const r = s.role;
  switch (r.role) {
    case "missing":
      return [
        {
          severity: "error",
          title: `No HyperCore account on ${s.network}`,
          detail: "HyperCore has never seen this address: no deposit, transfer or trade.",
          fix: `An account is created by its first deposit or incoming transfer. A transfer from another HyperCore account pays a ${ACTIVATION_FEE_USDC} USDC activation fee.`,
        },
      ];
    case "agent":
      return [
        {
          severity: "warn",
          title: "This is an API (agent) wallet",
          detail: "Agent wallets sign orders for another account and hold no funds of their own.",
          fix: `Run the doctor on the account it trades for: ${r.data.user}`,
        },
      ];
    case "subAccount":
      return [{ severity: "info", title: "This is a sub-account", detail: `Master account: ${r.data.master}` }];
    case "vault":
      return [{ severity: "info", title: "This is a vault" }];
    case "user":
      return [{ severity: "ok", title: `HyperCore account exists on ${s.network}` }];
  }
};

const legalFindings = (s: AddressSnapshot): Finding[] => {
  if (!s.legal.userAllowed) {
    return [{ severity: "error", title: "Address is restricted", detail: "legalCheck reports userAllowed: false for this address." }];
  }
  if (!s.legal.acceptedTerms && s.role.role !== "missing") {
    return [{ severity: "info", title: `Terms not accepted in the ${s.network} web app`, detail: "The app asks once per address before it lets you trade or claim the faucet." }];
  }
  return [];
};

const escrowFindings = (s: AddressSnapshot): Finding[] =>
  s.spot.evmEscrows
    .filter((e) => e.total > 0)
    .map((e): Finding => ({
      severity: "warn",
      title: `${fmt(e.total)} ${e.coin} stuck in EVM escrow`,
      detail:
        s.role.role === "missing"
          ? "These funds were sent from HyperEVM but there is no HyperCore account to credit, so they wait in escrow."
          : "These funds were sent from HyperEVM and have not been credited to the spot balance yet.",
      fix:
        s.role.role === "missing"
          ? "Activate the HyperCore account (a deposit, or a transfer from an existing account), then check again."
          : "Escrow normally clears within seconds. If it has been minutes, open a ticket in the Hyperliquid Discord with the EVM tx hash.",
    }));

const faucetFindings = (s: AddressSnapshot): Finding[] => {
  if (s.network !== "testnet" || s.mainnetDeposited === null) return [];
  return s.mainnetDeposited
    ? [{ severity: "ok", title: "Testnet faucet: eligible (mainnet deposit found)" }]
    : [
        {
          severity: "warn",
          title: "Testnet faucet won't drip: no mainnet deposit from this address",
          detail: "The 1,000 mock USDC drip requires the same address to have deposited on mainnet.",
          fix: "Ask someone with testnet USDC to send it to you (usdSend), or use an address that has deposited on mainnet.",
        },
      ];
};

const spotCoin = (s: AddressSnapshot, coin: string) => s.spot.balances.find((b) => b.coin === coin)?.total ?? 0;

const strandedUsdcFindings = (s: AddressSnapshot): Finding[] => {
  const usdc = spotCoin(s, "USDC");
  if (SHARED_BALANCE_MODES.has(s.abstraction) || s.perp.withdrawable !== 0 || usdc <= 0) return [];
  return [
    {
      severity: "warn",
      title: `USDC is on spot (${fmt(usdc)}) but perps has nothing to trade with`,
      detail: `In ${describeAbstraction(s.abstraction)} mode spot and perps keep separate balances.`,
      fix: "Move USDC from spot to perps (usdClassTransfer, or Transfer in the web app).",
    },
  ];
};

const transferGasFindings = (s: AddressSnapshot): Finding[] => {
  // With no HYPE or USDC, any positive balance is a token that would need gas to move.
  const noGas = spotCoin(s, "HYPE") === 0 && spotCoin(s, "USDC") === 0;
  if (!noGas || !s.spot.balances.some((b) => b.total > 0)) return [];
  return [
    {
      severity: "warn",
      title: "No HYPE or USDC on spot to pay gas for Core→EVM transfers",
      detail: "Sending tokens from HyperCore to HyperEVM costs 200k gas, paid from spot HYPE or USDC.",
      fix: "Keep a little HYPE or USDC on spot before transferring.",
    },
  ];
};

const evmFindings = (s: AddressSnapshot): Finding[] => {
  if (!s.evm) return [{ severity: "info", title: "HyperEVM RPC unreachable: EVM checks skipped" }];
  const out: Finding[] = [];
  if (s.evm.hype === 0) {
    out.push({ severity: "info", title: "No HYPE on HyperEVM", detail: "Any HyperEVM transaction, including moving tokens to HyperCore, needs HYPE for gas." });
  }
  out.push(
    s.evm.usingBigBlocks
      ? { severity: "ok", title: "HyperEVM: big blocks enabled (30M gas)" }
      : {
          severity: "info",
          title: "HyperEVM: small blocks only",
          detail: `Small blocks have a ${SMALL_BLOCK_GAS} gas limit. Larger deploys fail with "exceeds block gas limit".`,
          fix: 'To deploy big contracts, send the HyperCore action {"type":"evmUserModify","usingBigBlocks":true} (the address must be a HyperCore user).',
        },
  );
  return out;
};

// Rate-limit docs: 10,000-request buffer + 1 request per 1 USDC traded since inception.
// Whether nRequestsCap already includes volume isn't documented, so take the larger reading.
const ADDRESS_REQUEST_BUFFER = 10_000;

const rateLimitFindings = (s: AddressSnapshot): Finding[] => {
  if (s.role.role === "vault") return [];
  const { used, cap, cumVlm = 0, surplus = 0 } = s.rateLimit;
  const budget = Math.max(cap, ADDRESS_REQUEST_BUFFER + Math.floor(cumVlm)) + surplus;
  const detail = `${used} of ${budget} address requests used (10,000 buffer + 1 per USDC traded).`;
  if (used >= budget) {
    return [{ severity: "error", title: "Address rate limit reached", detail, fix: "While limited, the address gets one request every 10 seconds (cancels have a higher cap). Trading volume raises the budget." }];
  }
  if (used >= budget * 0.8) return [{ severity: "warn", title: "Address rate limit above 80%", detail }];
  return [];
};

export const diagnoseAddress = (s: AddressSnapshot): Finding[] => [
  ...roleFindings(s),
  ...legalFindings(s),
  ...escrowFindings(s),
  ...faucetFindings(s),
  ...strandedUsdcFindings(s),
  ...transferGasFindings(s),
  ...evmFindings(s),
  ...rateLimitFindings(s),
];

// Mirrors txNotFound: the address has no account here, but the other network knows it.
export const activeElsewhere = (p: { network: Network; elsewhere: boolean }): Finding[] =>
  p.elsewhere ? [{ severity: "warn", title: `This address is active on ${otherNetwork(p.network)}, not ${p.network}`, fix: rerunOnOther(p.network) }] : [];

export const builderEligibility = (b: { accountValue: number; abstraction: string; role: Role }): Finding[] => {
  if (b.role.role === "missing") {
    return [{ severity: "error", title: "Builder has no HyperCore account", fix: `Deposit at least ${BUILDER_MIN_PERP_VALUE} USDC into its perps balance.` }];
  }
  const out: Finding[] = [
    b.accountValue >= BUILDER_MIN_PERP_VALUE
      ? { severity: "ok", title: `Builder perps value ${fmt(b.accountValue)} USDC (≥ ${BUILDER_MIN_PERP_VALUE} USDC)` }
      : {
          severity: "error",
          title: `Builder perps value ${fmt(b.accountValue)} USDC is below ${BUILDER_MIN_PERP_VALUE} USDC`,
          fix: "Builder codes require at least 100 USDC of perps account value. Spot balances don't count in standard mode.",
        },
  ];
  if (STANDARD_MODES.has(b.abstraction)) {
    out.push({ severity: "ok", title: "Builder is in standard mode" });
  } else if (SHARED_BALANCE_MODES.has(b.abstraction)) {
    out.push({
      severity: "error",
      title: `Builder is in ${describeAbstraction(b.abstraction)} mode, not standard mode`,
      detail: "Builder code addresses must be in Manual / Standard mode to accrue fees.",
      fix: "Switch the builder address to Manual / Standard (top right of the perps order form, or the Portfolio page).",
    });
  } else {
    out.push({
      severity: "warn",
      title: `Can't confirm standard mode (API reports "${b.abstraction}")`,
      fix: "Set Manual / Standard explicitly in the web app to be sure.",
    });
  }
  return out;
};

export const diagnoseBuilderApproval = (b: BuilderSnapshot): Finding[] => {
  // maxBuilderFee is in tenths of a basis point: 10 = 1 bp = 0.01%.
  const bps = b.approvedMaxFee / 10;
  const approval: Finding =
    b.approvedMaxFee > 0
      ? { severity: "ok", title: `User approved builder up to ${fmt(bps)} bp (${fmt(bps / 100)}%)` }
      : {
          severity: "error",
          title: "User has not approved this builder",
          detail: "Orders that carry this builder code will be rejected.",
          fix: "The user signs ApproveBuilderFee with their main wallet, not an agent/API wallet. Caps: 0.1% perps, 1% spot.",
        };
  return [approval, ...builderEligibility({ accountValue: b.builderAccountValue, abstraction: b.builderAbstraction, role: b.builderRole })];
};
