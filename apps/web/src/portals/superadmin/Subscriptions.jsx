import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  IconChip,
  Metric,
  PageHeader,
} from "@/components/ui/primitives";
import { StackedMix, TrendLines } from "@/components/charts";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { OrgLogo } from "@/components/ui/OrgLogo";
import { cx, formatDate, formatMoney, formatMoneyCompact } from "@/lib/cx";
import { TIER_LABEL, TIER_ORDER, TIER_PRICE } from "@/lib/tiers";
import { platformApi, exportApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Platform subscriptions.

  This is LoopLab's own revenue, driven by Stripe Billing, and it is
  kept entirely separate from student fee payments. Different money,
  different stakeholders, different code path on the backend, so also a
  different screen here.
*/

const STATUS_TONE = {
  active: "success",
  past_due: "warning",
  canceled: "neutral",
  trialing: "info",
};

export default function Subscriptions() {
  const summary = useApi(() => platformApi.summary(), []);
  const tenantsQuery = useApi(() => platformApi.tenants(), []);
  const tenants = tenantsQuery.data ?? [];

  const mrr = summary.data?.mrr ?? 0;
  const arr = summary.data?.arr ?? mrr * 12;

  /* No billing history table yet, so the trend holds the current
     split flat and the chart says so. */
  const byTierNow = {
    pro: tenants.filter((t) => t.packageTier === "pro").reduce((s, t) => s + t.mrr, 0),
    growth: tenants.filter((t) => t.packageTier === "growth").reduce((s, t) => s + t.mrr, 0),
    starter: tenants.filter((t) => t.packageTier === "starter").reduce((s, t) => s + t.mrr, 0),
  };
  const trend = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((label) => ({
    label,
    ...byTierNow,
  }));
  const paying = tenants.filter((t) => t.mrr > 0);
  const churned = tenants.filter((t) => t.billingStatus === "canceled");
  const atRisk = tenants.filter((t) => t.billingStatus === "past_due");

  const byTier = TIER_ORDER.slice()
    .reverse()
    .map((tier, i) => ({
      label: TIER_LABEL[tier],
      value: tenants.filter((t) => t.packageTier === tier && t.mrr > 0).reduce(
        (s, t) => s + t.mrr,
        0,
      ),
      color: ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"][i],
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="LoopLab operations"
        title="Subscriptions"
        sub="Platform billing, what tenants pay LoopLab. Separate from student fee collection."
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={() => exportApi.tenants()}>
            Revenue report
            </Button>
            <Button variant="primary" icon="card">
              Open Stripe
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric
            icon="card"
            tone="success"
            label="Monthly recurring"
            value={formatMoneyCompact(mrr)}
            delta={18}
          />
          <Metric icon="chart" tone="brand" label="Annual run rate" value={formatMoneyCompact(arr)} delta={18} />
          <Metric
            icon="building"
            tone="info"
            label="Paying tenants"
            value={paying.length}
            sub={`of ${tenants.length} total`}
          />
          <Metric
            icon="trendDown"
            tone={churned.length ? "danger" : "success"}
            label="Churned"
            value={churned.length}
            sub="this quarter"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CardHeader
            eyebrow="Growth"
            title="Recurring revenue by tier"
            sub="Current split, held flat until a billing history table exists"
          />
          <div className="px-5 pb-5">
            <TrendLines
              data={trend}
              valuePrefix="Rs "
              height={250}
              series={[
                { key: "pro", label: "Pro", color: "var(--chart-1)" },
                { key: "growth", label: "Growth", color: "var(--chart-2)" },
                { key: "starter", label: "Starter", color: "var(--chart-3)" },
              ]}
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader eyebrow="Mix" title="Revenue by tier" />
            <div className="px-5 pb-5">
              <StackedMix segments={byTier} height={12} format={formatMoney} />
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Pricing" title="Current list prices" />
            <div className="px-5 pb-5">
              {TIER_ORDER.map((t) => (
                <DataRow
                  key={t}
                  label={TIER_LABEL[t]}
                  value={`${formatMoney(TIER_PRICE[t])}/mo`}
                  icon={t === "pro" ? "award" : "card"}
                />
              ))}
              <p className="text-2xs text-ink-500 mt-3 leading-relaxed">
                Pricing is still provisional. Confirm the final tiers with the founder before the
                first paid tenant signs.
              </p>
            </div>
          </Card>
        </div>
      </div>

      {atRisk.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            eyebrow="Action needed"
            title="Failed payments"
            sub="Tenants inside their grace period"
            action={<Badge tone="warning">{atRisk.length}</Badge>}
          />
          <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
            {atRisk.map((t) => (
              <li key={t.orgId} className="flex items-center gap-3.5 px-5 py-3.5">
                <IconChip icon="alert" tone="warning" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{t.name}</p>
                  <p className="text-2xs text-ink-500">
                    {formatMoney(t.mrr)}/mo · {TIER_LABEL[t.packageTier]} · retry failed{" "}
                    {formatDate(t.createdAt)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" icon="mail">
                  Chase
                </Button>
                <Button size="sm" variant="secondary">
                  Stripe
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader eyebrow="All" title="Subscriptions" sub="One active subscription per tenant" />
        {tenantsQuery.error ? (
          <ErrorState body={tenantsQuery.error.message} onRetry={tenantsQuery.reload} />
        ) : tenantsQuery.loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-y border-hairline bg-sunken">
                {["Tenant", "Plan", "Status", "MRR", "Started", "Renews"].map((h) => (
                  <th key={h} className="eyebrow text-left px-5 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {tenants.map((t) => (
                <tr
                  key={t.orgId}
                  className={cx(
                    "hover:bg-ink-50/60 transition-colors",
                    t.billingStatus === "canceled" && "opacity-55",
                  )}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <OrgLogo
                    name={t.name}
                    hasLogo={t.hasLogo}
                    version={t.logoVersion}
                    orgId={t.orgId}
                    size={32}
                    className="text-2xs text-white"
                  />
                      <span className="text-sm font-semibold truncate">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={t.packageTier === "pro" ? "brand" : "neutral"}>
                      {TIER_LABEL[t.packageTier]}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={STATUS_TONE[t.billingStatus]} dot>
                      {t.billingStatus.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-sm font-bold tnum">{formatMoney(t.mrr)}</td>
                  <td className="px-5 py-3 text-2xs text-ink-500 whitespace-nowrap">
                    {formatDate(t.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-2xs text-ink-500 whitespace-nowrap">
                    {t.billingStatus === "canceled" ? (
                      <span className="text-ink-400">Not renewing</span>
                    ) : (
                      formatDate(new Date(Date.now() + 22 * 86400000).toISOString())
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        <div className="px-5 py-4 border-t border-hairline flex items-start gap-2.5">
          <Icon name="shield" size={14} className="text-ink-400 shrink-0 mt-0.5" />
          <p className="text-2xs text-ink-500 leading-relaxed">
            These are LoopLab's charges to each tenant. Fees a tenant collects from its own
            students are that tenant's revenue and never appear on this screen.
          </p>
        </div>
      </Card>
    </div>
  );
}
