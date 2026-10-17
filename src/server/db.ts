import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "./errors";
import { makeWorkAsReader } from "./work-as-session";

const globalForPrisma = globalThis as unknown as { vlhRawDb?: PrismaClient; vlhDb?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

/**
 * The plain client — NO write fence. For the sign-in code and the "work as" service only: they write the signed-in person's OWN session
 * (its last-seen time, its work-as fields, its removal at sign-out), which the fence below must not stop. Nothing else uses it.
 */
export const rawDb: PrismaClient = globalForPrisma.vlhRawDb ?? createClient();

/**
 * Who is working as whom on THIS request (null when nobody is, or when there is no request): read from the session cookie, cached per
 * request. The audit trail uses it to write a Developer's work under the Developer's own name; the fence below uses it to refuse writes.
 */
export const workAsOfRequest = makeWorkAsReader(rawDb);

const FENCED_MODELS = ["user", "session", "role", "rolePermission", "permission"] as const;
const FENCED_WRITES = ["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"] as const;

/**
 * THE WRITE FENCE (owner, 2026-10-17). While a Developer is working as someone, nothing may be WRITTEN to the accounts, the sessions, the
 * roles or the rights — whatever the code path, whichever action or page asks. This is what makes "Work as" unable to take over an account:
 * no password, no login email, no role, no right, no sign-out, no suspension can be saved from inside someone else's dashboard.
 * It is decided on the server from the request's own session (never from the browser or from an argument), per request, and it is off where
 * there is no request (cron, webhooks, scripts, setup). Reads are never touched (only the write operations are hooked). It applies inside
 * transactions too.
 */
function fence(base: PrismaClient) {
  const guard = async ({ args, query }: { args: unknown; query: (args: never) => Promise<unknown> }) => {
    if (await workAsOfRequest()) {
      throw new AppError("While you are working as someone you cannot change accounts, sessions, roles or rights.", "FORBIDDEN");
    }
    return query(args as never);
  };
  const writes = Object.fromEntries(FENCED_WRITES.map((op) => [op, guard]));
  return base.$extends({
    name: "work-as-fence",
    query: Object.fromEntries(FENCED_MODELS.map((m) => [m, writes])) as Record<(typeof FENCED_MODELS)[number], Record<(typeof FENCED_WRITES)[number], typeof guard>>,
  });
}

/**
 * The application's database client: the plain one with the write fence on accounts, sessions, roles and rights.
 * It is typed as the plain PrismaClient on purpose: a query extension changes the client's TYPE (transaction clients stop being
 * interchangeable with Prisma.TransactionClient, which a hundred existing functions use), while at run time it behaves the same — the
 * fence also covers the writes made inside db.$transaction (proven in tests/integration/developer-workas.test.ts).
 */
export const db: PrismaClient = globalForPrisma.vlhDb ?? (fence(rawDb) as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.vlhRawDb = rawDb;
  globalForPrisma.vlhDb = db;
}

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
