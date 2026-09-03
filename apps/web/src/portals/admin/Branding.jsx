import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  IconChip,
  Input,
  PageHeader,
  Progress,
} from "@/components/ui/primitives";
import { UpgradeGate } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { LogoMark } from "@/brand/Logo";
import { EngagementArea } from "@/components/charts";
import { cx } from "@/lib/cx";
import { TIER_LABEL, requiredTier } from "@/lib/tiers";
import { useTheme } from "@/theme/ThemeProvider";
import { buildRamp, contrastRatio, isValidHex, readableOn } from "@/theme/color";
import { adminApi, uploadOrgLogo } from "@/lib/api";
import { OrgLogo } from "@/components/ui/OrgLogo";
import { useMutation } from "@/lib/useApi";

/*
  Tenant branding.

  This is the theming spike the handover asked to prototype early. It
  proves the whole token approach: pick a colour, the ramp regenerates,
  every component follows, and nothing in the layout moves. If this
  screen works, tenant theming works everywhere.

  Two safeguards that matter more than they look:
    - The contrast readout is live. A tenant picking a pale accent sees
      the failing ratio before they save, not after their staff cannot
      read any buttons.
    - Preview is applied to the real components below, not to a mock.
      A swatch grid would prove nothing.
*/

const PRESETS = [
  { name: "LoopLab plum", hex: "#613380" },
  { name: "Deep teal", hex: "#2f6f6b" },
  { name: "Oxford blue", hex: "#1f4f8f" },
  { name: "Forest", hex: "#2f6b3f" },
  { name: "Clay", hex: "#a3512f" },
  { name: "Ink", hex: "#33384f" },
  { name: "Wine", hex: "#7a2f45" },
  { name: "Moss", hex: "#5f6b2f" },
];

function ContrastReadout({ hex }) {
  const fg = readableOn(hex);
  const ratio = contrastRatio(hex, fg);
  const passesAa = ratio >= 4.5;
  const passesAaLarge = ratio >= 3;

  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 border",
        passesAa
          ? "bg-success-bg border-[color-mix(in_srgb,var(--success-mid)_25%,transparent)]"
          : passesAaLarge
            ? "bg-warning-bg border-[color-mix(in_srgb,var(--warning-mid)_25%,transparent)]"
            : "bg-danger-bg border-[color-mix(in_srgb,var(--danger-mid)_25%,transparent)]",
      )}
    >
      <span
        className="inline-flex items-center justify-center size-10 rounded-[var(--radius-sm)] text-xs font-bold shrink-0"
        style={{ background: hex, color: fg }}
      >
        Aa
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            "text-sm font-bold",
            passesAa ? "text-success-fg" : passesAaLarge ? "text-warning-fg" : "text-danger-fg",
          )}
        >
          {passesAa
            ? "Passes AA"
            : passesAaLarge
              ? "Passes for large text only"
              : "Fails contrast"}
        </p>
        <p
          className={cx(
            "text-2xs opacity-85",
            passesAa ? "text-success-fg" : passesAaLarge ? "text-warning-fg" : "text-danger-fg",
          )}
        >
          {ratio.toFixed(2)} to 1 against {fg === "#ffffff" ? "white" : "dark"} labels.
          {!passesAa && " Pick something a shade darker."}
        </p>
      </div>
    </div>
  );
}

function RampStrip({ hex }) {
  const ramp = buildRamp(hex);
  return (
    <div>
      <div className="eyebrow mb-2">Generated ramp</div>
      <div className="flex rounded-[var(--radius-sm)] overflow-hidden border border-hairline">
        {Object.entries(ramp).map(([stop, value]) => (
          <div key={stop} className="flex-1 group relative" title={`${stop}: ${value}`}>
            <div className="h-11" style={{ background: value }} />
            <span className="block text-[9px] font-bold text-ink-500 text-center py-1 tnum">
              {stop}
            </span>
          </div>
        ))}
      </div>
      <p className="text-2xs text-ink-500 mt-2 leading-relaxed">
        Only the 600 stop is stored. The rest is derived at runtime, which is why a tenant supplies
        one colour rather than ten.
      </p>
    </div>
  );
}

/*
  Fixed series for the preview chart. This one is genuinely static:
  it exists only to show that chart colours follow the accent, so
  real data would add a request and make the comparison noisier.
*/
const PREVIEW_SERIES = [
  { label: "Mon", value: 182 },
  { label: "Tue", value: 214 },
  { label: "Wed", value: 246 },
  { label: "Thu", value: 198 },
  { label: "Fri", value: 271 },
  { label: "Sat", value: 312 },
  { label: "Sun", value: 168 },
];

