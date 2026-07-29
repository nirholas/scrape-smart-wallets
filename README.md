# GMGN.ai Scraper v4 

Browser console scripts that extract smart money wallets, KOL wallets, token rankings, radar signals, and DEX trades from [gmgn.ai](https://gmgn.ai).

All API fetch helpers include automatic retry with exponential backoff for HTTP 429 (rate limit) and 5xx (server error) responses (up to 3 attempts).

## Quick Start

1. Open **gmgn.ai** in Chrome (any page, e.g. `/trade/nichxbt?chain=sol`)
2. Open DevTools → Console
3. Paste scripts **in order**: `01.js` → `02.js` → `03-kol-wallets.js` → `04-token-activity.js` → `05-master-orchestrator.js`
4. Run:

```js
// Run everything on current chain
await Master.runAll()

// Run across all supported chains (sol, eth, bsc, base, blast, arb)
await Master.runAllChains()

// Download unified JSON + flattened wallet CSV
Master.export()
Master.exportCSV()

// View cross-scraper analytics (overlap, dedup stats)
Master.analytics()
```

## Scripts

### 01.js — API Interceptor (passive)

Hooks `fetch` and `XMLHttpRequest` to passively capture all GMGN API responses as you browse.

```js
GMGN.status()           // counts per bucket
GMGN.urls()             // all captured URLs
GMGN.wallets('smart')   // wallets from smart_degen tag
GMGN.walletTable('kol') // table of KOL wallets
GMGN.dump()             // download all captured data as JSON
GMGN.dumpCSV('smart')   // download wallet bucket as CSV
GMGN.clear()            // reset all captured data
```

Wallet buckets: `smart`, `launchpad`, `kol`, `sniper`, `fresh`, `live`, `topdev`, `followed`, `renamed`, `all`

### 02.js — Smart Money Wallets (active)

Fetches wallet rankings from all smart money tabs via direct API calls.

```js
await SmartMoney.fetchAll()           // fetch all 8 SM tabs (2 orderings each)
await SmartMoney.fetchTab('smart_degen', 'pnl_7d', 'desc')  // single tab
await SmartMoney.deepDive('ADDRESS')  // wallet detail + holdings
await SmartMoney.deepDiveTop(10)      // top 10 across all tabs
SmartMoney.report()                   // console table summary
SmartMoney.dump()                     // download JSON
SmartMoney.topWallets('smart_degen', 5)  // top 5 from a tab
```

**Tabs**: `smart_degen`, `launchpad_smart`, `fresh_wallet`, `snipe_bot`, `live`, `top_dev`, `top_followed`, `top_renamed`

**Orderby fields**: `pnl_7d`, `pnl_30d`, `pnl_1d`, `open_count`

### 03-kol-wallets.js — KOL Wallets & Twitter (active)

Fetches KOL (renowned) wallets plus Twitter KOL user data and messages.

```js
await KOL.fetchWallets()     // fetch renowned wallets (3 orderings)
await KOL.fetchTwitter()     // fetch twitter KOL users + messages
await KOL.deepDive('ADDR')  // wallet detail + holdings
await KOL.deepDiveTop(10)   // top 10 KOL wallets
KOL.dump()                   // download JSON
KOL.status()                 // summary (includes twitter messages count)
KOL.topKOL(5)               // top 5 KOL wallets
```

### 04-token-activity.js — Tokens, Radar, DEX & Follows (active)

Fetches trending tokens across multiple timeframes, 6 radar signal types, DEX trades, and followed wallet trades.

```js
await Tokens.scrapeTrending()              // all timeframes (5m/1h/6h/24h)
await Tokens.scrapeTrending('1h')          // single timeframe
await Tokens.scrapeTrending(['5m', '1h'])  // specific timeframes
await Tokens.scrapeRadar()                 // radar list + all 6 signal types
await Tokens.scrapeDexTrades()             // live DEX trades (24h window)
await Tokens.scrapeFollowTrades()          // followed wallet trades
await Tokens.analyzeToken('ADDR')          // deep dive (holders, trades, security)
Tokens.dump()                              // download JSON
Tokens.status()                            // summary
```

**Token orderby fields**: `swaps`, `volume`, `smart_buy_count`

### 05-master-orchestrator.js — Run All (v4)

Runs all scrapers in sequence with progress tracking, per-step timing, cross-scraper analytics, and multi-chain support.

#### Single Chain

```js
await Master.runAll()          // run everything on current chain
await Master.runAll('sm')      // smart money only
await Master.runAll('kol')     // KOL only
await Master.runAll('tokens')  // tokens + radar only
Master.status()                // summary table (with step timings)
Master.analytics()             // cross-scraper overlap & dedup stats
Master.export()                // download unified JSON
Master.exportCSV()             // download flattened wallet CSV
Master.reset()                 // reset combined data
```

#### Multi-Chain

```js
await Master.runAllChains()                    // all 6 chains
await Master.runAllChains(['sol', 'eth'])       // specific chains
await Master.runAllChains(['bsc'], 'sm')       // SM only on BSC
Master.multiChainStatus()                       // per-chain summary table
Master.exportMultiChain()                       // download multi-chain JSON
```

## Resilience

All active scrapers (02, 03, 04) use automatic retry with exponential backoff:

- **HTTP 429** (rate limit) or **5xx** (server error) → retry up to 3 times
- Backoff: 2s, 4s, 8s + random jitter to avoid thundering herd
- Network errors (offline, timeout) → same retry logic
- Non-retryable errors (400, 403, 404) → fail immediately with warning

## API Endpoints Used

| Category | Endpoint |
|----------|----------|
| Wallet Rankings | `/defi/quotation/v1/rank/{chain}/wallets/7d?tag={type}&orderby={field}&direction={dir}` |
| Wallet Detail | `/defi/quotation/v1/smartmoney/{chain}/walletNew/{addr}` |
| Wallet Holdings | `/pf/api/v1/wallet/{chain}/{addr}/holdings?limit=50` |
| Token Rankings | `/defi/quotation/v1/rank/{chain}/swaps/{timeframe}?orderby={field}&direction={dir}&limit=100` |
| Token Top Holders | `/defi/quotation/v1/tokens/top_holders/{chain}/{addr}` |
| Token Trades | `/defi/quotation/v1/trades/{chain}/{addr}?limit=100` |
| Token Security | `/api/v1/token_security/{chain}/{addr}` |
| Radar List | `/vas/api/v1/radar/list?chain={chain}` |
| Radar Detail | `/vas/api/v1/radar/detail?chain={chain}&period=1d&type={signal_type}` |
| Twitter KOL Users | `/vas/api/v1/twitter/user/mine?user_tags=kol&user_tags=trader` |
| Twitter Messages | `/vas/api/v1/twitter/messages?has_token=false&user_tags=kol` |
| DEX Trades | `/api/v1/dex_trades_polling?chain={chain}&window=24h` |
| Follow Trades | `/vas/api/v1/follow/follow_wallet_trade_list?chain={chain}` |

## Reference

**Radar signal types**: `gold_dog`, `smart_money`, `kol_buy`, `fresh_wallet`, `sniper`, `whale_buy`

**Token timeframes**: `5m`, `1h`, `6h`, `24h`

**Supported chains**: `sol`, `eth`, `bsc`, `base`, `blast`, `arb`

## Output

All scripts export JSON via browser download. The master orchestrator offers three export formats:

| Format | Command | Filename Pattern |
|--------|---------|-----------------|
| JSON (single chain) | `Master.export()` | `gmgn-master-sol-2025-01-15T12-30-00.json` |
| CSV (flattened wallets) | `Master.exportCSV()` | `gmgn-wallets-sol-2025-01-15T12-30-00.csv` |
| JSON (multi-chain) | `Master.exportMultiChain()` | `gmgn-multi-chain-2025-01-15T12-30-00.json` |

CSV columns: `address`, `source`, `pnl_7d`, `pnl_30d`, `winrate`, `tags`, `chain`, `has_detail`, `has_holdings`
