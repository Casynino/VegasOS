/**
 * Idempotent configuration seed. Loads ONLY reference/configuration data
 * (settings, roles, inventory, lookup lists) and the first owner account.
 * It never creates reservations, revenue, expenses or other business data.
 *
 *   SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD  → first Owner account (required once)
 *   SEED_DEV_STAFF=1                        → also create dev manager/receptionist
 *                                              accounts (never set in production)
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_ROLES, PERMISSIONS } from "../src/lib/permissions";
import { EXPENSE_CATALOG } from "../src/lib/expense-catalog";
import { MENU_CATALOG } from "../src/lib/menu-catalog";
import { MENU_PHOTOS, SUPPLIED_MENU_PHOTOS } from "../src/lib/menu-photos";
import { seedInventoryDemo } from "./seed-inventory";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Source: the hotel's own room list (31 guest rooms, confirmed by the hotel
// 2026-09-25) with rates from the price sheet (TSH/USD). Room 102 is the
// meeting room: same inventory, its own room type (category MEETING_ROOM).

const ROOM_TYPES = [
  {
    code: "STANDARD", name: "Standard Single", slug: "standard-single", baseRate: 60_000, displayRateUsd: 30,
    maxAdults: 1, maxChildren: 0, sortOrder: 1, rooms: ["301", "401"],
    shortDescription: "A comfortable, well-priced room for the solo traveller.",
    description:
      "Our Standard Single rooms offer a calm, air-conditioned retreat with a private bathroom, work desk, TV and complimentary Wi-Fi — ideal for business and short stays. Breakfast is included.",
  },
  {
    code: "DOUBLE_DELUXE", name: "Double Deluxe", slug: "double-deluxe", baseRate: 80_000, displayRateUsd: 40,
    maxAdults: 2, maxChildren: 1, sortOrder: 2,
    rooms: ["103", "104", "105", "106", "107", "203", "204", "205", "206", "207",
            "305", "306", "307", "308", "309", "405", "406", "407", "408", "409"],
    shortDescription: "Our most popular room — generous space for two.",
    description:
      "The Double Deluxe pairs a relaxed double-room layout with everything you need for a restful stay: air conditioning, private bathroom, work desk, TV, tea and coffee facilities and fast free Wi-Fi. Breakfast is included.",
  },
  {
    code: "EXECUTIVE", name: "Executive", slug: "executive", baseRate: 100_000, displayRateUsd: 50,
    maxAdults: 2, maxChildren: 1, sortOrder: 3, rooms: ["302", "402"],
    shortDescription: "Extra comfort and space for the discerning guest.",
    description:
      "Executive rooms are designed for guests who want a little more — added comfort, a dedicated work area and a quieter setting, with air conditioning, private bathroom, TV, free Wi-Fi and breakfast included.",
  },
  {
    code: "EXECUTIVE_SUITE", name: "Executive Suite", slug: "executive-suite", baseRate: 120_000, displayRateUsd: 60,
    maxAdults: 2, maxChildren: 2, sortOrder: 4, rooms: ["201", "202", "303", "304", "403", "404"],
    shortDescription: "Suite-level space to work, unwind and entertain.",
    description:
      "Our Executive Suites offer the most generous living space in the hotel, perfect for longer stays and guests who want to spread out. Air conditioning, private bathroom, work desk, TV, free Wi-Fi and breakfast are all included.",
  },
  {
    code: "TWIN", name: "Twin", slug: "twin", baseRate: 160_000, displayRateUsd: 70,
    maxAdults: 2, maxChildren: 1, sortOrder: 5, rooms: ["101"],
    shortDescription: "Separate beds for friends, colleagues or family.",
    description:
      "The Twin room is ideal for two guests travelling together who prefer separate beds, with air conditioning, private bathroom, TV, work desk, free Wi-Fi and breakfast included.",
  },
] as const;

// Photo → room-type mapping is a best guess from the hotel's photo set and is
// editable later; only applied to types that have no images yet.
const img = (cat: string, ...n: number[]) => n.map((i) => `/images/${cat}/${cat}-${String(i).padStart(2, "0")}.webp`);
const ROOM_TYPE_IMAGES: Record<string, string[]> = {
  STANDARD: [...img("room-blue", 16, 12, 14), ...img("bath", 3)],
  DOUBLE_DELUXE: [...img("room-blue", 8, 4, 5, 6, 13), ...img("bath", 7)],
  EXECUTIVE: [...img("room-blue", 1, 2, 3, 11, 10), ...img("bath", 11)],
  EXECUTIVE_SUITE: [...img("room-red", 5, 4, 1, 6, 7), ...img("bath", 14, 1)],
  TWIN: [...img("room-blue", 17, 18, 19), ...img("bath", 16)],
};

const AMENITIES = [
  { code: "WIFI", name: "Free Wi-Fi", icon: "Wifi" },
  { code: "BREAKFAST", name: "Free breakfast", icon: "Coffee" },
  { code: "AC", name: "Air conditioning", icon: "AirVent" },
  { code: "BATHROOM", name: "Private bathroom", icon: "ShowerHead" },
  { code: "TV", name: "Flat-screen TV", icon: "Tv" },
  { code: "DESK", name: "Work desk", icon: "Laptop" },
  { code: "TEA_COFFEE", name: "Tea & coffee maker", icon: "CupSoda" },
];

const BOOKING_SOURCES = [
  ["WEBSITE", "Website", true], ["BOOKING_COM", "Booking.com", false], ["EXPEDIA", "Expedia", false],
  ["INSTAGRAM", "Instagram", false], ["PHONE", "Phone", false], ["WALK_IN", "Walk-in", true],
  ["CORPORATE", "Corporate", false], ["DIRECT", "Direct", false], ["WHATSAPP", "WhatsApp", false], ["OTHER", "Other", false],
] as const;

const PAYMENT_METHODS = [
  ["CASH", "Cash"], ["BANK", "Bank transfer"], ["MOBILE_MONEY", "Mobile money"], ["CARD", "Card"], ["OTHER", "Other"],
] as const;

/** The hotel's official payment accounts (also created by the payment_accounts migration). */
const MONEY_ACCOUNTS: { code: string; name: string; kind: "CASH" | "BANK" | "MOBILE_MONEY" | "CARD" | "PETTY_CASH" | "OTHER"; number?: string; holder?: string; payments?: boolean; expenses?: boolean }[] = [
  { code: "CASH_DRAWER", name: "Cash", kind: "CASH" },
  { code: "MOBILE_MONEY", name: "LIPA Mix by Yas", kind: "MOBILE_MONEY", number: "17860396", holder: "Vegas Luxury Hotel" },
  { code: "LIPA_MPESA", name: "Lipa M-Pesa", kind: "MOBILE_MONEY", number: "51112197", holder: "BMAX LOUNGE" },
  { code: "BANK", name: "CRDB Bank", kind: "BANK", number: "015C799490700", holder: "VEGAS LUXURY HOTEL" },
  { code: "NMB_BANK", name: "NMB Bank", kind: "BANK", number: "20710035155", holder: "Mohamed Nassor Mbarack" },
  { code: "CARD", name: "Card terminal", kind: "CARD", expenses: false },
  { code: "PETTY_CASH", name: "Petty cash", kind: "PETTY_CASH", payments: false },
  { code: "OTHER", name: "Other", kind: "OTHER" },
];
const METHOD_ACCOUNT: Record<string, string> = { CASH: "CASH_DRAWER", BANK: "BANK", MOBILE_MONEY: "MOBILE_MONEY", CARD: "CARD", OTHER: "OTHER" };


