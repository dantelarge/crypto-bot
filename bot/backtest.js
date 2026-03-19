'use strict';

const binance = require('./binance');
const { getSignals } = require('./strategy');
const risk = require('./risk');

async function run({ symbol, interval, strategy, initialBalance, stopLoss, takeProfit, limit }) {
  const klines = await binance.fetchKlines(symbol, interval, limit);
  const { signals, indicators } = getSignals(klines, strategy);

  let balance = initialBalance;
  let position = null; // { entryPrice, qty, entryIndex }
  const trades = [];
  const equityCurve = [{ time: klines[0].openTime, equity: balance }];

  for (let i = 0; i < klines.length; i++) {
    const candle = klines[i];
    const signal = signals[i];

    // Check stop loss / take profit on open position
    if (position) {
      const slHit = risk.isStopLossHit(position.entryPrice, candle.low, stopLoss);
      const tpHit = risk.isTakeProfitHit(position.entryPrice, candle.high, takeProfit);

      if (slHit || tpHit) {
        const exitPrice = slHit
          ? position.entryPrice * (1 - stopLoss / 100)
          : position.entryPrice * (1 + takeProfit / 100);
        const pnl = (exitPrice - position.entryPrice) * position.qty;
        balance += position.qty * exitPrice;
        trades.push({
          type: 'SELL',
          reason: slHit ? 'STOP_LOSS' : 'TAKE_PROFIT',
          entryPrice: position.entryPrice,
          exitPrice,
          qty: position.qty,
          pnl: parseFloat(pnl.toFixed(4)),
          pnlPct: parseFloat(((exitPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2)),
          entryTime: klines[position.entryIndex].openTime,
          exitTime: candle.openTime,
          win: pnl > 0
        });
        position = null;
      }
    }

    // Act on strategy signals
    if (!position && signal === 'BUY' && balance > 10) {
      const qty = risk.calcPositionSize(balance, 95) / candle.close; // use 95% of balance
      const cost = qty * candle.close;
      balance -= cost;
      position = { entryPrice: candle.close, qty, entryIndex: i };
    } else if (position && signal === 'SELL') {
      const exitPrice = candle.close;
      const pnl = (exitPrice - position.entryPrice) * position.qty;
      balance += position.qty * exitPrice;
      trades.push({
        type: 'SELL',
        reason: 'SIGNAL',
        entryPrice: position.entryPrice,
        exitPrice,
        qty: position.qty,
        pnl: parseFloat(pnl.toFixed(4)),
        pnlPct: parseFloat(((exitPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2)),
        entryTime: klines[position.entryIndex].openTime,
        exitTime: candle.openTime,
        win: pnl > 0
      });
      position = null;
    }

    const equity = position
      ? balance + position.qty * candle.close
      : balance;
    equityCurve.push({ time: candle.openTime, equity: parseFloat(equity.toFixed(2)) });
  }

  // Close open position at last price
  if (position) {
    const lastPrice = klines[klines.length - 1].close;
    const pnl = (lastPrice - position.entryPrice) * position.qty;
    balance += position.qty * lastPrice;
    trades.push({
      type: 'SELL',
      reason: 'END_OF_DATA',
      entryPrice: position.entryPrice,
      exitPrice: lastPrice,
      qty: position.qty,
      pnl: parseFloat(pnl.toFixed(4)),
      pnlPct: parseFloat(((lastPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2)),
      entryTime: klines[position.entryIndex].openTime,
      exitTime: klines[klines.length - 1].openTime,
      win: pnl > 0
    });
  }

  // Stats
  const wins = trades.filter(t => t.win).length;
  const losses = trades.length - wins;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const winRate = trades.length ? (wins / trades.length * 100).toFixed(1) : 0;
  const maxDrawdown = calcMaxDrawdown(equityCurve);
  const totalReturn = ((balance - initialBalance) / initialBalance * 100).toFixed(2);

  return {
    symbol,
    strategy,
    interval,
    initialBalance,
    finalBalance: parseFloat(balance.toFixed(2)),
    totalReturn: parseFloat(totalReturn),
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    totalTrades: trades.length,
    wins,
    losses,
    winRate: parseFloat(winRate),
    maxDrawdown,
    trades: trades.slice(-50), // return last 50 trades
    equityCurve,
    indicators: summariseIndicators(indicators, klines.length)
  };
}

function calcMaxDrawdown(equityCurve) {
  let peak = equityCurve[0].equity;
  let maxDD = 0;
  for (const { equity } of equityCurve) {
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return parseFloat(maxDD.toFixed(2));
}

// Keep only last N values to avoid sending huge arrays to the client
function summariseIndicators(indicators, length) {
  const out = {};
  const tail = 200;
  for (const [key, arr] of Object.entries(indicators)) {
    out[key] = arr.slice(-tail);
  }
  return out;
}

module.exports = { run };
