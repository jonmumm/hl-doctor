# Checks

Every finding hl-doctor can print, what triggers it, and where the rule comes from. "Docs" links go to Hyperliquid's official documentation. "Observed" means the API behaves this way but the docs don't say so. "Inferred" means hl-doctor relies on a reading the docs don't confirm; the output says so when it does.

Docs base: `https://hyperliquid.gitbook.io/hyperliquid-docs/`

## Address

| Finding | Severity | Trigger | Source |
|---|---|---|---|
| No HyperCore account | error | `userRole` is `missing` | [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) |
| 1 USDC activation fee (in the fix text) | — | A transfer from another HyperCore account to a new address | Observed: `preTransferCheck` reports a fee of `1.0` |
| Active on the other network | warn | No account here, but `userRole` on the other network isn't `missing` | Info endpoint |
| API (agent) wallet / sub-account / vault | info | `userRole` is `agent`, `subAccount` or `vault`; points to the owner or master | [Nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets) |
| Address is restricted | error | `legalCheck.userAllowed` is false | Info endpoint |
| Terms not accepted | info | `legalCheck.acceptedTerms` is false | Info endpoint |
| Stuck in EVM escrow | warn | A non-zero entry in `spotClearinghouseState.evmEscrows` | [HyperCore ↔ HyperEVM transfers](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers); the field itself is observed |
| Testnet faucet won't drip | warn | Testnet only: no `deposit` in the address's mainnet ledger | [Testnet faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet) |
| USDC on spot, nothing on perps | warn | Not in unified or portfolio-margin mode (where spot and perps share a balance), spot USDC > 0, perps withdrawable = 0 | [Account abstraction modes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes) |
| No gas for Core→EVM transfers | warn | No HYPE or USDC on spot while holding other spot tokens | HyperCore ↔ HyperEVM transfers |
| No HYPE on HyperEVM | info | EVM balance is 0 | HyperCore ↔ HyperEVM transfers |
| Small blocks only / big blocks enabled | info / ok | `eth_usingBigBlocks` (small: 3M gas, big: 30M) | [Dual-block architecture](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/dual-block-architecture) |
| Address rate limit reached / above 80% | error / warn | Requests used ≥ budget, or ≥ 80% of it. Budget = max(reported cap, 10,000 + 1 per USDC traded) + surplus. Vaults are skipped. | [Rate limits and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) |
| Orders rejected in the last 24 h | warn / info | Any `historicalOrders` entry with a rejected status in the last 24 h, grouped by status | Info endpoint; explanations below |

Mode names come from `userAbstraction`. Mapping `"disabled"` to Manual / Standard is **inferred**.

## One order (`--order`)

| Finding | Severity | Trigger |
|---|---|---|
| Filled / open / triggered | ok | `orderStatus` status |
| Canceled | info | Canceled by the user |
| Canceled by HyperCore | warn | One of the cancels HyperCore makes on its own: `marginCanceled`, `reduceOnlyCanceled`, `selfTradeCanceled`, `liquidatedCanceled`, `scheduledCancel` and others (`CANCELS` in `src/orders.ts`) |
| Rejected | error | `rejected` or any status ending in `Rejected`, with its explanation (for example `minTradeNtlRejected`: below the $10 minimum notional; `tickRejected`: price not on the tick) |
| Unknown status | warn | A status hl-doctor doesn't know yet |
| No such order | warn | Wrong network, or the order was placed through an API wallet under its owner's address |

Status meanings: [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), [Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size). The full table is `REJECTIONS` and `CANCELS` in [`src/orders.ts`](../src/orders.ts).

## Builder codes (`--builder`, `--as-builder`)

| Finding | Severity | Trigger | Source |
|---|---|---|---|
| User approved builder up to N bp | ok | `maxBuilderFee` > 0, in tenths of a basis point (10 = 1 bp) | [Builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes) |
| User has not approved this builder | error | `maxBuilderFee` is 0 | Builder codes |
| Builder has no account / below 100 USDC | error | Builder perps account value < 100 USDC | Builder codes |
| Builder not in standard mode | error | Builder's mode is unified or portfolio margin | Builder codes; Account abstraction modes |
| Can't confirm standard mode | warn | The builder's mode is neither clearly standard nor a shared-balance mode (for example `default`) | Inferred |

## HyperEVM transaction

| Finding | Severity | Trigger | Source |
|---|---|---|---|
| The EVM tx reverted | error | Receipt status 0, so HyperCore never saw it | — |
| No HyperCore interaction | info | No CoreWriter log, no HYPE to `0x2222…`, no token to a `0x20…` system address | [Interacting with HyperCore](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore) |
| CoreWriter action decoded | — | `RawAction` log from `0x3333…3333`; ids 1–13 and 15–17 | Interacting with HyperCore |
| Could not be decoded | error | Unknown action id (14 isn't documented) or a malformed payload | Interacting with HyperCore |
| Order filled / rejected / canceled | ok / error / warn | The emitting contract's order for that asset, placed after the block | Interacting with HyperCore |
| No matching order | error | Nothing found after the 10-second grace period; the fix text explains 10^8 scaling and tick rules | Interacting with HyperCore; Tick and lot size |
| May still be queued | info | Less than 10 seconds since the block. The docs say CoreWriter orders land "a few seconds" later. | Interacting with HyperCore |
| Landed on HyperCore | ok | A matching ledger entry for a transfer action | — |
| Nothing landed on HyperCore | warn | No ledger entry after the grace period | — |
| Decoded, effect not verified | info | An action whose result hl-doctor can't look up (for example `tokenDelegate`) | — |
| Reached HyperCore / waiting in escrow | ok / warn | After HYPE or a token is sent to its system address, whether the sender's escrow is empty | HyperCore ↔ HyperEVM transfers |
| Sender has no HyperCore account | error | The contract or wallet that emitted the action has no account, so HyperCore ignores it | Interacting with HyperCore |
| Tx is on the other network / not a HyperEVM tx | warn / info | The hash isn't found here; the other network is checked | — |
