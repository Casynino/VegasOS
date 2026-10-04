"use server";

import { z } from "zod";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";

/** The top-bar bell: this person switches their alert sound off / on — kept on their account. */
export async function setAlertSoundAction(off: unknown): Promise<ActionResult<{ off: boolean }>> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AppError("Please sign in again.", "UNAUTHENTICATED");
    const value = z.boolean().parse(off);
    await db.user.update({ where: { id: user.id }, data: { alertSoundOff: value } });
    return { off: value };
  });
}
