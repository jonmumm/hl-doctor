# hl-doctor

Explains why money or an action didn't land on Hyperliquid's HyperCore.

Give it an address or a HyperEVM transaction hash. It reads public Hyperliquid data and tells you what happened, what's wrong, and what to do next: deposits stuck in EVM escrow, CoreWriter calls that succeeded on the EVM but did nothing on HyperCore, rejected orders, accounts that don't exist yet, builder codes that can't collect fees.

```text
$ npx hl-doctor 0x963a323Bebea09Fe2B094D23144e7187f90514D0
0x963a323Bebea09Fe2B094D23144e7187f90514D0 on testnet
  perps value 0 USDC, withdrawable 0; mode default (no mode chosen)
  spot: empty; HyperEVM: 0 HYPE

Account
  FAIL No HyperCore account on testnet
       HyperCore has never seen this address: no deposit, transfer or trade.
       → An account is created by its first deposit or incoming transfer. A transfer from another HyperCore account pays a 1 USDC activation fee.
  WARN Testnet faucet won't drip: no mainnet deposit from this address
       The 1,000 mock USDC drip requires the same address to have deposited on mainnet.
       → Ask someone with testnet USDC to send it to you (usdSend), or use an address that has deposited on mainnet.
  INFO No HYPE on HyperEVM
       Any HyperEVM transaction, including moving tokens to HyperCore, needs HYPE for gas.
  INFO HyperEVM: small blocks only
       Small blocks have a 3M gas limit. Larger deploys fail with "exceeds block gas limit".
       → To deploy big contracts, send the HyperCore action {"type":"evmUserModify","usingBigBlocks":true} (the address must be a HyperCore user).
  INFO No orders rejected in the last 24 h
```

*Real output for a never-funded testnet wallet, captured 27 Oct 2026. Live results change as accounts change.*

> Independent project, not affiliated with or endorsed by Hyperliquid.

## Safety

- **Read-only.** It never asks for a private key or seed phrase, never connects a wallet, never signs anything and never sends a transaction.
- **No telemetry, no files.** It writes nothing to disk and reports to no one. Output goes to your terminal.
- **What leaves your machine:** the address, transaction hash or order id you asked about (plus a builder address with `--builder`), sent to Hyperliquid's public endpoints. Nothing else.

| Network | Hosts it may contact |
|---|---|
| testnet (default) | `api.hyperliquid-testnet.xyz`, `rpc.hyperliquid-testnet.xyz/evm` |
| `--mainnet` | `api.hyperliquid.xyz`, `rpc.hyperliquid.xyz/evm` |

It also asks the *other* network a question in three cases: on testnet, whether the address has deposited on mainnet (the faucet rule); when an address has no account, whether it has one on the other network; and when a transaction isn't found, whether it's on the other network. Explorer links in the output are printed, not fetched.

