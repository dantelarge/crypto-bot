'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  prices: {},
  priceChart: null,
  equityChart: null
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPrice(n) {
  if (n >= 1000) return '$' + fmt(n, 2);
  if (n >= 1) return '$' + fmt(n, 4);
  return '$' + fmt(n, 6);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' });
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showLoading(msg = 'Loading...') {
  document.getElementById('loadingMsg').textContent = msg;
  document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function showTradeMsg(msg, type = 'ok') {
  const el = document.getElementById('tradeMsg');
  el.textContent = msg;
  el.className = 'trade-msg ' + type;
  setTimeout(() => { el.textContent = ''; el.className = 'trade-msg'; }, 4000);
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = document.getElementById('page-' + btn.dataset.page);
    if (page) {
      page.classList.add('active');
      if (btn.dataset.page === 'portfolio') loadPortfolio();
      if (btn.dataset.page === 'trades') loadTrades();
    }
  });
});

// ── Theme Toggle ──────────────────────────────────────────────────────────────

document.getElementById('themeToggle').addEventListener('click', () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
});

// ── WebSocket — Live Prices ───────────────────────────────────────────────────

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  const statusEl = document.getElementById('wsStatus');

  ws.onopen = () => {
    statusEl.textContent = '● Live';
    statusEl.classList.add('live');
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'prices') renderPriceCards(msg.data);
  };

  ws.onclose = () => {
    statusEl.textContent = '● Disconnected';
    statusEl.classList.remove('live');
    setTimeout(connectWS, 3000); // reconnect
  };

  ws.onerror = () => ws.close();
}

// ── Price Cards ───────────────────────────────────────────────────────────────

function renderPriceCards(prices) {
  const grid = document.getElementById('priceGrid');
  // First render: replace skeletons
  if (grid.querySelector('.skeleton')) grid.innerHTML = '';

  prices.forEach(p => {
    state.prices[p.symbol] = p;
    let card = document.getElementById('card-' + p.symbol);
    if (!card) {
      card = document.createElement('div');
      card.className = 'price-card';
      card.id = 'card-' + p.symbol;
      card.addEventListener('click', () => {
        document.getElementById('chartSymbol').value = p.symbol;
        loadPriceChart(p.symbol, document.getElementById('chartInterval').value);
        document.getElementById('chartTitle').textContent =
          p.symbol.replace('USDT', '/USDT');
      });
      grid.appendChild(card);
    }

    const changeClass = p.change24h >= 0 ? 'up' : 'down';
    const arrow = p.change24h >= 0 ? '▲' : '▼';
    card.innerHTML = `
      <div class="symbol">${escapeHtml(p.symbol.replace('USDT', '/USDT'))}</div>
      <div class="price">${fmtPrice(p.price)}</div>
      <div class="change ${changeClass}">${arrow} ${fmt(Math.abs(p.change24h), 2)}%</div>
      <div class="meta">H: ${fmtPrice(p.high24h)} &nbsp; L: ${fmtPrice(p.low24h)}</div>
    `;
  });
}

// ── Price Chart ───────────────────────────────────────────────────────────────

async function loadPriceChart(symbol, interval) {
  document.getElementById('chartSubtitle').textContent = 'Loading...';
  try {
    const res = await fetch(`/api/klines/${symbol}?interval=${interval}&limit=100`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    const klines = json.data;
    const labels = klines.map(k => new Date(k.openTime).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    const closes = klines.map(k => k.close);

    const ctx = document.getElementById('priceChart').getContext('2d');
    if (state.priceChart) state.priceChart.destroy();

    state.priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: symbol,
          data: closes,
          borderColor: '#58a6ff',
          backgroundColor: 'rgba(88,166,255,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, color: '#8b949e' }, grid: { color: '#21262d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
        }
      }
    });

    const last = closes[closes.length - 1];
    const first = closes[0];
    const pct = ((last - first) / first * 100).toFixed(2);
    document.getElementById('chartSubtitle').textContent =
      `${interval} chart · ${closes.length} candles · ${pct >= 0 ? '+' : ''}${pct}% over period`;
  } catch (err) {
    document.getElementById('chartSubtitle').textContent = 'Failed to load chart: ' + err.message;
  }
}

document.getElementById('chartSymbol').addEventListener('change', e => {
  loadPriceChart(e.target.value, document.getElementById('chartInterval').value);
  document.getElementById('chartTitle').textContent = e.target.value.replace('USDT', '/USDT');
});
document.getElementById('chartInterval').addEventListener('change', e => {
  loadPriceChart(document.getElementById('chartSymbol').value, e.target.value);
});

// ── Backtest ──────────────────────────────────────────────────────────────────