const REVENUE_CATEGORIES = [
  ["RESTAURANT", "Restaurant", "RESTAURANT"], ["BAR", "Bar", "BAR"],
  ["LAUNDRY", "Laundry", "OTHER"], ["AIRPORT_SHUTTLE", "Airport shuttle", "OTHER"], ["OTHER", "Other", "OTHER"],
  ["ROOM_SERVICE", "Room service fee", "ROOM_SERVICE"],
] as const;


async function main() {
  await db.hotelSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const known = new Set((await db.permission.findMany({ select: { code: true } })).map((p) => p.code));
  const newPermissionCodes = new Set(Object.keys(PERMISSIONS).filter((c) => !known.has(c)));
  for (const [permCode, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { code: permCode }, update: { description }, create: { code: permCode, description } });
  }
  const perms = await db.permission.findMany();
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  for (const [roleCode, def] of Object.entries(DEFAULT_ROLES)) {
    const role = await db.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, name: def.name, description: def.description, isSystem: true },
    });
    // Grant defaults to a new role; for existing roles only add permissions that did not exist
    // before this seed run (new features), so admin removals survive re-seeding.
    const existing = await db.rolePermission.count({ where: { roleId: role.id } });
    if (existing > 0 && roleCode !== "OWNER") {
      const fresh = def.permissions.filter((p) => newPermissionCodes.has(p));
      if (fresh.length) await db.rolePermission.createMany({ data: fresh.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })), skipDuplicates: true });
    }
    if (existing === 0 || roleCode === "OWNER" || roleCode === "ADMIN") {
      await db.rolePermission.createMany({
        data: def.permissions.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
        skipDuplicates: true,
      });
    }
  }

  for (const [i, a] of AMENITIES.entries()) {
    await db.amenity.upsert({ where: { code: a.code }, update: {}, create: { ...a, sortOrder: i } });
  }
  const amenities = await db.amenity.findMany();

  for (const t of ROOM_TYPES) {
    const { rooms, ...data } = t;
    const type = await db.roomType.upsert({
      where: { code: t.code },
      update: {},
      create: { ...data, images: ROOM_TYPE_IMAGES[t.code] ?? [] },
    });
    if (Array.isArray(type.images) && type.images.length === 0 && ROOM_TYPE_IMAGES[t.code]) {
      await db.roomType.update({ where: { id: type.id }, data: { images: ROOM_TYPE_IMAGES[t.code] } });
    }
    await db.roomTypeAmenity.createMany({
      data: amenities.map((a) => ({ roomTypeId: type.id, amenityId: a.id })),
      skipDuplicates: true,
    });
    for (const number of rooms) {
      await db.room.upsert({
        where: { number },
        update: {},
        create: { number, roomTypeId: type.id, floor: Number(number[0]) },
      });
    }
  }
  // Meeting Room 102: booked by time through the same reservations (price editable in Settings → Pricing).
  const meetingType = await db.roomType.upsert({
    where: { code: "MEETING_ROOM" },
    update: {},
    create: {
      code: "MEETING_ROOM", name: "Meeting Room", slug: "meeting-room", category: "MEETING_ROOM", baseRate: 100_000,
      maxAdults: 10, maxChildren: 0, sortOrder: 6,
      shortDescription: "A private room for meetings, workshops and interviews — booked by the hour block.",
      description: "A private, air-conditioned meeting room for board meetings, workshops, interviews and small conferences, with Wi-Fi and refreshments from our restaurant and bar.",
      images: ["meeting-boardroom", "meeting-long-table", "meeting-city-view", "meeting-room", "meeting-screen", "meeting-chairs"].map((x) => `/images/illustrative/${x}.webp`),
    },
  });
  await db.room.upsert({ where: { number: "102" }, update: {}, create: { number: "102", roomTypeId: meetingType.id, floor: 1 } });

  for (const [i, [c, name, isSystem]] of BOOKING_SOURCES.entries()) {
    await db.bookingSource.upsert({ where: { code: c }, update: {}, create: { code: c, name, isSystem, sortOrder: i } });
  }
  // Money accounts, and which payment method pays into which account.
  for (const [i, a] of MONEY_ACCOUNTS.entries()) {
    await db.moneyAccount.upsert({
      where: { code: a.code }, update: {},
      create: { code: a.code, name: a.name, kind: a.kind, accountNumber: a.number ?? null, holderName: a.holder ?? null, acceptsPayments: a.payments ?? true, acceptsExpenses: a.expenses ?? true, sortOrder: i + 1 },
    });
  }
  const accountId = new Map((await db.moneyAccount.findMany({ select: { id: true, code: true } })).map((a) => [a.code, a.id]));
  for (const [i, [c, name]] of PAYMENT_METHODS.entries()) {
    const acct = accountId.get(METHOD_ACCOUNT[c]) ?? null;
    const m = await db.paymentMethod.upsert({ where: { code: c }, update: {}, create: { code: c, name, sortOrder: i, accountId: acct } });
    if (!m.accountId && acct) await db.paymentMethod.update({ where: { id: m.id }, data: { accountId: acct } });
  }
  // Restaurant & bar menu (create only — prices and items are edited in the app afterwards).
  for (const [i, c] of MENU_CATALOG.entries()) {
    await db.menuCategory.upsert({ where: { slug: c.slug }, update: {}, create: { id: c.id, name: c.name, slug: c.slug, type: c.type, revenueKind: c.revenueKind, description: c.description, sortOrder: i + 1 } });
    for (const [j, it] of c.items.entries()) {
      await db.menuItem.upsert({ where: { id: it.id }, update: {}, create: { id: it.id, categoryId: c.id, name: it.name, description: it.description, price: it.price, type: c.type, subcategory: it.subcategory, sortOrder: j + 1 } });
    }
  }
  // Expense groups and types (the hotel's own list + common hotel costs). Never overwrites edits made in the app.
  for (const [i, g] of EXPENSE_CATALOG.entries()) {
    const cat = await db.expenseCategory.upsert({ where: { code: g.code }, update: {}, create: { id: `expcat_${g.code.toLowerCase()}`, code: g.code, name: g.name, icon: g.icon, sortOrder: i } });
    for (const [j, it] of g.items.entries()) {
      await db.expenseItem.upsert({
        where: { id: `exi_${it.key}` }, update: {},
        create: { id: `exi_${it.key}`, categoryId: cat.id, name: it.name, frequency: it.frequency, defaultPayee: it.payee ?? null, sortOrder: j },
      });
    }
  }
  for (const [i, [c, name, kind]] of REVENUE_CATEGORIES.entries()) {
    await db.revenueCategory.upsert({ where: { code: c }, update: {}, create: { code: c, name, kind, sortOrder: i } });
  }

  await seedServices();
  await seedMedia();
  await seedMenuPhotos();
  await seedUsers();

  const roomCount = await db.room.count({ where: { isActive: true } });
  console.log(`Seed complete: ${roomCount} guest rooms configured (hotel reports 31 — add missing rooms in Staff → Rooms).`);
}

