import type { Metadata, Viewport } from "next";

/**
 * How the staff app sits on a phone (every staff layout exports this): the page is exactly the screen's width and the phone never
 * zooms OUT to fit a wide part (minimum scale 1) — the app stays put, like an app. Pinching IN is still allowed (reading, accessibility).
 * The browser's own bars (status bar, address bar) take the app's dark colour instead of a white strip.
 * Not used on the public website or the guests' pages.
 */
export const STAFF_VIEWPORT: Viewport = { width: "device-width", initialScale: 1, minimumScale: 1, themeColor: "#0b0906" };

/**
 * Lets staff add the app to the home screen of a phone or tablet (Share → Add to Home Screen; on Android: Install app) and open it
 * FULL SCREEN, like an app, with its own icon and no browser bar (owner, 2026-11-09). The manifest is only linked from the staff pages,
 * so the public website and the guests' pages are not offered as an app. The status bar on an iPhone is solid black (the app is dark).
 */
export const STAFF_APP_METADATA: Metadata = {
  manifest: "/staff.webmanifest",
  appleWebApp: { capable: true, title: "Vegas Hotel", statusBarStyle: "black" },
  // Next writes only `mobile-web-app-capable`; older iPhones look for Apple's own name.
  other: { "apple-mobile-web-app-capable": "yes" },
};

/** Painted from the very first frame (before the app wakes up), so the phone's bars and the pull-past-the-end area are dark, never white. Same colour as the staff night mode. */
export const STAFF_PAINT = "html,body{background:oklch(0.17 0.009 70)}";
