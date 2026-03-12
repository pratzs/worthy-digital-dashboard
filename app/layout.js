import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Worthy Products · Analytics Dashboard",
  description: "Live Shopify analytics for Worthy Products NZ — wholesale confectionery & beverages distributor.",
  icons: {
    icon: [
      { url: "/favicon.png",  sizes: "32x32",  type: "image/png" },
      { url: "/favicon.png",  sizes: "16x16",  type: "image/png" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180" },
    shortcut: "/favicon.png",
  },
  openGraph: {
    title: "Worthy Products Analytics",
    description: "Wholesale confectionery & beverages — NZ distributor dashboard",
    images: [{ url: "/logo-white.png" }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <meta name="theme-color" content="#2256c2" />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}