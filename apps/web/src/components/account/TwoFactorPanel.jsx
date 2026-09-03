import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
} from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { auth } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useMutation } from "@/lib/useApi";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Two step verification.

  Three states, and the middle one is the whole design problem:

    off        an explanation and one button
    enrolling  a QR code, a secret to type, and a code to prove it took
    on         the controls that only matter once it is on

  Enrolment finishes only when the server has seen a working code. That
  is not ceremony: switching it on without proving the app is set up is
  how somebody locks themselves out of their own account with no way
  back in, and the person who does that is never the one who can fix it.

  The recovery codes are shown exactly once, on the screen that turns it
  on, because the server keeps only their hashes and genuinely cannot
  show them again. The UI has to make that moment hard to skip past,
  which is why the confirmation is a checkbox rather than a Done button.
*/

function RecoveryCodes({ codes, onDone, regenerated }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--warning-mid)] bg-warning-bg p-4">
      <div className="flex items-start gap-2.5">
        <Icon name="alert" size={16} className="text-warning-fg shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-warning-fg">
            {regenerated ? "Your new recovery codes" : "Save your recovery codes"}
          </p>
          <p className="text-xs text-warning-fg/90 leading-relaxed mt-1">
            Each one signs you in once if you lose your phone. This is the only time they
            can be shown, because only their hashes are stored.
            {regenerated ? " Every code issued before this is now dead." : ""}
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 rounded-[var(--radius-sm)] bg-surface/70 p-3">
        {codes.map((c) => (
          <li key={c} className="font-mono text-xs font-semibold tnum tracking-wide">
            {c}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button
          size="sm"
          variant="secondary"
          icon="doc"
          onClick={() => navigator.clipboard?.writeText(text)}
        >
          Copy all
        </Button>
        <label className="flex items-center gap-2 text-xs font-semibold text-warning-fg cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="size-3.5 accent-[var(--warning-mid)]"
          />
          I have saved these
        </label>
        <Button size="sm" variant="primary" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function EnrolStep({ setup, onCancel, onEnabled }) {
  const [code, setCode] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const enable = useMutation(async () => {
    const res = await auth.twoFactorEnable(code.trim());
    onEnabled(res.codes);
  });

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        <li className="flex gap-3">
          <span className="inline-flex items-center justify-center size-6 rounded-full bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] text-2xs font-bold shrink-0">
            1
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Scan this with your authenticator app</p>
            <p className="text-xs text-ink-500 mt-0.5">
              Google Authenticator, Authy, 1Password, or any other TOTP app.
            </p>
            <div className="mt-3 inline-block rounded-[var(--radius-md)] border border-hairline bg-white p-3">
              {/*
                Rendered by the server from the same URI shown below.
                The QrCode component elsewhere in this app draws a
                decorative pattern, which would be worse than useless
                here: it is scanned once, and a code that carries
                nothing means enrolment simply cannot be completed.
              */}
              <div
                className="size-40 [&>svg]:size-full"
                aria-label="Enrolment QR code"
                dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
              />
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="inline-flex items-center justify-center size-6 rounded-full bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] text-2xs font-bold shrink-0">
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Cannot scan it?</p>
            <p className="text-xs text-ink-500 mt-0.5">
              Enter this key into the app by hand instead.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <code
                className={cx(
                  "flex-1 min-w-0 truncate rounded-[var(--radius-sm)] bg-sunken border border-hairline",
                  "px-3 h-9 inline-flex items-center font-mono text-xs tracking-wider",
                )}
              >
                {showSecret ? setup.secret : "•".repeat(32)}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? "Hide" : "Show"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(setup.secret)}
              >
                Copy
              </Button>
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="inline-flex items-center justify-center size-6 rounded-full bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] text-2xs font-bold shrink-0">
            3
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Enter the code it shows</p>
            <p className="text-xs text-ink-500 mt-0.5">
              This proves the app is set up before anything is switched on.
            </p>
            <form
              className="mt-2 flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                enable.mutate().catch(() => {
                  /* Rendered below. */
                });
              }}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                maxLength={7}
                autoComplete="one-time-code"
                className="w-36 text-center text-lg font-bold tnum tracking-[0.3em]"
              />
              <Button
                type="submit"
                variant="primary"
                loading={enable.pending}
                disabled={code.trim().length < 6}
              >
                Turn on
              </Button>
            </form>
          </div>
        </li>
      </ol>

      {enable.error && (
        <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5">
          <Icon name="alert" size={14} className="shrink-0 mt-px" />
          {enable.error.message}
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-semibold text-ink-500 hover:text-ink-800"
      >
        Cancel
      </button>
    </div>
  );
}

