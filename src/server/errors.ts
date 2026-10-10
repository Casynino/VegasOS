import type { Localized, MsgVars } from "@/i18n/msg";

/**
 * Errors that are safe to show to the user. Anything else thrown inside a
 * server action is logged and replaced with a generic message.
 */
export class AppError extends Error {
  /** Set when the message was made with msgf(): translated with its values for the person who sees it. */
  readonly i18n?: { key: string; vars: MsgVars };
  constructor(
    message: string | Localized,
    public readonly code:
      | "VALIDATION"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "UNAUTHENTICATED"
      | "CONFLICT"
      | "UNAVAILABLE"
      | "RATE_LIMITED" = "VALIDATION",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(typeof message === "string" ? message : message.text);
    if (typeof message !== "string") this.i18n = { key: message.key, vars: message.vars };
    this.name = "AppError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code?: AppError["code"]; fieldErrors?: Record<string, string> };

/** Postgres exclusion-constraint violation (double booking). */
export function isExclusionViolation(err: unknown): boolean {
  const text = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
  return text.includes("23P01") || text.includes("_no_overlap");
}

/** Unique-constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string };
  if (e?.code === "P2002") return true;
  const text = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
  return text.includes("23505");
}

/**
 * The words in an action's answer, in the language of the person who asked (their account's language, or the
 * visitor's choice). Messages are written in English where they are made (msg()/msgf() mark them); only the
 * wording changes here — never the outcome. Falls back to the English if anything goes wrong.
 */
async function wordsFor() {
  try {
    const { getT } = await import("@/i18n/server");
    return await getT();
  } catch {
    return null;
  }
}

/** Wrap a server-action body: returns a typed result, never leaks internals. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string | Localized): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (successMessage === undefined) return { ok: true, data };
    const t = await wordsFor();
    const message = typeof successMessage === "string"
      ? t ? t(successMessage) : successMessage
      : t ? t(successMessage.key, successMessage.vars) : successMessage.text;
    return { ok: true, data, message };
  } catch (err) {
    if (err instanceof AppError) {
      const t = await wordsFor();
      // Values inside the message that are the hotel's own words (a table's area, a room type…) are said in the reader's
      // language too; anything else (names, numbers, references) has no translation and stays as it is.
      const vars = err.i18n && t ? Object.fromEntries(Object.entries(err.i18n.vars).map(([k, v]) => [k, typeof v === "string" ? t(v) : v])) : err.i18n?.vars;
      const error = !t ? err.message : err.i18n ? t(err.i18n.key, vars) : t(err.message);
      const fieldErrors = err.fieldErrors && t ? Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, t(v)])) : err.fieldErrors;
      return { ok: false, error, code: err.code, fieldErrors };
    }
    // Next.js control-flow errors (redirect/notFound) must propagate.
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_") || digest.includes("NEXT_REDIRECT"))) {
      throw err;
    }
    console.error("[action] unexpected error", err);
    const t = await wordsFor();
    const generic = "Something went wrong. Nothing was saved — please try again.";
    return { ok: false, error: t ? t(generic) : generic };
  }
}
