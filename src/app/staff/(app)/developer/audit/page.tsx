import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText, Search } from "lucide-react";
import { requirePagePermission, requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import {
  AUDIT_MAX_DAYS, AUDIT_MAX_PAGE, auditToday, parseDeveloperAuditFilter, queryAuditTrail, type AuditFilter, type DeveloperAuditView,
} from "@/server/services/audit-trail";
import { staffHome } from "@/lib/staff-home";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeveloperAuditList } from "./developer-audit-rows";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Audit") };
}
export const dynamic = "force-dynamic";

const CHIPS: { view: DeveloperAuditView; label: string }[] = [
  { view: "all", label: msg("Everything") },
  { view: "developer", label: msg("Developer actions") },
  { view: "failures", label: msg("Failures") },
];

/** The address of one search (the chips, the search words, the dates and the page number — nothing else is ever put in it). */
function addressOf(view: DeveloperAuditView, f: AuditFilter, page = 1) {
  const q = new URLSearchParams({ from: f.from, to: f.to });
  if (view !== "all") q.set("view", view);
  if (f.q) q.set("q", f.q);
  if (page > 1) q.set("page", String(page));
  return `?${q.toString()}`;
}

/**
 * AUDIT — the permanent diary of the system, for the Developer: who did what, and when. The reader is the same audit-trail service as
 * the Boss's and the MD's page (src/server/services/audit-trail.ts); this page only reads. Nothing here edits or deletes an entry,
 * and the database itself refuses it for a Developer's own rows.
 */
export default async function DeveloperAuditPage({ searchParams }: PageProps<"/staff/developer/audit">) {
  // The Developer's console and the "Work as" world are kept apart: while working as someone, this page is closed — to their own home.
  const me = await requireUser();
  if (me.workAs) redirect(staffHome(me.permissions));
  const user = await requirePagePermission("developer.access");

  const t = await getT();
  const { timezone } = await getSettings();
  const { filter, view, rangeShortened } = parseDeveloperAuditFilter(await searchParams, auditToday(timezone));
  const result = await queryAuditTrail(user, filter);
  const f = result.filter;
  const narrowed = view !== "all" || !!f.q;

  return (
    <div className="w-full space-y-5">
      <PageHeader
        title={t("Audit")}
        description={t("The permanent diary of the system: who did what, and when. Developer actions can't be edited or deleted — not even from the database.")}
      />

      <aside className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_2px_4px_rgba(15,23,42,0.03)]">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true"><ScrollText className="size-4" /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("How to read this page")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t.rich("Each line is one thing that happened. A <gold></gold> gold dot and a <b>Developer</b> tag mean it was done by you — including when you worked as someone (shown as “you (Developer) as them”). A <blue></blue> blue dot is normal staff work, a <grey></grey> grey dot is the system, and a <red></red> red dot is something that failed. Use the filters to show only your actions, or only failures.", {
              gold: () => <Dot className="bg-amber-400" />,
              blue: () => <Dot className="bg-sky-500" />,
              grey: () => <Dot className="bg-slate-400" />,
              red: () => <Dot className="bg-red-500" />,
              b: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong>,
            })}
          </p>
        </div>
      </aside>

      <nav aria-label={t("Show")} className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <Link
            key={c.view}
            href={addressOf(c.view, f)}
            aria-current={c.view === view ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              c.view === view ? "border-gold bg-gold/15 font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(c.label)}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-2" aria-label={t("Search the audit")}>
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input name="q" defaultValue={f.q ?? ""} maxLength={80} autoComplete="off" placeholder={t("Search who, what or where…")} aria-label={t("Search who, what or where…")} className="h-10 pl-9" />
        </div>
        <Input name="from" type="date" defaultValue={f.from} aria-label={t.ctx("date", "From")} className="h-10 w-auto" />
        <Input name="to" type="date" defaultValue={f.to} aria-label={t.ctx("date", "To")} className="h-10 w-auto" />
        <Button type="submit" className="h-10 px-4">{t("Filter")}</Button>
        {(narrowed || f.page > 1) && <Link href="/staff/developer/audit" className="py-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">{t("Clear filters")}</Link>}
      </form>

      <p className="text-xs text-muted-foreground">{t("Times are in the hotel's time zone ({zone}). Newest first.", { zone: timezone })}</p>
      {rangeShortened && (
        <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {t("One search covers at most {days} days — showing the {days} days up to {to}.", { days: AUDIT_MAX_DAYS, to: t.date(f.to) })}
        </p>
      )}

      {result.rows.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t("No entries found")} description={t("Try other dates, or clear the filters.")} />
      ) : (
        <DeveloperAuditList rows={result.rows} t={t} timezone={result.timezone} />
      )}

      {result.limitReached && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("This is as far back as one search goes ({pages} pages). Choose closer dates to see older entries.", { pages: AUDIT_MAX_PAGE })}
        </p>
      )}
      {(result.hasPrevious || result.hasNext) && (
        <nav aria-label={t("Pages")} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t("Page {page}", { page: f.page })} · {t.plural(result.rows.length, "{n} entry shown", "{n} entries shown")}</span>
          <div className="flex gap-2">
            {result.hasPrevious && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={addressOf(view, f, f.page - 1)} rel="prev">{t.ctx("page", "Previous")}</Link>}
            {result.hasNext && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={addressOf(view, f, f.page + 1)} rel="next">{t.ctx("page", "Next")}</Link>}
          </div>
        </nav>
      )}
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("mx-0.5 inline-block size-2 rounded-full align-middle", className)} />;
}
