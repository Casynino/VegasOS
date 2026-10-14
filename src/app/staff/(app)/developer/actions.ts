"use server";

import { getCurrentUser } from "@/server/auth";
import { trackDeveloperViewNow } from "@/server/services/developer-view-log";

/**
 * Called by the beacon when a Developer moves to another page without a full reload (the layout is not drawn again then, so it
 * cannot see the move). It takes NO address from the browser: the page is read on the server from this very request, the person
 * from the session, and the list of harmless pages, the 10-minute rule and the writing are all in developer-view-log.ts.
 * Anyone who is not a Developer gets nothing done. Never throws.
 */
export async function recordDeveloperView(): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (user?.actorType === "DEVELOPER") await trackDeveloperViewNow(user);
  } catch { /* looking must never break the page */ }
}
