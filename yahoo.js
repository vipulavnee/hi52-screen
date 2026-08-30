// Yahoo price adapter.
//
// Validated 2026-08-29 against Kite across 5 stocks x 9 sessions: every close and every volume
// matched to the paisa. That is why the 52-week-high and volume-thrust screens can run here.
//
// Caveats, deliberately visible because this is an UNDOCUMENTED endpoint:
//   - Yahoo's batch quote route (v7/finance/quote) now returns 401. Only the per-symbol v8 chart
//     route works, so a full universe scan is ~200 requests and has to be throttled and cached.
//   - It can change or start rate-limiting without notice. Treat a scan failure as normal.
//   - `quote` is UNADJUSTED and `adjclose` is adjusted for splits/dividends. A 52-week high must
//     be computed on ONE consistent series or a split silently invents a false breakout. This
//     module returns unadjusted OHLC and flags any day where the two diverge by more than 1%,
//     which is what a corporate action looks like.
const axios = require('axios');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: '*/*' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function daily(yahooSymbol, range = '2y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=${range}&interval=1d`;
  const r = await axios.get(url, { timeout: 20000, headers: UA });
  const res = r.data?.chart?.result?.[0];
  if (!res || !res.timestamp) return null;
  const q = res.indicators.quote[0];
  const adj = res.indicators.adjclose?.[0]?.adjclose;
  const out = [];
  let corporateAction = false;
  for (let i = 0; i < res.timestamp.length; i++) {
    if (q.close[i] == null || q.high[i] == null) continue;      // Yahoo leaves holidays as null
    if (adj && adj[i] != null && Math.abs(adj[i] / q.close[i] - 1) > 0.01) corporateAction = true;
    out.push({
      d: new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10),
      o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0
    });
  }
  return { candles: out, corporateAction, last: res.meta?.regularMarketPrice ?? null };
}

// Sequential with a small gap. Concurrency gets throttled fast and a half-finished scan is worse
// than a slow one, so this trades speed for actually completing.
async function scan(symbols, toYahoo, onProgress) {
  const data = {}, failed = [];
  for (let i = 0; i < symbols.length; i++) {
    try {
      const d = await daily(toYahoo(symbols[i]));
      if (d && d.candles.length > 260) data[symbols[i]] = d;
      else failed.push(symbols[i]);
    } catch (e) { failed.push(symbols[i]); }
    if (onProgress && i % 25 === 0) onProgress(i, symbols.length);
    await sleep(120);
  }
  return { data, failed };
}

module.exports = { daily, scan };
