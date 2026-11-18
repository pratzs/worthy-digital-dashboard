/**
 * LinkedIn and TikTok figures typed in by hand once a month, until those companies approve API access.
 * Kept in the shared store (lib/repStore.js) as one small JSON value. Only management can read or write it.
 */
import { kvGet, kvSet } from '@/lib/repStore';

const KEY = 'social:manual:v1';

export const MANUAL_ACCOUNTS = [
  { id: 'li-worthynz',   platform: 'LinkedIn', name: 'Worthy',               link: 'https://www.linkedin.com/company/worthynz/' },
  { id: 'li-vjtrading',  platform: 'LinkedIn', name: 'V J Trading',          link: 'https://www.linkedin.com/company/vjtrading' },
  { id: 'tt-worthyprod', platform: 'TikTok',   name: '@worthyproducts__',    link: 'https://www.tiktok.com/@worthyproducts__' },
];
export const MANUAL_FIELDS = [
  { id: 'followers',   label: 'Followers at month end' },
  { id: 'views',       label: 'Views / impressions' },
  { id: 'engagements', label: 'Engagements' },
  { id: 'posts',       label: 'Posts' },
];

export async function readManual() {
  try { return JSON.parse((await kvGet(KEY)) || '{}') || {}; } catch { return {}; }
}

/** Save one account's figures for one month ("YYYY-MM"). Blank fields are stored as null. */
export async function saveManual({ account, month, values, person }) {
  if (!MANUAL_ACCOUNTS.some((a) => a.id === account)) throw new Error('Unknown account');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw new Error('Month must look like 2026-11');
  const clean = {};
  for (const f of MANUAL_FIELDS) {
    const v = values?.[f.id];
    if (v === '' || v === null || v === undefined) { clean[f.id] = null; continue; }
    const n = Number(String(v).replace(/[,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new Error(`${f.label} must be a number`);
    clean[f.id] = Math.round(n);
  }
  const all = await readManual();
  all[account] = { ...(all[account] || {}), [month]: { ...clean, by: person || null, at: new Date().toISOString() } };
  await kvSet(KEY, JSON.stringify(all));
  return all;
}
