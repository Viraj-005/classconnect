import { useEffect, useState } from "react";
import { cx } from "@/lib/cx";
import { fetchLogo, fetchTenantLogo } from "@/lib/api";

/*
  An organisation's own logo, with initials as the fallback.

  Logos sit behind an authenticated endpoint, so this cannot be a plain
  `<img src>`: the request needs a bearer token. Each one is fetched
  once as a blob and the object URL is cached at module scope, because
  the platform tenant list renders one per row and a naive component
  would refetch the same image on every scroll and re-render.

  The cache is keyed on the content, not on the organisation.

  It used to be keyed on the org id, with the string "self" standing in
  for your own. Two separate bugs came out of that. Signing out of one
  organisation and into another left the first one's blob sitting under
  "self", so a tenant briefly rendered somebody else's logo in their own
  sidebar. And replacing a logo left the old one cached under the same
  key, so the new one did not appear until a hard refresh dropped the
  module state.

  Both are the same mistake: a cache key that does not change when the
  thing behind it changes. The fix is a version, a short hash of the
  storage key which the server sends alongside `hasLogo`. The storage
  key carries a random segment per upload, so the version differs
  between two organisations and differs again after every replace. Cache
  invalidation stops being something a caller has to remember.

  `clearLogoCache` on sign out is the belt to that pair of braces. It is
  not load bearing if every caller passes a version, but one that forgets
  should not be able to leak an image across a session boundary, and
  another tenant's bytes have no business outliving the session that
  fetched them.

  Two identities are kept apart on purpose and this renders only the
  first: an organisation's own logo, whether that organisation is a
  tenant or LoopLab itself. The ClassConnect product mark is a different
  thing entirely and lives in brand/Logo.jsx, because the software's
  name is not something anybody uploads.
*/

const cache = new Map();
const inflight = new Map();

function load(key, fetcher) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);

  const p = fetcher()
    .then((url) => {
      cache.set(key, url);
      inflight.delete(key);
      return url;
    })
    .catch((err) => {
      /* Remember the miss too, so a tenant with no logo is not asked
         for on every render. */
      cache.set(key, null);
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p);
  return p;
}

/*
  Drop everything on sign out. Revoking here is safe in a way it is not
  during normal use: nothing is mounted that could be displaying one of
  these, because the session that rendered them is over.
*/
export function clearLogoCache() {
  for (const url of cache.values()) {
    if (url) URL.revokeObjectURL(url);
  }
  cache.clear();
  inflight.clear();
}

/**
 * @param {object} props
 * @param {string} props.name        used for the initials fallback
 * @param {boolean} props.hasLogo    skip the request when we already know there is none
 * @param {string} [props.version]   changes when the logo changes, and keys the cache
 * @param {string} [props.orgId]     a tenant, for the platform screens. Omit for your own.
 */
export function OrgLogo({
  name,
  hasLogo,
  version,
  orgId,
  size = 32,
  radius = "var(--radius-sm)",
  className,
  style,
}) {
  const key = `${orgId ?? "self"}::${version ?? ""}`;
  const [src, setSrc] = useState(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!hasLogo) {
      setSrc(null);
      return;
    }
    if (cache.has(key)) {
      setSrc(cache.get(key));
      return;
    }
    /* Clear first. Without this the previous logo stays on screen while
       the new one is in flight, which is the stale render the version
       exists to prevent, just narrower. */
    setSrc(null);
    let live = true;
    load(key, () => (orgId ? fetchTenantLogo(orgId, version) : fetchLogo(version)))
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [key, orgId, version, hasLogo]);

  const initials = (name || "?").slice(0, 2).toUpperCase();

  return (
    <span
      className={cx(
        "inline-flex items-center justify-center shrink-0 overflow-hidden",
        "font-display font-bold",
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius, ...style }}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => {
            /* The file went missing behind the metadata. Fall back
               rather than showing a broken image icon. */
            cache.set(key, null);
            setSrc(null);
          }}
        />
      ) : (
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.36)) }}>{initials}</span>
      )}
    </span>
  );
}
