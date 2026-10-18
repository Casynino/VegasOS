import "server-only";
import { workAsOfRequest } from "./db";
import { assertNotWorkAs } from "./auth";
import { AppError } from "./errors";
import { DEVELOPER_DECISION_REFUSAL, refuseDeveloper } from "./developer-wall";
import { isMarkedWorkingAs } from "./work-as-session";

/**
 * SHIFTS AND THE DEVELOPER (owner, 2026-10-17).
 *
 * A shift belongs to a real person: a reception shift holds one of the desk's two places, and its closing counts the cash that person
 * collected and sends the report to the Boss. So a Developer who WORKS AS someone never starts, ends, takes over, closes or re-plans that
 * person's shift (the receptionist's shift gate is skipped for the Developer already, so it can work without one), and the Developer's own
 * account has no shift at all.
 *
 * These checks sit in the services (and so behind every action), and they do nothing for anyone else: staff and managers are unchanged.
 */

type Who = { userId?: string | null; permissions?: ReadonlySet<string> | null; label?: string; ipAddress?: string | null };

/** Is this person a Developer WORKING AS them right now? The marked rights say so; a copy of the rights loses the mark, so the request itself is asked too. */
async function isWorkedAs(actor: Who): Promise<boolean> {
  if (isMarkedWorkingAs(actor.permissions)) return true;
  if (!actor.userId) return false;
  return (await workAsOfRequest())?.targetId === actor.userId;
}

/**
 * For starting or ending a shift, and for closing or taking over someone's: refuses a Developer — working as someone ("While you are
 * working as someone you cannot …", the words of assertNotWorkAs) or on its own account ("The Developer account cannot …"). The refusal
 * is kept in the audit trail like every refused Developer attempt. Does nothing for anyone else.
 * `what` finishes the sentence; `needs` names the right the gate stands on (for the audit entry).
 */
export async function refuseShiftWork(actor: Who | null | undefined, what: string, needs: string): Promise<void> {
  if (!actor) return;
  try {
    await refuseDeveloper(actor, needs);
  } catch (e) {
    if (!(e instanceof AppError) || e.message !== DEVELOPER_DECISION_REFUSAL) throw e;
    if (await isWorkedAs(actor)) assertNotWorkAs({ workAs: {} }, what); // throws "While you are working as someone you cannot {what}."
    throw new AppError(`The Developer account cannot ${what}.`, "FORBIDDEN");
  }
}

/**
 * For editing the shift plan (who works which day): refused only while a Developer works as someone. The Developer's own account keeps
 * the shifts.manage right to plan the rota — it plans nobody's money.
 */
export async function refuseShiftPlanWhileWorkingAs(actor: Who | null | undefined, what: string, needs: string): Promise<void> {
  if (!actor || !(await isWorkedAs(actor))) return;
  await refuseShiftWork(actor, what, needs);
}
