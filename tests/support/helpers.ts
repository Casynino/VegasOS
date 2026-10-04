import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import type { Actor } from "@/server/services/reservations";

export async function resetBusinessData() {
  await db.$executeRawUnsafe(`
    TRUNCATE "room_nights", "reservation_rooms", "reservation_guests", "reservation_charges", "payments",
      "invoice_items", "invoices", "reservations", "guests", "audit_logs", "room_status_history", "room_blocks",
      "expense_approvals", "expenses", "revenue_transactions", "actual_shifts", "staff_reports",
      "shift_schedules", "shift_handover_notes", "booking_groups", "thank_you_notes", "daily_reports", "notification_deliveries", "corporate_customers", "ledger_entries", "cash_counts", "restaurant_orders", "restaurant_order_events", "guest_messages", "room_qr_codes", "stock_request_items", "stock_requests", "dining_sessions", "dining_session_members", "dining_seats", "dining_session_events", "table_moves", "table_reservations", "inventory_movements", "recipe_lines", "inventory_items", "suppliers", "asset_movements", "assets", "mobile_payments" CASCADE`);
  // Uploaded files, except website / menu photos (a cascade would take the menu with it).
  await db.$executeRawUnsafe(`DELETE FROM "stored_files" s WHERE NOT EXISTS (SELECT 1 FROM "media_assets" m WHERE m."fileId" = s."id")`);
  await db.room.updateMany({ data: { status: "AVAILABLE", statusNote: null } });
}

export async function managerActor(): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { email: "manager@vegas.test" } });
  return { userId: u.id, label: u.fullName, permissions: new Set(ALL_PERMISSIONS) };
}

export async function receptionistActor(): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { email: "asha@vegas.test" }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, role: u.role.name, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) };
}

/** A staff member by email, with their role's permissions and role name (as the app builds it). */
async function staffActor(email: string): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, role: u.role.name, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) };
}
/** The restaurant's cook (Mpishi): accept, prepare, mark ready. */
export const chefActor = () => staffActor("chef@vegas.test");
/** A waiter: serves — takes ready orders out, marks them delivered. Never records a payment (the Restaurant Counter does). */
export const waiterActor = () => staffActor("waiter@vegas.test");

/**
 * The one shared Restaurant Counter account (role RESTAURANT_SCREEN): the restaurant's official payment
 * station — its payments are confirmed at once and attributed to the Counter, never to a waiter.
 */
export async function counterActor(): Promise<Actor> {
  const role = await db.role.findUniqueOrThrow({ where: { code: "RESTAURANT_SCREEN" }, include: { permissions: { include: { permission: true } } } });
  const email = "counter@vegas.test";
  const u = (await db.user.findFirst({ where: { email, isActive: true, roleId: role.id } })) ?? await db.user.upsert({
    where: { email }, update: { isActive: true, roleId: role.id },
    create: { email, fullName: "Restaurant Counter (test)", roleId: role.id, passwordHash: await hashPassword("Counter12345"), mustChangePassword: false },
  });
  return { userId: u.id, label: u.fullName, role: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)) };
}

/** The same account without "restaurant.payments.confirm" (a role set up to record but not confirm): its payments wait for reception. */
export const withoutConfirming = (a: Actor): Actor => ({ ...a, permissions: new Set([...(a.permissions ?? [])].filter((p) => p !== "restaurant.payments.confirm")) });

export const websiteActor: Actor = { userId: null, label: "website", permissions: new Set() };

export async function roomType(code: string) {
  return db.roomType.findUniqueOrThrow({ where: { code }, include: { rooms: true } });
}

/** An instant in Dar es Salaam local time. */
export const eat = (iso: string) => new Date(`${iso}+03:00`);
