-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "correctsId" TEXT,
ADD COLUMN     "number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "expenses_number_key" ON "expenses"("number");


-- Data: number existing expenses in the order they were recorded, per year.
UPDATE "expenses" e SET "number" = n.num FROM (
  SELECT "id", 'EXP-' || to_char("createdAt", 'YYYY') || '-' || lpad(row_number() OVER (PARTITION BY to_char("createdAt", 'YYYY') ORDER BY "createdAt", "id")::text, 6, '0') AS num
  FROM "expenses"
) n WHERE e."id" = n."id" AND e."number" IS NULL;
