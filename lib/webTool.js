/**
 * The management chat / connector tool get_web_and_social: the same figures as the Social and Web page
 * (lib/webStats.js, lib/socialMeta.js, lib/socialManual.js), for any period. Management only: it is not in the
 * department allow-list in lib/mcpRoles.js, so Purchasing and Business Development are never offered it.
 */
import { webStats, customPeriods } from '@/lib/webStats';
import { metaStats } from '@/lib/socialMeta';
import { readManual, MANUAL_ACCOUNTS } from '@/lib/socialManual';

export async function webAndSocial(input) {
  const site = String(input?.site || 'all').toLowerCase();
  if (!['all', 'worthy', 'worthyproducts', 'dutchrusk', 'social'].includes(site)) throw new Error('site must be all, worthy, worthyproducts, dutchrusk or social.');
  const period = input?.from || input?.to ? customPeriods(input) : null;
  const out = {};
  if (site !== 'social') {
    const w = await webStats({ period, only: site === 'all' ? null : site });
    out.period = { from: w.periods.start, to: w.periods.end, comparedWith: { from: w.periods.prevStart, to: w.periods.prevEnd }, monthsFrom: w.periods.yearStart };
    out.websites = w.sites.map(({ builtAt, ...x }) => x);
    out.websitesBasis = 'Each total is [this period, comparison period]. worthy.nz and dutchrusk.co.nz: Google Analytics (dutchrusk.co.nz revenue is what Google Analytics recorded, not Shopify). worthyproducts.nz: Shopify; sessions, sources, devices and conversion are New Zealand only because overseas bot visits swamp the real traffic; orders and net sales are the Online Store channel, before GST.';
  }
  if (site === 'all' || site === 'social') {
    const m = await metaStats();
    out.facebookAndInstagram = m.status === 'ok'
      ? { accounts: m.accounts, basis: 'Last 30 complete days against the 30 before, as [this period, comparison]. Followers are today.' }
      : { status: m.status === 'not_connected' ? 'not connected yet' : `could not be read: ${m.error}` };
    const manual = await readManual();
    out.linkedInAndTikTok = MANUAL_ACCOUNTS.map((a) => ({ platform: a.platform, account: a.name, months: manual[a.id] || {} }));
    out.linkedInAndTikTokBasis = 'Typed in by hand once a month on the Social and Web page; months with nothing entered are missing.';
  }
  return out;
}
