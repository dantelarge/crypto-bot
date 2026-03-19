'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'signals.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Persistence ───────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function save(signals) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(signals, null, 2));
}

// ── Log a new signal ──────────────────────────────────────────────────────────

function logSignal({ symbol, type, rsi, price }) {
  const signals = load();
  const entry = {
    id:           Date.now(),
    symbol,
    type,                    // 'BUY' or 'SELL'
    rsi:          parseFloat(rsi.toFixed(2)),
    priceAtAlert: price,
    timestamp:    Date.now(),
    resolveAt:    Date.now() + 24 * 60 * 60 * 1000, // 24 hours later
    resolved:     false,
    priceAfter:   null,
    pnlPct:       null,
    win:          null
  };
  signals.push(entry);
  save(signals);
  console.log(`[SignalTracker] Logged ${type} signal for ${symbol} at $${price}`);
  return entry;
}

// ── Resolve signals that are 24hrs old ────────────────────────────────────────

async function resolveOldSignals(fetchPrice) {
  const signals = load();
  const now     = Date.now();
  let updated   = false;

  for (const s of signals) {
    if (s.resolved) continue;
    if (now < s.resolveAt) continue;

    try {
      const currentPrice = await fetchPrice(s.symbol);
      let pnlPct;

      if (s.type === 'BUY') {
        // WIN if price went UP after buy signal
        pnlPct = ((currentPrice - s.priceAtAlert) / s.priceAtAlert) * 100;
      } else {
        // WIN if price went DOWN after sell signal
        pnlPct = ((s.priceAtAlert - currentPrice) / s.priceAtAlert) * 100;
      }

      s.priceAfter = currentPrice;
      s.pnlPct     = parseFloat(pnlPct.toFixed(2));
      s.win        = pnlPct > 0;
      s.resolved   = true;
      updated      = true;

      console.log(`[SignalTracker] Resolved ${s.symbol} ${s.type} — P&L: ${pnlPct.toFixed(2)}% — ${s.win ? 'WIN' : 'LOSS'}`);

      // Small delay between price fetches
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[SignalTracker] Failed to resolve ${s.symbol}:`, err.message);
    }
  }

  if (updated) save(signals);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  const signals  = load();
  const resolved = signals.filter(s => s.resolved);
  const wins     = resolved.filter(s => s.win);
  const losses   = resolved.filter(s => !s.win);
  const pending  = signals.filter(s => !s.resolved);

  const winRate  = resolved.length
    ? parseFloat((wins.length / resolved.length * 100).toFixed(1))
    : null;

  const avgPnl = resolved.length
    ? parseFloat((resolved.reduce((s, r) => s + r.pnlPct, 0) / resolved.length).toFixed(2))
    : null;

  const bestSignal = resolved.length
    ? resolved.reduce((best, s) => s.pnlPct > (best ? best.pnlPct : -Infinity) ? s : best, null)
    : null;

  const worstSignal = resolved.length
    ? resolved.reduce((worst, s) => s.pnlPct < (worst ? worst.pnlPct : Infinity) ? s : worst, null)
    : null;

  return {
    total:    signals.length,
    resolved: resolved.length,
    pending:  pending.length,
    wins:     wins.length,
    losses:   losses.length,
    winRate,
    avgPnl,
    bestSignal,
    worstSignal,
    signals:  [...signals].reverse() // newest first
  };
}

module.exports = { logSignal, resolveOldSignals, getStats };
