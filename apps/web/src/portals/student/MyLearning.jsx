import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CONTENT_CHIP,
  DataRow,
  IconChip,
  Progress,
  Ring,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, daysUntil, formatDay, formatTime } from "@/lib/cx";
import { studentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Student home.

  Built around one question: what do I do next. The screen opens with
  the item in progress at full width (the player hero from the second
  reference) and the rest of the track sits under it as a numbered rail.
  Fees and calendar are secondary and live in the rail.
*/

function PlayerHero({ item }) {
  return (
    <Card className="overflow-hidden">
      <div
        className="relative aspect-[16/7] min-h-[248px] flex items-end"
        style={{
          background:
            "linear-gradient(135deg, var(--portal-accent) 0%, var(--portal-accent-hover) 100%)",
        }}
      >
        <svg className="absolute inset-0 w-full h-full opacity-[0.13]" aria-hidden="true">
          <defs>
            <pattern id="hero-grid" width="34" height="34" patternUnits="userSpaceOnUse">
              <path d="M34 0H0v34" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-grid)" />
        </svg>

        {/* Centred on the upper region, not the whole box, so it never
            collides with the title block when the hero is short. */}
        <button
          className={cx(
            "absolute inset-x-0 top-0 bottom-28 m-auto size-16 rounded-full",
            "bg-white/95 text-[var(--portal-accent)]",
            "flex items-center justify-center shadow-[var(--shadow-lg)]",
            "hover:scale-105 transition-transform duration-[var(--dur-med)] ease-[var(--ease-out)]",
          )}
          aria-label={`Resume ${item.title}`}
        >
          <Icon name="play" size={24} className="ml-1" />
        </button>

        <div className="relative w-full p-5 pt-14 bg-gradient-to-t from-black/80 via-black/55 to-transparent">
          <Badge tone="brand" className="bg-white/20 text-white mb-2">
            {item.progress > 0 ? "Resume" : "Start"}
          </Badge>
          <h2 className="text-lg font-bold text-white font-display leading-snug">{item.title}</h2>
          <p className="text-xs text-white/80 mt-1">
            {item.subject}
            {item.durationMins
              ? ` · ${item.watchedMins} of ${item.durationMins} minutes watched`
              : ""}
          </p>
          <div className="mt-3 h-1 rounded-full bg-white/25 overflow-hidden">
            <div className="h-full bg-white rounded-full" style={{ width: `${item.progress}%` }} />
          </div>
        </div>
      </div>
    </Card>
  );
}

