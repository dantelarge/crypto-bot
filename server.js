'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const session = require('express-session');
const axios = require('axios');

const binance = require('./bot/binance');
const backtest = require('./bot/backtest');
const paperTrader = require('./bot/paperTrader');
const alerter = require('./bot/alerter');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// ── Sessions ──────────────────────────────────────────────────────────────────

app.use(session({
  secret: process.env.SESSION_SECRET || 'crypto-bot-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // stay logged in for 7 days
}));

// ── Auth Middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  res.redirect('/login.html');
}

// Public routes (no auth needed)
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'style.css'));
});
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const correct = process.env.APP_PASSWORD || 'dantelarge';
  if (password === correct) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.json({ ok: false, error: 'Wrong password' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// All other routes require auth
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// ── REST API ──────────────────────────────────────────────────────────────────

// Live prices for a list of symbols
app.get('/api/prices', async (req, res) => {
  try {
    const symbols = (req.query.symbols || 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT').split(',');
    const prices = await binance.fetchPrices(symbols);
    res.json({ ok: true, data: prices });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 24hr ticker stats
app.get('/api/ticker/:symbol', async (req, res) => {
  try {
    const data = await binance.fetchTicker24hr(req.params.symbol.toUpperCase());
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Historical candlestick data
app.get('/api/klines/:symbol', async (req, res) => {
  try {
    const { interval = '1h', limit = 200 } = req.query;
    const klines = await binance.fetchKlines(req.params.symbol.toUpperCase(), interval, parseInt(limit));
    res.json({ ok: true, data: klines });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Run backtest
app.post('/api/backtest', async (req, res) => {
  try {
    const { symbol, interval, strategy, initialBalance, stopLoss, takeProfit, limit } = req.body;
    const result = await backtest.run({
      symbol: symbol.toUpperCase(),
      interval: interval || '1h',
      strategy: strategy || 'RSI',
      initialBalance: parseFloat(initialBalance) || 1000,
      stopLoss: parseFloat(stopLoss) || 2,
      takeProfit: parseFloat(takeProfit) || 4,
      limit: parseInt(limit) || 500
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Paper trading — portfolio
app.get('/api/paper/portfolio', (req, res) => {
  res.json({ ok: true, data: paperTrader.getPortfolio() });
});

// Paper trading — trade history
app.get('/api/paper/trades', (req, res) => {
  res.json({ ok: true, data: paperTrader.getTrades() });
});

// Paper trading — manual buy
app.post('/api/paper/buy', async (req, res) => {
  try {
    const { symbol, usdtAmount } = req.body;
    const price = await binance.fetchSinglePrice(symbol.toUpperCase());
    const result = paperTrader.buy(symbol.toUpperCase(), parseFloat(usdtAmount), price);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Paper trading — manual sell
app.post('/api/paper/sell', async (req, res) => {
  try {
    const { symbol } = req.body;
    const price = await binance.fetchSinglePrice(symbol.toUpperCase());
    const result = paperTrader.sell(symbol.toUpperCase(), price);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Reset paper portfolio
app.post('/api/paper/reset', (req, res) => {
  const { balance } = req.body;
  paperTrader.reset(parseFloat(balance) || 1000);
  res.json({ ok: true, message: 'Portfolio reset' });
});

// Send test Telegram alert
app.post('/api/alert/test', async (req, res) => {
  try {
    const token  = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return res.status(400).json({ ok: false, error: 'Telegram not configured' });
    await alerter.sendTestAlert(token, chatId);
    res.json({ ok: true, message: 'Test alert sent to Telegram' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Manually trigger alert check
app.post('/api/alert/check', async (req, res) => {
  try {
    await alerter.runAlertCheck();
    res.json({ ok: true, message: 'Signal check complete' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── WebSocket — push live prices every 15s ────────────────────────────────────

const WATCHED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Crypto Bot' }));
});

async function broadcastPrices() {
  if (wss.clients.size === 0) return;
  try {
    const prices = await binance.fetchPrices(WATCHED_SYMBOLS);
    const payload = JSON.stringify({ type: 'prices', data: prices });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  } catch (_) {}
}

setInterval(broadcastPrices, 60000);

// ── Keep-Alive (prevents Render free tier from sleeping) ──────────────────────

function startKeepAlive() {
  const url = process.env.APP_URL;
  if (!url) return;
  setInterval(() => {
    axios.get(`${url}/api/health`).catch(() => {});
  }, 14 * 60 * 1000); // ping every 14 minutes
  console.log(`♻️  Keep-alive active → pinging ${url} every 14 min`);
}

// ── Alert Scheduler — checks signals every hour ───────────────────────────────

function startAlertScheduler() {
  const token  = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  // Run immediately on startup, then every hour
  setTimeout(alerter.runAlertCheck, 5000);
  setInterval(alerter.runAlertCheck, 60 * 60 * 1000);
  console.log('📲 Telegram alerts active — checking signals every hour');
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 Crypto Bot running at http://localhost:${PORT}`);
  console.log(`📊 Mode: ${(process.env.TRADE_MODE || 'paper').toUpperCase()}`);
  console.log(`💰 Paper balance: $${process.env.PAPER_BALANCE || 1000} USDT`);
  console.log(`🔐 Password protection: ON\n`);
  startKeepAlive();
  startAlertScheduler();
});
