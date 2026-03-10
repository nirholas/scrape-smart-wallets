/**
 * GMGN Token Activity Scraper — Paste in browser console on gmgn.ai
 *
 * Scrapes trending tokens, new pairs, and token-level smart money activity.
 * Works on both /discover and /trade/[token] pages.
 *
 * Prerequisites: 01-api-interceptor.js must be running first.
 *
 * Usage:
 *   1. Navigate to https://gmgn.ai/discover?chain=sol or https://gmgn.ai/trade/sol/[token]
 *   2. Ensure 01-api-interceptor.js is active
 *   3. Paste this script
 *   4. Run: Tokens.scrapeTrending()       — scrape trending tokens list
 *   5. Run: Tokens.scrapeNewPairs()       — scrape new token creations
 *   6. Run: Tokens.analyzeToken('addr')   — deep analysis of one token
 *   7. Run: Tokens.analyzeSmartFlow()     — find tokens smart money is buying
 *   8. Run: Tokens.dump()                 — export all results
 */

(() => {
  'use strict';

  const results = {
    trending: [],
    newPairs: [],
    tokenAnalysis: {},  // tokenAddr → { info, holders, trades, smartActivity }
    smartFlow: [],       // tokens smart money is accumulating
    meta: { chain: '', startedAt: '' },
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const humanDelay = () => sleep(rand(800, 2000));

  function getChain() {
    return new URLSearchParams(window.location.search).get('chain') ||
           window.location.pathname.match(/\/trade\/(\w+)\//)?.[1] || 'sol';
  }

  // ── Direct API fetch (uses same session cookies) ─────────────────────
  async function gmgnFetch(path) {
    try {
      const resp = await fetch(`https://gmgn.ai${path}`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      console.warn(`[Tokens] Fetch failed: ${path}`, e.message);
      return null;
    }
  }

  // ── Scrape trending tokens ───────────────────────────────────────────
  async function scrapeTrending(timeframe = '1h') {
    const chain = getChain();
    results.meta.chain = chain;
    results.meta.startedAt = new Date().toISOString();

    console.log(`[Tokens] Fetching trending tokens (${chain}, ${timeframe})...`);

    // Try multiple API patterns GMGN uses
    const paths = [
      `/defi/quotation/v1/rank/${chain}/swaps/${timeframe}?orderby=swaps&direction=desc&limit=100`,
      `/defi/quotation/v1/rank/${chain}/volume/${timeframe}?limit=100`,
      `/defi/quotation/v1/rank/${chain}/smart_buy/${timeframe}?limit=100`,
      `/api/v1/rank/${chain}/trending?timeframe=${timeframe}&limit=100`,
    ];

    const allTokens = new Map();

    for (const path of paths) {
      const json = await gmgnFetch(path);
      if (json?.data) {
        const list = json.data.rank || json.data.tokens || (Array.isArray(json.data) ? json.data : []);
        list.forEach(t => {
          const addr = t.address || t.mint || t.token_address;
          if (!addr) return;
          const existing = allTokens.get(addr) || {};
          allTokens.set(addr, {
            ...existing,
            address: addr,
            name: t.name || existing.name || '',
            symbol: t.symbol || existing.symbol || '',
            price: t.price ?? t.price_usd ?? existing.price ?? null,
            priceChange1h: t.price_change_percent ?? t.price_change_1h ?? existing.priceChange1h ?? null,
            priceChange24h: t.price_change_24h ?? existing.priceChange24h ?? null,
            marketCap: t.market_cap ?? t.mc ?? existing.marketCap ?? null,
            volume24h: t.volume ?? t.volume_24h ?? existing.volume24h ?? null,
            liquidity: t.liquidity ?? existing.liquidity ?? null,
            swaps: t.swaps ?? t.swap_count ?? existing.swaps ?? null,
            buyers: t.buys ?? t.buyer_count ?? existing.buyers ?? null,
            sellers: t.sells ?? t.seller_count ?? existing.sellers ?? null,
            holders: t.holder_count ?? existing.holders ?? null,
            smartBuys: t.smart_buy_count ?? t.smart_buys ?? existing.smartBuys ?? null,
            smartSells: t.smart_sell_count ?? t.smart_sells ?? existing.smartSells ?? null,
            createdAt: t.created_timestamp ?? t.open_timestamp ?? existing.createdAt ?? null,
            logo: t.logo ?? t.logo_url ?? existing.logo ?? null,
            _chain: chain,
          });
        });
        console.log(`[Tokens] API path returned ${list.length} tokens`);
      }
      await sleep(rand(300, 700));
    }

    // Also pull from interceptor
    (window.GMGN?.captured?.trendingTokens || []).forEach(t => {
      if (t.address && !allTokens.has(t.address)) {
        allTokens.set(t.address, { ...t, _chain: chain });
      }
    });

    results.trending = [...allTokens.values()];
    console.log(`%c[Tokens] ✅ ${results.trending.length} trending tokens`, 'color: #ffca47; font-weight: bold;');
    return results.trending;
  }

  // ── Scrape new pairs ─────────────────────────────────────────────────
  async function scrapeNewPairs() {
    const chain = getChain();
    console.log(`[Tokens] Fetching new pairs (${chain})...`);

    const paths = [
      `/defi/quotation/v1/rank/${chain}/new_creation/1h?limit=100`,
      `/api/v1/rank/${chain}/new_creation?limit=100`,
    ];

    const pairs = new Map();

    for (const path of paths) {
      const json = await gmgnFetch(path);
      if (json?.data) {
        const list = json.data.rank || json.data.tokens || (Array.isArray(json.data) ? json.data : []);
        list.forEach(t => {
          const addr = t.address || t.mint || t.token_address;
          if (addr) {
            pairs.set(addr, {
              address: addr,
              name: t.name || '',
              symbol: t.symbol || '',
              price: t.price ?? t.price_usd ?? null,
              marketCap: t.market_cap ?? t.mc ?? null,
              liquidity: t.liquidity ?? null,
              createdAt: t.created_timestamp ?? t.open_timestamp ?? null,
              creator: t.creator ?? t.deployer ?? null,
              isHoneypot: t.is_honeypot ?? null,
              isMintable: t.is_mintable ?? null,
              isRenounced: t.renounced ?? null,
              lpBurned: t.lp_burned ?? null,
              holders: t.holder_count ?? null,
              smartBuys: t.smart_buy_count ?? null,
              _chain: chain,
            });
          }
        });
      }
      await sleep(rand(300, 700));
    }

    results.newPairs = [...pairs.values()];
    console.log(`%c[Tokens] ✅ ${results.newPairs.length} new pairs`, 'color: #ffca47; font-weight: bold;');
    return results.newPairs;
  }

  // ── Deep analysis of a single token ──────────────────────────────────
  async function analyzeToken(tokenAddress) {
    const chain = getChain();
    console.log(`[Tokens] Analyzing token: ${tokenAddress.slice(0, 12)}...`);

    const analysis = { address: tokenAddress, chain, info: null, topHolders: null, trades: null, smartActivity: null };

    // Token info
    const info = await gmgnFetch(`/defi/quotation/v1/tokens/top_holders/${chain}/${tokenAddress}`);
    if (info?.data) analysis.topHolders = info.data;
    await sleep(rand(300, 600));

    // Recent trades
    const trades = await gmgnFetch(`/defi/quotation/v1/trades/${chain}/${tokenAddress}?limit=100`);
    if (trades?.data) {
      const list = trades.data.history || trades.data.trades || (Array.isArray(trades.data) ? trades.data : []);
      analysis.trades = list.map(t => ({
        txHash: t.tx_hash || t.signature || '',
        timestamp: t.timestamp ?? null,
        wallet: t.wallet_address || t.maker || '',
        side: t.event || t.side || (t.is_buy ? 'buy' : 'sell'),
        tokenAmount: t.token_amount ?? t.amount ?? null,
        usdValue: t.volume_usd ?? t.usd_value ?? null,
        price: t.price_usd ?? t.price ?? null,
        walletTags: t.wallet_tag || t.tags || [],
      }));
    }
    await sleep(rand(300, 600));

    // Smart money activity for this token
    const smart = await gmgnFetch(`/defi/quotation/v1/tokens/smart_money/${chain}/${tokenAddress}`);
    if (smart?.data) analysis.smartActivity = smart.data;
    await sleep(rand(300, 600));

    // Token security info
    const security = await gmgnFetch(`/api/v1/token_security/${chain}/${tokenAddress}`);
    if (security?.data) analysis.security = security.data;

    results.tokenAnalysis[tokenAddress] = analysis;
    console.log(`[Tokens] ✅ Analysis complete: ${tokenAddress.slice(0, 12)}...`);
    return analysis;
  }

  // ── Smart flow: find tokens being accumulated by smart money ─────────
  async function analyzeSmartFlow() {
    const chain = getChain();
    console.log('[Tokens] Analyzing smart money flow...');

    // Fetch smart money recent buys across the market
    const paths = [
      `/defi/quotation/v1/rank/${chain}/smart_buy/1h?limit=50`,
      `/defi/quotation/v1/rank/${chain}/smart_buy/6h?limit=50`,
      `/defi/quotation/v1/rank/${chain}/smart_buy/24h?limit=50`,
    ];

    const tokenMap = new Map();

    for (const path of paths) {
      const json = await gmgnFetch(path);
      if (json?.data) {
        const list = json.data.rank || json.data.tokens || (Array.isArray(json.data) ? json.data : []);
        list.forEach(t => {
          const addr = t.address || t.mint || t.token_address;
          if (!addr) return;
          const existing = tokenMap.get(addr) || { smartBuySignals: 0 };
          tokenMap.set(addr, {
            ...existing,
            address: addr,
            name: t.name || existing.name || '',
            symbol: t.symbol || existing.symbol || '',
            price: t.price ?? existing.price ?? null,
            marketCap: t.market_cap ?? t.mc ?? existing.marketCap ?? null,
            smartBuys: Math.max(t.smart_buy_count ?? 0, existing.smartBuys ?? 0),
            smartSells: Math.max(t.smart_sell_count ?? 0, existing.smartSells ?? 0),
            smartBuySignals: existing.smartBuySignals + 1, // appeared in multiple timeframes
            _chain: chain,
          });
        });
      }
      await sleep(rand(300, 700));
    }

    // Sort by number of timeframes where smart money is buying (stronger signal)
    results.smartFlow = [...tokenMap.values()]
      .sort((a, b) => {
        // First by signals across timeframes, then by smart buy count
        if (b.smartBuySignals !== a.smartBuySignals) return b.smartBuySignals - a.smartBuySignals;
        return (b.smartBuys || 0) - (a.smartBuys || 0);
      });

    console.log(`%c[Tokens] ✅ Smart flow: ${results.smartFlow.length} tokens being accumulated by smart money`, 'color: #ffca47; font-weight: bold;');
    console.table(results.smartFlow.slice(0, 20).map(t => ({
      symbol: t.symbol,
      price: t.price,
      mcap: t.marketCap,
      smartBuys: t.smartBuys,
      smartSells: t.smartSells,
      signals: t.smartBuySignals,
    })));

    return results.smartFlow;
  }

  // ── Export ────────────────────────────────────────────────────────────
  function dump(filename) {
    const chain = getChain();
    const name = filename || `gmgn-tokens-${chain}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log(`[Tokens] ✅ Exported → ${name}`);
  }

  // ── Public API ───────────────────────────────────────────────────────
  window.Tokens = {
    results,
    scrapeTrending,
    scrapeNewPairs,
    analyzeToken,
    analyzeSmartFlow,
    dump,
    status() {
      console.table({
        Chain: results.meta.chain || getChain(),
        'Trending Tokens': results.trending.length,
        'New Pairs': results.newPairs.length,
        'Token Analyses': Object.keys(results.tokenAnalysis).length,
        'Smart Flow Tokens': results.smartFlow.length,
      });
    },
    /** Quick view: top smart money accumulation targets */
    topSmart(n = 10) {
      const top = results.smartFlow.slice(0, n);
      console.table(top.map(t => ({
        symbol: t.symbol,
        name: t.name,
        address: t.address.slice(0, 12) + '...',
        price: t.price,
        marketCap: t.marketCap,
        smartBuys: t.smartBuys,
        signals: t.smartBuySignals,
      })));
      return top;
    },
  };

  console.log('%c[Token Scraper] ✅ Ready', 'color: #ffca47; font-weight: bold; font-size: 14px;');
  console.log('Commands: Tokens.scrapeTrending() | Tokens.scrapeNewPairs() | Tokens.analyzeSmartFlow() | Tokens.analyzeToken(addr) | Tokens.dump()');
})();
