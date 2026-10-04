-- The hotel's online payment reads the same everywhere — payment lists, accounts, the daily report: "NTZS online".
-- (Only the names the nTZS migration gave them; a name the hotel changed itself is kept.)
UPDATE "payment_methods" SET "name" = 'NTZS online' WHERE "code" = 'NTZS' AND "name" = 'nTZS · mobile money prompt';
UPDATE "money_accounts" SET "name" = 'NTZS · online payments' WHERE "code" = 'NTZS' AND "name" = 'nTZS · mobile money';
