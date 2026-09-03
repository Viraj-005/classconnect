import { Link } from "react-router-dom";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  IconChip,
  Metric,
  PageHeader,
  Progress,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SeatCapNotice, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, formatDate, formatMoney, relativeTime } from "@/lib/cx";
import { FreePlanCard } from "@/components/ui/FreePlan";
import { TIER_LABEL, isFree } from "@/lib/tiers";
import { adminApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Tenant admin overview.

  Deliberately operational rather than academic. An admin cares about
  seats, people, billing and anything unusual in the log. Teaching
  metrics belong to the teacher portal and are not repeated here, which
  is what keeps the two roles distinguishable.
*/

const SEVERITY_TONE = { info: "neutral", warning: "warning", critical: "danger" };

function SeatMeter({ label, seat, icon }) {
  if (!seat) return null;
  const unlimited = seat.cap === null;
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon name={icon} size={15} className="text-ink-500" />
          {label}
        </span>
        <span
          className={cx(
            "text-xs font-bold tnum",
            seat.atCap ? "text-danger-fg" : seat.nearingCap ? "text-warning-fg" : "text-ink-600",
          )}
        >
          {unlimited ? `${seat.used} of unlimited` : `${seat.used} of ${seat.cap}`}
        </span>
      </div>
      <Progress
        value={unlimited ? 100 : seat.pct}
        height={7}
        tone={
          seat.atCap
            ? "var(--danger-mid)"
            : seat.nearingCap
              ? "var(--warning-mid)"
              : undefined
        }
      />
    </div>
  );
}

