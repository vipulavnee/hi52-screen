# 52-Week High Screen

Daily screen of NSE F&O stocks printing a 52-week high, with position sizing.

**No broker login.** The universe comes from Kite's public instrument dump and prices come from
Yahoo, so nothing here expires overnight and there is no account data on the page — it shows a
market screen, not a portfolio.

    npm install
    node server.js          # http://localhost:3002

## What it shows

- Every F&O stock at a new 52-week high, and how far the rest are from theirs
- **Thrust** tag where the breakout came on more than 2.5x average volume
- Set a rupee budget per position; it works out how many whole shares that buys
- 21-day and 63-day returns, distance off the 52-week low, sessions since the last high

## Why equal rupees, not one share each

Signal prices span ₹10 to ₹48,895 — a 4,904x spread. One share each would let whichever
expensive stock happened to signal dominate the book, for reasons unconnected to how strong
the signal was. A fixed rupee budget keeps positions comparable.

## Evidence

Backtested on 210 F&O names, Aug 2025 – Aug 2026, 2,461 signals:

| Screen | 126-day return | Nifty | Excess | Beat index |
|---|---|---|---|---|
| Any 52-week high | +3.30% | −6.18% | **+9.47%** | 66% |
| Volume > 2.5x | +4.49% | −5.91% | **+10.40%** | 67% |

Longer holds beat shorter ones. Shares do not decay, so time works for you rather than against
you — the opposite of the options version of this idea.

## Limits worth keeping in view

- **Yahoo is undocumented.** Its batch quote route already returns 401; only the per-symbol chart
  route works, so a full scan is ~210 sequential requests and can be throttled without notice.
  Prices were verified identical to Kite across 5 stocks x 9 sessions, but that is a spot check,
  not a guarantee.
- **Corporate actions.** A `split?` tag means adjusted and unadjusted closes disagree by more than
  1%, which usually means a split or bonus is distorting that stock's 52-week high. Check those by
  hand — COFORGE and OFSS both flagged on the first live run.
- **One year is not an edge.** The backtest window was a falling market, which flatters a
  relative-strength screen. Whether the excess survives a rising market is untested.
- Options data is not available without a broker token, so nothing here prices premiums.

## How it is published

The dashboard is a **static page**.  reads  and nothing else -
no server, no API, no login. GitHub Pages serves it, so it loads in well under a second and there
is no container to wake up.

A browser cannot call Yahoo directly (CORS), which was the only reason a server ever existed here.
Moving that fetch into a scheduled build removed the need for one.

    node build.js       # fetches Yahoo, writes docs/data.json (~70s, 257 KB)

 runs that at 11:00 UTC (16:30 IST) on weekdays and commits the
result. **Refresh manually** from the Actions tab -> Update screen data -> Run workflow. The build
exits non-zero if it produced no rows, so a Yahoo outage fails loudly rather than quietly
committing an empty file over good data.

 is still here for local use and serves the same  folder, with an extra
 for a live refetch. It is optional; the published site never touches it.

## Deploying to Render (optional)

`render.yaml` is ready for Render's free plan. No environment variables, no secrets.

The free tier has no disk and spins down when idle, so the cache is lost and the first visit after
a sleep triggers a fresh scan (~2 minutes, with progress shown). Add a disk and set `STATE_DIR` to
keep the cache between restarts.
