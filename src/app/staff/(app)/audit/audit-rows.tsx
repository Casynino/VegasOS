import { ChevronDown, CircleCheck, CircleX, ShieldAlert } from "lucide-react";
import type { T } from "@/i18n/translate";
import { msg } from "@/i18n/msg";
import { cn } from "@/lib/utils";
import { redact, type ActorType } from "@/server/audit";
import { auditActionWords, type AuditRow } from "@/server/services/audit-trail";

/**
 * The audit trail's rows. Read-only on purpose: there is not one edit, delete, restore or "mark as read" control here, and the
 * rows are plain server-drawn HTML (a row opens with the browser's own <details> — no script, nothing to change in the page).
 *
 * Phone: every entry is a small card. From `md` up the same entry is one line of a grid, with a heading row above.
 * A Developer's entry has the same strong purple as the "DEVELOPER MODE" strip (a solid badge and a bar down its left edge),
 * so it is found at a glance.
 */

const TYPE_LABEL: Record<ActorType, string> = { DEVELOPER: msg("Developer"), STAFF: msg("Staff"), SYSTEM: msg("System"), WEBSITE: msg("Website") };
const TYPE_STYLE: Record<ActorType, string> = {
  DEVELOPER: "bg-fuchsia-700 text-white",
  STAFF: "bg-muted text-foreground",
  SYSTEM: "border border-border text-muted-foreground",
  WEBSITE: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

/** The same columns for the heading row and every entry (md and up). */
const COLUMNS = "md:grid-cols-[7.5rem_6.5rem_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_5.5rem_1.25rem]";

export function ActorBadge({ type, t }: { type: ActorType; t: T }) {
  return (
    <span data-actor-type={type} className={cn("inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap", TYPE_STYLE[type])}>
      {type === "DEVELOPER" && <ShieldAlert className="size-3" aria-hidden="true" />}
      {t(TYPE_LABEL[type])}
    </span>
  );
}

function Result({ ok, t }: { ok: boolean; t: T }) {
  return ok ? (
    <span data-result="ok" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <CircleCheck className="size-3.5" aria-hidden="true" />{t("Done")}
    </span>
  ) : (
    <span data-result="failed" className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400">
      <CircleX className="size-3.5" aria-hidden="true" />{t("Failed")}
    </span>
  );
}

const LIMIT = 8000;
/** A before / after value for the screen: secrets hidden AGAIN here (whatever the row holds), and never longer than LIMIT. */
export function showJson(value: unknown, t: T): string | null {
  if (value === null || value === undefined) return null;
  const s = JSON.stringify(redact(value), null, 2);
  if (s === undefined) return null;
  return s.length > LIMIT ? `${s.slice(0, LIMIT)}\n… ${t("(shortened)")}` : s;
}

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

function Json({ label, value, t }: { label: string; value: unknown; t: T }) {
  const s = showJson(value, t);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 text-xs">{s ?? "—"}</pre>
    </div>
  );
}

function Entry({ row, t, timezone }: { row: AuditRow; t: T; timezone: string }) {
  const dev = row.actorType === "DEVELOPER";
  const name = row.actorName ?? (row.actorType === "WEBSITE" ? t("Website") : row.actorType === "SYSTEM" ? t("System") : t("Unknown"));
  const full = new Intl.DateTimeFormat(t.intl, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: timezone }).format(row.at);
  // A readable id (a page's address, an order number) in full; an opaque one (a long random id) by its last characters.
  const record = row.entityId ? `${row.entityType} · ${/^[\w-]{16,}$/.test(row.entityId) ? `…${row.entityId.slice(-8)}` : row.entityId}` : row.entityType;
  return (
    <li className={cn("border-l-2", dev ? "border-l-fuchsia-600" : "border-l-transparent")} data-entry data-actor-type={row.actorType}>
      <details className="group">
        <summary
          className={cn(
            "grid cursor-pointer list-none gap-x-3 gap-y-1.5 px-3 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 md:items-center md:py-2.5 [&::-webkit-details-marker]:hidden",
            COLUMNS,
          )}
        >
          {/* (spans, not divs: a <summary> holds inline content) */}
          <span className="flex items-center justify-between gap-2 md:contents">
            <span className="whitespace-nowrap text-xs text-muted-foreground md:text-[13px]">{t.dateTime(row.at, timezone)}</span>
            <ActorBadge type={row.actorType} t={t} />
          </span>
          <span className="block min-w-0">
            <span className="block truncate text-sm font-semibold" title={name}>{name}</span>
            {row.roleName && <span className="block truncate text-xs text-muted-foreground">{t(row.roleName)}</span>}
          </span>
          <span className="block min-w-0">
            <span className="block text-sm">{t(auditActionWords(row.action))}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground" title={row.action}>{row.action}</span>
          </span>
          <span className="block min-w-0 truncate text-xs text-muted-foreground" title={record}>{record}</span>
          <span className="flex items-center justify-between gap-2 md:contents">
            <Result ok={row.ok} t={t} />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground md:justify-self-end">
              <span className="md:sr-only">{t("Details")}</span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </span>
          </span>
        </summary>
        <div className="space-y-3 border-t bg-muted/30 px-3 py-3 md:pl-6">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t("Exact time")}>{full}</Fact>
            <Fact label={t("Business day")}>{t.date(row.businessDate)}</Fact>
            <Fact label={t("Account type")}>{t(TYPE_LABEL[row.actorType])}</Fact>
            <Fact label={t("Who")}>{name}{row.roleName ? ` · ${t(row.roleName)}` : ""}</Fact>
            <Fact label={t("Action")}><span className="font-mono text-xs">{row.action}</span></Fact>
            <Fact label={t("Module")}>{row.entityType}</Fact>
            {row.entityId && <Fact label={t("Record")}><span className="font-mono text-xs">{row.entityId}</span></Fact>}
            {row.ipAddress && <Fact label={t("IP address")}><span className="font-mono text-xs">{row.ipAddress}</span></Fact>}
            {row.reason && <Fact wide label={t("Reason given")}>{row.reason}</Fact>}
            {row.problem && <Fact wide label={t("What went wrong")}>{row.problem}</Fact>}
          </dl>
          <div className="grid gap-3 md:grid-cols-2">
            <Json label={t("Before")} value={row.before} t={t} />
            <Json label={t("After")} value={row.after} t={t} />
          </div>
        </div>
      </details>
    </li>
  );
}

export function AuditList({ rows, t, timezone }: { rows: AuditRow[]; t: T; timezone: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div aria-hidden="true" className={cn("hidden gap-x-3 border-b bg-muted/40 px-3 py-2 pl-[calc(0.75rem+2px)] text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground md:grid", COLUMNS)}>
        <span>{t("When")}</span>
        <span>{t("Account type")}</span>
        <span>{t("Who")}</span>
        <span>{t("Action")}</span>
        <span>{t("Record")}</span>
        <span>{t("Result")}</span>
        <span />
      </div>
      <ul className="divide-y">
        {rows.map((r) => <Entry key={r.id} row={r} t={t} timezone={timezone} />)}
      </ul>
    </div>
  );
}
