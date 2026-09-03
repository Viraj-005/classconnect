import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Icon } from "@/components/Icon";
import { LogoLockup } from "@/brand/Logo";
import { cx, formatMoney } from "@/lib/cx";
import { TIER_LIMITS, TIER_PRICE } from "@/lib/tiers";
import { portalForRole } from "@/components/shell/nav";
import { useTheme } from "@/theme/ThemeProvider";

/*
  Start on the free plan.

  The whole point of this screen is that nothing stands between a school
  and a working workspace. So: no card, no sales call, no email
  confirmation loop, and no plan chooser. Asking somebody to pick a tier
  before they have seen the product is asking a question they cannot yet
  answer, which is exactly the moment most signups are abandoned.

  Four fields, because four is what is genuinely needed to create a
  tenant and its first administrator. Everything else the product can
  learn later, or ask for when it actually matters.

  It ends signed in, inside their own organisation. A signup that
  finishes at a login form has thrown away the one moment the person was
  certain they wanted this.
*/

const FREE = TIER_LIMITS.free;

const PROMISES = [
  {
    icon: "students",
    title: `${FREE.students} students, ${FREE.teachers} teachers`,
    body: "Enough to run a real class, not a sandbox. Free for as long as you stay this size.",
  },
  {
    icon: "library",
    title: "The whole core, not a demo",
    body: "Content library, fee tracking, schedule and the parent portal are all included.",
  },
  {
    icon: "clock",
    title: "No countdown",
    body: "Not a trial. Nothing expires, nothing switches off, and there is no card to enter.",
  },
  {
    icon: "shield",
    title: "Your data stays yours",
    body: `Upgrade when you outgrow ${FREE.students} students and everything carries over untouched.`,
  },
];

export default function Signup() {
  const navigate = useNavigate();
  const { signUp, status, user } = useTheme();

  const [orgName, setOrgName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (status === "authenticated" && user) {
    return <Navigate to={portalForRole(user.role).home} replace />;
  }

  const tooShort = password.length > 0 && password.length < 8;
  const ready =
    orgName.trim().length >= 2 &&
    adminName.trim().length >= 1 &&
    email.includes("@") &&
    password.length >= 8;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await signUp({
        orgName: orgName.trim(),
        adminName: adminName.trim(),
        email: email.trim(),
        password,
      });
      /* Straight into their own admin portal, already signed in. */
      navigate(portalForRole("admin").home, { replace: true, state: { welcome: res.orgSlug } });
    } catch (err) {
      setError(err?.message ?? "Could not create the organisation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex bg-canvas">
      {/* What free actually gives you, stated before anything is asked for. */}
      <div
        className="hidden md:flex flex-col justify-between w-[42%] max-w-[560px] p-8 lg:p-10 relative overflow-hidden text-[var(--brand-contrast)]"
        style={{ background: "var(--brand-gradient)" }}
      >
        <svg className="absolute inset-0 w-full h-full opacity-[0.13]" aria-hidden="true">
          <defs>
            <pattern id="signup-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0v40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#signup-grid)" />
        </svg>

        <div className="relative">
          <LogoLockup height={30} tone="light" />
        </div>

        <div className="relative">
          <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-[var(--radius-pill)] bg-white/20 text-[11px] font-bold tracking-wide text-white">
            <Icon name="sparkle" size={12} />
            FREE PLAN
          </span>
          <h1 className="text-3xl lg:text-4xl font-bold font-display leading-[1.12] tracking-tight max-w-md text-white mt-4">
            Run your classes on it before you pay for it.
          </h1>

          <ul className="mt-8 space-y-4">
            {PROMISES.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="inline-flex items-center justify-center size-8 rounded-[var(--radius-sm)] bg-white/15 shrink-0">
                  <Icon name={p.icon} size={15} className="text-white" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{p.title}</p>
                  <p className="text-xs text-white/80 leading-relaxed mt-0.5">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-2xs text-white/70">
          Paid plans start at {formatMoney(TIER_PRICE.starter)} a month. A LoopLab product.
        </p>
      </div>

      {/* The form. */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-8">
            <LogoLockup height={28} />
          </div>

          <div className="eyebrow mb-2">Get started</div>
          <h2 className="text-2xl font-bold tracking-tight">Create your workspace</h2>
          <p className="text-sm text-ink-500 mt-1.5">
            Free for up to {FREE.students} students. No card, and nothing to cancel.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <Field
              label="Organisation name"
              required
              hint="What your students and parents will see."
            >
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Sunrise Tuition Centre"
                maxLength={160}
                autoFocus
              />
            </Field>

            <Field label="Your name" required>
              <Input
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Kasun Perera"
                maxLength={160}
                autoComplete="name"
              />
            </Field>

            <Field label="Your email" required hint="This is how you will sign in.">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.lk"
                autoComplete="username"
              />
            </Field>

            <Field label="Password" required hint="At least 8 characters.">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={cx(tooShort && "border-[var(--danger-mid)]")}
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
              disabled={!ready}
            >
              Create my workspace
            </Button>
          </form>

          <p className="text-xs text-ink-500 text-center mt-5">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-[var(--portal-accent)] hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
