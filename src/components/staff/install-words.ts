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
  msg("Share"),
  msg("Install the app"),
  msg("Maybe later"),
  msg("This app"),
  msg("{app} cannot add this to the home screen. Tap <b>···</b> (or the three dots) at the top, then <b>Open in {browser}</b>."),
  msg("Tap <b>Share</b> (bottom, or <b>···</b>)."),
  msg("Tap <b>Share</b> (address bar or menu)."),
  msg("Tap <b>Add to Home Screen</b>."),
  msg("Tap <b>Add</b>, then open <b>Vegas Hotel</b>."),
  msg("Open <b>Vegas Hotel</b> from your home screen."),
  msg("Tap the menu at the bottom right."),
  msg("Tap <b>Add page to</b>, then <b>Home screen</b>."),
  msg("Open the browser menu (at the bottom or top right)."),
  msg("Tap <b>Add to home screen</b> (or <b>Add to desktop</b>), then confirm."),
  msg("Open the browser menu at the top right."),
  msg("Tap <b>Install</b>, then <b>Add</b>."),
  msg("Open the browser menu (the three dots, top right or bottom)."),
  msg("Tap <b>Install app</b> or <b>Add to Home screen</b>."),
];
