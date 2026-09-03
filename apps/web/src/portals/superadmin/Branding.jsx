import { useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { AppIcon, BRAND_GRADIENT, BRAND_INK, BRAND_NODE } from "@/brand/Logo";
import { cx } from "@/lib/cx";
import { platformApi, uploadPlatformLogo } from "@/lib/api";
import { OrgLogo } from "@/components/ui/OrgLogo";
import { useTheme } from "@/theme/ThemeProvider";
import { TIER_LABEL, hasFeature } from "@/lib/tiers";
import { useApi, useMutation } from "@/lib/useApi";

/*
  Branding, from the platform side. Three separate things, and telling
  them apart is the whole point of the page.

  1. The company logo. LoopLab's own mark, uploaded, because the company
     operating an instance can change.

  2. The product identity. ClassConnect's mark, fixed, because it is the
     name of the software rather than of anyone running it. It is also
     what lets an operator with two tabs open tell the console from a
     tenant, so a Super Admin who could re-skin it would delete exactly
     that signal.

  These two were previously one read only block, which said the app's
  own mark was the company's. They are not the same thing.

  3. A support tool for setting a tenant's branding, because schools ask
     and the alternative is talking somebody through a colour picker
     over the phone. That is a cross tenant write, so the server guards
     it with require_platform_access rather than the role, and it writes
     an audit row into the tenant's own log naming the operator.
*/

const SWATCHES = [
  "#613380",
  "#2f6f6b",
  "#1f4f8f",
  "#2f7d4f",
  "#b4531f",
  "#33395e",
  "#8c2f4a",
  "#6f7a1f",
];

/*
  The company logo. Uploaded, because the company operating an instance
  can change and the product it operates cannot.
*/
function CompanyLogo() {
  const { org, reload } = useTheme();
  const picker = useRef(null);

  /*
    No local copy of whether there is a logo, and nothing to invalidate
    by hand. Reloading the session brings back a new logoVersion, that
    version is the cache key, so the new image is fetched because it is
    a different key rather than because somebody remembered to evict the
    old one.
  */
  const hasLogo = Boolean(org?.branding?.logoUrl);

  const upload = useMutation(async (file) => {
    await uploadPlatformLogo(file);
    await reload();
  });

  const drop = useMutation(async () => {
    await platformApi.removeLogo();
    await reload();
  });

  return (
    <Card className="mb-5">
      <CardHeader
        eyebrow="Your company"
        title="Company logo"
        sub="LoopLab's own mark, shown wherever the platform console identifies you."
        action={<Badge tone="brand">Yours to change</Badge>}
      />
      <div className="px-5 pb-5 flex flex-wrap items-center gap-5">
        <OrgLogo
          name={org?.branding?.logoText || org?.name || "LoopLab"}
          hasLogo={hasLogo}
          version={org?.branding?.logoVersion}
          size={64}
          radius="var(--radius-md)"
          className="text-lg text-white border border-hairline"
          style={{ background: "var(--brand-gradient)" }}
        />
        <div className="min-w-[220px] flex-1">
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f).catch(() => {});
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon="upload"
              size="sm"
              loading={upload.pending}
              onClick={() => picker.current?.click()}
            >
              {hasLogo ? "Replace company logo" : "Upload company logo"}
            </Button>
            {hasLogo && (
              <Button
                variant="ghost"
                size="sm"
                loading={drop.pending}
                onClick={() => drop.mutate().catch(() => {})}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-2xs text-ink-500 mt-1.5 leading-relaxed">
            {upload.error?.message ??
              drop.error?.message ??
              "PNG, JPG, WebP or GIF. No SVG: it is an XML document that can carry script, and this renders in the app's own chrome."}
          </p>
        </div>
      </div>
    </Card>
  );
}

/*
  The product's own mark, which is a different thing and is not
  uploaded. Shown rather than hidden, because "why can I not change
  this" is the obvious question and the answer is worth giving.
*/
function ProductIdentity() {
  return (
    <Card className="mb-5">
      <CardHeader
        eyebrow="The product"
        title="ClassConnect app identity"
        sub="The software's own mark. It ships with the build and is not uploaded."
        action={<Badge tone="neutral">Fixed</Badge>}
      />
      <div className="px-5 pb-5 flex flex-wrap items-center gap-6">
        <AppIcon size={64} />
        <div className="flex items-center gap-4">
          {[
            { label: "Ink", value: BRAND_INK },
            { label: "Node", value: BRAND_NODE },
            { label: "Gradient", value: BRAND_GRADIENT[0], to: BRAND_GRADIENT[1] },
          ].map((c) => (
            <div key={c.label}>
              <span
                className="block size-10 rounded-[var(--radius-sm)] border border-hairline"
                style={{
                  background: c.to
                    ? `linear-gradient(135deg, ${c.value}, ${c.to})`
                    : c.value,
                }}
              />
              <p className="text-2xs text-ink-500 mt-1.5">{c.label}</p>
              <p className="text-2xs font-mono text-ink-400">{c.value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-500 leading-relaxed flex-1 min-w-[240px]">
          This is the name of the software, not of the company running it, which is why it
          is separate from your company logo above. It is also fixed: a tenant re-skins
          their own portals and the console never follows, so an operator with two tabs
          open can always tell whose data they are about to change.
        </p>
      </div>
    </Card>
  );
}

function TenantBranding({ tenant, onSaved }) {
  const current = useApi(() => platformApi.readBranding(tenant.orgId), [tenant.orgId]);
  const [logoText, setLogoText] = useState(null);
  const [primary, setPrimary] = useState(null);

  const d = current.data;
  const text = logoText ?? d?.logoText ?? "";
  const colour = primary ?? d?.primaryColor ?? "";

  const mayBrand = hasFeature(tenant.packageTier, "branding_logo");

  const save = useMutation(async () => {
    const body = { logoText: text };
    if (mayBrand) body.primaryColor = colour || null;
    await platformApi.updateBranding(tenant.orgId, body);
    onSaved?.();
    current.reload();
    setLogoText(null);
    setPrimary(null);
  });

  if (current.loading) return <div className="h-40 rounded-[var(--radius-md)] skeleton" />;
  if (current.error)
    return <ErrorState body={current.error.message} onRetry={current.reload} />;

  const dirty = (logoText !== null && logoText !== d.logoText) ||
    (primary !== null && primary !== d.primaryColor);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex items-center justify-center size-12 rounded-[var(--radius-md)] shrink-0 font-display font-bold text-white"
          style={{ background: colour || "var(--ink-400)" }}
        >
          {(text || tenant.name).slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{tenant.name}</p>
          <p className="text-2xs text-ink-500">
            {TIER_LABEL[tenant.packageTier]} · {d.slug}.classconnect.app
          </p>
        </div>
      </div>

      <Field label="Display name" hint="What their students and parents see.">
        <Input
          value={text}
          onChange={(e) => setLogoText(e.target.value)}
          maxLength={60}
          placeholder={tenant.name}
        />
      </Field>

      {mayBrand ? (
        <Field label="Accent colour">
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPrimary(c)}
                aria-label={c}
                className={cx(
                  "size-8 rounded-[var(--radius-sm)] border-2 transition-transform",
                  colour?.toLowerCase() === c ? "border-ink-900 scale-110" : "border-hairline",
                )}
                style={{ background: c }}
              />
            ))}
            <Input
              value={colour}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="#613380"
              className="w-28 font-mono"
              maxLength={9}
            />
          </div>
        </Field>
      ) : (
        <p className="flex items-start gap-2 text-xs text-ink-600 bg-sunken rounded-[var(--radius-sm)] px-3 py-2.5">
          <Icon name="lock" size={13} className="shrink-0 mt-0.5" />
          Colours need Growth or above. On {TIER_LABEL[tenant.packageTier]} only the display
          name applies, and setting a colour here would be stored and then stripped on read.
        </p>
      )}

      {save.error && (
        <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
          <Icon name="alert" size={14} className="shrink-0 mt-px" />
          {save.error.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          loading={save.pending}
          disabled={!dirty}
          onClick={() => save.mutate().catch(() => {})}
        >
          Save for this tenant
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setLogoText(null);
              setPrimary(null);
            }}
          >
            Reset
          </Button>
        )}
      </div>

      <p className="flex items-start gap-2 text-2xs text-ink-500">
        <Icon name="shield" size={12} className="shrink-0 mt-0.5" />
        This writes an entry into the tenant's own audit log naming you. A customer has to
        be able to see that the vendor changed their branding.
      </p>
    </div>
  );
}

export default function PlatformBranding() {
  const tenants = useApi(() => platformApi.tenants(), []);
  const [selected, setSelected] = useState("");
  const rows = tenants.data ?? [];
  const tenant = rows.find((t) => t.orgId === selected);

  return (
    <div>
      <PageHeader
        eyebrow="LoopLab operations"
        title="Branding"
        sub="The platform's own identity, and a support tool for setting a tenant's."
      />

      <CompanyLogo />
      <ProductIdentity />

      <Card>
        <CardHeader
          eyebrow="Support"
          title="Set a tenant's branding"
          sub="For a school that has asked you to do it for them."
          action={
            <Select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-56"
            >
              <option value="">Choose a tenant</option>
              {rows.map((t) => (
                <option key={t.orgId} value={t.orgId}>
                  {t.name}
                </option>
              ))}
            </Select>
          }
        />
        <div className="px-5 pb-5">
          {tenants.error ? (
            <ErrorState body={tenants.error.message} onRetry={tenants.reload} />
          ) : tenants.loading ? (
            <SkeletonRows rows={3} />
          ) : !tenant ? (
            <EmptyState
              art="list"
              title="Pick a tenant"
              body="Choose an organisation above to see and change how their portals look."
              className="py-8"
            />
          ) : (
            <TenantBranding tenant={tenant} onSaved={tenants.reload} />
          )}
        </div>
      </Card>
    </div>
  );
}
