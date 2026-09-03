import { clearLogoCache } from "@/components/ui/OrgLogo";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { auth, tokens } from "@/lib/api";
import {
  atLightness,
  buildRamp,
  gradientFrom,
  readableOn,
  rotateHue,
  withAlpha,
} from "./color";

/*
  Session and theme.

  One provider, because the two are the same concern in this product:
  who you are decides which organisation's branding paints the page.

  It does four jobs:
    1. Bootstraps the session from GET /auth/session.
    2. Writes tenant branding into CSS variables, tier gated server side.
    3. Derives the four tenant portal identities from the brand hue.
    4. Holds the Super Admin colour scheme, which is the one surface the
       viewer controls rather than the tenant.
*/

const ThemeContext = createContext(null);

const LOOPLAB_PLUM = "#613380";
const SCHEME_KEY = "cc.platform-scheme";

/*
  Portal identity as a hue rotation from the tenant's own brand colour,
  rather than five fixed palettes.

  ARCHITECTURE.md section 10.2 asks for two things at once: each portal
  recognisable from a screenshot alone, AND that holding true under a
  tenant re-skin. Fixed palettes satisfy the first and break the second.
  A fixed angular separation satisfies both.

  Super Admin is deliberately absent. It is the LoopLab platform layer,
  not a tenant surface, so it holds LoopLab plum permanently and does
  not follow whichever tenant an operator happens to be looking at.
*/
const PORTAL_HUE_OFFSET = {
  teacher: 0,
  student: 150,
  parent: 68,
  admin: -44,
};

function setVars(entries) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(entries)) {
    root.style.setProperty(name, value);
  }
}

/*
  The sidebar palette for one hue.

  Kept as its own function because the sidebar is the single most
  identity carrying surface in the product: it is the one element in
  every screenshot, so it is what a tenant's brand has to reach first.
  Deriving it from the hue rather than using a neutral charcoal is the
  difference between a branded product and a dark grey admin template.
*/
function sidebarVars(prefix, hue, { deep = 0.075, base = 0.105, soft = 0.155 } = {}) {
  return {
    [`${prefix}-sb-bg`]: atLightness(hue, base, 0.5),
    [`${prefix}-sb-bg-deep`]: atLightness(hue, deep, 0.55),
    [`${prefix}-sb-bg-soft`]: atLightness(hue, soft, 0.44),
    [`${prefix}-sb-fg`]: atLightness(hue, 0.95, 0.16),
    [`${prefix}-sb-fg-dim`]: atLightness(hue, 0.66, 0.18),
  };
}

function applyPortalIdentity(baseHex) {
  for (const [portal, offset] of Object.entries(PORTAL_HUE_OFFSET)) {
    const hue = rotateHue(baseHex, offset);
    const ramp = buildRamp(hue);
    const accent = ramp["600"];
    setVars({
      [`--p-${portal}-accent`]: accent,
      [`--p-${portal}-accent-hover`]: ramp["700"],
      [`--p-${portal}-accent-soft`]: ramp["100"],
      [`--p-${portal}-contrast`]: readableOn(accent),
      [`--p-${portal}-halo`]: withAlpha(accent, 0.16),
      /*
        Chips inside the sidebar (the mark, the org initials) use this
        rather than the brand gradient. Built from the same stops as
        gradientFrom so the weight matches the brand version exactly,
        only the hue differs.
      */
      [`--p-${portal}-gradient`]: gradientFrom(ramp),
      [`--p-${portal}-rail`]: atLightness(hue, 0.14, 0.42),
      [`--p-${portal}-rail-fg`]: atLightness(hue, 0.78, 0.2),
      /*
        The active nav item uses a light stop of the hue, not the 600
        accent. On a near black sidebar the 600 stop is too dark to read
        as selected, which is why the old pale pill looked washed out.
      */
      [`--p-${portal}-sb-active`]: ramp["300"],
      [`--p-${portal}-sb-active-fg`]: readableOn(ramp["300"]),
      [`--p-${portal}-sb-glow`]: withAlpha(ramp["400"], 0.28),
      ...sidebarVars(`--p-${portal}`, hue),
    });
  }
}

