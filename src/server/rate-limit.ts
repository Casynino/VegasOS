import "server-only";
import { db } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter backed by Postgres so it holds across serverless
 * instances. One atomic upsert per check.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."windowStart" < now() - make_interval(secs => ${windowSeconds})
        THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
      "windowStart" = CASE
        WHEN "rate_limit_buckets"."windowStart" < now() - make_interval(secs => ${windowSeconds})
        THEN now() ELSE "rate_limit_buckets"."windowStart" END
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) {
    throw new AppError("Too many attempts. Please wait a few minutes and try again.", "RATE_LIMITED");
  }
}
