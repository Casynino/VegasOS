import type { Metadata, Viewport } from "next";

/**
 * The staff app's ONE dark colour (owner, 2026-11-09: it must look like one full screen on every phone, the way Target Express does).
 * The same value is the first paint, the phone's bar colour, the launch pictures (public/brand/splash) and the manifest colours.
 * It is a plain hex on purpose: an older phone browser that does not know oklch() would ignore the colour and show a white page.
 */
export const STAFF_NIGHT = "#0c0a07";

/**
 * How the staff app sits on a phone (every staff layout exports this):
 * - the page is exactly the screen's width and the phone never zooms OUT to fit a wide part (minimum scale 1) — the app stays put, like an
 *   app. Pinching IN is still allowed (reading, accessibility);
 * - edge to edge (viewport-fit=cover): the page runs under the notch / Dynamic Island and the home indicator, and the staff shell keeps its
 *   own margins with env(safe-area-inset-*) (top bar, tab bar, sides in landscape, pop-ups, toasts). Without this the home-screen app on an
 *   iPhone shows a strip under the tab bar and no safe-area padding works;
 * - the bars take the app's dark colour, and the app says it is already dark, so Samsung Internet, Huawei's browser and Chrome's "darken
 *   websites" leave its colours alone and native controls and scrollbars start dark.
 * Not used on the public website or the guests' pages.
 */
export const STAFF_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  viewportFit: "cover",
  themeColor: STAFF_NIGHT,
  colorScheme: "dark",
};

/**
 * iPhone and iPad screens (points wide, high, pixel ratio) that have a launch picture in public/brand/splash (a night ground with the hotel
 * badge). iOS builds no launch screen from the manifest: without a picture of EXACTLY the screen's size the home-screen app opens on a white
 * flash. Regenerated from public/brand/logo-512.png by a one-off script; add a new phone's size here and as a file named WxH@R.png.
 */
const SPLASH: readonly (readonly [number, number, number])[] = [
  // iPhone
  [440, 956, 3], [430, 932, 3], [428, 926, 3], [420, 912, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [402, 874, 3], [393, 852, 3],
  [390, 844, 3], [375, 812, 3], [375, 667, 2], [320, 568, 2],
  // iPad (upright)
  [1032, 1376, 2], [1024, 1366, 2], [834, 1194, 2], [834, 1112, 2], [820, 1180, 2], [810, 1080, 2], [768, 1024, 2], [744, 1133, 2],
];

/**
 * Lets staff put the app on the home screen of a phone or tablet (iPhone: Share → Add to Home Screen; Android: Install app) and open it
 * FULL SCREEN, like an app, with its own icon and no browser bar (owner, 2026-11-09). The manifest is only linked from the staff pages,
 * so the public website and the guests' pages are not offered as an app. On an iPhone the app runs under the status bar
 * (black-translucent, white clock) and the staff shell paints that strip itself (see .staff-status-strip in globals.css).
 */
export const STAFF_APP_METADATA: Metadata = {
  manifest: "/staff.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Vegas Hotel",
    statusBarStyle: "black-translucent",
    startupImage: SPLASH.map(([w, h, r]) => ({
      url: `/brand/splash/${w}x${h}@${r}.png`,
      media: `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })),
  },
  // Next writes only `mobile-web-app-capable`; older iPhones look for Apple's own name (and need it for the launch pictures).
  other: { "apple-mobile-web-app-capable": "yes" },
};

/** Painted from the very first frame (before the app wakes up), so the phone's bars and the pull-past-the-end area are dark, never white. */
export const STAFF_PAINT = `html,body{background:${STAFF_NIGHT};color-scheme:dark}`;