export default function AdminOverview() {
  const { org } = useTheme();
  const overview = useApi(() => adminApi.overview(), []);
  const people = useApi(() => adminApi.people(), []);
  const audit = useApi(() => adminApi.audit({ limit: 5 }), []);

  if (overview.error) {
    return (
      <Card>
        <ErrorState
          title="Could not load your organisation"
          body={overview.error.message}
          onRetry={overview.reload}
        />
      </Card>
    );
  }

  const d = overview.data;
  const seats = d?.seats;
  const activePeople = (people.data ?? []).filter((p) => p.status === "active");
  const invited = (people.data ?? []).filter((p) => p.status === "invited").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Organisation"
        title={org?.name ?? "Overview"}
        sub={
          d?.org
            ? `On ${TIER_LABEL[d.org.packageTier]} since ${formatDate(d.org.createdAt)}.`
            : "Loading"
        }
        actions={
          <>
            <Link to="/admin/users">
              <Button variant="secondary" icon="plus">
                Invite people
              </Button>
            </Link>
            <Link to="/admin/billing">
              <Button variant="primary" icon="card">
                Manage plan
              </Button>
            </Link>
          </>
        }
      />

      {(seats?.students?.nearingCap || seats?.teachers?.nearingCap) && (
        <SeatCapNotice
          kind={seats.students.nearingCap ? "Student" : "Teacher"}
          used={seats.students.nearingCap ? seats.students.used : seats.teachers.used}
          cap={seats.students.nearingCap ? seats.students.cap : seats.teachers.cap}
        />
      )}

      <Card className="overflow-hidden">
        {overview.loading ? (
          <SkeletonRows rows={2} />
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-4 rule-grid divide-y xl:divide-y-0 divide-[var(--hairline)]">
            <Metric
              icon="students"
              tone="brand"
              label="Students"
              value={seats?.students?.used ?? 0}
              sub={
                seats?.students?.cap
                  ? `${seats.students.used} of ${seats.students.cap}`
                  : "unlimited"
              }
            />
            <Metric
              icon="user"
              tone="info"
              label="Teachers"
              value={seats?.teachers?.used ?? 0}
              sub={
                seats?.teachers?.cap
                  ? `${seats.teachers.used} of ${seats.teachers.cap}`
                  : "unlimited"
              }
            />
            <Metric
              icon="card"
              tone="success"
              label="Plan cost"
              value={formatMoney(d?.planCost ?? 0)}
              sub="per month"
            />
            <Metric
              icon="shield"
              tone={d?.flaggedEvents ? "warning" : "neutral"}
              label="Flagged events"
              value={d?.flaggedEvents ?? 0}
              sub="in the audit log"
            />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Card>
            <CardHeader
              eyebrow="People"
              title="Recently active"
              sub={`${activePeople.length} active, ${invited} invited`}
              action={
                <Link to="/admin/users">
                  <Button size="sm" variant="ghost" iconRight="chevronRight">
                    Manage
                  </Button>
                </Link>
              }
            />
            {people.loading ? (
              <SkeletonRows rows={5} />
            ) : activePeople.length === 0 ? (
              <EmptyState
                art="list"
                title="Nobody here yet"
                body="Invite teachers and admins to get the organisation running."
                className="py-10"
              />
            ) : (
              <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
                {activePeople.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={p.name} size={32} online />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{p.name}</p>
                      <p className="text-2xs text-ink-500 truncate">{p.subjects || p.email}</p>
                    </div>
                    <Badge tone={p.role === "admin" ? "brand" : "neutral"} className="capitalize">
                      {p.role}
                    </Badge>
                    <span className="text-2xs text-ink-400 w-16 text-right shrink-0">
                      {p.lastSeen ? relativeTime(p.lastSeen) : "never"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              eyebrow="Audit"
              title="Recent activity"
              sub="Payment approvals, access attempts and account changes"
              action={
                <Link to="/admin/logs">
                  <Button size="sm" variant="ghost" iconRight="chevronRight">
                    Full log
                  </Button>
                </Link>
              }
            />
            {audit.loading ? (
              <SkeletonRows rows={5} />
            ) : (audit.data ?? []).length === 0 ? (
              <EmptyState
                art="inbox"
                title="Nothing logged yet"
                body="Approvals, role changes and access attempts show up here."
                className="py-10"
              />
            ) : (
              <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
                {(audit.data ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-3.5 px-5 py-3">
                    <IconChip
                      icon={
                        a.severity === "critical"
                          ? "alert"
                          : a.severity === "warning"
                            ? "shield"
                            : "check"
                      }
                      tone={SEVERITY_TONE[a.severity]}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{a.action}</p>
                      <p className="text-2xs text-ink-500 truncate">
                        {a.actorLabel}
                        {a.target ? ` · ${a.target}` : ""}
                      </p>
                    </div>
                    <span className="text-2xs text-ink-400 shrink-0">
                      {relativeTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader eyebrow="Capacity" title="Seat usage" sub="Against your plan limits" />
            <div className="px-5 pb-5 divide-y divide-[var(--hairline)]">
              <SeatMeter label="Students" seat={seats?.students} icon="students" />
              <SeatMeter label="Teachers" seat={seats?.teachers} icon="user" />
            </div>
          </Card>

          {/*
            A tenant on Free gets the plan surface built for them: seat
            headroom, what they have already built, and what one step up
            buys. Everyone else gets the plain summary, because a paying
            tenant does not need to be sold the thing they bought.
          */}
          {isFree(d?.org?.packageTier) ? (
            <FreePlanCard
              students={d?.seats?.students?.used}
              teachers={d?.seats?.teachers}
              collected={d?.payments?.collected}
              contentCount={d?.content?.total}
            />
          ) : (
          <Card>
            <CardHeader
              eyebrow="Plan"
              title={d?.org ? `${TIER_LABEL[d.org.packageTier]} plan` : "Plan"}
            />
            <div className="px-5 pb-5">
              <DataRow
                label="Billing"
                value={(d?.org?.billingStatus ?? "").replace("_", " ")}
                icon="card"
              />
              <DataRow label="Monthly" value={formatMoney(d?.planCost ?? 0)} icon="wallet" />
              <DataRow
                label="Domain"
                value={d?.org?.customDomain ?? `${d?.org?.slug ?? ""}.classconnect.app`}
                icon="building"
              />
              <Link to="/admin/billing">
                <Button variant="secondary" block className="mt-3">
                  Change plan
                </Button>
              </Link>
            </div>
          </Card>
          )}

          <Card>
            <CardHeader eyebrow="Health" title="This organisation" />
            <div className="px-5 pb-5">
              <DataRow
                label="Fees collected"
                value={formatMoney(d?.payments?.collected ?? 0)}
                icon="wallet"
              />
              <DataRow
                label="Outstanding"
                value={formatMoney(d?.payments?.outstanding ?? 0)}
                icon="clock"
              />
              <DataRow
                label="Collection rate"
                value={`${d?.payments?.collectionRate ?? 0}%`}
                icon="chart"
              />
              <DataRow label="People" value={d?.people?.total ?? 0} icon="students" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
