import localFont from 'next/font/local';
import './reset.css';

// Outfit served from the repo (@fontsource-variable/outfit, SIL Open Font License), so a build never waits on Google Fonts.
const outfit = localFont({ src: '../../node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2', weight: '200 600', display: 'swap' });

export const metadata = { title: 'Worthy Command Center' };

export default function CommandLayout({ children }) {
  return <div className={`${outfit.className} cc-root`}>{children}</div>;
}
