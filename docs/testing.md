# Testing

```bash
pnpm verify          # typecheck, tests, CRAP < 8 for every function, build
pnpm test:mutate     # Stryker: every mutant of the shipped code must be killed
```

The pre-commit hook runs `pnpm typecheck && pnpm test`.

## Layers

- **Scenario tests** (`src/*.test.ts`) feed the pure checks exact situations: a stuck escrow, a missing account, every order rejection, a builder that isn't approved. Snapshots in `src/__snapshots__/` pin the wording.
- **Recorded seam tests** (`src/*.seam.test.ts`) replay real Hyperliquid responses from `src/__fixtures__/` through the real HTTP and SDK code, so a change in how the API is parsed breaks a test.
- **A programmable fake** (`startFakeServer` in `src/replay-server.ts`) covers what can't be recorded on demand: a pending transaction, malformed hex, HTTP 429, an unreachable endpoint.
- **Mutation testing** (`stryker.config.json`) mutates every shipped module and fails if any change goes unnoticed.

## Code map

- Pure checks: `src/address.ts`, `src/tx.ts`, `src/orders.ts`, `src/corewriter.ts`, `src/evmtx.ts`
- Argument parsing: `src/args.ts`
- Network: `src/fetch.ts` (the only module that makes requests)
- The whole CLI as a function: `src/main.ts` (`run(argv, io, endpoints, now)`); `src/cli.ts` wires it to the process
- Failure messages: `src/failure.ts`; output: `src/render.ts`

## Real cases

`src/real-cases.seam.test.ts` replays these public testnet transactions and asserts the exact findings:

| Tx | What it did | hl-doctor says |
|---|---|---|
| `0x48c46a37c230dcfde8008a9d22e6e161b7f7330756a669f976fcb85d051377fe` | CoreWriter limit order | ok: ETH order filled |
| `0x87f4266fb14f1c6c35f4e354d2c85b573400eb5df356f83a80ae6d6e4e4f9b2f` | CoreWriter `sendAsset` of USDC | ok: landed on HyperCore (send) |
| `0x91a43912379a430ff18c7d03bd277e790cdf5694a53ca8156984bbda73c745ab` | CoreWriter `spotSend` to `0x2222…` | ok: landed on HyperCore (spotTransfer) |
| `0x9f4dd8a29f37049f3d1fcb73c151c99679eabdc56985ff140bb8c4064e6080c3` | HYPE sent to `0x2222…` | ok: 6.5753898 HYPE reached HyperCore |
| `0x6aa11f168c07ac290a1593136ede20ddc04f347eea94cc1ada3cf72f2cca7e48` | Token 0 sent to its `0x20…` system address, then `sendAsset` | ok on both |
| `0xd348e5e1c6196b7d1f84d367d267dfb19ebeb1e40607cfbdfee969989788dc49` | CoreWriter action id 14 (not documented) | error: could not be decoded |

`src/orders.seam.test.ts` replays real testnet orders: `--order 63823780855` and its cloid (ETH buy, filled), `--order 63367351019` (SOL buy rejected, `minTradeNtlRejected`), an unknown oid, and the 24-hour rejection summary on either side of that rejection.

## Finding and recording new cases

```bash
pnpm find-cases [--blocks 20000] [--mainnet]
```

This scans recent HyperEVM blocks and lists candidate transaction hashes by kind: CoreWriter actions, HYPE sent to `0x2222…`, and tokens sent to `0x20…` system addresses.

To re-record fixtures against the live APIs:

```bash
HL_RECORD=1 pnpm vitest run src/fetch.seam.test.ts src/main.seam.test.ts src/real-cases.seam.test.ts
```

Record mode retries throttled replies, so it can take a few minutes. Live accounts change, so check snapshot diffs after re-recording before you commit them.
