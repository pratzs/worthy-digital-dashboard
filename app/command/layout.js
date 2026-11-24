import { Outfit } from 'next/font/google';
import './reset.css';

const outfit = Outfit({ subsets: ['latin'], weight: ['200', '300', '400', '500', '600'], display: 'swap' });

export const metadata = { title: 'Worthy Command Center' };

export default function CommandLayout({ children }) {
  return <div className={`${outfit.className} cc-root`}>{children}</div>;
}
