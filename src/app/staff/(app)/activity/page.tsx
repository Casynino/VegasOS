import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { addDays, isBusinessDate, toDbDate } from "@/lib/time/business-date";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AuditDetail } from "./audit-detail";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Staff activity") };
}
const PAGE_SIZE = 50;

export default async function ActivityPage({ searchParams }: PageProps<"/staff/activity">) {
  await requirePagePermission("staff.activity.view");
  const sp = await searchParams;
  const today = await businessToday();
  const t = await getT();
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const from = isBusinessDate(str(sp.from)) ? str(sp.from)! : addDays(today, -6);
  const to = isBusinessDate(str(sp.to)) ? str(sp.to)! : today;
  const userId = str(sp.user) || undefined;
  const area = str(sp.area) || undefined;
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const where = {
    businessDate: { gte: toDbDate(from), lte: toDbDate(to) },
    ...(userId ? { userId } : {}),
    ...(area ? { action: { startsWith: `${area}.` } } : {}),
  };

  const [rows, total, users, areas] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.$queryRaw<{ area: string }[]>`SELECT DISTINCT split_part("action", '.', 1) AS area FROM "audit_logs" ORDER BY 1`,
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => new URLSearchParams({ from, to, ...(userId && { user: userId }), ...(area && { area }), page: String(p) }).toString();

  return (
    <div className="w-full">
      <PageHeader title={t("Staff activity")} description={t("Who did what, and when. Every important action is recorded with before/after values.")} />
      <form className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-5 sm:items-end">
        <div className="space-y-1"><Label htmlFor="from">{t.ctx("date", "From")}</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">{t.ctx("date", "To")}</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <div className="space-y-1">
          <Label htmlFor="user">{t("Staff member")}</Label>
          <NativeSelect id="user" name="user" defaultValue={userId ?? ""}>
            <option value="">{t("Everyone")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="area">{t.ctx("activity", "Area")}</Label>
          <NativeSelect id="area" name="area" defaultValue={area ?? ""}>
            <option value="">{t("All areas")}</option>
            {areas.map((a) => <option key={a.area} value={a.area}>{a.area}</option>)}
          </NativeSelect>
        </div>
        <Button type="submit">{t("Filter")}</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={t("No activity in this period")} description={t("Try widening the date range or clearing filters.")} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table data-stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("When")}</TableHead>
                  <TableHead>{t("Who")}</TableHead>
                  <TableHead>{t("Action")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("Record")}</TableHead>
                  <TableHead className="w-10"><span className="sr-only">{t("Details")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{t.dateTime(r.createdAt)}</TableCell>
                    <TableCell>{r.user?.fullName ?? r.actorLabel ?? t("System")}</TableCell>
                    <TableCell className="font-mono text-xs">{r.action}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(-8)}` : ""}</TableCell>
                    <TableCell>{(r.before || r.after) && <AuditDetail action={r.action} before={r.before} after={r.after} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("Page {page} of {pages} · {total} entries", { page, pages, total })}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${qs(page - 1)}`}>{t.ctx("page", "Previous")}</Link>}
            {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${qs(page + 1)}`}>{t.ctx("page", "Next")}</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
