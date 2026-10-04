-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_customerPaidToId_fkey" FOREIGN KEY ("customerPaidToId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

