"use server";

import { z } from "zod";
import { authorize } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { staffDetail, type StaffDetail } from "@/server/services/staff-performance";

const Input = z.object({ userId: z.string().min(1).max(40), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** One person's period in detail (opened from their row on Staff activity). */
export async function staffDetailAction(input: z.input<typeof Input>): Promise<ActionResult<StaffDetail>> {
  return runAction(async () => {
    await authorize("finance.view");
    const d = Input.parse(input);
    return staffDetail(d.userId, { from: d.from, to: d.to });
  });
}
