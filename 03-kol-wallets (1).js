/**
 * GMGN KOL Wallet Scraper v3 — Paste in browser console on gmgn.ai
 *
 * Fetches KOL wallets from:
 *   /defi/quotation/v1/rank/{chain}/wallets/7d?tag=renowned   (KOL wallet rankings)
 *   /vas/api/v1/twitter/user/mine?user_tags=kol&...           (Twitter KOL users)
 *
 * Then deep-dives each wallet via:
 *   /defi/quotation/v1/smartmoney/{chain}/walletNew/{address}
 *   /pf/api/v1/wallet/{chain}/{address}/holdings
 *
 * Prerequisites: Paste 01.js (interceptor) first (optional but recommended).
 *
 * Usage:
 *   KOL.fetchWallets()         — fetch KOL wallet rankings
 *   KOL.fetchTwitter()         — fetch KOL twitter users
 *   KOL.deepDive('addr')       — deep dive one wallet
 *   KOL.deepDiveTop(10)        — deep dive top N
 *   KOL.dump()                 — export JSON
 *   KOL.status()               — summary
 */

(() => {
  'use strict';

  var results = {
    wallets: [],
    twitterUsers: [],
    twitterMessages: [],
    walletDetails: {},
    walletHoldings: {},
    meta: { chain: '', startedAt: '' },
  };

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function getChain() {
    return new URLSearchParams(window.location.search).get('chain') || 'sol';
  }

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
          console.warn('[KOL] HTTP ' + resp.status + ' — retrying in ' + (delay / 1000).toFixed(1) + 's (attempt ' + attempt + '/' + retries + ')');
          await sleep(delay);
          continue;
        }
        if (!resp.ok) return null;
        return await resp.json();
      } catch (e) {
        if (attempt < retries) {
          var backoff = Math.pow(2, attempt) * 1000;
          console.warn('[KOL] Fetch error — retrying in ' + (backoff / 1000).toFixed(1) + 's', e.message);
          await sleep(backoff);
        } else {
          console.warn('[KOL] Fetch failed after ' + retries + ' attempts: ' + path.split('?')[0], e.message);
          return null;
        }
      }
    }
    return null;
  }

  function extractList(json) {
    if (!json || !json.data) return [];
    var d = json.data;
    if (Array.isArray(d.rank)) return d.rank;
    if (Array.isArray(d.wallets)) return d.wallets;
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.users)) return d.users;
    if (Array.isArray(d)) return d;
    if (typeof d === 'object') {
      for (var key of Object.keys(d)) {
        if (Array.isArray(d[key]) && d[key].length > 0) return d[key];
      }
    }
    return [];
  }

  // ── Fetch KOL wallet rankings ────────────────────────────────────────
  async function fetchWallets() {
    var chain = getChain();
    results.meta.chain = chain;
    results.meta.startedAt = new Date().toISOString();

    console.log('%c[KOL v3] Fetching KOL wallet rankings...', 'color: #a855f7; font-weight: bold;');

    var orderbys = ['pnl_7d', 'pnl_30d', 'pnl_1d'];
    var existing = new Set();

    for (var i = 0; i < orderbys.length; i++) {
      var path = '/defi/quotation/v1/rank/' + chain + '/wallets/7d?tag=renowned&orderby=' + orderbys[i] + '&direction=desc';
      var json = await gmgnFetch(path);
      if (json) {
        var wallets = extractList(json);
        wallets.forEach(function(w) {
          var addr = w.wallet_address || w.address;
          if (addr && !existing.has(addr)) {
            results.wallets.push(w);
            existing.add(addr);
          }
        });
        console.log('[KOL] ' + wallets.length + ' wallets from ' + orderbys[i]);
      }
      await sleep(rand(400, 800));
    }

    // Feed interceptor
    if (window.GMGN && window.GMGN.captured && window.GMGN.captured.walletsByKOL) {
      var intExisting = new Set(window.GMGN.captured.walletsByKOL.map(function(w) { return w.wallet_address || w.address; }));
      results.wallets.forEach(function(w) {
        var addr = w.wallet_address || w.address;
        if (!intExisting.has(addr)) {
          window.GMGN.captured.walletsByKOL.push(w);
        }
      });
    }

    console.log('%c[KOL] ' + results.wallets.length + ' unique KOL wallets', 'color: #a855f7; font-weight: bold;');
    return results.wallets;
  }

  // ── Fetch Twitter KOL users ──────────────────────────────────────────
  async function fetchTwitter() {
    console.log('[KOL] Fetching Twitter KOL users...');

    var tags = ['kol', 'trader', 'master', 'founder', 'celebrity'];
    var tagParams = tags.map(function(t) { return 'user_tags=' + t; }).join('&');
    var path = '/vas/api/v1/twitter/user/mine?' + tagParams + '&limit=50';

    var json = await gmgnFetch(path);
    if (json) {
      results.twitterUsers = extractList(json);
      console.log('[KOL] ' + results.twitterUsers.length + ' Twitter KOL users');
    }

    // Also fetch twitter messages
    await sleep(rand(300, 600));
    var msgPath = '/vas/api/v1/twitter/messages?has_token=false&' + tagParams + '&tw_types=tweet&tw_types=reply&tw_types=description&tw_types=follow&mine=1&limit=50';
    var msgJson = await gmgnFetch(msgPath);
    if (msgJson) {
      results.twitterMessages = extractList(msgJson);
      console.log('[KOL] ' + results.twitterMessages.length + ' Twitter messages');
    }

    return results.twitterUsers;
  }

  // ── Deep dive a single wallet ────────────────────────────────────────
  async function deepDive(address) {
    var chain = getChain();
    console.log('[KOL] Deep-diving: ' + address.slice(0, 12) + '...');

    var profile = await gmgnFetch('/defi/quotation/v1/smartmoney/' + chain + '/walletNew/' + address);
    if (profile && profile.data) {
      results.walletDetails[address] = profile.data;
    }
    await sleep(rand(300, 600));

    var holdings = await gmgnFetch('/pf/api/v1/wallet/' + chain + '/' + address + '/holdings?limit=50&order_by=last_active_timestamp&direction=desc&hide_small=false&sellout=true&hide_abnormal=false');
    if (holdings && holdings.data) {
      results.walletHoldings[address] = holdings.data;
    }

    return { profile: results.walletDetails[address], holdings: results.walletHoldings[address] };
  }

  // ── Deep dive top N wallets ──────────────────────────────────────────
  async function deepDiveTop(n) {
    n = n || 5;
    var addrs = results.wallets
      .map(function(w) { return w.wallet_address || w.address; })
      .filter(Boolean)
      .slice(0, n);

    console.log('[KOL] Deep-diving top ' + addrs.length + ' wallets...');
    for (var i = 0; i < addrs.length; i++) {
      await deepDive(addrs[i]);
      await sleep(rand(500, 1000));
    }
    console.log('%c[KOL] Deep-dived ' + addrs.length + ' wallets', 'color: #a855f7; font-weight: bold;');
  }

  // ── Export ────────────────────────────────────────────────────────────
  function dump(filename) {
    var chain = getChain();
    var name = filename || 'gmgn-kol-wallets-' + chain + '-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
    var blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log('[KOL] Exported -> ' + name);
  }

  // ── Public API ───────────────────────────────────────────────────────
  window.KOL = {
    results: results,
    fetchWallets: fetchWallets,
    fetchTwitter: fetchTwitter,
    deepDive: deepDive,
    deepDiveTop: deepDiveTop,
    dump: dump,
    status: function() {
      console.table({
        Chain: results.meta.chain || getChain(),
        'KOL Wallets': results.wallets.length,
        'Twitter Users': results.twitterUsers.length,
        'Twitter Messages': results.twitterMessages.length,
        'Wallet Details': Object.keys(results.walletDetails).length,
        'Wallet Holdings': Object.keys(results.walletHoldings).length,
      });
    },
    topKOL: function(n) {
      n = n || 10;
      console.table(results.wallets.slice(0, n).map(function(w) {
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

  console.log('%c[KOL Scraper v3] Ready', 'color: #a855f7; font-weight: bold; font-size: 14px;');
  console.log('Commands: KOL.fetchWallets() | KOL.fetchTwitter() | KOL.deepDiveTop(10) | KOL.dump()');
  console.log('API: /defi/quotation/v1/rank/{chain}/wallets/7d?tag=renowned');
})();
