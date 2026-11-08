/*
  Shared by the server shell and the client sidebar, so it lives outside the "use client" file (a server component importing a
  constant from a client module would receive a client reference, not the value).
*/

/** Read by the staff shell so a folded sidebar is folded on the first paint (no opening and snapping shut). */
export const SIDEBAR_COOKIE = "vlh.sidebar";

/** The room the page leaves for the floating panel on a computer: open, and folded to the icon rail. */
export const SIDEBAR_ROOM = { open: "15.5rem", rail: "5.9rem" } as const;