/*
  Super Admin identity. Always LoopLab plum, in both schemes.

  The accent has to differ between light and dark or it fails contrast
  at one end: a 600 stop vanishes into a near black shell, and a 300
  stop washes out on white. Same hue, different stop.
*/
function applyPlatformIdentity(scheme) {
  const ramp = buildRamp(LOOPLAB_PLUM);
  const dark = scheme === "dark";
  const accent = dark ? ramp["300"] : ramp["600"];
  setVars({
    "--p-superadmin-accent": accent,
    "--p-superadmin-accent-hover": dark ? ramp["200"] : ramp["700"],
    "--p-superadmin-accent-soft": dark ? withAlpha(ramp["300"], 0.16) : ramp["100"],
    "--p-superadmin-contrast": readableOn(accent),
    "--p-superadmin-halo": withAlpha(accent, dark ? 0.22 : 0.16),
    /*
      Deliberately not the scheme dependent accent. The accent goes
      light in dark mode, which would make a pale chip on a near
      black sidebar. The chip holds the mid stops in both schemes.
    */
    "--p-superadmin-gradient": gradientFrom(ramp),
    "--p-superadmin-chip-contrast": readableOn(ramp["600"]),
    "--p-superadmin-rail": dark ? atLightness(LOOPLAB_PLUM, 0.07, 0.4) : ramp["900"],
    "--p-superadmin-rail-fg": atLightness(LOOPLAB_PLUM, 0.76, 0.24),
    "--p-superadmin-sb-active": ramp["300"],
    "--p-superadmin-sb-active-fg": readableOn(ramp["300"]),
    "--p-superadmin-sb-glow": withAlpha(ramp["400"], 0.3),
    /*
      The platform sidebar stays dark in both schemes, and goes a shade
      deeper than a tenant's so the console reads as a different place
      even beside a plum branded tenant.
    */
    ...sidebarVars("--p-superadmin", LOOPLAB_PLUM, {
      deep: 0.05,
      base: 0.075,
      soft: 0.12,
    }),
  });
}

function applyBranding(org, previewHex, features) {
  /*
    Branding is tier gated on the server, which strips fields the tenant
    is not entitled to before they reach us. The feature list is checked
    again here only so a live preview cannot paint something the tenant
    could not save.
  */
  const mayBrand = features.includes("branding_logo");
  const chosen = previewHex ?? (mayBrand ? org?.branding?.primaryColor : null);
  const base = chosen ?? LOOPLAB_PLUM;

  const ramp = buildRamp(base);
  const brandVars = {};
  for (const [stop, hex] of Object.entries(ramp)) {
    brandVars[`--brand-${stop}`] = hex;
  }
  brandVars["--brand-gradient"] = gradientFrom(ramp);
  brandVars["--brand-contrast"] = readableOn(ramp["600"]);
  setVars(brandVars);

  applyPortalIdentity(base);

  const maySecondary = features.includes("branding_palette");
  const secondary = org?.branding?.secondaryColor;
  if (maySecondary && secondary) {
    const acc = buildRamp(secondary);
    setVars({
      "--accent-100": acc["100"],
      "--accent-200": acc["200"],
      "--accent-500": acc["500"],
      "--accent-600": acc["600"],
    });
  } else {
    for (const k of ["100", "200", "500", "600"]) {
      document.documentElement.style.removeProperty(`--accent-${k}`);
    }
  }
}

