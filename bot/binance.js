'use strict';

const axios = require('axios');

const COINGECKO    = 'https://api.coingecko.com/api/v3';
const KRAKEN_BASE  = 'https://api.kraken.com/0/public';

// ── Cache + deduplication ─────────────────────────────────────────────────────
const cache    = {};
const inflight = {};

function cacheGet(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete cache[key]; return null; }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  cache[key] = { data, expiresAt: Date.now() + ttlMs };
}

async function dedupe(key, fn) {
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  if (inflight[key]) return inflight[key];
  inflight[key] = fn().finally(() => { delete inflight[key]; });
  return inflight[key];
}

async function apiGet(url, params) {
  try {
    return await axios.get(url, { params });
  } catch (err) {
    if (err.response && err.response.status === 429) {
      await new Promise(r => setTimeout(r, 15000));
      return axios.get(url, { params });
    }
    throw err;
  }
}

// ── Kraken maps ───────────────────────────────────────────────────────────────
// pair = what we send to Kraken, responseKey = what Kraken sends back
const KRAKEN = {
  BTCUSDT:  { pair: 'XBTUSD',  responseKey: 'XXBTZUSD' },
  ETHUSDT:  { pair: 'ETHUSD',  responseKey: 'XETHZUSD' },
  SOLUSDT:  { pair: 'SOLUSD',  responseKey: 'SOLUSD'   },
  XRPUSDT:  { pair: 'XRPUSD',  responseKey: 'XXRPZUSD' },
  ADAUSDT:  { pair: 'ADAUSD',  responseKey: 'ADAUSD'   },
  DOGEUSDT: { pair: 'DOGEUSD', responseKey: 'XDGEZUSD' },
  LTCUSDT:  { pair: 'LTCUSD',  responseKey: 'XLTCZUSD' }
};

// CoinGecko map — fallback for coins not on Kraken (BNB)
const CG_MAP = {
  BTCUSDT:   'bitcoin',
  ETHUSDT:   'ethereum',
  BNBUSDT:   'binancecoin',
  SOLUSDT:   'solana',
  XRPUSDT:   'ripple',
  ADAUSDT:   'cardano',
  DOGEUSDT:  'dogecoin',
  DOTUSDT:   'polkadot',
  MATICUSDT: 'matic-network',
  LTCUSDT:   'litecoin'
};

function toCGId(symbol) {
  const id = CG_MAP[symbol.toUpperCase()];
  if (!id) throw new Error(`Unknown symbol: ${symbol}`);
  return id;
}

// ── Kraken interval helpers ───────────────────────────────────────────────────
function toKrakenMinutes(interval) {
  switch (interval) {
    case '1h':  return 60;
    case '4h':  return 240;
    case '1d':  return 1440;
    case '1w':  return 10080;
    default:    return 60;
  }
}

function toCGParams(interval) {
  switch (interval) {
    case '1h':  return { days: 14,  interval: 'hourly' };
    case '4h':  return { days: 60,  interval: 'hourly' };
    case '1d':  return { days: 365, interval: 'daily'  };
    case '1w':  return { days: 730, interval: 'daily'  };
    default:    return { days: 14,  interval: 'hourly' };
  }
}

// ── Live prices — Kraken Ticker (no rate limits) ──────────────────────────────

async function fetchPricesFromKraken(symbols) {
  const krakenSymbols = symbols.filter(s => KRAKEN[s]);
  if (!krakenSymbols.length) return [];

  const pairs = krakenSymbols.map(s => KRAKEN[s].pair).join(',');
  const res   = await axios.get(`https://api.kraken.com/0/public/Ticker`, { params: { pair: pairs } });

  if (res.data.error && res.data.error.length) throw new Error(res.data.error.join(', '));

  const result = res.data.result;
  return krakenSymbols.map(sym => {
    const rk = KRAKEN[sym].responseKey;
    const d  = result[rk];
    if (!d) return null;
    const price    = parseFloat(d.c[0]);
    const open     = parseFloat(d.o);
    const high24h  = parseFloat(d.h[1]);
    const low24h   = parseFloat(d.l[1]);
    const vol24h   = parseFloat(d.v[1]);
    const change24h = ((price - open) / open) * 100;
    return { symbol: sym, price, change24h, high24h, low24h, volume24h: vol24h * price };
  }).filter(Boolean);
}

