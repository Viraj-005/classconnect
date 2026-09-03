import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { LogoLockup } from "@/brand/Logo";
import { cx } from "@/lib/cx";
import { publicOrgs, tenantForHost } from "@/lib/api";
import { portalForRole } from "@/components/shell/nav";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Sign in.

  Real authentication now. The org picker exists because one email may
  hold accounts at several tenants, so the login lookup is (org, email)
  rather than email alone. Choosing an organisation here selects a
  candidate account, it does not grant access to that tenant.

  The demo role picker is gone. Which portal you land in follows from
  the role on the account, resolved server side.
*/

const DEMO_ACCOUNTS = [
  { label: "Teacher", email: "dinesh@horizon.lk", org: "horizon" },
  { label: "Admin", email: "admin@horizon.lk", org: "horizon" },
  { label: "Student", email: "amaya@horizon.lk", org: "horizon" },
  { label: "Parent", email: "parent@horizon.lk", org: "horizon" },
  { label: "Platform", email: "viraj@looplab.io", org: "looplab" },
];

export default function Login() {
  const navigate = useNavigate();
  const { signIn, completeTwoFactor, status, user, previewAccent } = useTheme();

  const [orgs, setOrgs] = useState([]);
  const [orgSlug, setOrgSlug] = useState("horizon");
  /*
    Empty to start, and filled with a demo account only once we know the
    hostname is unbound.

    These used to be hardcoded to a seeded teacher and demo1234, which
    was a convenience on localhost and a real problem anywhere else: a
    tenant's own login page arrived carrying somebody's email and
    password already typed in, and one click signed you in as them.
  */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /*
    The second factor is a step, not a separate page.

    Keeping it here means the organisation and email the person already
    chose stay on screen behind it, and a wrong code returns them to the
    code field rather than to an empty form.
  */
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  /*
    Who this hostname belongs to.

    Bound means the visitor arrived at one school's own address, so the
    form names that school and the picker never renders. Unbound means a
    development machine, where the picker and the demo shortcuts are the
    whole point.

    Both calls run because the picker still needs its list when unbound,
    and the tenant call is what decides whether that list is ever shown.
  */
  const [tenant, setTenant] = useState(null);
  const bound = tenant?.bound === true;

  useEffect(() => {
    let live = true;
    tenantForHost().then((t) => {
      if (!live) return;
      setTenant(t);
      if (t.bound && t.organisation) {
        setOrgs([t.organisation]);
        setOrgSlug(t.organisation.slug);
        // No prefill here. This is somebody's real school.
        return;
      }
      // Unbound, so a development machine. Prefill the first demo
      // account, which is what made the picker quick to work with.
      const demo = DEMO_ACCOUNTS[0];
      setOrgSlug(demo.org);
      setEmail(demo.email);
      setPassword("demo1234");
      publicOrgs().then((list) => live && setOrgs(list));
    });
    return () => {
      live = false;
    };
  }, []);

  /*
    Paint the whole login screen in the selected organisation's colour,
    not just the brand panel. Without this the panel is the tenant's
    teal while the sign in button is still LoopLab plum, which reads as
    a bug rather than as branding.
  */
  const selectedColor = orgs.find((o) => o.slug === orgSlug)?.primaryColor ?? null;
  useEffect(() => {
    previewAccent(selectedColor);
    return () => previewAccent(null);
  }, [selectedColor, previewAccent]);

  if (status === "authenticated" && user) {
    return <Navigate to={portalForRole(user.role).home} replace />;
  }

  const org = orgs.find((o) => o.slug === orgSlug);

  const land = (session) => {
    if (session?.user) navigate(portalForRole(session.user.role).home, { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signIn({ email, password, orgSlug });
      if (res?.twoFactorRequired) {
        setChallenge(res.challengeToken);
        return;
      }
      land(res?.session);
    } catch (err) {
      setError(
        err?.status === 401
          ? "Email or password is incorrect for this organisation."
          : (err?.message ?? "Could not sign in."),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await completeTwoFactor({
        challengeToken: challenge,
        code: useRecovery ? null : code,
        recoveryCode: useRecovery ? code : null,
      });
      land(session);
    } catch (err) {
      /*
        An expired challenge sends them back to the password step
        rather than leaving them typing codes at a token that will
        never be accepted again.
      */
      if (err?.message?.includes("took too long")) {
        setChallenge(null);
        setCode("");
        setError("That took too long. Please sign in again.");
      } else {
        setError(err?.message ?? "That code was not accepted.");
      }
    } finally {
      setBusy(false);
    }
  };

  const applyDemoAccount = (account) => {
    setOrgSlug(account.org);
    setEmail(account.email);
    setPassword("demo1234");
    setError(null);
  };

  return (
    <div className="min-h-full flex bg-canvas">
      {/* Brand panel, re-skins with the selected tenant. */}
      <div
        className="hidden md:flex flex-col justify-between w-[42%] max-w-[560px] p-8 lg:p-10 text-[var(--brand-contrast)] relative overflow-hidden"
        style={{ background: "var(--brand-gradient)" }}
      >
        <svg className="absolute inset-0 w-full h-full opacity-[0.13]" aria-hidden="true">
          <defs>
            <pattern id="login-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0v40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#login-grid)" />
        </svg>

        <div className="relative">
          <LogoLockup height={30} tone="light" />
        </div>

        <div className="relative">
          <h1 className="text-3xl lg:text-4xl font-bold font-display leading-[1.12] tracking-tight max-w-md text-white">
            One platform. Every classroom, kept separate.
          </h1>
          <p className="text-sm text-white/85 mt-4 max-w-sm leading-relaxed">
            Content, fees, attendance and analytics for schools and tutoring centres, with each
            organisation fully isolated from the next.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              "Teacher, student, parent and admin portals",
              "Fee collection with QR class tickets",
              "Per role page access, controlled by your admin",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2.5 text-sm text-white/90">
                <span className="inline-flex items-center justify-center size-5 rounded-full bg-white/20 shrink-0">
                  <Icon name="check" size={12} strokeWidth={2.6} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-2xs text-white/70">A LoopLab product</div>
      </div>

      {/* Form panel. */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-8">
            <LogoLockup height={28} />
          </div>

          {challenge ? (
            /*
              The second factor, in place of the password form.

              Deliberately not a separate route. The organisation and
              the brand panel stay exactly where they were, so this
              reads as the next step of one action rather than as a
              redirect to somewhere new, and going back does not mean
              losing what was already typed.
            */
            <>
              <div className="eyebrow mb-2">Two step verification</div>
              <h2 className="text-2xl font-bold tracking-tight">
                {useRecovery ? "Use a recovery code" : "Enter your code"}
              </h2>
              <p className="text-sm text-ink-500 mt-1.5">
                {useRecovery
                  ? "One of the codes you saved when you turned this on. Each works once."
                  : "Open your authenticator app and enter the six digit code for this account."}
              </p>

              <form onSubmit={submitCode} className="mt-7 space-y-4">
                <Field label={useRecovery ? "Recovery code" : "Authentication code"}>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode={useRecovery ? "text" : "numeric"}
                    placeholder={useRecovery ? "abcde-fghij" : "123456"}
                    maxLength={useRecovery ? 20 : 7}
                    className={cx(
                      "text-center tnum tracking-[0.4em] font-bold",
                      useRecovery ? "text-base tracking-[0.2em]" : "text-xl",
                    )}
                  />
                </Field>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-danger-bg px-3 py-2.5">
                    <Icon name="alert" size={15} className="text-danger-fg shrink-0 mt-0.5" />
                    <p className="text-xs text-danger-fg leading-relaxed">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  iconRight="arrowRight"
                  loading={busy}
                  disabled={!code.trim()}
                >
                  Verify and sign in
                </Button>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setChallenge(null);
                      setCode("");
                      setUseRecovery(false);
                      setError(null);
                    }}
                    className="text-xs font-semibold text-ink-500 hover:text-ink-800"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUseRecovery((r) => !r);
                      setCode("");
                      setError(null);
                    }}
                    className="text-xs font-semibold text-[var(--portal-accent)] hover:underline"
                  >
                    {useRecovery ? "Use my authenticator app" : "Lost your phone?"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="eyebrow mb-2">Welcome back</div>
              <h2 className="text-2xl font-bold tracking-tight">
                Sign in to {org?.name ?? "ClassConnect"}
              </h2>
              <p className="text-sm text-ink-500 mt-1.5">
                Use your organisation email. Access is scoped to this organisation only.
              </p>

              <form onSubmit={submit} className="mt-7 space-y-4">
                {bound ? (
                  /*
                    No picker. The hostname already named the school, so
                    this states which one rather than asking. Shown
                    rather than hidden, because "am I signing in to the
                    right place" is a fair question on a page that takes
                    a password.
                  */
                  <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-hairline bg-sunken px-3 py-2.5">
                    <span
                      className="size-6 rounded-[6px] shrink-0 border border-hairline"
                      style={{ background: org?.primaryColor ?? "var(--brand-600)" }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{org?.name}</div>
                      <div className="text-2xs text-ink-500">{window.location.host}</div>
                    </div>
                  </div>
                ) : (
                <Field label="Organisation">
                  <div className="relative">
                    <select
                      value={orgSlug}
                      onChange={(e) => setOrgSlug(e.target.value)}
                      className={cx(
                        "w-full h-10 pl-10 pr-9 rounded-[var(--radius-sm)] bg-surface appearance-none",
                        "border border-hairline text-sm font-semibold",
                        "hover:border-ink-300 focus:border-[var(--portal-accent)]",
                        "focus:shadow-[0_0_0_3px_var(--portal-halo)] focus:outline-none",
                      )}
                    >
                      {orgs.map((o) => (
                        <option key={o.slug} value={o.slug}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <span
                      className="absolute left-3 top-1/2 -translate-y-1/2 size-5 rounded-[6px] pointer-events-none border border-hairline"
                      style={{ background: org?.primaryColor ?? "var(--brand-600)" }}
                    />
                    <Icon
                      name="chevronDown"
                      size={15}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
                    />
                  </div>
                </Field>
                )}

                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.lk"
                    autoComplete="username"
                  />
                </Field>

                <Field label="Password">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </Field>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-danger-bg px-3 py-2.5">
                    <Icon name="alert" size={15} className="text-danger-fg shrink-0 mt-0.5" />
                    <p className="text-xs text-danger-fg leading-relaxed">{error}</p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs text-ink-600 cursor-pointer">
                    <input
                      type="checkbox"
                      defaultChecked
                      className="size-3.5 accent-[var(--portal-accent)]"
                    />
                    Keep me signed in
                  </label>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--portal-accent)] hover:underline"
                  >
                    Forgot password
                  </button>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  iconRight="arrowRight"
                  loading={busy}
                >
                  Sign in
                </Button>
              </form>

              {/*
                The way in for a school that has no account yet. Free
                needs a door on the sign in screen, because this is
                where somebody who has heard about the product arrives.
              */}
              {/*
                Not on the platform console. Nobody signs a school up
                from LoopLab's own door, and offering it there invites
                an operator to create a tenant from the wrong side of
                the product.
              */}
              {!tenant?.isPlatform && (
                <p className="text-xs text-ink-500 text-center mt-5">
                  New here?{" "}
                  <Link
                    to="/signup"
                    className="font-semibold text-[var(--portal-accent)] hover:underline"
                  >
                    Start free with 25 students
                  </Link>
                </p>
              )}
            </>
          )}

          {/*
            Seeded accounts, so the five portals are reachable without
            hunting through the seed script. Labelled as demo data.

            Only when the hostname is unbound, which means a development
            machine. On a real tenant's address these would name accounts
            at other organisations, which is both confusing and the same
            roster leak the picker was hidden to prevent.
          */}
          {!bound && (
          <div className="mt-7 pt-5 border-t border-hairline">
            <div className="eyebrow mb-2.5">Demo accounts, password demo1234</div>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => applyDemoAccount(a)}
                  className={cx(
                    "px-2.5 h-7 rounded-[var(--radius-sm)] border text-2xs font-bold",
                    "transition-colors duration-[var(--dur-fast)]",
                    email === a.email
                      ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                      : "border-hairline text-ink-600 hover:border-ink-300 hover:text-ink-900",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
