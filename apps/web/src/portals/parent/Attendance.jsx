import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  IconChip,
  Metric,
  PageHeader,
  Segmented,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { AttendanceHeatmap, HeatmapLegend } from "@/components/charts";
import { formatDate } from "@/lib/cx";
import { parentApi, exportApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Attendance detail.

  The heatmap answers the shape of the term, the list answers what
  happened on a specific day. Clicking a cell drives the list, so the
  two are one interaction rather than two separate views of the same
  data sitting side by side.
*/

const MARK_META = {
  present: { tone: "success", icon: "check", label: "Present" },
  late: { tone: "warning", icon: "clock", label: "Late" },
  absent: { tone: "danger", icon: "close", label: "Absent" },
};

export default function ParentAttendance() {
  const { data, loading, error, reload } = useApi(() => parentApi.attendance(), []);
  const [filter, setFilter] = useState("all");
  const [picked, setPicked] = useState(null);

  const weeks = data?.weeks ?? [];

  const sessions = useMemo(
    () =>
      weeks
        .flat()
        .filter((c) => c.mark !== "none")
        .reverse(),
    [weeks],
  );

  const present = data?.present ?? 0;
  const late = data?.late ?? 0;
  const absent = data?.absent ?? 0;

  const rows = useMemo(() => {
    let out = sessions;
    if (picked) out = out.filter((s) => s.date === picked.date);
    else if (filter !== "all") out = out.filter((s) => s.mark === filter);
    return out.slice(0, 24);
  }, [sessions, filter, picked]);

  return (
    <div>
      <PageHeader
        eyebrow="Attendance"
        title="Every session"
        sub="Twelve weeks of classes, and what happened at each one."
        actions={
          <Button variant="secondary" icon="download" onClick={() => exportApi.attendance()}>
            Download record
          </Button>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric
            icon="calendar"
            tone="brand"
            label="Sessions held"
            value={sessions.length}
            sub="this term"
          />
          <Metric
            icon="check"
            tone="success"
            label="Present"
            value={present}
            sub={`${data?.attendancePct ?? 0}% of sessions`}
          />
          <Metric icon="clock" tone="warning" label="Late" value={late} />
          <Metric icon="close" tone="danger" label="Absent" value={absent} />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CardHeader
            eyebrow="Overview"
            title="The term at a glance"
            sub="Pick a day to see just that session"
            action={
              picked && (
                <Button size="sm" variant="ghost" icon="close" onClick={() => setPicked(null)}>
                  Clear
                </Button>
              )
            }
          />
          <div className="px-5 pb-5">
            {loading ? (
              <div className="h-40 skeleton" />
            ) : (
            <>
            <AttendanceHeatmap
              weeks={weeks}
              onSelect={(cell) =>
                setPicked(picked && picked.date === cell.date ? null : cell)
              }
            />
            <div className="mt-4 pt-4 border-t border-hairline">
              <HeatmapLegend />
            </div>
            </>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <div className="eyebrow mb-1">Log</div>
              <h3 className="text-md font-semibold">
                {picked ? formatDate(picked.date) : "Recent sessions"}
              </h3>
            </div>
          </div>
          {!picked && (
            <div className="px-5 pb-3">
              <Segmented
                size="sm"
                value={filter}
                onChange={setFilter}
                items={[
                  { value: "all", label: "All" },
                  { value: "absent", label: "Absent" },
                  { value: "late", label: "Late" },
                ]}
              />
            </div>
          )}

          {error ? (
            <ErrorState body={error.message} onRetry={reload} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              art="chart"
              title="Nothing to show"
              body="No sessions match that filter."
              className="py-10"
            />
          ) : (
            <ul className="border-t border-hairline divide-y divide-[var(--hairline)] max-h-[420px] overflow-y-auto">
              {rows.map((s) => {
                const meta = MARK_META[s.mark];
                return (
                  <li key={s.date} className="flex items-center gap-3 px-5 py-3">
                    <IconChip icon={meta.icon} tone={meta.tone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{formatDate(s.date)}</p>
                      <p className="text-2xs text-ink-500">
                        {new Date(s.date).toLocaleDateString("en-GB", { weekday: "long" })} class
                      </p>
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
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
