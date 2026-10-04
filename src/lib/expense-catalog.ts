/**
 * The hotel's expense list: groups (categories) and the expense types staff pick
 * when recording money paid out. Built from the hotel's own monthly sheet
 * (June 2026 summary + fixed expenses) plus the usual costs of a hotel.
 * Staff can add new types while recording; managers tidy them in Settings.
 *
 * frequency: MONTHLY = a fixed monthly bill (shows on the "Monthly bills" checklist),
 * DAILY = bought often, OCCASIONAL = now and then.
 */
export type ExpenseFrequency = "DAILY" | "MONTHLY" | "OCCASIONAL";

export interface CatalogGroup {
  code: string;
  name: string;
  icon: string;
  items: { key: string; name: string; frequency: ExpenseFrequency; payee?: string }[];
}

export const EXPENSE_CATALOG: CatalogGroup[] = [
  {
    code: "UTILITIES", name: "Utilities", icon: "Zap", items: [
      { key: "electricity", name: "Electricity (LUKU / TANESCO)", frequency: "MONTHLY", payee: "TANESCO" },
      { key: "dawasa", name: "Water bill — DAWASA", frequency: "MONTHLY", payee: "DAWASA" },
      { key: "water-delivery", name: "Water delivery (bowser)", frequency: "OCCASIONAL" },
      { key: "generator-fuel", name: "Generator fuel", frequency: "OCCASIONAL" },
      { key: "gas", name: "Cooking gas", frequency: "MONTHLY" },
      { key: "waste", name: "Waste collection", frequency: "MONTHLY" },
      { key: "waste-water", name: "Waste water (septic emptying)", frequency: "MONTHLY" },
    ],
  },
  {
    code: "INTERNET", name: "TV, internet & subscriptions", icon: "Wifi", items: [
      { key: "internet", name: "Internet (monthly)", frequency: "MONTHLY" },
      { key: "decoder", name: "TV decoder subscription (DStv / Azam)", frequency: "MONTHLY" },
      { key: "netflix", name: "Netflix", frequency: "MONTHLY", payee: "Netflix" },
      { key: "software", name: "Software & apps subscription", frequency: "MONTHLY" },
    ],
  },
  {
    code: "SALARIES", name: "Staff & payroll", icon: "Users", items: [
      { key: "salaries", name: "Staff salaries", frequency: "MONTHLY" },
      { key: "statutory", name: "NSSF / SDL / PAYE", frequency: "MONTHLY" },
      { key: "staff-food", name: "Staff food", frequency: "DAILY" },
      { key: "staff-expenses", name: "Staff expenses (transport, allowances)", frequency: "OCCASIONAL" },
      { key: "staff-termination", name: "Staff contract termination", frequency: "OCCASIONAL" },
      { key: "staff-uniforms", name: "Staff uniforms", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "FOOD", name: "Food & kitchen", icon: "UtensilsCrossed", items: [
      { key: "breakfast", name: "Breakfast supplies", frequency: "DAILY" },
      { key: "kitchen", name: "Kitchen shopping (food)", frequency: "DAILY" },
      { key: "kitchen-equipment", name: "Kitchen equipment & utensils", frequency: "OCCASIONAL" },
      { key: "drinking-water", name: "Drinking water (bottles)", frequency: "DAILY" },
    ],
  },
  {
    code: "BAR_SUPPLIES", name: "Bar & drinks", icon: "Wine", items: [
      { key: "drinks-stock", name: "Drinks stock (outside counter capital)", frequency: "DAILY" },
      { key: "ice", name: "Ice", frequency: "DAILY" },
    ],
  },
  {
    code: "HOUSEKEEPING", name: "Housekeeping & laundry", icon: "SprayCan", items: [
      { key: "housekeeping", name: "Housekeeping supplies (detergents, toilet paper)", frequency: "DAILY" },
      { key: "laundry", name: "Laundry expenses", frequency: "OCCASIONAL" },
      { key: "guest-amenities", name: "Guest amenities (soap, shampoo, slippers)", frequency: "OCCASIONAL" },
      { key: "linen", name: "Bed linen & towels", frequency: "OCCASIONAL" },
      { key: "pest-control", name: "Pest control", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "MAINTENANCE", name: "Repairs & maintenance", icon: "Wrench", items: [
      { key: "building", name: "Building maintenance", frequency: "OCCASIONAL" },
      { key: "generator-maintenance", name: "Generator maintenance", frequency: "OCCASIONAL" },
      { key: "ac", name: "AC repair & service", frequency: "OCCASIONAL" },
      { key: "plumbing", name: "Plumbing repairs", frequency: "OCCASIONAL" },
      { key: "electrical", name: "Electrical repairs", frequency: "OCCASIONAL" },
      { key: "furniture", name: "Furniture & equipment repair", frequency: "OCCASIONAL" },
      { key: "painting", name: "Painting", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "TRANSPORT", name: "Transport & fuel", icon: "Car", items: [
      { key: "car-fuel", name: "Car fuel", frequency: "DAILY" },
      { key: "bajaji", name: "Bajaji / bodaboda (errands)", frequency: "DAILY" },
      { key: "vehicle-service", name: "Vehicle service & repair", frequency: "OCCASIONAL" },
      { key: "parking", name: "Parking & road fees", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "MARKETING", name: "Sales & marketing", icon: "Megaphone", items: [
      { key: "digital-marketing", name: "Digital marketing", frequency: "MONTHLY" },
      { key: "booking-com", name: "Booking.com commission", frequency: "MONTHLY", payee: "Booking.com" },
      { key: "online-ads", name: "Online ads (Instagram / Facebook / Google)", frequency: "OCCASIONAL" },
      { key: "printing", name: "Printing & signage", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "BANK_FEES", name: "Bank & payment fees", icon: "Landmark", items: [
      { key: "selcom", name: "Selcom fee", frequency: "MONTHLY", payee: "Selcom" },
      { key: "pesapal", name: "Pesapal / Lipa number fee", frequency: "MONTHLY", payee: "Pesapal" },
      { key: "bank-charges", name: "Bank charges", frequency: "MONTHLY" },
      { key: "mobile-money-charges", name: "Mobile money charges", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "SECURITY", name: "Security & insurance", icon: "ShieldCheck", items: [
      { key: "security", name: "Security company (Co-operative Defense)", frequency: "MONTHLY", payee: "Co-operative Defense" },
      { key: "insurance", name: "Vegas insurance", frequency: "MONTHLY" },
      { key: "fire-safety", name: "Fire extinguisher service", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "TAXES", name: "Government, taxes & licences", icon: "Scale", items: [
      { key: "compulsory", name: "Monthly compulsory payment", frequency: "MONTHLY" },
      { key: "service-levy", name: "Service levy (city council)", frequency: "OCCASIONAL" },
      { key: "tourism-levy", name: "Tourism / hotel levy", frequency: "OCCASIONAL" },
      { key: "licences", name: "Business licences & permits", frequency: "OCCASIONAL" },
      { key: "tra", name: "TRA taxes", frequency: "OCCASIONAL", payee: "TRA" },
    ],
  },
  {
    code: "OFFICE_SUPPLIES", name: "Office & admin", icon: "Briefcase", items: [
      { key: "stationery", name: "Stationery & printing paper", frequency: "OCCASIONAL" },
      { key: "airtime", name: "Phone airtime & bundles", frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "OTHER", name: "Other", icon: "Package", items: [
      { key: "others", name: "Others", frequency: "OCCASIONAL" },
      { key: "sent-to-china", name: "Sent to China", frequency: "OCCASIONAL" },
    ],
  },
];

/** Old categories folded into the groups above (kept for old records, hidden when recording). */
export const RETIRED_CATEGORY_CODES = ["CLEANING", "GUEST_SUPPLIES", "ELECTRICITY", "WATER", "FUEL", "RESTAURANT_SUPPLIES"];

export const FREQUENCY_LABEL: Record<ExpenseFrequency, string> = { DAILY: "Often", MONTHLY: "Monthly bill", OCCASIONAL: "Now and then" };