/*
  Numbered track rail, from the second reference's course completion
  list. The connecting line is what makes it read as a sequence rather
  than an unordered list of files.
*/
function TrackRail({ track, loading }) {
  const done = track.filter((t) => t.progress === 100).length;
  return (
    <Card>
      <CardHeader
        eyebrow="This week"
        title="Your track"
        sub={loading ? "Loading" : `${done} of ${track.length} complete`}
        action={
          <Link to="/student/library">
            <Button size="sm" variant="ghost" iconRight="chevronRight">
              All resources
            </Button>
          </Link>
        }
      />
      {loading ? (
        <SkeletonRows rows={4} />
      ) : track.length === 0 ? (
        <EmptyState
          art="list"
          title="Nothing set yet"
          body="Material your teacher publishes shows up here."
          className="py-10"
        />
      ) : (
        <ol className="px-5 pb-5 pt-1">
          {track.map((t, i) => {
            const complete = t.progress === 100;
            const started = t.progress > 0 && !complete;
            const chip = CONTENT_CHIP[t.type] ?? CONTENT_CHIP.doc;
            const last = i === track.length - 1;
            return (
              <li key={t.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                {!last && (
                  <span
                    className="absolute left-[15px] top-8 bottom-0 w-0.5 rounded-full"
                    style={{ background: complete ? "var(--portal-accent)" : "var(--ink-100)" }}
                  />
                )}
                <span
                  className={cx(
                    "relative z-10 size-8 shrink-0 rounded-full flex items-center justify-center",
                    "text-2xs font-bold tnum border-2",
                    complete
                      ? "bg-[var(--portal-accent)] border-[var(--portal-accent)] text-[var(--portal-contrast)]"
                      : started
                        ? "bg-surface border-[var(--portal-accent)] text-[var(--portal-accent)]"
                        : "bg-surface border-ink-200 text-ink-400",
                  )}
                >
                  {complete ? <Icon name="check" size={14} strokeWidth={2.6} /> : i + 1}
                </span>

                <div
                  className={cx(
                    "flex-1 min-w-0 rounded-[var(--radius-md)] border p-3.5 transition-colors",
                    started
                      ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)]"
                      : "border-hairline hover:bg-ink-50/60",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <IconChip icon={chip.icon} tone={complete ? "success" : chip.tone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug">{t.title}</p>
                      <p className="text-2xs text-ink-500 mt-0.5">
                        {t.subject}
                        {t.durationMins ? ` · ${t.durationMins} min` : ""}
                      </p>
                    </div>
                    {complete ? (
                      <Badge tone="success">Done</Badge>
                    ) : (
                      <Button size="sm" variant={started ? "primary" : "secondary"}>
                        {started ? "Resume" : "Start"}
                      </Button>
                    )}
                  </div>
                  {started && (
                    <div className="flex items-center gap-2 mt-2.5">
                      <Progress value={t.progress} height={5} />
                      <span className="text-2xs font-bold tnum text-[var(--portal-accent)]">
                        {t.progress}%
                      </span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export default function MyLearning() {
  const { user, can } = useTheme();
  const { data, loading, error, reload } = useApi(() => studentApi.overview(), []);
  const quizzes = useApi(() => studentApi.quizzes(), []);

  if (error) {
    return (
      <Card>
        <ErrorState
          title="Could not load your learning"
          body={
            error.status === 404
              ? "This account has no student record in this organisation."
              : error.message
          }
          onRetry={reload}
        />
      </Card>
    );
  }

  const me = data?.student;
  const track = data?.track ?? [];
  const events = data?.events ?? [];
  const openQuizzes = (quizzes.data ?? []).filter((q) => q.status === "open");
  const inProgress = track.find((t) => t.progress > 0 && t.progress < 100) ?? track[0];
  const overall = track.length
    ? Math.round(track.reduce((s, t) => s + t.progress, 0) / track.length)
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">
            {me ? `${me.batch ?? ""} ${me.group ? `· ${me.group}` : ""}` : "Loading"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Hello, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {openQuizzes.length} {openQuizzes.length === 1 ? "quiz is" : "quizzes are"} open
            {events[0] ? ` and your next class is ${formatDay(events[0].scheduledAt)}` : ""}.
          </p>
        </div>
        {me && (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="eyebrow">Attendance</div>
              <div className="text-xl font-bold font-display tnum">{me.attendancePct}%</div>
            </div>
            <div className="w-px h-9 bg-hairline" />
            <div className="text-right">
              <div className="eyebrow">Track</div>
              <div className="text-xl font-bold font-display tnum">{overall}%</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {loading ? (
            <Card className="h-64 skeleton" />
          ) : (
            inProgress && <PlayerHero item={inProgress} />
          )}
          <TrackRail track={track} loading={loading} />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader eyebrow="Progress" title="Where you stand" />
            <div className="px-5 pb-5 flex items-center gap-5">
              <Ring value={overall} size={86} sub="this week" />
              <div className="flex-1 min-w-0">
                <DataRow
                  label="Lessons done"
                  value={`${track.filter((t) => t.progress === 100).length}/${track.length}`}
                  icon="video"
                />
                <DataRow label="Quizzes open" value={openQuizzes.length} icon="quiz" />
                <DataRow label="Attendance" value={`${me?.attendancePct ?? 0}%`} icon="calendar" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              eyebrow="Due soon"
              title="Quizzes"
              action={
                <Link to="/student/quizzes">
                  <Button size="sm" variant="ghost" iconRight="chevronRight">
                    All
                  </Button>
                </Link>
              }
            />
            {quizzes.loading ? (
              <SkeletonRows rows={2} />
            ) : openQuizzes.length === 0 ? (
              <EmptyState
                art="inbox"
                title="Nothing open"
                body="You are up to date."
                className="py-8"
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)] border-t border-hairline">
                {openQuizzes.map((q) => {
                  const days = daysUntil(q.dueAt);
                  return (
                    <li key={q.quizId} className="flex items-center gap-3 px-5 py-3">
                      <IconChip icon="quiz" tone={days <= 2 ? "danger" : "warning"} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{q.title}</p>
                        <p className="text-2xs text-ink-500">
                          {q.questions} questions · due in {days}d
                        </p>
                      </div>
                      <Button size="sm" variant="primary">
                        Start
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Access status. For a student this is what blocks class entry. */}
          <Card>
            <CardHeader eyebrow="Access" title="Your class ticket" />
            <div className="px-5 pb-5">
              {can("qr_ticketing") && me?.ticketExpiry ? (
                <>
                  <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-success-bg px-4 py-3">
                    <Icon name="checkCircle" size={20} className="text-success-fg shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-success-fg">Ticket active</p>
                      <p className="text-2xs text-success-fg opacity-85">
                        Valid for {daysUntil(me.ticketExpiry)} more days
                      </p>
                    </div>
                  </div>
                  <Link to="/student/ticket">
                    <Button variant="secondary" block className="mt-3" icon="qr">
                      Show my ticket
                    </Button>
                  </Link>
                </>
              ) : (
                <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-warning-bg px-4 py-3">
                  <Icon name="alert" size={20} className="text-warning-fg shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-warning-fg">Fees due</p>
                    <p className="text-2xs text-warning-fg opacity-85">
                      Settle to keep class access
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Calendar" title="Coming up" />
            {loading ? (
              <SkeletonRows rows={3} />
            ) : events.length === 0 ? (
              <EmptyState
                art="chart"
                title="Nothing scheduled"
                body="Classes and exams appear here."
                className="py-8"
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)] border-t border-hairline">
                {events.map((e) => (
                  <li key={e.eventId} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-10 shrink-0 text-center">
                      <div className="text-[10px] font-bold text-ink-500 uppercase leading-none">
                        {new Date(e.scheduledAt).toLocaleDateString("en-GB", { month: "short" })}
                      </div>
                      <div className="text-md font-bold font-display tnum">
                        {new Date(e.scheduledAt).getDate()}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{e.title}</p>
                      <p className="text-2xs text-ink-500">{formatTime(e.scheduledAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
