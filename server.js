// 52-week-high share screen. Deliberately has NO Kite dependency: the universe comes from Kite's
// public instrument dump and all prices come from Yahoo, so this keeps working on days nobody has
// logged in - which, on the main dashboard, turned out to be most days.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { fnoUnderlyings, toYahoo } = require('./universe');
const { scan } = require('./yahoo');
const { analyse, sizePosition } = require('./screen');
const { highDates, buildPortfolio } = require('./history');

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const STATE = process.env.STATE_DIR || __dirname;
const CACHE = path.join(STATE, 'hi52_cache.json');

let state = { status: 'idle', asOf: null, rows: [], failed: [], scannedAt: null, progress: null, error: null };
let candleStore = {};   // symbol -> { candles }; history and portfolio are derived from this

try {
  if (fs.existsSync(CACHE)) {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (c.packed) {
      for (const [s, v] of Object.entries(c.packed)) {
        candleStore[s] = { corporateAction: v.ca,
          candles: v.c.map(a => ({ d: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })) };
      }
      delete c.packed;
    }
    state = { ...state, ...c, status: 'idle', progress: null };
  }
} catch (e) { /* a corrupt cache is not worth failing to boot over */ }

const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function runScan() {
  if (state.status === 'scanning') return;
  state.status = 'scanning'; state.error = null; state.progress = { done: 0, total: 0 };
  try {
    const syms = await fnoUnderlyings();
    state.progress.total = syms.length;
    const { data, failed } = await scan(syms, toYahoo, (i, n) => { state.progress = { done: i, total: n }; });
    const rows = [];
    for (const [sym, d] of Object.entries(data)) {
      const a = analyse(d.candles);
      if (a) rows.push({ symbol: sym, corporateAction: d.corporateAction, ...a });
    }
    // /api/history and /api/portfolio are derived from these on demand, so nothing about the
    // 52-week-high log or the paper positions is ever stored as its own record to drift.
    candleStore = data;
    // Newest breakouts first, then the strongest recent movers.
    rows.sort((a, b) => (b.isThrust - a.isThrust) || (b.isHigh - a.isHigh) || (b.ret63 ?? -99) - (a.ret63 ?? -99));
    state = { status: 'idle', asOf: rows[0]?.date || null, rows, failed,
              scannedAt: new Date().toISOString(), progress: null, error: null };
    // Candles go into the cache too, as bare arrays rather than objects - history and portfolio
    // are derived from them, and without this a restart serves the screen instantly but leaves
    // both of those blank until someone triggers a two-minute rescan.
    try {
      const packed = {};
      for (const [s, d] of Object.entries(data)) {
        packed[s] = { ca: d.corporateAction, c: d.candles.map(x => [x.d, x.o, x.h, x.l, x.c, x.v]) };
      }
      fs.writeFileSync(CACHE, JSON.stringify({ asOf: state.asOf, rows, failed, scannedAt: state.scannedAt, packed }));
    } catch (e) {}
  } catch (e) {
    state.status = 'idle'; state.error = e.message; state.progress = null;
  }
}

app.get('/api/health', (_q, r) => r.json({ status: 'OK', scannedAt: state.scannedAt, rows: state.rows.length }));

app.get('/api/screen', (req, res) => {
  const budget = Number(req.query.budget) || 2000;
  // Staleness is "have I scanned TODAY", not "is the data from today". Comparing against asOf
  // looks right and is wrong: asOf is the last TRADING day, so every weekend and holiday it is
  // legitimately behind the calendar, and the check would fire a fresh 210-request scan on every
  // single page load until Monday. Caught doing exactly that on a Saturday.
  const scannedDay = state.scannedAt ? new Date(new Date(state.scannedAt).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) : null;
  const stale = scannedDay !== todayIST();
  if (stale && state.status !== 'scanning') runScan();          // fire and forget; UI polls
  res.json({
    status: state.status, asOf: state.asOf, scannedAt: state.scannedAt,
    progress: state.progress, error: state.error,
    failedCount: state.failed.length,
    budget,
    rows: state.rows.map(r => ({ ...r, size: sizePosition(r.close, budget) }))
  });
});

app.post('/api/rescan', (_q, r) => { runScan(); r.json({ started: true }); });

// Every date a stock printed a 52-week high, oldest first.
app.get('/api/history', (req, res) => {
  const sym = String(req.query.symbol || '').toUpperCase();
  const d = candleStore[sym];
  if (!d) return res.json({ symbol: sym, available: false, hits: [],
    note: candleStore && Object.keys(candleStore).length ? 'unknown symbol' : 'no scan in memory yet - rescan first' });
  res.json({ symbol: sym, available: true, hits: highDates(d.candles) });
});

// Paper portfolio: one position per stock on its FIRST 52-week high in the window, filled at
// (previous 52-week high - 1). Derived live, never stored.
app.get('/api/portfolio', (req, res) => {
  if (!Object.keys(candleStore).length) {
    return res.json({ available: false, note: 'no scan in memory yet - hit Refresh' });
  }
  const budget = Number(req.query.budget) || 2000;
  const since = req.query.since || null;
  const thrustOnly = req.query.thrust === '1';
  const p = buildPortfolio(candleStore, budget, { since, thrustOnly });
  res.json({ available: true, budget, since, thrustOnly, asOf: state.asOf, ...p });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_q, r) => r.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`52-week-high screen on http://localhost:${PORT}  (no Kite token required)`);
  if (!state.scannedAt) runScan();
});
