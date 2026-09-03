import { useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  PageHeader,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, relativeTime } from "@/lib/cx";
import { teacherApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Marking.

  Written answers cannot be marked by the server, so they wait here. The
  same screen also lets a teacher change a mark the server did award: an
  accepted alternative answer, a question that turned out to be
  ambiguous, or a plain mistake all need a way out that is not telling a
  student the computer disagrees with their teacher.

  Two things the layout is built around.

  The model answer sits beside the student's answer, not above it. The
  marker is comparing two pieces of text and should not have to scroll
  between them.

  The queue is oldest first. A student waiting three days for a mark
  should not be behind one who submitted this morning.
*/

function MarkInput({ q, onSet }) {
  const [value, setValue] = useState(q.awarded ?? "");
  const auto = q.kind !== "written" && !q.overridden;

  const commit = (raw) => {
    const next = raw === "" ? null : Math.max(0, Math.min(q.points, Number(raw)));
    onSet(next);
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => commit(value)}
        inputMode="numeric"
        placeholder="0"
        className="w-16 text-center tnum font-bold"
        aria-label={`Marks out of ${q.points}`}
      />
      <span className="text-xs text-ink-500 whitespace-nowrap">of {q.points}</span>
      {q.overridden && (
        <button
          type="button"
          title="Undo this change and let the server mark it again"
          onClick={() => {
            setValue("");
            onSet(null);
          }}
          className="text-2xs font-semibold text-ink-500 hover:text-ink-900 underline"
        >
          undo
        </button>
      )}
      {auto && q.awarded !== null && (
        <Badge tone="neutral">auto</Badge>
      )}
    </div>
  );
}

function AttemptSheet({ attemptId, onClose, onMarked }) {
  const attempt = useApi(() => teacherApi.readAttempt(attemptId), [attemptId]);
  const [dirty, setDirty] = useState(0);

  const setMark = useMutation(async (questionId, marks) => {
    await teacherApi.setMarks(attemptId, { [questionId]: marks });
    setDirty((n) => n + 1);
    attempt.reload();
    onMarked?.();
  });

  const d = attempt.data;

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto animate-fade">
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-hairline">
        <div className="max-w-3xl mx-auto flex items-center gap-3 h-16 px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">
              {d ? `${d.studentName}, ${d.quizTitle}` : "Marking"}
            </p>
            <p className="text-2xs text-ink-500">
              {d
                ? `${d.score} of ${d.maxScore}, ${d.percent}%${
                    d.awaitingMarking ? ", still to mark" : ""
                  }`
                : "Loading"}
            </p>
          </div>
          {d && !d.awaitingMarking && (
            <Badge tone="success" icon="checkCircle">
              Marked
            </Badge>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-7 space-y-4">
        {attempt.loading ? (
          <div className="h-56 rounded-[var(--radius-md)] skeleton" />
        ) : attempt.error ? (
          <ErrorState body={attempt.error.message} onRetry={attempt.reload} />
        ) : (
          d.questions.map((q, i) => (
            <Card key={q.questionId} className="p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xs font-bold text-ink-400 tnum mt-1">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-sm font-semibold leading-relaxed">{q.prompt}</p>
                    <MarkInput
                      key={`${q.questionId}-${dirty}`}
                      q={q}
                      onSet={(marks) =>
                        setMark.mutate(q.questionId, marks).catch(() => {})
                      }
                    />
                  </div>

                  {q.kind === "written" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      <div className="rounded-[var(--radius-md)] border border-hairline bg-surface p-3">
                        <p className="eyebrow mb-1.5">What they wrote</p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {q.answer?.trim() ? (
                            q.answer
                          ) : (
                            <span className="text-ink-400 italic">Left blank</span>
                          )}
                        </p>
                      </div>
                      <div className="rounded-[var(--radius-md)] bg-sunken p-3">
                        <p className="eyebrow mb-1.5">Model answer</p>
                        <p className="text-sm leading-relaxed text-ink-600">
                          {q.modelAnswer || (
                            <span className="text-ink-400 italic">None was written</span>
                          )}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <ul className="space-y-1.5 mt-3">
                      {q.options.map((opt, idx) => {
                        const chosen = idx === q.answer;
                        const right = idx === q.correctIndex;
                        return (
                          <li
                            key={idx}
                            className={cx(
                              "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                              right && "bg-success-bg text-success-fg font-semibold",
                              chosen && !right && "bg-danger-bg text-danger-fg",
                              !right && !chosen && "text-ink-600",
                            )}
                          >
                            <span className="text-2xs font-bold w-4">
                              {String.fromCharCode(65 + idx)}
                            </span>
                            {opt}
                            {chosen && (
                              <span className="ml-auto text-2xs font-semibold">
                                their answer
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}

        {setMark.error && (
          <p className="text-xs text-danger-fg">{setMark.error.message}</p>
        )}

        <p className="text-2xs text-ink-500 text-center">
          Marks save as you leave each box. Changing one you already set is fine, marking
          is a judgement and judgements get revised.
        </p>

        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export default function Marking() {
  const { data, loading, error, reload } = useApi(() => teacherApi.markingQueue(), []);
  const [open, setOpen] = useState(null);
  const queue = data ?? [];

  return (
    <div>
      {open && (
        <AttemptSheet
          attemptId={open}
          onClose={() => {
            setOpen(null);
            reload();
          }}
          onMarked={reload}
        />
      )}

      <PageHeader
        eyebrow="Assessment"
        title="Marking"
        sub="Written answers waiting on you, oldest first."
      />

      <Card className="overflow-hidden">
        <CardHeader
          eyebrow="Queue"
          title={
            queue.length === 0
              ? "Nothing waiting"
              : `${queue.length} attempt${queue.length === 1 ? "" : "s"} to mark`
          }
          sub="A quiz with only multiple choice is marked the moment it is submitted."
        />
        {error ? (
          <ErrorState body={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={4} />
        ) : queue.length === 0 ? (
          <EmptyState
            art="check"
            title="All marked"
            body="Written answers appear here as students submit them."
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {queue.map((a) => (
              <li
                key={a.attemptId}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-50/60 transition-colors"
              >
                <Avatar name={a.studentName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{a.studentName}</p>
                  <p className="text-2xs text-ink-500 truncate">
                    {a.quizTitle} · submitted {relativeTime(a.submittedAt)}
                  </p>
                </div>
                <span className="text-2xs text-ink-500 tnum hidden sm:block">
                  {a.provisionalScore} of {a.maxScore} so far
                </span>
                <Button size="sm" variant="primary" onClick={() => setOpen(a.attemptId)}>
                  Mark
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
