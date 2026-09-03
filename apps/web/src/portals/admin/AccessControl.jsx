import { useCallback } from "react";
import { AccessMatrix } from "@/components/AccessMatrix";
import { PageHeader } from "@/components/ui/primitives";
import { accessApi } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Tenant Admin access control.

  Governs teacher, student and parent only. The admin role is absent on
  purpose: an admin editing their own access is how an organisation
  locks itself out of its own settings, and the server refuses it too.
*/
export default function AdminAccessControl() {
  const { org, reload } = useTheme();
  const { data, loading, error, reload: refetch } = useApi(
    () => accessApi.organisation(),
    [],
  );

  const save = useMutation(
    useCallback(
      async (changes) => {
        await accessApi.updateOrganisation(changes);
        await refetch();
        // The signed in user's own pageAccess may have changed, so the
        // session is refreshed and the nav re-renders immediately.
        await reload();
      },
      [refetch, reload],
    ),
  );

  const reset = useMutation(
    useCallback(async () => {
      await accessApi.resetOrganisation();
      await refetch();
      await reload();
    }, [refetch, reload]),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Organisation"
        title="Access control"
        sub="Choose which pages each role can open inside your organisation."
      />
      <AccessMatrix
        data={data}
        loading={loading}
        error={error}
        onReload={refetch}
        onSave={save.mutate}
        onReset={reset.mutate}
        saving={save.pending || reset.pending}
        packageTier={org?.packageTier}
        scopeNote={`Applies to everyone in ${org?.name ?? "this organisation"}`}
      />
    </div>
  );
}
