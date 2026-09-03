import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Toggle,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, formatTime } from "@/lib/cx";
import { teacherApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Event scheduler.

  Month grid plus an agenda list rather than a full week calendar. A
  tutoring centre schedules a handful of events a month, so a
  heavyweight week view would be mostly empty space, and the agenda is
  what a teacher actually reads.
*/

const EVENT_STYLE = {
  exam: { tone: "danger", icon: "quiz", bar: "var(--danger-mid)" },
  meeting: { tone: "info", icon: "students", bar: "var(--info-mid)" },
  class: { tone: "brand", icon: "video", bar: "var(--portal-accent)" },
};

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  /* Monday first. */
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function MonthGrid({ cursor, setCursor, events, selected, onSelect }) {
  const cells = monthMatrix(cursor.getFullYear(), cursor.getMonth());
  const today = new Date().toDateString();

  const byDay = useMemo(() => {
    const map = {};
    for (const e of events) {
      const key = new Date(e.scheduledAt).toDateString();
      (map[key] ??= []).push(e);
    }
    return map;
  }, [events]);

  const shift = (delta) =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));

  return (
    <Card>
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h3 className="text-md font-semibold">
          {cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-1)}
            className="size-8 rounded-[var(--radius-sm)] flex items-center justify-center text-ink-500 hover:bg-ink-100 transition-colors"
            aria-label="Previous month"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="h-8 px-2.5 rounded-[var(--radius-sm)] text-xs font-semibold text-ink-600 hover:bg-ink-100 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => shift(1)}
            className="size-8 rounded-[var(--radius-sm)] flex items-center justify-center text-ink-500 hover:bg-ink-100 transition-colors"
            aria-label="Next month"
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="grid grid-cols-7 mb-1.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="eyebrow text-center py-1">
              {d.slice(0, 1)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={i} />;
            const key = date.toDateString();
            const dayEvents = byDay[key] ?? [];
            const isToday = key === today;
            const isSelected = selected && key === selected.toDateString();
            return (
              <button
                key={i}
                onClick={() => onSelect(date)}
                className={cx(
                  "relative aspect-square rounded-[var(--radius-sm)] flex flex-col items-center justify-center",
                  "text-xs font-semibold transition-all duration-[var(--dur-fast)]",
                  isSelected
                    ? "bg-[var(--portal-accent)] text-[var(--portal-contrast)]"
                    : isToday
                      ? "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                      : "text-ink-700 hover:bg-ink-100",
                )}
              >
                <span className="tnum">{date.getDate()}</span>
                {dayEvents.length > 0 && (
                  <span className="absolute bottom-1.5 flex gap-0.5">
                    {dayEvents.slice(0, 3).map((e, j) => (
                      <span
                        key={j}
                        className="size-1 rounded-full"
                        style={{
                          background: isSelected ? "currentColor" : EVENT_STYLE[e.type].bar,
                        }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ComposeEvent({ onCreated }) {
  const [notify, setNotify] = useState(true);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("exam");
  const [batch, setBatch] = useState("2026 A/L");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");

  const create = useMutation(async () => {
    await teacherApi.createEvent({
      title,
      type,
      batch,
      scheduledAt: new Date(`${date}T${time}`).toISOString(),
      durationMins: 60,
    });
    setTitle("");
    setDate("");
    onCreated();
  });
  return (
    <Card>
      <CardHeader eyebrow="New" title="Schedule an event" />
      <div className="px-5 pb-5 space-y-3.5">
        <Field label="Title" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Combined Maths, term test III"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="exam">Exam</option>
              <option value="class">Class</option>
              <option value="meeting">Meeting</option>
            </Select>
          </Field>
          <Field label="Batch">
            <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option>2026 A/L</option>
              <option>2027 A/L</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Toggle
          checked={notify}
          onChange={setNotify}
          label="Notify students and parents"
          hint="Sends an email now and a reminder the evening before."
        />
        {create.error && (
          <p className="text-xs text-danger-fg">{create.error.message}</p>
        )}
        <Button
          variant="primary"
          block
          icon="calendar"
          disabled={!title.trim() || !date}
          loading={create.pending}
          onClick={create.mutate}
        >
          Create event
        </Button>
      </div>
    </Card>
  );
}

export default function Schedule() {
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("upcoming");

  const { data, loading, error, reload } = useApi(() => teacherApi.events(), []);
  const events = data ?? [];

  const list = useMemo(() => {
    const now = new Date();
    let out = [...events].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    if (selected) {
      out = out.filter(
        (e) => new Date(e.scheduledAt).toDateString() === selected.toDateString(),
      );
    } else if (view === "upcoming") {
      out = out.filter((e) => new Date(e.scheduledAt) >= now);
    } else {
      out = out.filter((e) => new Date(e.scheduledAt) < now).reverse();
    }
    return out;
  }, [events, view, selected]);

  return (
    <div>
      <PageHeader
        eyebrow="Planning"
        title="Schedule"
        sub="Exams, classes and parent meetings, with notifications handled for you."
        actions={
          <Button variant="primary" icon="plus">
            New event
          </Button>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
              <div>
                <div className="eyebrow mb-1">Agenda</div>
                <h3 className="text-md font-semibold">
                  {selected
                    ? selected.toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })
                    : view === "upcoming"
                      ? "Coming up"
                      : "Already happened"}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {selected && (
                  <Button size="sm" variant="ghost" icon="close" onClick={() => setSelected(null)}>
                    Clear day
                  </Button>
                )}
                <Segmented
                  size="sm"
                  value={view}
                  onChange={(v) => {
                    setView(v);
                    setSelected(null);
                  }}
                  items={[
                    { value: "upcoming", label: "Upcoming" },
                    { value: "past", label: "Past" },
                  ]}
                />
              </div>
            </div>

            {error ? (
              <ErrorState body={error.message} onRetry={reload} />
            ) : loading ? (
              <SkeletonRows rows={4} />
            ) : list.length === 0 ? (
              <EmptyState
                art="chart"
                title={selected ? "Nothing on this day" : "No events yet"}
                body={
                  selected
                    ? "Pick another day, or schedule something for this one."
                    : "Create an exam, a class or a parent meeting and everyone gets notified."
                }
                action={
                  <Button variant="primary" icon="plus">
                    New event
                  </Button>
                }
              />
            ) : (
              <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
                {list.map((e) => {
                  const style = EVENT_STYLE[e.type];
                  const when = new Date(e.scheduledAt);
                  return (
                    <li
                      key={e.eventId}
                      className="relative flex gap-4 px-5 py-4 hover:bg-ink-50/60 transition-colors"
                    >
                      {/* Type bar, so the agenda is readable without badges. */}
                      <span
                        className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full"
                        style={{ background: style.bar }}
                      />
                      <div className="w-14 shrink-0 text-center">
                        <div className="text-[10px] font-bold text-ink-500 uppercase">
                          {when.toLocaleDateString("en-GB", { weekday: "short" })}
                        </div>
                        <div className="text-xl font-bold font-display tnum leading-tight">
                          {when.getDate()}
                        </div>
                        <div className="text-2xs text-ink-500 tnum">{formatTime(e.scheduledAt)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold">{e.title}</h4>
                          <Badge tone={style.tone} icon={style.icon}>
                            {e.type}
                          </Badge>
                        </div>
                        <p className="text-2xs text-ink-500 mt-1">
                          {e.batch} · {e.durationMins} min · created by {e.createdBy}
                        </p>
                        <div className="flex items-center gap-1.5 mt-2.5 text-2xs text-ink-500">
                          <Icon name="students" size={13} />
                          {e.attendees} expected
                        </div>
                      </div>
                      <div className="flex items-start gap-1 shrink-0">
                        <Button size="sm" variant="secondary">
                          Edit
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <MonthGrid
            cursor={cursor}
            setCursor={setCursor}
            events={events}
            selected={selected}
            onSelect={(d) =>
              setSelected(selected && d.toDateString() === selected.toDateString() ? null : d)
            }
          />
          <ComposeEvent onCreated={reload} />
        </div>
      </div>
    </div>
  );
}
