import { getCurrentUser } from "@/server/auth";
import { guardDeveloperExport } from "@/server/services/developer-view-log";
import { getLedger } from "@/server/services/finance";
import { isBusinessDate } from "@/lib/time/business-date";

/** General ledger as CSV (Excel opens it). Same filters as the ledger page. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.permissions.has("finance.view") && !user.permissions.has("ledger.view")) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isBusinessDate(from) || !isBusinessDate(to) || from > to) return new Response("Invalid range", { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) return new Response("Range too long (max 1 year)", { status: 400 });
  const rawView = url.searchParams.get("view");
  const view = rawView === "income" || rawView === "expense" || rawView === "money" ? rawView : "all";
  const accountId = url.searchParams.get("account");
  const userId = url.searchParams.get("user");
  const q = url.searchParams.get("q");
  // A Developer's export is written to the audit trail BEFORE any figure is read or sent — and nothing is sent when it cannot be written.
  const blocked = await guardDeveloperExport(user, {
    kind: "exported", module: "Ledger", entityId: "general-ledger",
    after: { path: url.pathname, report: "general-ledger", from, to, view, account: accountId ?? undefined, user: userId ?? undefined, q: q ?? undefined },
  });
  if (blocked) return blocked;
  const { rows, totals } = await getLedger({ from, to, view, accountId, userId, q });
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ["business_date", "time", "type", "category", "description", "reference", "account", "recorded_by", "income", "expense", "money_in", "money_out", "status", "note"].join(","),
    ...rows.map((r) => [r.businessDate, r.source === "ROOM" ? "" : r.at, r.type, r.category, r.description, r.reference, r.account, r.by, r.income, r.expense, r.moneyIn, r.moneyOut, r.status, r.note].map(esc).join(",")),
    "",
    `total,,,,,,,,${totals.income},${totals.expense},${totals.moneyIn},${totals.moneyOut},,net operating result ${totals.net}`,
  ];
  return new Response("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vegas-ledger-${from}-to-${to}.csv"`, "Cache-Control": "private, no-store" },
  });
}