document.getElementById('runBacktest').addEventListener('click', async () => {
  const btn = document.getElementById('runBacktest');
  btn.disabled = true;
  showLoading('Running backtest... this may take a few seconds');

  const body = {
    symbol: document.getElementById('btSymbol').value,
    interval: document.getElementById('btInterval').value,
    strategy: document.getElementById('btStrategy').value,
    initialBalance: document.getElementById('btBalance').value,
    stopLoss: document.getElementById('btStopLoss').value,
    takeProfit: document.getElementById('btTakeProfit').value,
    limit: document.getElementById('btLimit').value
  };

  try {
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderBacktestResults(json.data);
  } catch (err) {
    alert('Backtest failed: ' + err.message);
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

function renderBacktestResults(r) {
  const resultsEl = document.getElementById('backtestResults');
  resultsEl.classList.remove('hidden');

  // Stats
  const returnClass = r.totalReturn >= 0 ? 'up' : 'down';
  document.getElementById('statsGrid').innerHTML = `
    <div class="card stat-card">
      <div class="stat-label">Final Balance</div>
      <div class="stat-value">$${fmt(r.finalBalance)}</div>
      <div class="stat-sub">Started: $${fmt(r.initialBalance)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Total Return</div>
      <div class="stat-value ${returnClass}">${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn}%</div>
      <div class="stat-sub">P&L: $${fmt(r.totalPnl)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Win Rate</div>
      <div class="stat-value ${r.winRate >= 50 ? 'up' : 'down'}">${r.winRate}%</div>
      <div class="stat-sub">${r.wins}W / ${r.losses}L</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Total Trades</div>
      <div class="stat-value">${r.totalTrades}</div>
      <div class="stat-sub">${r.symbol} · ${r.interval}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Max Drawdown</div>
      <div class="stat-value down">-${r.maxDrawdown}%</div>
      <div class="stat-sub">Worst losing streak</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Strategy</div>
      <div class="stat-value" style="font-size:1rem">${escapeHtml(r.strategy)}</div>
      <div class="stat-sub">${r.limit || ''} candles analysed</div>
    </div>
  `;

  // Equity curve
  const eq = r.equityCurve;
  const eqLabels = eq.map((e, i) => i % Math.max(1, Math.floor(eq.length / 10)) === 0
    ? new Date(e.time).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
    : '');
  const eqValues = eq.map(e => e.equity);
  const finalEq = eqValues[eqValues.length - 1];
  const eqColor = finalEq >= r.initialBalance ? '#3fb950' : '#f85149';

  const ctx = document.getElementById('equityChart').getContext('2d');
  if (state.equityChart) state.equityChart.destroy();
  state.equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: eqLabels,
      datasets: [{
        label: 'Balance',
        data: eqValues,
        borderColor: eqColor,
        backgroundColor: eqColor + '18',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 10 }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e', callback: v => '$' + fmt(v) }, grid: { color: '#21262d' } }
      }
    }
  });

  // Trades table
  const tbody = document.querySelector('#backtestTradeTable tbody');
  if (!r.trades.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No trades generated — try a different strategy or timeframe</td></tr>';
    return;
  }
  tbody.innerHTML = r.trades.map(t => `
    <tr>
      <td class="${t.type === 'BUY' ? 'buy-tag' : 'sell-tag'}">${escapeHtml(t.type)}</td>
      <td>${fmtPrice(t.entryPrice)}</td>
      <td>${fmtPrice(t.exitPrice)}</td>
      <td class="${t.pnl >= 0 ? 'up' : 'down'}">${t.pnl >= 0 ? '+' : ''}$${fmt(t.pnl)}</td>
      <td class="${t.pnlPct >= 0 ? 'up' : 'down'}">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%</td>
      <td>${escapeHtml(t.reason || '—')}</td>
    </tr>
  `).join('');

  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

async function loadPortfolio() {
  try {
    const [portRes, priceRes] = await Promise.all([
      fetch('/api/paper/portfolio'),
      fetch('/api/prices')
    ]);
    const port = (await portRes.json()).data;
    const livePrices = (await priceRes.json()).data;
    const priceMap = {};
    livePrices.forEach(p => { priceMap[p.symbol] = p.price; });

    document.getElementById('paperBalance').textContent = '$' + fmt(port.balance);
    document.getElementById('paperInvested').textContent = '$' + fmt(port.totalInvested);
    document.getElementById('paperTotal').textContent = '$' + fmt(port.totalValue);

    const tbody = document.querySelector('#positionsTable tbody');
    const positions = Object.entries(port.positions);
    if (!positions.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No open positions</td></tr>';
      return;
    }

    tbody.innerHTML = positions.map(([sym, pos]) => {
      const cur = priceMap[sym] || pos.entryPrice;
      const val = pos.qty * cur;
      const pnl = val - pos.cost;
      const pnlPct = (pnl / pos.cost * 100).toFixed(2);
      return `<tr>
        <td>${escapeHtml(sym.replace('USDT', '/USDT'))}</td>
        <td>${fmt(pos.qty, 6)}</td>
        <td>${fmtPrice(pos.entryPrice)}</td>
        <td>$${fmt(pos.cost)}</td>
        <td>${fmtPrice(cur)}</td>
        <td class="${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : ''}$${fmt(pnl)} (${pnlPct}%)</td>
        <td><button class="btn-sell-sm" data-sym="${escapeHtml(sym)}">Sell</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-sell-sm').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch('/api/paper/sell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: btn.dataset.sym })
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          const t = json.data.trade;
          showTradeMsg(`Sold ${btn.dataset.sym} · P&L: ${t.pnl >= 0 ? '+' : ''}$${fmt(t.pnl)} (${t.pnlPct}%)`, t.pnl >= 0 ? 'ok' : 'err');
          loadPortfolio();
        } catch (err) {
          showTradeMsg(err.message, 'err');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('buyBtn').addEventListener('click', async () => {
  const symbol = document.getElementById('tradeSymbol').value;
  const amount = parseFloat(document.getElementById('tradeAmount').value);
  if (!amount || amount < 10) return showTradeMsg('Enter an amount of at least $10', 'err');
  try {
    const res = await fetch('/api/paper/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, usdtAmount: amount })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    showTradeMsg(`Bought ${symbol} at ${fmtPrice(json.data.trade.price)}. Balance: $${fmt(json.data.balance)}`, 'ok');
    loadPortfolio();
  } catch (err) {
    showTradeMsg(err.message, 'err');
  }
});

document.getElementById('sellBtn').addEventListener('click', async () => {
  const symbol = document.getElementById('tradeSymbol').value;
  try {
    const res = await fetch('/api/paper/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const t = json.data.trade;
    showTradeMsg(`Sold ${symbol} · P&L: ${t.pnl >= 0 ? '+' : ''}$${fmt(t.pnl)} (${t.pnlPct}%)`, t.pnl >= 0 ? 'ok' : 'err');
    loadPortfolio();
  } catch (err) {
    showTradeMsg(err.message, 'err');
  }
});

document.getElementById('resetPortfolio').addEventListener('click', async () => {
  if (!confirm('Reset your paper portfolio to $1000? All positions and history will be cleared.')) return;
  await fetch('/api/paper/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balance: 1000 }) });
  showTradeMsg('Portfolio reset to $1,000', 'ok');
  loadPortfolio();
});

// ── Trade History ─────────────────────────────────────────────────────────────

async function loadTrades() {
  try {
    const res = await fetch('/api/paper/trades');
    const json = await res.json();
    const trades = json.data;
    const tbody = document.querySelector('#tradesTable tbody');
    if (!trades.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No trades yet. Go to Portfolio to make your first trade.</td></tr>';
      return;
    }
    tbody.innerHTML = trades.map(t => `
      <tr>
        <td class="${t.type === 'BUY' ? 'buy-tag' : 'sell-tag'}">${escapeHtml(t.type)}</td>
        <td>${escapeHtml((t.symbol || '').replace('USDT', '/USDT'))}</td>
        <td>${t.entryPrice ? fmtPrice(t.entryPrice) : '—'}</td>
        <td>${t.exitPrice ? fmtPrice(t.exitPrice) : '—'}</td>
        <td class="${(t.pnl || 0) >= 0 ? 'up' : 'down'}">${t.pnl != null ? (t.pnl >= 0 ? '+' : '') + '$' + fmt(t.pnl) : '—'}</td>
        <td>${t.win != null ? (t.win ? '<span class="win-tag">WIN</span>' : '<span class="loss-tag">LOSS</span>') : '—'}</td>
        <td>${fmtTime(t.time)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// ── Alerts Page ───────────────────────────────────────────────────────────────

function showAlertMsg(msg, type = 'ok') {
  const el = document.getElementById('alertMsg');
  el.textContent = msg;
  el.className = 'trade-msg ' + type;
  setTimeout(() => { el.textContent = ''; el.className = 'trade-msg'; }, 5000);
}

document.getElementById('testAlertBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testAlertBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const res = await fetch('/api/alert/test', { method: 'POST' });
    const json = await res.json();
    if (json.ok) showAlertMsg('Test message sent! Check your Telegram.', 'ok');
    else showAlertMsg('Error: ' + json.error, 'err');
  } catch (err) {
    showAlertMsg('Failed to send: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 Send Test Message to Telegram';
  }
});

document.getElementById('checkNowBtn').addEventListener('click', async () => {
  const btn = document.getElementById('checkNowBtn');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const res = await fetch('/api/alert/check', { method: 'POST' });
    const json = await res.json();
    if (json.ok) showAlertMsg('Signal check complete. If RSI triggered, you got a Telegram message.', 'ok');
    else showAlertMsg('Error: ' + json.error, 'err');
  } catch (err) {
    showAlertMsg('Failed: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Check Signals Now';
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

connectWS();
loadPriceChart('BTCUSDT', '1h');
