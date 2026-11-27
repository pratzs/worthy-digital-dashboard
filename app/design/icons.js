/**
 * One icon set for the whole dashboard (24px grid, 1.6 stroke, round caps and joins). Icons take the colour of the text
 * around them. Pick the icon that fits the title it sits beside; never use emoji or arrow characters instead.
 */
export const PATHS = {
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  flow: <><circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="12" r="2.2" /><path d="M7.2 6H11a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3M7.2 18H11a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  chev: <path d="m9 6 6 6-6 6" />,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  click: <><path d="m9 9 11 4-5 2-2 5Z" /><path d="M5 3v3M3 5h3M3.5 9.5 5.5 8M9.5 3.5 8 5.5" /></>,
  cart: <><path d="M3 4h2.5l2.2 11h10.6L20.5 7H7" /><circle cx="9.5" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="m7 15 4-4 3 3 5-6" /></>,
  out: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  move: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z" />,
  bag: <><path d="M6 7h12l1 13H5Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>,
  store: <><path d="M4 9 5.5 4h13L20 9" /><path d="M4 9h16v1.5a2.7 2.7 0 0 1-5.3.6 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 10.5Z" /><path d="M5.5 13v7h13v-7" /><path d="M10 20v-4h4v4" /></>,
  building: <><path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" /><path d="M16 10h2.5a1.5 1.5 0 0 1 1.5 1.5V21" /><path d="M3 21h18" /><path d="M9 7h3M9 11h3M9 15h3" /></>,
  funnel: <path d="M3.5 5h17l-6.5 8v5.5l-4 2V13Z" />,
  megaphone: <><path d="M4 10v4l12 5V5Z" /><path d="M16 9.5a3 3 0 0 1 0 5" /><path d="M7 15l1.2 4.5h2.6L10 16.3" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></>,
  devices: <><rect x="2.5" y="5" width="13" height="10" rx="1.5" /><path d="M6 19h6M9 15v4" /><rect x="17.5" y="8" width="4" height="11" rx="1.2" /></>,
  bars: <><path d="M4 20h16" /><path d="M7 16v-5M12 16V6M17 16v-8" /></>,
  pie: <><path d="M12 3a9 9 0 1 0 9 9h-9Z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0" /><path d="M15.5 5.5a3.2 3.2 0 0 1 0 6.2M17.5 14a5.5 5.5 0 0 1 3.5 5.5" /></>,
  instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="3.8" /><circle cx="17" cy="7" r="0.7" fill="currentColor" stroke="none" /></>,
  facebook: <path d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.6 1.6-1.6h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.3H8.9v3h2.6V21" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  dollar: <><path d="M12 3v18" /><path d="M16.5 7.5C16 6 14.3 5 12 5 9.5 5 8 6.3 8 8c0 4 8.5 2.5 8.5 7 0 1.8-1.7 3-4.5 3-2.4 0-4.1-1-4.6-2.6" /></>,
  // from the main dashboard set
  trophy: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>,
  alert: <><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 17h.01" /></>,
  userMinus: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M17 11h6" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  award: <><circle cx="12" cy="9" r="6" /><path d="M8.5 14.5 7 22l5-3 5 3-1.5-7.5" /></>,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  hourglass: <path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 2 4l3 2-3 2a5 5 0 0 0-2 4v4M17 2v4a5 5 0 0 1-2 4l-3 2 3 2a5 5 0 0 1 2 4v4" />,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  gem: <><path d="M6 3h12l4 6-10 12L2 9z" /><path d="M2 9h20M9 3 8 9l4 12M15 3l1 6-4 12" /></>,
  cloud: <path d="M17.5 19H7a5 5 0 1 1 1-9.9 6 6 0 0 1 11.5 2.4A3.8 3.8 0 0 1 17.5 19z" />,
  sparkle: <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />,
  receipt: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  forecast: <path d="M3 17l6-6 4 4 8-9M15 6h6v6" />,
  trending: <path d="M22 7l-8.5 8.5-5-5L2 17M16 7h6v6" />,
  percent: <><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  wallet: <><path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h13M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>,
};

export const Icon = ({ n, name, size = 16, stroke = 1.6, className, style }) => {
  const key = n || name;
  if (key === "tri-up" || key === "tri-down") {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} style={style}>{key === "tri-up" ? <path d="M12 4l9 16H3z" /> : <path d="M12 20 3 4h18z" />}</svg>;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={className} style={{ flexShrink: 0, ...style }}>{PATHS[key] || null}</svg>
  );
};
