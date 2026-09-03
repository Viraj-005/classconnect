/*
  Hand drawn icon set on a single 24 grid with a 1.7 stroke and round
  joins. Built rather than pulled from a pack so the product does not
  inherit the same silhouette as every other dashboard, and so the
  weight sits correctly next to Space Grotesk.
*/

const P = {
  pulse: <path d="M3 12h3.4l2.1-6 3.3 12 2.4-8 1.8 4H21" />,
  library: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.4" />
      <rect x="10" y="4" width="5" height="16" rx="1.4" />
      <path d="m17.4 6 3.3 12.6" />
    </>
  ),
  students: (
    <>
      <path d="M12 4 3 8.5l9 4.5 9-4.5L12 4Z" />
      <path d="M6.5 10.8v4.4c0 1.6 2.5 2.9 5.5 2.9s5.5-1.3 5.5-2.9v-4.4" />
      <path d="M21 8.5V14" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 8.2A2.2 2.2 0 0 1 5.2 6h11.3A2.5 2.5 0 0 1 19 8.5V9" />
      <rect x="3" y="9" width="18" height="10" rx="2.3" />
      <circle cx="16.4" cy="14" r="1.15" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9M18.6 18.6l-1.9-1.9M7.3 7.3 5.4 5.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.2-2 6.2h16S18 14 18 9Z" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </>
  ),
  chevronDown: <path d="m6 9.5 6 5.5 6-5.5" />,
  chevronRight: <path d="m9.5 6 5.5 6-5.5 6" />,
  chevronLeft: <path d="M14.5 6 9 12l5.5 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: (
    <>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 15v3.2A1.8 1.8 0 0 0 5.8 20h12.4a1.8 1.8 0 0 0 1.8-1.8V15" />
    </>
  ),
  video: (
    <>
      <rect x="2.6" y="5.6" width="13" height="12.8" rx="2.3" />
      <path d="m15.6 12 5.8-3.4v6.8L15.6 12Z" />
    </>
  ),
  doc: (
    <>
      <path d="M13.6 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.4L13.6 3Z" />
      <path d="M13.4 3.2v5.2H19M8.8 13h6.4M8.8 16.4h4.4" />
    </>
  ),
  quiz: (
    <>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3" />
      <path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.8-.9 1.5v.4" />
      <path d="M12 16.9h.01" />
    </>
  ),
  qr: (
    <>
      <rect x="3.4" y="3.4" width="6.6" height="6.6" rx="1.6" />
      <rect x="14" y="3.4" width="6.6" height="6.6" rx="1.6" />
      <rect x="3.4" y="14" width="6.6" height="6.6" rx="1.6" />
      <path d="M14 14h3v3h-3zM20.6 14v3M17.6 20.6h3M14 20.6h.01" />
    </>
  ),
  check: <path d="m4.6 12.4 4.8 4.8L19.4 7.2" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m8.2 12.3 2.7 2.7 5-5.4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.6 3.9 2.5 17.6A1.6 1.6 0 0 0 3.9 20h16.2a1.6 1.6 0 0 0 1.4-2.4L13.4 3.9a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 9.4v4M12 16.6h.01" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  lock: (
    <>
      <rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2.4" />
      <path d="M8.2 10.2V7.8a3.8 3.8 0 0 1 7.6 0v2.4" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2l-1.7-5.8L4.5 10.7 10.3 9 12 3.2Z" />
      <path d="M18.8 3.4v2.8M20.2 4.8h-2.8" />
    </>
  ),
  logout: (
    <>
      <path d="M14.6 16.6V19a1.8 1.8 0 0 1-1.8 1.8H5.4A1.8 1.8 0 0 1 3.6 19V5A1.8 1.8 0 0 1 5.4 3.2h7.4A1.8 1.8 0 0 1 14.6 5v2.4" />
      <path d="M9.6 12h11M17.4 8.4 21 12l-3.6 3.6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.7 9.6a2.4 2.4 0 1 1 3.2 2.3c-.6.3-.9.8-.9 1.4v.4" />
      <path d="M12 16.6h.01" />
    </>
  ),
  card: (
    <>
      <rect x="2.6" y="5.4" width="18.8" height="13.2" rx="2.4" />
      <path d="M2.6 10h18.8M6.4 14.6h3.2" />
    </>
  ),
  building: (
    <>
      <path d="M4 20.6V5.2A1.6 1.6 0 0 1 5.6 3.6h7.2A1.6 1.6 0 0 1 14.4 5.2v15.4" />
      <path d="M14.4 9.4h4A1.6 1.6 0 0 1 20 11v9.6M2.4 20.6h19.2" />
      <path d="M7.4 7.6h3.6M7.4 11.4h3.6M7.4 15.2h3.6M17 13.6h.01M17 17h.01" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 4.8 6v5.6c0 4.4 3 8 7.2 9.2 4.2-1.2 7.2-4.8 7.2-9.2V6L12 3.2Z" />
      <path d="m9.2 12 2 2 3.6-3.9" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.6v11.2M8 11l4 4 4-4" />
      <path d="M4 16.4v2A1.9 1.9 0 0 0 5.9 20.3h12.2a1.9 1.9 0 0 0 1.9-1.9v-2" />
    </>
  ),
  filter: <path d="M3.4 5.6h17.2l-6.6 7.6v5.6l-4 2v-7.6L3.4 5.6Z" />,
  more: (
    <>
      <circle cx="5.4" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.6" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  play: <path d="M7.6 4.9 19 12 7.6 19.1V4.9Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.2V12l3.2 1.9" />
    </>
  ),
  mail: (
    <>
      <rect x="2.8" y="5" width="18.4" height="14" rx="2.3" />
      <path d="m3.4 6.6 8.6 6 8.6-6" />
    </>
  ),
  trendUp: (
    <>
      <path d="m3.6 16.4 5.6-5.6 3.4 3.4 7.8-7.8" />
      <path d="M15.4 6.4h5v5" />
    </>
  ),
  trendDown: (
    <>
      <path d="m3.6 7.6 5.6 5.6 3.4-3.4 7.8 7.8" />
      <path d="M15.4 17.6h5v-5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.8" />
      <path d="M4.8 20.2a7.4 7.4 0 0 1 14.4 0" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.6h6a3 3 0 0 1 3 3v12a2.4 2.4 0 0 0-2.4-2.4H4V4.6Z" />
      <path d="M20 4.6h-6a3 3 0 0 0-3 3v12a2.4 2.4 0 0 1 2.4-2.4H20V4.6Z" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="5.4" />
      <path d="m8.6 13.6-1.4 7 4.8-2.5 4.8 2.5-1.4-7" />
    </>
  ),
  arrowRight: <path d="M4.6 12h14.8M14 6.6l5.4 5.4-5.4 5.4" />,
  inbox: (
    <>
      <path d="M3.4 13.4h4.2l1.4 2.6h6l1.4-2.6h4.2" />
      <path d="M5.6 4.6h12.8l2.2 8.8v4a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2v-4l2.2-8.8Z" />
    </>
  ),
  grid: (
    <>
      <rect x="3.4" y="3.4" width="7" height="7" rx="1.8" />
      <rect x="13.6" y="3.4" width="7" height="7" rx="1.8" />
      <rect x="3.4" y="13.6" width="7" height="7" rx="1.8" />
      <rect x="13.6" y="13.6" width="7" height="7" rx="1.8" />
    </>
  ),
  flame: (
    <path d="M12 21c3.5 0 6-2.4 6-5.6 0-4.2-4.2-5.6-3.4-10.4-2.6.9-4 3-4 5.2 0 1.6-.9 2.2-1.7 1.5-.6-.5-.8-1.4-.8-2.2-1.3 1.3-2.1 3.3-2.1 5.9C6 18.6 8.5 21 12 21Z" />
  ),
  seat: (
    <>
      <path d="M6.4 4.6h11.2a1.8 1.8 0 0 1 1.8 1.8v5.2H4.6V6.4a1.8 1.8 0 0 1 1.8-1.8Z" />
      <path d="M3.4 11.6h17.2v4.2H3.4zM6 15.8v3.6M18 15.8v3.6" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.6A2 2 0 0 1 5 6.6h2.4l1.4-2.4h6.4l1.4 2.4H19a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.6Z" />
      <circle cx="12" cy="12.8" r="3.4" />
    </>
  ),
};

export function Icon({ name, size = 18, strokeWidth = 1.7, ...rest }) {
  const path = P[name];
  if (!path) {
    console.warn(`Unknown icon: ${name}`);
    return null;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}

/*
  The ClassConnect mark. Two linked apertures, a teacher side and a
  student side, sharing one overlap. Used whenever a tenant has no logo
  of their own uploaded. Strokes read from brand tokens so it re-skins
  with the tenant.
*/
