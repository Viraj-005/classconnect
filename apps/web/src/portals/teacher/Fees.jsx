import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  Field,
  IconChip,
  Input,
  Metric,
  PAYMENT_LABEL,
  PAYMENT_TONE,
  PageHeader,
  Select,
  Tabs,
  Toggle,
} from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  LockedAction,
  SkeletonRows,
  UpgradeGate,
} from "@/components/ui/states";
import { RevenueBars } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { formatMoney, relativeTime } from "@/lib/cx";
import { teacherApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";
import { SyntheticNote } from "./Overview";

/*
  Fee management.

  This screen has to work at two very different tiers. On Starter it is
  a manual ledger with no gateway at all, on Growth and Pro it gains the
  Stripe and PayPal rails plus the slip review queue. Rather than build
  two screens, the gateway pieces are gated in place so a Starter tenant
  sees what they would gain.
*/

const METHOD_META = {
  stripe: { label: "Stripe", icon: "card", tone: "brand" },
  paypal: { label: "PayPal", icon: "wallet", tone: "info" },
  slip: { label: "Bank slip", icon: "doc", tone: "warning" },
  cash: { label: "Cash", icon: "wallet", tone: "neutral" },
};

function SlipReview({ payment, onApprove, approving }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        eyebrow="Awaiting review"
        title="Payment slip"
        sub={`Uploaded ${relativeTime(payment.submittedAt)}`}
        action={<Badge tone="info">Manual</Badge>}
      />
      {/*
        A real slip preview would be an S3 object scoped to the org.
        Storage is not connected yet, so the placeholder keeps the
        reviewing layout honest about the space a document takes.
      */}
      <div className="mx-5 rounded-[var(--radius-md)] bg-sunken border border-hairline h-40 flex flex-col items-center justify-center gap-2">
        <IconChip icon="doc" tone="warning" size="lg" />
        <span className="text-xs font-semibold">{payment.slipFilename ?? "slip.jpg"}</span>
        <span className="text-2xs text-ink-400">File storage not connected yet</span>
      </div>
      <div className="px-5 py-4">
        <DataRow label="Student" value={payment.studentName} icon="user" />
        <DataRow
          label="Amount claimed"
          value={formatMoney(payment.amount, payment.currency)}
          icon="wallet"
        />
      </div>
      <div className="flex items-center gap-2 px-5 pb-5">
        <Button
          variant="primary"
          icon="check"
          block
          loading={approving}
          onClick={() => onApprove(payment.paymentId)}
        >
          Approve and issue ticket
        </Button>
        <Button variant="secondary" className="text-danger-fg">
          Reject
        </Button>
      </div>
    </Card>
  );
}

function FeeSettings() {
  const { can } = useTheme();
  const [reminders, setReminders] = useState(true);
  const [autoTicket, setAutoTicket] = useState(true);

  return (
    <Card>
      <CardHeader eyebrow="Configuration" title="Fee settings" />
      <div className="px-5 pb-5 space-y-4">
        <Field label="Monthly fee" hint="Applied to every student in the selected batch.">
          <div className="flex gap-2">
            <Select className="w-24" defaultValue="LKR" disabled={!can("multi_currency")}>
              <option>LKR</option>
              <option>USD</option>
              <option>EUR</option>
            </Select>
            <Input defaultValue="8500" className="flex-1" />
          </div>
        </Field>

        {!can("multi_currency") && (
          <p className="text-2xs text-ink-500 -mt-2 flex items-center gap-1.5">
            <Icon name="lock" size={11} />
            Multiple currencies are available on Pro.
          </p>
        )}

        <div className="h-px bg-hairline" />

        <Toggle
          checked={reminders}
          onChange={setReminders}
          label="Automatic reminders"
          hint="Email unpaid students three days before the due date, then on the day."
        />
        <Toggle
          checked={autoTicket}
          onChange={setAutoTicket}
          disabled={!can("qr_ticketing")}
          label="Issue a QR ticket on payment"
          hint={
            can("qr_ticketing")
              ? "A 30 day class ticket is generated the moment a payment clears."
              : "Requires QR ticketing, available from Growth."
          }
        />

        <Button variant="primary" block>
          Save settings
        </Button>
      </div>
    </Card>
  );
}

