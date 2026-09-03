import { useMemo, useState } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/Icon";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { TIER_LABEL, hasFeature, requiredTier } from "@/lib/tiers";

/*
  Page access matrix.

  Shared by the tenant Admin screen and the LoopLab platform screen,
  because the two are the same interaction at different scopes. What
  differs is only which roles are editable and what the copy calls the
  scope, both passed in.

  Design decisions worth keeping:

    - Rows are pages, columns are roles. A page belongs to exactly one
      role in this product, so most cells are empty. Transposing it
      would give a wide sparse grid instead of a readable list.
    - Changes are staged, not saved per click. Turning off four pages is
      one decision, and four separate writes would produce four audit
      entries and four chances to half apply it.
    - A locked page renders as locked rather than being hidden, so an
      admin can see that Overview and Access control are deliberately
      always on rather than wondering why they are missing.
*/

const PORTAL_LABEL = {
  teacher: "Teacher portal",
  student: "Student portal",
  parent: "Parent portal",
  admin: "Admin portal",
  superadmin: "Platform console",
};

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative w-9 h-5.5 rounded-full shrink-0 transition-colors duration-[var(--dur-fast)]",
        disabled && "opacity-40 cursor-not-allowed",
        checked ? "bg-[var(--portal-accent)]" : "bg-ink-200",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 size-4.5 rounded-full bg-white shadow-[var(--shadow-xs)]",
          "transition-[left] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          checked ? "left-4" : "left-0.5",
        )}
      />
    </button>
  );
}

export function AccessMatrix({
  data,
  loading,
  error,
  onReload,
  onSave,
  onReset,
  saving,
  scopeNote,
  packageTier,
}) {
  const [staged, setStaged] = useState({});

  const grouped = useMemo(() => {
    if (!data) return [];
    const byPortal = {};
    for (const page of data.catalogue) {
      // Only pages belonging to a role this scope governs.
      const owning = page.roles.filter((r) => data.roles.includes(r));
      if (owning.length === 0) continue;
      (byPortal[page.portal] ??= []).push({ ...page, owning });
    }
    return Object.entries(byPortal);
  }, [data]);

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <SkeletonRows rows={8} />
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <ErrorState
          title="Could not load access settings"
          body={error.message}
          onRetry={onReload}
        />
      </Card>
    );
  }
  if (!data || grouped.length === 0) {
    return (
      <Card>
        <EmptyState
          art="list"
          title="Nothing to configure"
          body="No pages are governed at this scope."
        />
      </Card>
    );
  }

  const key = (role, pageKey) => `${role}::${pageKey}`;

  const valueFor = (role, pageKey) => {
    const k = key(role, pageKey);
    if (k in staged) return staged[k];
    return data.matrix[role]?.[pageKey] ?? false;
  };

  const stage = (role, pageKey, allowed) => {
    const k = key(role, pageKey);
    const original = data.matrix[role]?.[pageKey] ?? false;
    setStaged((s) => {
      const next = { ...s };
      // Toggling back to the original value un-stages it, so the dirty
      // count reflects real changes rather than clicks.
      if (allowed === original) delete next[k];
      else next[k] = allowed;
      return next;
    });
  };

  const changes = Object.entries(staged).map(([k, allowed]) => {
    const [role, pageKey] = k.split("::");
    return { role, pageKey, allowed };
  });

  const save = async () => {
    await onSave(changes.map((c) => ({ role: c.role, page_key: c.pageKey, allowed: c.allowed })));
    setStaged({});
  };

  return (
    <div className="space-y-4">
      {changes.length > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-[var(--portal-accent-soft)] border border-[var(--portal-accent)] px-4 py-3 animate-rise">
          <Icon name="alert" size={16} className="text-[var(--portal-accent)] shrink-0" />
          <p className="text-sm font-semibold text-[var(--portal-accent)] flex-1 min-w-0">
            {changes.length} unsaved {changes.length === 1 ? "change" : "changes"}.
            {changes.some((c) => !c.allowed) &&
              " Anyone currently on a page you switch off will be shown a notice."}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setStaged({})}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={save} loading={saving}>
            Apply changes
          </Button>
        </div>
      )}

      {grouped.map(([portal, pages]) => (
        <Card key={portal} className="overflow-hidden">
          <CardHeader
            eyebrow={PORTAL_LABEL[portal] ?? portal}
            title={`${pages.length} pages`}
            sub={scopeNote}
            action={
              <div className="hidden sm:flex items-center gap-4">
                {data.roles
                  .filter((r) => pages.some((p) => p.owning.includes(r)))
                  .map((role) => (
                    <span key={role} className="eyebrow capitalize">
                      {role}
                    </span>
                  ))}
              </div>
            }
          />
          <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
            {pages.map((page) => (
              <li
                key={page.key}
                className="flex items-center gap-4 px-5 py-3 hover:bg-ink-50/60 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{page.label}</span>
                    {page.locked && (
                      <Badge tone="neutral" icon="lock">
                        Always on
                      </Badge>
                    )}
                    {page.feature && (
                      <Badge tone="brand" icon="sparkle">
                        {TIER_LABEL[requiredTier(page.feature)]}
                      </Badge>
                    )}
                  </div>
                  <p className="text-2xs text-ink-500 mt-0.5 font-mono">{page.path}</p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {data.roles.map((role) => {
                    if (!page.owning.includes(role)) {
                      return <span key={role} className="w-9" aria-hidden="true" />;
                    }
                    const checked = valueFor(role, page.key);
                    const dirty = key(role, page.key) in staged;
                    /*
                      Only call it a plan limit when the tier genuinely
                      excludes the feature. A page the admin switched
                      off themselves must not be blamed on the plan,
                      which is what a naive "off and gated" check does.
                    */
                    const tierLocked =
                      page.feature &&
                      packageTier &&
                      !hasFeature(packageTier, page.feature);
                    return (
                      <span key={role} className="relative">
                        <Toggle
                          checked={checked}
                          disabled={page.locked || saving}
                          onChange={(v) => stage(role, page.key, v)}
                          label={`${page.label} for ${role}`}
                        />
                        {dirty && (
                          <span className="absolute -top-1 -right-1 size-2 rounded-full bg-[var(--warning-mid)]" />
                        )}
                        {tierLocked && (
                          <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] font-bold text-ink-400 whitespace-nowrap">
                            plan
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-2xs text-ink-500 max-w-xl leading-relaxed">
          Hiding a page is enforced on the server, not just in the menu. Someone with a direct
          link to a page you switch off is shown a notice rather than the page.
          {packageTier && (
            <>
              {" "}
              Pages marked with a plan badge stay unavailable on{" "}
              <span className="font-semibold">{TIER_LABEL[packageTier]}</span> regardless of this
              setting.
            </>
          )}
        </p>
        <Button variant="secondary" size="sm" onClick={onReset} disabled={saving}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
