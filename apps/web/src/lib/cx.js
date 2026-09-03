/* Small join helper. No dependency needed for what is a one liner. */
export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/*
  Money.

  LKR is the default because it is the currency the product runs in:
  every student fee is stored in it, and the platform bills its tenants
  in it. USD and EUR exist only for the multi_currency Pro feature,
  where a tenant charges its own students in something else.

  No decimals anywhere. Rupee amounts run to five and six figures and
  ".00" on every one of them is noise in a table.
*/
export function formatMoney(amount, currency = "LKR") {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "Rs ";
  return `${symbol}${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/*
  The same, shortened, for headline figures and chart axes.

  Rupee sums are an order of magnitude longer than the dollar figures
  this design was first laid out with, so the exact form overflows a KPI
  cell. "Rs 1.3M" fits and is the number a reader wants at a glance.
*/
export function formatMoneyCompact(amount, currency = "LKR") {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "Rs ";
  return `${symbol}${formatCompact(amount)}`;
}

export function formatCompact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export function initialsOf(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => (p[0] ?? "").toUpperCase())
    .join("");
}

/*
  Stable pseudo random in 0..1 from a string, so generated avatar hues
  stay the same for the same person across every screen and across
  reloads, instead of flickering on each render.
*/
export function seeded(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function relativeTime(isoString) {
  const then = new Date(isoString).getTime();
  const diff = Math.round((Date.now() - then) / 1000);
  if (Math.abs(diff) < 60) return "just now";
  const mins = Math.round(diff / 60);
  if (Math.abs(mins) < 60) return mins > 0 ? `${mins}m ago` : `in ${-mins}m`;
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return hrs > 0 ? `${hrs}h ago` : `in ${-hrs}h`;
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 30) return days > 0 ? `${days}d ago` : `in ${-days}d`;
  const months = Math.round(days / 30);
  return months > 0 ? `${months}mo ago` : `in ${-months}mo`;
}

export function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDay(isoString) {
  return new Date(isoString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysUntil(isoString) {
  return Math.ceil((new Date(isoString).getTime() - Date.now()) / 86_400_000);
}

export function pluralize(n, one, many) {
  return n === 1 ? one : (many ?? `${one}s`);
}
