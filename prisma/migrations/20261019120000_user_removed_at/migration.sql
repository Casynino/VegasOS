-- "Account deleted": the person loses all access and the account leaves every list, but the row stays so that the records they made keep their name.
ALTER TABLE "users" ADD COLUMN "removedAt" TIMESTAMP(3);
