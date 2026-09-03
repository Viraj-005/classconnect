import { useId } from "react";
import {
  BRAND_GRADIENT,
  BRAND_INK,
  BRAND_NODE,
  BRAND_PAGE,
  ICON_NODE,
  ICON_PAGES,
  ICON_SHAPE,
  LOCKUP_H,
  LOCKUP_INK,
  LOCKUP_NODE,
  LOCKUP_W,
  MARK_BOOK,
  MARK_H,
  MARK_NODE,
  MARK_W,
} from "./paths";

/*
  The ClassConnect brand marks.

  Three things, for three jobs:

    LogoMark    the open book alone, for tight spots like the sidebar
                chip and the boot screen
    LogoLockup  book plus wordmark, for the login screen and anywhere
                the product needs naming
    AppIcon     the full squircle app icon, gradient and all, for the
                splash and the favicon

  All three are vector traced from the supplied artwork rather than the
  JPEGs themselves, which matters for one specific reason: the sidebar
  is near black and the login panel is a brand gradient, and a JPEG has
  no alpha, so the delivered files would have shown as white rectangles
  on both. Tracing also makes the ink recolourable, which is why the
  same mark can be purple on the login form and white in the sidebar.

  `tone` picks the ink:

    brand    the supplied purple, for light surfaces
    light    white, for the dark sidebar and coloured panels
    current  inherits currentColor, for surfaces whose contrast colour
             is resolved at runtime (the tenant branding preview picks
             black or white depending on the accent)

  The node keeps its blue in the first two. It sits inside the white
  gutter rather than on the page, so it reads against either ink, and it
  is the part of the mark that carries the "connect" idea.
*/

function inkFor(tone) {
  if (tone === "light") return "#FFFFFF";
  if (tone === "current") return "currentColor";
  return BRAND_INK;
}

function nodeFor(tone) {
  return tone === "current" ? "currentColor" : BRAND_NODE;
}

export function LogoMark({ size = 28, tone = "brand", className, title }) {
  const h = (size * MARK_H) / MARK_W;
  return (
    <svg
      width={size}
      height={h}
      viewBox={`0 0 ${MARK_W} ${MARK_H}`}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
    >
      <path fillRule="evenodd" fill={inkFor(tone)} d={MARK_BOOK} />
      <path fillRule="evenodd" fill={nodeFor(tone)} d={MARK_NODE} />
    </svg>
  );
}

export function LogoLockup({ height = 26, tone = "brand", className }) {
  const w = (height * LOCKUP_W) / LOCKUP_H;
  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${LOCKUP_W} ${LOCKUP_H}`}
      className={className}
      role="img"
      aria-label="ClassConnect"
    >
      <path fillRule="evenodd" fill={inkFor(tone)} d={LOCKUP_INK} />
      <path fillRule="evenodd" fill={nodeFor(tone)} d={LOCKUP_NODE} />
    </svg>
  );
}

/*
  The app icon, squircle included.

  useId keeps the gradient unique. Two of these on one page sharing an
  id would both resolve to whichever was defined first, which is the
  kind of bug that only appears once somebody puts two on a screen.
*/
export function AppIcon({ size = 96, className, title = "ClassConnect" }) {
  const gid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND_GRADIENT[0]} />
          <stop offset="1" stopColor={BRAND_GRADIENT[1]} />
        </linearGradient>
      </defs>
      <path fillRule="evenodd" fill={`url(#${gid})`} d={ICON_SHAPE} />
      <path fillRule="evenodd" fill={BRAND_PAGE} d={ICON_PAGES} />
      <path fillRule="evenodd" fill={BRAND_NODE} d={ICON_NODE} />
    </svg>
  );
}

export { BRAND_INK, BRAND_NODE, BRAND_PAGE, BRAND_GRADIENT };
