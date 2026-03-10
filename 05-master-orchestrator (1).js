/**
 * GMGN Master Orchestrator v4 — Paste in browser console on gmgn.ai
 *
 * Runs all scrapers in sequence and exports unified JSON/CSV.
 * Supports single-chain and multi-chain orchestration.
 *
 * Paste order: 01.js → 02.js → 03.js → 04.js → this file
 *
 * Usage:
 *   Master.runAll()              — run everything on current chain
 *   Master.runAll('sm')          — smart money only
 *   Master.runAll('kol')         — KOL only
 *   Master.runAll('tokens')      — tokens + radar only
 *   Master.runAllChains()        — run all on every supported chain
 *   Master.runAllChains(['sol','eth'])  — run all on specific chains
 *   Master.export()              — download unified JSON
 *   Master.exportCSV()           — download flattened wallet CSV
 *   Master.status()              — summary table
 *   Master.analytics()           — cross-scraper analysis
 */

(() => {
  'use strict';

  var VALID_MODES = { all: true, sm: true, kol: true, tokens: true };
  var SUPPORTED_CHAINS = ['sol', 'eth', 'bsc', 'base', 'blast', 'arb'];

  var combined = {
    meta: {
      startedAt: '',
      finishedAt: '',
      chain: '',
      mode: 'all',
      version: 'v4.0',
      success: false,
      durationMs: 0,
      errors: [],
      missingScripts: [],
      stepTimings: {},
    },
    interceptor: null,
    smartMoney: null,
    kol: null,
    tokens: null,
  };

  // Multi-chain aggregated results
  var multiChain = {
    chains: {},
    meta: { startedAt: '', finishedAt: '', chains: [], durationMs: 0, errors: [] },
  };

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function getChain() {
    return new URLSearchParams(window.location.search).get('chain') || 'sol';
  }

  function check(name, ref) {
    if (!ref) {
      console.warn('[Master] ' + name + ' not loaded — paste its script first.');
      combined.meta.missingScripts.push(name);
      return false;
    }
    return true;
  }

  function normalizeMode(mode) {
    if (!mode) return 'all';
    var normalized = String(mode).trim().toLowerCase();
    return VALID_MODES[normalized] ? normalized : '';
  }

  function resetCombined(chain, mode) {
    combined.meta = {
      startedAt: new Date().toISOString(),
      finishedAt: '',
      chain: chain,
      mode: mode,
      version: 'v4.0',
      success: false,
      durationMs: 0,
      errors: [],
      missingScripts: [],
      stepTimings: {},
    };
    combined.interceptor = null;
    combined.smartMoney = null;
    combined.kol = null;
    combined.tokens = null;
  }

  function markStepError(step, error) {
    var message = (error && error.message) ? error.message : String(error);
    combined.meta.errors.push({ step: step, message: message, time: new Date().toISOString() });
    console.error('[Master] ' + step + ' failed:', error);
  }

  function timeStep(name, startMs) {
    combined.meta.stepTimings[name] = {
      durationMs: Date.now() - startMs,
      durationSec: ((Date.now() - startMs) / 1000).toFixed(1),
    };
  }

  // ── Progress logger ──────────────────────────────────────────────────
  function logProgress(step, total, label) {
    var pct = Math.round((step / total) * 100);
    var bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log('[Master] ' + bar + ' ' + pct + '% — ' + label);
  }

  // ── Run All (single chain) ──────────────────────────────────────────
  async function runAll(mode) {
    var normalizedMode = normalizeMode(mode);
    if (!normalizedMode) {
      throw new Error('[Master] Invalid mode "' + mode + '". Allowed: all, sm, kol, tokens');
    }

    var chain = getChain();
    resetCombined(chain, normalizedMode);

    var runSM = normalizedMode === 'all' || normalizedMode === 'sm';
    var runKOL = normalizedMode === 'all' || normalizedMode === 'kol';
    var runTokens = normalizedMode === 'all' || normalizedMode === 'tokens';

    var totalSteps = (runSM ? 1 : 0) + (runKOL ? 1 : 0) + (runTokens ? 1 : 0) + 1;
    var currentStep = 0;

    console.log('%c[Master Orchestrator v4] Starting', 'color: #00ff88; font-weight: bold; font-size: 14px;');
    console.log('Chain: ' + chain + ' | Mode: ' + normalizedMode);

    var startedAtMs = Date.now();

    // 1. Smart Money
    if (runSM && check('SmartMoney (02.js)', window.SmartMoney)) {
      try {
        currentStep++;
        logProgress(currentStep, totalSteps, 'Smart Money wallets');
        var smStart = Date.now();
        await window.SmartMoney.fetchAll();
        await sleep(1000);
        await window.SmartMoney.deepDiveTop(5);
        combined.smartMoney = window.SmartMoney.results;
        timeStep('smartMoney', smStart);
      } catch (error) {
        markStepError('smartMoney', error);
      }
    }

    // 2. KOL
    if (runKOL && check('KOL (03.js)', window.KOL)) {
      try {
        currentStep++;
        logProgress(currentStep, totalSteps, 'KOL wallets & Twitter');
        var kolStart = Date.now();
        await window.KOL.fetchWallets();
        await sleep(500);
        await window.KOL.fetchTwitter();
        await sleep(500);
        await window.KOL.deepDiveTop(5);
        combined.kol = window.KOL.results;
        timeStep('kol', kolStart);
      } catch (error) {
        markStepError('kol', error);
      }
    }

    // 3. Tokens + Radar
    if (runTokens && check('Tokens (04.js)', window.Tokens)) {
      try {
        currentStep++;
        logProgress(currentStep, totalSteps, 'Tokens, Radar & Trades');
        var tokStart = Date.now();
        await window.Tokens.scrapeTrending();
        await sleep(500);
        await window.Tokens.scrapeRadar();
        await sleep(500);
        await window.Tokens.scrapeDexTrades();
        await sleep(500);
        await window.Tokens.scrapeFollowTrades();
        combined.tokens = window.Tokens.results;
        timeStep('tokens', tokStart);
      } catch (error) {
        markStepError('tokens', error);
      }
    }

    // 4. Pull interceptor data
    currentStep++;
    logProgress(currentStep, totalSteps, 'Collecting interceptor data');
    if (window.GMGN && window.GMGN.captured) {
      var c = window.GMGN.captured;
      combined.interceptor = {
        walletsBySmartMoney: c.walletsBySmartMoney.length,
        walletsByLaunchpad: c.walletsByLaunchpad.length,
        walletsByKOL: c.walletsByKOL.length,
        walletsBySniper: c.walletsBySniper.length,
        walletsByFreshWallet: c.walletsByFreshWallet.length,
        walletsByLive: c.walletsByLive.length,
        walletsByTopDev: c.walletsByTopDev.length,
        walletsByTopFollowed: c.walletsByTopFollowed.length,
        walletsByTopRenamed: c.walletsByTopRenamed.length,
        walletsAll: c.walletsAll.length,
        tokensAll: c.tokensAll.length,
        radarList: c.radarList.length,
        twitterUsers: c.twitterUsers.length,
        twitterMessages: c.twitterMessages.length,
        followTrades: c.followTrades.length,
        dexTrades: c.dexTrades.length,
        walletDetails: Object.keys(c.walletDetails).length,
        walletHoldings: Object.keys(c.walletHoldings).length,
        urlsCaptured: window.GMGN._urls.length,
      };
    }

    combined.meta.finishedAt = new Date().toISOString();
    combined.meta.durationMs = Date.now() - startedAtMs;
    combined.meta.success = combined.meta.errors.length === 0;
    console.log('%c[Master] ✓ Complete in ' + (combined.meta.durationMs / 1000).toFixed(1) + 's', 'color: #00ff88; font-weight: bold; font-size: 14px;');
    status();
    return combined;
  }

  // ── Run All Chains ───────────────────────────────────────────────────
  async function runAllChains(chains, mode) {
    var targetChains = chains || SUPPORTED_CHAINS;
    if (typeof targetChains === 'string') targetChains = [targetChains];

    // Validate chains
    for (var i = 0; i < targetChains.length; i++) {
      if (SUPPORTED_CHAINS.indexOf(targetChains[i]) === -1) {
        throw new Error('[Master] Unsupported chain: ' + targetChains[i] + '. Supported: ' + SUPPORTED_CHAINS.join(', '));
      }
    }

    multiChain.meta.startedAt = new Date().toISOString();
    multiChain.meta.chains = targetChains;
    multiChain.chains = {};

    var multiStart = Date.now();
    console.log('%c[Master v4] Multi-chain run: ' + targetChains.join(', '), 'color: #00ff88; font-weight: bold; font-size: 16px;');

    for (var c = 0; c < targetChains.length; c++) {
      var chain = targetChains[c];
      console.log('%c[Master] ── Chain ' + (c + 1) + '/' + targetChains.length + ': ' + chain.toUpperCase() + ' ──', 'color: #ffca47; font-weight: bold; font-size: 14px;');

      // Navigate to the chain by updating the URL param
      var url = new URL(window.location.href);
      url.searchParams.set('chain', chain);
      window.history.replaceState(null, '', url.toString());

      // Clear previous scraper results for fresh data
      if (window.SmartMoney && window.SmartMoney.results) {
        window.SmartMoney.results.wallets = {};
        window.SmartMoney.results.walletDetails = {};
        window.SmartMoney.results.walletHoldings = {};
        window.SmartMoney.results.meta = { chain: '', startedAt: '' };
      }
      if (window.KOL && window.KOL.results) {
        window.KOL.results.wallets = [];
        window.KOL.results.twitterUsers = [];
        window.KOL.results.twitterMessages = [];
        window.KOL.results.walletDetails = {};
        window.KOL.results.walletHoldings = {};
        window.KOL.results.meta = { chain: '', startedAt: '' };
      }
      if (window.Tokens && window.Tokens.results) {
        window.Tokens.results.trending = [];
        window.Tokens.results.radar = { list: [], detail: {} };
        window.Tokens.results.dexTrades = [];
        window.Tokens.results.followTrades = [];
        window.Tokens.results.tokenAnalysis = {};
        window.Tokens.results.meta = { chain: '', startedAt: '' };
      }

      try {
        await runAll(mode);
        multiChain.chains[chain] = JSON.parse(JSON.stringify(combined));
      } catch (error) {
        multiChain.meta.errors.push({ chain: chain, message: error.message || String(error) });
        console.error('[Master] Chain ' + chain + ' failed:', error);
      }

      if (c < targetChains.length - 1) {
        console.log('[Master] Cooling down before next chain...');
        await sleep(rand(2000, 4000));
      }
    }

    multiChain.meta.finishedAt = new Date().toISOString();
    multiChain.meta.durationMs = Date.now() - multiStart;
    console.log('%c[Master] ✓ Multi-chain complete in ' + (multiChain.meta.durationMs / 1000).toFixed(1) + 's (' + targetChains.length + ' chains)', 'color: #00ff88; font-weight: bold; font-size: 16px;');
    multiChainStatus();
    return multiChain;
  }

  // ── Multi-chain status ─────────────────────────────────────────────
  function multiChainStatus() {
    if (Object.keys(multiChain.chains).length === 0) {
      console.warn('[Master] No multi-chain data. Run Master.runAllChains() first.');
      return;
    }
    var table = {};
    Object.keys(multiChain.chains).forEach(function(chain) {
      var d = multiChain.chains[chain];
      var smTotal = 0;
      if (d.smartMoney) Object.values(d.smartMoney.wallets).forEach(function(a) { smTotal += a.length; });
      table[chain.toUpperCase()] = {
        'SM Wallets': smTotal,
        'KOL Wallets': d.kol ? d.kol.wallets.length : 0,
        'Trending': d.tokens ? d.tokens.trending.length : 0,
        'Radar': d.tokens ? d.tokens.radar.list.length : 0,
        'DEX Trades': d.tokens ? d.tokens.dexTrades.length : 0,
        'Duration (s)': d.meta.durationMs ? (d.meta.durationMs / 1000).toFixed(1) : '0',
        'Errors': d.meta.errors.length,
      };
    });
    console.table(table);
  }

  // ── Status (single chain) ───────────────────────────────────────────
  function status() {
    var sm = combined.smartMoney;
    var kol = combined.kol;
    var tok = combined.tokens;
    var ic = combined.interceptor || {};

    var smTotal = 0;
    if (sm) Object.values(sm.wallets).forEach(function(a) { smTotal += a.length; });

    console.table({
      'Chain': combined.meta.chain || getChain(),
      'SM Wallets': smTotal,
      'SM Details': sm ? Object.keys(sm.walletDetails).length : 0,
      'KOL Wallets': kol ? kol.wallets.length : 0,
      'KOL Twitter Users': kol ? kol.twitterUsers.length : 0,
      'KOL Twitter Msgs': kol ? (kol.twitterMessages || []).length : 0,
      'Trending Tokens': tok ? tok.trending.length : 0,
      'Radar Items': tok ? tok.radar.list.length : 0,
      'Radar Details': tok ? Object.keys(tok.radar.detail).length : 0,
      'DEX Trades': tok ? tok.dexTrades.length : 0,
      'Follow Trades': tok ? tok.followTrades.length : 0,
      'Interceptor URLs': ic.urlsCaptured || 0,
      'Interceptor Wallets': ic.walletsAll || 0,
      'Mode': combined.meta.mode || 'all',
      'Duration (s)': combined.meta.durationMs ? (combined.meta.durationMs / 1000).toFixed(1) : '0.0',
      'Errors': combined.meta.errors.length,
      'Missing Scripts': combined.meta.missingScripts.length,
    });

    // Per-step timing
    if (Object.keys(combined.meta.stepTimings).length > 0) {
      console.log('[Master] Step timings:');
      console.table(combined.meta.stepTimings);
    }

    if (combined.meta.errors.length > 0) {
      console.warn('[Master] Errors encountered:', combined.meta.errors);
    }

    if (combined.meta.missingScripts.length > 0) {
      console.warn('[Master] Missing script dependencies:', combined.meta.missingScripts);
    }
  }

  // ── Cross-scraper analytics ──────────────────────────────────────────
  function analytics() {
    var sm = combined.smartMoney;
    var kol = combined.kol;
    var tok = combined.tokens;

    // Unique wallets across SM + KOL
    var allAddrs = new Set();
    var smAddrs = new Set();
    var kolAddrs = new Set();

    if (sm) {
      Object.values(sm.wallets).forEach(function(list) {
        list.forEach(function(w) {
          var addr = w.wallet_address || w.address;
          if (addr) { allAddrs.add(addr); smAddrs.add(addr); }
        });
      });
    }
    if (kol) {
      kol.wallets.forEach(function(w) {
        var addr = w.wallet_address || w.address;
        if (addr) { allAddrs.add(addr); kolAddrs.add(addr); }
      });
    }

    // Overlap
    var overlap = 0;
    kolAddrs.forEach(function(addr) {
      if (smAddrs.has(addr)) overlap++;
    });

    // Wallets with deep dive data
    var withDetails = 0;
    var withHoldings = 0;
    if (sm) {
      withDetails += Object.keys(sm.walletDetails).length;
      withHoldings += Object.keys(sm.walletHoldings).length;
    }
    if (kol) {
      withDetails += Object.keys(kol.walletDetails).length;
      withHoldings += Object.keys(kol.walletHoldings).length;
    }

    // Token radar signal counts
    var radarSignals = {};
    if (tok && tok.radar && tok.radar.detail) {
      Object.keys(tok.radar.detail).forEach(function(type) {
        var d = tok.radar.detail[type];
        radarSignals[type] = Array.isArray(d) ? d.length : (d && d.tokens ? d.tokens.length : '?');
      });
    }

    console.log('%c[Master Analytics]', 'color: #00ccff; font-weight: bold; font-size: 14px;');
    console.table({
      'Total Unique Wallets': allAddrs.size,
      'SM-only Wallets': smAddrs.size - overlap,
      'KOL-only Wallets': kolAddrs.size - overlap,
      'SM ∩ KOL Overlap': overlap,
      'Wallets with Profile': withDetails,
      'Wallets with Holdings': withHoldings,
      'Trending Tokens': tok ? tok.trending.length : 0,
      'Token Analyses': tok ? Object.keys(tok.tokenAnalysis).length : 0,
    });

    if (Object.keys(radarSignals).length > 0) {
      console.log('[Master] Radar signal breakdown:');
      console.table(radarSignals);
    }

    return {
      uniqueWallets: allAddrs.size,
      smOnly: smAddrs.size - overlap,
      kolOnly: kolAddrs.size - overlap,
      overlap: overlap,
      withDetails: withDetails,
      withHoldings: withHoldings,
      radarSignals: radarSignals,
    };
  }

  // ── Export JSON ──────────────────────────────────────────────────────
  function exportAll(filename) {
    var chain = getChain();
    var payload = JSON.parse(JSON.stringify(combined));

    // Attach raw interceptor wallets + URLs
    if (window.GMGN && window.GMGN.captured) {
      var cap = window.GMGN.captured;
      payload.interceptorRaw = {
        walletsAll: cap.walletsAll,
        walletsBySmartMoney: cap.walletsBySmartMoney,
        walletsByLaunchpad: cap.walletsByLaunchpad,
        walletsByKOL: cap.walletsByKOL,
        walletsBySniper: cap.walletsBySniper,
        walletsByFreshWallet: cap.walletsByFreshWallet,
        walletsByLive: cap.walletsByLive,
        walletsByTopDev: cap.walletsByTopDev,
        walletsByTopFollowed: cap.walletsByTopFollowed,
        walletsByTopRenamed: cap.walletsByTopRenamed,
        tokensAll: cap.tokensAll,
        radarList: cap.radarList,
        radarDetail: cap.radarDetail,
        twitterUsers: cap.twitterUsers,
        twitterMessages: cap.twitterMessages,
        followTrades: cap.followTrades,
        dexTrades: cap.dexTrades,
        walletDetails: cap.walletDetails,
        walletHoldings: cap.walletHoldings,
      };
      payload.urls = window.GMGN._urls;
      payload.responses = window.GMGN._responses.map(function(r) {
        return { url: r.url, time: r.time, data: r.data };
      });
    }

    payload.meta.exportedAt = new Date().toISOString();

    var name = filename || 'gmgn-master-' + chain + '-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log('[Master] JSON exported -> ' + name);
  }

  // ── Export multi-chain JSON ──────────────────────────────────────────
  function exportMultiChain(filename) {
    if (Object.keys(multiChain.chains).length === 0) {
      console.warn('[Master] No multi-chain data. Run Master.runAllChains() first.');
      return;
    }
    var payload = JSON.parse(JSON.stringify(multiChain));
    payload.meta.exportedAt = new Date().toISOString();

    var name = filename || 'gmgn-multi-chain-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log('[Master] Multi-chain JSON exported -> ' + name);
  }

  // ── Export CSV (flattened wallets) ───────────────────────────────────
  function exportCSV(filename) {
    var sm = combined.smartMoney;
    var kol = combined.kol;
    var chain = combined.meta.chain || getChain();

    // Collect all unique wallets with source tags
    var walletMap = new Map();

    if (sm) {
      Object.keys(sm.wallets).forEach(function(tag) {
        sm.wallets[tag].forEach(function(w) {
          var addr = w.wallet_address || w.address;
          if (!addr) return;
          if (!walletMap.has(addr)) {
            walletMap.set(addr, {
              address: addr,
              source: tag,
              pnl_7d: w.pnl_7d || w.realized_profit_7d || '',
              pnl_30d: w.pnl_30d || w.realized_profit_30d || '',
              winrate: w.winrate || w.win_rate || '',
              tags: (w.tags || w.wallet_tag || []).toString(),
              chain: chain,
              has_detail: sm.walletDetails[addr] ? 'yes' : 'no',
              has_holdings: sm.walletHoldings[addr] ? 'yes' : 'no',
            });
          }
        });
      });
    }

    if (kol) {
      kol.wallets.forEach(function(w) {
        var addr = w.wallet_address || w.address;
        if (!addr) return;
        if (walletMap.has(addr)) {
          var existing = walletMap.get(addr);
          existing.source += ',kol';
        } else {
          walletMap.set(addr, {
            address: addr,
            source: 'kol',
            pnl_7d: w.pnl_7d || w.realized_profit_7d || '',
            pnl_30d: w.pnl_30d || w.realized_profit_30d || '',
            winrate: w.winrate || w.win_rate || '',
            tags: (w.tags || w.wallet_tag || []).toString(),
            chain: chain,
            has_detail: (kol.walletDetails[addr]) ? 'yes' : 'no',
            has_holdings: (kol.walletHoldings[addr]) ? 'yes' : 'no',
          });
        }
      });
    }

    var rows = Array.from(walletMap.values());
    if (rows.length === 0) {
      console.warn('[Master] No wallet data to export as CSV.');
      return;
    }

    var keys = Object.keys(rows[0]);
    var csv = keys.join(',') + '\n' + rows.map(function(row) {
      return keys.map(function(k) {
        var v = row[k];
        if (v === null || v === undefined) return '';
        var s = String(v);
        return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');

    var name = filename || 'gmgn-wallets-' + chain + '-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.csv';
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log('[Master] CSV exported -> ' + name + ' (' + rows.length + ' wallets)');
  }

  // ── Public API ───────────────────────────────────────────────────────
  window.Master = {
    combined: combined,
    multiChain: multiChain,
    runAll: runAll,
    runAllChains: runAllChains,
    status: status,
    multiChainStatus: multiChainStatus,
    analytics: analytics,
    export: exportAll,
    exportMultiChain: exportMultiChain,
    exportCSV: exportCSV,
    reset: function() { resetCombined(getChain(), 'all'); return combined; },
    chains: SUPPORTED_CHAINS,
  };

  console.log('%c[Master Orchestrator v4] Ready', 'color: #00ff88; font-weight: bold; font-size: 14px;');
  console.log('Commands: Master.runAll() | Master.runAllChains() | Master.status() | Master.analytics()');
  console.log('Export:   Master.export() | Master.exportCSV() | Master.exportMultiChain()');
  console.log('Chains:   ' + SUPPORTED_CHAINS.join(', '));
})();
