import { useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Select,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, formatDate, relativeTime } from "@/lib/cx";
import { teacherApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Taking a register.

  The attendance table and its endpoints existed but there was no way to
  reach them, so attendance was something the product recorded and never
  asked anybody for. This is the missing half.

  The design is built around one fact: a teacher marks a register while
  standing in front of a class, often on a phone, and wants it done in
  under a minute. So the whole class is listed at once with everyone
  defaulted to present, and the work is tapping the exceptions. A form
  that made you set each student individually would be correct and
  unused.

  Nothing is saved until Save, and re-marking corrects rather than
  duplicates, so scrolling back to change your mind is safe.
*/

const MARKS = [
  { value: "present", label: "Present", tone: "success", icon: "check" },
  { value: "late", label: "Late", tone: "warning", icon: "clock" },
  { value: "absent", label: "Absent", tone: "danger", icon: "close" },
  { value: "excused", label: "Excused", tone: "neutral", icon: "shield" },
];

const TONE = {
  success: "bg-success-bg text-success-fg border-[var(--success-mid)]",
  warning: "bg-warning-bg text-warning-fg border-[var(--warning-mid)]",
  danger: "bg-danger-bg text-danger-fg border-[var(--danger-mid)]",
  neutral: "bg-ink-100 text-ink-700 border-ink-300",
};

function MarkPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {MARKS.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          title={m.label}
          aria-label={m.label}
          aria-pressed={value === m.value}
          className={cx(
            "size-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] border",
            "transition-colors duration-[var(--dur-fast)]",
            value === m.value
              ? TONE[m.tone]
              : "border-transparent text-ink-400 hover:bg-ink-100 hover:text-ink-700",
          )}
        >
          <Icon name={m.icon} size={14} strokeWidth={value === m.value ? 3 : 2} />
        </button>
      ))}
    </div>
  );
}

function Register({ eventId, onClose, onSaved }) {
  const register = useApi(() => teacherApi.register(eventId), [eventId]);
  const [marks, setMarks] = useState(null);

  /* Seed from whatever is already recorded, defaulting the rest to
     present. Marking the exceptions is the job; marking thirty
     present one at a time is not. */
  const d = register.data;
  if (d && marks === null) {
    setMarks(
      Object.fromEntries(d.students.map((s) => [s.studentId, s.status ?? "present"])),
    );
  }

  const save = useMutation(async () => {
    await teacherApi.markRegister(eventId, marks);
    onSaved?.();
    onClose();
  });

  const counts = MARKS.map((m) => ({
    ...m,
    n: Object.values(marks ?? {}).filter((v) => v === m.value).length,
  }));

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto animate-fade">
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-hairline">
        <div className="max-w-2xl mx-auto flex items-center gap-3 h-16 px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">{d?.title ?? "Register"}</p>
            <p className="text-2xs text-ink-500">
              {d ? `${d.batch ?? "All batches"} · ${formatDate(d.scheduledAt)}` : "Loading"}
            </p>
          </div>
          <Button
            variant="primary"
            loading={save.pending}
            disabled={!marks || Object.keys(marks).length === 0}
            onClick={() => save.mutate().catch(() => {})}
          >
            Save register
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

      <div className="max-w-2xl mx-auto px-5 py-6 space-y-4">
        {register.loading ? (
          <div className="h-64 rounded-[var(--radius-md)] skeleton" />
        ) : register.error ? (
          <ErrorState body={register.error.message} onRetry={register.reload} />
        ) : d.students.length === 0 ? (
          <EmptyState
            art="list"
            title="Nobody in this batch"
            body="Add students to this batch before taking a register."
          />
        ) : (
          <>
            <Card className="p-4 flex flex-wrap items-center gap-4">
              {counts.map((c) => (
                <div key={c.value} className="flex items-center gap-2">
                  <span className={cx("size-2.5 rounded-full", TONE[c.tone].split(" ")[0])} />
                  <span className="text-xs text-ink-600">{c.label}</span>
                  <span className="text-sm font-bold tnum">{c.n}</span>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  setMarks(
                    Object.fromEntries(d.students.map((s) => [s.studentId, "present"])),
                  )
                }
              >
                All present
              </Button>
            </Card>

            <Card className="overflow-hidden">
              <ul className="divide-y divide-[var(--hairline)]">
                {d.students.map((s) => (
                  <li key={s.studentId} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={s.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{s.name}</p>
                      {s.group && <p className="text-2xs text-ink-500">{s.group}</p>}
                    </div>
                    <MarkPicker
                      value={marks?.[s.studentId]}
                      onChange={(v) => setMarks((m) => ({ ...m, [s.studentId]: v }))}
                    />
                  </li>
                ))}
              </ul>
            </Card>

            {save.error && (
              <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
                <Icon name="alert" size={14} className="shrink-0 mt-px" />
                {save.error.message}
              </p>
            )}
            <p className="text-2xs text-ink-500 text-center">
              Nothing is saved until you press Save. Marking again corrects the record
              rather than adding a second one.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Attendance() {
  const { data, loading, error, reload } = useApi(() => teacherApi.events(), []);
  const [open, setOpen] = useState(null);
  const [scope, setScope] = useState("past");

  const events = (data ?? []).filter((e) => e.type === "class" || e.type === "exam");
  const now = Date.now();
  const rows = events
    .filter((e) =>
      scope === "past"
        ? new Date(e.scheduledAt).getTime() <= now
        : new Date(e.scheduledAt).getTime() > now,
    )
    .sort((a, b) =>
      scope === "past"
        ? new Date(b.scheduledAt) - new Date(a.scheduledAt)
        : new Date(a.scheduledAt) - new Date(b.scheduledAt),
    );

  return (
    <div>
      {open && (
        <Register
          eventId={open}
          onClose={() => setOpen(null)}
          onSaved={reload}
        />
      )}

      <PageHeader
        eyebrow="Insight"
        title="Attendance"
        sub="Take a register for a class. Parents see it on their child's page."
        actions={
          <Select value={scope} onChange={(e) => setScope(e.target.value)} className="w-40">
            <option value="past">Past sessions</option>
            <option value="upcoming">Upcoming</option>
          </Select>
        }
      />

      <Card className="overflow-hidden">
        <CardHeader
          eyebrow="Sessions"
          title={`${rows.length} ${scope === "past" ? "held" : "scheduled"}`}
          sub={
            scope === "past"
              ? "Most recent first. A session with no register has not been marked."
              : "A register can be taken once the class has started."
          }
        />
        {error ? (
          <ErrorState body={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            art="list"
            title={scope === "past" ? "No sessions yet" : "Nothing scheduled"}
            body="Classes you add to the schedule appear here to be marked."
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {rows.slice(0, 40).map((e) => (
              <li
                key={e.eventId}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-50/60 transition-colors"
              >
                <span className="inline-flex items-center justify-center size-9 rounded-[var(--radius-sm)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] shrink-0">
                  <Icon name={e.type === "exam" ? "quiz" : "calendar"} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{e.title}</p>
                  <p className="text-2xs text-ink-500 truncate">
                    {e.batch ?? "All batches"} · {relativeTime(e.scheduledAt)}
                  </p>
                </div>
                {e.type === "exam" && <Badge tone="warning">Exam</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setOpen(e.eventId)}>
                  Register
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
