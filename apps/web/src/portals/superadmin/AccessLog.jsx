import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  IconChip,
  Metric,
  PageHeader,
  SearchInput,
  Select,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, formatTime, relativeTime } from "@/lib/cx";
import { platformApi, exportApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Platform access log.

  ARCHITECTURE.md section 8 requires cross tenant access by LoopLab
  staff to be logged separately from ordinary events. So this screen
  splits them: staff actions that crossed a tenant boundary sit at the
  top, on their own, and everything else is below. Burying a support
  access event in a general feed would defeat the point of recording it.
*/

const SEVERITY = {
  info: { tone: "neutral", icon: "check", label: "Info" },
  warning: { tone: "warning", icon: "shield", label: "Cross tenant" },
  critical: { tone: "danger", icon: "alert", label: "Critical" },
};

export default function AccessLog() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("7");

  const { data, loading, error, reload } = useApi(
    () => platformApi.audit({ limit: 200 }),
    [],
  );
  const entries = data ?? [];

  /* The server sets crossTenant on the row itself, so this does not
     have to guess from the action text. */
  const crossTenant = entries.filter((e) => e.crossTenant);

  const rows = useMemo(
    () =>
      entries.filter((e) => {
        if (tab === "staff" && e.actorLabel === "system") return false;
        if (tab === "system" && e.actorLabel !== "system") return false;
        if (tab === "critical" && e.severity !== "critical") return false;
        if (query && !`${e.actorLabel} ${e.action} ${e.target ?? ""}`.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      }),
    [entries, tab, query],
  );

  const counts = {
    all: entries.length,
    staff: entries.filter((e) => e.actorLabel !== "system").length,
    system: entries.filter((e) => e.actorLabel === "system").length,
    critical: entries.filter((e) => e.severity === "critical").length,
  };

  return (
    <div>
      <PageHeader
        eyebrow="LoopLab operations"
        title="Access log"
        sub="Everything LoopLab staff and the platform itself did, across all tenants."
        actions={
          <Button variant="secondary" icon="download" onClick={() => exportApi.tenants()}>
            Export log
          </Button>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric icon="shield" tone="neutral" label="Events" value={counts.all} sub="last 7 days" />
          <Metric icon="user" tone="info" label="Staff actions" value={counts.staff} />
          <Metric
            icon="building"
            tone="warning"
            label="Cross tenant access"
            value={crossTenant.length}
            sub="each one is reviewable"
          />
          <Metric icon="alert" tone="danger" label="Critical" value={counts.critical} />
        </div>
      </Card>

      {/* Cross tenant access, called out on its own. */}
      {crossTenant.length > 0 && (
        <Card className="mb-5 overflow-hidden border-[color-mix(in_srgb,var(--warning-mid)_32%,transparent)]">
          <div className="flex items-start gap-3 px-5 py-4 bg-warning-bg">
            <Icon name="shield" size={18} className="text-warning-fg shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-warning-fg">
                {crossTenant.length} cross tenant access{" "}
                {crossTenant.length === 1 ? "event" : "events"}
              </p>
              <p className="text-2xs text-warning-fg opacity-85 mt-0.5">
                A LoopLab operator opened a tenant's own data. The tenant's admin can see these
                entries in their own audit log too.
              </p>
            </div>
          </div>
          <ul className="divide-y divide-[var(--hairline)]">
            {crossTenant.map((e) => (
              <li key={e.id} className="flex items-center gap-3.5 px-5 py-3">
                <IconChip icon="building" tone="warning" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{e.action}</p>
                  <p className="text-2xs text-ink-500 truncate">
                    {e.actorLabel} · {e.target}
                  </p>
                </div>
                <span className="text-2xs text-ink-400 shrink-0">{relativeTime(e.createdAt)}</span>
                <Button size="sm" variant="secondary">
                  Review
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search actor, action or tenant"
            className="flex-1 min-w-[220px]"
          />
          <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40">
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </Select>
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          className="px-3"
          items={[
            { value: "all", label: "Everything", count: counts.all },
            { value: "staff", label: "Staff", count: counts.staff },
            { value: "system", label: "System", count: counts.system },
            { value: "critical", label: "Critical", count: counts.critical },
          ]}
        />

        {error ? (
          <ErrorState body={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            art="inbox"
            title="No events match"
            body="Try widening the range, or clear the search."
            action={
              <Button variant="secondary" onClick={() => { setQuery(""); setTab("all"); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
            {rows.map((e) => {
              const s = SEVERITY[e.severity];
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3.5 px-5 py-3 hover:bg-ink-50/60 transition-colors"
                >
                  <span className="text-2xs text-ink-400 tnum w-11 shrink-0">
                    {formatTime(e.createdAt)}
                  </span>
                  <IconChip icon={s.icon} tone={s.tone} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{e.action}</p>
                    <p className="text-2xs text-ink-500 truncate">
                      <span className={cx(e.actorLabel === "system" && "italic")}>{e.actorLabel}</span> ·{" "}
                      {e.target}
                    </p>
                  </div>
                  {e.severity !== "info" && <Badge tone={s.tone}>{s.label}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