// Services confirmed by the hotel (brief + price sheet) and its public listing. Unconfirmed extras
// (sauna, hot tub, terrace, laundry…) are NOT seeded — management can add them in Website → Services.
const SERVICES = [
  ["WIFI", "Free Wi-Fi", "CONVENIENCE", "Wifi", "Complimentary high-speed Wi-Fi in every room and public area.", false],
  ["BREAKFAST", "Breakfast included", "DINING", "Coffee", "Breakfast is included with every room booking.", false],
  ["RESTAURANT", "Restaurant", "DINING", "UtensilsCrossed", "African and international dishes, from breakfast through dinner.", false],
  ["BAR", "Bar", "DINING", "Wine", "Unwind with a drink at the hotel bar.", false],
  ["ROOM_SERVICE", "Room service", "DINING", "ConciergeBell", "Meals and drinks delivered to your room.", false],
  ["RECEPTION_24H", "24-hour reception", "CONVENIENCE", "Clock", "Our front desk is open around the clock.", false],
  ["HOUSEKEEPING", "Daily housekeeping", "CONVENIENCE", "BrushCleaning", "Rooms are cleaned and refreshed daily.", false],
  ["PARKING", "Free on-site parking", "CONVENIENCE", "CircleParking", "Secure private parking for guests at no charge.", false],
  ["AIRPORT_TRANSFER", "Airport transfer", "TRANSPORT", "Plane", "Pickup and drop-off at Julius Nyerere International Airport by the hotel's own drivers.", true],
  ["HOTEL_TRANSPORT", "Hotel transport", "TRANSPORT", "Car", "Transfers around Dar es Salaam with our drivers, on request.", true],
  ["MEETING_ROOM", "Meeting room", "BUSINESS", "Presentation", "A private meeting room for workshops, board meetings and small conferences.", true],
] as const;

