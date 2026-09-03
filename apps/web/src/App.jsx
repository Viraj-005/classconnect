import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/shell/Shell";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Account from "@/pages/Account";
import NotFound from "@/pages/NotFound";
import Splash, { hasSeenSplash } from "@/pages/Splash";
import { useTheme } from "@/theme/ThemeProvider";

import TeacherOverview from "@/portals/teacher/Overview";
import ContentLibrary from "@/portals/teacher/ContentLibrary";
import Students from "@/portals/teacher/Students";
import Fees from "@/portals/teacher/Fees";
import Tickets from "@/portals/teacher/Tickets";
import TeacherAttendance from "@/portals/teacher/Attendance";
import Marking from "@/portals/teacher/Marking";
import Schedule from "@/portals/teacher/Schedule";
import Analytics from "@/portals/teacher/Analytics";

import MyLearning from "@/portals/student/MyLearning";
import Resources from "@/portals/student/Resources";
import Quizzes from "@/portals/student/Quizzes";
import StudentPayments from "@/portals/student/Payments";
import Ticket from "@/portals/student/Ticket";
import StudentCalendar from "@/portals/student/Calendar";

import ParentProgress from "@/portals/parent/Progress";
import ParentAttendance from "@/portals/parent/Attendance";
import ParentPayments from "@/portals/parent/Payments";

import AdminOverview from "@/portals/admin/Overview";
import Batches from "@/portals/admin/Batches";
import People from "@/portals/admin/People";
import Branding from "@/portals/admin/Branding";
import Billing from "@/portals/admin/Billing";
import Logs from "@/portals/admin/Logs";
import AdminAccessControl from "@/portals/admin/AccessControl";

import PlatformHealth from "@/portals/superadmin/Health";
import Tenants from "@/portals/superadmin/Tenants";
import Subscriptions from "@/portals/superadmin/Subscriptions";
import AccessLog from "@/portals/superadmin/AccessLog";
import PlatformBranding from "@/portals/superadmin/Branding";
import PlatformAccessControl from "@/portals/superadmin/AccessControl";

/*
  Routes.

  Every authenticated route sits under Shell, which resolves the portal
  from the path and sets the identity tokens. Adding a screen is a
  route here plus an entry in components/shell/nav.js.

  Shell holds the guards: it redirects an unauthenticated visitor to
  the login screen, sends anyone who wanders into another role's portal
  back to their own, and refuses a page an administrator has switched
  off. All three are for the user experience. The server re-checks every
  one of them, and that is the security boundary.

  /account is the exception to the portal rule. It belongs to the person
  rather than to a portal, so it is registered here but not in nav.js,
  and the shell treats it as part of whichever portal they are in.
*/

export default function App() {
  const { status } = useTheme();
  /*
    Shown once per tab, over the app rather than instead of it, so the
    session resolves underneath and the splash is a beat rather than a
    wait. `ready` holds it until the session has settled, which avoids
    a flash of the login screen for someone who is already signed in.
  */
  const [splashDone, setSplashDone] = useState(hasSeenSplash);

  if (!splashDone) {
    return (
      <Splash onDone={() => setSplashDone(true)} ready={status !== "loading"} />
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Self serve onboarding onto the free plan. Public, like /login. */}
      <Route path="/signup" element={<Signup />} />

      <Route element={<Shell />}>
        <Route path="/teacher" element={<TeacherOverview />} />
        <Route path="/teacher/content" element={<ContentLibrary />} />
        <Route path="/teacher/students" element={<Students />} />
        <Route path="/teacher/fees" element={<Fees />} />
        <Route path="/teacher/tickets" element={<Tickets />} />
        <Route path="/teacher/attendance" element={<TeacherAttendance />} />
        <Route path="/teacher/marking" element={<Marking />} />
        <Route path="/teacher/schedule" element={<Schedule />} />
        <Route path="/teacher/analytics" element={<Analytics />} />

        <Route path="/student" element={<MyLearning />} />
        <Route path="/student/library" element={<Resources />} />
        <Route path="/student/quizzes" element={<Quizzes />} />
        <Route path="/student/payments" element={<StudentPayments />} />
        <Route path="/student/ticket" element={<Ticket />} />
        <Route path="/student/calendar" element={<StudentCalendar />} />

        <Route path="/parent" element={<ParentProgress />} />
        <Route path="/parent/attendance" element={<ParentAttendance />} />
        <Route path="/parent/payments" element={<ParentPayments />} />

        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/users" element={<People />} />
        <Route path="/admin/branding" element={<Branding />} />
        <Route path="/admin/billing" element={<Billing />} />
        <Route path="/admin/logs" element={<Logs />} />
        <Route path="/admin/batches" element={<Batches />} />
        <Route path="/admin/access" element={<AdminAccessControl />} />

        <Route path="/platform" element={<PlatformHealth />} />
        <Route path="/platform/tenants" element={<Tenants />} />
        <Route path="/platform/billing" element={<Subscriptions />} />
        <Route path="/platform/audit" element={<AccessLog />} />
        <Route path="/platform/branding" element={<PlatformBranding />} />
        <Route path="/platform/access" element={<PlatformAccessControl />} />

        <Route path="/account" element={<Account />} />

        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
