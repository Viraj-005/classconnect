import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Input,
  Metric,
  PAYMENT_LABEL,
  PAYMENT_TONE,
  PageHeader,
  Progress,
  SearchInput,
  Select,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SeatCapNotice, SkeletonRows } from "@/components/ui/states";
import { cx, daysUntil, relativeTime } from "@/lib/cx";
import { seatUsage } from "@/lib/tiers";
import { batchApi, teacherApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useDebounced } from "@/lib/useDebounced";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Student roster.

  The table carries five signals per row (payment, attendance, score,
  ticket, activity), which is a lot, so each gets a different visual
  encoding rather than five columns of text: a badge, a bar, a colour
  coded number, a countdown and relative time. That is what keeps a
  dense table scannable instead of exhausting.
*/

function scoreTone(score) {
  if (score >= 80) return "var(--success-mid)";
  if (score >= 65) return "var(--portal-accent)";
  if (score >= 55) return "var(--warning-mid)";
  return "var(--danger-mid)";
}

function TicketCell({ expiry }) {
  if (!expiry) return <span className="text-2xs text-ink-400">No ticket</span>;
  const days = daysUntil(expiry);
  if (days < 0) {
    return (
      <Badge tone="danger" icon="close">
        Expired
      </Badge>
    );
  }
  return (
    <Badge tone={days <= 5 ? "warning" : "success"} icon="qr">
      {days}d left
    </Badge>
  );
}

