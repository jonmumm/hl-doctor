# hl-doctor

Explains why money or actions didn't land on Hyperliquid's HyperCore.

```bash
npx hl-doctor <address>            # account health on testnet
npx hl-doctor <evm tx hash>        # what a HyperEVM tx did (or didn't do) on HyperCore
npx hl-doctor <address> --mainnet  # same, on mainnet
npx hl-doctor <address> --json     # { target, network, sections: [{ heading, findings }] }
npx hl-doctor --help               # all options and examples
```

Options: `--mainnet`, `--builder <address>`, `--as-builder`, `--json`, `-h/--help`, `-v/--version`. Unknown options and malformed addresses are rejected with exit code 2.

Read-only: it only calls Hyperliquid's public info API and the public HyperEVM RPC. No private key, no wallet connection.

## What it catches

These come from the questions developers ask most in the Hyperliquid builders Discord.

**For an address**
- No HyperCore account yet (and the 1 USDC activation fee for transfers to a new address), or the account is on the other network (testnet vs mainnet)
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

## Tested against real transactions

Seam tests replay recorded testnet responses for these HyperEVM txs (`src/real-cases.seam.test.ts`):

| Tx | What it did | hl-doctor says |
|---|---|---|
| `0x48c46a37c230dcfde8008a9d22e6e161b7f7330756a669f976fcb85d051377fe` | CoreWriter limit order | ok: ETH order filled |
| `0x87f4266fb14f1c6c35f4e354d2c85b573400eb5df356f83a80ae6d6e4e4f9b2f` | CoreWriter `sendAsset` of USDC | ok: landed on HyperCore (send) |
| `0x91a43912379a430ff18c7d03bd277e790cdf5694a53ca8156984bbda73c745ab` | CoreWriter `spotSend` to 0x2222… | ok: landed on HyperCore (spotTransfer) |
| `0x9f4dd8a29f37049f3d1fcb73c151c99679eabdc56985ff140bb8c4064e6080c3` | HYPE sent to 0x2222… | ok: 6.5753898 HYPE reached HyperCore |
| `0x6aa11f168c07ac290a1593136ede20ddc04f347eea94cc1ada3cf72f2cca7e48` | token 0 sent to its 0x20… system address, then `sendAsset` | ok on both |
| `0xd348e5e1c6196b7d1f84d367d267dfb19ebeb1e40607cfbdfee969989788dc49` | CoreWriter action id 14 (not in the docs) | error: could not be decoded |

Find more with `pnpm find-cases [--blocks 20000] [--mainnet]`, which scans recent blocks and lists candidate tx hashes by kind.

Exit code is 1 when any check fails, so it works in CI (`--json` keeps the same exit codes).

## Development

```bash
pnpm install
pnpm verify          # typecheck, tests, CRAP < 8, build
pnpm test:mutate     # Stryker mutation testing
```

Pure checks live in `src/{address,tx,corewriter,evmtx}.ts` and argument parsing in `src/args.ts`; the network seam is `src/fetch.ts`, and `src/main.ts` is the whole CLI as a function. Seam tests replay recorded API responses from `src/__fixtures__/`. Re-record with `HL_RECORD=1 pnpm vitest run src/fetch.seam.test.ts src/main.seam.test.ts src/real-cases.seam.test.ts` (record mode retries throttled replies, so it can take a few minutes).

Not affiliated with Hyperliquid. Some rules are inferred where the docs are silent (for example, that `userAbstraction: "disabled"` means Manual / Standard mode); the output says so when it relies on one.
