'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'paper_portfolio.json');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    const initial = {
      balance: parseFloat(process.env.PAPER_BALANCE || 1000),
      positions: {},
      trades: [],
      createdAt: Date.now()
    };
    saveState(initial);
    return initial;
  }
}

function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

function buy(symbol, usdtAmount, currentPrice) {
  if (usdtAmount > state.balance) {
    throw new Error(`Insufficient balance. Have $${state.balance.toFixed(2)}, need $${usdtAmount}`);
  }
  if (state.positions[symbol]) {
    throw new Error(`Already holding ${symbol}. Sell first.`);
  }

  const qty = usdtAmount / currentPrice;
  state.balance -= usdtAmount;
  state.positions[symbol] = {
    qty,
    entryPrice: currentPrice,
    entryTime: Date.now(),
    cost: usdtAmount
  };

  const trade = {
    id: Date.now(),
    type: 'BUY',
    symbol,
    price: currentPrice,
    qty,
    usdtAmount,
    time: Date.now()
  };
  state.trades.push(trade);
  saveState(state);
  return { trade, balance: state.balance };
}

function sell(symbol, currentPrice) {
  const pos = state.positions[symbol];
  if (!pos) throw new Error(`No open position for ${symbol}`);

  const proceeds = pos.qty * currentPrice;
  const pnl = proceeds - pos.cost;
  const pnlPct = (pnl / pos.cost) * 100;

  state.balance += proceeds;
  delete state.positions[symbol];

  const trade = {
    id: Date.now(),
    type: 'SELL',
    symbol,
    entryPrice: pos.entryPrice,
    exitPrice: currentPrice,
    qty: pos.qty,
    proceeds,
    pnl: parseFloat(pnl.toFixed(4)),
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    win: pnl > 0,
    time: Date.now()
  };
  state.trades.push(trade);
  saveState(state);
  return { trade, balance: state.balance };
}

function getPortfolio() {
  const totalInvested = Object.values(state.positions).reduce((s, p) => s + p.cost, 0);
  return {
    balance: parseFloat(state.balance.toFixed(2)),
    positions: state.positions,
    totalInvested: parseFloat(totalInvested.toFixed(2)),
    totalValue: parseFloat((state.balance + totalInvested).toFixed(2)),
    tradeCount: state.trades.length
  };
}

function getTrades() {
  return [...state.trades].reverse().slice(0, 100); // latest 100
}

function reset(newBalance = 1000) {
  state = {
    balance: newBalance,
    positions: {},
    trades: [],
    createdAt: Date.now()
  };
  saveState(state);
}

module.exports = { buy, sell, getPortfolio, getTrades, reset };
