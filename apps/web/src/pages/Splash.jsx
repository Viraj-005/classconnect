import { useEffect, useState } from "react";
import { cx } from "@/lib/cx";
import { AppIcon } from "@/brand/Logo";

/*
  Splash screen.

  Shown once per tab while the session resolves, then it fades out. Two
  rules keep it from being the thing everyone hates about splash
  screens:

    1. It never blocks. The app boots underneath it, and the minimum
       display time is short enough that on a warm cache it is a beat,
       not a wait.
    2. It only runs once per tab. sessionStorage, not localStorage, so
       reopening the app in a new tab shows it and clicking around does
       not.

  The app icon arrives rather than fades. It lifts and settles once,
  which is the gesture an app icon makes when it opens, and it is the
  same artwork the launcher and the browser tab show, so the splash
  confirms you opened the thing you tapped.

  It replaced a stroke drawing animation, which the current mark cannot
  do: the book is a filled shape, and there is no outline to trace.
*/

const SEEN_KEY = "cc.splash-seen";
const DRAW_MS = 1500;
const FADE_MS = 420;

export function hasSeenSplash() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Storage blocked. Treat it as seen so a private window is not
    // greeted by the splash on every single navigation.
    return true;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* Nothing to remember it with. Harmless. */
  }
}

export default function Splash({ onDone, ready = true }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Hold for the animation, then wait for the session if it is still
    // in flight. Whichever finishes last decides.
    const timer = setTimeout(() => setLeaving(true), DRAW_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!leaving || !ready) return undefined;
    const timer = setTimeout(() => {
      markSeen();
      onDone();
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving, ready, onDone]);

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden",
        "transition-opacity ease-[var(--ease-out)]",
        leaving && ready ? "opacity-0" : "opacity-100",
      )}
      style={{
        background: "var(--brand-gradient)",
        transitionDuration: `${FADE_MS}ms`,
      }}
      role="status"
      aria-label="Loading ClassConnect"
    >
      {/* Same grid motif as the login panel, so the two read as one place. */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.12]" aria-hidden="true">
        <defs>
          <pattern id="splash-grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M44 0H0v44" fill="none" stroke="white" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#splash-grid)" />
      </svg>

      {/* A soft bloom behind the mark, so it sits in light rather than on a flat fill. */}
      <div
        className="absolute size-[420px] rounded-full blur-[90px] opacity-40"
        style={{ background: "rgba(255,255,255,0.5)" }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center">
        <div
          className="rounded-[26px] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.45)]"
          style={{ animation: "cc-icon-in 720ms var(--ease-out) both" }}
        >
          <AppIcon size={104} title="" />
        </div>

        <div
          className="mt-6 text-center"
          style={{ animation: "cc-fade-up 520ms 620ms var(--ease-out) both" }}
        >
          <h1 className="font-display font-bold text-2xl tracking-tight text-white">
            ClassConnect
          </h1>
          <p className="text-xs text-white/70 mt-1.5 tracking-wide">A LoopLab product</p>
        </div>

        {/* Indeterminate sweep. It is not a progress bar, and it does
            not pretend to be one by counting to a number it cannot know. */}
        <div
          className="mt-8 h-0.5 w-40 rounded-full overflow-hidden bg-white/15"
          style={{ animation: "cc-fade-up 520ms 780ms var(--ease-out) both" }}
        >
          <div
            className="h-full w-1/2 rounded-full bg-white/80"
            style={{ animation: "cc-sweep 1.1s var(--ease-in-out) infinite" }}
          />
        </div>
      </div>

      <p
        className="absolute bottom-8 text-2xs text-white/55 tracking-wide"
        style={{ animation: "cc-fade-up 520ms 900ms var(--ease-out) both" }}
      >
        Every classroom, kept separate
      </p>
    </div>
  );
}
