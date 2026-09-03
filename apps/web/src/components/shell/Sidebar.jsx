import { Link, NavLink } from "react-router-dom";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/Icon";
import { OrgLogo } from "@/components/ui/OrgLogo";
import { LogoMark } from "@/brand/Logo";
import { Avatar } from "@/components/ui/primitives";
import { TIER_LABEL, seatUsage } from "@/lib/tiers";
import { useTheme } from "@/theme/ThemeProvider";

/*
  The sidebar.

  Previously this was a slim dark icon rail glued to a white nav panel.
  That was a mistake in two ways. The rail was built as a portal
  switcher, so once a user was correctly locked to a single role it held
  one icon and a large void. And the dark strip beside a white panel read
  as two components that happened to be adjacent rather than as one
  deliberate object.

  So it is now one dark surface with two states:

    expanded   64px icon rail plus a 244px labelled panel
    collapsed  the rail alone, labels on hover

  The rail is not a second navigation. It is the collapsed form of the
  same navigation, which is why the icons match the rows exactly and why
  the mark at the top is the control that toggles between them. Nothing
  is duplicated, one thing has two densities.

  The palette comes from the tenant's brand hue (see ThemeProvider,
  sidebarVars), so the most visible surface in the product is also the
  one that carries the tenant's identity.

  The chips inside it (the mark, the organisation initials) take the
  portal hue rather than the raw brand gradient. Using the brand
  colour is the obvious reading, and it looked wrong: a teal chip on
  the Student portal's rose sidebar read as a mismatch rather than as
  a deliberate accent. Portal hue keeps the sidebar one coherent
  object, and the tenant's identity still carries because the portal
  hue is itself derived from their brand.
*/

function Brand({ collapsed, onToggle, portal }) {
  return (
    <div
      className={cx(
        "relative flex items-center gap-2.5 h-14 shrink-0",
        collapsed ? "justify-center px-0" : "px-4",
      )}
    >
      <button
        onClick={onToggle}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        className={cx(
          "group relative inline-flex items-center justify-center size-10 shrink-0",
          "rounded-[var(--radius-md)] transition-transform duration-[var(--dur-med)]",
          "hover:scale-105 active:scale-95",
        )}
        style={{ background: "var(--portal-gradient)" }}
      >
        <LogoMark size={22} tone="light" />
      </button>

      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-none text-[var(--sb-fg)]">
            ClassConnect
          </div>
          <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-[var(--sb-fg-dim)] mt-1">
            {portal.label}
          </div>
        </div>
      )}
    </div>
  );
}

