'use strict';

const axios = require('axios');

const COINGECKO = 'https://api.coingecko.com/api/v3';
const KRAKEN    = 'https://api.kraken.com/0/public';

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

// ── CoinGecko symbol map (for live prices only) ───────────────────────────────
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

// ── Kraken symbol map (for charts — no rate limits) ───────────────────────────
const KRAKEN_MAP = {
  BTCUSDT:  'XBTUSD',
  ETHUSDT:  'ETHUSD',
  SOLUSDT:  'SOLUSD',
  XRPUSDT:  'XRPUSD',
  BNBUSDT:  null,       // not on Kraken — falls back to CoinGecko
  ADAUSDT:  'ADAUSD',
  DOGEUSDT: 'DOGEUSD',
  LTCUSDT:  'LTCUSD'
};

// Kraken interval in minutes
function toKrakenInterval(interval) {
  switch (interval) {
    case '1h':  return { minutes: 60,   limit: 336  }; // 14 days
    case '4h':  return { minutes: 240,  limit: 360  }; // 60 days
    case '1d':  return { minutes: 1440, limit: 365  }; // 1 year
    case '1w':  return { minutes: 10080,limit: 104  }; // 2 years
    default:    return { minutes: 60,   limit: 336  };
  }
}

// CoinGecko fallback interval params
function toCGParams(interval) {
  switch (interval) {
    case '1h':  return { days: 14,  interval: 'hourly' };
    case '4h':  return { days: 60,  interval: 'hourly' };
    case '1d':  return { days: 365, interval: 'daily'  };
    case '1w':  return { days: 730, interval: 'daily'  };
    default:    return { days: 14,  interval: 'hourly' };
  }
}

function toCGId(symbol) {
  const id = CG_MAP[symbol.toUpperCase()];
  if (!id) throw new Error(`Unknown symbol: ${symbol}`);
  return id;
}

// ── Live prices — CoinGecko (one call for all coins) ──────────────────────────

async function fetchSinglePrice(symbol) {
  const key = `price_${symbol}`;
  return dedupe(key, async () => {
    const id  = toCGId(symbol);
    const res = await apiGet(`${COINGECKO}/simple/price`, { ids: id, vs_currencies: 'usd' });
    const price = res.data[id].usd;
    cacheSet(key, price, 90_000);
    return price;
  });
}

async function fetchPrices(symbols) {
  const key = `prices_${symbols.join(',')}`;
  return dedupe(key, async () => {
    const ids = symbols.map(toCGId).join(',');
    const res = await apiGet(`${COINGECKO}/coins/markets`, {
      vs_currency: 'usd', ids, order: 'market_cap_desc', price_change_percentage: '24h'
    });
    const idToSymbol = {};
    symbols.forEach(s => { idToSymbol[CG_MAP[s]] = s; });
    const data = res.data.map(c => ({
      symbol:    idToSymbol[c.id] || c.id,
      price:     c.current_price,
      change24h: c.price_change_percentage_24h || 0,
      high24h:   c.high_24h,
      low24h:    c.low_24h,
      volume24h: c.total_volume
    }));
    cacheSet(key, data, 90_000);
    return data;
  });
}

async function fetchTicker24hr(symbol) {
  const key = `ticker_${symbol}`;
  return dedupe(key, async () => {
    const id  = toCGId(symbol);
    const res = await apiGet(`${COINGECKO}/coins/markets`, { vs_currency: 'usd', ids: id });
    const c   = res.data[0];
    const data = {
      symbol,
      price:     c.current_price,
      high:      c.high_24h,
      low:       c.low_24h,
      change:    c.price_change_24h,
      changePct: c.price_change_percentage_24h,
      volume:    c.total_volume
    };
    cacheSet(key, data, 90_000);
    return data;
  });
}

// ── Historical klines — Kraken (no rate limits, real OHLC) ───────────────────

async function fetchKlinesFromKraken(symbol, interval, limit) {
  const pair = KRAKEN_MAP[symbol.toUpperCase()];
  const { minutes } = toKrakenInterval(interval);
  const res  = await axios.get(`${KRAKEN}/OHLC`, { params: { pair, interval: minutes } });

  if (res.data.error && res.data.error.length) {
    throw new Error('Kraken error: ' + res.data.error.join(', '));
  }

  // Kraken returns { result: { PAIRNAME: [[time,o,h,l,c,vwap,vol,count],...], last: N } }
  const resultKey = Object.keys(res.data.result).find(k => k !== 'last');
  const rows = res.data.result[resultKey];

  const candles = rows.map(r => ({
    openTime:  r[0] * 1000, // convert seconds → ms
    open:      parseFloat(r[1]),
    high:      parseFloat(r[2]),
    low:       parseFloat(r[3]),
    close:     parseFloat(r[4]),
    volume:    parseFloat(r[6]),
    closeTime: r[0] * 1000
  }));

  return candles.slice(-limit);
}

async function fetchKlinesFromCG(symbol, interval, limit) {
  const id = toCGId(symbol);
  const { days, interval: cgInterval } = toCGParams(interval);
  const res = await apiGet(`${COINGECKO}/coins/${id}/market_chart`, {
    vs_currency: 'usd', days, interval: cgInterval
  });
  const prices = res.data.prices;
  const candles = prices.map((p, i, arr) => {
    const close = p[1];
    const open  = i > 0 ? arr[i - 1][1] : close;
    return {
      openTime:  p[0],
      open,
      high:  Math.max(open, close) * 1.003,
      low:   Math.min(open, close) * 0.997,
      close,
      volume:    0,
      closeTime: p[0]
    };
  });
  return candles.slice(-limit);
}

async function fetchKlines(symbol, interval = '1h', limit = 500) {
  const key = `klines_${symbol}_${interval}`;
  return dedupe(key, async () => {
    let candles;
    const krakenPair = KRAKEN_MAP[symbol.toUpperCase()];

    if (krakenPair) {
      try {
        candles = await fetchKlinesFromKraken(symbol, interval, limit);
      } catch (err) {
        console.warn(`[Kraken] Failed for ${symbol}, falling back to CoinGecko:`, err.message);
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
