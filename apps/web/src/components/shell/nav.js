/*
  Portal definitions.

  Each item carries a `page` key that matches the registry in
  apps/api/app/services/page_registry.py. The session returns a
  pageAccess map keyed the same way, so the nav filters itself and the
  route guard can look a path up.

  Hiding a blocked item is a courtesy, not a security boundary. The
  server re-checks on every guarded route, so typing the URL fails the
  same way.
*/

export const PORTALS = [
  {
    key: "teacher",
    label: "Teacher",
    rail: "Teach",
    icon: "book",
    home: "/teacher",
    role: "teacher",
    blurb: "Content, fees, analytics and the class schedule.",
    groups: [
      {
        label: null,
        items: [
          { to: "/teacher", page: "teacher.overview", label: "Overview", icon: "pulse", end: true },
          { to: "/teacher/content", page: "teacher.content", label: "Content library", icon: "library" },
          { to: "/teacher/students", page: "teacher.students", label: "Students", icon: "students" },
        ],
      },
      {
        label: "Money",
        items: [
          { to: "/teacher/fees", page: "teacher.fees", label: "Fees", icon: "wallet" },
          {
            to: "/teacher/tickets",
            page: "teacher.tickets",
            label: "Class tickets",
            icon: "qr",
            feature: "qr_ticketing",
          },
        ],
      },
      {
        label: "Insight",
        items: [
          { to: "/teacher/attendance", page: "teacher.attendance", label: "Attendance", icon: "check" },
          { to: "/teacher/marking", page: "teacher.marking", label: "Marking", icon: "quiz" },
          { to: "/teacher/schedule", page: "teacher.schedule", label: "Schedule", icon: "calendar" },
          {
            to: "/teacher/analytics",
            page: "teacher.analytics",
            label: "Analytics",
            icon: "chart",
            feature: "analytics_full",
          },
        ],
      },
    ],
  },
  {
    key: "student",
    label: "Student",
    rail: "Learn",
    icon: "students",
    home: "/student",
    role: "student",
    blurb: "Lessons, quizzes, fees and your class ticket.",
    groups: [
      {
        label: null,
        items: [
          { to: "/student", page: "student.overview", label: "My learning", icon: "pulse", end: true },
          { to: "/student/library", page: "student.library", label: "Resources", icon: "library" },
          { to: "/student/quizzes", page: "student.quizzes", label: "Quizzes", icon: "quiz" },
        ],
      },
      {
        label: "Access",
        items: [
          { to: "/student/payments", page: "student.payments", label: "Fees", icon: "wallet" },
          {
            to: "/student/ticket",
            page: "student.ticket",
            label: "Class ticket",
            icon: "qr",
            feature: "qr_ticketing",
          },
        ],
      },
      {
        label: null,
        items: [
          { to: "/student/calendar", page: "student.calendar", label: "Calendar", icon: "calendar" },
        ],
      },
    ],
  },
  {
    key: "parent",
    label: "Parent",
    rail: "Watch",
    icon: "shield",
    home: "/parent",
    role: "parent",
    blurb: "Grades, attendance and alerts for your child.",
    groups: [
      {
        label: null,
        items: [
          { to: "/parent", page: "parent.overview", label: "Progress", icon: "pulse", end: true },
          { to: "/parent/attendance", page: "parent.attendance", label: "Attendance", icon: "calendar" },
          { to: "/parent/payments", page: "parent.payments", label: "Fees", icon: "wallet" },
        ],
      },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    rail: "Admin",
    icon: "settings",
    home: "/admin",
    role: "admin",
    blurb: "People, access, branding and billing for your organisation.",
    groups: [
      {
        label: null,
        items: [
          { to: "/admin", page: "admin.overview", label: "Overview", icon: "pulse", end: true },
          { to: "/admin/users", page: "admin.users", label: "People", icon: "students" },
          { to: "/admin/batches", page: "admin.batches", label: "Batches", icon: "students" },
          { to: "/admin/access", page: "admin.access", label: "Access control", icon: "lock" },
        ],
      },
      {
        label: "Organisation",
        items: [
          {
            to: "/admin/branding",
            page: "admin.branding",
            label: "Branding",
            icon: "sparkle",
            feature: "branding_logo",
          },
          { to: "/admin/billing", page: "admin.billing", label: "Plan and billing", icon: "card" },
          { to: "/admin/logs", page: "admin.logs", label: "Audit log", icon: "shield" },
        ],
      },
    ],
  },
  {
    key: "superadmin",
    label: "Platform",
    rail: "LoopLab",
    icon: "building",
    home: "/platform",
    role: "super_admin",
    blurb: "LoopLab operations across every tenant.",
    groups: [
      {
        label: null,
        items: [
          { to: "/platform", page: "superadmin.health", label: "Platform health", icon: "pulse", end: true },
          { to: "/platform/tenants", page: "superadmin.tenants", label: "Tenants", icon: "building" },
          { to: "/platform/branding", page: "superadmin.branding", label: "Branding", icon: "sparkle" },
          { to: "/platform/access", page: "superadmin.access", label: "Access control", icon: "lock" },
        ],
      },
      {
        label: "Revenue",
        items: [
          { to: "/platform/billing", page: "superadmin.billing", label: "Subscriptions", icon: "card" },
          { to: "/platform/audit", page: "superadmin.audit", label: "Access log", icon: "shield" },
        ],
      },
    ],
  },
];

export const ALL_NAV_ITEMS = PORTALS.flatMap((p) =>
  p.groups.flatMap((g) => g.items.map((i) => ({ ...i, portal: p.key }))),
);

/* Path to page key, for the route guard. */
export const PAGE_BY_PATH = Object.fromEntries(
  ALL_NAV_ITEMS.map((i) => [i.to, i.page]),
);

/*
  Paths that belong to no single portal.

  Your account is reachable from every portal's profile menu, so it
  cannot be filed under one of them. The shell resolves these to
  whichever portal the person is already in, otherwise the role lock
  would bounce everyone but a teacher off /account, since
  portalFromPath falls back to teacher.

  They carry no page key on purpose. An administrator switching off
  someone's ability to change their own password is not a setting worth
  offering.
*/
const NEUTRAL_PATHS = { "/account": "Your account" };

export function isNeutralPath(path) {
  return path in NEUTRAL_PATHS;
}

export function neutralLabel(path) {
  return NEUTRAL_PATHS[path] ?? null;
}

export function portalByKey(key) {
  return PORTALS.find((p) => p.key === key) ?? PORTALS[0];
}

export function portalForRole(role) {
  return PORTALS.find((p) => p.role === role) ?? PORTALS[0];
}

export function portalFromPath(path) {
  if (path.startsWith("/student")) return "student";
  if (path.startsWith("/parent")) return "parent";
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/platform")) return "superadmin";
  return "teacher";
}
