import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";
import { batchApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Batches and the groups inside them.

  This screen exists because a batch used to be a string somebody typed
  onto a student record. The filter list on the Students page was built
  by collecting the distinct values already on the roll, which meant
  "2026 A/L" and "2026 A/l" were two different batches and nobody found
  out until a register came up half empty.

  It sits under Admin rather than Teacher on purpose. A batch is
  organisational structure: it outlives any one teacher, the timetable
  and the register are built on it, and two people inventing their own
  spelling is exactly the failure this fixes. Teachers read the list and
  assign students into it, which is the part they actually need.

  Groups live inside a batch rather than in a list of their own, because
  "Batch A" of the 2026 cohort has nothing to do with "Batch A" of 2027.
*/

function GroupEditor({ groups, onChange, disabled }) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (groups.some((g) => g.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...groups, name]);
    setDraft("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {groups.map((g) => (
          <span
            key={g}
            className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-[var(--radius-pill)] bg-sunken border border-hairline text-xs font-semibold"
          >
            {g}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(groups.filter((x) => x !== g))}
                aria-label={`Remove ${g}`}
                className="size-4 inline-flex items-center justify-center rounded-full text-ink-400 hover:bg-danger-bg hover:text-danger-fg"
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </span>
        ))}
        {groups.length === 0 && (
          <span className="text-2xs text-ink-500">No groups. The batch works without them.</span>
        )}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Batch A"
            className="flex-1"
          />
          <Button variant="secondary" icon="plus" onClick={add} disabled={!draft.trim()}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function BatchRow({ batch, onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(batch.name);
  const [year, setYear] = useState(batch.year ?? "");
  const [groups, setGroups] = useState(batch.groups);

  const save = useMutation(async () => {
    await batchApi.update(batch.batchId, {
      name: name.trim(),
      year: year === "" ? null : Number(year),
      groups,
    });
    setOpen(false);
    onSaved();
  });

  const archive = useMutation(async () => {
    await batchApi.update(batch.batchId, { isActive: !batch.isActive });
    onSaved();
  });

  const remove = useMutation(async () => {
    await batchApi.remove(batch.batchId);
    onSaved();
  });

  return (
    <li className={cx("px-5 py-3.5", !batch.isActive && "opacity-60")}>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center size-9 rounded-[var(--radius-sm)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] shrink-0">
          <Icon name="students" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate">{batch.name}</p>
            {!batch.isActive && <Badge tone="neutral">Archived</Badge>}
          </div>
          <p className="text-2xs text-ink-500 truncate">
            {batch.students} student{batch.students === 1 ? "" : "s"}
            {batch.groups.length > 0 && ` · ${batch.groups.join(", ")}`}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Edit"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 pl-12 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Name" required className="sm:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Year">
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="2026"
                maxLength={4}
                inputMode="numeric"
              />
            </Field>
          </div>

          <Field
            label="Groups"
            hint="Renaming a batch moves its students with it. Removing a group does not."
          >
            <GroupEditor groups={groups} onChange={setGroups} />
          </Field>

          {(save.error || archive.error || remove.error) && (
            <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
              <Icon name="alert" size={14} className="shrink-0 mt-px" />
              {(save.error || archive.error || remove.error).message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={save.pending}
              disabled={!name.trim()}
              onClick={() => save.mutate().catch(() => {})}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={archive.pending}
              onClick={() => archive.mutate().catch(() => {})}
            >
              {batch.isActive ? "Archive" : "Restore"}
            </Button>
            {batch.students === 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-fg ml-auto"
                loading={remove.pending}
                onClick={() => remove.mutate().catch(() => {})}
              >
                Delete
              </Button>
            )}
          </div>
          {batch.students > 0 && (
            <p className="text-2xs text-ink-500">
              A batch with students in it cannot be deleted. Archive it instead, which keeps
              its attendance and results.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function NewBatch({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [groups, setGroups] = useState([]);

  const create = useMutation(async () => {
    await batchApi.create({
      name: name.trim(),
      year: year === "" ? null : Number(year),
      groups,
    });
    setName("");
    setYear("");
    setGroups([]);
    setOpen(false);
    onCreated();
  });

  if (!open) {
    return (
      <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
        New batch
      </Button>
    );
  }

  return (
    <Card className="mb-5">
      <CardHeader
        eyebrow="New"
        title="Add a batch"
        sub="A cohort your students belong to, like an intake year."
      />
      <div className="px-5 pb-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Name" required className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2026 A/L"
              maxLength={60}
              autoFocus
            />
          </Field>
          <Field label="Year">
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="2026"
              maxLength={4}
              inputMode="numeric"
            />
          </Field>
        </div>
        <Field label="Groups" hint="Optional. Split a large batch into teaching groups.">
          <GroupEditor groups={groups} onChange={setGroups} />
        </Field>
        {create.error && (
          <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
            <Icon name="alert" size={14} className="shrink-0 mt-px" />
            {create.error.message}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={create.pending}
            disabled={!name.trim()}
            onClick={() => create.mutate().catch(() => {})}
          >
            Create batch
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function Batches() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, reload } = useApi(
    () => batchApi.list(showArchived),
    [showArchived],
  );
  const batches = data ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Organisation"
        title="Batches and groups"
        sub="The cohorts your students belong to. Teachers assign students into these."
        actions={<NewBatch onCreated={reload} />}
      />

      <Card className="overflow-hidden">
        <CardHeader
          eyebrow="Cohorts"
          title={`${batches.filter((b) => b.isActive).length} active`}
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
          }
        />
        {error ? (
          <ErrorState body={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={3} />
        ) : batches.length === 0 ? (
          <EmptyState
            art="list"
            title="No batches yet"
            body="Create one, and your teachers can start assigning students to it."
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {batches.map((b) => (
              <BatchRow key={b.batchId} batch={b} onSaved={reload} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