function AddStudentPanel({ onClose, onCreated, atCap }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [batch, setBatch] = useState("");
  /* Read only for a teacher: admins own the list, teachers assign into
     it. The server enforces that split, this just reads. */
  const batchList = useApi(() => batchApi.list(), []);
  const batches = batchList.data ?? [];
  const groupOptions = batches.find((b) => b.name === batch)?.groups ?? [];
  const [group, setGroup] = useState("");

  const create = useMutation(async () => {
    await teacherApi.createStudent({ name, email, batch: batch || null, group: group || null });
    onCreated();
    onClose();
  });

  return (
    <Card className="mb-5">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <div className="eyebrow mb-1">Enrolment</div>
          <h3 className="text-md font-semibold">Add a student</h3>
        </div>
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="px-5 pb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Full name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@school.lk"
            />
          </Field>
          {/*
            Chosen from the batches an admin has set up, not typed.

            Free text here is how "2026 A/L" and "2026 A/l" became two
            different batches, which nobody noticed until a register came
            up half empty. The group list narrows to whichever batch is
            selected, because a group only means anything inside one.
          */}
          <Field label="Batch" hint={batches.length === 0 ? "Ask your admin to add one." : undefined}>
            <Select
              value={batch}
              onChange={(e) => {
                setBatch(e.target.value);
                setGroup("");
              }}
              disabled={batches.length === 0}
            >
              <option value="">No batch</option>
              {batches.map((b) => (
                <option key={b.batchId} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Group">
            <Select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              disabled={groupOptions.length === 0}
            >
              <option value="">
                {groupOptions.length === 0 ? "No groups in this batch" : "No group"}
              </option>
              {groupOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {create.error && (
          <p className="text-xs text-danger-fg mt-3">
            {create.error.isPaywall
              ? "This plan has no seats left. Move up a tier to add more students."
              : create.error.message}
          </p>
        )}

        <Button
          variant="primary"
          className="mt-4"
          disabled={!name.trim() || !email.trim() || atCap}
          loading={create.pending}
          onClick={create.mutate}
        >
          Add student
        </Button>
      </div>
    </Card>
  );
}

export default function Students() {
  const { org } = useTheme();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("all");
  const [sort, setSort] = useState("name");
  const [selected, setSelected] = useState([]);
  const [adding, setAdding] = useState(false);

  const debouncedQuery = useDebounced(query, 250);
  const { data, loading, error, reload } = useApi(
    () => teacherApi.students({ q: debouncedQuery, batch }),
    [debouncedQuery, batch],
  );

  const seats = org ? seatUsage(org.packageTier, org.seats.students, "students") : null;
  const all = data ?? [];

  const batches = useMemo(
    () => [...new Set(all.map((s) => s.batch).filter(Boolean))].sort(),
    [all],
  );

  const rows = useMemo(() => {
    let out = all;
    if (tab === "unpaid") out = out.filter((s) => s.paymentStatus !== "paid");
    if (tab === "at_risk") out = out.filter((s) => s.attendancePct < 75 || s.avgScore < 60);
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      score: (a, b) => b.avgScore - a.avgScore,
      attendance: (a, b) => b.attendancePct - a.attendancePct,
    };
    return [...out].sort(by[sort]);
  }, [all, tab, sort]);

  const atRisk = all.filter((s) => s.attendancePct < 75 || s.avgScore < 60).length;
  const unpaid = all.filter((s) => s.paymentStatus !== "paid").length;

  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.studentId));
  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div>
      <PageHeader
        eyebrow="Roster"
        title="Students"
        sub="Everyone enrolled in your batches, with payment and progress at a glance."
        actions={
          <>
            <Button variant="secondary" icon="upload">
              Import CSV
            </Button>
            <Button
              variant="primary"
              icon="plus"
              disabled={seats?.atCap}
              onClick={() => setAdding(true)}
            >
              Add student
            </Button>
          </>
        }
      />

      {seats?.nearingCap && (
        <div className="mb-5">
          <SeatCapNotice kind="Student" used={org.seats.students} cap={seats.cap} />
        </div>
      )}

      {adding && (
        <AddStudentPanel
          onClose={() => setAdding(false)}
          onCreated={reload}
          atCap={seats?.atCap}
        />
      )}

      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric
            icon="students"
            tone="brand"
            label="Enrolled"
            value={org?.seats.students ?? all.length}
            sub={seats?.label}
          />
          <Metric
            icon="wallet"
            tone={unpaid > 0 ? "warning" : "success"}
            label="Fees outstanding"
            value={unpaid}
            sub="students not yet paid"
          />
          <Metric
            icon="calendar"
            tone="info"
            label="In this list"
            value={all.length}
            sub="matching your filters"
          />
          <Metric
            icon="alert"
            tone={atRisk > 0 ? "danger" : "success"}
            label="Needs attention"
            value={atRisk}
            sub="below 75% or failing"
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search students"
            className="flex-1 min-w-[200px]"
          />
          <Select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-40">
            <option value="all">All batches</option>
            {batches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-44">
            <option value="name">Sort by name</option>
            <option value="score">Sort by score</option>
            <option value="attendance">Sort by attendance</option>
          </Select>
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          className="px-3"
          items={[
            { value: "all", label: "All", count: all.length },
            { value: "unpaid", label: "Fees due", count: unpaid },
            { value: "at_risk", label: "Needs attention", count: atRisk },
          ]}
        />

        {selected.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 bg-[var(--portal-accent-soft)] border-b border-hairline animate-rise">
            <span className="text-sm font-bold text-[var(--portal-accent)]">
              {selected.length} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button size="sm" variant="secondary" icon="mail">
                Send reminder
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {error ? (
          <ErrorState body={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            art="list"
            title={all.length === 0 ? "No students yet" : "No students match"}
            body={
              all.length === 0
                ? "Add your first student, or import a class list."
                : "Adjust the filters, or clear the search to see the whole roster."
            }
            action={
              all.length === 0 ? (
                <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                  Add a student
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setBatch("all");
                    setTab("all");
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="border-b border-hairline bg-sunken">
                  <th className="w-10 px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="size-3.5 accent-[var(--portal-accent)] cursor-pointer"
                    />
                  </th>
                  {["Student", "Batch", "Fees", "Attendance", "Average", "Ticket", "Active", ""].map(
                    (h) => (
                      <th key={h} className="eyebrow text-left px-4 py-2.5 whitespace-nowrap">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {rows.map((s) => (
                  <tr
                    key={s.studentId}
                    className={cx(
                      "transition-colors",
                      selected.includes(s.studentId)
                        ? "bg-[var(--portal-accent-soft)]"
                        : "hover:bg-ink-50/60",
                    )}
                  >
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(s.studentId)}
                        onChange={() => toggle(s.studentId)}
                        aria-label={`Select ${s.name}`}
                        className="size-3.5 accent-[var(--portal-accent)] cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.name} size={32} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{s.name}</p>
                          <p className="text-2xs text-ink-500 truncate">{s.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-ink-600">{s.batch}</span>
                      <span className="block text-2xs text-ink-400">{s.group}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={PAYMENT_TONE[s.paymentStatus]} dot>
                        {PAYMENT_LABEL[s.paymentStatus]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 w-28">
                        <Progress
                          value={s.attendancePct}
                          height={5}
                          tone={s.attendancePct < 75 ? "var(--danger-mid)" : undefined}
                        />
                        <span className="text-2xs font-bold tnum w-8">{s.attendancePct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {/* Colour coded pill, so a failing row is visible at a glance. */}
                      <span
                        className="inline-flex items-center justify-center min-w-9 h-6 px-2 rounded-[var(--radius-sm)] text-xs font-bold tnum text-white"
                        style={{ background: scoreTone(s.avgScore) }}
                      >
                        {s.avgScore}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <TicketCell expiry={s.ticketExpiry} />
                    </td>
                    <td className="px-4 py-3 text-2xs text-ink-500 whitespace-nowrap">
                      {s.lastActive ? relativeTime(s.lastActive) : "never"}
                    </td>
                    <td className="px-4 py-3">
                      <IconButton icon="more" label={`Actions for ${s.name}`} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-hairline">
          <span className="text-xs text-ink-500">
            Showing {rows.length} of {all.length}
          </span>
        </div>
      </Card>
    </div>
  );
}
