/**
 * Errors that are safe to show to the user. Anything else thrown inside a
 * server action is logged and replaced with a generic message.
 */
export class AppError extends Error {
  constructor(
    message: string,
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
    super(message);
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

/** Wrap a server-action body: returns a typed result, never leaks internals. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, error: err.message, code: err.code, fieldErrors: err.fieldErrors };
    }
    // Next.js control-flow errors (redirect/notFound) must propagate.
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_") || digest.includes("NEXT_REDIRECT"))) {
      throw err;
    }
    console.error("[action] unexpected error", err);
    return { ok: false, error: "Something went wrong. Nothing was saved — please try again." };
  }
}
