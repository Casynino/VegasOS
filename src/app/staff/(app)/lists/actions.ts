"use server";

import { z } from "zod";
import { authorize, can, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { saveDailyListCopy, withDoneBy, type StoredDailyList } from "@/server/services/daily-lists";

const PrintSchema = z.object({ kind: z.enum(["HOUSEKEEPING", "GUESTS"]) });

/**
 * Keep today's list as the day's next printed copy and hand it back for the paper. The list is built here from the
 * live rooms and bookings — nothing the browser sends decides what is on it. Changes no room and no booking.
 */
export async function printDailyListAction(input: z.input<typeof PrintSchema>): Promise<ActionResult<StoredDailyList>> {
  return runAction(async () => {
    const user = await authorize("dashboard.front_desk");
    const { kind } = parseInput(PrintSchema, input);
    if (!can(user, kind === "HOUSEKEEPING" ? "rooms.view" : "reservations.view")) throw new AppError("You do not have permission to do this.", "FORBIDDEN");
    const { ipAddress } = await requestMeta();
    return (await withDoneBy([await saveDailyListCopy(kind, user, ipAddress)]))[0];
  });
}
