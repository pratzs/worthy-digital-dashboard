/** @type {import('next').NextConfig} */
// The rep pages and APIs hold people's own sales figures: they must not be framed by another site,
// sniffed, cached, or leak their address in a Referer header.
const repHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
];

const nextConfig = {
  async headers() {
    return [
      { source: '/my-sales', headers: repHeaders },
      { source: '/api/my-sales/:path*', headers: repHeaders },
      { source: '/rep-usage', headers: repHeaders },
      { source: '/api/rep-usage', headers: repHeaders },
    ];
  },
};

export default nextConfig;
