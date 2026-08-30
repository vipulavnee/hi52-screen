// Every date a stock printed a 52-week high, plus a paper portfolio built from those dates.
//
// This is DERIVED from the candles, never stored. That is deliberate: Render's free tier has no
// disk and wipes the filesystem on every spin-down, so a written log would silently lose itself
// and we would not notice until the history looked short. Recomputing costs a few milliseconds,
// survives every restart, and gives the FULL two-year history rather than only the days since
// the app happened to be running.
const LOOKBACK = 252;

// Rolling max of `h` over the previous LOOKBACK bars, computed with a monotonic deque so the
// whole series is one pass rather than 252 comparisons per day.
function priorHighs(candles) {
  const out = new Array(candles.length).fill(null);
  const dq = []; // indices, highs decreasing
  for (let i = 0; i < candles.length; i++) {
    while (dq.length && dq[0] < i - LOOKBACK) dq.shift();
    out[i] = dq.length ? candles[dq[0]].h : null;   // max of the PRIOR window, excludes today
    while (dq.length && candles[dq[dq.length - 1]].h <= candles[i].h) dq.pop();
    dq.push(i);
  }
  return out;
}

// One entry per date the day's high took out the previous 252-day high.
function highDates(candles) {
  const ph = priorHighs(candles);
  const hits = [];
  for (let i = LOOKBACK; i < candles.length; i++) {
    const c = candles[i];
    if (ph[i] == null || !(c.h >= ph[i])) continue;
    const av20 = candles.slice(i - 20, i).reduce((s, x) => s + x.v, 0) / 20;
    hits.push({
      date: c.d, priorHigh: ph[i], open: c.o, high: c.h, low: c.l, close: c.c,
      volX: av20 > 0 ? c.v / av20 : null,
      thrust: av20 > 0 && c.v / av20 > 2.5
    });
  }
  return hits;
}

// Paper fill at (previous 52-week high - 1): a resting buy order just under the breakout level.
//
// A limit order only fills if the price actually trades there. When a stock GAPS over the level
// the order never executes at the target, so modelling it as filled would invent a better entry
// than the market offered. Those are marked `gapped` and filled at the open instead, which is
// what would really have happened if the order were a stop/market-on-touch.
function paperEntry(hit) {
  const target = hit.priorHigh - 1;
  if (hit.low <= target) return { price: target, gapped: false };
  return { price: hit.open, gapped: true };
}

// One position per stock, taken on its FIRST 52-week high in the window - buying every repeat
// high would stack the same name a dozen times and stop being a portfolio.
function buildPortfolio(bySymbol, budgetRs, opts = {}) {
  const since = opts.since || null;
  const thrustOnly = !!opts.thrustOnly;
  const rows = [];
  for (const [symbol, d] of Object.entries(bySymbol)) {
    const candles = d.candles;
    if (!candles || candles.length < LOOKBACK + 2) continue;
    let hits = highDates(candles);
    if (since) hits = hits.filter(h => h.date >= since);
    if (thrustOnly) hits = hits.filter(h => h.thrust);
    if (!hits.length) continue;

    const first = hits[0];
    const fill = paperEntry(first);
    const qty = Math.floor(budgetRs / fill.price);
    if (qty < 1) {
      rows.push({ symbol, skipped: 'unaffordable', entryDate: first.date,
                  entryPrice: fill.price, gapped: fill.gapped, price: candles[candles.length - 1].c });
      continue;
    }
    const last = candles[candles.length - 1];
    const cost = qty * fill.price, value = qty * last.c;
    // Peak and trough on CLOSES after entry, so the run-up and the worst dip are both visible.
    const after = candles.filter(c => c.d > first.date);
    const peak = after.length ? Math.max(...after.map(c => c.c)) : last.c;
    const trough = after.length ? Math.min(...after.map(c => c.c)) : last.c;
    rows.push({
      symbol, entryDate: first.date, entryPrice: fill.price, gapped: fill.gapped,
      thrust: first.thrust, volX: first.volX,
      qty, cost, price: last.c, value, pnl: value - cost,
      pnlPct: cost > 0 ? (value / cost - 1) * 100 : null,
      peakPct: (peak / fill.price - 1) * 100,
      troughPct: (trough / fill.price - 1) * 100,
      hits: hits.length,
      heldDays: after.length,
      lastHigh: hits[hits.length - 1].date
    });
  }
  const held = rows.filter(r => !r.skipped);
  const cost = held.reduce((s, r) => s + r.cost, 0);
  const value = held.reduce((s, r) => s + r.value, 0);
  return {
    rows: rows.sort((a, b) => (b.pnlPct ?? -1e9) - (a.pnlPct ?? -1e9)),
    summary: {
      positions: held.length,
      skipped: rows.length - held.length,
      cost, value, pnl: value - cost,
      pnlPct: cost > 0 ? (value / cost - 1) * 100 : null,
      winners: held.filter(r => r.pnl > 0).length,
      gapped: held.filter(r => r.gapped).length
    }
  };
}

module.exports = { highDates, priorHighs, buildPortfolio, paperEntry, LOOKBACK };
