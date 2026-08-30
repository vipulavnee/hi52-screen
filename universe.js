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

module.exports = { fnoUnderlyings, toYahoo };