/*
  Organisation card. On the dark surface this is the one raised block,
  so the tenant name is the second thing read after the product name.
*/
function OrgCard({ collapsed }) {
  const { org, user } = useTheme();
  if (!org) return null;

  const isPlatform = user?.role === "super_admin";

  if (collapsed) {
    return (
      <div className="px-3 pb-3">
        <OrgLogo
          name={org.branding.logoText || org.name}
          hasLogo={Boolean(org.branding.logoUrl)}
          version={org.branding.logoVersion}
          size={36}
          radius="10px"
          className="mx-auto text-xs text-[var(--portal-chip-contrast)]"
          style={{ background: "var(--portal-gradient)" }}
        />
      </div>
    );
  }

  return (
    <div className="px-3 pb-3">
      <div className="rounded-[var(--radius-md)] bg-[var(--sb-bg-soft)] border border-[rgba(255,255,255,0.07)] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          {/*
            The uploaded logo, when there is one. Falls back to the
            initials, which is what every tenant had before there was
            any storage. The gradient stays as the backing so a
            transparent PNG still sits on the tenant's own colour.
          */}
          <OrgLogo
            name={org.branding.logoText || org.name}
            hasLogo={Boolean(org.branding.logoUrl)}
            version={org.branding.logoVersion}
            size={32}
            radius="9px"
            className="text-[11px] text-[var(--portal-chip-contrast)]"
            style={{ background: "var(--portal-gradient)" }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-[var(--sb-fg)] truncate leading-tight">
              {org.name}
            </div>
            <div className="text-[10px] text-[var(--sb-fg-dim)] truncate mt-0.5">
              {org.branding.customDomain ?? `${org.slug}.classconnect.app`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-2">
          <span
            className={cx(
              "inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold tracking-wide",
              "bg-white/10 text-[var(--sb-fg)]",
            )}
          >
            {isPlatform ? "PLATFORM" : TIER_LABEL[org.packageTier].toUpperCase()}
          </span>
          {org.billingStatus === "past_due" && (
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10px] font-bold bg-[var(--warning-mid)] text-white">
              <span className="size-1 rounded-full bg-white" />
              PAST DUE
            </span>
          )}
          {org.billingStatus === "trialing" && (
            <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold bg-white/10 text-[var(--sb-fg-dim)]">
              TRIAL
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NavItem({ item, collapsed, tierLocked }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      /*
        The active styling (light block, glow, spine marker) lives in
        one rule in global.css rather than being reassembled from
        utilities here, so `is-active` is all this needs to add.
      */
      className={({ isActive }) =>
        cx("sb-item", isActive && "is-active", collapsed && "justify-center px-0")
      }
    >
      <Icon name={item.icon} size={18} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {tierLocked && <Icon name="lock" size={12} className="opacity-60 shrink-0" />}
        </>
      )}
      {collapsed && tierLocked && (
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-current opacity-50" />
      )}
    </NavLink>
  );
}

function SchemeToggle({ collapsed }) {
  const { scheme, setScheme } = useTheme();
  const next = scheme === "dark" ? "light" : "dark";

  if (collapsed) {
    return (
      <button
        onClick={() => setScheme(next)}
        title={`Switch to ${next} mode`}
        className="mx-auto flex items-center justify-center size-9 rounded-[var(--radius-sm)] text-[var(--sb-fg-dim)] hover:text-[var(--sb-fg)] hover:bg-white/8 transition-colors"
      >
        <Icon name={scheme === "dark" ? "sparkle" : "shield"} size={17} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-black/25 p-1">
      {[
        { value: "light", label: "Light", icon: "sparkle" },
        { value: "dark", label: "Dark", icon: "shield" },
      ].map((opt) => (
        <button
          key={opt.value}
          onClick={() => setScheme(opt.value)}
          className={cx(
            "flex-1 inline-flex items-center justify-center gap-1.5 h-7 rounded-[6px]",
            "text-[11px] font-bold transition-all duration-[var(--dur-fast)]",
            scheme === opt.value
              ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-fg)]"
              : "text-[var(--sb-fg-dim)] hover:text-[var(--sb-fg)]",
          )}
        >
          <Icon name={opt.icon} size={13} />
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SeatMeter({ collapsed }) {
  const { org } = useTheme();
  if (!org) return null;
  const seats = seatUsage(org.packageTier, org.seats.students, "students");

  if (collapsed) {
    return (
      <div className="px-3" title={`${seats.label} students`}>
        <div className="h-1 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--sb-active-bg)]"
            style={{ width: `${seats.unlimited ? 100 : seats.pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (seats.unlimited) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--sb-bg-soft)] border border-[rgba(255,255,255,0.07)] p-3">
        <div className="flex items-center gap-2">
          <Icon name="award" size={15} className="text-[var(--sb-active-bg)]" />
          <span className="text-xs font-bold text-[var(--sb-fg)]">Pro plan</span>
        </div>
        <p className="text-[10px] text-[var(--sb-fg-dim)] mt-1.5 leading-relaxed">
          Unlimited seats, full analytics and custom domain are active.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--sb-bg-soft)] border border-[rgba(255,255,255,0.07)] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-[0.12em] text-[var(--sb-fg-dim)]">
          {TIER_LABEL[org.packageTier].toUpperCase()} PLAN
        </span>
        <Icon name="sparkle" size={13} className="text-[var(--sb-fg-dim)]" />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-lg font-bold font-display tnum leading-none text-[var(--sb-fg)]">
          {org.seats.students}
        </span>
        <span className="text-[10px] text-[var(--sb-fg-dim)]">of {seats.cap} students</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-black/30 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-[var(--dur-slow)]"
          style={{
            width: `${seats.pct}%`,
            background: seats.nearingCap ? "var(--warning-mid)" : "var(--sb-active-bg)",
          }}
        />
      </div>
      {/* A link, not a button. It goes to the plan comparison, and this
          was one of the controls that did nothing. */}
      <Link
        to="/admin/billing"
        className="mt-3 w-full h-8 rounded-[var(--radius-sm)] bg-white/10 hover:bg-white/16 transition-colors text-[11px] font-bold text-[var(--sb-fg)] inline-flex items-center justify-center"
      >
        {seats.nearingCap ? "Add more seats" : "See plan options"}
      </Link>
    </div>
  );
}

export function Sidebar({ portal, collapsed, onToggle, onSignOut }) {
  const { can, canPage, user } = useTheme();
  const isPlatform = user?.role === "super_admin";
  const isAdmin = user?.role === "admin";

  return (
    <aside
      className={cx(
        "relative shrink-0 flex flex-col grain overflow-hidden",
        "transition-[width] duration-[var(--dur-med)] ease-[var(--ease-out)]",
      )}
      style={{
        width: collapsed ? "var(--rail-w)" : `calc(var(--rail-w) + var(--nav-w))`,
        background: "var(--sb-bg)",
      }}
    >
      {/*
        A vertical wash from the deeper stop, so the sidebar has a light
        direction instead of being one flat fill. Subtle enough that it
        reads as depth rather than as a gradient.
      */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, var(--sb-bg-soft) 0%, var(--sb-bg) 38%, var(--sb-bg-deep) 100%)",
        }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col h-full">
        <Brand collapsed={collapsed} onToggle={onToggle} portal={portal} />
        <OrgCard collapsed={collapsed} />

        <nav
          aria-label={`${portal.label} navigation`}
          className={cx("flex-1 overflow-y-auto overflow-x-hidden", collapsed ? "px-3" : "px-4")}
        >
          {portal.groups.map((group, gi) => {
            const visible = group.items.filter((item) => canPage(item.page));
            if (visible.length === 0) return null;

            return (
              <div key={gi} className={cx(gi > 0 && (collapsed ? "mt-3" : "mt-4"))}>
                {group.label &&
                  (collapsed ? (
                    // A rule stands in for the heading, so the grouping
                    // survives collapse without a cramped label.
                    <div className="h-px bg-[var(--sb-hairline)] mx-2 mb-3" />
                  ) : (
                    <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-[var(--sb-fg-dim)] px-2.5 mb-1.5 mt-0.5">
                      {group.label}
                    </div>
                  ))}
                <ul className="space-y-0.5">
                  {visible.map((item) => (
                    <li key={item.to}>
                      <NavItem
                        item={item}
                        collapsed={collapsed}
                        tierLocked={item.feature ? !can(item.feature) : false}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className={cx("shrink-0 space-y-2.5 pb-3", collapsed ? "px-0 pt-2.5" : "px-4 pt-2.5")}>
          {/*
            The plan card is for whoever is responsible for the plan.

            A teacher, student or parent cannot change the tier, cannot
            see the bill, and cannot do anything about a seat cap. Showing
            them "386 of 500 students" and an upgrade button is asking
            them to act on something that is not theirs, and it leaks the
            organisation's commercial standing to every child on the roll.
            Admin owns billing, so Admin sees it.
          */}
          {isPlatform ? (
            <SchemeToggle collapsed={collapsed} />
          ) : isAdmin ? (
            <SeatMeter collapsed={collapsed} />
          ) : null}

          <div className="h-px bg-[var(--sb-hairline)]" />

          <div
            className={cx(
              "flex items-center gap-2",
              collapsed ? "flex-col px-3" : "px-0.5",
            )}
          >
            {!collapsed && (
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Avatar name={user?.name ?? "?"} size={30} />
                <div className="min-w-0">
                  <div className="text-[12px] font-bold text-[var(--sb-fg)] truncate leading-tight">
                    {user?.name}
                  </div>
                  <div className="text-[10px] text-[var(--sb-fg-dim)] capitalize">
                    {user?.role?.replace("_", " ")}
                  </div>
                </div>
              </div>
            )}
            {collapsed && <Avatar name={user?.name ?? "?"} size={30} />}
            <button
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="inline-flex items-center justify-center size-8 rounded-[var(--radius-sm)] text-[var(--sb-fg-dim)] hover:text-[var(--sb-fg)] hover:bg-white/8 transition-colors shrink-0"
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
