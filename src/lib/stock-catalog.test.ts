import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "./permissions";
import { HOTEL_CATALOG, STOCK_CATALOG } from "./stock-catalog";
import { askScope, canAskFor } from "./stock-requests";

describe("what each department is offered when it asks", () => {
  const names = (groups: typeof HOTEL_CATALOG) => groups.flatMap((g) => g.items.map((i) => i.name.toLowerCase()));

  it("Reception's suggestions are the hotel's general needs — towels, toiletries, bedding, amenities, cleaning, office, furniture, maintenance — and none of the kitchen's", () => {
    const hotel = names(HOTEL_CATALOG);
    for (const n of ["bath towels", "toothbrushes", "bathing soap", "shampoo", "toilet paper", "bed sheets", "pillowcases", "blankets", "room slippers", "printer paper", "light bulbs", "batteries", "chairs"]) expect(hotel, n).toContain(n);
    const kitchen = names(STOCK_CATALOG);
    // Only the plain cleaning basics are common to both (a hotel and a kitchen both buy rubbish bags and gloves) — never food or kitchen equipment.
    expect(hotel.filter((n) => kitchen.includes(n)).sort()).toEqual(["gloves", "rubbish bags"]);
    for (const n of ["beef", "rice", "cooking oil", "eggs", "tomatoes"]) expect(hotel, n).not.toContain(n);
  });

  it("the restaurant and kitchen list keeps its food, supplies and now has the cooking and serving equipment too", () => {
    const kitchen = names(STOCK_CATALOG);
    for (const n of ["beef", "rice", "cooking oil", "eggs", "cooking pots", "plates", "drinking glasses", "takeaway boxes", "dish soap"]) expect(kitchen, n).toContain(n);
    expect(names(HOTEL_CATALOG)).not.toContain("plates");
  });

  it("each person is offered their own departments: Reception the hotel's, the restaurant and kitchen theirs, Finance and the managers any", () => {
    const scope = (role: keyof typeof DEFAULT_ROLES) => askScope(new Set<string>(DEFAULT_ROLES[role].permissions));
    expect(scope("RECEPTIONIST")).toBe("HOTEL");
    expect(scope("RESTAURANT_SCREEN")).toBe("RESTAURANT");
    expect(scope("KITCHEN")).toBe("RESTAURANT");
    for (const r of ["FINANCE", "MANAGER", "OWNER", "ADMIN", "ACCOUNTANT"] as const) expect(scope(r), r).toBe("ALL");
    expect(["RECEPTION", "HOUSEKEEPING", "MAINTENANCE", "OFFICE", "GENERAL"].map((c) => canAskFor("HOTEL", c))).toEqual([true, true, true, true, true]);
    expect(["KITCHEN", "BAR", "RESTAURANT"].map((c) => canAskFor("HOTEL", c))).toEqual([false, false, false]);
    expect(["KITCHEN", "BAR", "RESTAURANT"].map((c) => canAskFor("RESTAURANT", c))).toEqual([true, true, true]);
    expect(["RECEPTION", "HOUSEKEEPING", "MAINTENANCE", "OFFICE", "GENERAL"].map((c) => canAskFor("RESTAURANT", c))).toEqual([false, false, false, false, false]);
  });
});
