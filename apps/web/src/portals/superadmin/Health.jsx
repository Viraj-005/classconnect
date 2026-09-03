import {
  Badge,
  Button,
  Card,
  CardHeader,
  IconChip,
  Metric,
  PageHeader,
  Progress,
} from "@/components/ui/primitives";
import { StackedMix, TrendLines } from "@/components/charts";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { OrgLogo } from "@/components/ui/OrgLogo";
import { cx, formatCompact, formatMoney, formatMoneyCompact, relativeTime } from "@/lib/cx";
import { TIER_LABEL } from "@/lib/tiers";
import { platformApi, exportApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  LoopLab platform health.

  This is the only screen in the product that sees across tenants, and
  the dark shell exists so an operator never mistakes it for a tenant
  portal they are supporting.

  Important restraint: this screen shows counts, revenue and status. It
  does not show any tenant's students, content or payments. Reaching
  that data requires an explicit support action, which is logged.
*/

const STATUS_TONE = {
  active: "success",
  past_due: "warning",
  canceled: "neutral",
  trialing: "info",
};

const SEVERITY = {
  info: { tone: "neutral", icon: "check" },
  warning: { tone: "warning", icon: "shield" },
  critical: { tone: "danger", icon: "alert" },
};

export default function PlatformHealth() {
  const summary = useApi(() => platformApi.summary(), []);
  const tenantsQuery = useApi(() => platformApi.tenants(), []);
  const auditQuery = useApi(() => platformApi.audit({ limit: 6 }), []);

  const tenants = tenantsQuery.data ?? [];
  const audit = auditQuery.data ?? [];
  const d = summary.data;

  const active = tenants.filter((t) => t.billingStatus === "active");
  const mrr = d?.mrr ?? 0;
  const students = d?.studentsPlatformWide ?? 0;
  const atRisk = tenants.filter(
    (t) => t.billingStatus === "past_due" || t.billingStatus === "canceled",
  );

  const mix = ["pro", "growth", "starter"].map((tier, i) => ({
    label: TIER_LABEL[tier],
    value: tenants.filter((t) => t.packageTier === tier).length,
    color: [`var(--chart-1)`, `var(--chart-2)`, `var(--chart-3)`][i],
  }));

  /*
    MRR history has no source table yet: subscriptions record the
    current plan, not a month by month ledger. Rather than invent a
    trend, the chart shows the current split held flat and says so.
    A billing events table would make this real.
  */
  const byTierNow = {
    pro: tenants.filter((t) => t.packageTier === "pro").reduce((s, t) => s + t.mrr, 0),
    growth: tenants.filter((t) => t.packageTier === "growth").reduce((s, t) => s + t.mrr, 0),
    starter: tenants.filter((t) => t.packageTier === "starter").reduce((s, t) => s + t.mrr, 0),
  };
  const trend = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((label) => ({
    label,
    ...byTierNow,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="LoopLab operations"
        title="Platform health"
        sub="Every tenant on ClassConnect, and what they are worth."
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={() => exportApi.tenants()}>
            Export
            </Button>
            <Button variant="primary" icon="plus">
              Onboard tenant
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric
            icon="building"
            tone="brand"
            label="Active tenants"
            value={active.length}
            delta={12}
            sub={`${d?.tenants ?? 0} total`}
          />
          <Metric
            icon="card"
            tone="success"
            label="Monthly recurring"
            value={formatMoneyCompact(mrr)}
            delta={18}
            sub="across all tiers"
          />
          <Metric
            icon="students"
            tone="info"
            label="Students platform wide"
            value={formatCompact(students)}
            delta={9}
          />
          <Metric
            icon="alert"
            tone={atRisk.length ? "danger" : "success"}
            label="At risk"
            value={d?.atRisk ?? atRisk.length}
            sub="past due or cancelled"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CardHeader
            eyebrow="Revenue"
            title="Monthly recurring revenue by tier"
            sub="Stacked contribution, last seven months"
            action={
              <span className="inline-flex items-center gap-1 text-2xs text-ink-400 font-semibold">
                <Icon name="alert" size={11} />
                current split, no history yet
              </span>
            }
          />
          <div className="px-5 pb-5">
            <TrendLines
              data={trend}
              valuePrefix="Rs "
              height={248}
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
            <CardHeader eyebrow="Distribution" title="Tenants by tier" />
            <div className="px-5 pb-5">
              <StackedMix segments={mix} height={12} />
              <div className="mt-4 pt-4 border-t border-hairline">
  
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Infrastructure" title="System" />
            <div className="px-5 pb-5 space-y-3.5">
              {[
                { label: "API p95 latency", value: "184 ms", pct: 28, tone: "var(--success-mid)" },
                { label: "Database connections", value: "34 of 100", pct: 34, tone: "var(--success-mid)" },
                { label: "S3 storage", value: "1.8 TB", pct: 61, tone: "var(--chart-2)" },
                { label: "Background job queue", value: "12 waiting", pct: 14, tone: "var(--success-mid)" },
              ].map((m) => (
                <div key={m.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-ink-700">{m.label}</span>
                    <span className="text-xs font-bold tnum">{m.value}</span>
                  </div>
                  <Progress value={m.pct} height={5} tone={m.tone} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2 overflow-hidden">
          <CardHeader
            eyebrow="Tenants"
            title="Needs attention"
            sub="Billing failures, cancellations and stalled trials"
          />
          {tenantsQuery.loading ? (
            <SkeletonRows rows={3} />
          ) : tenantsQuery.error ? (
            <ErrorState body={tenantsQuery.error.message} onRetry={tenantsQuery.reload} />
          ) : atRisk.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Icon name="checkCircle" size={28} className="text-success-fg mx-auto" />
              <p className="text-sm font-semibold mt-3">Every tenant is current</p>
            </div>
          ) : (
            <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
              {atRisk.map((t) => (
                <li key={t.orgId} className="flex items-center gap-3.5 px-5 py-3.5">
                  <OrgLogo
                    name={t.name}
                    hasLogo={t.hasLogo}
                    version={t.logoVersion}
                    orgId={t.orgId}
                    size={34}
                    className="text-2xs text-white"
                    style={{background: t.accentColor}}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{t.name}</p>
                    <p className="text-2xs text-ink-500">
                      {TIER_LABEL[t.packageTier]} · {formatMoney(t.mrr)}/mo · last seen{" "}
                      {relativeTime(t.lastActiveAt)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[t.billingStatus]} dot>
                    {t.billingStatus.replace("_", " ")}
                  </Badge>
                  <Button size="sm" variant="secondary">
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            eyebrow="Access"
            title="Platform log"
            sub="Cross tenant actions are recorded separately"
          />
          {auditQuery.loading ? (
            <SkeletonRows rows={5} />
          ) : audit.length === 0 ? (
            <EmptyState
              art="inbox"
              title="Nothing logged"
              body="Platform and staff actions appear here."
              className="py-10"
            />
          ) : (
          <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
            {audit.map((a) => {
              const s = SEVERITY[a.severity];
              return (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                  <IconChip icon={s.icon} tone={s.tone} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-snug">{a.action}</p>
                    <p className="text-2xs text-ink-500 truncate">
                      <span className={cx(a.actorLabel === "system" && "italic")}>{a.actorLabel}</span> ·{" "}
                      {a.target}
                    </p>
                  </div>
                  <span className="text-2xs text-ink-400 shrink-0">{relativeTime(a.createdAt)}</span>
                </li>
              );
            })}
          </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
