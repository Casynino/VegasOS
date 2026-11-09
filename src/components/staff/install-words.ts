import { msg } from "@/i18n/msg";

/**
 * Every word the "Use it like an app" card (install-app.tsx) shows. The sign-in page ships only a short list of words to the browser, so
 * it spreads this list into its own (login/page.tsx); install-words.test.ts checks that no word of the card is missing here.
 */
export const INSTALL_WORDS = [
  msg("Close"),
  msg("Get the full-screen app"),
  msg("Get the app"),
  msg("Use it like an app"),
  msg("Full screen, no browser bar, its own icon."),
  msg("Install the app"),
  msg("Maybe later"),
  msg("Got it"),
  msg("this app"),
  msg("This page is open inside {app}, which cannot put it on the home screen. Tap the <b>···</b> (or three dots) at the top and choose <b>Open in {browser}</b> or <b>Open in browser</b>, then do these steps."),
  msg("Tap <b>Share</b> in Safari's toolbar (on newer iPhones it is under the <b>···</b> button)."),
  msg("Tap <b>Share</b> next to the address at the top."),
  msg("Scroll down and tap <b>Add to Home Screen</b>."),
  msg("Tap <b>Add</b>, then open <b>Vegas Hotel</b> from your home screen."),
  msg("Open <b>Vegas Hotel</b> from your home screen."),
  msg("Tap the menu at the bottom right."),
  msg("Tap <b>Add page to</b>, then <b>Home screen</b> (or <b>Install app</b> if you see it)."),
  msg("Open the browser menu (at the bottom, or the three dots at the top right)."),
  msg("Tap <b>Add to home screen</b> (some phones say <b>Add to desktop</b> or hide it under <b>Add to</b>), then confirm."),
  msg("Open the browser menu at the top right."),
  msg("Tap <b>Install</b>, then <b>Add</b>."),
  msg("Open the browser menu (the three dots, top right or bottom)."),
  msg("Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>."),
];
