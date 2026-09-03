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
import { cx, formatTime } from "@/lib/cx";
import { adminApi, exportApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Tenant audit log.

  Scoped to this organisation only. A tenant admin can never see another
  tenant's events, and the log itself says so, because in a shared
  database product that guarantee is exactly what a buyer will ask about
  first.
*/

const SEVERITY = {
  info: { tone: "neutral", icon: "check", label: "Info" },
  warning: { tone: "warning", icon: "shield", label: "Warning" },
  critical: { tone: "danger", icon: "alert", label: "Critical" },
};

export default function Logs() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("7");

  const { data, loading, error, reload } = useApi(() => adminApi.audit({ limit: 200 }), []);
  const entries = data ?? [];

  const rows = useMemo(
    () =>
      entries.filter((e) => {
        if (tab !== "all" && e.severity !== tab) return false;
        if (query && !`${e.actorLabel} ${e.action} ${e.target ?? ""}`.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      }),
    [entries, tab, query],
  );

  /* Group by day, so a long log stays readable. */
  const groups = useMemo(() => {
    const out = [];
    for (const e of rows) {
      const key = new Date(e.createdAt).toDateString();
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, date: new Date(e.createdAt), items: [e] });
    }
    return out;
  }, [rows]);

  const counts = {
    all: entries.length,
    warning: entries.filter((e) => e.severity === "warning").length,
    critical: entries.filter((e) => e.severity === "critical").length,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Organisation"
        title="Audit log"
        sub="Payments, access attempts and account changes inside your organisation."
        actions={
          <Button variant="secondary" icon="download" onClick={() => exportApi.audit()}>
            Export log
          </Button>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-3 rule-grid">
          <Metric icon="shield" tone="neutral" label="Events" value={counts.all} sub="last 7 days" />
          <Metric icon="alert" tone="warning" label="Warnings" value={counts.warning} />
          <Metric icon="close" tone="danger" label="Critical" value={counts.critical} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search actor, action or target"
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
            { value: "warning", label: "Warnings", count: counts.warning },
            { value: "critical", label: "Critical", count: counts.critical },
          ]}
        />

        {error ? (
          <ErrorState body={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={8} />
        ) : groups.length === 0 ? (
          <EmptyState
            art="inbox"
            title="No events match"
            body="Try widening the date range, or clear the search."
            action={
              <Button variant="secondary" onClick={() => { setQuery(""); setTab("all"); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="border-t border-hairline">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="sticky top-0 z-10 flex items-center gap-3 bg-sunken px-5 py-2 border-b border-hairline">
                  <span className="eyebrow">
                    {g.date.toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                  <span className="text-2xs text-ink-400 tnum">{g.items.length} events</span>
                </div>
                <ul className="divide-y divide-[var(--hairline)]">
                  {g.items.map((e) => {
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
                            <span className={cx(e.actorLabel === "system" && "italic")}>{e.actorLabel}</span>
                            {" · "}
                            {e.target}
                          </p>
                        </div>
                        {e.severity !== "info" && <Badge tone={s.tone}>{s.label}</Badge>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-4 border-t border-hairline flex items-start gap-2.5">
          <Icon name="shield" size={14} className="text-ink-400 shrink-0 mt-0.5" />
          <p className="text-2xs text-ink-500 leading-relaxed">
            This log contains events from {" "}
            <span className="font-semibold text-ink-700">your organisation only</span>. Access by
            LoopLab support staff is recorded separately and is visible here whenever it happens.
          </p>
        </div>
      </Card>
    </div>
  );
}
