'use strict';

// Was stop loss triggered? (price dipped below threshold)
function isStopLossHit(entryPrice, candleLow, stopLossPct) {
  const threshold = entryPrice * (1 - stopLossPct / 100);
  return candleLow <= threshold;
}

// Was take profit triggered? (price rose above threshold)
function isTakeProfitHit(entryPrice, candleHigh, takeProfitPct) {
  const threshold = entryPrice * (1 + takeProfitPct / 100);
  return candleHigh >= threshold;
}

// What dollar amount to risk per trade
// riskPct = percentage of balance to use (e.g. 95 means use 95% of balance)
function calcPositionSize(balance, riskPct = 95) {
  return balance * (riskPct / 100);
}

// Daily loss guard: returns true if daily losses exceed the limit
function isDailyLossLimitHit(dailyPnl, balance, maxDailyLossPct = 5) {
  const threshold = -(balance * maxDailyLossPct / 100);
  return dailyPnl <= threshold;
}

module.exports = {
  isStopLossHit,
  isTakeProfitHit,
  calcPositionSize,
  isDailyLossLimitHit
};
