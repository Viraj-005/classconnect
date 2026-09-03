import { Link } from "react-router-dom";
import { Badge, Card, CardHeader, Progress } from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { cx, formatMoney } from "@/lib/cx";
import {
  FEATURE_COPY,
  TIER_LABEL,
  TIER_LIMITS,
  TIER_PRICE,
  isFree,
  upgradeGain,
} from "@/lib/tiers";

/*
  The free plan, as a surface rather than a nag.

  The tone here is the whole design. A free tenant is a school that is
  still deciding, and the two ways to lose them are opposite: badger
  them on every screen, or say nothing until they hit a wall they were
  not warned about. So this shows headroom while there is headroom,
  gets specific only as it runs out, and never blocks anything.

  It also argues from their own numbers rather than from adjectives. A
  school that has published fourteen lessons and tracked Rs 40,000 of
  fees does not need to be told the product is useful, it needs to be
  shown what it has already done, which is an argument they can check.
*/

const STAGES = {
  /* Plenty of room. Say what they have, not what they lack. */
  roomy: {
    tone: "brand",
    icon: "sparkle",
    title: (left) => `${left} student places left`,
    body: "Free for as long as you stay this size. Nothing expires and there is no card on file.",
  },
  /* Closing in. Warn before the wall, so an import does not fail midway. */
  nearing: {
    tone: "warning",
    icon: "alert",
    title: (left) => (left === 1 ? "One student place left" : `${left} student places left`),
    body: "Worth moving up before you add the rest of the batch, so an import does not stop halfway.",
  },
  /* Full. Nothing is switched off, but the next student needs more room. */
  full: {
    tone: "warning",
    icon: "lock",
    title: () => "Your free places are full",
    body: "Everything you have keeps working. Adding another student needs a larger plan.",
  },
};

function stageFor(used, cap) {
  if (used >= cap) return "full";
  if (used / cap >= 0.8) return "nearing";
  return "roomy";
}

/**
 * The upgrade argument for one step up, worked out from the tier
 * matrix. Free to Starter buys capacity and nothing else, so seats lead
 * and features are mentioned only when there are any.
 */
