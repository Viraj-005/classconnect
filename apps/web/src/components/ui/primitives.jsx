import { cx, seeded } from "@/lib/cx";
import { Icon } from "@/components/Icon";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

const VARIANT = {
  /*
    Primary uses the portal accent, not a fixed brand hex, so the same
    button reads as plum in Teacher and jade in Student, and follows a
    tenant re-skin without any component change.
  */
  primary:
    "bg-[var(--portal-accent)] text-[var(--portal-contrast)] shadow-[var(--shadow-sm)] hover:bg-[var(--portal-accent-hover)] active:translate-y-px",
  secondary:
    "bg-surface text-ink-800 border border-hairline hover:border-ink-300 hover:bg-ink-50 active:translate-y-px",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger:
    "bg-[var(--danger-mid)] text-white hover:brightness-92 active:translate-y-px",
  quiet:
    "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] hover:brightness-97",
};

const SIZE = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-[var(--radius-sm)]",
  md: "h-9.5 px-4 text-sm gap-2 rounded-[var(--radius-sm)]",
  lg: "h-11 px-5 text-base gap-2 rounded-[var(--radius-md)]",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center font-semibold whitespace-nowrap",
        "transition-[background-color,border-color,color,transform,box-shadow,filter]",
        "duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "disabled:opacity-45 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : (
        icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />
      )}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 14 : 16} />}
    </button>
  );
}

/* Icon only button, used in toolbars and card headers. */
export function IconButton({ icon, label, size = "md", variant = "ghost", className, ...rest }) {
  const dim = size === "sm" ? "size-8" : "size-9.5";
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex items-center justify-center rounded-[var(--radius-sm)]",
        "transition-colors duration-[var(--dur-fast)]",
        VARIANT[variant],
        dim,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 15 : 17} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({ flat, inset, raised, className, children, ...rest }) {
  return (
    <div
      className={cx(
        "bg-surface border border-hairline rounded-[var(--radius-lg)]",
        /*
          Three levels, not one. A page where every card sits at the
          same elevation has no hierarchy, which is the single easiest
          way for a dashboard to look generated.
        */
        flat
          ? "shadow-none"
          : raised
            ? "shadow-[var(--shadow-md)]"
            : "shadow-[var(--shadow-sm)]",
        inset && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, action, eyebrow, className }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 px-5 pt-4.5 pb-3.5", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h3 className="text-md font-semibold leading-tight truncate">{title}</h3>
        {sub && <p className="text-xs text-ink-500 mt-0.5 leading-snug">{sub}</p>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge, chip                                                         */
/* ------------------------------------------------------------------ */

const TONE = {
  neutral: "bg-ink-100 text-ink-700",
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
  info: "bg-info-bg text-info-fg",
  brand: "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]",
};

export function Badge({ tone = "neutral", icon, dot, children, className }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)]",
        "px-2.5 h-6 text-2xs font-bold tracking-wide whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {icon && <Icon name={icon} size={12} strokeWidth={2.1} />}
      {children}
    </span>
  );
}

/*
  Tinted icon chip. Lifted from the reference shots where every list row
  carries a soft square rather than a bare glyph. Keeps long lists
  scannable by type instead of by reading each label.
*/
export function IconChip({ icon, tone = "brand", size = "md", className }) {
  const dim =
    size === "sm"
      ? "size-7 rounded-[8px]"
      : size === "lg"
        ? "size-11 rounded-[13px]"
        : "size-9 rounded-[10px]";
  return (
    <span
      className={cx("inline-flex items-center justify-center shrink-0", dim, TONE[tone], className)}
    >
      <Icon name={icon} size={size === "sm" ? 14 : size === "lg" ? 20 : 17} />
    </span>
  );
}

/* Maps a content type to its chip treatment, used in several screens. */
export const CONTENT_CHIP = {
  video: { icon: "video", tone: "brand" },
  doc: { icon: "doc", tone: "info" },
  quiz: { icon: "quiz", tone: "warning" },
};

export const PAYMENT_TONE = {
  paid: "success",
  unpaid: "warning",
  pending_review: "info",
  overdue: "danger",
};

export const PAYMENT_LABEL = {
  paid: "Paid",
  unpaid: "Unpaid",
  pending_review: "In review",
  overdue: "Overdue",
};

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

/*
  Avatars are generated from the name rather than pulled from a stock
  photo service. Hue is derived from the string so the same person keeps
  the same colour on every screen.
*/
export function Avatar({ name, initials, size = 32, online, className }) {
  const hue = Math.round(seeded(name) * 360);
  const text = initials ?? name.slice(0, 2).toUpperCase();
  return (
    <span className={cx("relative inline-flex shrink-0", className)}>
      <span
        className="inline-flex items-center justify-center rounded-full font-bold font-display"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.38,
          background: `hsl(${hue} 42% 92%)`,
          color: `hsl(${hue} 46% 32%)`,
          border: `1px solid hsl(${hue} 40% 86%)`,
        }}
      >
        {text}
      </span>
      {online !== undefined && (
        <span
          className={cx(
            "absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--surface)]",
            online ? "bg-[var(--success-mid)]" : "bg-ink-300",
          )}
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 26 }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <span
          key={p.name}
          className="ring-2 ring-[var(--surface)] rounded-full"
          style={{ marginLeft: i === 0 ? 0 : -size * 0.32, zIndex: max - i }}
        >
          <Avatar name={p.name} initials={p.initials} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-ink-100 text-ink-600 font-bold ring-2 ring-[var(--surface)]"
          style={{ width: size, height: size, fontSize: size * 0.36, marginLeft: -size * 0.32 }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export function Progress({ value, tone, height = 6, className, showTrack = true }) {
  return (
    <div
      className={cx(
        "w-full overflow-hidden rounded-[var(--radius-pill)]",
        showTrack && "bg-ink-100",
        className,
      )}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-[var(--radius-pill)] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)]"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: tone ?? "var(--portal-accent)",
        }}
      />
    </div>
  );
}

