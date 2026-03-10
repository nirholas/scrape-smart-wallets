/**
 * GMGN API Interceptor v3 — Paste in browser console on gmgn.ai
 *
 * Hooks fetch() and XHR to passively capture ALL GMGN API responses.
 * Now correctly classifies wallet ranking endpoints vs token endpoints.
 *
 * Real API patterns discovered from live traffic:
 *   Wallet rankings: /defi/quotation/v1/rank/{chain}/wallets/{timeframe}?tag={tabType}
 *   Wallet details:  /defi/quotation/v1/smartmoney/{chain}/walletNew/{address}
 *   Holdings:        /pf/api/v1/wallet/{chain}/{address}/holdings
 *   Radar:           /vas/api/v1/radar/list + /vas/api/v1/radar/detail
 *   Twitter/KOL:     /vas/api/v1/twitter/user/mine + /vas/api/v1/twitter/messages
 *   Follow trades:   /vas/api/v1/follow/follow_wallet_trade_list
 *   DEX trades:      /api/v1/dex_trades_polling
 *   Token rankings:  /defi/quotation/v1/rank/{chain}/swaps/{timeframe}
 *
 * Usage:
 *   GMGN.status()                 — capture counts
 *   GMGN.urls()                   — list all captured URLs
 *   GMGN.inspect(N)               — inspect Nth captured response
 *   GMGN.wallets()                — show all captured wallet addresses
 *   GMGN.dump()                   — export all data as JSON
 *   GMGN.dumpCSV()                — export wallets as CSV
 *   GMGN.clear()                  — reset everything
 */

