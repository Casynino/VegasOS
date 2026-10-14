import { getCurrentUser } from "@/server/auth";
import { guardDeveloperExport } from "@/server/services/developer-view-log";
import { handoverList } from "@/server/services/cash-handover";
import { CASH_HANDOVER_ON } from "@/lib/cash-handover";
import { isBusinessDate, presetRange, type PeriodPreset } from "@/lib/time/business-date";
import { businessToday } from "@/server/settings";

/** Cash handovers as CSV (Excel opens it) — the same period as the Cash reports page. */
export async function GET(req: Request) {
  if (!CASH_HANDOVER_ON) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.permissions.has("cash.handover.view") && !user.permissions.has("cash.handover.review")) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  let from = url.searchParams.get("from");
  let to = url.searchParams.get("to");
  if (!from || !to) {
    const preset = url.searchParams.get("period");
    const key: PeriodPreset = preset === "today" || preset === "yesterday" || preset === "week" || preset === "month" || preset === "year" ? preset : "month";
    ({ from, to } = presetRange(key, await businessToday()));
  }
  if (!isBusinessDate(from) || !isBusinessDate(to) || from > to) return new Response("Invalid range", { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) return new Response("Range too long (max 1 year)", { status: 400 });
  // A Developer's export is written to the audit trail BEFORE any figure is read or sent — and nothing is sent when it cannot be written.
  const blocked = await guardDeveloperExport(user, { kind: "exported", module: "CashHandover", entityId: "cash-handovers", after: { path: url.pathname, report: "cash-handovers", from, to } });
  if (blocked) return blocked;
  const rows = await handoverList({ from, to, take: 2000 });
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // A cell that starts with = + - @ would be run as a formula by a spreadsheet: keep it as text.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [
    ["number", "business_date", "submitted_at", "department", "submitted_by", "period_from", "period_to", "collected", "refunds", "expected", "declared", "received", "difference", "status", "received_by", "received_at", "into_account", "staff_note", "accountant_note"].join(","),
    ...rows.map((h) => [
      h.number, h.businessDate.toISOString().slice(0, 10), h.submittedAt.toISOString(), h.department, h.submittedBy.fullName, h.periodStart.toISOString(), h.periodEnd.toISOString(),
      h.collected, h.refunds, h.expected, h.declared, h.received ?? "", h.difference ?? "", h.status, h.reviewedBy?.fullName ?? "", h.reviewedAt?.toISOString() ?? "", h.toAccount?.name ?? "", h.declaredNote ?? "", h.reviewNote ?? "",
    ].map(esc).join(",")),
  ];
  return new Response("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vegas-cash-handovers-${from}-to-${to}.csv"`, "Cache-Control": "private, no-store" },
  });
}
