'use strict';

const axios = require('axios');
const binance = require('./binance');
const { getSignals, calcRSI } = require('./strategy');

const TELEGRAM_API = 'https://api.telegram.org';

// Track last alert sent per symbol to avoid spamming
const lastAlertSent = {};
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours per coin

// ── Send Telegram message ─────────────────────────────────────────────────────

async function sendTelegram(token, chatId, message) {
  await axios.post(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML'
  });
}

// ── Check one symbol for signals ──────────────────────────────────────────────

async function checkSymbol(symbol, token, chatId) {
  const klines = await binance.fetchKlines(symbol, '1h', 100);
  const closes = klines.map(k => k.close);
  const rsiArr = calcRSI(closes, 14);
  const rsi = rsiArr[rsiArr.length - 1];
  const price = closes[closes.length - 1];

  if (rsi === null) return;

  const now = Date.now();
  const lastSent = lastAlertSent[symbol] || 0;
  if (now - lastSent < ALERT_COOLDOWN_MS) return; // cooldown active

  const coin = symbol.replace('USDT', '');
  let message = null;

  if (rsi < 30) {
    message =
      `🟢 <b>BUY SIGNAL — ${coin}/USDT</b>\n\n` +
      `📉 RSI: <b>${rsi.toFixed(1)}</b> (Oversold — below 30)\n` +
      `💵 Price: <b>$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>\n\n` +
      `The market may be oversold. Consider buying.\n` +
      `⚠️ Always set a stop loss (2%) before entering.`;
  } else if (rsi > 70) {
    message =
      `🔴 <b>SELL SIGNAL — ${coin}/USDT</b>\n\n` +
      `📈 RSI: <b>${rsi.toFixed(1)}</b> (Overbought — above 70)\n` +
      `💵 Price: <b>$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>\n\n` +
      `The market may be overbought. Consider taking profit.\n` +
      `⚠️ Only sell what you're comfortable letting go.`;
  }

  if (message) {
    await sendTelegram(token, chatId, message);
    lastAlertSent[symbol] = now;
    console.log(`[Alerter] ${rsi < 30 ? 'BUY' : 'SELL'} alert sent for ${symbol} — RSI: ${rsi.toFixed(1)}`);
  }
}

// ── Run check on all watched symbols ─────────────────────────────────────────

async function runAlertCheck() {
  const token   = process.env.TELEGRAM_TOKEN;
  const chatId  = process.env.TELEGRAM_CHAT_ID;
  const symbols = (process.env.ALERT_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT').split(',');

  if (!token || !chatId) return;

  console.log(`[Alerter] Checking signals for: ${symbols.join(', ')}`);

  for (const symbol of symbols) {
    try {
      await checkSymbol(symbol.trim(), token, chatId);
      // Small delay between symbols to avoid rate limiting
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[Alerter] Error checking ${symbol}:`, err.message);
    }
  }
}

// ── Send a test message ───────────────────────────────────────────────────────

async function sendTestAlert(token, chatId) {
  await sendTelegram(token, chatId,
    `🤖 <b>Crypto Bot Connected!</b>\n\n` +
    `Your Telegram alerts are working.\n` +
    `You will receive BUY and SELL signals based on RSI every hour.\n\n` +
    `Watching: BTC, ETH, SOL`
  );
}

module.exports = { runAlertCheck, sendTestAlert, sendTelegram };