(() => {
  'use strict';

  // ── Storage ──────────────────────────────────────────────────────────
  var captured = {
    // Wallet rankings by tab type
    walletsBySmartMoney: [],    // smart_degen + pump_smart
    walletsByLaunchpad: [],     // launchpad_smart
    walletsByKOL: [],           // renowned
    walletsBySniper: [],        // snipe_bot
    walletsByFreshWallet: [],   // fresh_wallet
    walletsByLive: [],          // live
    walletsByTopDev: [],        // top_dev
    walletsByTopFollowed: [],   // top_followed
    walletsByTopRenamed: [],    // top_renamed
    walletsAll: [],             // all wallets combined (deduped)

    // Token rankings
    tokensAll: [],

    // Wallet details
    walletDetails: {},          // address -> smartmoney data
    walletHoldings: {},         // address -> holdings data

    // Radar
    radarList: [],
    radarDetail: {},

    // Twitter/KOL
    twitterUsers: [],
    twitterMessages: [],

    // Follow trades
    followTrades: [],

    // DEX trades
    dexTrades: [],
  };

  var _urls = [];
  var _responses = [];

  // ── URL Classification ───────────────────────────────────────────────
  function classifyUrl(url) {
    try {
      var u = new URL(url, 'https://gmgn.ai');
      var path = u.pathname;
      var params = u.searchParams;

      // Wallet rankings: /rank/{chain}/wallets/{timeframe}?tag={tabType}
      if (path.includes('/rank/') && path.includes('/wallets/')) {
        var tags = params.getAll('tag');
        var tagStr = tags.join(',');
        if (tagStr.includes('smart_degen') || tagStr.includes('pump_smart')) return 'walletsBySmartMoney';
        if (tagStr.includes('launchpad_smart')) return 'walletsByLaunchpad';
        if (tagStr.includes('renowned')) return 'walletsByKOL';
        if (tagStr.includes('snipe_bot')) return 'walletsBySniper';
        if (tagStr.includes('fresh_wallet')) return 'walletsByFreshWallet';
        if (tagStr.includes('live')) return 'walletsByLive';
        if (tagStr.includes('top_dev')) return 'walletsByTopDev';
        if (tagStr.includes('top_followed')) return 'walletsByTopFollowed';
        if (tagStr.includes('top_renamed')) return 'walletsByTopRenamed';
        return 'walletsAll';
      }

      // Token rankings: /rank/{chain}/swaps/ or /rank/{chain}/volume/ etc
      if (path.includes('/rank/') && (path.includes('/swaps/') || path.includes('/volume/') || path.includes('/smart_buy/') || path.includes('/new_creation/'))) {
        return 'tokensAll';
      }

      // Smartmoney wallet detail
      if (path.includes('/smartmoney/') && path.includes('/walletNew/')) return 'walletDetail';

      // Portfolio holdings
      if (path.includes('/pf/api/') && path.includes('/holdings')) return 'walletHoldings';

      // Radar
      if (path.includes('/radar/list')) return 'radarList';
      if (path.includes('/radar/detail')) return 'radarDetail';

      // Twitter
      if (path.includes('/twitter/user/')) return 'twitterUsers';
      if (path.includes('/twitter/messages')) return 'twitterMessages';

      // Follow wallet trades
      if (path.includes('/follow_wallet_trade_list') || path.includes('/follow/follow_wallet')) return 'followTrades';

      // DEX trades
      if (path.includes('/dex_trades_polling')) return 'dexTrades';

      // Multi-wallet holdings
      if (path.includes('/td/api/') && path.includes('/wallets/holding')) return 'walletHoldings';

      return null;
    } catch (e) {
      return null;
    }
  }

  // ── Data Extraction ──────────────────────────────────────────────────
  function findDataArray(json) {
    if (!json) return [];
    var d = json.data;
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.rank)) return d.rank;
    if (Array.isArray(d.wallets)) return d.wallets;
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.tokens)) return d.tokens;
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.history)) return d.history;
    if (Array.isArray(d.trades)) return d.trades;
    if (Array.isArray(d.users)) return d.users;
    if (Array.isArray(d.messages)) return d.messages;
    // Walk one level
    if (typeof d === 'object') {
      for (var key of Object.keys(d)) {
        if (Array.isArray(d[key]) && d[key].length > 0) return d[key];
      }
    }
    return [];
  }

  function extractWalletAddress(item) {
    return item.wallet_address || item.address || item.wallet || item.maker || '';
  }

  function extractAddressFromPath(url) {
    // /smartmoney/{chain}/walletNew/{address} or /pf/api/v1/wallet/{chain}/{address}/holdings
    var m = url.match(/\/walletNew\/([A-Za-z0-9]+)/) || url.match(/\/wallet\/\w+\/([A-Za-z0-9]+)\/holdings/);
    return m ? m[1] : null;
  }

  function storeData(type, json, url) {
    if (type === 'walletDetail') {
      var addr = extractAddressFromPath(url);
      if (addr && json.data) captured.walletDetails[addr] = json.data;
      return;
    }
    if (type === 'walletHoldings') {
      var addr2 = extractAddressFromPath(url);
      if (addr2 && json.data) captured.walletHoldings[addr2] = json.data;
      return;
    }
    if (type === 'radarDetail') {
      var params = new URL(url, 'https://gmgn.ai').searchParams;
      var rType = params.get('type') || 'unknown';
      captured.radarDetail[rType] = json.data;
      return;
    }

    var items = findDataArray(json);
    if (items.length === 0) return;

    if (captured[type] !== undefined && Array.isArray(captured[type])) {
      // Deduplicate by wallet_address or address
      var existing = new Set(captured[type].map(function(w) { return extractWalletAddress(w) || JSON.stringify(w); }));
      var newItems = items.filter(function(w) {
        var key = extractWalletAddress(w) || JSON.stringify(w);
        return !existing.has(key);
      });
      captured[type] = captured[type].concat(newItems);

      // Also add to walletsAll for wallet-type buckets
      if (type.startsWith('walletsBy')) {
        var allExisting = new Set(captured.walletsAll.map(function(w) { return extractWalletAddress(w); }));
        var newAll = items.filter(function(w) { return !allExisting.has(extractWalletAddress(w)); });
        captured.walletsAll = captured.walletsAll.concat(newAll);
      }
    }
  }

  // ── Response Handler ─────────────────────────────────────────────────
  function handleResponse(url, json) {
    if (!json || typeof json !== 'object') return;
    _urls.push(url);
    _responses.push({ url: url, data: json, time: new Date().toISOString() });

    var type = classifyUrl(url);
    if (!type) return;

    storeData(type, json, url);
    console.log('[GMGN] Captured ' + type + ' from: ' + url.split('?')[0].replace('https://gmgn.ai', ''));
  }

  // ── Hook fetch() ─────────────────────────────────────────────────────
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = arguments[0];
    if (typeof url === 'object' && url.url) url = url.url;
    if (typeof url !== 'string') return origFetch.apply(this, arguments);

    return origFetch.apply(this, arguments).then(function(resp) {
      if (url.includes('gmgn.ai') && !url.includes('/static/') && !url.includes('/_next/') && !url.includes('/external-res/')) {
        var ct = resp.headers.get('content-type') || '';
        if (ct.includes('json')) {
          resp.clone().json().then(function(json) {
            handleResponse(url, json);
          }).catch(function() {});
        }
      }
      return resp;
    });
  };

  // ── Hook XHR ─────────────────────────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._gmgnUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    xhr.addEventListener('load', function() {
      var url = xhr._gmgnUrl || '';
      if (url.includes('gmgn.ai') && !url.includes('/static/') && !url.includes('/_next/')) {
        try {
          var json = JSON.parse(xhr.responseText);
          handleResponse(url, json);
        } catch (e) {}
      }
    });
    return origSend.apply(this, arguments);
  };

  // ── Public API ───────────────────────────────────────────────────────
  window.GMGN = {
    captured: captured,
    _urls: _urls,
    _responses: _responses,

    status: function() {
      console.table({
        'SM Wallets (smart_degen)': captured.walletsBySmartMoney.length,
        'Launchpad SM Wallets': captured.walletsByLaunchpad.length,
        'KOL Wallets (renowned)': captured.walletsByKOL.length,
        'Sniper Wallets': captured.walletsBySniper.length,
        'Fresh Wallets': captured.walletsByFreshWallet.length,
        'Live Wallets': captured.walletsByLive.length,
        'Top Dev Wallets': captured.walletsByTopDev.length,
        'Top Followed': captured.walletsByTopFollowed.length,
        'Top Renamed': captured.walletsByTopRenamed.length,
        'All Wallets (deduped)': captured.walletsAll.length,
        'Tokens': captured.tokensAll.length,
        'Wallet Details': Object.keys(captured.walletDetails).length,
        'Wallet Holdings': Object.keys(captured.walletHoldings).length,
        'Radar Items': captured.radarList.length,
        'Twitter Users': captured.twitterUsers.length,
        'Twitter Messages': captured.twitterMessages.length,
        'Follow Trades': captured.followTrades.length,
        'DEX Trades': captured.dexTrades.length,
        'Total URLs': _urls.length,
      });
    },

    urls: function() {
      _urls.forEach(function(u, i) {
        var clean = u.replace('https://gmgn.ai', '').split('&device_id')[0];
        var type = classifyUrl(u) || '—';
        console.log(i + ' [' + type + '] ' + clean);
      });
      return _urls.length + ' URLs captured';
    },

    inspect: function(n) {
      if (n === undefined) n = 0;
      if (!_responses[n]) { console.warn('No response at index ' + n); return; }
      var r = _responses[n];
      console.log('URL: ' + r.url.split('&device_id')[0]);
      console.log('Time: ' + r.time);
      console.log('Type: ' + (classifyUrl(r.url) || 'unclassified'));
      console.log('Data:', r.data);
      var items = findDataArray(r.data);
      if (items.length > 0) {
        console.log('Items (' + items.length + '), first:');
        console.log(items[0]);
      }
      return r;
    },

    wallets: function(type) {
      var source = type ? (captured['walletsBy' + type] || captured[type] || []) : captured.walletsAll;
      var addrs = source.map(function(w) { return extractWalletAddress(w); }).filter(Boolean);
      console.log(addrs.length + ' wallet addresses:');
      addrs.forEach(function(a, i) { console.log(i + ': ' + a); });
      return addrs;
    },

    walletTable: function(type) {
      var source = type ? (captured['walletsBy' + type] || []) : captured.walletsAll;
      console.table(source.slice(0, 50).map(function(w) {
        var name = w.twitter_name || w.twitter_username || w.name || w.ens || w.tag_rank || '';
        var twitter = w.twitter_username || w.twitter_name || '';
        return {
          address: (extractWalletAddress(w) || '').slice(0, 12) + '...',
          name: name,
          twitter: twitter ? '@' + twitter : '',
          pnl_7d: w.pnl_7d ?? w.realized_profit_7d ?? '',
          pnl_30d: w.pnl_30d ?? w.realized_profit_30d ?? '',
          winrate: w.winrate ?? w.win_rate ?? '',
          tags: (w.tags || w.wallet_tag || []).toString(),
        };
      }));
    },

    // Show all field names from the first wallet object (to see what GMGN returns)
    fields: function(type) {
      var source = type ? (captured['walletsBy' + type] || []) : captured.walletsAll;
      if (source.length === 0) { console.warn('No wallets captured yet'); return []; }
      var keys = Object.keys(source[0]);
      console.log('Wallet object has ' + keys.length + ' fields:', keys.join(', '));
      console.log('Sample wallet:', source[0]);
      return keys;
    },

    dump: function(filename) {
      var payload = {
        captured: captured,
        urls: _urls,
        responses: _responses.map(function(r) {
          return { url: r.url, time: r.time, type: classifyUrl(r.url) || 'unclassified', data: r.data };
        }),
      };
      var name = filename || 'gmgn-interceptor-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      console.log('[GMGN] Exported -> ' + name + ' (' + _urls.length + ' URLs, ' + _responses.length + ' responses)');
    },

    dumpCSV: function(type) {
      var source = type ? (captured['walletsBy' + type] || []) : captured.walletsAll;
      if (source.length === 0) { console.warn('No wallets to export'); return; }
      var keys = Object.keys(source[0]);
      var csv = keys.join(',') + '\n' + source.map(function(w) {
        return keys.map(function(k) {
          var v = w[k];
          if (v === null || v === undefined) return '';
          var s = String(v);
          return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
      }).join('\n');
      var name = 'gmgn-wallets-' + (type || 'all') + '-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.csv';
      var blob = new Blob([csv], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      console.log('[GMGN] CSV exported -> ' + name + ' (' + source.length + ' rows)');
    },

    clear: function() {
      Object.keys(captured).forEach(function(k) {
        if (Array.isArray(captured[k])) captured[k] = [];
        else if (typeof captured[k] === 'object') captured[k] = {};
      });
      _urls.length = 0;
      _responses.length = 0;
      console.log('[GMGN] Cleared all data');
    },
  };

  console.log('%c[GMGN Interceptor v3] Ready — capturing API traffic', 'color: #00ff88; font-weight: bold; font-size: 14px;');
  console.log('Commands: GMGN.status() | GMGN.urls() | GMGN.inspect(N) | GMGN.wallets() | GMGN.walletTable() | GMGN.dump()');
  console.log('Wallet endpoints: /rank/{chain}/wallets/7d?tag={tabType}');
})();
