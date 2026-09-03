import { useMemo } from "react";

/*
  Visual stand in for a class ticket QR.

  Real encoding happens server side with the qrcode library (see
  ARCHITECTURE.md section 7.2) because the payload is signed. A client
  generated code could be forged, so this never becomes the real thing.
  It renders a deterministic pattern from the payload so the layout is
  honest about the space a real code occupies, and so the same ticket
  always looks the same.
*/
export function QrCode({ payload, size = 168 }) {
  const cells = 21;
  const bits = useMemo(() => {
    let h = 2166136261;
    const out = [];
    for (let i = 0; i < cells * cells; i++) {
      h ^= payload.charCodeAt(i % payload.length);
      h = Math.imul(h, 16777619);
      out.push(((h >>> 7) & 1) === 1);
    }
    return out;
  }, [payload]);

  const unit = size / cells;
  const isFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= cells - 7) || (r >= cells - 7 && c < 7);

  return (
    <svg
      width={size}
      height={size}
      className="rounded-[var(--radius-sm)]"
      role="img"
      aria-label="Class ticket QR code"
    >
      <rect width={size} height={size} fill="white" />
      {bits.map((on, i) => {
        const r = Math.floor(i / cells);
        const c = i % cells;
        if (isFinder(r, c) || !on) return null;
        return (
          <rect
            key={i}
            x={c * unit}
            y={r * unit}
            width={unit * 0.88}
            height={unit * 0.88}
            rx={unit * 0.22}
            fill="var(--ink-950)"
          />
        );
      })}
      {[
        [0, 0],
        [0, cells - 7],
        [cells - 7, 0],
      ].map(([r, c], i) => (
        <g key={i}>
          <rect
            x={c * unit + unit * 0.5}
            y={r * unit + unit * 0.5}
            width={unit * 6}
            height={unit * 6}
            rx={unit * 1.6}
            fill="none"
            stroke="var(--ink-950)"
            strokeWidth={unit}
          />
          <rect
            x={(c + 2) * unit}
            y={(r + 2) * unit}
            width={unit * 3}
            height={unit * 3}
            rx={unit * 0.8}
            fill="var(--brand-600)"
          />
        </g>
      ))}
    </svg>
  );
}

/*
  The ticket itself, styled as a physical pass with a perforation. It is
  an object a student holds up at a door, so it should look like one
  rather than like another card in a dashboard.
*/
export function TicketPass({ student, expiryLabel, daysLeft, payload, children }) {
  /*
    The payload comes from the server, which signs it. Falling back to a
    locally built one keeps the component renderable in isolation, but
    an unsigned payload will not validate, which is the correct outcome:
    only the server can mint a real ticket.
  */
  const encoded =
    payload ??
    JSON.stringify({
      student_name: student.name,
      student_id: student.studentId,
      org_id: student.orgId,
      batch: student.batch,
      group: student.group,
      expiry_date: student.ticketExpiry,
    });

  return (
    <div className="relative rounded-[var(--radius-md)] border border-hairline bg-sunken overflow-hidden">
      <div
        className="px-4 py-3 text-[var(--brand-contrast)]"
        style={{ background: "var(--brand-gradient)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-2xs font-bold tracking-widest opacity-90">CLASS TICKET</span>
          <span className="text-2xs font-bold opacity-90 tnum">{daysLeft}d left</span>
        </div>
        <p className="text-sm font-bold mt-1.5">{student.name}</p>
        <p className="text-2xs opacity-85">
          {student.batch} · {student.group}
        </p>
      </div>

      {/* Perforation. */}
      <div className="relative h-4 bg-sunken">
        <span className="absolute -left-2 top-1/2 -translate-y-1/2 size-4 rounded-full bg-[var(--surface)] border border-hairline" />
        <span className="absolute -right-2 top-1/2 -translate-y-1/2 size-4 rounded-full bg-[var(--surface)] border border-hairline" />
        <span className="absolute left-3 right-3 top-1/2 border-t border-dashed border-ink-300" />
      </div>

      <div className="flex flex-col items-center px-4 pb-4">
        <QrCode payload={encoded} />
        <p className="text-2xs text-ink-500 mt-2.5 tnum">Valid to {expiryLabel}</p>
        {children}
      </div>
    </div>
  );
}
