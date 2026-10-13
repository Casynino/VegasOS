// The Boss and MD pictures in Chinese — the list in admin.mjs, plus the report and Spin to Win pages (by address only: nothing is switched or made here).
import { ADMIN_ZH } from "./admin.mjs";
const BOSS = "owner@vegas.test";
const Z = (id, url, spec = {}) => ({ id: id + "-zh", as: BOSS, lang: "zh", view: "desk", h: 900, url, ...spec });
const DAY = "/staff/reports/daily/cmv5d2ztt008jeksb7vb3a8xj";
const TAB = (n) => [{ click: `css:[role=tablist] [role=tab]##${n}`, then: 1500 }];
export const SHOTS = [
  ...ADMIN_ZH,
  Z("a-daily-2", DAY, { like: "a-daily-2", marks: [[1, "Print"], [2, "PDF"], [3, "Share"], [4, "Send now"], [5, "Regenerate"]] }),
  Z("a-daily-3", DAY, { full: true, max: 2600 }),
  Z("a-daily-4", "/staff/reports/daily"),
  Z("a-staffrep", "/staff/reports/staff", { full: true, max: 2000 }),
  Z("a-shifts-all", "/staff/shifts/all"),
  Z("a-reports", "/staff/reports", { like: "a-reports", marks: [[1, "Print"], [2, "PDF"], [3, "Share"]] }),
  Z("a-shiftrep", "/staff/shifts/cmv58ou6d0000eksbb2fng3tp/report", { full: true, max: 2600 }),
  Z("a-spin-5", "/staff/spin-to-win"),
  Z("a-spin-2", "/staff/spin-to-win", { steps: TAB(2), full: true, max: 1900 }),
  Z("a-spin-3", "/staff/spin-to-win", { steps: TAB(3) }),
  Z("a-spin-4", "/staff/spin-to-win", { steps: TAB(4) }),
];
