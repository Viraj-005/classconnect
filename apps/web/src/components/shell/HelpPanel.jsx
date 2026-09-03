import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { Badge, IconChip } from "@/components/ui/primitives";
import { cx } from "@/lib/cx";
import { useTheme } from "@/theme/ThemeProvider";
import { ALL_NAV_ITEMS, neutralLabel, portalByKey, portalForRole } from "./nav";

/*
  Help, as a slide over rather than a link.

  There is no documentation site to link to, and a menu item that opens
  a 404 is worse than one that does nothing. So this answers the two
  questions someone actually has when they reach for help: what is this
  screen for, and who do I ask. Both are answered from things the app
  already knows, the nav registry and the session, rather than from
  copy invented for the panel.

  Support routing follows the product's own shape. A teacher's
  administrator runs their organisation, so that is where a teacher is
  pointed. An administrator's counterparty is LoopLab. Nothing here
  invents a support address that would not reach anyone.
*/

const PORTAL_HELP = {
  teacher: [
    { to: "/teacher/students", label: "Add a student", icon: "students" },
    { to: "/teacher/content", label: "Upload a lesson", icon: "library" },
    { to: "/teacher/fees", label: "Record a fee payment", icon: "wallet" },
  ],
  student: [
    { to: "/student/library", label: "Find a lesson", icon: "library" },
    { to: "/student/payments", label: "Check what you owe", icon: "wallet" },
    { to: "/student/ticket", label: "Show your class ticket", icon: "qr" },
  ],
  parent: [
    { to: "/parent", label: "See progress", icon: "pulse" },
    { to: "/parent/attendance", label: "Check attendance", icon: "calendar" },
    { to: "/parent/payments", label: "Review fees", icon: "wallet" },
  ],
  admin: [
    { to: "/admin/users", label: "Invite or change a person", icon: "students" },
    { to: "/admin/access", label: "Turn a page on or off", icon: "lock" },
    { to: "/admin/billing", label: "Change your plan", icon: "card" },
  ],
  superadmin: [
    { to: "/platform/tenants", label: "Open a tenant", icon: "building" },
    { to: "/platform/access", label: "Set a platform default", icon: "lock" },
    { to: "/platform/audit", label: "Read the access log", icon: "shield" },
  ],
};

/*
  What the panel says it is looking at.

  A portal neutral path has no nav entry, so it takes its label from the
  neutral table and its portal from the person. Falling back to the path
  alone would offer a parent the teacher's list of common tasks, since
  portalFromPath treats anything unrecognised as teacher.
*/
function currentPageHelp(pathname, role) {
  const item = ALL_NAV_ITEMS.find((i) => i.to === pathname);
  if (item) return { label: item.label, portal: portalByKey(item.portal) };
  return { label: neutralLabel(pathname), portal: portalForRole(role) };
}

export function HelpPanel({ open, onClose }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, org, can } = useTheme();

  /* Escape closes it, which is what a dismissible overlay owes you. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const here = currentPageHelp(pathname, user?.role);
  const tasks = PORTAL_HELP[here.portal.key] ?? [];
  const isPlatform = user?.role === "super_admin";
  const isAdmin = user?.role === "admin";
  const priority = can("priority_support");

  const go = (to) => {
    navigate(to);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close help"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/25 backdrop-blur-[2px] animate-fade"
      />

      <aside
        role="dialog"
        aria-label="Help"
        className={cx(
          "relative w-full max-w-sm h-full bg-surface border-l border-hairline",
          "shadow-[var(--shadow-lg)] flex flex-col animate-slide-in",
        )}
      >
        <header className="flex items-center gap-3 px-5 h-16 border-b border-hairline shrink-0">
          <IconChip icon="help" tone="brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Help</p>
            <p className="text-2xs text-ink-500 truncate">{here.portal.label}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-ink-500 hover:bg-ink-50 hover:text-ink-900 transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {here.label && (
            <section>
              <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400 mb-2">
                This page
              </h2>
              <p className="text-sm font-semibold text-ink-900">{here.label}</p>
              <p className="text-xs text-ink-500 leading-relaxed mt-1">{here.portal.blurb}</p>
            </section>
          )}

          <section>
            <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400 mb-2">
              Common tasks
            </h2>
            <ul className="space-y-1">
              {tasks.map((t) => (
                <li key={t.to}>
                  <button
                    onClick={() => go(t.to)}
                    className="w-full flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 h-9 text-xs font-semibold text-ink-700 hover:bg-ink-50 transition-colors text-left"
                  >
                    <Icon name={t.icon} size={15} className="text-ink-400 shrink-0" />
                    <span className="flex-1 truncate">{t.label}</span>
                    <Icon name="arrowRight" size={14} className="text-ink-300" />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400 mb-2">
              Getting support
            </h2>
            <div className="rounded-[var(--radius-md)] border border-hairline bg-sunken p-3.5">
              {isPlatform ? (
                <p className="text-xs text-ink-600 leading-relaxed">
                  You are on the LoopLab platform console. Tenant issues start in the access log,
                  which records every cross tenant action with the operator who took it.
                </p>
              ) : isAdmin ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge tone={priority ? "success" : "neutral"} icon="shield">
                      {priority ? "Priority support" : "Standard support"}
                    </Badge>
                    <span className="text-2xs text-ink-500 uppercase tracking-wide font-bold">
                      {org?.packageTier}
                    </span>
                  </div>
                  <p className="text-xs text-ink-600 leading-relaxed">
                    {priority
                      ? "Your plan includes priority support from LoopLab. Reach out through the contact on your billing screen."
                      : "Standard support is included on Starter. Priority support comes with Growth and Pro."}
                  </p>
                </>
              ) : (
                <p className="text-xs text-ink-600 leading-relaxed">
                  {org?.name} runs this workspace. Your administrator can change your details, open
                  a page that is switched off, or sort out a fee that looks wrong.
                </p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400 mb-2">
              Good to know
            </h2>
            <ul className="space-y-2.5">
              {[
                {
                  icon: "lock",
                  text: "A page marked as switched off was turned off for your role by an administrator. It is not a fault.",
                },
                {
                  icon: "chart",
                  text: "Figures badged as estimated are derived, not measured. Nothing yet records views or attendance individually.",
                },
                {
                  icon: "user",
                  text: "Your name and password are yours to change under Profile. Email changes go through an administrator.",
                },
              ].map((n) => (
                <li key={n.icon} className="flex gap-2.5">
                  <Icon name={n.icon} size={14} className="text-ink-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-ink-600 leading-relaxed">{n.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}
