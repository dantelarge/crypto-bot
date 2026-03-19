'use strict';

// ── Indicators ────────────────────────────────────────────────────────────────

function calcSMA(prices, period) {
  const results = new Array(period - 1).fill(null);
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    results.push(slice.reduce((s, v) => s + v, 0) / period);
  }
  return results;
}

function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  const results = new Array(period - 1).fill(null);
  let ema = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  results.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    results.push(ema);
  }
  return results;
}

function calcRSI(prices, period = 14) {
  const results = new Array(period).fill(null);
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    results.push(100 - 100 / (1 + rs));
  }

  return results;
}

// ── Signal Generators ─────────────────────────────────────────────────────────
// Each returns an array of signals: 'BUY' | 'SELL' | null  (one per candle)

// RSI Strategy: buy when RSI < 30 (oversold), sell when RSI > 70 (overbought)
function rsiSignals(klines, { rsiPeriod = 14, oversold = 30, overbought = 70 } = {}) {
  const closes = klines.map(k => k.close);
  const rsi = calcRSI(closes, rsiPeriod);
  const signals = rsi.map((r, i) => {
    if (r === null) return null;
    if (r < oversold) return 'BUY';
    if (r > overbought) return 'SELL';
    return null;
  });
  return { signals, indicators: { rsi } };
}

// MA Crossover Strategy: buy when short MA crosses above long MA, sell when below
function maCrossSignals(klines, { shortPeriod = 10, longPeriod = 50 } = {}) {
  const closes = klines.map(k => k.close);
  const shortMA = calcEMA(closes, shortPeriod);
  const longMA = calcEMA(closes, longPeriod);

  const signals = closes.map((_, i) => {
    if (shortMA[i] === null || longMA[i] === null) return null;
    if (i === 0) return null;
    const prevCrossedAbove = shortMA[i - 1] !== null && longMA[i - 1] !== null && shortMA[i - 1] <= longMA[i - 1];
    const nowAbove = shortMA[i] > longMA[i];
    const prevCrossedBelow = shortMA[i - 1] !== null && longMA[i - 1] !== null && shortMA[i - 1] >= longMA[i - 1];
    const nowBelow = shortMA[i] < longMA[i];
    if (prevCrossedAbove && nowAbove) return 'BUY';
    if (prevCrossedBelow && nowBelow) return 'SELL';
    return null;
  });
  return { signals, indicators: { shortMA, longMA } };
}

// Combined Strategy: RSI + MA must both agree
function combinedSignals(klines, opts = {}) {
  const rsi = rsiSignals(klines, opts);
  const ma = maCrossSignals(klines, opts);
  const signals = rsi.signals.map((r, i) => {
    if (r === 'BUY' && ma.signals[i] === 'BUY') return 'BUY';
    if (r === 'SELL' && ma.signals[i] === 'SELL') return 'SELL';
    return null;
  });
  return {
    signals,
    indicators: { ...rsi.indicators, ...ma.indicators }
  };
}

function getSignals(klines, strategy, opts = {}) {
  switch (strategy) {
    case 'RSI': return rsiSignals(klines, opts);
    case 'MA_CROSS': return maCrossSignals(klines, opts);
    case 'COMBINED': return combinedSignals(klines, opts);
    default: throw new Error(`Unknown strategy: ${strategy}`);
  }
}

module.exports = { getSignals, calcRSI, calcSMA, calcEMA };
