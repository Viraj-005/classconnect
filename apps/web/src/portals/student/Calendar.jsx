import { useMemo } from "react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { daysUntil, formatTime } from "@/lib/cx";
import { studentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Student calendar.

  Classes, exams and quiz deadlines merged into one timeline. A student
  does not think of a quiz deadline and a class as different kinds of
  thing, they think in terms of what is coming, so keeping them in
  separate lists would push the work of merging onto the reader.
*/

const KIND = {
  exam: { tone: "danger", icon: "quiz", label: "Exam", bar: "var(--danger-mid)" },
  class: { tone: "brand", icon: "video", label: "Class", bar: "var(--portal-accent)" },
  meeting: { tone: "info", icon: "students", label: "Meeting", bar: "var(--info-mid)" },
  quiz: { tone: "warning", icon: "quiz", label: "Quiz due", bar: "var(--warning-mid)" },
};

export default function StudentCalendar() {
  const overview = useApi(() => studentApi.overview(), []);
  const quizzes = useApi(() => studentApi.quizzes(), []);

  const loading = overview.loading || quizzes.loading;
  const error = overview.error ?? quizzes.error;

  const timeline = useMemo(() => {
    const items = [
      ...(overview.data?.events ?? []).map((e) => ({
        id: e.eventId,
        at: e.scheduledAt,
        title: e.title,
        kind: e.type,
        meta: `${e.durationMins} min${e.batch ? ` · ${e.batch}` : ""}`,
      })),
      ...(quizzes.data ?? [])
        .filter((q) => q.status === "open")
        .map((q) => ({
          id: q.quizId,
          at: q.dueAt,
          title: q.title,
          kind: "quiz",
          meta: `${q.questions} questions · ${q.subject}`,
        })),
    ]
      .filter((i) => new Date(i.at) >= new Date(Date.now() - 86_400_000))
      .sort((a, b) => new Date(a.at) - new Date(b.at));

    /* Group by day, so the timeline has date headers rather than a
       flat run of twenty rows. */
    const groups = [];
    for (const item of items) {
      const key = new Date(item.at).toDateString();
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(item);
      else groups.push({ key, date: new Date(item.at), items: [item] });
    }
    return groups;
  }, [overview.data, quizzes.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Planning"
        title="Calendar"
        sub="Classes, exams and quiz deadlines in one place."
        actions={
          <Button variant="secondary" icon="download">
            Add to my calendar
          </Button>
        }
      />

      {error ? (
        <Card>
          <ErrorState body={error.message} onRetry={overview.reload} />
        </Card>
      ) : loading ? (
        <Card className="max-w-3xl overflow-hidden">
          <SkeletonRows rows={5} />
        </Card>
      ) : timeline.length === 0 ? (
        <Card className="max-w-3xl">
          <EmptyState
            art="chart"
            title="Nothing scheduled"
            body="Classes and exams your teacher creates will appear here automatically."
          />
        </Card>
      ) : (
        <div className="max-w-3xl space-y-5">
          {timeline.map((group) => {
            const days = daysUntil(group.date.toISOString());
            const label =
              days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 0 ? "Yesterday" : null;
            return (
              <Card key={group.key} className="overflow-hidden">
                <CardHeader
                  eyebrow={label ?? group.date.toLocaleDateString("en-GB", { weekday: "long" })}
                  title={group.date.toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                  })}
                  action={
                    label && (
                      <Badge tone={days === 0 ? "danger" : "warning"} dot>
                        {label}
                      </Badge>
                    )
                  }
                />
                <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
                  {group.items.map((item) => {
                    const kind = KIND[item.kind] ?? KIND.class;
                    return (
                      <li
                        key={item.id}
                        className="relative flex items-center gap-3.5 px-5 py-3.5 hover:bg-ink-50/60 transition-colors"
                      >
                        <span
                          className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full"
                          style={{ background: kind.bar }}
                        />
                        <span className="text-xs font-bold tnum text-ink-600 w-12 shrink-0">
                          {formatTime(item.at)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{item.title}</p>
                          <p className="text-2xs text-ink-500">{item.meta}</p>
                        </div>
                        <Badge tone={kind.tone} icon={kind.icon}>
                          {kind.label}
                        </Badge>
                        {item.kind === "quiz" && (
                          <Button size="sm" variant="primary" className="shrink-0">
                            Start
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
