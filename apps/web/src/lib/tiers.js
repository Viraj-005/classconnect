/*
  Client side mirror of the backend feature gate.

  This exists so the UI can show an upgrade state instead of a dead
  control or a raw 403. It is NOT the enforcement point. The server
  checks the same matrix in app/services/feature_gate_service.py and
  that is the only check that counts. Keep the two in sync.
*/

/** @typedef {import("./types").PackageTier} PackageTier */

const MATRIX = {
  qr_ticketing: ["growth", "pro"],
  payment_gateway: ["growth", "pro"],
  multi_currency: ["pro"],
  analytics_full: ["growth", "pro"],
  analytics_export: ["pro"],
  branding_logo: ["growth", "pro"],
  branding_palette: ["pro"],
  custom_domain: ["pro"],
  priority_support: ["growth", "pro"],
};

export const FEATURES = Object.keys(MATRIX);

export const TIER_LABEL = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};

export const TIER_ORDER = ["free", "starter", "growth", "pro"];

/* The tiers a tenant can buy. Free is a plan you are on, not one you
   pick off a pricing table, so the comparison screens iterate this. */
export const PAID_TIERS = ["starter", "growth", "pro"];

export const FREE_TIER = "free";

export function isFree(tier) {
  return tier === FREE_TIER;
}

/* Infinity means no cap on that tier. */
export const TIER_LIMITS = {
  free: { students: 25, teachers: 2 },
  starter: { students: 100, teachers: 5 },
  growth: { students: 500, teachers: 25 },
  pro: { students: Infinity, teachers: Infinity },
};

/*
  Monthly platform subscription, in LKR. Mirrors TIER_PRICE in
  apps/api/app/services/tier_policy.py, which is the authority.

  Not to be confused with student fees. Those are a tenant's own money
  and may be in another currency on Pro. This is what LoopLab charges
  the tenant, and it is LKR only.
*/
export const TIER_PRICE = {
  free: 0,
  starter: 7500,
  growth: 25000,
  pro: 75000,
};

/**
 * @param {PackageTier} tier
 * @param {string} feature
 * @returns {boolean}
 */
export function hasFeature(tier, feature) {
  const allowed = MATRIX[feature];
  if (!allowed) {
    /* An unknown key is a bug, not a free pass. Fail closed. */
    console.warn(`Unknown feature key: ${feature}`);
    return false;
  }
  return allowed.includes(tier);
}

/* The lowest tier that unlocks a feature, used to word the upgrade prompt. */
export function requiredTier(feature) {
  const tiers = MATRIX[feature] ?? [];
  return TIER_ORDER.find((t) => tiers.includes(t)) ?? "pro";
}

/**
 * Seat usage against the tier cap.
 * @param {PackageTier} tier
 * @param {number} used
 * @param {"students" | "teachers"} kind
 */
export function seatUsage(tier, used, kind) {
  const cap = TIER_LIMITS[tier][kind];
  const unlimited = cap === Infinity;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / cap) * 100));
  return {
    cap,
    unlimited,
    pct,
    /* Warn before the tenant hits the wall mid task, not at 100 percent. */
    nearingCap: !unlimited && pct >= 80,
    atCap: !unlimited && used >= cap,
    label: unlimited ? `${used} of unlimited` : `${used} of ${cap}`,
  };
}

export const FEATURE_COPY = {
  qr_ticketing: {
    name: "QR class tickets",
    blurb:
      "Issue a scannable 30 day ticket the moment a fee clears, and validate it at the door.",
  },
  payment_gateway: {
    name: "Online fee collection",
    blurb: "Take fees through Stripe and PayPal instead of tracking them by hand.",
  },
  multi_currency: {
    name: "Multiple currencies",
    blurb: "Charge each batch in its own currency and reconcile in one place.",
  },
  analytics_full: {
    name: "Full analytics",
    blurb:
      "Engagement over time, revenue by month, and quiz pass rates, not just headline counts.",
  },
  analytics_export: {
    name: "Data export",
    blurb: "Pull any dashboard out as CSV for your own reporting.",
  },
  branding_logo: {
    name: "Your logo and accent",
    blurb: "Replace the ClassConnect mark with your own and set one accent colour.",
  },
  branding_palette: {
    name: "Full palette control",
    blurb: "Drive the entire interface from your brand palette, charts included.",
  },
  custom_domain: {
    name: "Custom domain",
    blurb: "Serve the portal from your own domain instead of a ClassConnect subdomain.",
  },
  priority_support: {
    name: "Priority support",
    blurb: "Named contact and a one business day response target.",
  },
};

/* Plan comparison rows, used on the billing and upgrade screens. */
export const PLAN_MATRIX = [
  { label: "Students", free: "Up to 25", starter: "Up to 100", growth: "Up to 500", pro: "Unlimited" },
  { label: "Teachers", free: "Up to 2", starter: "Up to 5", growth: "Up to 25", pro: "Unlimited" },
  { label: "Content upload", free: true, starter: true, growth: true, pro: true },
  { label: "Parent portal", free: true, starter: true, growth: true, pro: true },
  { label: "Class schedule", free: true, starter: true, growth: true, pro: true },
  {
    label: "Fee management",
    free: "Manual only",
    starter: "Manual only",
    growth: "Stripe and PayPal",
    pro: "Multi gateway, multi currency",
  },
  { label: "QR ticketing", free: false, starter: false, growth: true, pro: true },
  {
    label: "Analytics",
    free: "Counts only",
    starter: "Counts only",
    growth: "Full dashboards",
    pro: "Full plus export",
  },
  {
    label: "Custom branding",
    free: false,
    starter: false,
    growth: "Logo and one accent",
    pro: "Full palette and domain",
  },
  {
    label: "Support",
    free: "Community",
    starter: "Community and email",
    growth: "Priority email",
    pro: "Dedicated",
  },
];

/*
  What one step up actually buys, worked out from the matrix above
  rather than written as sales copy.

  Free to Starter is the case that forces this shape: it unlocks no
  features at all, only room, so a prompt that leads with a feature list
  would show an empty one. Callers read `seats` first and fall back to
  `features` only when there is something in it.
*/
export function upgradeGain(from, to) {
  const seats = ["students", "teachers"]
    .filter((k) => TIER_LIMITS[to][k] > TIER_LIMITS[from][k])
    .map((k) => ({
      kind: k,
      from: TIER_LIMITS[from][k],
      to: TIER_LIMITS[to][k],
    }));
  const features = FEATURES.filter(
    (f) => MATRIX[f].includes(to) && !MATRIX[f].includes(from),
  );
  return { seats, features };
}
