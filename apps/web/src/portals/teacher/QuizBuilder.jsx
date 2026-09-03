import { useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";
import { teacherApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Writing a quiz.

  The library's Add button could already pick "Quiz" as a type, which
  created a Content row and nothing else. A quiz with no questions is
  refused by the student endpoint, so that path produced an item that
  looked fine on the shelf and could never be opened. This is what that
  option should have led to.

  One decision drives the layout: the correct answer is chosen by
  clicking the option itself, not from a separate dropdown. A dropdown
  saying "Answer: 3" forces the author to count their own options and is
  exactly how a quiz ends up with the wrong answer marked right.

  Editing is refused once anybody has sat the quiz, and the server is
  what refuses it. Their stored answers are option indexes, so moving an
  option would silently change what a marked student appears to have
  said. The screen explains that rather than hiding the button.
*/

const BLANK = (kind = "choice") => ({
  key: Math.random().toString(36).slice(2),
  kind,
  prompt: "",
  options: kind === "written" ? [] : ["", "", "", ""],
  correctIndex: 0,
  correctIndexes: kind === "multi" ? [0] : [],
  modelAnswer: "",
  points: kind === "written" ? 4 : kind === "multi" ? 2 : 1,
});

function QuestionCard({ q, index, onChange, onRemove, canRemove, locked }) {
  const set = (patch) => onChange({ ...q, ...patch });

  const setOption = (i, value) => {
    const options = [...q.options];
    options[i] = value;
    set({ options });
  };

  const removeOption = (i) => {
    const options = q.options.filter((_, x) => x !== i);
    /* Keep the marked answers pointing at the same options they did
       before the list shifted, or the author silently loses them. */
    let correctIndex = q.correctIndex;
    if (i === q.correctIndex) correctIndex = 0;
    else if (i < q.correctIndex) correctIndex -= 1;
    const correctIndexes = (q.correctIndexes ?? [])
      .filter((x) => x !== i)
      .map((x) => (x > i ? x - 1 : x));
    set({ options, correctIndex, correctIndexes });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center size-6 rounded-full bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] text-2xs font-bold shrink-0 mt-1">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1 space-y-3">
          <Input
            value={q.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder="What do you want to ask?"
            disabled={locked}
          />

          {q.kind === "written" ? (
            <>
              {/*
                No options and no answer key. A written answer is marked
                by a person, so what this needs is guidance for whoever
                marks it, not something to compare against. Matching free
                text by string would fail a correct answer worded
                differently, which is worse than not marking it at all.
              */}
              <Field
                label="Model answer, for whoever marks this"
                hint="Never shown to students. It appears beside their answer in the marking queue."
              >
                <Input
                  value={q.modelAnswer ?? ""}
                  onChange={(e) => set({ modelAnswer: e.target.value })}
                  placeholder="What a full mark answer should cover"
                  disabled={locked}
                />
              </Field>
              <p className="flex items-center gap-2 text-2xs text-ink-500">
                <Icon name="user" size={12} />
                This one waits for you. The student sees a provisional score until you mark it.
              </p>
            </>
          ) : (
          <div className="space-y-2">
            {q.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                {/*
                  The radio is the answer key. Clicking the option marks
                  it correct, so the author never has to work out which
                  number an option is.
                */}
{/*
                  One control for both kinds. On a single answer
                  question clicking an option moves the tick; on a
                  multi answer one it toggles that option in or out.
                  Square rather than round for multi, because that is
                  the convention people already read as "more than one".
                */}
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    q.kind === "multi"
                      ? set({
                          correctIndexes: q.correctIndexes.includes(i)
                            ? q.correctIndexes.filter((x) => x !== i)
                            : [...q.correctIndexes, i].sort((a, b) => a - b),
                        })
                      : set({ correctIndex: i })
                  }
                  title={
                    q.kind === "multi"
                      ? "Include this in the correct answers"
                      : "Mark this as the correct answer"
                  }
                  className={cx(
                    "inline-flex items-center justify-center size-6 shrink-0 text-2xs font-bold",
                    "transition-colors duration-[var(--dur-fast)]",
                    q.kind === "multi" ? "rounded-[7px]" : "rounded-full",
                    (q.kind === "multi" ? q.correctIndexes.includes(i) : i === q.correctIndex)
                      ? "bg-[var(--success-mid)] text-white"
                      : "border border-ink-300 text-ink-500 hover:border-ink-400",
                  )}
                >
                  {(q.kind === "multi" ? q.correctIndexes.includes(i) : i === q.correctIndex) ? (
                    <Icon name="check" size={12} strokeWidth={3} />
                  ) : (
                    String.fromCharCode(65 + i)
                  )}
                </button>
                <Input
                  value={opt}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  disabled={locked}
                  className="flex-1"
                />
                {q.options.length > 2 && !locked && (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    aria-label="Remove this option"
                    className="size-7 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-ink-400 hover:bg-danger-bg hover:text-danger-fg"
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {q.kind !== "written" && q.options.length < 6 && !locked && (
              <Button
                size="sm"
                variant="ghost"
                icon="plus"
                onClick={() => set({ options: [...q.options, ""] })}
              >
                Option
              </Button>
            )}
            <label className="flex items-center gap-2 text-xs text-ink-600">
              Marks
              <Select
                value={q.points}
                onChange={(e) => set({ points: Number(e.target.value) })}
                disabled={locked}
                className="w-20"
              >
                {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            {canRemove && !locked && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-danger-fg"
                onClick={onRemove}
              >
                Remove question
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function QuizBuilder({ quizId, draft, onClose, onSaved }) {
  const editing = Boolean(quizId);
  const existing = useApi(() => teacherApi.readQuiz(quizId), [quizId], { skip: !editing });

  /* Carried through from the Add panel, so the title typed there is
     not typed again here. */
  const [title, setTitle] = useState(draft?.title ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [questions, setQuestions] = useState([BLANK()]);
  const [loaded, setLoaded] = useState(false);

  /* Fill the form once, when the existing quiz arrives. */
  if (editing && existing.data && !loaded) {
    setTitle(existing.data.title);
    setSubject(existing.data.subject ?? "");
    setQuestions(
      existing.data.questions.map((q) => ({
        key: q.questionId,
        kind: q.kind ?? "choice",
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        correctIndexes: q.correctIndexes ?? [],
        modelAnswer: q.modelAnswer ?? "",
        points: q.points,
      })),
    );
    setLoaded(true);
  }

  const locked = editing && (existing.data?.attempts ?? 0) > 0;

  const save = useMutation(async () => {
    const payload = {
      title: title.trim(),
      subject: subject.trim() || null,
      questions: questions.map((q) => ({
        kind: q.kind ?? "choice",
        prompt: q.prompt.trim(),
        options: (q.options ?? []).map((o) => o.trim()).filter(Boolean),
        correctIndex: q.correctIndex,
        correctIndexes: q.correctIndexes ?? [],
        modelAnswer: q.modelAnswer?.trim() || null,
        points: q.points,
      })),
    };
    const res = editing
      ? await teacherApi.updateQuiz(quizId, payload)
      : await teacherApi.createQuiz(payload);
    onSaved?.(res);
    onClose();
  });

  const marks = questions.reduce((s, q) => s + q.points, 0);
  const written = questions.filter((q) => q.kind === "written").length;
  const ready =
    title.trim().length > 0 &&
    questions.length > 0 &&
    questions.every(
      (q) =>
        q.prompt.trim() &&
        (q.kind === "written" ||
          (q.options.filter((o) => o.trim()).length >= 2 &&
            (q.kind !== "multi" ||
              (q.correctIndexes.length > 0 &&
                q.correctIndexes.length < q.options.filter((o) => o.trim()).length)))),
    );

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto animate-fade">
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-hairline">
        <div className="max-w-3xl mx-auto flex items-center gap-3 h-16 px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">
              {editing ? "Edit quiz" : "New quiz"}
            </p>
            <p className="text-2xs text-ink-500">
              {questions.length} question{questions.length === 1 ? "" : "s"}, {marks} mark
              {marks === 1 ? "" : "s"}
              {written > 0 &&
                `, ${written} to mark by hand`}
            </p>
          </div>
          <Button
            variant="primary"
            loading={save.pending}
            disabled={!ready || locked}
            onClick={() => save.mutate().catch(() => {})}
          >
            {editing ? "Save changes" : "Create quiz"}
          </Button>
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
        {locked && (
          <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--warning-mid)] bg-warning-bg p-4">
            <Icon name="lock" size={16} className="text-warning-fg shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-warning-fg">
                {existing.data.attempts} student
                {existing.data.attempts === 1 ? " has" : "s have"} already sat this
              </p>
              <p className="text-xs text-warning-fg/90 leading-relaxed mt-1">
                The questions are locked. Their answers are stored as option positions, so
                moving one would change what a marked student appears to have said. Make a
                new quiz instead.
              </p>
            </div>
          </div>
        )}

        <Card className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Title" required className="sm:col-span-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Thermodynamics unit test"
                disabled={locked}
              />
            </Field>
            <Field label="Subject">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Physics"
                disabled={locked}
              />
            </Field>
          </div>
        </Card>

        {questions.map((q, i) => (
          <QuestionCard
            key={q.key}
            q={q}
            index={i}
            locked={locked}
            canRemove={questions.length > 1}
            onChange={(next) =>
              setQuestions((qs) => qs.map((x, xi) => (xi === i ? next : x)))
            }
            onRemove={() => setQuestions((qs) => qs.filter((_, xi) => xi !== i))}
          />
        ))}

        {save.error && (
          <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
            <Icon name="alert" size={14} className="shrink-0 mt-px" />
            {save.error.message}
          </p>
        )}

        {!locked && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              variant="secondary"
              icon="plus"
              onClick={() => setQuestions((qs) => [...qs, BLANK("choice")])}
            >
              Multiple choice
            </Button>
            <Button
              variant="secondary"
              icon="grid"
              onClick={() => setQuestions((qs) => [...qs, BLANK("multi")])}
            >
              Several answers
            </Button>
            <Button
              variant="secondary"
              icon="doc"
              onClick={() => setQuestions((qs) => [...qs, BLANK("written")])}
            >
              Written answer
            </Button>
          </div>
        )}

        <p className="text-2xs text-ink-500 text-center">
          The green tick marks the correct answer. Students never receive it, and it is
          only revealed once they submit.
        </p>
      </div>
    </div>
  );
}

/**
 * How a class did on one quiz. The per question breakdown is the part a
 * teacher can act on: a score list says who to worry about, a question
 * everybody missed says what to teach again.
 */
export function QuizResults({ quizId, onClose }) {
  const { data, loading, error } = useApi(() => teacherApi.quizResults(quizId), [quizId]);

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto animate-fade">
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-hairline">
        <div className="max-w-3xl mx-auto flex items-center gap-3 h-16 px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">Quiz results</p>
            <p className="text-2xs text-ink-500">
              {data ? `${data.sat} sat, ${data.passRate ?? 0}% passed` : "Loading"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-7 space-y-5">
        {loading ? (
          <div className="h-40 rounded-[var(--radius-md)] skeleton" />
        ) : error ? (
          <p className="text-sm text-danger-fg">{error.message}</p>
        ) : data.sat === 0 ? (
          <Card className="p-8 text-center">
            <Icon name="quiz" size={26} className="text-ink-300 mx-auto" />
            <p className="text-sm font-semibold mt-3">Nobody has sat this yet</p>
            <p className="text-xs text-ink-500 mt-1">
              Results appear here as students submit.
            </p>
          </Card>
        ) : (
          <>
            <Card className="p-5 grid grid-cols-3 gap-4 text-center">
              {[
                { label: "Sat", value: data.sat },
                { label: "Passed", value: `${data.passRate}%` },
                { label: "Average", value: `${data.averagePercent}%` },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-2xl font-bold font-display tnum">{m.value}</p>
                  <p className="eyebrow mt-1">{m.label}</p>
                </div>
              ))}
            </Card>

            <div>
              <p className="eyebrow mb-2">Question by question</p>
              <div className="space-y-2">
                {data.questions.map((q, i) => (
                  <Card key={q.questionId} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold leading-relaxed">
                        <span className="text-ink-400 tnum mr-2">{i + 1}</span>
                        {q.prompt}
                      </p>
                      <Badge
                        tone={
                          q.correctPct >= 70
                            ? "success"
                            : q.correctPct >= 40
                              ? "warning"
                              : "danger"
                        }
                      >
                        {q.correctPct}%
                      </Badge>
                    </div>
                    <p className="text-2xs text-ink-500 mt-2">
                      {q.right} right, {q.wrong} wrong, {q.blank} left blank. Answer:{" "}
                      <span className="font-semibold text-ink-700">
                        {q.options[q.correctIndex]}
                      </span>
                    </p>
                  </Card>
                ))}
              </div>
            </div>

            <div>
              <p className="eyebrow mb-2">Students</p>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-[var(--hairline)]">
                  {data.results.map((r) => (
                    <li key={r.studentId} className="flex items-center gap-3 px-5 py-3">
                      <span className="text-sm font-semibold flex-1 truncate">{r.name}</span>
                      <span className="text-xs text-ink-500 tnum">
                        {r.score}/{r.maxScore}
                      </span>
                      <Badge
                        tone={
                          r.band === "passed"
                            ? "success"
                            : r.band === "borderline"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {r.percent}%
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
