import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  Metric,
  PageHeader,
  Progress as Bar,
  Ring,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { AttendanceHeatmap, HeatmapLegend, Sparkline } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";
import { parentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Parent dashboard.

  A parent is not an operator, they are checking in. So this screen
  answers three questions in order and then stops: is my child turning
  up, are the grades moving, is there anything I need to act on. No
  tables, no filters, no bulk actions.
*/

function ChildHeader({ child }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-5 p-5">
        <Avatar name={child.name} size={56} online />
        <div className="min-w-0">
          <h2 className="text-lg font-bold font-display">{child.name}</h2>
          <p className="text-sm text-ink-500">
            {child.batch}
            {child.group ? ` · ${child.group}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-6 ml-auto">
          <div className="text-center">
            <div className="eyebrow">Attendance</div>
            <div className="text-2xl font-bold font-display tnum mt-0.5">
              {child.attendancePct}%
            </div>
          </div>
          <div className="w-px h-10 bg-hairline" />
          <div className="text-center">
            <div className="eyebrow">Fees</div>
            <div className="mt-1.5">
              <Badge tone={child.paymentStatus === "paid" ? "success" : "warning"} dot>
                {child.paymentStatus === "paid" ? "Paid" : "Due"}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function GradeTrends({ subjects }) {
  return (
    <Card>
      <CardHeader
        eyebrow="Academic"
        title="Grade trends"
        sub="Average per subject across recent assessments"
        action={
          subjects.some((s) => s.synthetic) && (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-400 font-semibold">
              <Icon name="alert" size={11} />
              estimated
            </span>
          )
        }
      />
      {subjects.length === 0 ? (
        <EmptyState
          art="chart"
          title="No grades yet"
          body="Scores appear here once assessments have been marked."
          className="py-10"
        />
      ) : (
        <ul className="px-5 pb-5 space-y-1">
          {subjects.map((s) => {
            const falling = s.delta < 0;
            return (
              <li
                key={s.subject}
                className="flex items-center gap-4 py-2.5 border-b border-hairline last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{s.subject}</p>
                  <p
                    className={cx(
                      "text-2xs font-bold flex items-center gap-1 mt-0.5",
                      falling ? "text-danger-fg" : "text-success-fg",
                    )}
                  >
                    <Icon name={falling ? "trendDown" : "trendUp"} size={11} strokeWidth={2.3} />
                    {falling ? "" : "+"}
                    {s.delta} points this term
                  </p>
                </div>
                <Sparkline
                  values={s.trend}
                  width={96}
                  height={30}
                  tone={falling ? "var(--danger-mid)" : "var(--success-mid)"}
                />
                <span
                  className={cx(
                    "text-xl font-bold font-display tnum w-10 text-right shrink-0",
                    falling ? "text-danger-fg" : "text-ink-950",
                  )}
                >
                  {s.score}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function ParentProgress() {
  const { data, loading, error, reload } = useApi(() => parentApi.progress(), []);

  if (error) {
    return (
      <Card>
        <ErrorState
          title="Could not load your child's progress"
          body={
            error.status === 404
              ? "No child is linked to this account. Ask the school to link one."
              : error.message
          }
          onRetry={reload}
        />
      </Card>
    );
  }

  const child = data?.child;
  const attendance = data?.attendance;
  const subjects = data?.subjects ?? [];
  const weak = subjects.filter((s) => s.delta < 0 || s.score < 75);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Guardian view"
        title={child ? `How ${child.name.split(" ")[0]} is doing` : "Progress"}
        sub="Attendance, grades and anything that needs your attention this term."
        actions={
          <Button variant="secondary" icon="mail">
            Message the teacher
          </Button>
        }
      />

      {loading ? (
        <Card className="h-28 skeleton" />
      ) : (
        child && <ChildHeader child={child} />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Card>
            <CardHeader
              eyebrow="Attendance"
              title="Last twelve weeks"
              sub="Classes run Tuesday, Thursday and Saturday"
              action={
                attendance && (
                  <Badge tone={attendance.absent > 2 ? "warning" : "success"}>
                    {attendance.attendancePct}% present
                  </Badge>
                )
              }
            />
            <div className="px-5 pb-5">
              {loading ? (
                <div className="h-40 skeleton" />
              ) : (
                <>
                  <AttendanceHeatmap weeks={attendance?.weeks ?? []} />
                  <div className="mt-4 pt-4 border-t border-hairline">
                    <HeatmapLegend />
                  </div>
                </>
              )}
            </div>
          </Card>

          {loading ? (
            <Card className="overflow-hidden">
              <SkeletonRows rows={4} />
            </Card>
          ) : (
            <GradeTrends subjects={subjects} />
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader eyebrow="Term" title="Attendance breakdown" />
            <div className="px-5 pb-5 flex items-center gap-5">
              <Ring
                value={attendance?.attendancePct ?? 0}
                size={88}
                sub="present"
                tone="var(--success-mid)"
              />
              <div className="flex-1 min-w-0">
                <DataRow label="Present" value={attendance?.present ?? 0} icon="check" />
                <DataRow label="Late" value={attendance?.late ?? 0} icon="clock" />
                <DataRow label="Absent" value={attendance?.absent ?? 0} icon="close" />
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 rule-grid">
              <Metric
                icon="calendar"
                tone="brand"
                label="Sessions"
                value={attendance?.sessions ?? 0}
                sub="this term"
              />
              <Metric
                icon="book"
                tone="info"
                label="Subjects"
                value={subjects.length}
                sub="being tracked"
              />
            </div>
          </Card>

          {weak.length > 0 && (
            <Card>
              <CardHeader
                eyebrow="Focus"
                title="Where to help"
                sub="Subjects trending down or below 75"
              />
              <div className="px-5 pb-5">
                {weak.map((s) => (
                  <div key={s.subject} className="mb-4 last:mb-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold">{s.subject}</span>
                      <span className="text-sm font-bold tnum text-danger-fg">{s.score}</span>
                    </div>
                    <Bar value={s.score} height={6} tone="var(--danger-mid)" />
                    {s.delta < 0 && (
                      <p className="text-2xs text-ink-500 mt-2 leading-relaxed">
                        Down {Math.abs(s.delta)} points across recent assessments.
                      </p>
                    )}
                  </div>
                ))}
                <Button variant="secondary" block className="mt-2" icon="mail">
                  Ask about extra support
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