async function seedServices() {
  for (const [i, [code, name, category, icon, description, chargeable]] of SERVICES.entries()) {
    await db.hotelService.upsert({
      where: { code },
      update: {},
      create: { code, name, category, icon, description, isChargeable: chargeable, priceNote: chargeable ? "on request" : null, sortOrder: i },
    });
  }
}

/**
 * Menu photos (illustrative stock, credited): register each in the media library and give it to
 * its menu item — only where the item has no photo yet, so photos uploaded in the app are kept.
 */
async function seedMenuPhotos() {
  // The hotel's own product photos first — they win over a free stand-in photo.
  for (const [itemId, p] of Object.entries(SUPPLIED_MENU_PHOTOS)) {
    const item = await db.menuItem.findUnique({ where: { id: itemId }, include: { category: true } });
    if (!item) continue;
    const media = await db.mediaAsset.upsert({
      where: { id: p.mediaId }, update: {},
      create: { id: p.mediaId, url: p.file, title: item.name.replace(/\s+\d+\s*ML$/i, ""), altText: p.alt, category: item.category.revenueKind === "BAR" ? "BAR" : "RESTAURANT", isIllustrative: false, creditText: "Product photo · supplied by the hotel", width: 1200, height: 900 },
    });
    if (!item.imageId) await db.menuItem.update({ where: { id: item.id }, data: { imageId: media.id } });
  }
  for (const [itemId, p] of Object.entries(MENU_PHOTOS)) {
    const item = await db.menuItem.findUnique({ where: { id: itemId }, include: { category: true } });
    if (!item) continue;
    const media = (await db.mediaAsset.findFirst({ where: { url: p.file } })) ?? await db.mediaAsset.create({
      data: {
        id: `media_${itemId}`, url: p.file, title: item.name, altText: p.alt, category: item.category.revenueKind === "BAR" ? "BAR" : "RESTAURANT",
        isIllustrative: true, creditText: `Photo: ${p.creator} · ${p.license}`, description: p.sourcePage, width: 1200, height: 900,
      },
    });
    if (!item.imageId) await db.menuItem.update({ where: { id: item.id }, data: { imageId: media.id } });
  }
}

