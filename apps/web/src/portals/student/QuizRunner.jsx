import { useEffect, useState } from "react";
import { Badge, Button, Card, Ring } from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";
import { studentApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Taking a quiz.

  A full screen overlay rather than a route, because a quiz is a modal
  activity: you are either in it or you are not, and the surrounding
  navigation is a distraction at best and a way to lose your answers at
  worst.

  Three things this deliberately does not do:

    It does not mark anything. The correct answers never leave the
    server, so the score cannot be computed here and cannot be tampered
    with there.

    It does not impose a timer. The BRD does not ask for one, and a
    countdown on a revision quiz measures typing speed as much as
    understanding.

    It does not lock a question once answered. Changing your mind before
    submitting is normal, and preventing it only produces worse data.
*/

function Option({ label, index, selected, onSelect, review, multi }) {
  /*
    After submission the same control shows the answer key. Both sides
    are read as sets, so a multi answer question marks every correct
    option and any wrong one the student picked, and a single answer
    question is just the one element case.
  */
  const correctSet = review
    ? new Set(
        review.correctIndexes?.length
          ? review.correctIndexes
          : review.correctIndex === null || review.correctIndex === undefined
            ? []
            : [review.correctIndex],
      )
    : null;
  const chosenSet = review
    ? new Set(
        Array.isArray(review.chosenIndex)
          ? review.chosenIndex
          : review.chosenIndex === null || review.chosenIndex === undefined
            ? []
            : [review.chosenIndex],
      )
    : null;
  const state = review
    ? correctSet.has(index)
      ? "correct"
      : chosenSet.has(index)
        ? "wrong"
        : "idle"
    : selected
      ? "chosen"
      : "idle";

  return (
    <button
      type="button"
      disabled={!!review}
      onClick={() => onSelect(index)}
      className={cx(
        "w-full flex items-start gap-3 rounded-[var(--radius-md)] border px-3.5 py-3 text-left",
        "transition-[border-color,background-color] duration-[var(--dur-fast)]",
        state === "idle" && "border-hairline hover:border-ink-300 hover:bg-ink-50",
        state === "chosen" &&
          "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)]",
        state === "correct" && "border-[var(--success-mid)] bg-success-bg",
        state === "wrong" && "border-[var(--danger-mid)] bg-danger-bg",
        review && "cursor-default",
      )}
    >
      <span
        className={cx(
          "inline-flex items-center justify-center size-5 shrink-0 mt-px text-2xs font-bold",
          multi ? "rounded-[6px]" : "rounded-full",
          state === "idle" && "border border-ink-300 text-ink-500",
          state === "chosen" && "bg-[var(--portal-accent)] text-[var(--portal-contrast)]",
          state === "correct" && "bg-[var(--success-mid)] text-white",
          state === "wrong" && "bg-[var(--danger-mid)] text-white",
        )}
      >
        {state === "correct" ? (
          <Icon name="check" size={12} strokeWidth={3} />
        ) : state === "wrong" ? (
          <Icon name="close" size={11} strokeWidth={3} />
        ) : (
          String.fromCharCode(65 + index)
        )}
      </span>
      <span className="text-sm leading-relaxed">{label}</span>
    </button>
  );
}

function Result({ result, onClose }) {
  const tone =
    result.band === "passed" ? "success" : result.band === "borderline" ? "warning" : "danger";
  return (
    <div className="max-w-2xl mx-auto">
      <Card className="overflow-hidden">
        <div className="p-6 flex items-center gap-6">
          <Ring
            value={result.percent}
            size={92}
            stroke={9}
            label={`${result.percent}%`}
            tone={tone}
          />
          <div className="min-w-0">
            <Badge tone={tone}>
              {result.band === "passed"
                ? "Passed"
                : result.band === "borderline"
                  ? "Borderline"
                  : "Not passed"}
            </Badge>
            <p className="text-2xl font-bold font-display mt-2 tnum">
              {result.score} of {result.maxScore}
            </p>
            <p className="text-xs text-ink-500 mt-1">
              {result.correct} right, {result.wrong} wrong
              {result.unanswered > 0 && `, ${result.unanswered} left blank`}
            </p>
            {result.awaitingMarking && (
              <p className="flex items-center gap-1.5 text-xs text-warning-fg mt-2">
                <Icon name="clock" size={13} />
                {result.pending} written answer{result.pending === 1 ? "" : "s"} still to
                mark. This score will go up.
              </p>
            )}
          </div>
        </div>
      </Card>

      <p className="eyebrow mt-6 mb-2">Where you went wrong</p>
      <div className="space-y-3">
        {result.review.map((q, i) => {
          /* Right when the student earned the full marks, which is
             the only definition that works for a multi answer question
             and for a written one a teacher has marked. */
          const right = q.awarded !== null && q.awarded === q.points;
          return (
            <Card key={q.questionId} className={cx("p-4", right && "opacity-70")}>
              <div className="flex items-start gap-2.5 mb-3">
                <span className="text-2xs font-bold text-ink-400 tnum mt-0.5">{i + 1}</span>
                <p className="text-sm font-semibold leading-relaxed">{q.prompt}</p>
              </div>
              {q.kind === "written" ? (
                <div className="pl-6 space-y-2">
                  <div className="rounded-[var(--radius-md)] border border-hairline p-3">
                    <p className="eyebrow mb-1.5">What you wrote</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {q.writtenAnswer?.trim() || (
                        <span className="text-ink-400 italic">Left blank</span>
                      )}
                    </p>
                  </div>
                  <p className="text-2xs text-ink-500">
                    {q.awarded === null
                      ? "Your teacher still has to mark this one."
                      : `${q.awarded} of ${q.points} marks`}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 pl-6">
                  {q.options.map((opt, idx) => (
                    <Option
                      key={idx}
                      label={opt}
                      index={idx}
                      multi={q.kind === "multi"}
                      review={q}
                      onSelect={() => {}}
                    />
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Button variant="primary" block className="mt-6" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

export function QuizRunner({ quizId, onClose }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);

  const attempt = useApi(() => studentApi.startQuiz(quizId), [quizId]);

  /* Resume whatever was saved on a previous, unfinished attempt. */
  useEffect(() => {
    if (attempt.data?.savedAnswers) setAnswers(attempt.data.savedAnswers);
  }, [attempt.data]);

  const submit = useMutation(async () => {
    setResult(await studentApi.submitQuiz(quizId, answers));
  });

  const questions = attempt.data?.questions ?? [];
  const isAnswered = (q) => {
    const v = answers[q.questionId];
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  };
  const answered = questions.filter(isAnswered).length;
  const allDone = questions.length > 0 && answered === questions.length;

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto animate-fade">
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-hairline">
        <div className="max-w-2xl mx-auto flex items-center gap-3 h-16 px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">
              {attempt.data?.title ?? "Quiz"}
            </p>
            <p className="text-2xs text-ink-500">
              {result
                ? "Your result"
                : `${answered} of ${questions.length} answered`}
            </p>
          </div>
          {!result && questions.length > 0 && (
            <div className="hidden sm:block w-32 h-1.5 rounded-full bg-ink-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--portal-accent)] transition-[width] duration-[var(--dur-med)]"
                style={{ width: `${(answered / questions.length) * 100}%` }}
              />
            </div>
          )}
          <button
            onClick={onClose}
            aria-label="Close quiz"
            className="size-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      <div className="px-5 py-7">
        {attempt.loading ? (
          <div className="max-w-2xl mx-auto space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 rounded-[var(--radius-md)] skeleton" />
            ))}
          </div>
        ) : attempt.error ? (
          <div className="max-w-2xl mx-auto">
            <Card className="p-6 text-center">
              <Icon name="alert" size={24} className="text-danger-fg mx-auto" />
              <p className="text-sm font-semibold mt-3">{attempt.error.message}</p>
              <Button variant="secondary" className="mt-4" onClick={onClose}>
                Back to quizzes
              </Button>
            </Card>
          </div>
        ) : result ? (
          <Result result={result} onClose={onClose} />
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {questions.map((q, i) => (
              <Card key={q.questionId} className="p-5">
                <div className="flex items-start gap-2.5 mb-4">
                  <span className="text-2xs font-bold text-ink-400 tnum mt-1">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-relaxed">{q.prompt}</p>
                    <p className="text-2xs text-ink-500 mt-1">
                      {q.kind === "multi" &&
                        `Pick ${q.correctCount ?? "all that apply"}${
                          q.correctCount ? "" : ""
                        }. `}
                      {q.points > 1 ? `${q.points} marks` : ""}
                    </p>
                  </div>
                </div>
                {q.kind === "written" ? (
                  <textarea
                    value={answers[q.questionId] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))
                    }
                    rows={5}
                    placeholder="Write your answer"
                    className="w-full rounded-[var(--radius-sm)] border border-hairline bg-surface p-3 text-sm leading-relaxed focus:border-[var(--portal-accent)] focus:shadow-[0_0_0_3px_var(--portal-halo)] focus:outline-none"
                  />
                ) : (
                <div className="space-y-2">
                  {q.options.map((opt, idx) => {
                    const current = answers[q.questionId];
                    const picked =
                      q.kind === "multi"
                        ? Array.isArray(current) && current.includes(idx)
                        : current === idx;
                    return (
                      <Option
                        key={idx}
                        label={opt}
                        index={idx}
                        multi={q.kind === "multi"}
                        selected={picked}
                        onSelect={() =>
                          setAnswers((a) => {
                            if (q.kind !== "multi") return { ...a, [q.questionId]: idx };
                            const held = Array.isArray(a[q.questionId])
                              ? a[q.questionId]
                              : [];
                            return {
                              ...a,
                              [q.questionId]: held.includes(idx)
                                ? held.filter((x) => x !== idx)
                                : [...held, idx].sort((x, y) => x - y),
                            };
                          })
                        }
                      />
                    );
                  })}
                </div>
                )}
              </Card>
            ))}

            {submit.error && (
              <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
                <Icon name="alert" size={14} className="shrink-0 mt-px" />
                {submit.error.message}
              </p>
            )}

            {/* Submitting with blanks is allowed, and warned about,
                because an unanswered question is marked wrong. Better to
                say so here than to have it discovered in the result. */}
            {!allDone && questions.length > 0 && (
              <p className="text-xs text-ink-500 text-center">
                {questions.length - answered} question
                {questions.length - answered === 1 ? "" : "s"} still blank. Anything left
                blank is marked wrong.
              </p>
            )}

            <Button
              variant="primary"
              size="lg"
              block
              loading={submit.pending}
              disabled={answered === 0}
              onClick={() => submit.mutate().catch(() => {})}
            >
              Submit {answered} of {questions.length}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