async function fetchPricesFromCG(symbols) {
  if (!symbols.length) return [];
  const ids = symbols.map(toCGId).join(',');
  const res = await apiGet(`${COINGECKO}/coins/markets`, {
    vs_currency: 'usd', ids, order: 'market_cap_desc', price_change_percentage: '24h'
  });
  const idToSymbol = {};
  symbols.forEach(s => { idToSymbol[CG_MAP[s]] = s; });
  return res.data.map(c => ({
    symbol:    idToSymbol[c.id] || c.id,
    price:     c.current_price,
    change24h: c.price_change_percentage_24h || 0,
    high24h:   c.high_24h,
    low24h:    c.low_24h,
    volume24h: c.total_volume
  }));
}

async function fetchPrices(symbols) {
  const key = `prices_${symbols.join(',')}`;
  return dedupe(key, async () => {
    const krakenSyms = symbols.filter(s => KRAKEN[s]);
    const cgSyms     = symbols.filter(s => !KRAKEN[s]);

    const [krakenData, cgData] = await Promise.all([
      krakenSyms.length ? fetchPricesFromKraken(krakenSyms) : [],
      cgSyms.length     ? fetchPricesFromCG(cgSyms)         : []
    ]);

    const combined = [...krakenData, ...cgData];
    // Sort to match original symbol order
    const sorted = symbols.map(s => combined.find(d => d.symbol === s)).filter(Boolean);
    cacheSet(key, sorted, 90_000);
    return sorted;
  });
}

async function fetchSinglePrice(symbol) {
  const key = `price_${symbol}`;
  return dedupe(key, async () => {
    let price;
    if (KRAKEN[symbol]) {
      const data = await fetchPricesFromKraken([symbol]);
      price = data[0]?.price;
    }
    if (!price) {
      const id  = toCGId(symbol);
      const res = await apiGet(`${COINGECKO}/simple/price`, { ids: id, vs_currencies: 'usd' });
      price = res.data[id].usd;
    }
    cacheSet(key, price, 90_000);
    return price;
  });
}

async function fetchTicker24hr(symbol) {
  const prices = await fetchPrices([symbol]);
  return prices[0] || null;
}

// ── Historical klines — Kraken OHLC (no rate limits) ─────────────────────────

async function fetchKlinesFromKraken(symbol, interval, limit) {
  const pair    = KRAKEN[symbol].pair;
  const minutes = toKrakenMinutes(interval);
  const res     = await axios.get(`https://api.kraken.com/0/public/OHLC`, { params: { pair, interval: minutes } });

  if (res.data.error && res.data.error.length) throw new Error(res.data.error.join(', '));

  const resultKey = Object.keys(res.data.result).find(k => k !== 'last');
  const rows      = res.data.result[resultKey];

  return rows.slice(-limit).map(r => ({
    openTime:  r[0] * 1000,
    open:      parseFloat(r[1]),
    high:      parseFloat(r[2]),
    low:       parseFloat(r[3]),
    close:     parseFloat(r[4]),
    volume:    parseFloat(r[6]),
    closeTime: r[0] * 1000
  }));
}

async function fetchKlinesFromCG(symbol, interval, limit) {
  const id = toCGId(symbol);
  const { days, interval: cgInterval } = toCGParams(interval);
  const res = await apiGet(`${COINGECKO}/coins/${id}/market_chart`, {
    vs_currency: 'usd', days, interval: cgInterval
  });
  const prices = res.data.prices;
  return prices.slice(-limit).map((p, i, arr) => {
    const close = p[1];
    const open  = i > 0 ? arr[i - 1][1] : close;
    return {
      openTime: p[0], open,
      high:  Math.max(open, close) * 1.003,
      low:   Math.min(open, close) * 0.997,
      close, volume: 0, closeTime: p[0]
    };
  });
}

async function fetchKlines(symbol, interval = '1h', limit = 500) {
  const key = `klines_${symbol}_${interval}`;
  return dedupe(key, async () => {
    let candles;
    if (KRAKEN[symbol]) {
      try {
        candles = await fetchKlinesFromKraken(symbol, interval, limit);
      } catch (err) {
        console.warn(`[Kraken] Falling back to CoinGecko for ${symbol}:`, err.message);
        candles = await fetchKlinesFromCG(symbol, interval, limit);
      }
    } else {
      candles = await fetchKlinesFromCG(symbol, interval, limit);
    }
    cacheSet(key, candles, 10 * 60_000);
    return candles;
  });
}

module.exports = { fetchSinglePrice, fetchPrices, fetchTicker24hr, fetchKlines };