/** Register the bundled hotel photos in the media library once (idempotent by url). */
async function seedMedia() {
  const catMap: Record<string, { category: "ROOMS" | "BATHROOMS" | "EXTERIOR" | "RECEPTION" | "FACILITIES"; title: string; alt: string }> = {
    exterior: { category: "EXTERIOR", title: "Hotel exterior", alt: "Vegas Luxury Hotel building and gated entrance near Mlimani City" },
    lobby: { category: "RECEPTION", title: "Reception", alt: "Vegas Luxury Hotel reception desk with the gold hotel emblem" },
    "room-red": { category: "ROOMS", title: "Suite", alt: "Spacious suite with a double bed, red accents and a seating area" },
    "room-blue": { category: "ROOMS", title: "Guest room", alt: "Guest room with a double bed, blue accents and seating" },
    bath: { category: "BATHROOMS", title: "Bathroom", alt: "Private bathroom with a jacuzzi bathtub" },
    amenity: { category: "FACILITIES", title: "Bathrobe", alt: "Hotel bathrobe hanging in the room" },
  };
  const types = await db.roomType.findMany();
  const typeByImage = new Map<string, string>();
  for (const t of types) for (const url of ROOM_TYPE_IMAGES[t.code] ?? []) if (!typeByImage.has(url)) typeByImage.set(url, t.id);
  const { readdirSync } = await import("node:fs");
  const { GALLERY } = await import("../src/components/public/content");
  const dims = new Map(GALLERY.map((g) => [g.src, { width: g.width, height: g.height, alt: g.alt }]));
  let order = 0;
  for (const [folder, meta] of Object.entries(catMap)) {
    let files: string[] = [];
    try { files = readdirSync(`public/images/${folder}`).filter((f) => f.endsWith(".webp")).sort(); } catch { continue; }
    for (const f of files) {
      const url = `/images/${folder}/${f}`;
      const exists = await db.mediaAsset.findFirst({ where: { url } });
      if (exists) {
        if (exists.width == null && dims.get(url)) await db.mediaAsset.update({ where: { id: exists.id }, data: { width: dims.get(url)!.width, height: dims.get(url)!.height, altText: dims.get(url)!.alt } });
        continue;
      }
      await db.mediaAsset.create({
        data: {
          url, title: meta.title, altText: dims.get(url)?.alt ?? meta.alt, category: meta.category, sortOrder: order++,
          width: dims.get(url)?.width ?? null, height: dims.get(url)?.height ?? null,
          roomTypeId: typeByImage.get(url) ?? null,
          isFeatured: url.includes("exterior-01") || url.includes("lobby-01") || url.includes("room-red-01"),
        },
      });
    }
  }
}

/** Dev waiters — only with SEED_DEV_STAFF=1, never in production. */
const DEV_WAITERS = ["Juma", "Baraka", "Zawadi", "Hamisi", "Upendo"];

async function upsertUser(email: string, fullName: string, roleCode: string, password: string, mustChange: boolean) {
  const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return;
  await db.user.create({
    data: {
      email: email.toLowerCase(),
      fullName,
      roleId: role.id,
      passwordHash: await hash(password, ARGON_OPTS),
      mustChangePassword: mustChange,
    },
  });
  console.log(`Created ${roleCode} account: ${email}`);
}

/**
 * The hotel's team, with the same sign-ins as on the test system (owner, 2026-10-04: "use the same accounts"): same
 * emails, names and roles. Their starting password is SEED_STAFF_PASSWORD — set in Vercel, never written in the code —
 * and each person chooses their own at their first sign-in.
 */
