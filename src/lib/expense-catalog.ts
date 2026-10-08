import { msg } from "../i18n/msg"; // relative: prisma/seed.ts imports this file

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
    code: "UTILITIES", name: msg("Utilities"), icon: "Zap", items: [
      { key: "electricity", name: msg("Electricity (LUKU / TANESCO)"), frequency: "MONTHLY", payee: "TANESCO" },
      { key: "dawasa", name: msg("Water bill — DAWASA"), frequency: "MONTHLY", payee: "DAWASA" },
      { key: "water-delivery", name: msg("Water delivery (bowser)"), frequency: "OCCASIONAL" },
      { key: "generator-fuel", name: msg("Generator fuel"), frequency: "OCCASIONAL" },
      { key: "gas", name: msg("Cooking gas"), frequency: "MONTHLY" },
      { key: "waste", name: msg("Waste collection"), frequency: "MONTHLY" },
      { key: "waste-water", name: msg("Waste water (septic emptying)"), frequency: "MONTHLY" },
    ],
  },
  {
    code: "INTERNET", name: msg("TV, internet & subscriptions"), icon: "Wifi", items: [
      { key: "internet", name: msg("Internet (monthly)"), frequency: "MONTHLY" },
      { key: "decoder", name: msg("TV decoder subscription (DStv / Azam)"), frequency: "MONTHLY" },
      { key: "netflix", name: "Netflix", frequency: "MONTHLY", payee: "Netflix" },
      { key: "software", name: msg("Software & apps subscription"), frequency: "MONTHLY" },
    ],
  },
  {
    code: "SALARIES", name: msg("Staff & payroll"), icon: "Users", items: [
      { key: "salaries", name: msg("Staff salaries"), frequency: "MONTHLY" },
      { key: "statutory", name: msg("NSSF / SDL / PAYE"), frequency: "MONTHLY" },
      { key: "staff-food", name: msg("Staff food"), frequency: "DAILY" },
      { key: "staff-expenses", name: msg("Staff expenses (transport, allowances)"), frequency: "OCCASIONAL" },
      { key: "staff-termination", name: msg("Staff contract termination"), frequency: "OCCASIONAL" },
      { key: "staff-uniforms", name: msg("Staff uniforms"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "FOOD", name: msg("Food & kitchen"), icon: "UtensilsCrossed", items: [
      { key: "breakfast", name: msg("Breakfast supplies"), frequency: "DAILY" },
      { key: "kitchen", name: msg("Kitchen shopping (food)"), frequency: "DAILY" },
      { key: "kitchen-equipment", name: msg("Kitchen equipment & utensils"), frequency: "OCCASIONAL" },
      { key: "drinking-water", name: msg("Drinking water (bottles)"), frequency: "DAILY" },
    ],
  },
  {
    code: "BAR_SUPPLIES", name: msg("Bar & drinks"), icon: "Wine", items: [
      { key: "drinks-stock", name: msg("Drinks stock (outside counter capital)"), frequency: "DAILY" },
      { key: "ice", name: msg("Ice"), frequency: "DAILY" },
    ],
  },
  {
    code: "HOUSEKEEPING", name: msg("Housekeeping & laundry"), icon: "SprayCan", items: [
      { key: "housekeeping", name: msg("Housekeeping supplies (detergents, toilet paper)"), frequency: "DAILY" },
      { key: "laundry", name: msg("Laundry expenses"), frequency: "OCCASIONAL" },
      { key: "guest-amenities", name: msg("Guest amenities (soap, shampoo, slippers)"), frequency: "OCCASIONAL" },
      { key: "linen", name: msg("Bed linen & towels"), frequency: "OCCASIONAL" },
      { key: "pest-control", name: msg("Pest control"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "MAINTENANCE", name: msg("Repairs & maintenance"), icon: "Wrench", items: [
      { key: "building", name: msg("Building maintenance"), frequency: "OCCASIONAL" },
      { key: "generator-maintenance", name: msg("Generator maintenance"), frequency: "OCCASIONAL" },
      { key: "ac", name: msg("AC repair & service"), frequency: "OCCASIONAL" },
      { key: "plumbing", name: msg("Plumbing repairs"), frequency: "OCCASIONAL" },
      { key: "electrical", name: msg("Electrical repairs"), frequency: "OCCASIONAL" },
      { key: "furniture", name: msg("Furniture & equipment repair"), frequency: "OCCASIONAL" },
      { key: "painting", name: msg("Painting"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "TRANSPORT", name: msg("Transport & fuel"), icon: "Car", items: [
      { key: "car-fuel", name: msg("Car fuel"), frequency: "DAILY" },
      { key: "bajaji", name: msg("Bajaji / bodaboda (errands)"), frequency: "DAILY" },
      { key: "vehicle-service", name: msg("Vehicle service & repair"), frequency: "OCCASIONAL" },
      { key: "parking", name: msg("Parking & road fees"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "MARKETING", name: msg("Sales & marketing"), icon: "Megaphone", items: [
      { key: "digital-marketing", name: msg("Digital marketing"), frequency: "MONTHLY" },
      { key: "booking-com", name: msg("Booking.com commission"), frequency: "MONTHLY", payee: "Booking.com" },
      { key: "online-ads", name: msg("Online ads (Instagram / Facebook / Google)"), frequency: "OCCASIONAL" },
      { key: "printing", name: msg("Printing & signage"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "BANK_FEES", name: msg("Bank & payment fees"), icon: "Landmark", items: [
      { key: "selcom", name: msg("Selcom fee"), frequency: "MONTHLY", payee: "Selcom" },
      { key: "pesapal", name: msg("Pesapal / Lipa number fee"), frequency: "MONTHLY", payee: "Pesapal" },
      { key: "bank-charges", name: msg("Bank charges"), frequency: "MONTHLY" },
      { key: "mobile-money-charges", name: msg("Mobile money charges"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "SECURITY", name: msg("Security & insurance"), icon: "ShieldCheck", items: [
      { key: "security", name: msg("Security company (Co-operative Defense)"), frequency: "MONTHLY", payee: "Co-operative Defense" },
      { key: "insurance", name: msg("Vegas insurance"), frequency: "MONTHLY" },
      { key: "fire-safety", name: msg("Fire extinguisher service"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "TAXES", name: msg("Government, taxes & licences"), icon: "Scale", items: [
      { key: "compulsory", name: msg("Monthly compulsory payment"), frequency: "MONTHLY" },
      { key: "service-levy", name: msg("Service levy (city council)"), frequency: "OCCASIONAL" },
      { key: "tourism-levy", name: msg("Tourism / hotel levy"), frequency: "OCCASIONAL" },
      { key: "licences", name: msg("Business licences & permits"), frequency: "OCCASIONAL" },
      { key: "tra", name: msg("TRA taxes"), frequency: "OCCASIONAL", payee: "TRA" },
    ],
  },
  {
    code: "OFFICE_SUPPLIES", name: msg("Office & admin"), icon: "Briefcase", items: [
      { key: "stationery", name: msg("Stationery & printing paper"), frequency: "OCCASIONAL" },
      { key: "airtime", name: msg("Phone airtime & bundles"), frequency: "OCCASIONAL" },
    ],
  },
  {
    code: "OTHER", name: msg("Other"), icon: "Package", items: [
      { key: "others", name: msg("Others"), frequency: "OCCASIONAL" },
      { key: "sent-to-china", name: msg("Sent to China"), frequency: "OCCASIONAL" },
    ],
  },
];

/** Old categories folded into the groups above (kept for old records, hidden when recording). */
export const RETIRED_CATEGORY_CODES = ["CLEANING", "GUEST_SUPPLIES", "ELECTRICITY", "WATER", "FUEL", "RESTAURANT_SUPPLIES"];

export const FREQUENCY_LABEL: Record<ExpenseFrequency, string> = { DAILY: msg("Often"), MONTHLY: msg("Monthly bill"), OCCASIONAL: msg("Now and then") };
