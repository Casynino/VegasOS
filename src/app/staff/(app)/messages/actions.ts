"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize } from "@/server/auth";
import { runAction } from "@/server/errors";

export async function markHandledAction(input: { id: string }) {
  return runAction(async () => {
    const user = await authorize("contact.view");
    await db.contactMessage.update({ where: { id: input.id }, data: { handledAt: new Date() } });
    await audit(db, { userId: user.id, label: user.fullName }, { action: "contact.handled", entityType: "ContactMessage", entityId: input.id });
    revalidatePath("/staff/messages");
    return null;
  }, "Marked as handled.");
}
