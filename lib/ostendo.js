/**
 * Shared Ostendo access + money maths for Worthy Products South (Dutch Rusk).
 *
 * WHY THIS FILE EXISTS
 * Three routes each kept their own copy of the rep-name map, their own HTTPS
 * helper and their own rounding. They drifted. Everything Ostendo-related now
 * lives here so there is exactly one definition of each.
 *
 * MONEY IS COUNTED IN WHOLE CENTS.
 * Firebird hands back values like 12216073.7299999. Adding thousands of those
 * as floats drifts by cents. Every amount is converted to an integer number of
 * cents on the way in, summed as integers, and converted back to dollars only
 * when it leaves. Totals therefore tie to Ostendo exactly, not approximately.
 */
import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });

/* ── Sales rep codes ──────────────────────────────────────────────────────────
 * Ostendo has no salesperson master table (SALESPERSON / SALESPEOPLE /
 * EMPLOYEEMASTER all return "Table unknown"), so the code→name mapping has to
 * live here. Codes with a "-1" style suffix are legacy clearance accounts and
 * roll up to the same person.
 * Any code not listed renders as the raw code, which is the signal to add it.   */
export const REP_NAMES = {
  '410': 'Kevin',
  '420': 'Michelle',
  '430': 'Keith',
  '450': 'Christchurch Office / Online',
  '460': 'Chris',
  '461': 'Ravi Kumar',
  '470': 'Lynette',
  '490': 'Leith',
};

export const resolveRep = (raw) => {
  const code = String(raw ?? '').trim();
  if (!code) return 'Unassigned';
  const base = code.replace(/-\d+$/, '');
  return REP_NAMES[base] || REP_NAMES[code] || code;
};

/* ── Money: integer cents in, dollars out ─────────────────────────────────── */
export const toCents   = (v) => Math.round((Number(v) || 0) * 100);
export const toDollars = (c) => (c || 0) / 100;
/** Percentage to 1dp, or null when the base is zero/negative-only. */
export const pct1 = (numCents, denCents) =>
  denCents > 0 ? Math.round((numCents / denCents) * 1000) / 10 : null;

/* ── Dates ────────────────────────────────────────────────────────────────── */
export const iso = (d) => {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
export const parseIso = (s) => new Date(`${String(s).substring(0, 10)}T00:00:00Z`);
/** Ostendo returns either YYYY-MM-DD... or D/M/YYYY. Normalise to YYYY-MM-DD. */
export const normaliseDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d) ? null : iso(d);
};

export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Dutch Rusk trades on an April→March financial year.
 * FY2026 means 1 Apr 2026 → 31 Mar 2027.
 * `end` never runs past today, so a year in progress is never padded with
 * empty months pretending to be zero sales.
 */
export function fyRange(fy, today = new Date()) {
  const start   = `${fy}-04-01`;
  const lastDay = `${fy + 1}-03-31`;
  const todayIso = iso(today);
  const end      = todayIso < lastDay ? todayIso : lastDay;
  return { start, end, lastDay, complete: todayIso >= lastDay };
}

/** The same span one year earlier — the only honest basis for a comparison. */
export function priorRange({ start, end }) {
  const shift = (s) => {
    const d = parseIso(s);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return iso(d);
  };
  return { start: shift(start), end: shift(end) };
}

/** The 12 months of a financial year, in trading order. */
export function fyMonthKeys(fy) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mi = (3 + i) % 12;            // 3 = April
    const yr = fy + (mi < 3 ? 1 : 0);   // Jan-Mar belong to the next calendar year
    out.push({ key: `${yr}-${String(mi + 1).padStart(2, '0')}`, label: MONTH_NAMES[mi], year: yr, monthIdx: mi });
  }
  return out;
}

/* ── Ostendo transport ────────────────────────────────────────────────────── */

/**
 * POST /sqlquery with a raw SELECT. Aggregation happens inside Firebird, so a
 * year of trading comes back as a few hundred rows instead of ~330,000 line
 * rows fetched 60 invoices at a time (which is what used to time the route out).
 */
export function ostendoSql(sql, timeoutMs = 40000) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;
  if (!base || !apiKey) return Promise.reject(new Error('Ostendo credentials are not configured'));

  const urlObj = new URL(base);
  const body   = Buffer.from(sql, 'utf8');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     `/sqlquery?apikey=${encodeURIComponent(apiKey)}&format=json`,
      method:   'POST',
      agent,
      headers:  { 'Content-Type': 'text/plain', 'Content-Length': body.length },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch {
          // Ostendo reports SQL errors as an XML document with status=error.
          const msg = /<value>([\s\S]*?)<\/value>/.exec(raw)?.[1] || raw.substring(0, 200);
          return reject(new Error(`Ostendo SQL rejected: ${msg.trim()}`));
        }
        resolve(Array.isArray(parsed) ? parsed : parsed?.rows || parsed?.data || parsed?.records || []);
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Ostendo timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Single-quote a value for a Firebird literal. */
export const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
