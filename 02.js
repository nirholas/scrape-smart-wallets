/**
 * GMGN Smart Money Wallet Scraper v3 — Paste in browser console on gmgn.ai
 *
 * Fetches wallet rankings from the REAL wallet ranking API:
 *   /defi/quotation/v1/rank/{chain}/wallets/7d?tag={tabType}&orderby={field}&direction={dir}
 *
 * Then deep-dives each wallet via:
 *   /defi/quotation/v1/smartmoney/{chain}/walletNew/{address}
 *   /pf/api/v1/wallet/{chain}/{address}/holdings
 *
 * Prerequisites: Paste 01.js (interceptor) first (optional but recommended).
 *
 * Usage:
 *   SmartMoney.fetchAll()          — fetch all SM wallet tabs
 *   SmartMoney.fetchTab('smart_degen')  — fetch one specific tab
 *   SmartMoney.deepDive('addr')    — deep dive a single wallet
 *   SmartMoney.deepDiveTop(10)     — deep dive top N wallets
 *   SmartMoney.report()            — show summary
 *   SmartMoney.dump()              — export as JSON
 */

(() => {
  'use strict';

  var results = {
    wallets: {},            // tag -> wallet[]
    walletDetails: {},      // address -> detail
    walletHoldings: {},     // address -> holdings
    meta: { chain: '', startedAt: '' },
  };

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function getChain() {
    return new URLSearchParams(window.location.search).get('chain') || 'sol';
  }

  // ── Direct API fetch with retry ──────────────────────────────────
  async function gmgnFetch(path, retries) {
    retries = retries || 3;
    for (var attempt = 1; attempt <= retries; attempt++) {
      try {
        var resp = await fetch('https://gmgn.ai' + path, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        if (resp.status === 429 || resp.status >= 500) {
          var delay = Math.pow(2, attempt) * 1000 + rand(0, 500);
          console.warn('[SM] HTTP ' + resp.status + ' — retrying in ' + (delay / 1000).toFixed(1) + 's (attempt ' + attempt + '/' + retries + ')');
          await sleep(delay);
          continue;
        }
        if (!resp.ok) { console.warn('[SM] HTTP ' + resp.status + ': ' + path.split('?')[0]); return null; }
        return await resp.json();
      } catch (e) {
        if (attempt < retries) {
          var backoff = Math.pow(2, attempt) * 1000;
          console.warn('[SM] Fetch error — retrying in ' + (backoff / 1000).toFixed(1) + 's', e.message);
          await sleep(backoff);
        } else {
          console.warn('[SM] Fetch failed after ' + retries + ' attempts: ' + path.split('?')[0], e.message);
          return null;
        }
      }
    }
    return null;
  }

  function extractWallets(json) {
    if (!json || !json.data) return [];
    var d = json.data;
    if (Array.isArray(d.rank)) return d.rank;
    if (Array.isArray(d.wallets)) return d.wallets;
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d)) return d;
    if (typeof d === 'object') {
      for (var key of Object.keys(d)) {
        if (Array.isArray(d[key]) && d[key].length > 0) return d[key];
      }
    }
    return [];
  }

  // ── Tab configs ──────────────────────────────────────────────────────
  var SM_TABS = [
    { tag: 'smart_degen', label: 'Smart Money', extraTags: ['pump_smart'] },
    { tag: 'launchpad_smart', label: 'Launchpad SM' },
    { tag: 'fresh_wallet', label: 'Fresh Wallet' },
    { tag: 'snipe_bot', label: 'Sniper' },
    { tag: 'live', label: 'LIVE' },
    { tag: 'top_dev', label: 'Top Dev' },
    { tag: 'top_followed', label: 'Top Followed' },
    { tag: 'top_renamed', label: 'Top Renamed' },
  ];

  var ORDER_FIELDS = ['pnl_7d', 'pnl_30d', 'pnl_1d', 'open_count'];

  // ── Fetch wallet ranking for one tab ─────────────────────────────────
  async function fetchTab(tag, orderby, direction) {
    var chain = getChain();
    orderby = orderby || 'pnl_7d';
    direction = direction || 'desc';

    var tagParam = 'tag=' + tag;
    var tabConfig = SM_TABS.find(function(t) { return t.tag === tag; });
    if (tabConfig && tabConfig.extraTags) {
      tabConfig.extraTags.forEach(function(t) { tagParam += '&tag=' + t; });
    }

    var path = '/defi/quotation/v1/rank/' + chain + '/wallets/7d?' + tagParam + '&orderby=' + orderby + '&direction=' + direction;
    console.log('[SM] Fetching ' + tag + ' (' + orderby + ' ' + direction + ')...');

    var json = await gmgnFetch(path);
    if (!json) return [];

    var wallets = extractWallets(json);
    console.log('[SM] Got ' + wallets.length + ' wallets for ' + tag);

    if (!results.wallets[tag]) results.wallets[tag] = [];
    var existing = new Set(results.wallets[tag].map(function(w) { return w.wallet_address || w.address; }));
    wallets.forEach(function(w) {
      var addr = w.wallet_address || w.address;
      if (addr && !existing.has(addr)) {
        results.wallets[tag].push(w);
        existing.add(addr);
      }
    });

    // Also feed interceptor if loaded
    if (window.GMGN && window.GMGN.captured) {
      var bucket = tag === 'smart_degen' ? 'walletsBySmartMoney' :
                   tag === 'launchpad_smart' ? 'walletsByLaunchpad' :
                   tag === 'renowned' ? 'walletsByKOL' :
                   tag === 'snipe_bot' ? 'walletsBySniper' :
                   tag === 'fresh_wallet' ? 'walletsByFreshWallet' :
                   tag === 'live' ? 'walletsByLive' :
                   tag === 'top_dev' ? 'walletsByTopDev' :
                   tag === 'top_followed' ? 'walletsByTopFollowed' :
                   tag === 'top_renamed' ? 'walletsByTopRenamed' : null;
      if (bucket && window.GMGN.captured[bucket]) {
        var allExist = new Set(window.GMGN.captured[bucket].map(function(w) { return w.wallet_address || w.address; }));
        wallets.forEach(function(w) {
          if (!allExist.has(w.wallet_address || w.address)) {
            window.GMGN.captured[bucket].push(w);
            allExist.add(w.wallet_address || w.address);
          }
        });
      }
    }

    return wallets;
  }

  // ── Fetch all SM tabs ────────────────────────────────────────────────
  async function fetchAll() {
    var chain = getChain();
    results.meta.chain = chain;
    results.meta.startedAt = new Date().toISOString();

    console.log('%c[Smart Money v3] Fetching all wallet tabs...', 'color: #ff6b35; font-weight: bold;');

    for (var i = 0; i < SM_TABS.length; i++) {
      var tab = SM_TABS[i];
      // Fetch with best orderby
      await fetchTab(tab.tag, 'pnl_7d', 'desc');
      await sleep(rand(400, 800));
      // Also fetch by PnL 30d to get different wallets
      await fetchTab(tab.tag, 'pnl_30d', 'desc');
      await sleep(rand(400, 800));
    }

    var total = 0;
    Object.keys(results.wallets).forEach(function(tag) { total += results.wallets[tag].length; });
    console.log('%c[SM] Done! ' + total + ' unique wallets across ' + Object.keys(results.wallets).length + ' tabs', 'color: #ff6b35; font-weight: bold;');
    return results;
  }

  // ── Deep dive a single wallet ────────────────────────────────────────
  async function deepDive(address) {
    var chain = getChain();
    console.log('[SM] Deep-diving: ' + address.slice(0, 12) + '...');

    // 1. Smartmoney wallet profile
    var profile = await gmgnFetch('/defi/quotation/v1/smartmoney/' + chain + '/walletNew/' + address);
    if (profile && profile.data) {
      results.walletDetails[address] = profile.data;
    }
    await sleep(rand(300, 600));

    // 2. Portfolio holdings
    var holdings = await gmgnFetch('/pf/api/v1/wallet/' + chain + '/' + address + '/holdings?limit=50&order_by=last_active_timestamp&direction=desc&hide_small=false&sellout=true&hide_abnormal=false');
    if (holdings && holdings.data) {
      results.walletHoldings[address] = holdings.data;
    }

    console.log('[SM] Deep-dive complete: ' + address.slice(0, 12) + '...');
    return { profile: results.walletDetails[address], holdings: results.walletHoldings[address] };
  }

  // ── Deep dive top N wallets ──────────────────────────────────────────
  async function deepDiveTop(n) {
    n = n || 5;
    // Collect unique addresses across all tabs
    var allAddrs = new Set();
    Object.values(results.wallets).forEach(function(list) {
      list.forEach(function(w) {
        var addr = w.wallet_address || w.address;
        if (addr) allAddrs.add(addr);
      });
    });

    var addrs = Array.from(allAddrs).slice(0, n);
    console.log('[SM] Deep-diving top ' + addrs.length + ' wallets...');

    for (var i = 0; i < addrs.length; i++) {
      await deepDive(addrs[i]);
      await sleep(rand(500, 1000));
    }

    console.log('%c[SM] Deep-dived ' + addrs.length + ' wallets', 'color: #ff6b35; font-weight: bold;');
  }

  // ── Report ───────────────────────────────────────────────────────────
  function report() {
    var stats = { chain: results.meta.chain || getChain() };
    Object.keys(results.wallets).forEach(function(tag) {
      stats[tag] = results.wallets[tag].length;
    });
    stats['wallet details'] = Object.keys(results.walletDetails).length;
    stats['wallet holdings'] = Object.keys(results.walletHoldings).length;
    console.table(stats);
    return stats;
  }

  // ── Dump ─────────────────────────────────────────────────────────────
  function dump(filename) {
    var chain = getChain();
    var name = filename || 'gmgn-smart-money-' + chain + '-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
    var blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log('[SM] Exported -> ' + name);
  }

  // ── Public API ───────────────────────────────────────────────────────
  window.SmartMoney = {
    results: results,
    fetchAll: fetchAll,
    fetchTab: fetchTab,
    deepDive: deepDive,
    deepDiveTop: deepDiveTop,
    report: report,
    dump: dump,
    topWallets: function(tag, n) {
      n = n || 10;
      var list = tag ? (results.wallets[tag] || []) : Object.values(results.wallets).flat();
      console.table(list.slice(0, n).map(function(w) {
        return {
          address: (w.wallet_address || w.address || '').slice(0, 16) + '...',
          pnl_7d: w.pnl_7d ?? w.realized_profit_7d ?? '',
          pnl_30d: w.pnl_30d ?? w.realized_profit_30d ?? '',
          winrate: w.winrate ?? w.win_rate ?? '',
          tags: (w.tags || w.wallet_tag || []).toString(),
        };
      }));
    },
  };

  console.log('%c[Smart Money Scraper v3] Ready', 'color: #ff6b35; font-weight: bold; font-size: 14px;');
  console.log('Commands: SmartMoney.fetchAll() | SmartMoney.fetchTab("smart_degen") | SmartMoney.deepDiveTop(10) | SmartMoney.dump()');
  console.log('API: /defi/quotation/v1/rank/{chain}/wallets/7d?tag={tabType}');
})();
