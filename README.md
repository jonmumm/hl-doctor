# hl-doctor

Explains why money or actions didn't land on Hyperliquid's HyperCore.

```bash
npx hl-doctor <address>            # account health on testnet
npx hl-doctor <evm tx hash>        # what a HyperEVM tx did (or didn't do) on HyperCore
npx hl-doctor <address> --mainnet  # same, on mainnet
```

Read-only: it only calls Hyperliquid's public info API and the public HyperEVM RPC. No private key, no wallet connection.

## What it catches

These come from the questions developers ask most in the Hyperliquid builders Discord.

**For an address**
- No HyperCore account yet (and the 1 USDC activation fee for transfers to a new address)
- API (agent) wallets and sub-accounts, pointing you at the account that actually holds funds
- Funds sent from HyperEVM stuck in EVM escrow
- Testnet faucet won't drip: no mainnet deposit from this address
- USDC sitting on spot while perps has nothing to trade with (standard mode)
- No HYPE or USDC on spot to pay for Core→EVM transfer gas
- No HYPE on HyperEVM; small blocks only (3M gas) and how to enable big blocks
- The per-address request budget (10,000 + 1 per USDC traded)

**For a builder code** (`--builder <address>`, `--as-builder`)
- Has the user approved the builder, and up to what fee
- Does the builder have ≥ 100 USDC perps value and standard account mode

**For a HyperEVM transaction**
- Decodes every CoreWriter action (all 16 documented action ids) and HYPE / token transfers to system addresses
- Finds the effect on HyperCore: the matching order and why it was rejected (`perpMarginRejected`, `tickRejected`, `minTradeNtlRejected`, …), the ledger entry for transfers, or the escrow
- Catches the classic silent no-op: the contract that emitted the action has no HyperCore account of its own

Exit code is 1 when any check fails, so it works in CI.

## Development

```bash
pnpm install
pnpm verify          # typecheck, tests, CRAP < 8, build
pnpm test:mutate     # Stryker mutation testing
```

Pure checks live in `src/{address,tx,corewriter,evmtx}.ts`; the network seam is `src/fetch.ts`. Seam tests replay recorded API responses from `src/__fixtures__/`. Re-record with `HL_RECORD=1 pnpm vitest run src/fetch.seam.test.ts`.

Not affiliated with Hyperliquid. Some rules are inferred where the docs are silent (for example, that `userAbstraction: "disabled"` means Manual / Standard mode); the output says so when it relies on one.
