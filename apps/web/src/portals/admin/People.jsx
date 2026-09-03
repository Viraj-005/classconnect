import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  IconButton,
  Input,
  PageHeader,
  SearchInput,
  Select,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SeatCapNotice, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, relativeTime } from "@/lib/cx";
import { seatUsage } from "@/lib/tiers";
import { useTheme } from "@/theme/ThemeProvider";
import { adminApi, exportApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useDebounced } from "@/lib/useDebounced";

/*
  Tenant user management.

  Roles are the whole point of this screen, so the role selector is
  inline in each row rather than hidden behind a detail drawer. Changing
  someone from teacher to admin is the single most consequential action
  here, so it is also the one that asks for confirmation.
*/

const STATUS_TONE = { active: "success", invited: "info", disabled: "neutral" };
const ROLES = ["admin", "teacher", "student", "parent"];

function InvitePanel({ onClose, atCap }) {
  return (
    <Card className="mb-5">
      <CardHeader
        eyebrow="Invite"
        title="Add someone to this organisation"
        action={
          <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
            Close
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {atCap && (
          <div className="mb-4">
            <SeatCapNotice kind="Teacher" used={5} cap={5} icon="user" />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Email" required className="sm:col-span-2">
            <Input type="email" placeholder="name@school.lk" />
          </Field>
          <Field label="Role" required>
            <Select defaultValue="teacher">
              {ROLES.map((r) => (
                <option key={r} value={r} className="capitalize">
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Button variant="primary" icon="mail" disabled={atCap}>
            Send invite
          </Button>
          <Button variant="secondary" icon="upload">
            Bulk import CSV
          </Button>
        </div>
        <p className="text-2xs text-ink-500 mt-3 flex items-start gap-1.5 leading-relaxed">
          <Icon name="shield" size={12} className="shrink-0 mt-0.5" />
          Invited people join this organisation only. They cannot see any other tenant's data.
        </p>
      </div>
    </Card>
  );
}

export default function People() {
  const { org } = useTheme();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);

  const debounced = useDebounced(query, 250);
  const { data, loading, error, reload } = useApi(
    () => adminApi.people({ q: debounced }),
    [debounced],
  );
  const people = data ?? [];

  const changeRoleFor = useMutation(async (id, role) => {
    await adminApi.changeRole(id, role);
    await reload();
  });

  const teachers = org ? seatUsage(org.packageTier, org.seats.teachers, "teachers") : null;

  const rows = useMemo(
    () => people.filter((p) => tab === "all" || p.role === tab || p.status === tab),
    [people, tab],
  );

  const counts = {
    all: people.length,
    teacher: people.filter((p) => p.role === "teacher").length,
    admin: people.filter((p) => p.role === "admin").length,
    invited: people.filter((p) => p.status === "invited").length,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Organisation"
        title="People"
        sub="Everyone with access to this organisation, and what they can do."
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={() => exportApi.people()}>
            Export list
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>
              Invite
            </Button>
          </>
        }
      />

      {inviting && <InvitePanel onClose={() => setInviting(false)} atCap={teachers?.atCap} />}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name or email"
            className="flex-1 min-w-[220px]"
          />
          <span className="text-xs text-ink-500 tnum">
            {teachers?.label ?? ""} teacher seats used
          </span>
        </div>

        {changeRoleFor.error && (
          <div className="mx-3 mb-2 rounded-[var(--radius-sm)] bg-danger-bg px-3 py-2.5">
            <p className="text-xs text-danger-fg">{changeRoleFor.error.message}</p>
          </div>
        )}

        <Tabs
          value={tab}
          onChange={setTab}
          className="px-3"
          items={[
            { value: "all", label: "Everyone", count: counts.all },
            { value: "teacher", label: "Teachers", count: counts.teacher },
            { value: "admin", label: "Admins", count: counts.admin },
            { value: "invited", label: "Pending", count: counts.invited },
          ]}
        />

        {error ? (
          <ErrorState body={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            art="list"
            title="Nobody matches"
            body="Try a different search, or invite someone new to this organisation."
            action={
              <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>
                Invite someone
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-hairline bg-sunken">
                  {["Person", "Role", "Status", "Teaches", "Last seen", ""].map((h) => (
                    <th key={h} className="eyebrow text-left px-5 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className={cx(
                      "transition-colors hover:bg-ink-50/60",
                      p.status === "disabled" && "opacity-55",
                    )}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={p.name} size={32} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{p.name}</p>
                          <p className="text-2xs text-ink-500 truncate">{p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Select
                        value={p.role}
                        onChange={(e) => changeRoleFor.mutate(p.id, e.target.value)}
                        disabled={p.status === "disabled" || changeRoleFor.pending}
                        className="w-32 h-8 text-xs"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} className="capitalize">
                            {r}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[p.status]} dot className="capitalize">
                        {p.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-xs max-w-[180px] truncate">
                      {p.subjects ? (
                        <span className="text-ink-600">{p.subjects}</span>
                      ) : (
                        <span className="text-ink-400">Not assigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-2xs text-ink-500 whitespace-nowrap">
                      {p.lastSeen ? relativeTime(p.lastSeen) : "Never signed in"}
                    </td>
                    <td className="px-5 py-3">
                      <IconButton icon="more" label={`Actions for ${p.name}`} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
