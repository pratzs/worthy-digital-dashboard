/**
 * Shared Ostendo access + money maths for Worthy Products South (Dutch Rusk).
 *
 * WHY THIS FILE EXISTS
 * Three routes each kept their own copy of the rep-name map, their own HTTPS
 * helper and their own rounding. They drifted. Everything Ostendo-related now
 * lives here so there is exactly one definition of each.
 *
 * MONEY IS COUNTED IN INTEGER MICRO-DOLLARS (millionths of a dollar).
 * Firebird hands back values like 12216073.7299999, and unit costs carry more
 * precision than a cent — INVOICEQTY * INVOICEUNITCOST is routinely a fraction
 * of a cent. Adding those as floats drifts; rounding each one to a cent BEFORE
 * adding drifts differently, which is how per-rep cost came to be a few cents
 * away from the same figure aggregated in one pass.
 *
 * So every amount becomes an exact integer on the way in, stays an integer
 * through every addition, and is rounded to the nearest cent exactly once, on
 * the way out. Totals tie to Ostendo to the cent, and the parts add up to the
 * whole with nothing left over.
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
  '410': 'Jerry',
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

/* ── Money: exact integers in, dollars rounded to the cent out ────────────── */
const SCALE = 1_000_000;                       // one unit = one micro-dollar
/** Dollars (or a float from Firebird) -> exact integer units. */
export const toCents   = (v) => Math.round((Number(v) || 0) * SCALE);
/** Integer units -> dollars, rounded to the nearest cent exactly once. */
export const toDollars = (u) => Math.round((u || 0) / 10000) / 100;
/** Percentage to 1dp, or null when the base is zero or negative. */
export const pct1 = (num, den) =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

/* ── Is a margin worth showing? ───────────────────────────────────────────────
 * A margin is only meaningful when the source system holds a cost for (nearly)
 * everything that was sold. Where it does not — freight, service and other
 * lines carrying no cost — the margin reads close to 100% because the cost is
 * MISSING, not because the sale was that good. Below this share of revenue the
 * margin is withheld rather than shown wrong. Revenue is always counted in full.
 */
export const COST_COVERAGE_MIN = 0.95;
export const costCovered = (revenue, costedRevenue) =>
  revenue > 0 ? (costedRevenue || 0) / revenue >= COST_COVERAGE_MIN : true;

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
/**
 * Today, as Worthy's office would call it.
 *
 * Both companies trade in New Zealand; the server runs on UTC. NZ is 12-13
 * hours ahead, so for the first half of every working day `new Date()` still
 * reads yesterday — the period ended "17 Sep" while the office was already
 * invoicing on the 18th, and the banner said so. Every "today" in this
 * dashboard is the New Zealand date, never the server's.
 */
export const NZ_TZ = 'Pacific/Auckland';
export function nzToday(now = new Date()) {
  // en-CA formats as YYYY-MM-DD, which is the shape the rest of this file wants.
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** The NZ financial year that the NZ date falls in (April→March). */
export function nzFinancialYear(now = new Date()) {
  const [y, m] = nzToday(now).split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export function fyRange(fy, today = nzToday()) {
  const start   = `${fy}-04-01`;
  const lastDay = `${fy + 1}-03-31`;
  const todayIso = typeof today === 'string' ? today : iso(today);
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
