// 52-week-high share screen. Deliberately has NO Kite dependency: the universe comes from Kite's
// public instrument dump and all prices come from Yahoo, so this keeps working on days nobody has
// logged in - which, on the main dashboard, turned out to be most days.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { fnoUnderlyings, toYahoo } = require('./universe');
const { scan } = require('./yahoo');
const { analyse, sizePosition } = require('./screen');

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const STATE = process.env.STATE_DIR || __dirname;
const CACHE = path.join(STATE, 'hi52_cache.json');

let state = { status: 'idle', asOf: null, rows: [], failed: [], scannedAt: null, progress: null, error: null };

try {
  if (fs.existsSync(CACHE)) { state = { ...state, ...JSON.parse(fs.readFileSync(CACHE, 'utf8')), status: 'idle', progress: null }; }
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
    // Newest breakouts first, then the strongest recent movers.
    rows.sort((a, b) => (b.isThrust - a.isThrust) || (b.isHigh - a.isHigh) || (b.ret63 ?? -99) - (a.ret63 ?? -99));
    state = { status: 'idle', asOf: rows[0]?.date || null, rows, failed,
              scannedAt: new Date().toISOString(), progress: null, error: null };
    try { fs.writeFileSync(CACHE, JSON.stringify({ asOf: state.asOf, rows, failed, scannedAt: state.scannedAt })); } catch (e) {}
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

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_q, r) => r.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`52-week-high screen on http://localhost:${PORT}  (no Kite token required)`);
  if (!state.scannedAt) runScan();
});
