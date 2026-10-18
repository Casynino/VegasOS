/**
 * "QUIET" SESSIONS (owner, 2026-10-17): a Developer's session is short — 30 minutes without use ends it — so nothing may keep it awake
 * on its own. A page that refreshes itself, a bell that asks the server every few seconds, a board that checks for new orders: each of
 * those is a request that counts as the person USING the system, and one open tab would keep a Developer signed in for the full 4 hours.
 *
 * So for a Developer (in the console AND while working as someone) the layout says "quiet" and every background timer of the staff
 * application stays off: no polling, no automatic refresh, no alert sound. The page shows what it showed when it was opened; the Developer
 * refreshes it by hand. Staff are not quiet — nothing changes for them.
 *
 * Plain function, no server code: the layout (staff-shell.tsx) decides it from the signed-in account, the browser only receives the answer
 * (QuietProvider in components/staff/quiet.tsx).
 */
export const sessionIsQuiet = (user: { actorType: string }): boolean => user.actorType === "DEVELOPER";
