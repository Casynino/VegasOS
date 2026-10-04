// Runs in the build, before `prisma migrate deploy`. Two deploys starting at the same moment can both try the same
// migration: one applies it, the other leaves a FAILED record for that same migration — and Prisma then refuses every
// later deploy (P3009). A failed record of a migration that ALSO has a successful record is only that leftover: mark it
// rolled back. Nothing else is touched (a migration that really failed still stops the build, as it should).
import pg from "pg";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) process.exit(0);
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query(`SELECT to_regclass('public._prisma_migrations') AS t`);
  if (rows[0]?.t) {
    const r = await client.query(`
      UPDATE "_prisma_migrations" AS f SET rolled_back_at = now()
      WHERE f.finished_at IS NULL AND f.rolled_back_at IS NULL
        AND EXISTS (SELECT 1 FROM "_prisma_migrations" AS ok
                    WHERE ok.migration_name = f.migration_name AND ok.id <> f.id AND ok.finished_at IS NOT NULL AND ok.rolled_back_at IS NULL)
      RETURNING f.migration_name`);
    for (const x of r.rows) console.log(`Cleared a leftover failed record of ${x.migration_name} (it was applied by another deploy).`);
  }
} catch (e) {
  console.warn("heal-migrations: skipped —", e instanceof Error ? e.message : e);
} finally {
  await client.end().catch(() => {});
}
