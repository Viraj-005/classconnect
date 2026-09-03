import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/Icon";
import { LogoLockup } from "@/brand/Logo";
import { Avatar, IconButton } from "@/components/ui/primitives";
import { GraceBanner } from "@/components/ui/states";
import { Sidebar } from "./Sidebar";
import { HelpPanel } from "./HelpPanel";
import {
  PAGE_BY_PATH,
  PORTALS,
  isNeutralPath,
  neutralLabel,
  portalByKey,
  portalForRole,
  portalFromPath,
} from "./nav";
import { getNavCollapsed, setNavCollapsed, subscribe } from "@/lib/prefs";
import { useTheme } from "@/theme/ThemeProvider";

/*
  The application shell.

  One dark sidebar (see Sidebar.jsx) plus a light work area. The split
  is deliberate rather than decorative: the sidebar is the constant, and
  it carries the tenant's colour, so the eye has one fixed anchor and
  the content area stays quiet enough to read dense tables on.

  Nav items are filtered by the session's pageAccess map, which the
  server resolves. Hiding is a courtesy; the route guard below and the
  API both re-check.
*/

/* ------------------------------------------------------------------ */
/* Topbar                                                              */
/* ------------------------------------------------------------------ */

function crumbsFor(pathname, portal) {
  const neutral = neutralLabel(pathname);
  if (neutral) return [portal.label, neutral];
  const all = portal.groups.flatMap((g) => g.items);
  const match = all.find((i) => i.to === pathname);
  const parts = pathname.split("/").filter(Boolean);
  return [portal.label, match?.label ?? (parts[1] ?? "Overview")];
}

