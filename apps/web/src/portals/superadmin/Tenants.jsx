import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DataRow,
  IconButton,
  PageHeader,
  Progress,
  SearchInput,
  Select,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { OrgLogo } from "@/components/ui/OrgLogo";
import { cx, formatCompact, formatDate, formatMoney, relativeTime, seeded } from "@/lib/cx";
import { TIER_LABEL, TIER_LIMITS, TIER_ORDER, seatUsage } from "@/lib/tiers";
import { platformApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Tenant management.

  The row is the unit of work here: an operator scans for anything red,
  opens it, changes a tier, moves on. So the table carries the whole
  story (tier, status, seats against cap, revenue, last seen) and the
  detail panel is for the actions rather than for more reading.

  Opening a tenant's own data is deliberately not on this screen. That
  is a separate, logged support action, per ARCHITECTURE.md section 8.
*/

/* Stable colour per tenant, derived from the slug rather than stored.
   It is decoration, so it does not need a column. */
function hueFor(slug) {
  return `hsl(${Math.round(seeded(slug ?? "") * 360)} 42% 38%)`;
}

const STATUS_TONE = {
  active: "success",
  past_due: "warning",
  canceled: "neutral",
  trialing: "info",
};

function TenantDetail({ tenant, onClose, onTierChange, saving }) {
  const students = seatUsage(tenant.packageTier, tenant.students, "students");
  const teachers = seatUsage(tenant.packageTier, tenant.teachers, "teachers");

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span
          className="size-11 rounded-[var(--radius-md)] shrink-0 flex items-center justify-center text-white text-sm font-bold font-display"
          style={{ background: hueFor(tenant.slug) }}
        >
          {tenant.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold truncate">{tenant.name}</h3>
          <p className="text-2xs text-ink-500">{tenant.slug}.classconnect.app</p>
        </div>
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </div>

      <div className="px-5 pb-5">
        <div className="flex items-center gap-2 mb-4">
          <Badge tone={STATUS_TONE[tenant.billingStatus]} dot>
            {tenant.billingStatus.replace("_", " ")}
          </Badge>
          <Badge tone="brand">{TIER_LABEL[tenant.packageTier]}</Badge>
        </div>

        <div className="space-y-3.5 mb-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-ink-700">Student seats</span>
              <span className="text-xs font-bold tnum">{students.label}</span>
            </div>
            <Progress
              value={students.unlimited ? 100 : students.pct}
              height={6}
              tone={students.nearingCap ? "var(--warning-mid)" : undefined}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-ink-700">Teacher seats</span>
              <span className="text-xs font-bold tnum">{teachers.label}</span>
            </div>
            <Progress
              value={teachers.unlimited ? 100 : teachers.pct}
              height={6}
              tone={teachers.nearingCap ? "var(--warning-mid)" : undefined}
            />
          </div>
        </div>

        <DataRow label="Monthly revenue" value={formatMoney(tenant.mrr)} icon="card" />
        
        <DataRow label="Joined" value={relativeTime(tenant.createdAt)} icon="pulse" />

        <div className="mt-4 pt-4 border-t border-hairline">
          <label className="block text-xs font-semibold text-ink-700 mb-1.5">Package tier</label>
          <Select
            value={tenant.packageTier}
            onChange={(e) => onTierChange(tenant.orgId, e.target.value)}
            disabled={saving}
          >
            {TIER_ORDER.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]} · {TIER_LIMITS[t].students === Infinity ? "unlimited" : TIER_LIMITS[t].students} students
              </option>
            ))}
          </Select>
          <p className="text-2xs text-ink-500 mt-2 leading-relaxed">
            Changing the tier updates feature access on the tenant's next request. No manual sync
            is needed.
          </p>
        </div>

        <div className="flex flex-col gap-2 mt-4">
          <Button variant="secondary" block icon="card">
            Open in Stripe Billing
          </Button>
          {/*
            The one action that crosses the tenant boundary. It is
            visually separated and states its own consequence, because
            an operator should never take it absent-mindedly.
          */}
          <Button variant="secondary" block icon="shield" className="text-warning-fg">
            Request support access
          </Button>
          <p className="text-2xs text-ink-500 flex items-start gap-1.5 leading-relaxed">
            <Icon name="alert" size={11} className="shrink-0 mt-0.5" />
            Support access opens this tenant's own data. It is logged to the platform access log
            and visible to their admin.
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function Tenants() {
  const { data, loading, error, reload } = useApi(() => platformApi.tenants(), []);
  const list = data ?? [];
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [selected, setSelected] = useState(null);

  const rows = useMemo(
    () =>
      list.filter((t) => {
        if (tab !== "all" && t.billingStatus !== tab) return false;
        if (tier !== "all" && t.packageTier !== tier) return false;
        if (query && !t.name.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [list, tab, tier, query],
  );

  const changeTier = useMutation(async (orgId, packageTier) => {
    await platformApi.changeTier(orgId, { packageTier });
    setSelected((s) => (s && s.orgId === orgId ? { ...s, packageTier } : s));
    await reload();
  });

  const counts = {
    all: list.length,
    active: list.filter((t) => t.billingStatus === "active").length,
    past_due: list.filter((t) => t.billingStatus === "past_due").length,
    trialing: list.filter((t) => t.billingStatus === "trialing").length,
  };

  return (
    <div>
      <PageHeader
        eyebrow="LoopLab operations"
        title="Tenants"
        sub="Every organisation on the platform, their tier and their standing."
        actions={
          <Button variant="primary" icon="plus">
            Onboard tenant
          </Button>
        }
      />

      <div className={cx("grid gap-5", selected ? "xl:grid-cols-3" : "grid-cols-1")}>
        <Card className={cx("overflow-hidden", selected && "xl:col-span-2")}>
          <div className="flex flex-wrap items-center gap-3 p-3">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search tenants"
              className="flex-1 min-w-[200px]"
            />
            <Select value={tier} onChange={(e) => setTier(e.target.value)} className="w-40">
              <option value="all">All tiers</option>
              {TIER_ORDER.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            className="px-3"
            items={[
              { value: "all", label: "All", count: counts.all },
              { value: "active", label: "Active", count: counts.active },
              { value: "past_due", label: "Past due", count: counts.past_due },
              { value: "trialing", label: "Trials", count: counts.trialing },
            ]}
          />

          {error ? (
            <ErrorState body={error.message} onRetry={reload} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              art="list"
              title="No tenants match"
              body="Adjust the tier filter, or clear the search."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setTier("all");
                    setTab("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b border-hairline bg-sunken">
                    {["Tenant", "Tier", "Status", "Seats", "MRR", "Joined", ""].map((h) => (
                      <th key={h} className="eyebrow text-left px-5 py-2.5 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--hairline)]">
                  {rows.map((t) => {
                    const seats = seatUsage(t.packageTier, t.students, "students");
                    const isSelected = selected?.orgId === t.orgId;
                    return (
                      <tr
                        key={t.orgId}
                        onClick={() => setSelected(isSelected ? null : t)}
                        className={cx(
                          "cursor-pointer transition-colors",
                          isSelected
                            ? "bg-[var(--portal-accent-soft)]"
                            : "hover:bg-ink-50/60",
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
                    style={{background: hueFor(t.slug)}}
                  />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{t.name}</p>
                              <p className="text-2xs text-ink-500 truncate">{t.slug}</p>
                            </div>
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
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2 w-28">
                            <Progress
                              value={seats.unlimited ? 100 : seats.pct}
                              height={5}
                              tone={seats.nearingCap ? "var(--warning-mid)" : undefined}
                            />
                            <span className="text-2xs font-bold tnum shrink-0">
                              {formatCompact(t.students)}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-sm font-bold tnum">{formatMoney(t.mrr)}</td>
                        <td className="px-5 py-3 text-2xs text-ink-500 whitespace-nowrap">
                          {formatDate(t.createdAt)}
                        </td>
                        <td className="px-5 py-3">
                          <Icon name="chevronRight" size={15} className="text-ink-400" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selected && (
          <TenantDetail
            tenant={selected}
            onClose={() => setSelected(null)}
            onTierChange={changeTier.mutate}
            saving={changeTier.pending}
          />
        )}
      </div>
    </div>
  );
}