function GainSummary({ from, to }) {
  const { seats, features } = upgradeGain(from, to);
  return (
    <div className="rounded-[var(--radius-md)] border border-hairline bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold">{TIER_LABEL[to]}</p>
        <p className="text-sm font-bold tnum">
          {formatMoney(TIER_PRICE[to])}
          <span className="text-2xs font-semibold text-ink-500">/mo</span>
        </p>
      </div>

      <ul className="mt-2.5 space-y-1.5">
        {seats.map((s) => (
          <li key={s.kind} className="flex items-center gap-2 text-xs text-ink-700">
            <Icon name="arrowRight" size={13} className="text-[var(--portal-accent)] shrink-0" />
            <span>
              <span className="font-semibold tnum">
                {s.from} to {s.to === Infinity ? "unlimited" : s.to}
              </span>{" "}
              {s.kind}
            </span>
          </li>
        ))}
        {features.slice(0, 3).map((f) => (
          <li key={f} className="flex items-center gap-2 text-xs text-ink-700">
            <Icon name="check" size={13} className="text-success-fg shrink-0" />
            {FEATURE_COPY?.[f]?.name ?? f.replace(/_/g, " ")}
          </li>
        ))}
        {features.length > 3 && (
          <li className="text-2xs text-ink-500 pl-5">
            and {features.length - 3} more
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Seat headroom plus the next step up. Rendered on the Admin overview
 * for a tenant on Free.
 */
export function FreePlanCard({ students, teachers, collected, contentCount }) {
  const cap = TIER_LIMITS.free.students;
  const used = students ?? 0;
  const left = Math.max(0, cap - used);
  const stage = STAGES[stageFor(used, cap)];

  /* Only claim what actually happened. A brand new tenant has no
     record to argue from, so the proof block simply does not appear. */
  const proof = [
    used > 0 && { icon: "students", value: used, label: used === 1 ? "student" : "students" },
    contentCount > 0 && {
      icon: "library",
      value: contentCount,
      label: contentCount === 1 ? "lesson published" : "lessons published",
    },
    collected > 0 && { icon: "wallet", value: formatMoney(collected), label: "fees tracked" },
  ].filter(Boolean);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        eyebrow="Your plan"
        title="Free"
        sub="The whole product, capped by size."
        action={<Badge tone={stage.tone === "warning" ? "warning" : "brand"}>Rs 0 / mo</Badge>}
      />

      <div className="px-5 pb-5 space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <p className={cx("text-sm font-bold", stage.tone === "warning" && "text-warning-fg")}>
              {stage.title(left)}
            </p>
            <p className="text-xs font-semibold text-ink-500 tnum">
              {used} of {cap}
            </p>
          </div>
          <Progress
            value={Math.min(100, (used / cap) * 100)}
            tone={stage.tone === "warning" ? "warning" : undefined}
            height={7}
          />
          <p className="text-xs text-ink-500 leading-relaxed mt-2">{stage.body}</p>
        </div>

        {teachers?.used >= TIER_LIMITS.free.teachers && (
          <p className="flex items-start gap-2 text-xs text-ink-600 bg-sunken rounded-[var(--radius-sm)] px-3 py-2.5">
            <Icon name="alert" size={13} className="shrink-0 mt-0.5 text-warning-fg" />
            Both teacher places are taken. Adding a third colleague needs a larger plan.
          </p>
        )}

        {proof.length > 0 && (
          <div className="rounded-[var(--radius-md)] bg-sunken p-3.5">
            <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400 mb-2.5">
              What you have built so far
            </p>
            <ul className="space-y-1.5">
              {proof.map((p) => (
                <li key={p.label} className="flex items-center gap-2 text-xs text-ink-700">
                  <Icon name={p.icon} size={13} className="text-ink-400 shrink-0" />
                  <span className="font-bold tnum">{p.value}</span>
                  {p.label}
                </li>
              ))}
            </ul>
            <p className="text-2xs text-ink-500 leading-relaxed mt-2.5">
              All of it carries over unchanged if you move to a paid plan, and stays if you
              never do.
            </p>
          </div>
        )}

        <div>
          <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400 mb-2">
            When you outgrow it
          </p>
          <GainSummary from="free" to="starter" />
        </div>

        {/* A link, styled as a button. Button renders a <button>, and a
            link inside one is invalid markup that breaks middle click,
            open in new tab, and the status bar preview. */}
        <Link
          to="/admin/billing"
          className={cx(
            "inline-flex items-center justify-center gap-2 w-full h-10 rounded-[var(--radius-sm)]",
            "text-sm font-semibold transition-colors duration-[var(--dur-fast)]",
            stage.tone === "warning"
              ? "bg-[var(--portal-accent)] text-[var(--portal-contrast)] hover:bg-[var(--portal-accent-hover)]"
              : "bg-surface text-ink-800 border border-hairline hover:border-ink-300 hover:bg-ink-50",
          )}
        >
          Compare every plan
          <Icon name="arrowRight" size={15} />
        </Link>
      </div>
    </Card>
  );
}

/**
 * The message shown when a create is refused by the seat cap.
 * Deliberately says what still works, because nothing was switched off.
 */
export function SeatCapReached({ kind = "students", tier = "free" }) {
  const cap = TIER_LIMITS[tier][kind];
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--warning-mid)] bg-warning-bg p-4">
      <div className="flex items-start gap-2.5">
        <Icon name="lock" size={16} className="text-warning-fg shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-warning-fg">
            That is all {cap} {kind} on {TIER_LABEL[tier]}
          </p>
          <p className="text-xs text-warning-fg/90 leading-relaxed mt-1">
            Everyone already here keeps working exactly as before, and nothing has been
            switched off. Only adding another {kind.replace(/s$/, "")} needs more room.
          </p>
          {isFree(tier) && (
            <Link
              to="/admin/billing"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-warning-fg hover:underline mt-2.5"
            >
              See what the next plan gives you
              <Icon name="arrowRight" size={13} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
