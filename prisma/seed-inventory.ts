import type { PrismaClient } from "../src/generated/prisma/client";

/**
 * Dev-only sample stock, suppliers, recipes and assets (SEED_DEV_STAFF=1), so the inventory and
 * asset screens have something to show. Departments and categories come from the migration.
 * Safe to run again: existing rows are left as they are.
 */
export async function seedInventoryDemo(db: PrismaClient) {
  if ((await db.inventoryItem.count()) > 0) return;
  const dep = Object.fromEntries((await db.inventoryDepartment.findMany()).map((d) => [d.code, d.id]));
  const cat = Object.fromEntries((await db.inventoryCategory.findMany()).map((c) => [c.name, c.id]));
  if (!dep.KITCHEN || !cat["Kitchen food"]) return;

  const sup = async (name: string, contactName: string, phone: string) =>
    (await db.supplier.upsert({ where: { name }, update: {}, create: { name, contactName, phone } })).id;
  const meat = await sup("Mwenge Meat Supplies", "Juma", "+255 700 000 101");
  const market = await sup("Kariakoo Fresh Market", "Mama Rose", "+255 700 000 102");
  const drinks = await sup("Dar Beverages Ltd", "Sales desk", "+255 700 000 103");
  const clean = await sup("CleanPro Tanzania", "Office", "+255 700 000 104");

  type Row = [name: string, category: string, dept: string, unit: string, qty: number, min: number | null, reorder: number | null, max: number | null, cost: number, supplier: string | null, location: string, expiry?: boolean];
  const rows: Row[] = [
    ["Beef", "Kitchen food", "KITCHEN", "KG", 59, 20, 30, 150, 15000, meat, "Cold room", true],
    ["Chicken", "Kitchen food", "KITCHEN", "KG", 8, 15, 20, 80, 12000, meat, "Cold room", true],
    ["Fish fillet", "Kitchen food", "KITCHEN", "KG", 14, 5, 8, 40, 16000, meat, "Cold room", true],
    ["Rice", "Kitchen food", "KITCHEN", "KG", 100, 30, 40, 200, 3200, market, "Dry store"],
    ["Wheat flour", "Kitchen food", "KITCHEN", "KG", 45, 10, 15, 100, 2400, market, "Dry store"],
    ["Cooking oil", "Kitchen food", "KITCHEN", "L", 4, 10, 15, 60, 6500, market, "Dry store"],
    ["Tomatoes", "Kitchen food", "KITCHEN", "KG", 16, 5, 8, 30, 2500, market, "Cold room", true],
    ["Onions", "Kitchen food", "KITCHEN", "KG", 22, 5, 8, 40, 2000, market, "Dry store"],
    ["Burger buns", "Kitchen food", "KITCHEN", "PIECE", 36, 24, 30, 120, 500, market, "Dry store", true],
    ["Cheese slices", "Kitchen food", "KITCHEN", "SLICE", 60, 40, 50, 200, 350, market, "Cold room", true],
    ["Sugar", "Kitchen food", "KITCHEN", "KG", 0, 10, 15, 50, 2800, market, "Dry store"],
    ["Salt", "Kitchen food", "KITCHEN", "KG", 12, 3, 5, 20, 1200, market, "Dry store"],
    ["Mineral water 500ml", "Beverages", "BAR", "BOTTLE", 120, 48, 60, 240, 600, drinks, "Bar store"],
    ["Soft drinks 350ml", "Beverages", "BAR", "BOTTLE", 96, 48, 60, 240, 700, drinks, "Bar store"],
    ["Kilimanjaro beer", "Beverages", "BAR", "BOTTLE", 70, 48, 60, 200, 1800, drinks, "Bar store"],
    ["Red wine", "Beverages", "BAR", "BOTTLE", 9, 6, 8, 36, 28000, drinks, "Bar store"],
    ["Whisky", "Beverages", "BAR", "BOTTLE", 5, 3, 4, 12, 65000, drinks, "Bar store"],
    ["Toilet tissue", "Housekeeping", "HOUSEKEEPING", "PACK", 18, 10, 12, 60, 5500, clean, "Linen store"],
    ["Guest soap", "Housekeeping", "HOUSEKEEPING", "PIECE", 240, 100, 120, 600, 300, clean, "Linen store"],
    ["Shampoo sachets", "Housekeeping", "HOUSEKEEPING", "PIECE", 80, 100, 120, 600, 250, clean, "Linen store"],
    ["Cleaning chemical", "Housekeeping", "HOUSEKEEPING", "L", 25, 10, 12, 60, 4500, clean, "Linen store"],
    ["Bath towels", "Housekeeping", "HOUSEKEEPING", "PIECE", 90, 60, 70, 150, 18000, clean, "Linen store"],
    ["LED bulbs", "Maintenance", "MAINTENANCE", "PIECE", 14, 10, 12, 50, 3500, null, "Maintenance room"],
    ["Plumbing tape", "Maintenance", "MAINTENANCE", "ROLL", 6, 3, 4, 20, 1500, null, "Maintenance room"],
    ["Napkins", "Restaurant supplies", "RESTAURANT", "PACK", 30, 10, 12, 60, 3000, market, "Restaurant store"],
    ["Takeaway boxes", "Restaurant supplies", "RESTAURANT", "PIECE", 150, 100, 120, 500, 400, market, "Restaurant store"],
    ["Printer paper", "Office", "OFFICE", "BOX", 3, 2, 2, 10, 45000, null, "Office"],
  ];
  const ids: Record<string, string> = {};
  for (const [name, category, dept, unit, qty, min, reorder, max, cost, supplierId, location, expiry] of rows) {
    const it = await db.inventoryItem.create({
      data: { name, categoryId: cat[category], departmentId: dep[dept], unit, quantity: qty, minStock: min, reorderLevel: reorder, maxStock: max, costPerUnit: cost, supplierId, location, tracksExpiry: !!expiry },
    });
    ids[name] = it.id;
    if (qty > 0) await db.inventoryMovement.create({ data: { itemId: it.id, kind: "ADJUST", reason: "ADJUSTMENT", note: "Opening stock", change: qty, before: 0, after: qty, unit, totalCost: Math.round(qty * cost), departmentId: dep[dept] } });
  }

  // Recipes: one Beef Burger = 150 g beef, 1 bun, 1 slice of cheese, 30 g tomato, 20 g onion.
  const recipe = async (menuItemId: string, lines: [string, number, string][]) => {
    if (!(await db.menuItem.findUnique({ where: { id: menuItemId } }))) return;
    await db.recipeLine.createMany({ data: lines.map(([item, quantity, unit]) => ({ menuItemId, itemId: ids[item], quantity, unit })), skipDuplicates: true });
  };
  await recipe("mi_main_courses_beef_burger", [["Beef", 150, "G"], ["Burger buns", 1, "PIECE"], ["Cheese slices", 1, "SLICE"], ["Tomatoes", 30, "G"], ["Onions", 20, "G"]]);
  await recipe("mi_sides_drinks_mineral_water", [["Mineral water 500ml", 1, "BOTTLE"]]);
  await recipe("mi_sides_drinks_soda_cold_soft_drink", [["Soft drinks 350ml", 1, "BOTTLE"]]);
  await recipe("mi_beers_kilimanjaro", [["Kilimanjaro beer", 1, "BOTTLE"]]);

  // Assets.
  if ((await db.asset.count()) === 0) {
    type A = [code: string, name: string, category: string, location: string, dept: string | null, qty: number, cost: number | null, condition: string, status: string, serial?: string];
    const assets: A[] = [
      ["BED-001", "King-size bed", "Beds & mattresses", "Room 305", "HOUSEKEEPING", 1, 1800000, "GOOD", "IN_USE"],
      ["TV-012", "Samsung 43″ TV", "TVs & electronics", "Room 305", "HOUSEKEEPING", 1, 950000, "DAMAGED", "UNDER_REPAIR", "SN-43TV-0012"],
      ["AC-007", "LG split air conditioner", "Air conditioners", "Room 204", "MAINTENANCE", 1, 1400000, "POOR", "OUT_OF_ORDER", "LG-AC-7781"],
      ["CH-001", "Restaurant chairs", "Furniture", "Restaurant", "RESTAURANT", 40, 3200000, "GOOD", "IN_USE"],
      ["TB-001", "Restaurant tables", "Furniture", "Restaurant", "RESTAURANT", 10, 2500000, "GOOD", "IN_USE"],
      ["FR-001", "Kitchen fridge", "Fridges & freezers", "Kitchen", "KITCHEN", 1, 2200000, "GOOD", "IN_USE"],
      ["WM-001", "Washing machine", "Laundry machines", "Laundry", "HOUSEKEEPING", 2, 3000000, "FAIR", "IN_USE"],
      ["PC-001", "Reception computer", "Computers & printers", "Reception", "RECEPTION", 1, 1600000, "GOOD", "IN_USE"],
      ["POS-001", "POS card machine", "POS devices", "Restaurant", "RESTAURANT", 1, 450000, "NEW", "IN_USE"],
    ];
    for (const [code, name, category, location, dept, quantity, purchaseCost, condition, status, serialNumber] of assets) {
      await db.asset.create({ data: { code, name, category, location, departmentId: dept ? dep[dept] : null, quantity, purchaseCost, condition, status, serialNumber: serialNumber ?? null } });
    }
  }
  console.log(`Inventory demo: ${rows.length} items, recipes and assets.`);
}
