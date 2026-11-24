/**
 * worthy.nz website enquiries: who filled in which Contact Form 7 form (name, email, business, message) and who the
 * form emails (To and Cc). Read from the site's read-only endpoint (Code Snippets: "Command Center: website enquiries"),
 * which answers only with the key in WORTHY_FORMS_KEY. Management only, through /api/command.
 */
const URL_BASE = process.env.WORTHY_FORMS_URL || 'https://worthy.nz/wp-json/worthy/v1/enquiries';
export const formsConfigured = () => Boolean(process.env.WORTHY_FORMS_KEY);

// Field names differ by form; these pick out the usual ones.
const pickField = (f, re) => { const k = Object.keys(f).find((x) => re.test(x)); return k ? f[k] : ''; };

export async function worthyEnquiries(start, end) {
  if (!formsConfigured()) return { status: 'not_connected' };
  const res = await fetch(`${URL_BASE}?since=${start}&until=${end}`, {
    headers: { 'X-Worthy-Key': process.env.WORTHY_FORMS_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000), cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`worthy.nz ${res.status}: ${j.message || 'error'}`.slice(0, 200));
  const forms = new Map((j.forms || []).map((f) => [f.id, f]));
  return {
    status: 'ok', timezone: j.timezone,
    entries: (j.entries || []).map((e) => {
      const f = e.fields || {};
      const form = forms.get(e.form) || {};
      return {
        id: e.id, at: e.at, form: form.title || `Form ${e.form}`, to: form.to || '', cc: form.cc || '',
        name: pickField(f, /name/i) || [pickField(f, /first/i), pickField(f, /last/i)].filter(Boolean).join(' '),
        email: pickField(f, /e-?mail/i),
        phone: pickField(f, /phone|mobile/i),
        business: pickField(f, /business|company|store|shop/i),
        message: pickField(f, /message|comment|enquiry|notes?/i),
        fields: f,
      };
    }),
  };
}
