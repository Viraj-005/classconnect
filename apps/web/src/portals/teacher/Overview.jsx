import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CONTENT_CHIP,
  DataRow,
  IconChip,
  Metric,
  Progress,
  Ring,
  Segmented,
} from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  SkeletonChart,
  SkeletonRows,
  UpgradeGate,
} from "@/components/ui/states";
import { EngagementArea, RevenueBars } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { cx, formatMoney, formatTime, relativeTime } from "@/lib/cx";
import { teacherApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Teacher Overview, the reference screen for the whole product.

  Layout decisions worth keeping:
    - The KPI strip is one card divided by rules, not four floating
      cards. It reads as a single status line, and it is the clearest
      signal that this is not a stock admin template.
    - The main column is one tabbed panel rather than three stacked
      charts, so the screen has a single focal point.
    - The right rail carries work needing a decision (a slip to review,
      a class starting soon) rather than more numbers.
*/

const EVENT_TONE = { exam: "danger", meeting: "info", class: "brand" };
const EVENT_ICON = { exam: "quiz", meeting: "students", class: "video" };

/* Badge for figures the API flags as not yet measured. */
export function SyntheticNote({ note }) {
  if (!note) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-2xs text-ink-400 font-semibold"
      title={note}
    >
      <Icon name="alert" size={11} />
      estimated
    </span>
  );
}