All network code is in [`src/fetch.ts`](https://github.com/jonmumm/hl-doctor/blob/main/src/fetch.ts).

## Install

Requires Node.js 22.12 or newer.

Run it without installing:

```bash
npx hl-doctor <address | tx hash>
```

```bash
pnpm dlx hl-doctor <address | tx hash>
```

Or install the command globally:

```bash
npm install -g hl-doctor
```

```bash
pnpm add -g hl-doctor
```

From source:

```bash
git clone https://github.com/jonmumm/hl-doctor.git
cd hl-doctor
pnpm install
pnpm build
node dist/cli.js --help
```

## Usage

```text
$ hl-doctor --help
Usage: hl-doctor <address | evm tx hash> [options]

Explains why money or actions didn't land on Hyperliquid's HyperCore. Read-only.

Options:
  --mainnet              check mainnet instead of testnet
  --builder <address>    also check the address's builder-code approval for <address>
  --as-builder           also check whether this address can collect builder fees
  --order <oid | cloid>  also explain one order's status (oid number or 0x cloid)
  --json                 print { target, network, sections: [{ heading, findings }] }
  -h, --help             show this help
  -v, --version          show the version
```

`--builder`, `--as-builder` and `--order` work with an address, not a transaction hash.

### Try it on real testnet activity

These are public testnet transactions and orders. Paste any of them:

| Command | What you'll see |
|---|---|
| `npx hl-doctor 0x48c46a37c230dcfde8008a9d22e6e161b7f7330756a669f976fcb85d051377fe` | A contract placed a limit order through CoreWriter, and the matching order on HyperCore filled. |
| `npx hl-doctor 0x9f4dd8a29f37049f3d1fcb73c151c99679eabdc56985ff140bb8c4064e6080c3` | HYPE sent from HyperEVM to `0x2222…` arrived on HyperCore, with nothing left in escrow. |
| `npx hl-doctor 0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1 --order 63367351019` | An API order rejected for being under the $10 minimum, and USDC sitting in spot where perps can't use it. |
| `npx hl-doctor 0xd348e5e1c6196b7d1f84d367d267dfb19ebeb1e40607cfbdfee969989788dc49` | A CoreWriter call with action id 14, which isn't in Hyperliquid's docs, reported as undecodable rather than guessed at. |

## What it checks

**An address:** whether a HyperCore account exists (and on which network), whether it's an API wallet, sub-account or vault, funds stuck in EVM escrow, the testnet faucet rule, USDC on spot that perps can't trade with, gas for HyperEVM and for Core→EVM transfers, small vs big blocks, the address's request budget, and orders rejected in the last 24 hours.

**One order** (`--order`): its status, side, size and price, and what a rejection or a HyperCore-initiated cancel means.

**A builder code** (`--builder`, `--as-builder`): whether the user approved the builder and up to what fee, and whether the builder meets the 100 USDC perps value and standard-mode requirements.

**A HyperEVM transaction:** decodes every CoreWriter action Hyperliquid documents (ids 1–13 and 15–17; id 14 is not documented) and every HYPE or token transfer to a system address, then looks for the result on HyperCore: the matching order and its status, the ledger entry, or the escrow. It catches the classic silent failure, where the contract that emitted the action has no HyperCore account of its own.

Each check, its threshold and its source are listed in [docs/checks.md](https://github.com/jonmumm/hl-doctor/blob/main/docs/checks.md). Where Hyperliquid's docs are silent, the rule is marked as inferred.

## What it can't tell you

- **A clean result means no check failed, not that your funds are safe.** It only knows the problems listed above.
- **"Not found" isn't proof of failure.** CoreWriter actions land a few seconds after the EVM block, so very recent transactions may show as "may still be queued".
- HyperCore (L1) transaction hashes get an explorer link, not a diagnosis.
- Only the default perps dex is checked; balances on HIP-3 dexes aren't shown yet.
- Arbitrum bridge deposits aren't checked yet.

## Scripts and CI

| Exit code | Meaning |
|---|---|
| 0 | No check failed |
| 1 | At least one check failed (a `FAIL` line) |
| 2 | Usage error: unknown option, malformed address or hash |
| 3 | Hyperliquid couldn't be reached or rate-limited the request. Nothing was diagnosed; stderr says why. |

`--json` prints the findings to stdout with the same exit codes:

```json
{
  "target": "0x…",
  "network": "testnet",
  "sections": [
    { "heading": "Account", "findings": [{ "severity": "error", "title": "…", "detail": "…", "fix": "…" }] }
  ]
}
```

`severity` is one of `ok`, `info`, `warn`, `error`; `detail` and `fix` are optional. Until 1.0, finding titles and wording may change between minor versions. Match on `severity`, not on text.

## Development

```bash
pnpm install
pnpm verify        # typecheck, tests, CRAP < 8, build
pnpm test:mutate   # mutation testing with Stryker
```

How it's tested, and how to record new real cases: [docs/testing.md](https://github.com/jonmumm/hl-doctor/blob/main/docs/testing.md).

Bugs and wrong diagnoses: [open an issue](https://github.com/jonmumm/hl-doctor/issues) with the command you ran and its output.

## License

[MIT](https://github.com/jonmumm/hl-doctor/blob/main/LICENSE)
