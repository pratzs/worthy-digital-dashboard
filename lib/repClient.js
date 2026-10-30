/**
 * Where a request came from, for the management usage log: the internet address, the approximate place Vercel
 * works out from it (city and region, not a street or suburb), and the device, system and browser from the
 * browser's own description of itself. Nothing here is asked of the person; it is what every web request carries.
 */
const dec = (v) => { try { return v ? decodeURIComponent(v) : null; } catch { return v || null; } };

function describeAgent(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /SamsungBrowser\//.test(s) ? 'Samsung Internet' : /OPR\//.test(s) ? 'Opera'
    : /Firefox\//.test(s) ? 'Firefox' : /CriOS\//.test(s) ? 'Chrome' : /Chrome\//.test(s) ? 'Chrome'
    : /Safari\//.test(s) && /Version\//.test(s) ? 'Safari' : /curl\//.test(s) ? 'curl (script)' : s ? 'Other' : null;
  const system = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows NT/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : s ? 'Other' : null;
  const device = /iPad|Tablet/.test(s) ? 'Tablet' : /Mobile|iPhone|Android/.test(s) ? 'Phone' : s ? 'Computer' : null;
  return { device, system, browser };
}

export function clientInfo(request) {
  const h = request.headers;
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || null;
  const city = dec(h.get('x-vercel-ip-city'));
  const region = dec(h.get('x-vercel-ip-country-region'));
  const country = h.get('x-vercel-ip-country');
  return {
    ip,
    place: [city, region, country].filter(Boolean).join(', ') || null,
    ...describeAgent(h.get('user-agent')),
    ua: String(h.get('user-agent') || '').slice(0, 160),
  };
}
