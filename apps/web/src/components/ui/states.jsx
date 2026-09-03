import { cx } from "@/lib/cx";
import { Icon } from "@/components/Icon";
import { Button, Card } from "./primitives";
import { FEATURE_COPY, TIER_LABEL, requiredTier } from "@/lib/tiers";
import { useTheme } from "@/theme/ThemeProvider";

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

/*
  Drawn illustration rather than a stock pack. It is built from the same
  card and rule shapes the real UI uses, so an empty screen still looks
  like this product. Three variants cover the cases a brand new tenant
  hits on day one, before any data exists.
*/
function EmptyArt({ variant }) {
  const line = {
    stroke: "var(--ink-300)",
    strokeWidth: 1.6,
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return (
    <svg width="132" height="92" viewBox="0 0 132 92" aria-hidden="true">
      <rect
        x="8"
        y="10"
        width="116"
        height="72"
        rx="10"
        fill="var(--surface-sunken)"
        stroke="var(--hairline)"
        strokeWidth="1.4"
      />
      {variant === "list" && (
        <>
          <rect x="20" y="24" width="14" height="14" rx="4" fill="var(--portal-accent-soft)" />
          <path d="M42 28h44M42 35h26" {...line} />
          <rect x="20" y="46" width="14" height="14" rx="4" fill="var(--ink-100)" />
          <path d="M42 50h52M42 57h34" {...line} />
          <path d="M20 70h30" {...line} strokeDasharray="3 4" />
        </>
      )}
      {variant === "chart" && (
        <>
          <path d="M22 68h88" {...line} />
          <rect x="30" y="52" width="12" height="16" rx="3" fill="var(--ink-100)" />
          <rect x="50" y="42" width="12" height="26" rx="3" fill="var(--ink-100)" />
          <rect x="70" y="48" width="12" height="20" rx="3" fill="var(--portal-accent-soft)" />
          <rect x="90" y="58" width="12" height="10" rx="3" fill="var(--ink-100)" />
          <path d="M30 34h34" {...line} strokeDasharray="3 4" />
        </>
      )}
      {variant === "inbox" && (
        <>
          <path d="M34 26h64l6 22v14a5 5 0 0 1-5 5H33a5 5 0 0 1-5-5V48l6-22Z" {...line} />
          <path
            d="M30 46h16l4 8h22l4-8h16"
            {...line}
            stroke="var(--portal-accent)"
            strokeWidth="1.9"
          />
        </>
      )}
    </svg>
  );
}

export function EmptyState({ art = "list", title, body, action, secondary, className }) {
  return (
    <div
      className={cx("flex flex-col items-center justify-center text-center px-6 py-12", className)}
    >
      <EmptyArt variant={art} />
      <h3 className="text-md font-semibold mt-5">{title}</h3>
      <p className="text-sm text-ink-500 mt-1.5 max-w-sm leading-relaxed">{body}</p>
      {(action || secondary) && (
        <div className="flex items-center gap-2 mt-5">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export function Skeleton({ w, h = 12, className, rounded = "var(--radius-sm)" }) {
  return (
    <div
      className={cx("skeleton", className)}
      style={{ width: w ?? "100%", height: h, borderRadius: rounded }}
    />
  );
}

/*
  Skeletons mirror the shape of the content that replaces them, so the
  page does not jump when data lands.
*/
export function SkeletonRows({ rows = 5 }) {
  return (
    <div className="divide-y divide-[var(--hairline)]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton w={36} h={36} rounded="10px" />
          <div className="flex-1 space-y-2">
            <Skeleton w={`${44 + ((i * 13) % 30)}%`} h={10} />
            <Skeleton w={`${24 + ((i * 7) % 20)}%`} h={8} />
          </div>
          <Skeleton w={62} h={22} rounded="999px" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ h = 220 }) {
  return (
    <div className="px-5 pb-5">
      <div className="flex items-end gap-3" style={{ height: h }}>
        {[58, 74, 46, 88, 66, 52, 79].map((v, i) => (
          <Skeleton key={i} h={(v / 100) * h} className="flex-1" rounded="8px 8px 3px 3px" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Error                                                               */
/* ------------------------------------------------------------------ */

export function ErrorState({
  title = "That did not load",
  body = "The request failed before it reached your organisation's data. Nothing was changed.",
  onRetry,
  detail,
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12">
      <span className="inline-flex items-center justify-center size-12 rounded-[var(--radius-md)] bg-danger-bg text-danger-fg">
        <Icon name="alert" size={22} />
      </span>
      <h3 className="text-md font-semibold mt-4">{title}</h3>
      <p className="text-sm text-ink-500 mt-1.5 max-w-sm leading-relaxed">{body}</p>
      {detail && (
        <code className="mt-3 text-2xs text-ink-500 bg-sunken border border-hairline rounded-[var(--radius-sm)] px-2.5 py-1.5">
          {detail}
        </code>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upgrade gate                                                        */
/* ------------------------------------------------------------------ */

/*
  The paywall. The brief was explicit that this must not read as a buy
  now popup, so it is a normal surface in the layout that shows the real
  feature behind it, blurred, rather than hiding it entirely. The tenant
  sees exactly what they would be getting.

  Presentation only. The server refuses the route regardless of what the
  client chooses to render.
*/
export function UpgradeGate({ feature, preview, compact }) {
  const { org } = useTheme();
  const copy = FEATURE_COPY[feature];
  const need = requiredTier(feature);

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--brand-300)] bg-[var(--brand-50)] px-4 py-3">
        <span className="inline-flex items-center justify-center size-8 rounded-[10px] bg-[var(--brand-100)] text-[var(--brand-700)] shrink-0">
          <Icon name="lock" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--brand-800)]">{copy.name}</p>
          <p className="text-xs text-[var(--brand-700)] opacity-80 truncate">{copy.blurb}</p>
        </div>
        <Button size="sm" variant="primary" iconRight="arrowRight">
          {TIER_LABEL[need]}
        </Button>
      </div>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      {preview && (
        <div
          className="pointer-events-none select-none opacity-45 blur-[3px] saturate-50"
          aria-hidden="true"
        >
          {preview}
        </div>
      )}
      <div
        className={cx(
          "flex flex-col items-center text-center px-6",
          preview ? "absolute inset-0 justify-center" : "py-12",
        )}
        style={
          preview
            ? {
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--surface) 55%, transparent) 0%, var(--surface) 62%)",
              }
            : undefined
        }
      >
        <span className="inline-flex items-center justify-center size-11 rounded-[var(--radius-md)] bg-[var(--brand-100)] text-[var(--brand-700)]">
          <Icon name="sparkle" size={20} />
        </span>
        <h3 className="text-lg font-semibold mt-3.5 font-display">{copy.name}</h3>
        <p className="text-sm text-ink-600 mt-1.5 max-w-md leading-relaxed">{copy.blurb}</p>
        <p className="text-xs text-ink-500 mt-3">
          Included from <span className="font-bold text-[var(--brand-700)]">{TIER_LABEL[need]}</span>
          . You are on <span className="font-semibold">{TIER_LABEL[org.packageTier]}</span>.
        </p>
        <div className="flex items-center gap-2 mt-4">
          <Button variant="primary" iconRight="arrowRight">
            Move to {TIER_LABEL[need]}
          </Button>
          <Button variant="ghost">Compare plans</Button>
        </div>
      </div>
    </Card>
  );
}

/*
  Inline lock for a single control, for example an export button. Keeps
  the control visible so the tenant learns the feature exists.
*/
export function LockedAction({ feature, children }) {
  const need = requiredTier(feature);
  return (
    <span className="relative inline-flex group">
      <span className="opacity-50 pointer-events-none">{children}</span>
      <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center size-4.5 rounded-full bg-[var(--brand-600)] text-white shadow-[var(--shadow-sm)]">
        <Icon name="lock" size={9} strokeWidth={2.4} />
      </span>
      <span
        className={cx(
          "pointer-events-none absolute top-full right-0 mt-2 z-30 w-56 rounded-[var(--radius-md)]",
          "bg-[var(--ink-950)] text-white px-3 py-2 text-2xs leading-relaxed shadow-[var(--shadow-lg)]",
          "opacity-0 translate-y-1 transition-all duration-[var(--dur-fast)]",
          "group-hover:opacity-100 group-hover:translate-y-0",
        )}
      >
        {FEATURE_COPY[feature].blurb} Available on {TIER_LABEL[need]}.
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Billing and seat notices                                            */
/* ------------------------------------------------------------------ */

/*
  Shown while an organisation is past due. Access is not cut yet, that
  is the point of the grace period, so the tone is a warning rather than
  a block.
*/
export function GraceBanner({ days, onPay }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-warning-bg border border-[color-mix(in_srgb,var(--warning-mid)_28%,transparent)] px-4 py-2.5 mb-5">
      <Icon name="alert" size={17} className="text-warning-fg shrink-0" />
      <p className="text-sm text-warning-fg flex-1 min-w-0">
        <span className="font-bold">Payment did not go through.</span> Your workspace keeps working
        for {days} more {days === 1 ? "day" : "days"}, then gated features pause.
      </p>
      <Button size="sm" variant="secondary" onClick={onPay}>
        Update payment
      </Button>
    </div>
  );
}

/* Seat cap warning, raised before the tenant hits the wall mid task. */
export function SeatCapNotice({ kind, used, cap, icon = "seat" }) {
  const atCap = used >= cap;
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-2.5 border",
        atCap
          ? "bg-danger-bg border-[color-mix(in_srgb,var(--danger-mid)_28%,transparent)]"
          : "bg-warning-bg border-[color-mix(in_srgb,var(--warning-mid)_28%,transparent)]",
      )}
    >
      <Icon
        name={icon}
        size={17}
        className={cx("shrink-0", atCap ? "text-danger-fg" : "text-warning-fg")}
      />
      <p className={cx("text-sm flex-1 min-w-0", atCap ? "text-danger-fg" : "text-warning-fg")}>
        {atCap ? (
          <>
            <span className="font-bold">{kind} limit reached.</span> You are using all {cap} seats
            on this plan.
          </>
        ) : (
          <>
            <span className="font-bold">
              {used} of {cap} {kind.toLowerCase()} seats used.
            </span>{" "}
            Worth planning the next tier before you run out.
          </>
        )}
      </p>
      <Button size="sm" variant="secondary">
        Add seats
      </Button>
    </div>
  );
}
