-- Online payments confirmed by hand from the customer's proof (before they were recorded automatically) are the
-- online payment all the same: the first payment of such an order, into the account the customer named, is marked online.
UPDATE "restaurant_order_payments" p SET "online" = true
  FROM "restaurant_orders" o
 WHERE p."orderId" = o."id"
   AND o."paymentProofFileId" IS NOT NULL
   AND p."accountId" = o."customerPaidToId"
   AND NOT EXISTS (SELECT 1 FROM "restaurant_order_payments" q WHERE q."orderId" = o."id" AND q."online")
   AND p."id" = (SELECT q2."id" FROM "restaurant_order_payments" q2 WHERE q2."orderId" = o."id" ORDER BY q2."collectedAt" ASC LIMIT 1);