export default function Fees() {
  const { can } = useTheme();
  const [tab, setTab] = useState("all");

  const payments = useApi(() => teacherApi.payments(), []);
  const overview = useApi(() => teacherApi.overview(), []);

  const approve = useMutation(async (id) => {
    await teacherApi.approvePayment(id);
    await Promise.all([payments.reload(), overview.reload()]);
  });

  const all = payments.data ?? [];
  const rows = useMemo(
    () => (tab === "all" ? all : all.filter((p) => p.status === tab)),
    [all, tab],
  );

  const counts = {
    all: all.length,
    pending_review: all.filter((p) => p.status === "pending_review").length,
    overdue: all.filter((p) => p.status === "overdue").length,
    paid: all.filter((p) => p.status === "paid").length,
  };
  const pending = all.filter((p) => p.status === "pending_review");
  const m = overview.data?.metrics;

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Fees"
        sub="Track what has come in, chase what has not, and review bank slips."
        actions={
          <>
            {can("analytics_export") ? (
              <Button variant="secondary" icon="download">
                Export
              </Button>
            ) : (
              <LockedAction feature="analytics_export">
                <Button variant="secondary" icon="download">
                  Export
                </Button>
              </LockedAction>
            )}
            <Button variant="primary" icon="plus">
              Record payment
            </Button>
          </>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
          <Metric
            icon="wallet"
            tone="success"
            label="Collected"
            value={formatMoney(m?.collected ?? 0)}
            sub="this billing cycle"
          />
          <Metric
            icon="clock"
            tone="warning"
            label="Outstanding"
            value={formatMoney(m?.outstanding ?? 0)}
            sub={`${counts.overdue + counts.pending_review} accounts`}
          />
          <Metric
            icon="inbox"
            tone="info"
            label="Slips to review"
            value={counts.pending_review}
            sub="manual approval"
          />
          <Metric
            icon="chart"
            tone="brand"
            label="Collection rate"
            value={`${m?.collectionRate ?? 0}%`}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {!can("payment_gateway") && (
            <UpgradeGate
              feature="payment_gateway"
              preview={
                <div className="p-5">
                  <div className="flex gap-3">
                    {["stripe", "paypal"].map((mth) => (
                      <div
                        key={mth}
                        className="flex-1 rounded-[var(--radius-md)] border border-hairline p-4"
                      >
                        <IconChip icon={METHOD_META[mth].icon} tone={METHOD_META[mth].tone} />
                        <p className="text-sm font-semibold mt-2.5">{METHOD_META[mth].label}</p>
                        <p className="text-2xs text-ink-500 mt-1">Connected, taking payments</p>
                      </div>
                    ))}
                  </div>
                </div>
              }
            />
          )}

          <Card className="overflow-hidden">
            <CardHeader eyebrow="Ledger" title="Payments" />
            <Tabs
              value={tab}
              onChange={setTab}
              className="px-3"
              items={[
                { value: "all", label: "All", count: counts.all },
                { value: "pending_review", label: "In review", count: counts.pending_review },
                { value: "overdue", label: "Overdue", count: counts.overdue },
                { value: "paid", label: "Paid", count: counts.paid },
              ]}
            />

            {payments.error ? (
              <ErrorState body={payments.error.message} onRetry={payments.reload} />
            ) : payments.loading ? (
              <SkeletonRows rows={6} />
            ) : rows.length === 0 ? (
              <EmptyState
                art="inbox"
                title="Nothing here"
                body="No payments match this filter yet."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {rows.map((p) => {
                  const meta = METHOD_META[p.method] ?? METHOD_META.cash;
                  return (
                    <li
                      key={p.paymentId}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-50/60 transition-colors"
                    >
                      <Avatar name={p.studentName} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{p.studentName}</p>
                        <p className="text-2xs text-ink-500 flex items-center gap-1.5">
                          <Icon name={meta.icon} size={11} />
                          {meta.label} · {relativeTime(p.submittedAt)}
                        </p>
                      </div>
                      <span className="text-sm font-bold tnum shrink-0">
                        {formatMoney(p.amount, p.currency)}
                      </span>
                      <div className="w-24 flex justify-end shrink-0">
                        <Badge tone={PAYMENT_TONE[p.status]} dot>
                          {PAYMENT_LABEL[p.status]}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              eyebrow="Trend"
              title="Collected by month"
              action={<SyntheticNote note={overview.data?.revenue?.note} />}
            />
            <div className="px-5 pb-4">
              <RevenueBars data={overview.data?.revenue?.points ?? []} height={200} />
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {pending.length > 0 && (
            <SlipReview
              payment={pending[0]}
              onApprove={approve.mutate}
              approving={approve.pending}
            />
          )}
          <FeeSettings />
        </div>
      </div>
    </div>
  );
}
