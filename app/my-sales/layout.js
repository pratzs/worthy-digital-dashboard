export const metadata = {
  title: 'Worthy My Account',
  description: 'Ask about your own sales and your own customers.',
  robots: { index: false, follow: false },
};

// Fill the whole phone screen, including around a notch or home bar.
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function MySalesLayout({ children }) {
  return (
    <>
      {/* This page owns the whole screen: no default browser margin, and no sideways scrolling on any device. */}
      <style>{'html,body{margin:0;padding:0;background:#FAF8F5;overflow-x:hidden}*{box-sizing:border-box}'}</style>
      {children}
    </>
  );
}
