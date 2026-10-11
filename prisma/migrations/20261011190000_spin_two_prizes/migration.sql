-- Spin to Win: two gifts a stay, one bonus spin, "try again" — and all of a stay's gifts sent as one order.
-- Additive only: every new column has a default, nothing is dropped but one index that is replaced.

-- The chances of one spin (percent). The rest is "try again".
ALTER TABLE "hotel_settings"
  ADD COLUMN "spinGiftChance" INTEGER NOT NULL DEFAULT 45,
  ADD COLUMN "spinFreeSpinChance" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "spin_sessions"
  ADD COLUMN "prizesAllowed" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "prizesWon" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bonusAwarded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bonusUsed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "endedWhy" TEXT;

ALTER TABLE "spin_results"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GIFT',
  ADD COLUMN "bonus" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "prizeNumber" INTEGER,
  ADD COLUMN "wheel" JSONB,
  ADD COLUMN "stopIndex" INTEGER,
  ALTER COLUMN "menuItemId" DROP NOT NULL;

-- Stays that already played the first game (every spin was a gift): what they won stays theirs.
UPDATE "spin_results" SET "prizeNumber" = "spinNumber";
UPDATE "spin_sessions" s
   SET "prizesWon" = c.n,
       "prizesAllowed" = GREATEST(2, c.n)
  FROM (SELECT "sessionId", COUNT(*)::int AS n FROM "spin_results" GROUP BY "sessionId") c
 WHERE c."sessionId" = s."id";
UPDATE "spin_sessions"
   SET "endedAt" = CURRENT_TIMESTAMP, "endedWhy" = 'PRIZES'
 WHERE "prizesWon" >= "prizesAllowed";

ALTER TABLE "spin_sessions"
  ADD CONSTRAINT "spin_sessions_prizes_check" CHECK ("prizesWon" >= 0 AND "prizesWon" <= "prizesAllowed"),
  ADD CONSTRAINT "spin_sessions_bonus_check" CHECK ("bonusAwarded" OR NOT "bonusUsed");

ALTER TABLE "spin_results"
  ADD CONSTRAINT "spin_results_kind_check" CHECK ("kind" IN ('GIFT', 'FREE_SPIN', 'TRY_AGAIN')),
  ADD CONSTRAINT "spin_results_gift_check" CHECK (
    ("kind" = 'GIFT' AND "menuItemId" IS NOT NULL AND "prizeNumber" IS NOT NULL AND "prizeNumber" >= 1)
    OR ("kind" <> 'GIFT' AND "menuItemId" IS NULL AND "prizeNumber" IS NULL AND "orderId" IS NULL AND "fulfilment" IS NULL AND "value" = 0)
  );

-- A stay's gifts are numbered 1, 2 — never the same number twice.
CREATE UNIQUE INDEX "spin_results_sessionId_prizeNumber_key" ON "spin_results"("sessionId", "prizeNumber");
-- One bonus spin a stay: it can come up once, and be played once.
CREATE UNIQUE INDEX "spin_results_one_free_spin" ON "spin_results" ("sessionId") WHERE "kind" = 'FREE_SPIN';
CREATE UNIQUE INDEX "spin_results_one_bonus_spin" ON "spin_results" ("sessionId") WHERE "bonus";

-- All the gifts of one stay go to the restaurant as one order: an order may now carry several results.
DROP INDEX "spin_results_orderId_key";
CREATE INDEX "spin_results_orderId_idx" ON "spin_results"("orderId");
