import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { addDays, isBusinessDate } from "@/lib/time/business-date";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AuditDetail } from "./audit-detail";
import { ACTIVITY_PAGE_SIZE as PAGE_SIZE, loadActivity } from "./data";
import { ActorBadge } from "../audit/audit-rows";
import { DoneByDeveloper } from "@/components/staff/done-by-developer";
import { doneByText } from "@/lib/done-by-text";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Staff activity") };
}

export default async function ActivityPage({ searchParams }: PageProps<"/staff/activity">) {
  const viewer = await requirePagePermission("staff.activity.view");
  const sp = await searchParams;
  const today = await businessToday();
  const t = await getT();
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const from = isBusinessDate(str(sp.from)) ? str(sp.from)! : addDays(today, -6);
  const to = isBusinessDate(str(sp.to)) ? str(sp.to)! : today;
  const userId = str(sp.user) || undefined;
  const area = str(sp.area) || undefined;
  const page = Math.max(1, Number(str(sp.page)) || 1);

  // Who sees what is decided in ./data.ts: a Developer's rows (and the Developer's account in the list) only for whoever holds "audit.view".
  const { rows, total, users, areas, developers } = await loadActivity(viewer, { from, to, userId, area, page, changesOnly: true });
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
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
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
                {rows.map((r) => {
                  // A Developer who worked as someone: the whole label is the name, and the tag says it in plain words next to it.
                  const doneBy = developers ? doneByText(t, r.actedAs && { as: { id: null, name: r.actedAs.name, role: r.actedAs.role } }) : null;
                  const actedAs = r.actedAs ? `${r.actedAs.name}${r.actedAs.role ? ` (${t(r.actedAs.role)})` : ""}` : null;
                  return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{t.dateTime(r.createdAt)}</TableCell>
                    <TableCell>
                      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                        {r.who ?? t("System")}
                        {developers && <ActorBadge type={r.actorType} t={t} />}
                        {doneBy && <DoneByDeveloper text={doneBy} className="ml-0" />}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.action}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(-8)}` : ""}</TableCell>
                    <TableCell>{(r.before != null || r.after != null) && <AuditDetail action={r.action} before={r.before} after={r.after} actedAs={developers ? actedAs : null} doneBy={doneBy} />}</TableCell>
                  </TableRow>
                  );
                })}
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
