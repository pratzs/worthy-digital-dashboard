/**
 * worthy.nz website enquiries: who filled in which Contact Form 7 form (name, email, business, message) and who the
 * form emails (To and Cc). Read from the site's read-only endpoint (Code Snippets: "Command Center: website enquiries"),
 * which answers only with the key in WORTHY_FORMS_KEY. Management only, through /api/command.
 */
const URL_BASE = process.env.WORTHY_FORMS_URL || 'https://worthy.nz/wp-json/worthy/v1/enquiries';
export const formsConfigured = () => Boolean(process.env.WORTHY_FORMS_KEY);

// Field names differ by form; each list is tried in order, so "contact-name" wins over "business-name".
const pickField = (f, ...res) => { for (const re of res) { const k = Object.keys(f).find((x) => re.test(x)); if (k && f[k]) return f[k]; } return ''; };
const decode = (t) => String(t || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// The site keeps entry times in its own timezone (UTC on worthy.nz). Show and match them in NZ time.
function toNz(at, tz) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz || '+00:00');
  const offMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const utc = Date.parse(`${String(at).replace(' ', 'T').slice(0, 19)}Z`) - offMin * 60000;
  const p = new Date(utc).toLocaleString('en-CA', { timeZone: 'Pacific/Auckland', hour12: false }).replace(',', '');
  return p.slice(0, 16).replace(/^(\d{4}-\d{2}-\d{2}) 24:/, '$1 00:');
}

export async function worthyEnquiries(start, end) {
  if (!formsConfigured()) return { status: 'not_connected' };
  // A day either side, then cut to the NZ dates asked for
  const res = await fetch(`${URL_BASE}?since=${addDays(start, -1)}&until=${addDays(end, 1)}`, {
    headers: { 'X-Worthy-Key': process.env.WORTHY_FORMS_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000), cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`worthy.nz ${res.status}: ${j.message || 'error'}`.slice(0, 200));
  const forms = new Map((j.forms || []).map((f) => [f.id, f]));
  return {
    status: 'ok', timezone: j.timezone,
    entries: (j.entries || []).map((e) => {
      const f = Object.fromEntries(Object.entries(e.fields || {}).map(([k, v]) => [k, decode(v)]));
      const form = forms.get(e.form) || {};
      return {
        // A recipient like [which-division] is chosen on the form; show what was picked
        id: e.id, at: toNz(e.at, j.timezone), form: decode(form.title) || `Form ${e.form}`,
        to: String(form.to || '').replace(/\[([\w-]+)\]/g, (m, k) => (!f[k] ? m : /@/.test(f[k]) ? f[k] : `${f[k]} (picked on the form)`)),
        cc: String(form.cc || '').replace(/\[([\w-]+)\]/g, (m, k) => f[k] || m),
        name: pickField(f, /contact[-_ ]?name/i, /your[-_ ]?name/i, /^(full[-_ ]?)?name$/i, /^(?!.*(business|company|store|shop)).*name/i)
          || [pickField(f, /first/i), pickField(f, /last/i)].filter(Boolean).join(' '),
        email: pickField(f, /e-?mail/i),
        phone: pickField(f, /phone|mobile/i),
        business: pickField(f, /business[-_ ]?name|company/i, /store|shop/i),
        message: pickField(f, /message|comment|enquiry|notes?/i),
        fields: f,
      };
    }).filter((e) => e.at.slice(0, 10) >= start && e.at.slice(0, 10) <= end),
  };
}
