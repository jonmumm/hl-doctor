# hl-doctor

## Project
- CLI that explains why money or actions didn't land on Hyperliquid's HyperCore. Read-only.
- TypeScript (native compiler, TS 7), Node ≥ 22.12, pnpm, Vitest, Stryker. SDK: `@nktkas/hyperliquid`. EVM helpers: `viem`. Boundary parsing: `zod`.
- Published to npm as `hl-doctor` (bin `dist/cli.js`, built with `pnpm build`).

## Feedback commands (all must pass before committing)
1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm crap` — no function over CRAP 8
4. `pnpm build`
5. `pnpm test:mutate:incremental` — after a batch of changes; every surviving mutant is killed or the code restructured

## Knowledge base (load only when relevant)
- Hyperliquid API docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
- CoreWriter actions and encoding: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore
- SDK method types: `node_modules/@nktkas/hyperliquid/esm/api/info/_methods/*.d.ts`
- Every check, its trigger and its source: docs/checks.md
- Test layers, code map, real recorded cases: docs/testing.md

## Core principles
- Pure checks take plain snapshots and return `Finding[]`; only `src/fetch.ts` touches the network.
- Every rule cites where its threshold comes from (docs URL or an observed API response). If a rule is inferred, the finding says so.
- Tests never hit the network: unit tests use constructed snapshots; seam tests use `startReplayServer` (recorded) or `startFakeServer` (programmable).
- No `any`, no `as` casts. Parse external data with zod at the seam.

## Key conventions
- Findings: `{ severity: ok|info|warn|error, title, detail?, fix? }`. Titles are short and specific; `fix` says what to do.
- `src/__snapshots__/scenarios.test.ts.snap` pins exact wording. Update a snapshot only when the wording change is intended, and say so in the commit.
- Asset indexes differ between testnet and mainnet (testnet perp 0 is SOL). Always resolve names from `meta` on the right network.

## Keeping docs current
| If you change | Update |
|---|---|
| A check or its wording | docs/checks.md, README "What it checks", scenario snapshots |
| CLI flags or output | `src/args.ts` USAGE, then paste `--help` into README "Usage"; README sample output must match a live run |
| Which hosts are contacted, or what data is sent | README "Safety" |
| Exit codes or `--json` shape | README "Scripts and CI" |
| Test layers or real cases | docs/testing.md |
| Recorded fixtures | Re-record with `HL_RECORD=1`, never hand-edit |

## Off-limits
- README and docs never cite community chats or name people; cite Hyperliquid docs or observed API behaviour.
- Never publish to npm or change the GitHub repo's visibility. The owner does both.
- Remote: github.com/jonmumm/hl-doctor (`origin`). Push only when the owner asks.
- Never sign or send transactions, and never add private keys. This tool is read-only.
- Never modify existing tests to make new code pass; flag the behaviour change instead.

## Git
- Single branch `main`. Commit at each working milestone with a descriptive message.
- Pre-commit hook runs typecheck + tests.
