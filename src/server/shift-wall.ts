import "server-only";
import { AppError } from "./errors";
import { DEVELOPER_DECISION_REFUSAL, refuseDeveloper } from "./developer-wall";

/**
 * SHIFTS AND THE DEVELOPER. The Developer's OWN account has no shift and never starts, ends, takes over, closes or re-plans one. While it WORKS AS
 * someone it may do all of that as that person (owner, 2026-10-19: full access) — the audit trail says who really did it.
 * These checks sit in the services (and so behind every action), and they do nothing for anyone else: staff and managers are unchanged.
 */

type Who = { userId?: string | null; permissions?: ReadonlySet<string> | null; label?: string; ipAddress?: string | null };

/**
 * For starting or ending a shift, and for closing or taking over someone's: refuses the Developer's own account ("The Developer account cannot …");
 * the refusal is kept in the audit trail like every refused Developer attempt. Does nothing for anyone else, and nothing while a Developer works as someone.
 * `what` finishes the sentence; `needs` names the right the gate stands on (for the audit entry).
 */
export async function refuseShiftWork(actor: Who | null | undefined, what: string, needs: string): Promise<void> {
  if (!actor) return;
  try {
    await refuseDeveloper(actor, needs);
  } catch (e) {
    if (!(e instanceof AppError) || e.message !== DEVELOPER_DECISION_REFUSAL) throw e;
    throw new AppError(`The Developer account cannot ${what}.`, "FORBIDDEN");
  }
}

/** Editing the shift plan: nothing is refused any more while a Developer works as someone (owner, 2026-10-19); kept so every caller stays as it was. */
export async function refuseShiftPlanWhileWorkingAs(actor: Who | null | undefined, what: string, needs: string): Promise<void> {
  void actor; void what; void needs;
}