function readScheme() {
  try {
    const stored = localStorage.getItem(SCHEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* Storage blocked. Fall through to the system preference. */
  }
  /* Dark by default: the platform console is an operator tool. */
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [scheme, setSchemeState] = useState(readScheme);

  const loadSession = useCallback(async () => {
    if (!tokens.access) {
      setSession(null);
      setStatus("anonymous");
      return null;
    }
    try {
      const next = await auth.session();
      setSession(next);
      setStatus("authenticated");
      setError(null);
      return next;
    } catch (err) {
      // 401 means the token is gone or stale, which is an anonymous
      // state rather than an error worth showing the user.
      if (err?.status === 401) {
        tokens.clear();
        setSession(null);
        setStatus("anonymous");
        return null;
      }
      setError(err);
      setStatus("error");
      return null;
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const features = useMemo(() => session?.features ?? [], [session]);

  useEffect(() => {
    applyBranding(session?.org, preview, features);
  }, [session, preview, features]);

  useEffect(() => {
    applyPlatformIdentity(scheme);
    document.documentElement.setAttribute("data-scheme", scheme);
  }, [scheme]);

  const setScheme = useCallback((next) => {
    setSchemeState(next);
    try {
      localStorage.setItem(SCHEME_KEY, next);
    } catch {
      /* Preference simply will not persist. */
    }
  }, []);

  /*
    Sign in has two outcomes now.

    A password alone either produces a session or produces a demand for
    a second factor, and the caller has to be able to tell them apart,
    so this returns the raw result rather than always loading a session.
    The session is only fetched once there really is one.
  */
  const signIn = useCallback(
    async (credentials) => {
      const res = await auth.login(credentials);
      if (res?.twoFactorRequired) return res;
      const session = await loadSession();
      return { session };
    },
    [loadSession],
  );

  const completeTwoFactor = useCallback(
    async (payload) => {
      await auth.completeTwoFactor(payload);
      return loadSession();
    },
    [loadSession],
  );

  /* Self serve onboarding. Lands the new admin straight in their own
     tenant, because a signup that ends at a login form has thrown away
     the one moment the person was certain they wanted this. */
  const signUp = useCallback(
    async (body) => {
      const res = await auth.signup(body);
      await loadSession();
      return res;
    },
    [loadSession],
  );

  const signOut = useCallback(() => {
    auth.logout();
    /* Drop the cached logo blobs with the session. They were fetched
       with this user's token and belong to this user's organisation, so
       they have no business surviving into whoever signs in next. */
    clearLogoCache();
    setSession(null);
    setStatus("anonymous");
  }, []);

  const can = useCallback((feature) => features.includes(feature), [features]);

  /*
    Page access. Resolved by the server and re-checked by the server on
    every guarded route. This is for hiding what the user cannot reach,
    which is a courtesy, not the enforcement.
  */
  const canPage = useCallback(
    (pageKey) => session?.pageAccess?.[pageKey] ?? false,
    [session],
  );

  const value = useMemo(
    () => ({
      session,
      status,
      error,
      org: session?.org ?? null,
      user: session?.user ?? null,
      features,
      pageAccess: session?.pageAccess ?? {},
      can,
      canPage,
      scheme,
      setScheme,
      signIn,
      completeTwoFactor,
      signUp,
      signOut,
      reload: loadSession,
      /* Live preview without persisting, used by the branding screen. */
      previewAccent: setPreview,
      preview,
      /* Applied locally after a save so the UI does not wait for a refetch. */
      patchOrg: (partial) =>
        setSession((s) => (s ? { ...s, org: { ...s.org, ...partial } } : s)),
      patchUser: (partial) =>
        setSession((s) => (s ? { ...s, user: { ...s.user, ...partial } } : s)),
    }),
    [
      session,
      status,
      error,
      features,
      can,
      canPage,
      scheme,
      setScheme,
      signIn,
      completeTwoFactor,
      signUp,
      signOut,
      loadSession,
      preview,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export function useOrg() {
  return useTheme().org;
}
export function useSessionUser() {
  return useTheme().user;
}
export function useCan() {
  return useTheme().can;
}
export function useCanPage() {
  return useTheme().canPage;
}
