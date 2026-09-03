import { useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Metric,
  PageHeader,
  Progress,
  Segmented,
} from "@/components/ui/primitives";
import {
  ErrorState,
  LockedAction,
  SkeletonChart,
  SkeletonRows,
  UpgradeGate,
} from "@/components/ui/states";
import { EngagementArea, PassRateDonut, RevenueBars } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { cx, formatMoney } from "@/lib/cx";
import { useTheme } from "@/theme/ThemeProvider";
import { teacherApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { SyntheticNote } from "./Overview";

/*
  Teacher analytics, Growth and Pro.

  The BRD asks for engagement, revenue and quiz pass rate. The trap here
  is three generic charts in a row, so each one is given a different
  form: an area for engagement over time, bars for revenue by month, a
  donut plus ranked list for pass rates, and a horizontal ranked bar for
  subject reach. Different questions, different shapes.
*/

function SubjectReach({ rows }) {
  const max = Math.max(1, ...rows.map((s) => s.reach));
  const weakest = [...rows].sort((a, b) => a.reach - b.reach)[0];
  return (
    <Card>
      <CardHeader
        eyebrow="Coverage"
        title="Reach by subject"
        sub="Share of enrolled students opening material in each subject"
      />
      <ul className="px-5 pb-5 space-y-3.5">
        {rows.map((s) => {
          const weak = s.reach < 60;
          return (
            <li key={s.subject}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="text-sm font-semibold truncate">{s.subject}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-2xs text-ink-500">{s.items} items</span>
                  <span
                    className={cx(
                      "text-sm font-bold tnum w-9 text-right",
                      weak ? "text-danger-fg" : "text-ink-900",
                    )}
                  >
                    {s.reach}%
                  </span>
                </span>
              </div>
              <Progress
                value={(s.reach / max) * 100}
                height={7}
                tone={weak ? "var(--danger-mid)" : undefined}
              />
            </li>
          );
        })}
      </ul>
      {weakest && weakest.reach < 60 && (
        <div className="mx-5 mb-5 flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-warning-bg px-3 py-2.5">
          <Icon name="alert" size={14} className="text-warning-fg shrink-0 mt-0.5" />
          <p className="text-2xs text-warning-fg leading-relaxed">
            {weakest.subject} sits well below the rest at {weakest.reach}%, on{" "}
            {weakest.items} {weakest.items === 1 ? "item" : "items"} for the whole batch.
          </p>
        </div>
      )}
    </Card>
  );
}

function QuizTable({ rows, loading, error, onRetry }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader eyebrow="Assessment" title="Quiz performance" sub="Ranked by pass rate" />
      {error ? (
        /* A failed fetch here used to render an empty table, which
           reads as 'no quizzes' rather than 'this did not load'. */
        <ErrorState body={error.message} onRetry={onRetry} />
      ) : loading ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-y border-hairline bg-sunken">
              {["Quiz", "Subject", "Attempts", "Average", "Pass rate"].map((h) => (
                <th key={h} className="eyebrow text-left px-5 py-2.5 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--hairline)]">
            {[...rows]
              .sort((a, b) => b.passRate - a.passRate)
              .map((q) => (
                <tr key={q.quizId} className="hover:bg-ink-50/60 transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold">{q.title}</td>
                  <td className="px-5 py-3 text-sm text-ink-600">{q.subject}</td>
                  <td className="px-5 py-3 text-sm tnum">{q.attempts}</td>
                  <td className="px-5 py-3 text-sm tnum">{q.avgScore}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5 w-32">
                      <Progress
                        value={q.passRate}
                        height={6}
                        tone={
                          q.passRate < 60
                            ? "var(--danger-mid)"
                            : q.passRate < 75
                              ? "var(--warning-mid)"
                              : "var(--success-mid)"
                        }
                      />
                      <span className="text-xs font-bold tnum w-8">{q.passRate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Analytics() {
  const { can } = useTheme();
  const [range, setRange] = useState("30d");

  const analytics = useApi(() => teacherApi.analytics(), [], {
    skip: !can("analytics_full"),
  });
  const quizzes = useApi(() => teacherApi.quizzes(), [], { skip: !can("analytics_full") });
  const overview = useApi(() => teacherApi.overview(), []);

  const d = analytics.data;

  if (!can("analytics_full")) {
    return (
      <div>
        <PageHeader
          eyebrow="Insight"
          title="Analytics"
          sub="Engagement, revenue and assessment performance across your batches."
        />
        {/* Starter still gets the counts the BRD promises. */}
        <Card className="mb-5 overflow-hidden">
          <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
            <Metric
              icon="students"
              tone="brand"
              label="Students"
              value={overview.data?.metrics?.students ?? 0}
            />
            <Metric
              icon="library"
              tone="info"
              label="Content items"
              value={overview.data?.metrics?.contentTotal ?? 0}
            />
            <Metric
              icon="wallet"
              tone="warning"
              label="Collected"
              value={formatMoney(overview.data?.metrics?.collected ?? 0)}
            />
            <Metric
              icon="check"
              tone="success"
              label="Students paid"
              value={overview.data?.metrics?.studentsPaid ?? 0}
            />
          </div>
        </Card>
        <UpgradeGate
          feature="analytics_full"
          preview={
            <div className="p-5">
              <EngagementArea data={overview.data?.engagement?.points ?? []} height={220} />
            </div>
          }
        />
      </div>
    );
  }

  if (analytics.error) {
    return (
      <Card>
        <ErrorState body={analytics.error.message} onRetry={analytics.reload} />
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Insight"
        title="Analytics"
        sub="Engagement, revenue and assessment performance across your batches."
        actions={
          <>
            <Segmented
              value={range}
              onChange={setRange}
              items={[
                { value: "7d", label: "Week" },
                { value: "30d", label: "Month" },
                { value: "90d", label: "Quarter" },
              ]}
            />
            {can("analytics_export") ? (
              <Button variant="secondary" icon="download">
                Export CSV
              </Button>
            ) : (
              <LockedAction feature="analytics_export">
                <Button variant="secondary" icon="download">
                  Export CSV
                </Button>
              </LockedAction>
            )}
          </>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric
            icon="pulse"
            tone="brand"
            label="Weekly active"
            value={(d?.engagement?.total ?? 0).toLocaleString()}
            delta={d?.engagement?.deltaPct}
            sub="unique students"
          />
          <Metric
            icon="students"
            tone="info"
            label="Students paid"
            value={d?.payments?.byStatus?.paid?.count ?? 0}
            sub="fees settled"
          />
          <Metric
            icon="wallet"
            tone="success"
            label="Collected"
            value={formatMoney(d?.payments?.collected ?? 0)}
            sub={`${d?.payments?.collectionRate ?? 0}% of expected`}
          />
          <Metric
            icon="quiz"
            tone="warning"
            label="Pass rate"
            value={`${d?.quizMix?.passRate ?? 0}%`}
            sub="across all quizzes"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
        <Card className="xl:col-span-2">
          <CardHeader
            eyebrow="Engagement"
            title="Active learners"
            sub="Unique students opening any material, against the previous period"
            action={<SyntheticNote note={d?.engagement?.note} />}
          />
          <div className="px-5 pb-5">
            {analytics.loading ? (
              <SkeletonChart h={252} />
            ) : (
              <EngagementArea
                data={d?.engagement?.points ?? []}
                height={252}
                compareLabel="Previous"
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader eyebrow="Assessment" title="Pass rate mix" sub="All quizzes, this period" />
          <div className="px-5 pb-5">
            <PassRateDonut
              data={(d?.quizMix?.segments ?? []).map((seg, i) => ({
                ...seg,
                color: `var(--chart-${i + 3})`,
              }))}
              height={168}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
        <Card className="xl:col-span-2">
          <CardHeader
            eyebrow="Revenue"
            title="Fees collected by month"
            sub="Gross, before refunds"
            action={<SyntheticNote note={d?.revenue?.note} />}
          />
          <div className="px-5 pb-5">
            {analytics.loading ? (
              <SkeletonChart h={232} />
            ) : (
              <RevenueBars data={d?.revenue?.points ?? []} height={232} />
            )}
          </div>
        </Card>

        <SubjectReach rows={d?.subjectReach ?? []} />
      </div>

      <QuizTable
        rows={quizzes.data ?? []}
        loading={quizzes.loading}
        error={quizzes.error}
        onRetry={quizzes.reload}
      />
    </div>
  );
}
