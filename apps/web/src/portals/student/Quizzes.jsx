import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  IconChip,
  Metric,
  PageHeader,
  Ring,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Sparkline } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { cx, daysUntil, formatDate } from "@/lib/cx";
import { studentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { QuizRunner } from "./QuizRunner";

/*
  Student quiz list.

  Three states with genuinely different needs, so each renders
  differently rather than as one list with a status badge:
    open   an action, with time pressure made visible
    graded a result, with the score as the primary element
    missed a dead end, muted so it does not compete for attention
*/

const STATUS = {
  open: { tone: "warning", label: "Open" },
  graded: { tone: "success", label: "Graded" },
  missed: { tone: "danger", label: "Missed" },
};

function scoreTone(score) {
  if (score >= 75) return "var(--success-mid)";
  if (score >= 60) return "var(--portal-accent)";
  return "var(--danger-mid)";
}

function QuizRow({ q, onOpen }) {
  const days = daysUntil(q.dueAt);
  const urgent = q.status === "open" && days <= 2;

  return (
    <li
      className={cx(
        "flex items-center gap-3.5 px-5 py-4 transition-colors",
        q.status === "missed" ? "opacity-65" : "hover:bg-ink-50/60",
      )}
    >
      <IconChip
        icon={q.status === "graded" ? "checkCircle" : q.status === "missed" ? "close" : "quiz"}
        tone={STATUS[q.status].tone}
        size="lg"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">{q.title}</h3>
          <Badge tone={STATUS[q.status].tone}>{STATUS[q.status].label}</Badge>
          {urgent && (
            <Badge tone="danger" icon="clock">
              Due in {days}d
            </Badge>
          )}
        </div>
        <p className="text-2xs text-ink-500 mt-1">
          {q.subject} · {q.questions} questions ·{" "}
          {q.status === "open" ? `closes ${formatDate(q.dueAt)}` : `closed ${formatDate(q.dueAt)}`}
        </p>
      </div>

      {q.status === "graded" ? (
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="eyebrow">Score</div>
            <div
              className="text-xl font-bold font-display tnum leading-none mt-0.5"
              style={{ color: scoreTone(q.score) }}
            >
              {q.score}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => onOpen(q)}>
            Review
          </Button>
        </div>
      ) : q.status === "open" ? (
        <Button
          size="sm"
          variant="primary"
          iconRight="arrowRight"
          className="shrink-0"
          onClick={() => onOpen(q)}
        >
          Start
        </Button>
      ) : (
        <span className="text-2xs text-ink-500 shrink-0">Closed without an attempt</span>
      )}
    </li>
  );
}

export default function Quizzes() {
  const [tab, setTab] = useState("open");
  /* The quiz being taken, if any. An overlay rather than a route: a
     quiz is a modal activity, and the surrounding navigation is a way
     to lose your answers. */
  const [open, setOpen] = useState(null);

  const { data, loading, error, reload } = useApi(() => studentApi.quizzes(), []);
  const all = data ?? [];

  const rows = all.filter((q) => (tab === "all" ? true : q.status === tab));
  const graded = all.filter((q) => q.status === "graded");
  const avg = graded.length
    ? Math.round(graded.reduce((s, q) => s + q.score, 0) / graded.length)
    : 0;
  const counts = {
    all: all.length,
    open: all.filter((q) => q.status === "open").length,
    graded: graded.length,
    missed: all.filter((q) => q.status === "missed").length,
  };

  return (
    <div>
      {open && (
        <QuizRunner
          quizId={open.quizId}
          onClose={() => {
            setOpen(null);
            /* The list carries the score and status, both of which the
               attempt just changed. */
            reload();
          }}
        />
      )}
      <PageHeader
        eyebrow="Assessment"
        title="Quizzes"
        sub="Everything set for your batch, open first."
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Card className="overflow-hidden">
            <Tabs
              value={tab}
              onChange={setTab}
              className="px-3 pt-2"
              items={[
                { value: "open", label: "Open", count: counts.open },
                { value: "graded", label: "Graded", count: counts.graded },
                { value: "missed", label: "Missed", count: counts.missed },
                { value: "all", label: "All", count: counts.all },
              ]}
            />
            {error ? (
              <ErrorState body={error.message} onRetry={reload} />
            ) : loading ? (
              <SkeletonRows rows={5} />
            ) : rows.length === 0 ? (
              <EmptyState
                art="inbox"
                title={tab === "open" ? "Nothing open right now" : "Nothing here"}
                body={
                  tab === "open"
                    ? "You are up to date. New quizzes appear here as your teacher sets them."
                    : "No quizzes in this state yet."
                }
                className="py-12"
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {rows.map((q) => (
                  <QuizRow key={q.quizId} q={q} onOpen={setOpen} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader eyebrow="Results" title="How you are doing" />
            <div className="px-5 pb-5 flex items-center gap-5">
              <Ring value={avg} size={88} label={String(avg)} sub="average" tone={scoreTone(avg)} />
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <div className="eyebrow mb-1">Trend</div>
                  <Sparkline values={[58, 62, 66, 61, 70, 74, avg]} width={110} height={30} />
                </div>
                <p className="text-2xs text-ink-500 leading-relaxed">
                  Up 12 points across your last six graded quizzes.
                </p>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 rule-grid">
              <Metric icon="check" tone="success" label="Completed" value={counts.graded} />
              <Metric icon="close" tone="danger" label="Missed" value={counts.missed} />
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Tip" title="Before you start" />
            <ul className="px-5 pb-5 space-y-2.5">
              {[
                "Each quiz is one attempt, so finish it in one sitting.",
                "Auto graded results appear the moment you submit.",
                "A missed quiz still counts as zero toward your average.",
              ].map((t) => (
                <li key={t} className="flex gap-2.5 text-xs text-ink-600 leading-relaxed">
                  <Icon
                    name="check"
                    size={13}
                    className="text-[var(--portal-accent)] shrink-0 mt-0.5"
                    strokeWidth={2.4}
                  />
                  {t}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
