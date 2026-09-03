import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  IconChip,
  Metric,
  PAYMENT_LABEL,
  PAYMENT_TONE,
  PageHeader,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, formatDate, formatMoney, relativeTime } from "@/lib/cx";
import { parentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Parent fee view.

  Read mostly, act occasionally. A parent wants to know whether the
  child is covered and when the next payment falls due. The pay action
  is present but the page does not push it, since in most tenants the
  student settles fees directly.
*/

export default function ParentPayments() {
  const { data, loading, error, reload } = useApi(() => parentApi.progress(), []);

  const child = data?.child;
  const history = data?.payments ?? [];
  const paidTotal = history
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const covered = child?.paymentStatus === "paid";

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Fees"
        sub="What has been paid for Amaya, and what is coming up."
        actions={
          <Button variant="secondary" icon="download">
            Download receipts
          </Button>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div
          className={cx(
            "px-5 py-4 flex flex-wrap items-center gap-4",
            covered ? "bg-success-bg" : "bg-warning-bg",
          )}
        >
          <span
            className={cx(
              "inline-flex items-center justify-center size-11 rounded-[var(--radius-md)] shrink-0 text-white",
              covered ? "bg-[var(--success-mid)]" : "bg-[var(--warning-mid)]",
            )}
          >
            <Icon name={covered ? "checkCircle" : "alert"} size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cx("text-md font-bold", covered ? "text-success-fg" : "text-warning-fg")}>
              {covered ? "Fees are up to date" : "A payment is due"}
            </p>
            <p
              className={cx(
                "text-xs mt-0.5 opacity-85",
                covered ? "text-success-fg" : "text-warning-fg",
              )}
            >
              {child?.ticketExpiry
                ? `Class access is covered to ${formatDate(child.ticketExpiry)}`
                : "Class access is paused until the next payment clears"}
            </p>
          </div>
          {!covered && (
            <Button variant="primary" icon="wallet">
              Pay now
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)] border-t border-hairline">
          <Metric icon="wallet" tone="success" label="Paid this term" value={formatMoney(paidTotal)} />
          <Metric icon="card" tone="brand" label="Monthly fee" value={formatMoney(8500)} />
          <Metric
            icon="calendar"
            tone="info"
            label="Next due"
            value={child?.ticketExpiry ? formatDate(child.ticketExpiry) : "Now"}
          />
          <Metric icon="check" tone="neutral" label="Payments made" value={history.length} />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2 overflow-hidden">
          <CardHeader eyebrow="History" title="Payments" sub="Newest first" />
          {error ? (
            <ErrorState body={error.message} onRetry={reload} />
          ) : loading ? (
            <SkeletonRows rows={4} />
          ) : history.length === 0 ? (
            <EmptyState
              art="inbox"
              title="No payments yet"
              body="Payments appear here with a receipt as soon as they clear."
              className="py-10"
            />
          ) : (
          <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
            {history.map((p) => (
              <li key={p.paymentId} className="flex items-center gap-3.5 px-5 py-3.5">
                <IconChip
                  icon={p.method === "slip" ? "doc" : p.method === "paypal" ? "wallet" : "card"}
                  tone={PAYMENT_TONE[p.status]}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {formatMoney(p.amount, p.currency)}
                    <span className="text-ink-500 font-normal"> · {p.method}</span>
                  </p>
                  <p className="text-2xs text-ink-500">
                    {relativeTime(p.submittedAt)} · covers to {formatDate(p.expiryDate)}
                  </p>
                </div>
                <Badge tone={PAYMENT_TONE[p.status]} dot>
                  {PAYMENT_LABEL[p.status]}
                </Badge>
                <button
                  className="size-8 rounded-[var(--radius-sm)] flex items-center justify-center text-ink-400 hover:text-ink-800 hover:bg-ink-100 transition-colors"
                  aria-label="Download receipt"
                >
                  <Icon name="download" size={15} />
                </button>
              </li>
            ))}
          </ul>
          )}
        </Card>

        <Card>
          <CardHeader eyebrow="Details" title="What you are paying for" />
          <div className="px-5 pb-5">
            <DataRow label="Student" value={child?.name ?? ""} icon="user" />
            <DataRow label="Batch" value={child?.batch ?? ""} icon="students" />
            <DataRow label="Monthly fee" value={formatMoney(8500)} icon="wallet" />
            <DataRow label="Covers" value="30 days of classes" icon="calendar" />
            <div className="mt-4 rounded-[var(--radius-md)] bg-sunken border border-hairline p-4">
              <p className="text-xs font-semibold mb-1.5">Who can pay</p>
              <p className="text-2xs text-ink-500 leading-relaxed">
                Either you or your child can settle the fee. A payment made from the student account
                shows up here within a minute, and a bank slip appears once a teacher approves it.
              </p>
            </div>
            <Button variant="secondary" block className="mt-3" icon="mail">
              Ask about a payment
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
