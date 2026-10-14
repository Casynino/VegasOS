"use server";

import { redirect } from "next/navigation";
import { logoutAction } from "@/app/staff/(auth)/login/actions";

/** Next's own marker on the error `redirect()` throws (checked by its digest, as the framework does). */
const isRedirect = (e: unknown) => typeof e === "object" && e !== null && typeof (e as { digest?: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");

/**
 * "Switch to a staff account": the Developer session ends through the SAME sign-out as everywhere (audit entry, session row
 * removed, cookie cleared) and only then the staff sign-in opens, with the Staff choice picked. Nothing of the Developer's
 * session survives, and the staff account must sign in with its own password — switching is never a shortcut into it.
 * It is not a permission: whoever calls it is only signed out.
 */
export async function switchToStaffAccountAction(): Promise<void> {
  try {
    await logoutAction();
  } catch (e) {
    // logoutAction ends by redirecting to the sign-in page; anything else is a real failure and must not look like a sign-out.
    if (!isRedirect(e)) throw e;
  }
  redirect("/staff/login?as=staff");
}
