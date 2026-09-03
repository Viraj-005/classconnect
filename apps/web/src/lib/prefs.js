/*
  Device local preferences.

  These are settings that belong to this browser rather than to the
  account: whether the sidebar starts collapsed, and so on. They are not
  sent to the server, so signing in on a different machine deliberately
  starts from the defaults.

  The store exists because two places need the same value. The shell
  owns the sidebar, and the preferences screen sets it, and writing
  localStorage from one does not tell the other anything. Subscribers
  are notified on every write, so the sidebar moves while you are
  looking at the toggle rather than after the next reload.

  Reads and writes are wrapped because Safari private mode throws on
  localStorage access rather than returning null. A preference that will
  not persist is not worth crashing a page over.
*/

const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* Will not persist past this tab. The in memory value still applies. */
  }
  emit();
}

/*
  Sidebar collapsed. Read through a hoisted function rather than an
  inline arrow, because useSyncExternalStore calls getSnapshot on every
  render and compares with Object.is. A boolean is stable, but keeping
  the function identity stable too avoids resubscribing needlessly.
*/
const NAV_COLLAPSED = "cc.nav-collapsed";

export function getNavCollapsed() {
  return read(NAV_COLLAPSED, false);
}

export function setNavCollapsed(value) {
  write(NAV_COLLAPSED, value);
}
