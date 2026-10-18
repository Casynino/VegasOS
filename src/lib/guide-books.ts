import { msg } from "@/i18n/msg";
import type { PermissionCode } from "./permissions";

/**
 * THE GUIDE BOOKS (owner, 2026-10-18: "put the guide books on admin, manager and developer, for them to just download and share").
 * Twelve A4 books built with `node guides/tools/build.mjs <id>` — their pictures come from the practice copy, never from the live hotel.
 * The finished PDFs are 106 MB: they are NOT in the repository (it is public) and NOT in the database. They live in the hotel's file storage
 * (Vercel Blob) under `guide-books/`, put there by the Developer from the Guide books page. Who may SEE the page and download: the Boss, the MD,
 * the Manager and the Developer. Who may upload or remove: the Developer only.
 */
export const GUIDE_FOLDER = "guide-books/";
/** Any of these rights opens the page: the Boss and the MD (their dashboards), the Manager, and the Developer. */
export const GUIDE_VIEW_RIGHTS: PermissionCode[] = ["dashboard.admin", "dashboard.owner", "dashboard.manager", "developer.access"];
/** The file name a book must have (`node guides/tools/build.mjs` writes these). */
export const GUIDE_FILE = /^Vegas-Guide-(\d{2})-[A-Za-z0-9-]{1,80}\.pdf$/;
export const GUIDE_MAX_BYTES = 60 * 1024 * 1024;

export interface GuideBookInfo {
  /** The file name, "Vegas-Guide-07-Manager.pdf". */
  file: string;
  /** "07" */
  number: string;
  title: string;
  /** Who the book is for, in one short line. */
  audience: string;
}

/** The twelve books of edition 2, in order. A file that is not listed here but follows the name rule is shown under "Other books". */
export const GUIDE_CATALOG: readonly GuideBookInfo[] = [
  { file: "Vegas-Guide-01-Reception.pdf", number: "01", title: msg("Reception"), audience: msg("Front desk: bookings, check-in and check-out, payments, the shift.") },
  { file: "Vegas-Guide-02-Waiters.pdf", number: "02", title: msg("Waiters"), audience: msg("Waiters: orders, tables, serving, the bill.") },
  { file: "Vegas-Guide-03-Restaurant-Counter.pdf", number: "03", title: msg("Restaurant Counter"), audience: msg("The counter: sales, collecting the money, the day's close.") },
  { file: "Vegas-Guide-04-Kitchen-and-Bar.pdf", number: "04", title: msg("Kitchen and Bar"), audience: msg("Kitchen and bar: the order screen, preparing, stock.") },
  { file: "Vegas-Guide-05-Housekeeping.pdf", number: "05", title: msg("Housekeeping"), audience: msg("Housekeeping: room status, cleaning, daily lists.") },
  { file: "Vegas-Guide-06-Driver.pdf", number: "06", title: msg("Driver"), audience: msg("Drivers: trips, pick-ups, confirming.") },
  { file: "Vegas-Guide-07-Manager.pdf", number: "07", title: msg("Manager"), audience: msg("Managers: watching every department, decisions, reports.") },
  { file: "Vegas-Guide-08-Admin-Boss-and-MD-English.pdf", number: "08", title: msg("Boss and MD (English)"), audience: msg("The Boss and the MD: reports, money, staff and settings.") },
  { file: "Vegas-Guide-09-Admin-Boss-and-MD-Chinese.pdf", number: "09", title: msg("Boss and MD (Chinese)"), audience: msg("The same book in Chinese.") },
  { file: "Vegas-Guide-10-Guests-and-Website.pdf", number: "10", title: msg("Guests and Website"), audience: msg("What guests see: the website, the QR codes, ordering from the phone.") },
  { file: "Vegas-Guide-11-Finance.pdf", number: "11", title: msg("Finance"), audience: msg("Finance: purchases, payments, ledgers, withdrawals.") },
  { file: "Vegas-Guide-12-Purchasing.pdf", number: "12", title: msg("Purchasing"), audience: msg("Purchasing (Accountant): quotations, orders, deliveries.") },
];

export const guideInfo = (file: string): GuideBookInfo | null => {
  const known = GUIDE_CATALOG.find((b) => b.file === file);
  if (known) return known;
  const m = GUIDE_FILE.exec(file);
  return m ? { file, number: m[1], title: file.replace(/^Vegas-Guide-\d{2}-/, "").replace(/\.pdf$/, "").replace(/-/g, " "), audience: "" } : null;
};
