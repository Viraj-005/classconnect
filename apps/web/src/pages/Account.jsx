import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  Field,
  Input,
  PageHeader,
  Segmented,
  Tabs,
  Toggle,
} from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { TwoFactorPanel } from "@/components/account/TwoFactorPanel";
import { auth } from "@/lib/api";
import { cx, formatDate } from "@/lib/cx";
import { getNavCollapsed, setNavCollapsed, subscribe } from "@/lib/prefs";
import { useMutation } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";
import { portalForRole } from "@/components/shell/nav";

/*
  Your account.

  Portal neutral: every role reaches the same screen from the profile
  menu, and the shell treats the path as belonging to whichever portal
  the person is already in. That is why there is no entry for it in
  nav.js and no page key in the access registry. Locking someone out of
  their own password would be a strange thing to let an administrator
  do by accident.

  The split between what is editable here and what is not follows who
  owns the fact. Your name is yours. Your email is a sign in identity
  and changing it needs a verification round trip that does not exist,
  so it is shown and explained rather than quietly editable. Your role
  and organisation are assigned to you, so they are read only here and
  live on the Admin screens instead.
*/

const ROLE_LABEL = {
  super_admin: "Super Admin",
  admin: "Administrator",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

/* ------------------------------------------------------------------ */
/* Saved confirmation                                                  */
/* ------------------------------------------------------------------ */

/*
  A save with no acknowledgement reads as a save that did not happen.
  This clears itself, because a confirmation that stays on screen stops
  meaning "just now" after about ten seconds.
*/
function Saved({ shown, children = "Saved" }) {
  if (!shown) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-fg animate-rise">
      <Icon name="checkCircle" size={14} />
      {children}
    </span>
  );
}

function useFlash(ms = 4000) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return [on, () => setOn(true)];
}

function FormError({ error }) {
  if (!error) return null;
  return (
    <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
      <Icon name="alert" size={14} className="shrink-0 mt-px" />
      {error.message}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

/*
  Who you are, and what your account is attached to.

  The two branches are not cosmetic. A tenant user belongs to a customer
  of LoopLab and has a plan, a seat allowance and invoices. A Super
  Admin belongs to LoopLab itself, which sells those plans rather than
  buying one.

  LoopLab carries a package_tier in the database only because the column
  is not nullable and the platform console needs feature access. It is a
  placeholder, not a subscription, and showing it as a plan told the
  operator they were on a tier they neither pay for nor could change.
  The Organization model says as much: "it is not a customer and must
  never appear in tenant counts or revenue".
*/
function IdentityCard({ user, org }) {
  const portal = portalForRole(user.role);
  const isPlatform = user.role === "super_admin";

  return (
    <Card className="overflow-hidden">
      <div className="p-5 flex items-center gap-4">
        <Avatar name={user.name} size={56} online />
        <div className="min-w-0">
          <p className="text-base font-bold font-display truncate">{user.name}</p>
          <p className="text-xs text-ink-500 truncate">{user.email}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <Badge tone="brand" icon={portal.icon}>
              {ROLE_LABEL[user.role] ?? user.role}
            </Badge>
          </div>
        </div>
      </div>

      {isPlatform ? (
        <>
          <div className="border-t border-hairline px-5 py-1">
            <DataRow label="Operator" value={org?.name ?? "LoopLab"} icon="building" />
            <DataRow label="Reach" value="Every tenant" icon="shield" />
          </div>
          <div className="px-5 pb-5">
            <p className="text-2xs text-ink-500 leading-relaxed">
              LoopLab operates ClassConnect rather than subscribing to it, so this account has
              no plan, no seat allowance and no invoices. Those belong to the tenants you
              administer, under Subscriptions.
            </p>
          </div>
        </>
      ) : (
        <div className="border-t border-hairline px-5 py-1">
          <DataRow label="Organisation" value={org?.name ?? "Unknown"} icon="building" />
          <DataRow
            label="Plan"
            value={(org?.packageTier ?? "").replace(/^./, (c) => c.toUpperCase())}
            icon="card"
          />
          <DataRow label="Member since" value={formatDate(org?.createdAt)} icon="calendar" />
        </div>
      )}
    </Card>
  );
}

function DetailsForm() {
  const { user, patchUser } = useTheme();
  const [name, setName] = useState(user.name);
  const [saved, flashSaved] = useFlash();

  const save = useMutation(async () => {
    const next = await auth.updateProfile({ name: name.trim() });
    /* Applied locally so the topbar and sidebar update on the spot. */
    patchUser({ name: next.name });
    flashSaved();
  });

  const dirty = name.trim() !== user.name && name.trim().length > 0;

  return (
    <Card>
      <CardHeader
        eyebrow="Details"
        title="Your details"
        sub="How your name appears to everyone else in this organisation."
      />
      <form
        className="px-5 pb-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate().catch(() => {
            /* Rendered below by FormError. */
          });
        }}
      >
        <Field label="Full name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            autoComplete="name"
          />
        </Field>

        <Field
          label="Email"
          hint="Your email is also how you sign in. An administrator changes it, so a mistyped address cannot lock you out of your own account."
        >
          <Input value={user.email} readOnly disabled />
        </Field>

        <FormError error={save.error} />

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={!dirty} loading={save.pending}>
            Save changes
          </Button>
          {dirty && !save.pending && (
            <Button type="button" variant="ghost" onClick={() => setName(user.name)}>
              Reset
            </Button>
          )}
          <Saved shown={saved} />
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, flashSaved] = useFlash();
  const [mismatch, setMismatch] = useState(false);

  const change = useMutation(async () => {
    await auth.changePassword({ currentPassword: current, newPassword: next });
    setCurrent("");
    setNext("");
    setConfirm("");
    flashSaved();
  });

  const tooShort = next.length > 0 && next.length < 8;
  const ready = current.length > 0 && next.length >= 8 && confirm.length > 0;

  return (
    <Card>
      <CardHeader
        eyebrow="Security"
        title="Password"
        sub="Changing it does not sign you out of this tab."
      />
      <form
        className="px-5 pb-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          /*
            Checked here rather than server side. The confirm field
            exists to catch a typo in the box you cannot read, and the
            second copy is no business of the API's.
          */
          if (next !== confirm) {
            setMismatch(true);
            return;
          }
          setMismatch(false);
          change.mutate().catch(() => {
            /* Rendered below by FormError. */
          });
        }}
      >
        <Field label="Current password" required>
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="New password"
            required
            hint="At least 8 characters."
          >
            <Input
              type="password"
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
                /* Editing either half clears the mismatch, since either
                   one is a plausible way to resolve it. */
                setMismatch(false);
              }}
              autoComplete="new-password"
              className={cx(tooShort && "border-[var(--danger-mid)]")}
            />
          </Field>
          <Field label="Confirm new password" required>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setMismatch(false);
              }}
              autoComplete="new-password"
              className={cx(mismatch && "border-[var(--danger-mid)]")}
            />
          </Field>
        </div>

        {mismatch && (
          <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
            <Icon name="alert" size={14} className="shrink-0 mt-px" />
            The two new passwords do not match.
          </p>
        )}
        <FormError error={change.error} />

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={!ready} loading={change.pending}>
            Change password
          </Button>
          <Saved shown={saved}>Password changed</Saved>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

