/**
 * Entries that are NOT work: sign-ins and sign-outs, the Developer's own looking, checking and taking data out, refusals and failed
 * attempts (nothing was saved), and the automatic notes about Work as. They are kept in the database (and have their own charts and
 * lists on the Developer's console), but they are left out of every "actions" count on the console, as the captions say ("Sign-ins and just
 * looking are not counted"). Starting or stopping Work as is a thing the Developer did on purpose, so those two still count as work.
 */
export const NOT_WORK_ACTIONS: readonly string[] = [
  // sign-ins
  "auth.login", "auth.logout", "auth.login_failed", "auth.login_failed_suppressed",
  // looking, checking, taking data out
  "developer.viewed", "developer.viewed_limit", "developer.business_viewed", "developer.inspected", "developer.exported", "developer.downloaded",
  // refused or failed: nothing was saved
  "developer.denied", "developer.work_as_refused", "developer.endpoint_refused", "settings.update.refused",
  "user.suspend_failed", "user.reactivate_failed", "user.sign_out_failed", "user.create_failed", "user.delete_failed",
  // automatic notes about Work as
  "developer.work_as_expired", "developer.work_as_notice", "developer.access_notice",
];

/**
 * What the Audit pages (the Developer's, the Boss's and the MD's, and the Staff activity page) leave out of a Developer's trail (owner, 2026-10-19:
 * "when I log in or try to change, that track should not be there — only when I make a change, modify, add or remove something do you leave a track"):
 * everything that is not a change — signing in and out, looking at a page, checking, taking data out, refused or failed tries, and the notes about Work as,
 * including starting and stopping it (the Boss is still told on WhatsApp when a Work as starts). The rows stay in the database for the Developer's own
 * console (Security, Activity), so nothing is lost; only what a Developer actually changed is listed.
 */
export const DEVELOPER_UNSHOWN_ACTIONS: readonly string[] = [...NOT_WORK_ACTIONS, "developer.work_as_started", "developer.work_as_ended"];