const TEAM: [email: string, name: string, role: string][] = [
  ["owner@vegas.test", "Owner", "OWNER"],
  ["admin@vegas.test", "Bashley", "ADMIN"],
  ["manager@vegas.test", "Manager", "MANAGER"],
  ["asha@vegas.test", "Asha", "RECEPTIONIST"],
  ["neema@vegas.test", "Neema", "RECEPTIONIST"],
  ["rehema@vegas.test", "Rehema", "RECEPTIONIST"],
  ["chef@vegas.test", "Chef", "KITCHEN"],
  ["waiter@vegas.test", "Maria", "RESTAURANT"],
  ["baraka@vegas.test", "Baraka", "RESTAURANT"],
  ["hamisi@vegas.test", "Hamisi", "RESTAURANT"],
  ["juma@vegas.test", "Juma", "RESTAURANT"],
  ["upendo@vegas.test", "Upendo", "RESTAURANT"],
  ["zawadi@vegas.test", "Zawadi", "RESTAURANT"],
  ["restaurant@yourhotel.com", "Main Restaurant", "RESTAURANT_SCREEN"],
];

async function seedUsers() {
  const teamPassword = process.env.SEED_STAFF_PASSWORD;
  if (teamPassword) {
    if (teamPassword.length < 8) throw new Error("SEED_STAFF_PASSWORD must be at least 8 characters.");
    for (const [email, name, role] of TEAM) await upsertUser(email, name, role, teamPassword, true);
  }
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (ownerEmail && ownerPassword) {
    await upsertUser(ownerEmail, process.env.SEED_OWNER_NAME ?? "Hotel Owner", "OWNER", ownerPassword, true);
  } else if ((await db.user.count()) === 0) {
    console.warn("No users exist. Set SEED_STAFF_PASSWORD (the team) or SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD, and re-run the seed.");
  }

  if (process.env.SEED_DEV_STAFF === "1") {
    if (process.env.NODE_ENV === "production") throw new Error("SEED_DEV_STAFF is not allowed in production");
    await upsertUser("admin@vegas.test", "Dev Admin", "ADMIN", "Admin12345", false);
    await upsertUser("manager@vegas.test", "Dev Manager", "MANAGER", "Manager12345", false);
    for (const name of ["Asha", "Neema", "Rehema"]) {
      await upsertUser(`${name.toLowerCase()}@vegas.test`, `${name} (dev)`, "RECEPTIONIST", "Reception12345", false);
    }
    // To try the ordering system: the kitchen screen, and restaurant & bar staff (orders and the till).
    await upsertUser("chef@vegas.test", "Chef (dev)", "KITCHEN", "Kitchen12345", false);
    await upsertUser("waiter@vegas.test", "Waiter (dev)", "RESTAURANT", "Waiter12345", false);
    // The main Restaurant Counter (the one shared account): records the restaurant's payments — online ones automatically.
    await upsertUser("counter@vegas.test", "Restaurant Counter (dev)", "RESTAURANT_SCREEN", "Counter12345", false);
    // A team of waiters for the main Restaurant Counter (picked from the list there).
    for (const name of DEV_WAITERS) await upsertUser(`${name.toLowerCase()}@vegas.test`, `${name} (dev)`, "RESTAURANT", "Waiter12345", false);
    // Waiter numbers (WTR-001…), the same way the app gives them.
    await db.$executeRawUnsafe(`
      WITH waiter AS (
        SELECT u."id", ROW_NUMBER() OVER (ORDER BY u."createdAt", u."id") AS rn FROM "users" u
         WHERE u."staffCode" IS NULL
           AND EXISTS (SELECT 1 FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId" WHERE rp."roleId" = u."roleId" AND p."code" = 'restaurant.shift')
           AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId" WHERE rp."roleId" = u."roleId" AND p."code" IN ('restaurant.device', 'dashboard.manager', 'dashboard.owner', 'dashboard.admin'))
      ), base AS (SELECT COALESCE(MAX(CAST(SUBSTRING("staffCode" FROM 5) AS INTEGER)), 0) AS m FROM "users" WHERE "staffCode" ~ '^WTR-[0-9]+$')
      UPDATE "users" u SET "staffCode" = 'WTR-' || LPAD((base.m + waiter.rn)::text, 3, '0') FROM waiter, base WHERE u."id" = waiter."id"`);
    await seedInventoryDemo(db);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
