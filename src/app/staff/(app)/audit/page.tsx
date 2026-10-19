import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import {
  AUDIT_MAX_DAYS, AUDIT_MAX_PAGE, auditFilterChoices, auditToday, parseAuditFilter, queryAuditTrail, type AuditFilter,
} from "@/server/services/audit-trail";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { getT } from "@/i18n/server";
import { AuditList } from "./audit-rows";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Audit trail") };
}

/** The address of one page of this search (the filters stay; the page number changes). */
function addressOf(f: AuditFilter, page: number) {
  const q = new URLSearchParams({ from: f.from, to: f.to });
  if (f.actor !== "ALL") q.set("who", f.actor);
  if (f.userId) q.set("user", f.userId);
  if (f.action) q.set("action", f.action);
  if (f.module) q.set("module", f.module);
  if (page > 1) q.set("page", String(page));
  return `?${q.toString()}`;
}

export default async function AuditTrailPage({ searchParams }: PageProps<"/staff/audit">) {
  // The Boss, the MD and the Developer. Anyone else is sent away here — and the service refuses them again.
  const user = await requirePagePermission("audit.view");
  const t = await getT();
  const { timezone } = await getSettings();
  const { filter, rangeShortened } = parseAuditFilter(await searchParams, auditToday(timezone));
  // Only what the Developer changed is listed, never his sign-ins, looks or refused tries (owner, 2026-10-19).
  const changes = { ...filter, changesOnly: true };
  const [result, choices] = await Promise.all([queryAuditTrail(user, changes), auditFilterChoices(user, changes)]);
  // (A Developer's visit to this page is written to the audit trail by the layout, like every sensitive page.)

  const f = result.filter;
  const filtered = f.actor !== "ALL" || !!f.userId || !!f.action || !!f.module;

  return (
    <div className="w-full">
      <PageHeader
        title={t("Audit trail")}
        description={t("Who did what, and when: Developer, staff, system and website actions. Read-only — the database refuses any change or delete. The only change the system ever makes to an older line is marking a cancelled check-in as cancelled.")}
      />

      <form method="get" className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("Filter the audit trail")}>
        <div className="space-y-1">
          <Label htmlFor="who">{t("Who acted")}</Label>
          <NativeSelect id="who" name="who" defaultValue={f.actor}>
            <option value="ALL">{t("All")}</option>
            <option value="DEVELOPER">{t("Developer")}</option>
            <option value="STAFF">{t("Staff")}</option>
            <option value="SYSTEM">{t("System & website")}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="user">{t("Person")}</Label>
          <NativeSelect id="user" name="user" defaultValue={f.userId}>
            <option value="">{t("Anyone")}</option>
            {choices.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {t(u.role)}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="action">{t("Action contains")}</Label>
          <Input id="action" name="action" defaultValue={f.action} maxLength={80} placeholder={t("e.g. payment, login, user")} autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="module">{t("Module")}</Label>
          <NativeSelect id="module" name="module" defaultValue={f.module}>
            <option value="">{t("All modules")}</option>
            {choices.modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1"><Label htmlFor="from">{t.ctx("date", "From")}</Label><Input id="from" name="from" type="date" defaultValue={f.from} /></div>
        <div className="space-y-1"><Label htmlFor="to">{t.ctx("date", "To")}</Label><Input id="to" name="to" type="date" defaultValue={f.to} /></div>
        <div className="flex items-end gap-4 sm:col-span-2">
          <Button type="submit">{t("Filter")}</Button>
          {(filtered || f.page > 1) && <Link href="/staff/audit" className="py-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">{t("Clear filters")}</Link>}
        </div>
      </form>

      <p className="mb-3 text-xs text-muted-foreground">{t("Times are in the hotel's time zone ({zone}). Newest first.", { zone: timezone })}</p>
      {rangeShortened && (
        <p role="status" className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {t("One search covers at most {days} days — showing the {days} days up to {to}.", { days: AUDIT_MAX_DAYS, to: t.date(f.to) })}
        </p>
      )}

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={t("No entries found")}
          description={t("Try other dates, or clear the filters.")}
        />
      ) : (
        <AuditList rows={result.rows} t={t} timezone={result.timezone} />
      )}

      {result.limitReached && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {t("This is as far back as one search goes ({pages} pages). Choose closer dates to see older entries.", { pages: AUDIT_MAX_PAGE })}
        </p>
      )}
      {(result.hasPrevious || result.hasNext) && (
        <nav aria-label={t("Pages")} className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t("Page {page}", { page: f.page })} · {t.plural(result.rows.length, "{n} entry shown", "{n} entries shown")}</span>
          <div className="flex gap-2">
            {result.hasPrevious && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={addressOf(f, f.page - 1)} rel="prev">{t.ctx("page", "Previous")}</Link>}
            {result.hasNext && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={addressOf(f, f.page + 1)} rel="next">{t.ctx("page", "Next")}</Link>}
          </div>
        </nav>
      )}
    </div>
  );
}
