import type { Viewport } from "next";

/**
 * How the staff app sits on a phone (every staff layout exports this): the page is exactly the screen's width and the phone never
 * zooms OUT to fit a wide part (minimum scale 1) — the app stays put, like an app. Pinching IN is still allowed (reading, accessibility).
 * Not used on the public website or the guests' pages.
 */
export const STAFF_VIEWPORT: Viewport = { width: "device-width", initialScale: 1, minimumScale: 1 };
