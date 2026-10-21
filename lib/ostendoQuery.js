/**
 * Generic, read-only access to Ostendo for the chat/MCP tools. Ostendo has no
 * ORM/domain layer like Odoo - it's raw SQL (Firebird) via ostendoSql() - so
 * the safety story here is different and weaker: there's no structural way
 * to stop a SELECT from reading a table nobody meant to expose. What IS
 * enforced: only a single SELECT statement is ever allowed to reach Ostendo
 * (no INSERT/UPDATE/DELETE/DDL, no stacked statements), the row count is
 * always capped, and a few column names are always stripped from the result
 * regardless of what the query asked for (e.g. SUPPLIERMASTER genuinely has
 * BANKACCOUNTNAME/BANKACCOUNTNUMBER columns - found live, not guessed).
 */
import { ostendoSql } from '@/lib/ostendo';

const MAX_ROWS = 500;

// A single keyword anywhere in the text is enough to refuse - this is a
// blocklist (unlike Odoo's model denylist), which is weaker in principle, but
// SQL has no equivalent of "list the allowed models" the way Odoo's ORM
// does. Refusing to run at all if any of these appear, even inside what
// looks like a comment or a string, is deliberately paranoid about that.
const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|call)\b/i;

// Column names stripped from every row, whatever the query selected.
const ALWAYS_REDACTED = new Set([
  'BANKACCOUNTNAME', 'BANKACCOUNTNUMBER', 'PASSWORD', 'APIKEY', 'ACCESSTOKEN', 'SECRET',
]);

function assertSafe(sql) {
  const trimmed = String(sql || '').trim();
  if (!trimmed) throw new Error('No SQL provided.');
  if (!/^select\b/i.test(trimmed)) throw new Error('Only a single SELECT statement is allowed.');
  // A semicolon anywhere but trailing whitespace at the very end means more
  // than one statement was submitted - refuse rather than guess which part
  // is "the real" query.
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) throw new Error('Only a single statement is allowed.');
  if (FORBIDDEN.test(withoutTrailingSemicolon)) {
    throw new Error('That statement contains a word that is not allowed in a read-only query.');
  }
  return withoutTrailingSemicolon;
}

function strip(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (!ALWAYS_REDACTED.has(k.toUpperCase())) out[k] = v;
    }
    return out;
  });
}

// Confirmed live against production: a plain SELECT that genuinely matches
// ZERO rows comes back from Ostendo's own API as one row with every column
// set to an empty string, not an empty array (COUNT(*) on the identical
// filter correctly returns 0, so this is Ostendo's quirk, not ours). Left
// unfiltered, "no matches" would look to the AI like it found one real
// result with every field blank - exactly the kind of wrong-but-confident
// answer this chat has to avoid. A genuine real row essentially never has
// every single selected column blank (even "optional" text fields sit
// alongside a real code/number/date column), so dropping an all-empty row
// is safe.
function isPhantomEmptyRow(row) {
  const values = Object.values(row);
  return values.length > 0 && values.every((v) => v === '' || v === null || v === undefined);
}

export async function ostendoQuery({ sql }) {
  const safe = assertSafe(sql);
  // Firebird's row-limit syntax is "SELECT FIRST n ...", not LIMIT/TOP - the
  // query is wrapped as a derived table so this works regardless of whether
  // the caller already wrote their own FIRST/ORDER BY. A query that already
  // computes its own SUM/COUNT/AVG returns one row either way, uncapped and
  // unaffected by this wrapper - exactly how a total should be computed here,
  // the same principle as odoo_aggregate on the Odoo side.
  const wrapped = `SELECT FIRST ${MAX_ROWS} * FROM (${safe}) AS q`;
  const rows = await ostendoSql(wrapped, 45000);
  const real = rows.filter((row) => !isPhantomEmptyRow(row));
  return strip(real);
}
