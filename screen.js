// The screen itself. Pure functions over candles - no network, so it is testable and cheap.
//
// REBUILT 2026-08-31 after a proper walk-forward: 10 years, POINT-IN-TIME F&O membership from
// NSE's own monthly derivatives bhavcopy, weekly sampling, ranked on 2017-2021 and tested on
// 2022-2026. The earlier "+9.47% excess" claim came from applying today's F&O list to the past,
// which deletes every name dropped since - and names get dropped after they do badly. Correcting
// that alone took the universe's own baseline from +7.54% to +0.53%.
//
// What survived the out-of-sample half, F&O universe:
//   off-low top 20% + golden cross  +3.78 in-sample  ->  +1.20 out    t 1.76
//   % off 52-week low (top 20%)     +2.82            ->  +1.06        t 1.58
//   golden cross alone              +2.33            ->  +0.65        t 1.87
// What did NOT:
//   at a 52-week high               +3.49            ->  -0.08
//   volume > 2.5x                    ~0              ->   ~0
//   MACD above signal               -0.42            ->  -0.28        t -2.58 (negative)
//
// So the 52-week high is kept as a TRIGGER and a label, not as the selector. Ranking is by
// distance off the 52-week low, gated on the 50DMA being above the 200DMA. Nothing here clears
// statistical significance on F&O names - best t is 1.87, and the top setup was positive in only
// 2 of 5 out-of-sample years. Treat it as a slight tilt, not an edge.
const LOOKBACK = 252;

function analyse(candles) {
  if (!candles || candles.length < LOOKBACK + 2) return null;
  const i = candles.length - 1;
  const day = candles[i], prev = candles[i - 1];
  const prior = candles.slice(i - LOOKBACK, i);
  const high52 = Math.max(...prior.map(c => c.h));
  const low52 = Math.min(...prior.map(c => c.l));
  const avgVol20 = candles.slice(i - 20, i).reduce((s, c) => s + c.v, 0) / 20;
  const volX = avgVol20 > 0 ? day.v / avgVol20 : null;

  // How long since the last time it printed a 52-week high, so a first breakout can be told
  // apart from the tenth one in a row.
  let daysSinceHigh = null;
  for (let j = i - 1; j >= LOOKBACK; j--) {
    const h = Math.max(...candles.slice(j - LOOKBACK, j).map(c => c.h));
    if (candles[j].h >= h) { daysSinceHigh = i - j; break; }
  }

  const isHigh = day.h >= high52;
  const avg = n => candles.slice(i - n + 1, i + 1).reduce((s, c) => s + c.c, 0) / n;
  const ma50 = candles.length > 50 ? avg(50) : null;
  const ma200 = candles.length > 200 ? avg(200) : null;
  return {
    date: day.d, close: day.c, high: day.h, prevClose: prev.c,
    chgPct: prev.c > 0 ? (day.c / prev.c - 1) * 100 : null,
    high52, low52,
    distFromHighPct: (high52 - day.c) / high52 * 100,
    // The ranking column. Best single survivor out of sample.
    fromLowPct: low52 > 0 ? (day.c / low52 - 1) * 100 : null,
    ma50, ma200,
    // The gate. Weak on its own but the only thing positive in 3 of 5 out-of-sample years, and it
    // is what lifts the off-low rank from +1.06 to +1.20.
    golden: (ma50 != null && ma200 != null) ? ma50 > ma200 : null,
    aboveMA200Pct: ma200 ? (day.c / ma200 - 1) * 100 : null,
    volX, isHigh,
    // Kept as a LABEL only. Volume >2.5x tested flat, and 52-week-high selection went to -0.08
    // out of sample, so neither drives what the screen shows any more.
    isThrust: isHigh && volX !== null && volX > 2.5,
    daysSinceHigh,
    closePos: (day.h - day.l) > 0 ? (day.c - day.l) / (day.h - day.l) : 0.5,
    ret21: candles.length > 22 ? (day.c / candles[i - 21].c - 1) * 100 : null,
    ret63: candles.length > 64 ? (day.c / candles[i - 63].c - 1) * 100 : null
  };
}

// Equal RUPEE sizing, not equal share count. Signal prices span Rs10 to Rs48,895 - a 4,904x
// spread - so "1 share each" would let whichever expensive stock happens to signal dominate the
// book for no reason connected to the signal's strength. Whole shares only; India has no
// fractional trading, so a stock dearer than the budget is simply unaffordable and says so.
function sizePosition(price, budgetRs) {
  if (!(price > 0) || !(budgetRs > 0)) return null;
  const qty = Math.floor(budgetRs / price);
  return { qty, cost: qty * price, affordable: qty >= 1, shortBy: qty >= 1 ? 0 : price - budgetRs };
}

// Which call to buy, if you are buying calls.
//
// Tested on 41,815 point-in-time signals (off-low top20 + golden cross), held to expiry:
//   strike    win%   went to zero   median    >100%
//   5% ITM     44%       31%         -23%      25%
//   ATM        39%       45%         -68%      25%
//   5% OTM     32%       57%        -100%      23%
//   10% OTM    25%       68%        -100%      20%
// 5% ITM keeps the same one-in-four shot at a double while cutting the wipeout rate by a third.
// The far-OTM strikes show higher MEAN returns, but that is a modelling artefact: options were
// priced at flat volatility and real markets charge more for OTM calls (skew), so those means are
// overstated by an unknown amount. Win rate and wipeout rate are unaffected by that bias, and both
// say the same thing.
//
// Next month, not the near one: 45-DTE beat 20-DTE on every strike tested.
const ITM_PCT = 5;

function pickStrike(chain, spot, todayIso) {
  if (!chain || !spot || !(spot > 0)) return null;
  const expiries = Object.keys(chain.byExpiry).filter(e => e > todayIso).sort();
  if (!expiries.length) return null;
  // "Next month" = skip anything expiring within a fortnight; that is the near-month contract
  // whose theta is the problem, not the horizon that tested well.
  const soon = new Date(todayIso); soon.setDate(soon.getDate() + 14);
  const cutoff = soon.toISOString().slice(0, 10);
  const expiry = expiries.find(e => e >= cutoff) || expiries[expiries.length - 1];
  const ladder = chain.byExpiry[expiry];
  if (!ladder || !ladder.length) return null;
  const target = spot * (1 - ITM_PCT / 100);
  const pick = ladder.reduce((b, x) => Math.abs(x.k - target) < Math.abs(b.k - target) ? x : b);
  const dte = Math.round((new Date(expiry) - new Date(todayIso)) / 86400000);
  return {
    strike: pick.k, symbol: pick.sym, expiry, dte, lot: chain.lot,
    itmPct: (spot / pick.k - 1) * 100,
    notional: pick.k * chain.lot          // what one lot controls; the PREMIUM needs a broker login
  };
}

module.exports = { analyse, sizePosition, pickStrike, LOOKBACK, ITM_PCT };
