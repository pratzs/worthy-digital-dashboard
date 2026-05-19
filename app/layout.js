export const metadata = {
  title: "Worthy - Accounting Dashboard",
  description: "Internal accounting dashboard for Worthy — restricted access.",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
    ],
    shortcut: "/favicon.png",
    apple:    "/favicon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/png" href="/favicon.png" sizes="32x32" />
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}