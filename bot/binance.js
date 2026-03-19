'use strict';

const axios = require('axios');

const BASE = 'https://api.coingecko.com/api/v3';

// ── Simple in-memory cache ────────────────────────────────────────────────────
const cache = {};

function cacheGet(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete cache[key]; return null; }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  cache[key] = { data, expiresAt: Date.now() + ttlMs };
}

// ── Symbol map ────────────────────────────────────────────────────────────────
const SYMBOL_MAP = {
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

function toId(symbol) {
  const id = SYMBOL_MAP[symbol.toUpperCase()];
  if (!id) throw new Error(`Unknown symbol: ${symbol}`);
  return id;
}

function intervalToParams(interval) {
  switch (interval) {
    case '1h':  return { days: 14,  interval: 'hourly' };
    case '4h':  return { days: 60,  interval: 'hourly' };
    case '1d':  return { days: 365, interval: 'daily'  };
    case '1w':  return { days: 730, interval: 'daily'  };
    default:    return { days: 14,  interval: 'hourly' };
  }
}

// ── API calls with caching ────────────────────────────────────────────────────

// Single price — cache 60 seconds
async function fetchSinglePrice(symbol) {
  const key = `price_${symbol}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  const id = toId(symbol);
  const res = await axios.get(`${BASE}/simple/price`, {
    params: { ids: id, vs_currencies: 'usd' }
  });
  const price = res.data[id].usd;
  cacheSet(key, price, 60_000);
  return price;
}

// Multiple prices — cache 60 seconds
async function fetchPrices(symbols) {
  const key = `prices_${symbols.join(',')}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  const ids = symbols.map(toId).join(',');
  const res = await axios.get(`${BASE}/coins/markets`, {
    params: { vs_currency: 'usd', ids, order: 'market_cap_desc', price_change_percentage: '24h' }
  });

  const idToSymbol = {};
  symbols.forEach(s => { idToSymbol[SYMBOL_MAP[s]] = s; });

  const data = res.data.map(c => ({
    symbol: idToSymbol[c.id] || c.id,
    price: c.current_price,
    change24h: c.price_change_percentage_24h || 0,
    high24h: c.high_24h,
    low24h: c.low_24h,
    volume24h: c.total_volume
  }));

  cacheSet(key, data, 60_000);
  return data;
}

// 24hr ticker — cache 60 seconds
async function fetchTicker24hr(symbol) {
  const key = `ticker_${symbol}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  const id = toId(symbol);
  const res = await axios.get(`${BASE}/coins/markets`, {
    params: { vs_currency: 'usd', ids: id }
  });
  const c = res.data[0];
  const data = {
    symbol,
    price: c.current_price,
    high: c.high_24h,
    low: c.low_24h,
    change: c.price_change_24h,
    changePct: c.price_change_percentage_24h,
    volume: c.total_volume
  };
  cacheSet(key, data, 60_000);
  return data;
}

// Historical klines — cache 5 minutes
async function fetchKlines(symbol, interval = '1h', limit = 500) {
  const key = `klines_${symbol}_${interval}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached.slice(-limit);

  const id = toId(symbol);
  const { days, interval: cgInterval } = intervalToParams(interval);
  const res = await axios.get(`${BASE}/coins/${id}/market_chart`, {
    params: { vs_currency: 'usd', days, interval: cgInterval }
  });

  const prices = res.data.prices;
  const candles = prices.map((p, i, arr) => {
    const close = p[1];
    const open  = i > 0 ? arr[i - 1][1] : close;
    const high  = Math.max(open, close) * 1.003;
    const low   = Math.min(open, close) * 0.997;
    return { openTime: p[0], open, high, low, close, volume: 0, closeTime: p[0] };
  });

  cacheSet(key, candles, 5 * 60_000);
  return candles.slice(-limit);
}

module.exports = { fetchSinglePrice, fetchPrices, fetchTicker24hr, fetchKlines };
