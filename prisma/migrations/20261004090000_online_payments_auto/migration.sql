-- AlterTable
ALTER TABLE "restaurant_order_payments" ADD COLUMN     "notReceived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "online" BOOLEAN NOT NULL DEFAULT false;

