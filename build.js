#!/usr/bin/env node
// Generates docs/data.json - everything the page needs, precomputed.
//
// The point is that the published dashboard needs NO server at all. A browser cannot call Yahoo
// directly (CORS), which is the only reason a server ever existed here; move that fetch into a
// scheduled build and the page becomes a static file that loads in under a second, for free,
// forever, with no container to wake up.
//
// Run locally:  node build.js
// In CI:        see .github/workflows/update.yml
const fs = require('fs');
const path = require('path');
const { fnoUnderlyings, toYahoo } = require('./universe');
const { scan } = require('./yahoo');
const { analyse } = require('./screen');
const { highDates } = require('./history');

const OUT = path.join(__dirname, 'docs', 'data.json');
const r2 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 100) / 100;

(async () => {
  const t0 = Date.now();
  const syms = await fnoUnderlyings();
  console.log(`universe: ${syms.length} symbols`);

  const { data, failed } = await scan(syms, toYahoo, (i, n) => {
    if (i % 25 === 0) console.log(`  ${i}/${n}`);
  });
  console.log(`fetched ${Object.keys(data).length}, failed ${failed.length}`);

  const rows = [];
  const hist = {};
  for (const [sym, d] of Object.entries(data)) {
    const a = analyse(d.candles);
    if (!a) continue;
    rows.push({
      s: sym, ca: d.corporateAction ? 1 : 0,
      c: r2(a.close), ch: r2(a.chgPct), vx: r2(a.volX),
      dh: r2(a.distFromHighPct), fl: r2(a.fromLowPct),
      r21: r2(a.ret21), r63: r2(a.ret63),
      hi: a.isHigh ? 1 : 0, th: a.isThrust ? 1 : 0,
      dsh: a.daysSinceHigh, h52: r2(a.high52)
    });

    // Peak and trough of the closes AFTER each 52-week high, precomputed so the page can build a
    // paper portfolio for any budget or start date without shipping 500 candles per stock.
    // Walking backwards makes it one pass instead of one scan per hit.
    const cs = d.candles;
    const idx = {}; cs.forEach((c, i) => { idx[c.d] = i; });
    const hits = highDates(cs);
    let pk = -Infinity, tr = Infinity;
    const after = [];
    for (let i = cs.length - 1; i >= 0; i--) { after[i] = { pk, tr }; pk = Math.max(pk, cs[i].c); tr = Math.min(tr, cs[i].c); }
    hist[sym] = hits.map(h => {
      const i = idx[h.date];
      const a2 = after[i] || { pk: -Infinity, tr: Infinity };
      return {
        d: h.date, ph: r2(h.priorHigh), o: r2(h.open), l: r2(h.low), c: r2(h.close),
        vx: r2(h.volX), th: h.thrust ? 1 : 0,
        pk: isFinite(a2.pk) ? r2(a2.pk) : null,
        tr: isFinite(a2.tr) ? r2(a2.tr) : null
      };
    });
  }

  rows.sort((a, b) => (b.th - a.th) || (b.hi - a.hi) || ((b.r63 ?? -99) - (a.r63 ?? -99)));
  const asOf = rows.length ? analyse(data[rows[0].s].candles).date : null;

  const payload = { asOf, generatedAt: new Date().toISOString(), failed, rows, hist };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  const kb = fs.statSync(OUT).size / 1024;
  console.log(`wrote docs/data.json  ${kb.toFixed(0)} KB  asOf ${asOf}  ${rows.length} rows  ` +
              `${Object.values(hist).reduce((s, h) => s + h.length, 0)} high-dates  ` +
              `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!rows.length) { console.error('no rows - failing so CI does not commit an empty file'); process.exit(1); }
})().catch(e => { console.error('build failed:', e.message); process.exit(1); });
