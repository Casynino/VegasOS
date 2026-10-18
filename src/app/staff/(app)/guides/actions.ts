"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getCurrentUser, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { GUIDE_FILE } from "@/lib/guide-books";
import { removeStoredGuide } from "@/server/services/guide-books";
import { msg } from "@/i18n/msg";

/** Only the Developer, signed in as himself, puts books in or takes them out: checked here again, on the server. */
async function developer() {
  const user = await getCurrentUser();
  if (!user || user.workAs || user.actorType !== "DEVELOPER" || !user.permissions.has("developer.access")) throw new AppError(msg("Only the Developer can change the guide books."), "FORBIDDEN");
  return user;
}

/** Written to the audit trail after the browser has put the books in the file storage (it names the books, never their content). */
export async function recordGuideUploadsAction(files: string[]): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const user = await developer();
    const names = [...new Set(files)].filter((f) => GUIDE_FILE.test(f)).slice(0, 20);
    if (names.length === 0) throw new AppError(msg("No guide book was uploaded."), "VALIDATION");
    const { ipAddress } = await requestMeta();
    for (const file of names) await audit(db, { userId: user.id, label: user.fullName, ipAddress }, { action: "guide_book.uploaded", entityType: "GuideBook", entityId: file, after: { file } });
    revalidatePath("/staff/guides");
    return { count: names.length };
  });
}

export async function removeGuideBookAction(file: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await developer();
    if (!GUIDE_FILE.test(file)) throw new AppError(msg("That is not a guide book."), "VALIDATION");
    const removed = await removeStoredGuide(file);
    if (!removed) throw new AppError(msg("That guide book is not in the file storage."), "NOT_FOUND");
    const { ipAddress } = await requestMeta();
    await audit(db, { userId: user.id, label: user.fullName, ipAddress }, { action: "guide_book.removed", entityType: "GuideBook", entityId: file, after: { file } });
    revalidatePath("/staff/guides");
    return null;
  }, msg("The guide book was removed."));
}
