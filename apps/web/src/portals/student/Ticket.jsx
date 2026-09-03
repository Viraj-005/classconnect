import { Badge, Button, Card, CardHeader, DataRow, PageHeader } from "@/components/ui/primitives";
import { ErrorState, UpgradeGate } from "@/components/ui/states";
import { QrCode, TicketPass } from "@/components/Qr";
import { Icon } from "@/components/Icon";
import { cx, daysUntil, formatDate } from "@/lib/cx";
import { studentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Student class ticket.

  Used standing at a door with a phone in one hand, so the ticket is
  centred, large, and everything else is secondary. No competing panels
  beside it.

  The payload is fetched from the server, which signs it. The client
  cannot mint one, which is the entire point of the signature.
*/

export default function Ticket() {
  const { can, org } = useTheme();
  const { data, loading, error, reload } = useApi(() => studentApi.ticket(), [], {
    skip: !can("qr_ticketing"),
  });

  if (!can("qr_ticketing")) {
    return (
      <div>
        <PageHeader
          eyebrow="Access"
          title="Class ticket"
          sub="A scannable pass that proves your fees are settled."
        />
        <UpgradeGate
          feature="qr_ticketing"
          preview={
            <div className="p-8 flex justify-center">
              <QrCode payload="preview" size={180} />
            </div>
          }
        />
      </div>
    );
  }

  const active = data?.active;
  const days = data?.expiryDate ? daysUntil(data.expiryDate) : -1;

  return (
    <div>
      <PageHeader
        eyebrow="Access"
        title="Class ticket"
        sub="Show this at the door. It refreshes automatically when you pay."
      />

      <div className="max-w-md mx-auto">
        {error ? (
          <Card>
            <ErrorState body={error.message} onRetry={reload} />
          </Card>
        ) : loading ? (
          <Card className="h-96 skeleton" />
        ) : (
          <>
            <div
              className={cx(
                "flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 mb-4",
                active ? "bg-success-bg" : "bg-danger-bg",
              )}
            >
              <Icon
                name={active ? "checkCircle" : "alert"}
                size={20}
                className={cx("shrink-0", active ? "text-success-fg" : "text-danger-fg")}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cx("text-sm font-bold", active ? "text-success-fg" : "text-danger-fg")}
                >
                  {active ? "Ticket is valid" : "No active ticket"}
                </p>
                <p
                  className={cx(
                    "text-2xs opacity-85",
                    active ? "text-success-fg" : "text-danger-fg",
                  )}
                >
                  {active
                    ? `${days} days of class access left`
                    : (data?.reason ?? "Settle your fees to get a new ticket")}
                </p>
              </div>
              {active && (
                <Badge tone="success" icon="qr">
                  {days}d
                </Badge>
              )}
            </div>

            <Card className="p-5">
              {active ? (
                <>
                  <TicketPass
                    student={{
                      name: "",
                      batch: data.batch,
                      group: data.group,
                    }}
                    payload={data.payload}
                    daysLeft={days}
                    expiryLabel={formatDate(data.expiryDate)}
                  />
                  <div className="mt-4 pt-4 border-t border-hairline">
                    <DataRow label="Organisation" value={org?.name} icon="building" />
                    <DataRow
                      label="Batch"
                      value={`${data.batch ?? ""}${data.group ? ` · ${data.group}` : ""}`}
                      icon="students"
                    />
                    <DataRow label="Expires" value={formatDate(data.expiryDate)} icon="clock" />
                    <DataRow label="Scans" value={data.scanCount} icon="qr" />
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button variant="secondary" icon="download" block>
                      Save to phone
                    </Button>
                    <Button variant="secondary" icon="mail" block>
                      Email it
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <span className="inline-flex items-center justify-center size-14 rounded-[var(--radius-lg)] bg-danger-bg text-danger-fg">
                    <Icon name="lock" size={26} />
                  </span>
                  <h3 className="text-md font-semibold mt-4">No active ticket</h3>
                  <p className="text-sm text-ink-500 mt-1.5 max-w-xs mx-auto leading-relaxed">
                    Tickets are issued automatically once a payment clears.
                  </p>
                  <Button variant="primary" className="mt-4" icon="wallet">
                    Pay fees
                  </Button>
                </div>
              )}
            </Card>
          </>
        )}

        <Card className="mt-4">
          <CardHeader eyebrow="How it works" title="About your ticket" />
          <ul className="px-5 pb-5 space-y-2.5">
            {[
              "A new ticket is issued each time a payment clears, valid for 30 days.",
              "The code is signed and tied to your organisation, so it will not scan anywhere else.",
              "Screenshots work offline. The code does not change until it expires.",
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
  );
}
