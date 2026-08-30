// The tradeable universe, built from Kite's PUBLIC instrument dump - no access token, no login.
// That is the whole point of this app: it must keep working on a day nobody has logged in.
const axios = require('axios');

// Kite's NFO dump lists every underlying that has options, which is a good proxy for "liquid
// enough to trade". Its `name` field is the NSE symbol, which Yahoo takes as SYMBOL.NS.
async function fnoUnderlyings() {
  const dump = (await axios.get('https://api.kite.trade/instruments/NFO', { timeout: 40000 })).data;
  const lines = dump.split('\n');
  const h = lines[0].split(',');
  const iName = h.indexOf('name'), iType = h.indexOf('instrument_type');
  const set = new Set();
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    if (f[iType] !== 'CE') continue;
    const n = String(f[iName]).replace(/"/g, '').trim();
    // Index options have no equity line on Yahoo; only single stocks are wanted here.
    if (n && !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX)/.test(n)) set.add(n);
  }
  return [...set].sort();
}

// NSE tickers map to Yahoo as SYMBOL.NS. The only characters that need care are & and the
// hyphen in names like BAJAJ-AUTO, both of which Yahoo accepts once URL-encoded.
const toYahoo = sym => encodeURIComponent(sym) + '.NS';

// Strike ladder, lot size and expiries per underlying - all from the same PUBLIC dump, so this
// still needs no login. What it CANNOT give is the premium: option prices need an authenticated
// quote call. So the screen can say which contract to buy and what one lot controls, but not what
// it costs. That gap is real and is labelled as such on the page.
async function optionChain() {
  const dump = (await axios.get('https://api.kite.trade/instruments/NFO', { timeout: 40000 })).data;
  const lines = dump.split('\n');
  const h = lines[0].split(',');
  const iSym = h.indexOf('tradingsymbol'), iName = h.indexOf('name'), iExp = h.indexOf('expiry');
  const iStr = h.indexOf('strike'), iLot = h.indexOf('lot_size'), iType = h.indexOf('instrument_type');
  const out = {};
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    if (f[iType] !== 'CE') continue;
    const n = String(f[iName]).replace(/"/g, '').trim();
    if (!n) continue;
    const exp = String(f[iExp]).trim(), k = Number(f[iStr]), lot = Number(f[iLot]);
    if (!exp || !(k > 0) || !(lot > 0)) continue;
    const u = out[n] || (out[n] = { lot, byExpiry: {} });
    u.lot = lot;
    (u.byExpiry[exp] = u.byExpiry[exp] || []).push({ k, sym: String(f[iSym]).trim() });
  }
  for (const u of Object.values(out)) for (const e of Object.values(u.byExpiry)) e.sort((a, b) => a.k - b.k);
  return out;
}

module.exports = { fnoUnderlyings, toYahoo, optionChain };
