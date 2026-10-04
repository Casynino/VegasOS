import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { addDays, isBusinessDate, toDbDate } from "@/lib/time/business-date";
import { formatDateTime } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AuditDetail } from "./audit-detail";

export const metadata: Metadata = { title: "Staff activity" };
const PAGE_SIZE = 50;

export default async function ActivityPage({ searchParams }: PageProps<"/staff/activity">) {
  await requirePagePermission("staff.activity.view");
  const sp = await searchParams;
  const today = await businessToday();
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
      <PageHeader title="Staff activity" description="Who did what, and when. Every important action is recorded with before/after values." />
      <form className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-5 sm:items-end">
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <div className="space-y-1">
          <Label htmlFor="user">Staff member</Label>
          <NativeSelect id="user" name="user" defaultValue={userId ?? ""}>
            <option value="">Everyone</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="area">Area</Label>
          <NativeSelect id="area" name="area" defaultValue={area ?? ""}>
            <option value="">All areas</option>
            {areas.map((a) => <option key={a.area} value={a.area}>{a.area}</option>)}
          </NativeSelect>
        </div>
        <Button type="submit">Filter</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No activity in this period" description="Try widening the date range or clearing filters." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table data-stack>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Record</TableHead>
                  <TableHead className="w-10"><span className="sr-only">Details</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell>{r.user?.fullName ?? r.actorLabel ?? "System"}</TableCell>
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
          <span className="text-muted-foreground">Page {page} of {pages} · {total} entries</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${qs(page - 1)}`}>Previous</Link>}
            {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${qs(page + 1)}`}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