function PreferencesPanel() {
  const { user, scheme, setScheme } = useTheme();
  const isPlatform = user.role === "super_admin";

  /*
    Subscribed rather than read once, so the sidebar and this toggle
    cannot disagree if one of them changes while both are on screen.
  */
  const [collapsed, setCollapsed] = useState(getNavCollapsed);
  useEffect(() => subscribe(() => setCollapsed(getNavCollapsed())), []);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          eyebrow="Layout"
          title="Navigation"
          sub="Stored on this device, not on your account."
        />
        <div className="px-5 pb-5">
          <Toggle
            checked={collapsed}
            onChange={setNavCollapsed}
            label="Keep the sidebar collapsed"
            hint="Shows icons only, which gives a wide table more room. You can still expand it from the logo."
          />
        </div>
      </Card>

      {isPlatform && (
        <Card>
          <CardHeader
            eyebrow="Appearance"
            title="Colour scheme"
            sub="The platform console is the one surface that offers both."
          />
          <div className="px-5 pb-5 space-y-3">
            <Segmented
              value={scheme}
              onChange={setScheme}
              items={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
            <p className="text-xs text-ink-500 leading-relaxed">
              LoopLab plum stays the accent in both. The platform identity does not follow a
              tenant's colours, so an operator can always tell which side of the product they are
              looking at.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader eyebrow="Alerts" title="Notifications" />
        <div className="px-5 pb-5">
          <div className="flex gap-3 rounded-[var(--radius-md)] border border-hairline bg-sunken p-3.5">
            <Icon name="bell" size={16} className="text-ink-400 shrink-0 mt-0.5" />
            <p className="text-xs text-ink-600 leading-relaxed">
              There is nothing to configure yet. ClassConnect does not send email or push
              notifications in this build, so switches here would promise something the product
              cannot do. They arrive with the notification service.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Account() {
  const { user, org } = useTheme();
  /*
    The tab lives in the URL so the profile menu can open either half
    directly, and so a reload keeps you where you were.
  */
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "preferences" ? "preferences" : "profile";

  return (
    <div>
      <PageHeader
        eyebrow="You"
        title="Your account"
        sub="Details, password and the settings that belong to this device."
      />

      <Tabs
        value={tab}
        onChange={(next) => setParams(next === "profile" ? {} : { tab: next }, { replace: true })}
        className="mb-5"
        items={[
          { value: "profile", label: "Profile" },
          { value: "preferences", label: "Preferences" },
        ]}
      />

      {tab === "profile" ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          <div className="xl:col-span-2 space-y-5">
            <DetailsForm />
            <PasswordForm />
            <TwoFactorPanel />
          </div>
          <IdentityCard user={user} org={org} />
        </div>
      ) : (
        <div className="max-w-2xl">
          <PreferencesPanel />
        </div>
      )}
    </div>
  );
}
