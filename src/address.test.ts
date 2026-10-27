import { describe, expect, it } from "vitest";
import { activeElsewhere, builderEligibility, diagnoseAddress, diagnoseBuilderApproval, describeAbstraction } from "./address.ts";
import type { AddressSnapshot, BuilderSnapshot, Finding } from "./types.ts";

const healthy: AddressSnapshot = {
  network: "testnet",
  address: "0x963a323Bebea09Fe2B094D23144e7187f90514D0",
  role: { role: "user" },
  abstraction: "disabled",
  legal: { acceptedTerms: true, userAllowed: true },
  perp: { accountValue: 500, withdrawable: 500 },
  spot: { balances: [{ coin: "USDC", total: 10, hold: 0 }, { coin: "HYPE", total: 1, hold: 0 }], evmEscrows: [] },
  rateLimit: { used: 10, cap: 10_000 },
  evm: { hype: 0.5, usingBigBlocks: false },
  mainnetDeposited: true,
};

const snap = (over: Partial<AddressSnapshot>): AddressSnapshot => ({ ...healthy, ...over });
const titles = (fs: Finding[]) => fs.map((f) => f.title);
const find = (fs: Finding[], re: RegExp) => fs.find((f) => re.test(f.title));
const worst = (fs: Finding[]) =>
  (["error", "warn", "info", "ok"] as const).find((s) => fs.some((f) => f.severity === s));

describe("diagnoseAddress: a healthy account", () => {
  it("raises no warnings or errors", () => {
    const fs = diagnoseAddress(healthy);
    expect(fs.filter((f) => f.severity === "warn" || f.severity === "error")).toEqual([]);
    expect(find(fs, /HyperCore account exists/)?.severity).toBe("ok");
  });
});

describe("account existence and role", () => {
  it("errors when the address has no HyperCore account, and explains activation", () => {
    const f = find(diagnoseAddress(snap({ role: { role: "missing" }, perp: { accountValue: 0, withdrawable: 0 }, spot: { balances: [], evmEscrows: [] } })), /No HyperCore account/);
    expect(f?.severity).toBe("error");
    expect(f?.fix).toMatch(/1 USDC activation fee/);
  });

  it("warns that an agent wallet holds no funds and points at its owner", () => {
    const f = find(diagnoseAddress(snap({ role: { role: "agent", data: { user: "0xabc0000000000000000000000000000000000001" } } })), /API \(agent\) wallet/);
    expect(f?.severity).toBe("warn");
    expect(f?.fix).toContain("0xabc0000000000000000000000000000000000001");
  });

  it("notes the master of a sub-account", () => {
    const f = find(diagnoseAddress(snap({ role: { role: "subAccount", data: { master: "0xabc0000000000000000000000000000000000002" } } })), /sub-account/);
    expect(f?.severity).toBe("info");
    expect(f?.detail).toContain("0xabc0000000000000000000000000000000000002");
  });

  it("notes a vault", () => {
    expect(find(diagnoseAddress(snap({ role: { role: "vault" } })), /vault/)?.severity).toBe("info");
  });
});

describe("terms and restrictions", () => {
  it("errors when the address is not allowed", () => {
    expect(find(diagnoseAddress(snap({ legal: { acceptedTerms: true, userAllowed: false } })), /restricted/)?.severity).toBe("error");
  });
  it("notes unaccepted terms on an existing account", () => {
    expect(find(diagnoseAddress(snap({ legal: { acceptedTerms: false, userAllowed: true } })), /Terms not accepted/)?.severity).toBe("info");
  });
});

describe("EVM escrow", () => {
  it("warns about escrowed funds and blames the missing account when there is none", () => {
    const fs = diagnoseAddress(snap({ role: { role: "missing" }, spot: { balances: [], evmEscrows: [{ coin: "HYPE", total: 0.02 }] } }));
    const f = find(fs, /stuck in EVM escrow/);
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("0.02 HYPE");
    expect(f?.detail).toMatch(/no HyperCore account/);
  });
  it("still warns when the account exists, without blaming activation", () => {
    const f = find(diagnoseAddress(snap({ spot: { ...healthy.spot, evmEscrows: [{ coin: "USDC", total: 3 }] } })), /stuck in EVM escrow/);
    expect(f?.detail).not.toMatch(/no HyperCore account/);
  });
});

describe("testnet faucet eligibility", () => {
  it("warns on testnet when the address has no mainnet deposit", () => {
    const f = find(diagnoseAddress(snap({ mainnetDeposited: false })), /faucet/);
    expect(f?.severity).toBe("warn");
    expect(f?.fix).toMatch(/usdSend|send/);
  });
  it("says ok when it does", () => {
    expect(find(diagnoseAddress(snap({ mainnetDeposited: true })), /faucet/)?.severity).toBe("ok");
  });
  it("says nothing about the faucet on mainnet", () => {
    expect(find(diagnoseAddress(snap({ network: "mainnet", mainnetDeposited: null })), /faucet/)).toBeUndefined();
  });
});