function Topbar({ portal, onOpenHelp }) {
  const { user, signOut } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const crumbs = crumbsFor(pathname, portal);

  /*
    A dropdown that only closes by clicking its own trigger is a
    dropdown that follows you around the page. Escape and a click
    anywhere else both dismiss it.
  */
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenu(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /*
    Every item here runs something. They were decorative until a review
    found that only Sign out worked, which is worse than not offering
    them: a control that looks live and does nothing reads as a broken
    app rather than an absent feature.
  */
  const items = [
    {
      icon: "user",
      label: "Profile",
      onClick: () => navigate("/account"),
    },
    {
      icon: "settings",
      label: "Preferences",
      onClick: () => navigate("/account?tab=preferences"),
    },
    {
      icon: "help",
      label: "Help and docs",
      onClick: onOpenHelp,
    },
  ];

  return (
    <header className="h-16 shrink-0 bg-surface border-b border-hairline flex items-center gap-3 px-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2.5 min-w-0 shrink-0">
        <span className="text-xs font-bold tracking-[0.12em] uppercase text-ink-400">
          {crumbs[0]}
        </span>
        <span className="size-1 rounded-full bg-ink-300" aria-hidden="true" />
        <span className="text-sm font-bold text-ink-950 truncate">{crumbs[1]}</span>
      </nav>

      <div className="flex-1" />

      <div className="relative hidden lg:block w-72">
        <Icon
          name="search"
          size={15}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
        />
        <input
          placeholder="Search students, content"
          className={cx(
            "w-full h-10 pl-10 pr-14 rounded-[var(--radius-pill)] bg-sunken",
            "border border-transparent text-sm placeholder:text-ink-400",
            "transition-[border-color,background-color,box-shadow] duration-[var(--dur-fast)]",
            "hover:bg-ink-50 focus:bg-surface focus:border-[var(--portal-accent)]",
            "focus:shadow-[0_0_0_3px_var(--portal-halo)] focus:outline-none",
          )}
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-400 bg-surface border border-hairline rounded px-1.5 py-0.5">
          /
        </kbd>
      </div>

      <IconButton icon="bell" label="Notifications" className="relative">
        <span className="absolute top-2 right-2 size-1.5 rounded-full bg-[var(--danger-mid)]" />
      </IconButton>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenu(!menu)}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-[var(--radius-pill)] pl-1 pr-2 py-1 hover:bg-ink-50 transition-colors"
        >
          <Avatar name={user?.name ?? "?"} size={32} online />
          <Icon name="chevronDown" size={13} className="text-ink-400" />
        </button>

        {menu && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 z-40 w-56 rounded-[var(--radius-md)] border border-hairline bg-surface shadow-[var(--shadow-lg)] p-1.5 animate-rise"
          >
            <div className="px-2.5 py-2">
              <p className="text-xs font-bold truncate">{user?.name}</p>
              <p className="text-2xs text-ink-500 truncate">{user?.email}</p>
            </div>
            <div className="h-px bg-hairline my-1" />
            {items.map((i) => (
              <button
                key={i.label}
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  i.onClick();
                }}
                className="w-full flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 h-8 text-xs font-semibold text-ink-700 hover:bg-ink-50 transition-colors"
              >
                <Icon name={i.icon} size={15} />
                {i.label}
              </button>
            ))}
            <div className="h-px bg-hairline my-1" />
            <button
              role="menuitem"
              onClick={signOut}
              className="w-full flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 h-8 text-xs font-semibold text-danger-fg hover:bg-danger-bg transition-colors"
            >
              <Icon name="logout" size={15} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function BootScreen({ label }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-canvas">
      <LogoLockup height={30} />
      <span className="text-sm text-ink-500">{label}</span>
    </div>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const { status, org, user, canPage, signOut } = useTheme();
  const [help, setHelp] = useState(false);

  /*
    Subscribed rather than held in state, because the preferences screen
    writes the same value. Two copies of one setting drift apart the
    moment both are on screen.
  */
  const collapsed = useSyncExternalStore(subscribe, getNavCollapsed);

  /*
    A portal neutral path takes the portal of whoever is looking at it.
    Resolving /account by prefix would make it a teacher route, and the
    role lock below would then bounce every other role off their own
    account screen.
  */
  const homeKey = portalForRole(user?.role).key;
  const portalKey = isNeutralPath(pathname) ? homeKey : portalFromPath(pathname);
  const portal = useMemo(() => portalByKey(portalKey), [portalKey]);

  useEffect(() => {
    document.getElementById("cc-main")?.scrollTo({ top: 0 });
  }, [pathname]);

  if (status === "loading") return <BootScreen label="Loading your workspace" />;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  if (status === "error") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <Icon name="alert" size={30} className="text-danger-fg" />
        <h1 className="text-lg font-semibold">Cannot reach the API</h1>
        <p className="text-sm text-ink-500 max-w-sm">
          The app loaded but the server did not answer. Start it with{" "}
          <code className="text-xs">uvicorn app.main:app</code> in apps/api, then reload.
        </p>
      </div>
    );
  }

  // A user holds one portal. Landing anywhere else redirects home
  // rather than rendering a shell they have no business in.
  const homePortal = portalForRole(user.role);
  if (portalKey !== homePortal.key) {
    return <Navigate to={homePortal.home} replace />;
  }

  /*
    Route guard. The nav hides blocked pages, but a bookmark or a typed
    URL bypasses the nav entirely, so the path is checked here too. The
    API refuses the underlying request regardless of what renders.
  */
  const pageKey = PAGE_BY_PATH[pathname];
  const blocked = pageKey && !canPage(pageKey);

  return (
    <div data-portal={portalKey} className="flex h-full bg-canvas text-ink-900">
      <Sidebar
        portal={portal}
        collapsed={collapsed}
        onToggle={() => setNavCollapsed(!collapsed)}
        onSignOut={signOut}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar portal={portal} onOpenHelp={() => setHelp(true)} />
        <main id="cc-main" className="flex-1 overflow-y-auto">
          <div className="px-7 py-7 max-w-[1520px]">
            {org?.billingStatus === "past_due" && portalKey !== "superadmin" && (
              <GraceBanner days={org.graceDaysLeft ?? 7} />
            )}
            {blocked ? <PageBlocked /> : <Outlet />}
          </div>
        </main>
      </div>

      <HelpPanel open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

/*
  Shown when an administrator has switched a page off for this role.
  Deliberately not a 404: the page exists, the person is simply not
  permitted, and saying so avoids a support ticket about a broken link.
*/
export function PageBlocked() {
  return (
    <div className="flex flex-col items-center text-center px-6 py-16">
      <span className="inline-flex items-center justify-center size-12 rounded-[var(--radius-md)] bg-ink-100 text-ink-500">
        <Icon name="lock" size={22} />
      </span>
      <h1 className="text-lg font-semibold mt-4">This page is switched off</h1>
      <p className="text-sm text-ink-500 mt-1.5 max-w-md leading-relaxed">
        An administrator has turned this page off for your role. If you need it, ask them to
        re-enable it under Access control.
      </p>
    </div>
  );
}

export { PORTALS };