function TurnOffForm({ onDone }) {
  const [password, setPassword] = useState("");
  const off = useMutation(async () => {
    await auth.twoFactorDisable(password);
    onDone();
  });

  return (
    <form
      className="rounded-[var(--radius-md)] border border-hairline bg-sunken p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        off.mutate().catch(() => {});
      }}
    >
      <p className="text-xs text-ink-600 leading-relaxed">
        Confirm with your password. A live session is exactly what somebody has when they
        sit down at a machine you walked away from, which is the thing this protects
        against, so a session alone is not enough to remove it.
      </p>
      <Field label="Your password">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      {off.error && (
        <p className="text-xs text-danger-fg">{off.error.message}</p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="danger"
          size="sm"
          loading={off.pending}
          disabled={!password}
        >
          Turn off two step verification
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Keep it on
        </Button>
      </div>
    </form>
  );
}

function RegenerateForm({ onCodes }) {
  const [password, setPassword] = useState("");
  const regen = useMutation(async () => {
    const res = await auth.regenerateRecoveryCodes(password);
    setPassword("");
    onCodes(res.codes);
  });

  return (
    <form
      className="rounded-[var(--radius-md)] border border-hairline bg-sunken p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        regen.mutate().catch(() => {});
      }}
    >
      <p className="text-xs text-ink-600 leading-relaxed">
        A new set replaces every code you were given before, so do this if you think the
        old list has been seen by somebody else.
      </p>
      <Field label="Your password">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      {regen.error && <p className="text-xs text-danger-fg">{regen.error.message}</p>}
      <Button type="submit" variant="secondary" size="sm" loading={regen.pending} disabled={!password}>
        Generate a new set
      </Button>
    </form>
  );
}

export function TwoFactorPanel() {
  const { user, reload } = useTheme();
  const enabled = user?.twoFactorEnabled;

  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [regenerated, setRegenerated] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [showRegen, setShowRegen] = useState(false);

  const start = useMutation(async () => {
    setSetup(await auth.twoFactorSetup());
  });

  const finish = async () => {
    setSetup(null);
    setCodes(null);
    setRegenerated(false);
    await reload();
  };

  return (
    <Card>
      <CardHeader
        eyebrow="Security"
        title="Two step verification"
        sub="A code from your phone on top of your password."
        action={
          enabled ? (
            <Badge tone="success" icon="shield">
              On
            </Badge>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )
        }
      />

      <div className="px-5 pb-5 space-y-4">
        {codes && (
          <RecoveryCodes
            codes={codes}
            regenerated={regenerated}
            onDone={() => {
              setShowRegen(false);
              finish();
            }}
          />
        )}

        {!codes && setup && (
          <EnrolStep
            setup={setup}
            onCancel={() => setSetup(null)}
            onEnabled={(c) => {
              setCodes(c);
              setRegenerated(false);
            }}
          />
        )}

        {!codes && !setup && !enabled && (
          <>
            <p className="text-sm text-ink-600 leading-relaxed">
              Your password is one thing you know. This adds one thing you have, so
              somebody who learns your password still cannot sign in as you. It takes about
              a minute to set up.
            </p>
            {start.error && (
              <p className="text-xs text-danger-fg">{start.error.message}</p>
            )}
            <Button
              variant="primary"
              icon="shield"
              loading={start.pending}
              onClick={() => start.mutate().catch(() => {})}
            >
              Set up two step verification
            </Button>
          </>
        )}

        {!codes && !setup && enabled && (
          <>
            <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-success-bg px-3.5 py-3">
              <Icon name="checkCircle" size={16} className="text-success-fg shrink-0 mt-0.5" />
              <p className="text-xs text-success-fg leading-relaxed">
                Signing in now asks for a code from your authenticator app. Keep your
                recovery codes somewhere you can reach without your phone.
              </p>
            </div>

            {showRegen ? (
              <RegenerateForm
                onCodes={(c) => {
                  setCodes(c);
                  setRegenerated(true);
                }}
              />
            ) : confirmOff ? (
              <TurnOffForm onDone={finish} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowRegen(true)}>
                  New recovery codes
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>
                  Turn off
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