describe("where the money sits", () => {
  it("warns in standard mode when USDC is on spot but perps has nothing to trade with", () => {
    const f = find(
      diagnoseAddress(snap({ perp: { accountValue: 0, withdrawable: 0 }, spot: { balances: [{ coin: "USDC", total: 50, hold: 0 }], evmEscrows: [] } })),
      /USDC is on spot/,
    );
    expect(f?.severity).toBe("warn");
    expect(f?.fix).toMatch(/perps/);
  });
  it("stays quiet in unified mode, where spot and perps share a balance", () => {
    const fs = diagnoseAddress(snap({ abstraction: "unifiedAccount", perp: { accountValue: 0, withdrawable: 0 }, spot: { balances: [{ coin: "USDC", total: 50, hold: 0 }], evmEscrows: [] } }));
    expect(find(fs, /USDC is on spot/)).toBeUndefined();
  });
  it("warns when spot has tokens but neither HYPE nor USDC to pay the Core→EVM transfer gas", () => {
    const f = find(diagnoseAddress(snap({ spot: { balances: [{ coin: "PURR", total: 100, hold: 0 }], evmEscrows: [] } })), /gas for Core→EVM/);
    expect(f?.severity).toBe("warn");
  });
});

describe("HyperEVM side", () => {
  it("notes zero HYPE for EVM gas", () => {
    expect(find(diagnoseAddress(snap({ evm: { hype: 0, usingBigBlocks: false } })), /No HYPE on HyperEVM/)?.severity).toBe("info");
  });
  it("explains the 3M small-block limit when big blocks are off", () => {
    const f = find(diagnoseAddress(healthy), /small blocks/);
    expect(f?.severity).toBe("info");
    expect(f?.detail).toMatch(/3M gas/);
    expect(f?.fix).toMatch(/evmUserModify/);
  });
  it("is ok with big blocks on", () => {
    expect(find(diagnoseAddress(snap({ evm: { hype: 1, usingBigBlocks: true } })), /big blocks/)?.severity).toBe("ok");
  });
  it("notes when the RPC could not be reached", () => {
    expect(find(diagnoseAddress(snap({ evm: null })), /HyperEVM RPC/)?.severity).toBe("info");
  });
});

describe("address rate limit", () => {
  it("errors when the address request budget is used up", () => {
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 10_000, cap: 10_000 } })), /rate limit/)?.severity).toBe("error");
  });
  it("warns above 80%", () => {
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 8_100, cap: 10_000 } })), /rate limit/)?.severity).toBe("warn");
  });
  it("is quiet below 80%", () => {
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 7_900, cap: 10_000 } })), /rate limit/)).toBeUndefined();
  });
  it("counts trading volume: 1 request per 1 USDC traded on top of the 10k buffer", () => {
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 50_000, cap: 10_000, cumVlm: 100_000 } })), /rate limit/)).toBeUndefined();
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 110_000, cap: 10_000, cumVlm: 100_000 } })), /rate limit/)?.severity).toBe("error");
  });
  it("adds any surplus to the budget", () => {
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 11_000, cap: 10_000, surplus: 5_000 } })), /rate limit/)).toBeUndefined();
  });
  it("doesn't apply the address budget to vaults (they report usage far above it)", () => {
    expect(find(diagnoseAddress(snap({ role: { role: "vault" }, rateLimit: { used: 6_791_539, cap: 10_000 } })), /rate limit/)).toBeUndefined();
  });
  it("says what being rate limited means", () => {
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 10_000, cap: 10_000 } })), /rate limit/)?.fix).toMatch(/one request every 10 seconds/);
  });
});

describe("describeAbstraction", () => {
  it.each([
    ["disabled", "Manual / Standard"],
    ["unifiedAccount", "Unified account"],
    ["portfolioMargin", "Portfolio margin"],
    ["default", "default (no mode chosen)"],
    ["dexAbstraction", "dexAbstraction"],
  ])("%s -> %s", (raw, label) => expect(describeAbstraction(raw)).toBe(label));
});

describe("builderEligibility", () => {
  it("is ok with ≥100 USDC perps value in standard mode", () => {
    expect(worst(builderEligibility({ accountValue: 100, abstraction: "disabled", role: { role: "user" } }))).toBe("ok");
  });
  it("errors below 100 USDC", () => {
    const fs = builderEligibility({ accountValue: 99.9, abstraction: "disabled", role: { role: "user" } });
    expect(find(fs, /100 USDC/)?.severity).toBe("error");
  });
  it.each(["unifiedAccount", "portfolioMargin"])("errors in %s mode", (mode) => {
    expect(find(builderEligibility({ accountValue: 500, abstraction: mode, role: { role: "user" } }), /standard mode/i)?.severity).toBe("error");
  });
  it("warns when the mode can't be confirmed", () => {
    expect(find(builderEligibility({ accountValue: 500, abstraction: "default", role: { role: "user" } }), /standard mode/i)?.severity).toBe("warn");
  });
  it("errors when the builder has no account", () => {
    expect(worst(builderEligibility({ accountValue: 0, abstraction: "default", role: { role: "missing" } }))).toBe("error");
  });
});

