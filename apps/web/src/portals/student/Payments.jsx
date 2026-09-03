import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  Field,
  IconChip,
  Input,
  PAYMENT_LABEL,
  PAYMENT_TONE,
  PageHeader,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows, UpgradeGate } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, formatDate, formatMoney, relativeTime } from "@/lib/cx";
import { useTheme } from "@/theme/ThemeProvider";
import { studentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/*
  Student payment hub.

  Two routes to the same outcome, and the BRD treats them as equals:
  pay through a gateway, or upload a bank slip for manual review. The
  slip route is the one most local tenants actually use, so it is not
  buried as a secondary option.
*/

const METHODS = [
  {
    id: "card",
    label: "Card",
    hint: "Visa, Mastercard, Amex",
    icon: "card",
    feature: "payment_gateway",
  },
  {
    id: "paypal",
    label: "PayPal",
    hint: "Pay from your balance",
    icon: "wallet",
    feature: "payment_gateway",
  },
  { id: "slip", label: "Bank slip", hint: "Upload a deposit receipt", icon: "doc", feature: null },
];

function PayPanel() {
  const { can } = useTheme();
  const [method, setMethod] = useState("card");
  const [file, setFile] = useState(null);

  return (
    <Card>
      <CardHeader
        eyebrow="Settle"
        title="Pay this month"
        sub="Access is restored as soon as the payment clears"
      />
      <div className="px-5 pb-5">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {METHODS.map((m) => {
            const locked = m.feature && !can(m.feature);
            const active = method === m.id;
            return (
              <button
                key={m.id}
                onClick={() => !locked && setMethod(m.id)}
                disabled={locked}
                className={cx(
                  "relative rounded-[var(--radius-md)] border p-3 text-left",
                  "transition-all duration-[var(--dur-fast)]",
                  locked
                    ? "opacity-45 cursor-not-allowed border-hairline"
                    : active
                      ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)]"
                      : "border-hairline hover:border-ink-300",
                )}
              >
                <Icon
                  name={m.icon}
                  size={18}
                  className={active ? "text-[var(--portal-accent)]" : "text-ink-500"}
                />
                <p className="text-xs font-bold mt-1.5">{m.label}</p>
                <p className="text-2xs text-ink-500 leading-tight mt-0.5">{m.hint}</p>
                {locked && (
                  <Icon name="lock" size={11} className="absolute top-2 right-2 text-ink-400" />
                )}
              </button>
            );
          })}
        </div>

        {method === "slip" ? (
          <div>
            <label
              className={cx(
                "block rounded-[var(--radius-md)] border-2 border-dashed p-6 text-center cursor-pointer",
                "transition-colors duration-[var(--dur-fast)]",
                file
                  ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)]"
                  : "border-hairline bg-sunken hover:border-ink-300",
              )}
            >
              <input
                type="file"
                className="hidden"
                accept="image/*,.pdf"
                onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)}
              />
              <IconChip icon={file ? "checkCircle" : "upload"} tone={file ? "success" : "brand"} size="lg" className="mx-auto" />
              <p className="text-sm font-semibold mt-2.5">
                {file ?? "Upload your deposit slip"}
              </p>
              <p className="text-2xs text-ink-500 mt-1">JPG, PNG or PDF up to 10 MB</p>
            </label>
            <p className="text-2xs text-ink-500 mt-2.5 flex items-start gap-1.5 leading-relaxed">
              <Icon name="clock" size={12} className="shrink-0 mt-0.5" />
              A teacher reviews slips manually, usually within a day. You will be notified either
              way.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Name on card">
              <Input placeholder="As printed on the card" />
            </Field>
            <Field label="Card number">
              <Input placeholder="0000 0000 0000 0000" inputMode="numeric" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expiry">
                <Input placeholder="MM / YY" />
              </Field>
              <Field label="CVC">
                <Input placeholder="123" inputMode="numeric" />
              </Field>
            </div>
            <p className="text-2xs text-ink-500 flex items-start gap-1.5 leading-relaxed">
              <Icon name="shield" size={12} className="shrink-0 mt-0.5" />
              Card details go straight to the payment provider. ClassConnect never stores them.
            </p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-hairline">
          <DataRow label="Monthly fee" value={formatMoney(8500)} />
          <DataRow label="Covers" value="30 days from approval" />
          <Button variant="primary" block size="lg" className="mt-3">
            {method === "slip" ? "Submit slip for review" : `Pay ${formatMoney(8500)}`}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function StudentPayments() {
  const { can } = useTheme();
  const overview = useApi(() => studentApi.overview(), []);
  const payments = useApi(() => studentApi.payments(), []);

  const me = overview.data?.student;
  const history = payments.data ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Fees"
        sub="Pay your monthly class fee and keep your ticket active."
      />

      {!can("payment_gateway") && (
        <div className="mb-5">
          <UpgradeGate feature="payment_gateway" compact />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {/* Status first. It is the only thing most students open this page for. */}
          <Card className="overflow-hidden">
            <div
              className={cx(
                "px-5 py-4 flex items-center gap-4",
                me?.paymentStatus === "paid" ? "bg-success-bg" : "bg-warning-bg",
              )}
            >
              <span
                className={cx(
                  "inline-flex items-center justify-center size-11 rounded-[var(--radius-md)] shrink-0",
                  me?.paymentStatus === "paid"
                    ? "bg-[var(--success-mid)] text-white"
                    : "bg-[var(--warning-mid)] text-white",
                )}
              >
                <Icon name={me?.paymentStatus === "paid" ? "checkCircle" : "alert"} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cx(
                    "text-md font-bold",
                    me?.paymentStatus === "paid" ? "text-success-fg" : "text-warning-fg",
                  )}
                >
                  {me?.paymentStatus === "paid" ? "You are paid up" : "Payment due"}
                </p>
                <p
                  className={cx(
                    "text-xs mt-0.5 opacity-85",
                    me?.paymentStatus === "paid" ? "text-success-fg" : "text-warning-fg",
                  )}
                >
                  {me?.ticketExpiry
                    ? `Class access runs to ${formatDate(me.ticketExpiry)}`
                    : "Settle to restore class access"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="eyebrow">Monthly</div>
                <div className="text-xl font-bold font-display tnum">{formatMoney(8500)}</div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader eyebrow="History" title="Your payments" />
            {payments.error ? (
              <ErrorState body={payments.error.message} onRetry={payments.reload} />
            ) : payments.loading ? (
              <SkeletonRows rows={4} />
            ) : history.length === 0 ? (
              <EmptyState
                art="inbox"
                title="No payments yet"
                body="Once you pay a fee it appears here with a receipt."
                className="py-10"
              />
            ) : (
            <ul className="divide-y divide-[var(--hairline)] border-t border-hairline">
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
        </div>

        <PayPanel />
      </div>
    </div>
  );
}
