import { useCallback, useState } from "react";
import { AccessMatrix } from "@/components/AccessMatrix";
import { Card, PageHeader, Select } from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { accessApi, platformApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Platform access control.

  Two scopes in one screen. With no tenant selected this edits the
  platform default, which is the ceiling every tenant sits under. Pick a
  tenant and it edits that tenant's own overrides, which is the same
  thing their admin sees.

  A tenant admin can only narrow what is set here, never widen it, which
  is why this screen governs the admin role too and theirs does not.
*/
export default function PlatformAccessControl() {
  const [orgId, setOrgId] = useState("");

  const tenants = useApi(() => platformApi.tenants(), []);
  const { data, loading, error, reload: refetch } = useApi(
    () => accessApi.platform(orgId || undefined),
    [orgId],
  );

  const save = useMutation(
    useCallback(
      async (changes) => {
        await accessApi.updatePlatform(changes, orgId || undefined);
        await refetch();
      },
      [orgId, refetch],
    ),
  );

  const reset = useMutation(
    useCallback(async () => {
      await accessApi.resetPlatform(orgId || undefined);
      await refetch();
    }, [orgId, refetch]),
  );

  const editingPlatform = !orgId;

  return (
    <div>
      <PageHeader
        eyebrow="LoopLab operations"
        title="Access control"
        sub="Set what every tenant can reach, or narrow it for one of them."
        actions={
          <Select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="w-56"
          >
            <option value="">Platform defaults, all tenants</option>
            {(tenants.data ?? []).map((t) => (
              <option key={t.orgId} value={t.orgId}>
                {t.name}
              </option>
            ))}
          </Select>
        }
      />

      <Card className="mb-5">
        <div className="flex items-start gap-3 px-5 py-4">
          <Icon
            name={editingPlatform ? "building" : "shield"}
            size={18}
            className="text-[var(--portal-accent)] shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {editingPlatform
                ? "Editing the platform ceiling"
                : `Editing ${data?.orgName ?? "one tenant"}`}
            </p>
            <p className="text-xs text-ink-500 mt-0.5 leading-relaxed">
              {editingPlatform
                ? "A page switched off here is unavailable to every tenant, and their admins cannot turn it back on."
                : "This narrows one tenant only. It is recorded in their audit log as a cross tenant change."}
            </p>
          </div>
        </div>
      </Card>

      <AccessMatrix
        data={data}
        loading={loading}
        error={error}
        onReload={refetch}
        onSave={save.mutate}
        onReset={reset.mutate}
        saving={save.pending || reset.pending}
        packageTier={data?.packageTier}
        scopeNote={editingPlatform ? "Applies to every tenant" : `Applies to ${data?.orgName}`}
      />
    </div>
  );
}
