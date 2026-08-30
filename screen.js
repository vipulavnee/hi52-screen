// The screen itself. Pure functions over candles - no network, so it is testable and cheap.
//
// Backtested on 210 F&O names, Aug 2025 - Aug 2026 (2,461 signals):
//   plain 52w high, 126d hold : +3.30% vs Nifty -6.18%  = +9.47% excess, beat index 66%
//   volume > 2.5x, 126d hold  : +4.49% vs Nifty -5.91%  = +10.40% excess, beat index 67%
// Longer holds beat shorter ones, which is the opposite of the options result - shares do not
// decay, so time is on your side rather than against it.
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
  return {
    date: day.d, close: day.c, high: day.h, prevClose: prev.c,
    chgPct: prev.c > 0 ? (day.c / prev.c - 1) * 100 : null,
    high52, low52,
    distFromHighPct: (high52 - day.c) / high52 * 100,
    fromLowPct: low52 > 0 ? (day.c / low52 - 1) * 100 : null,
    volX, isHigh,
    // The thrust filter that carried the extra edge in the backtest.
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

module.exports = { analyse, sizePosition, LOOKBACK };