/*
  Ring for a single headline percentage. Chosen over a donut chart
  because at this size a chart library adds nothing except its own
  default styling.
*/
export function Ring({ value, size = 72, stroke = 7, label, sub, tone }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink-100)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone ?? "var(--portal-accent)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          className="transition-[stroke-dasharray] duration-[var(--dur-slow)] ease-[var(--ease-out)]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-display font-bold tnum leading-none"
          style={{ fontSize: size * 0.26 }}
        >
          {label ?? `${Math.round(value)}%`}
        </span>
        {sub && <span className="text-2xs text-ink-500 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs and segmented control                                          */
/* ------------------------------------------------------------------ */

export function Tabs({ value, onChange, items, className }) {
  return (
    <div className={cx("flex items-center gap-1 border-b border-hairline overflow-x-auto", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cx(
              "relative inline-flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-sm font-semibold whitespace-nowrap",
              "transition-colors duration-[var(--dur-fast)]",
              active ? "text-ink-950" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {it.icon && <Icon name={it.icon} size={15} />}
            {it.label}
            {it.count !== undefined && (
              <span
                className={cx(
                  "ml-0.5 rounded-[var(--radius-pill)] px-1.5 h-4.5 inline-flex items-center text-2xs font-bold",
                  active
                    ? "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                    : "bg-ink-100 text-ink-500",
                )}
              >
                {it.count}
              </span>
            )}
            {active && (
              <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[var(--portal-accent)]" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented({ value, onChange, items, size = "md" }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-sunken p-0.5 border border-hairline">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cx(
              "rounded-[7px] font-semibold transition-all duration-[var(--dur-fast)]",
              size === "sm" ? "h-6.5 px-2.5 text-2xs" : "h-7.5 px-3 text-xs",
              active
                ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]"
                : "text-ink-500 hover:text-ink-800",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export const inputClass = cx(
  "w-full h-9.5 px-3 rounded-[var(--radius-sm)] bg-surface",
  "border border-hairline text-sm text-ink-900 placeholder:text-ink-400",
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
  "hover:border-ink-300 focus:border-[var(--portal-accent)]",
  "focus:shadow-[0_0_0_3px_var(--portal-halo)] focus:outline-none",
);

export function Field({ label, hint, required, children, className }) {
  return (
    <label className={cx("block", className)}>
      <span className="flex items-center gap-1 text-xs font-semibold text-ink-700 mb-1.5">
        {label}
        {required && <span className="text-[var(--danger-mid)]">*</span>}
      </span>
      {children}
      {hint && <span className="block text-2xs text-ink-500 mt-1.5">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }) {
  return <input className={cx(inputClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <div className="relative">
      <select className={cx(inputClass, "appearance-none pr-9", className)} {...rest}>
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={15}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
      />
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", className }) {
  return (
    <div className={cx("relative", className)}>
      <Icon
        name="search"
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(inputClass, "pl-9")}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
          aria-label="Clear search"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label
      className={cx(
        "flex items-start gap-3 cursor-pointer select-none",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative w-9 h-5.5 rounded-full shrink-0 mt-0.5 transition-colors duration-[var(--dur-fast)]",
          checked ? "bg-[var(--portal-accent)]" : "bg-ink-200",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-4.5 rounded-full bg-white shadow-[var(--shadow-xs)]",
            "transition-[left] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            checked ? "left-4" : "left-0.5",
          )}
        />
      </button>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-semibold text-ink-800">{label}</span>}
          {hint && <span className="block text-xs text-ink-500 mt-0.5">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

export function PageHeader({ eyebrow, title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && (
          /* A short accent rule ahead of the eyebrow. It costs nothing
             and it stops the page starting on a bare line of grey caps. */
          <div className="flex items-center gap-2 mb-2">
            <span className="h-3 w-0.5 rounded-full bg-[var(--portal-accent)]" />
            <span className="eyebrow">{eyebrow}</span>
          </div>
        )}
        <h1 className="text-3xl font-bold tracking-[-0.022em] leading-[1.1]">{title}</h1>
        {sub && <p className="text-sm text-ink-500 mt-2 max-w-2xl leading-relaxed">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Divider({ className }) {
  return <div className={cx("h-px bg-hairline", className)} />;
}

/* Dotted leader row, used for compact key and value pairs. */
export function DataRow({ label, value, icon }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-ink-500 shrink-0">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </span>
      <span className="flex-1 border-b border-dashed border-hairline mb-1" />
      <span className="font-semibold text-ink-900 shrink-0 tnum">{value}</span>
    </div>
  );
}

/*
  Metric cell for the KPI strip. The strip divides with rules rather
  than gaps between floating cards, so the whole row reads as one
  object. This is the single biggest thing separating the reference
  shots from a default four card dashboard.
*/
export function Metric({ icon, tone = "brand", label, value, delta, deltaLabel, sub }) {
  const up = typeof delta === "number" && delta >= 0;
  return (
    <div className="group relative flex items-start gap-3.5 px-5 py-5 min-w-0">
      <IconChip icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="eyebrow truncate">{label}</div>
        <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
          {/* A currency value must never wrap mid number. */}
          <span className="text-2xl font-bold font-display tnum leading-none whitespace-nowrap tracking-tight">
            {value}
          </span>
          {typeof delta === "number" && (
            <span
              className={cx(
                "inline-flex items-center gap-0.5 h-5 px-1.5 rounded-[var(--radius-pill)]",
                "text-2xs font-bold",
                up ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg",
              )}
            >
              <Icon name={up ? "trendUp" : "trendDown"} size={11} strokeWidth={2.4} />
              {Math.abs(delta)}%
            </span>
          )}
        </div>
        {(sub || deltaLabel) && (
          <div className="text-2xs text-ink-500 mt-1.5 truncate">{sub ?? deltaLabel}</div>
        )}
      </div>
    </div>
  );
}