describe("diagnoseBuilderApproval", () => {
  const b: BuilderSnapshot = {
    user: healthy.address,
    builder: "0xbb67021fA3e62ab4DA985bb5a55c5c1884381068",
    approvedMaxFee: 10,
    builderRole: { role: "user" },
    builderAccountValue: 220,
    builderAbstraction: "disabled",
  };
  it("reports the approved cap in bps and percent", () => {
    const f = find(diagnoseBuilderApproval(b), /approved/);
    expect(f?.severity).toBe("ok");
    expect(f?.title).toContain("1 bp (0.01%)");
  });
  it("errors when the user never approved the builder, and says who must sign", () => {
    const f = find(diagnoseBuilderApproval({ ...b, approvedMaxFee: 0 }), /not approved/);
    expect(f?.severity).toBe("error");
    expect(f?.fix).toMatch(/main wallet, not an agent/);
  });
  it("includes the builder's own eligibility", () => {
    expect(titles(diagnoseBuilderApproval({ ...b, builderAbstraction: "unifiedAccount" })).join("\n")).toMatch(/standard mode/i);
  });
});

describe("edge cases that must stay quiet", () => {
  it("doesn't nag about terms when there is no account yet", () => {
    expect(find(diagnoseAddress(snap({ role: { role: "missing" }, legal: { acceptedTerms: false, userAllowed: true } })), /Terms/)).toBeUndefined();
  });
  it("ignores an escrow entry of zero", () => {
    expect(find(diagnoseAddress(snap({ spot: { ...healthy.spot, evmEscrows: [{ coin: "HYPE", total: 0 }] } })), /escrow/)).toBeUndefined();
  });
  it("says nothing about the faucet on testnet when the mainnet lookup failed", () => {
    expect(find(diagnoseAddress(snap({ mainnetDeposited: null })), /faucet/)).toBeUndefined();
  });
  it("doesn't flag spot USDC when there is none", () => {
    expect(find(diagnoseAddress(snap({ perp: { accountValue: 0, withdrawable: 0 }, spot: { balances: [{ coin: "USDC", total: 0, hold: 0 }], evmEscrows: [] } })), /USDC is on spot/)).toBeUndefined();
  });
  it("doesn't flag spot USDC when perps already has margin", () => {
    expect(find(diagnoseAddress(snap({ perp: { accountValue: 5, withdrawable: 5 }, spot: { balances: [{ coin: "USDC", total: 50, hold: 0 }], evmEscrows: [] } })), /USDC is on spot/)).toBeUndefined();
  });
  it.each([
    ["only HYPE and USDC, both empty", [{ coin: "HYPE", total: 0, hold: 0 }, { coin: "USDC", total: 0, hold: 0 }]],
    ["another token with a zero balance", [{ coin: "PURR", total: 0, hold: 0 }]],
    ["HYPE available for gas", [{ coin: "PURR", total: 5, hold: 0 }, { coin: "HYPE", total: 0.1, hold: 0 }]],
    ["USDC available for gas", [{ coin: "PURR", total: 5, hold: 0 }, { coin: "USDC", total: 1, hold: 0 }]],
  ])("no gas warning with %s", (_, balances) => {
    expect(find(diagnoseAddress(snap({ spot: { balances, evmEscrows: [] } })), /gas for Core→EVM/)).toBeUndefined();
  });
  it("doesn't mention EVM gas when there is HYPE", () => {
    expect(find(diagnoseAddress(healthy), /No HYPE on HyperEVM/)).toBeUndefined();
  });
  it("warns at exactly 80% of the request budget", () => {
    expect(find(diagnoseAddress(snap({ rateLimit: { used: 8_000, cap: 10_000 } })), /rate limit/)?.severity).toBe("warn");
  });
  it("a builder without an account gets one finding, not a pile", () => {
    expect(builderEligibility({ accountValue: 0, abstraction: "default", role: { role: "missing" } })).toHaveLength(1);
  });
});

describe("faucet check only on testnet", () => {
  it.each([true, false])("says nothing on mainnet even if mainnetDeposited=%s", (deposited) => {
    expect(find(diagnoseAddress(snap({ network: "mainnet", mainnetDeposited: deposited })), /faucet/)).toBeUndefined();
  });
});

describe("activeElsewhere: an address with no account on the chosen network", () => {
  it("warns to add --mainnet when the account is on mainnet", () => {
    expect(activeElsewhere({ network: "testnet", elsewhere: true })).toEqual([
      { severity: "warn", title: "This address is active on mainnet, not testnet", fix: "Re-run with --mainnet." },
    ]);
  });
  it("warns to drop --mainnet when the account is on testnet", () => {
    expect(activeElsewhere({ network: "mainnet", elsewhere: true })).toEqual([
      { severity: "warn", title: "This address is active on testnet, not mainnet", fix: "Re-run without --mainnet." },
    ]);
  });
  it("adds nothing when the other network has no account either", () => {
    expect(activeElsewhere({ network: "testnet", elsewhere: false })).toEqual([]);
  });
});
