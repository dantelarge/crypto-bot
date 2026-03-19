'use strict';

const axios = require('axios');

const BASE = 'https://api.coingecko.com/api/v3';

// Map trading symbols → CoinGecko IDs
const SYMBOL_MAP = {
  BTCUSDT:  'bitcoin',
  ETHUSDT:  'ethereum',
  BNBUSDT:  'binancecoin',
  SOLUSDT:  'solana',
  XRPUSDT:  'ripple',
  ADAUSDT:  'cardano',
  DOGEUSDT: 'dogecoin',
  DOTUSDT:  'polkadot',
  MATICUSDT:'matic-network',
  LTCUSDT:  'litecoin'
};

function toId(symbol) {
  const id = SYMBOL_MAP[symbol.toUpperCase()];
  if (!id) throw new Error(`Unknown symbol: ${symbol}`);
  return id;
}

// Map interval → CoinGecko days param for OHLC
function intervalToDays(interval) {
  switch (interval) {
    case '1h':  return 1;
    case '4h':  return 7;
    case '1d':  return 90;
    case '1w':  return 365;
    default:    return 7;
  }
}

// Fetch live price for a single symbol
async function fetchSinglePrice(symbol) {
  const id = toId(symbol);
  const res = await axios.get(`${BASE}/simple/price`, {
    params: { ids: id, vs_currencies: 'usd' }
  });
  return res.data[id].usd;
}

// Fetch live prices + 24hr stats for multiple symbols
async function fetchPrices(symbols) {
  const ids = symbols.map(toId).join(',');
  const res = await axios.get(`${BASE}/coins/markets`, {
    params: {
      vs_currency: 'usd',
      ids,
      order: 'market_cap_desc',
      price_change_percentage: '24h'
    }
  });

  // Re-map back to symbol format
  const idToSymbol = {};
  symbols.forEach(s => { idToSymbol[SYMBOL_MAP[s]] = s; });

  return res.data.map(c => ({
    symbol: idToSymbol[c.id] || c.id,
    price: c.current_price,
    change24h: c.price_change_percentage_24h || 0,
    high24h: c.high_24h,
    low24h: c.low_24h,
    volume24h: c.total_volume
  }));
}

// Fetch 24hr ticker stats for one symbol
async function fetchTicker24hr(symbol) {
  const id = toId(symbol);
  const res = await axios.get(`${BASE}/coins/markets`, {
    params: { vs_currency: 'usd', ids: id }
  });
  const c = res.data[0];
  return {
    symbol,
    price: c.current_price,
    high: c.high_24h,
    low: c.low_24h,
    change: c.price_change_24h,
    changePct: c.price_change_percentage_24h,
    volume: c.total_volume
  };
}

// Fetch historical OHLC candles
// CoinGecko returns: [timestamp, open, high, low, close]
async function fetchKlines(symbol, interval = '1h', limit = 500) {
  const id = toId(symbol);
  const days = intervalToDays(interval);
  const res = await axios.get(`${BASE}/coins/${id}/ohlc`, {
    params: { vs_currency: 'usd', days }
  });

  const candles = res.data.map(k => ({
    openTime: k[0],
    open:  k[1],
    high:  k[2],
    low:   k[3],
    close: k[4],
    volume: 0,
    closeTime: k[0]
  }));

  // Return last `limit` candles
  return candles.slice(-limit);
}

module.exports = { fetchSinglePrice, fetchPrices, fetchTicker24hr, fetchKlines };
