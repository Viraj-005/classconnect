import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  Metric,
  PageHeader,
  SearchInput,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows, UpgradeGate } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { QrCode, TicketPass } from "@/components/Qr";
import { cx, daysUntil, formatDate } from "@/lib/cx";
import { teacherApi, ticketApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";

/*
  QR class tickets, Growth and Pro only.

  The interesting design problem is the scan result. Someone at a
  classroom door needs to read valid or invalid from two metres away in
  under a second, so the result takes over the whole panel with colour
  and a single word rather than appearing as a toast.

  The three failure modes stay distinct because only one of them is a
  security event: a ticket from another tenant is a cross tenant access
  attempt and the server writes an audit row for it.
*/

const SCAN_STATES = {
  valid: {
    tone: "success",
    icon: "checkCircle",
    word: "Valid",
  },
  expired: {
    tone: "warning",
    icon: "clock",
    word: "Expired",
  },
  revoked: {
    tone: "warning",
    icon: "clock",
    word: "Replaced",
  },
  foreign_tenant: {
    tone: "danger",
    icon: "shield",
    word: "Rejected",
  },
  malformed: {
    tone: "danger",
    icon: "alert",
    word: "Unreadable",
  },
};

function ScanPanel({ students }) {
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState("");

  const scan = useMutation(async (payload) => {
    const res = await ticketApi.scan(payload);
    setResult(res);
    return res;
  });

  /*
    Camera capture is not wired up. Rather than fake a viewfinder that
    does nothing, this validates a real live ticket, which exercises the
    genuine signature and tenant checks end to end.

    It reads the ticket rather than issuing one. Issuing here would have
    revoked whatever the student is holding, every time a teacher tried
    the scanner.
  */
  const scanFirstActive = async () => {
    const holder = students.find((s) => s.ticketExpiry);
    if (!holder) return;
    const live = await ticketApi.current(holder.studentId);
    if (!live?.active) return;
    await scan.mutate(live.payload);
  };

  const meta = result ? SCAN_STATES[result.status] : null;
  const toneBg = {
    success: "bg-success-bg text-success-fg",
    warning: "bg-warning-bg text-warning-fg",
    danger: "bg-danger-bg text-danger-fg",
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        eyebrow="Door check"
        title="Validate a ticket"
        sub="Scan at class entry, or paste a ticket payload"
      />
      <div className="px-5 pb-5">
        <div
          className={cx(
            "relative rounded-[var(--radius-md)] h-52 flex flex-col items-center justify-center",
            "transition-colors duration-[var(--dur-med)] overflow-hidden px-6 text-center",
            meta ? toneBg[meta.tone] : "bg-[var(--ink-950)]",
          )}
        >
          {!meta ? (
            <>
              <div className="relative size-28">
                {[
                  "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                  "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                  "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                ].map((pos) => (
                  <span key={pos} className={cx("absolute size-7 border-white/70", pos)} />
                ))}
                <Icon name="qr" size={40} className="absolute inset-0 m-auto text-white/25" />
              </div>
              <p className="text-xs text-white/70 mt-4">
                {scan.pending ? "Checking with the server" : "Camera capture is not wired up yet"}
              </p>
            </>
          ) : (
            <div className="animate-rise">
              <Icon name={meta.icon} size={38} className="mx-auto" />
              <p className="text-2xl font-bold font-display mt-2">{meta.word}</p>
              <p className="text-xs mt-1.5 opacity-90 max-w-xs">{result.detail}</p>
              {result.studentName && (
                <p className="text-xs font-bold mt-2">{result.studentName}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          {meta ? (
            <Button variant="secondary" block onClick={() => setResult(null)}>
              Scan another
            </Button>
          ) : (
            <Button
              variant="primary"
              icon="qr"
              block
              loading={scan.pending}
              onClick={scanFirstActive}
              disabled={!students.some((s) => s.ticketExpiry)}
            >
              Validate a live ticket
            </Button>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-hairline">
          <SearchInput
            value={manual}
            onChange={setManual}
            placeholder="Paste a scanned payload"
          />
          <Button
            variant="secondary"
            size="sm"
            block
            className="mt-2"
            disabled={!manual.trim()}
            loading={scan.pending}
            onClick={() => scan.mutate(manual)}
          >
            Check this payload
          </Button>
          <p className="text-2xs text-ink-500 mt-2 leading-relaxed">
            Paste a ticket from another organisation to see the cross tenant rejection. It is
            recorded in the audit log as a security event.
          </p>
        </div>
      </div>
    </Card>
  );
}

function TicketPreview({ student }) {
  /* Reads the live ticket. It used to call issue, which meant that
     opening this screen silently minted a new code and invalidated
     the one already on the student's phone. */
  const issued = useApi(() => ticketApi.current(student.studentId), [student.studentId]);
  const days = student.ticketExpiry ? daysUntil(student.ticketExpiry) : 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader eyebrow="Preview" title="Issued ticket" sub={student.name} />
      <div className="px-5 pb-5">
        {issued.loading ? (
          <div className="h-64 rounded-[var(--radius-md)] skeleton" />
        ) : issued.error ? (
          <ErrorState body={issued.error.message} onRetry={issued.reload} />
        ) : (
          <>
            <TicketPass
              student={{
                name: student.name,
                studentId: student.studentId,
                orgId: "",
                batch: student.batch,
                group: student.group,
                ticketExpiry: issued.data?.expiryDate,
              }}
              daysLeft={days}
              expiryLabel={formatDate(issued.data?.expiryDate ?? student.ticketExpiry)}
              payload={issued.data?.payload}
            />
            <div className="mt-4">
              <DataRow label="Validity" value="30 days" icon="clock" />
              <DataRow label="Scans" value={issued.data?.scanCount ?? 0} icon="qr" />
            </div>
            <div className="flex gap-2 mt-3">
              <Button variant="secondary" icon="download" block>
                Download
              </Button>
              <Button variant="secondary" icon="mail" block>
                Email
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export default function Tickets() {
  const { can } = useTheme();
  const [tab, setTab] = useState("active");
  const [query, setQuery] = useState("");

  const { data, loading, error, reload } = useApi(() => teacherApi.students(), [], {
    skip: !can("qr_ticketing"),
  });

  const students = data ?? [];
  const withTickets = students.filter((s) => s.ticketExpiry);
  const expiringSoon = withTickets.filter((s) => daysUntil(s.ticketExpiry) <= 7);
  const noTicket = students.filter((s) => !s.ticketExpiry);

  const rows = useMemo(() => {
    const base = tab === "active" ? withTickets : tab === "expiring" ? expiringSoon : noTicket;
    if (!query) return base;
    return base.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query, data]);

  if (!can("qr_ticketing")) {
    return (
      <div>
        <PageHeader
          eyebrow="Access"
          title="Class tickets"
          sub="Issue a scannable pass when a fee clears, and validate it at the door."
        />
        <UpgradeGate
          feature="qr_ticketing"
          preview={
            <div className="p-6 flex gap-6">
              <div className="w-52">
                <QrCode payload="preview-ticket-payload" size={168} />
              </div>
              <div className="flex-1 space-y-3 pt-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-9 rounded-[var(--radius-sm)] bg-sunken" />
                ))}
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Access"
        title="Class tickets"
        sub="A ticket is issued when a fee clears and stays valid for 30 days."
        actions={
          <Button variant="primary" icon="qr">
            Issue tickets
          </Button>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric icon="qr" tone="brand" label="Active tickets" value={withTickets.length} />
          <Metric
            icon="clock"
            tone="warning"
            label="Expiring this week"
            value={expiringSoon.length}
            sub="renew after payment"
          />
          <Metric
            icon="close"
            tone="danger"
            label="No ticket"
            value={noTicket.length}
            sub="fees unpaid"
          />
          <Metric icon="students" tone="info" label="Students" value={students.length} />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Card className="overflow-hidden">
            <div className="p-3">
              <SearchInput value={query} onChange={setQuery} placeholder="Search students" />
            </div>
            <Tabs
              value={tab}
              onChange={setTab}
              className="px-3"
              items={[
                { value: "active", label: "Active", count: withTickets.length },
                { value: "expiring", label: "Expiring", count: expiringSoon.length },
                { value: "none", label: "No ticket", count: noTicket.length },
              ]}
            />
            {error ? (
              <ErrorState body={error.message} onRetry={reload} />
            ) : loading ? (
              <SkeletonRows rows={6} />
            ) : rows.length === 0 ? (
              <EmptyState
                art="list"
                title="Nobody here"
                body="No students match this filter right now."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {rows.map((s) => {
                  const days = s.ticketExpiry ? daysUntil(s.ticketExpiry) : null;
                  return (
                    <li
                      key={s.studentId}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-50/60 transition-colors"
                    >
                      <Avatar name={s.name} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{s.name}</p>
                        <p className="text-2xs text-ink-500">
                          {s.batch} · {s.group}
                        </p>
                      </div>
                      {s.ticketExpiry ? (
                        <>
                          <span className="text-2xs text-ink-500 hidden sm:block tnum">
                            to {formatDate(s.ticketExpiry)}
                          </span>
                          <Badge tone={days <= 7 ? "warning" : "success"} icon="qr">
                            {days}d
                          </Badge>
                        </>
                      ) : (
                        <Button size="sm" variant="secondary" icon="wallet">
                          Take payment
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <ScanPanel students={students} />
          {withTickets[0] && <TicketPreview student={withTickets[0]} />}
        </div>
      </div>
    </div>
  );
}