/* The live proof. Real components, current theme, no mockups. */
function LivePreview() {
  return (
    <Card>
      <CardHeader
        eyebrow="Live"
        title="How it looks"
        sub="Real components, re-rendered as you change the colour"
      />
      <div className="px-5 pb-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary action</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="secondary">Secondary</Button>
          <Badge tone="brand" dot>
            Badge
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <IconChip icon="video" tone="brand" size="lg" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Integration by parts</p>
            <div className="flex items-center gap-2 mt-1.5">
              <Progress value={68} height={6} />
              <span className="text-2xs font-bold tnum">68%</span>
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-hairline p-3">
          <div className="eyebrow mb-2">Charts follow too</div>
          <EngagementArea data={PREVIEW_SERIES} height={132} />
        </div>

        <div
          className="rounded-[var(--radius-md)] p-4 text-[var(--brand-contrast)]"
          style={{ background: "var(--brand-gradient)" }}
        >
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} tone="current" />
            <div>
              <p className="text-sm font-bold">Gradient surfaces</p>
              <p className="text-2xs opacity-85">Label colour is picked for contrast, not assumed</p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Branding() {
  const { org, can, previewAccent, reload } = useTheme();
  const [hex, setHex] = useState(org?.branding?.primaryColor ?? "#613380");
  const [logoText, setLogoText] = useState(org?.branding?.logoText ?? "");
  const [domain, setDomain] = useState(org?.branding?.customDomain ?? "");
  const [dirty, setDirty] = useState(false);

  /* The logo lives behind an authenticated endpoint, so it cannot be a
     plain <img src>. OrgLogo does that fetch and caches it, keyed on the
     version the session carries, which is the same component and the
     same cache the sidebar uses. This page used to hold its own copy of
     that logic and its own idea of whether a logo existed, and the two
     could disagree after an upload. Reloading the session is now the
     only thing either of them needs. */
  const logoPicker = useRef(null);
  const hasLogo = Boolean(org?.branding?.logoUrl);

  const uploadLogo = useMutation(async (file) => {
    await uploadOrgLogo(file);
    await reload();
  });

  const dropLogo = useMutation(async () => {
    await adminApi.removeLogo();
    await reload();
  });

  const valid = isValidHex(hex);

  const apply = (value) => {
    setHex(value);
    setDirty(true);
    if (isValidHex(value)) previewAccent(value.startsWith("#") ? value : `#${value}`);
  };

  const save = useMutation(async () => {
    await adminApi.updateBranding({
      primaryColor: hex,
      logoText,
      customDomain: can("custom_domain") ? domain || null : undefined,
    });
    previewAccent(null);
    setDirty(false);
    /* Re-read the session so the saved branding is what paints the
       page, rather than leaving the preview standing in for it. */
    await reload();
  });

  const reset = () => {
    previewAccent(null);
    setHex(org?.branding?.primaryColor ?? "#613380");
    setLogoText(org?.branding?.logoText ?? "");
    setDirty(false);
  };

  if (!can("branding_logo")) {
    return (
      <div>
        <PageHeader
          eyebrow="Organisation"
          title="Branding"
          sub="Make ClassConnect look like your school."
        />
        <UpgradeGate
          feature="branding_logo"
          preview={
            <div className="p-5 grid grid-cols-2 gap-4">
              <div className="space-y-3">
                {PRESETS.slice(0, 4).map((p) => (
                  <div key={p.hex} className="flex items-center gap-3">
                    <span className="size-9 rounded-[10px]" style={{ background: p.hex }} />
                    <span className="text-sm font-semibold">{p.name}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-[var(--radius-md)] bg-sunken" />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Organisation"
        title="Branding"
        sub="One colour drives the whole interface. Charts, buttons and gradients all follow."
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={reset}>
                Discard
              </Button>
            )}
            <Button
              variant="primary"
              onClick={save.mutate}
              loading={save.pending}
              disabled={!valid || !dirty}
            >
              {dirty ? "Save branding" : "Saved"}
            </Button>
          </>
        }
      />

      {save.error && (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-danger-bg border border-[color-mix(in_srgb,var(--danger-mid)_25%,transparent)] px-4 py-2.5 mb-5">
          <Icon name="alert" size={16} className="text-danger-fg shrink-0" />
          <p className="text-sm text-danger-fg flex-1">{save.error.message}</p>
        </div>
      )}

      {dirty && (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-info-bg border border-[color-mix(in_srgb,var(--info-mid)_25%,transparent)] px-4 py-2.5 mb-5">
          <Icon name="sparkle" size={16} className="text-info-fg shrink-0" />
          <p className="text-sm text-info-fg flex-1">
            <span className="font-bold">Previewing.</span> Nobody else sees this until you save.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Card>
            <CardHeader eyebrow="Colour" title="Accent" sub="Used for primary actions, highlights and chart series" />
            <div className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {PRESETS.map((p) => {
                  const active = p.hex.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={p.hex}
                      onClick={() => apply(p.hex)}
                      title={p.name}
                      className={cx(
                        "relative aspect-square rounded-[var(--radius-md)] transition-transform duration-[var(--dur-fast)]",
                        "hover:scale-105",
                        active && "ring-2 ring-offset-2 ring-[var(--ink-950)]",
                      )}
                      style={{ background: p.hex }}
                    >
                      {active && (
                        <Icon
                          name="check"
                          size={16}
                          strokeWidth={2.6}
                          className="absolute inset-0 m-auto"
                          style={{ color: readableOn(p.hex) }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Field label="Custom hex" className="flex-1 min-w-[180px]">
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={valid ? (hex.startsWith("#") ? hex : `#${hex}`) : "#613380"}
                      onChange={(e) => apply(e.target.value)}
                      className="size-9.5 rounded-[var(--radius-sm)] border border-hairline cursor-pointer bg-surface p-0.5"
                      aria-label="Pick accent colour"
                    />
                    <Input
                      value={hex}
                      onChange={(e) => apply(e.target.value)}
                      placeholder="#613380"
                      className={cx(!valid && "border-[var(--danger-mid)]")}
                    />
                  </div>
                </Field>
              </div>
              {!valid && (
                <p className="text-2xs text-danger-fg -mt-2">
                  That is not a valid hex colour. Use three or six characters, for example #613380.
                </p>
              )}

              {valid && <ContrastReadout hex={hex.startsWith("#") ? hex : `#${hex}`} />}
              {valid && <RampStrip hex={hex.startsWith("#") ? hex : `#${hex}`} />}
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Identity" title="Logo and name" />
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-center gap-4">
                <OrgLogo
                  name={logoText || org?.name}
                  hasLogo={hasLogo}
                  version={org?.branding?.logoVersion}
                  size={56}
                  radius="var(--radius-md)"
                  className="text-[var(--brand-contrast)]"
                  style={{ background: "var(--brand-gradient)" }}
                />
                <div className="flex-1">
                  {/*
                    SVG is deliberately absent from the accepted list.
                    It is an XML document that can carry script, and a
                    logo renders in the app's own chrome on every page,
                    which is the last place to accept one.
                  */}
                  <input
                    ref={logoPicker}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo.mutate(f).catch(() => {});
                      e.target.value = "";
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      icon="upload"
                      size="sm"
                      loading={uploadLogo.pending}
                      onClick={() => logoPicker.current?.click()}
                    >
                      {hasLogo ? "Replace logo" : "Upload a logo"}
                    </Button>
                    {hasLogo && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={dropLogo.pending}
                        onClick={() => dropLogo.mutate().catch(() => {})}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-2xs text-ink-500 mt-1.5">
                    {uploadLogo.error?.message ??
                      dropLogo.error?.message ??
                      "PNG, JPG, WebP or GIF, at least 128 by 128. Until then the initials are used."}
                  </p>
                </div>
              </div>

              <Field label="Display name" hint="Shown in the sidebar and on emails to parents.">
                <Input
                  value={logoText}
                  onChange={(e) => {
                    setLogoText(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>

              <Field
                label="Custom domain"
                hint={
                  can("custom_domain")
                    ? "Point a CNAME at cname.classconnect.app, then enter the host here."
                    : `Available on ${TIER_LABEL[requiredTier("custom_domain")]}.`
                }
              >
                <Input
                  value={domain}
                  onChange={(e) => {
                    setDomain(e.target.value);
                    setDirty(true);
                  }}
                  placeholder={`${org?.slug ?? "tenant"}.classconnect.app`}
                  disabled={!can("custom_domain")}
                />
              </Field>
            </div>
          </Card>
        </div>

        <LivePreview />
      </div>
    </div>
  );
}
