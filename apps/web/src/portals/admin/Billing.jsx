import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  PageHeader,
  Segmented,
} from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { cx, formatDate, formatMoney } from "@/lib/cx";
import { PLAN_MATRIX, TIER_LABEL, TIER_ORDER, TIER_PRICE } from "@/lib/tiers";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Plan and billing, tenant side.

  This is LoopLab charging the tenant, which is a completely separate
  money flow from the tenant charging its own students. The two never
  share a screen for the same reason they never share a service on the
  backend: confusing them is how a refund goes to the wrong party.

  The plan table is a real comparison, not three marketing cards. An
  admin deciding whether to move up needs the row by row difference.
*/

function planCell(value) {
  if (value === true)
    return <Icon name="check" size={16} className="text-success-fg mx-auto" strokeWidth={2.4} />;
  if (value === false)
    return (
      // A drawn rule rather than a dash character, so the cell reads as
      // deliberately empty instead of as an unrendered glyph.
      <span className="flex justify-center" aria-label="Not included">
        <span className="w-3 h-px bg-ink-300" />
      </span>
    );
  return <span className="block text-center text-xs text-ink-700">{value}</span>;
}

export default function Billing() {
  const { org } = useTheme();
  const [cycle, setCycle] = useState("monthly");
  /*
    A tenant changing their own tier goes through Stripe Billing
    checkout, which is configured but not implemented. Rather than
    mutate the tier locally and show a plan the server does not
    agree with, the button explains what is missing. A Super Admin
    can still change a tier for real, from the platform console.
  */
  const [pendingTier, setPendingTier] = useState(null);

  const invoices = [
    { id: "in-1", at: -4, amount: TIER_PRICE[org.packageTier], status: "paid" },
    { id: "in-2", at: -34, amount: TIER_PRICE[org.packageTier], status: "paid" },
    { id: "in-3", at: -64, amount: TIER_PRICE[org.packageTier], status: "paid" },
  ];

  const price = (tier) =>
    cycle === "yearly" ? Math.round(TIER_PRICE[tier] * 10) : TIER_PRICE[tier];

  return (
    <div>
      <PageHeader
        eyebrow="Organisation"
        title="Plan and billing"
        sub="What your organisation pays LoopLab. Student fees are handled separately, under Fees."
        actions={
          <Button variant="secondary" icon="download">
            Download invoices
          </Button>
        }
      />

      {org.billingStatus === "past_due" && (
        <Card className="mb-5 border-[color-mix(in_srgb,var(--warning-mid)_35%,transparent)]">
          <div className="flex flex-wrap items-center gap-4 p-5">
            <span className="inline-flex items-center justify-center size-11 rounded-[var(--radius-md)] bg-warning-bg text-warning-fg shrink-0">
              <Icon name="alert" size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-md font-bold">Last payment failed</p>
              <p className="text-sm text-ink-500 mt-0.5">
                Gated features pause in {org.graceDaysLeft ?? 7} days. Nothing is deleted, and your
                data stays exactly as it is.
              </p>
            </div>
            <Button variant="primary" icon="card">
              Update payment method
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
        <Card className="xl:col-span-2">
          <CardHeader
            eyebrow="Current"
            title={`${TIER_LABEL[org.packageTier]} plan`}
            sub="Renews automatically until cancelled"
            action={
              <Badge
                tone={
                  org.billingStatus === "active"
                    ? "success"
                    : org.billingStatus === "past_due"
                      ? "warning"
                      : "neutral"
                }
                dot
              >
                {org.billingStatus.replace("_", " ")}
              </Badge>
            }
          />
          <div className="px-5 pb-5">
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-4xl font-bold font-display tnum leading-none">
                {formatMoney(TIER_PRICE[org.packageTier])}
              </span>
              <span className="text-sm text-ink-500">per month</span>
            </div>
            <DataRow label="Next charge" value={formatDate(new Date(Date.now() + 26 * 86400000).toISOString())} icon="calendar" />
            <DataRow label="Payment method" value="Visa ending 4242" icon="card" />
            <DataRow label="Billing email" value={`accounts@${org.slug}.lk`} icon="mail" />
            <DataRow label="Students included" value={org.packageTier === "pro" ? "Unlimited" : org.packageTier === "growth" ? "500" : "100"} icon="students" />
            <div className="flex items-center gap-2 mt-4">
              <Button variant="secondary">Update payment method</Button>
              <Button variant="ghost" className="text-danger-fg">
                Cancel plan
              </Button>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader eyebrow="History" title="Invoices" />
          <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-5 py-3">
                <span className="inline-flex items-center justify-center size-8 rounded-[9px] bg-success-bg text-success-fg shrink-0">
                  <Icon name="check" size={14} strokeWidth={2.3} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tnum">{formatMoney(inv.amount)}</p>
                  <p className="text-2xs text-ink-500">
                    {formatDate(new Date(Date.now() + inv.at * 86400000).toISOString())}
                  </p>
                </div>
                <button
                  className="size-8 rounded-[var(--radius-sm)] flex items-center justify-center text-ink-400 hover:text-ink-800 hover:bg-ink-100 transition-colors"
                  aria-label="Download invoice"
                >
                  <Icon name="download" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {pendingTier && (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-info-bg border border-[color-mix(in_srgb,var(--info-mid)_25%,transparent)] px-4 py-3 mb-5">
          <Icon name="card" size={17} className="text-info-fg shrink-0" />
          <p className="text-sm text-info-fg flex-1 min-w-0">
            <span className="font-bold">Checkout is not connected yet.</span> Moving to{" "}
            {TIER_LABEL[pendingTier]} needs Stripe Billing, which is configured but not
            implemented. Contact LoopLab and they can change it for you.
          </p>
          <Button size="sm" variant="secondary" onClick={() => setPendingTier(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            <div className="eyebrow mb-1">Compare</div>
            <h3 className="text-md font-semibold">Every plan, row by row</h3>
          </div>
          <Segmented
            value={cycle}
            onChange={setCycle}
            items={[
              { value: "monthly", label: "Monthly" },
              { value: "yearly", label: "Yearly, save 2 months" },
            ]}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="border-y border-hairline bg-sunken">
                <th className="eyebrow text-left px-5 py-3 w-52">Feature</th>
                {TIER_ORDER.map((tier) => {
                  const current = tier === org.packageTier;
                  return (
                    <th key={tier} className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className={cx(
                            "text-sm font-bold font-display",
                            current && "text-[var(--portal-accent)]",
                          )}
                        >
                          {TIER_LABEL[tier]}
                        </span>
                        <span className="text-2xs text-ink-500 tnum">
                          {formatMoney(price(tier))}
                          {cycle === "yearly" ? "/yr" : "/mo"}
                        </span>
                        {current && <Badge tone="brand">Current</Badge>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {PLAN_MATRIX.map((row) => (
                <tr key={row.label} className="hover:bg-ink-50/60 transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-ink-700">{row.label}</td>
                  {TIER_ORDER.map((tier) => (
                    <td
                      key={tier}
                      className={cx(
                        "px-4 py-3",
                        tier === org.packageTier && "bg-[var(--portal-accent-soft)]",
                      )}
                    >
                      {planCell(row[tier])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="px-5 py-4" />
                {TIER_ORDER.map((tier) => {
                  const current = tier === org.packageTier;
                  const isUpgrade =
                    TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(org.packageTier);
                  return (
                    <td
                      key={tier}
                      className={cx("px-4 py-4", current && "bg-[var(--portal-accent-soft)]")}
                    >
                      <Button
                        block
                        size="sm"
                        variant={current ? "secondary" : isUpgrade ? "primary" : "ghost"}
                        disabled={current}
                        onClick={() => setPendingTier(tier)}
                      >
                        {current ? "Current plan" : isUpgrade ? "Upgrade" : "Downgrade"}
                      </Button>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="px-5 py-4 border-t border-hairline flex items-start gap-2.5">
          <Icon name="shield" size={14} className="text-ink-400 shrink-0 mt-0.5" />
          <p className="text-2xs text-ink-500 leading-relaxed">
            Downgrading keeps all of your data. Features above the new tier stop being reachable,
            and nothing is deleted. If you exceed the new seat limit you will be asked to remove
            people before the change takes effect.
          </p>
        </div>
      </Card>
    </div>
  );
}