function ReviewQueue({ payments, loading, error, onReload, onApprove, approving }) {
  const pending = (payments ?? []).filter((p) => p.status === "pending_review");
  const overdue = (payments ?? []).filter((p) => p.status === "overdue");

  return (
    <Card>
      <CardHeader
        eyebrow="Needs you"
        title="Review queue"
        sub={loading ? "Loading" : `${pending.length + overdue.length} items waiting`}
        action={
          <Link to="/teacher/fees">
            <Button size="sm" variant="ghost" iconRight="chevronRight">
              All fees
            </Button>
          </Link>
        }
      />
      {loading ? (
        <SkeletonRows rows={3} />
      ) : error ? (
        <ErrorState body={error.message} onRetry={onReload} />
      ) : pending.length === 0 && overdue.length === 0 ? (
        <EmptyState
          art="inbox"
          title="Nothing waiting"
          body="Payment slips and overdue accounts land here as they come in."
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-[var(--hairline)] border-t border-hairline">
          {pending.map((p) => (
            <li key={p.paymentId} className="px-5 py-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={p.studentName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{p.studentName}</p>
                  <p className="text-2xs text-ink-500 truncate">
                    Slip uploaded {relativeTime(p.submittedAt)}
                    {p.slipFilename ? `: ${p.slipFilename}` : ""}
                  </p>
                </div>
                <span className="text-sm font-bold tnum shrink-0">
                  {formatMoney(p.amount, p.currency)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2.5 pl-[46px]">
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  loading={approving}
                  onClick={() => onApprove(p.paymentId)}
                >
                  Approve
                </Button>
                <Button size="sm" variant="secondary">
                  View slip
                </Button>
                <Button size="sm" variant="ghost" className="text-danger-fg">
                  Reject
                </Button>
              </div>
            </li>
          ))}
          {overdue.map((p) => (
            <li key={p.paymentId} className="flex items-center gap-3 px-5 py-3.5">
              <Avatar name={p.studentName} size={34} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{p.studentName}</p>
                <p className="text-2xs text-danger-fg font-semibold">
                  Overdue since {relativeTime(p.expiryDate)}
                </p>
              </div>
              <Button size="sm" variant="secondary" icon="mail">
                Remind
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UpNext({ events, loading }) {
  const upcoming = (events ?? [])
    .filter((e) => new Date(e.scheduledAt) > new Date())
    .slice(0, 4);

  return (
    <Card>
      <CardHeader
        eyebrow="Schedule"
        title="Up next"
        action={
          <Link to="/teacher/schedule">
            <Button size="sm" variant="ghost" iconRight="chevronRight">
              Calendar
            </Button>
          </Link>
        }
      />
      {loading ? (
        <SkeletonRows rows={3} />
      ) : upcoming.length === 0 ? (
        <EmptyState
          art="chart"
          title="Nothing scheduled"
          body="Exams, classes and meetings you create appear here."
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-[var(--hairline)] border-t border-hairline">
          {upcoming.map((e) => (
            <li key={e.eventId} className="flex items-center gap-3 px-5 py-3">
              {/* Date block, because a teacher scanning this wants the
                  day first, not the event category. */}
              <div className="w-11 shrink-0 text-center rounded-[var(--radius-sm)] bg-sunken border border-hairline py-1">
                <div className="text-[10px] font-bold text-ink-500 uppercase leading-none">
                  {new Date(e.scheduledAt).toLocaleDateString("en-GB", { month: "short" })}
                </div>
                <div className="text-md font-bold font-display tnum leading-tight">
                  {new Date(e.scheduledAt).getDate()}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{e.title}</p>
                <p className="text-2xs text-ink-500">
                  {formatTime(e.scheduledAt)} · {e.batch} · {e.attendees} students
                </p>
              </div>
              <Badge tone={EVENT_TONE[e.type]} icon={EVENT_ICON[e.type]}>
                {e.type}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function TeacherOverview() {
  const { user, can } = useTheme();
  const [tab, setTab] = useState("engagement");
  const [range, setRange] = useState("7d");

  const overview = useApi(() => teacherApi.overview(), []);
  const payments = useApi(() => teacherApi.payments(), []);
  const events = useApi(() => teacherApi.events(), []);
  const content = useApi(() => teacherApi.content(), []);

  const approve = useMutation(async (id) => {
    await teacherApi.approvePayment(id);
    await Promise.all([payments.reload(), overview.reload()]);
  });

  const m = overview.data?.metrics;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const pendingCount = (payments.data ?? []).filter(
    (p) => p.status === "pending_review",
  ).length;

  if (overview.error) {
    return (
      <Card>
        <ErrorState
          title="Could not load your dashboard"
          body={overview.error.message}
          onRetry={overview.reload}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Greeting rather than a page title. This is a home screen. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {pendingCount > 0
              ? `${pendingCount} payment ${pendingCount === 1 ? "slip" : "slips"} waiting on you.`
              : "Nothing is waiting on you right now."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/teacher/schedule">
            <Button variant="secondary" icon="calendar">
              Schedule event
            </Button>
          </Link>
          <Link to="/teacher/content">
            <Button variant="primary" icon="upload">
              Upload content
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI strip: one card, divided by rules. */}
      <Card className="overflow-hidden">
        {overview.loading ? (
          <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-4">
                <SkeletonRows rows={1} />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
            <Metric
              icon="students"
              tone="brand"
              label="Students"
              value={m?.students ?? 0}
              sub={m?.seatLabel ?? "enrolled"}
            />
            <Metric
              icon="library"
              tone="info"
              label="Content items"
              value={m?.contentTotal ?? 0}
              sub={`${m?.contentAddedThisWeek ?? 0} added this week`}
            />
            <Metric
              icon="wallet"
              tone="success"
              label="Collected"
              value={formatMoney(m?.collected ?? 0)}
              sub={`${m?.collectionRate ?? 0}% of expected`}
            />
            <Metric
              icon="quiz"
              tone="warning"
              label="Quiz pass rate"
              value={`${overview.data?.quizMix?.passRate ?? 0}%`}
              sub="across all quizzes"
            />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="xl:col-span-2 space-y-5">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
              <div className="flex items-center gap-1">
                {[
                  { value: "engagement", label: "Engagement", icon: "pulse" },
                  { value: "revenue", label: "Revenue", icon: "wallet" },
                ].map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTab(t.value)}
                    className={cx(
                      "inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)]",
                      "text-sm font-semibold transition-colors duration-[var(--dur-fast)]",
                      tab === t.value
                        ? "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                        : "text-ink-500 hover:text-ink-900 hover:bg-ink-50",
                    )}
                  >
                    <Icon name={t.icon} size={15} />
                    {t.label}
                  </button>
                ))}
              </div>
              <Segmented
                size="sm"
                value={range}
                onChange={setRange}
                items={[
                  { value: "7d", label: "7 days" },
                  { value: "30d", label: "30 days" },
                  { value: "90d", label: "Quarter" },
                ]}
              />
            </div>

            {overview.loading ? (
              <SkeletonChart />
            ) : (
              <div className="px-5 pb-2">
                {tab === "engagement" ? (
                  <>
                    <div className="flex items-baseline gap-3 mb-3">
                      <span className="text-3xl font-bold font-display tnum leading-none">
                        {(overview.data?.engagement?.total ?? 0).toLocaleString()}
                      </span>
                      <span
                        className={cx(
                          "inline-flex items-center gap-1 text-xs font-bold",
                          (overview.data?.engagement?.deltaPct ?? 0) >= 0
                            ? "text-success-fg"
                            : "text-danger-fg",
                        )}
                      >
                        <Icon
                          name={
                            (overview.data?.engagement?.deltaPct ?? 0) >= 0
                              ? "trendUp"
                              : "trendDown"
                          }
                          size={13}
                          strokeWidth={2.3}
                        />
                        {Math.abs(overview.data?.engagement?.deltaPct ?? 0)}% vs last week
                      </span>
                      <SyntheticNote note={overview.data?.engagement?.note} />
                    </div>
                    <EngagementArea
                      data={overview.data?.engagement?.points ?? []}
                      compareLabel="Last week"
                    />
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-3 mb-3">
                      <span className="text-3xl font-bold font-display tnum leading-none">
                        {formatMoney(m?.collected ?? 0)}
                      </span>
                      <SyntheticNote note={overview.data?.revenue?.note} />
                    </div>
                    <RevenueBars data={overview.data?.revenue?.points ?? []} />
                  </>
                )}
              </div>
            )}

            <div className="flex items-center gap-4 px-5 py-3 border-t border-hairline">
              <span className="flex items-center gap-1.5 text-2xs font-semibold text-ink-500">
                <span className="size-2 rounded-[3px] bg-[var(--portal-accent)]" />
                This period
              </span>
              {tab === "engagement" && (
                <span className="flex items-center gap-1.5 text-2xs font-semibold text-ink-500">
                  <span className="w-4 border-t-2 border-dashed border-ink-300" />
                  Previous period
                </span>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              eyebrow="Library"
              title="Recently published"
              sub="Reach is the share of enrolled students who opened it"
              action={
                <Link to="/teacher/content">
                  <Button size="sm" variant="ghost" iconRight="chevronRight">
                    All content
                  </Button>
                </Link>
              }
            />
            {content.loading ? (
              <SkeletonRows rows={5} />
            ) : (content.data ?? []).length === 0 ? (
              <EmptyState
                art="list"
                title="The library is empty"
                body="Upload a lecture recording or a past paper to get your first batch started."
                action={
                  <Link to="/teacher/content">
                    <Button variant="primary" icon="upload">
                      Upload
                    </Button>
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)] border-t border-hairline">
                {(content.data ?? []).slice(0, 5).map((c) => {
                  const chip = CONTENT_CHIP[c.type];
                  return (
                    <li
                      key={c.contentId}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50/60 transition-colors"
                    >
                      <IconChip icon={chip.icon} tone={chip.tone} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{c.title}</p>
                        <p className="text-2xs text-ink-500">
                          {c.subject} · {relativeTime(c.createdAt)}
                          {c.durationMins ? ` · ${c.durationMins} min` : ""}
                          {c.sizeLabel ? ` · ${c.sizeLabel}` : ""}
                        </p>
                      </div>
                      <div className="hidden sm:flex items-center gap-2.5 w-32 shrink-0">
                        <Progress value={c.reachPct} height={5} />
                        <span className="text-2xs font-bold tnum text-ink-600 w-8 text-right">
                          {c.reachPct}%
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Right rail: decisions, not more numbers. */}
        <div className="space-y-5">
          <ReviewQueue
            payments={payments.data}
            loading={payments.loading}
            error={payments.error}
            onReload={payments.reload}
            onApprove={approve.mutate}
            approving={approve.pending}
          />
          <UpNext events={events.data} loading={events.loading} />

          {can("analytics_full") ? (
            <Card>
              <CardHeader eyebrow="This week" title="Class health" />
              <div className="px-5 pb-5 flex items-center gap-5">
                <Ring value={m?.collectionRate ?? 0} size={84} sub="collected" />
                <div className="flex-1 min-w-0">
                  <DataRow label="Students paid" value={`${m?.studentsPaid ?? 0}/${m?.students ?? 0}`} icon="wallet" />
                  <DataRow label="Slips to review" value={m?.pendingReview ?? 0} icon="inbox" />
                  <DataRow label="Overdue" value={m?.overdue ?? 0} icon="alert" />
                </div>
              </div>
            </Card>
          ) : (
            <UpgradeGate feature="analytics_full" compact />
          )}
        </div>
      </div>
    </div>
  );
}
