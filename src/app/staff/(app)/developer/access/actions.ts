"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { createAccount, endWorkAs, reactivateAccount, requireDeveloperSession, signOutEverywhere, startWorkAs, suspendAccount } from "@/server/services/work-as";
import { msg } from "@/i18n/msg";

/*
 * The Access page's actions (Developer console). Every rule lives in server/services/work-as.ts; here: who is asking (the session's
 * Developer — never the form: the form carries only the person the button is on, a reason and the word CONFIRM), the form, the page
 * refresh. A person who is not a Developer is refused before anything is read from the form.
 *
 * Each one is a Server Function, so each is a public endpoint: the first thing it does is ask the server who is signed in.
 */

const ACCESS = "/staff/developer/access";

/** A form posted straight to an action is (formData); a form with state is (previous result, formData) — both work. */
function formOf(first: unknown, second: unknown): FormData {
  return second instanceof FormData ? second : first instanceof FormData ? first : new FormData();
}

const userId = z.string().trim().min(1, msg("Choose a person.")).max(64, msg("Choose a person."));
const reason = z.string().trim().min(5, msg("Write a reason of at least 5 characters.")).max(500, msg("Keep the reason under 500 characters."));

const PersonSchema = z.object({ userId });
const SuspendSchema = z.object({
  userId,
  reason,
  // Exactly the word, in capitals: the service checks it again.
  confirm: z.string().refine((v) => v === "CONFIRM", msg("Type CONFIRM, in capital letters, to go on.")),
});
const ReactivateSchema = z.object({ userId, reason });

/**
 * WORK AS — opens the person's own dashboard, with their rights minus every money right. The person comes from the button; who
 * the Developer is comes from the session. On success the browser is sent to the person's home; on a refusal it stays here and says why.
 */
export async function startWorkAsAction(first?: unknown, second?: unknown): Promise<ActionResult<null>> {
  const done = await runAction(async () => {
    const developer = await requireDeveloperSession();
    const input = parseInput(PersonSchema, formOf(first, second));
    return (await startWorkAs(developer, input.userId)).home;
  });
  if (!done.ok) return done;
  // redirect() ends the action by throwing — so it stays out of runAction's try/catch.
  redirect(done.data);
}

/** STOP — back from "Work as" to the console. It also works from the bar shown on every page while working as someone. */
export async function stopWorkAsAction(): Promise<void> {
  const developer = await requireDeveloperSession();
  await endWorkAs(developer);
  redirect(ACCESS);
}

/** SUSPEND — blocks the account and signs the person out at once. Needs a reason (5+ characters) and the word CONFIRM. */
export async function suspendAction(first?: unknown, second?: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const developer = await requireDeveloperSession();
    const input = parseInput(SuspendSchema, formOf(first, second));
    await suspendAccount(developer, input.userId, { reason: input.reason, confirm: input.confirm });
    revalidatePath(ACCESS);
    return null;
  }, msg("Account suspended. The person is signed out and cannot sign in."));
}

/** RE-ACTIVATE — only an account this Developer suspended; needs a reason. */
export async function reactivateAction(first?: unknown, second?: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const developer = await requireDeveloperSession();
    const input = parseInput(ReactivateSchema, formOf(first, second));
    await reactivateAccount(developer, input.userId, { reason: input.reason });
    revalidatePath(ACCESS);
    return null;
  }, msg("Account re-activated. The person can sign in again."));
}

const AddAccountSchema = z.object({
  fullName: z.string().trim().min(2, msg("Full name is required.")).max(100, msg("The name is too long.")),
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email.")).max(254),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  roleId: z.string().trim().min(1, msg("Choose a role.")).max(64),
  password: z.string().min(1, msg("Make a temporary password.")).max(200),
});

/** ADD AN ACCOUNT — the Developer comes from the session; the form carries only the new person and the temporary password. */
export async function addAccountAction(first?: unknown, second?: unknown): Promise<ActionResult<{ fullName: string; email: string; roleName: string }>> {
  return runAction(async () => {
    const developer = await requireDeveloperSession();
    const input = parseInput(AddAccountSchema, formOf(first, second));
    const made = await createAccount(developer, input);
    revalidatePath(ACCESS);
    return { fullName: made.fullName, email: made.email, roleName: made.roleName };
  }, msg("Account created."));
}

/** SIGN OUT EVERYWHERE — ends every open session of the person. They can sign straight back in. */
export async function signOutEverywhereAction(first?: unknown, second?: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const developer = await requireDeveloperSession();
    const input = parseInput(PersonSchema, formOf(first, second));
    await signOutEverywhere(developer, input.userId);
    revalidatePath(ACCESS);
    return null;
  }, msg("Signed out everywhere. The person can sign straight back in."));
}
