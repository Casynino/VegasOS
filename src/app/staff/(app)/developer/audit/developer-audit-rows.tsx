import { ChevronDown, CircleCheck, CircleX } from "lucide-react";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { auditActionWords, type AuditRow } from "@/server/services/audit-trail";
import { showJson } from "@/app/staff/(app)/audit/audit-rows";

/**
 * The Developer's Audit page: one entry = one line — a coloured dot, the plain sentence, "who · date · code", and badges on the right
 * (Developer / Succeeded or Failed / module). Read-only on purpose: no button, no form, no input and no link; an entry opens with the
 * browser's own <details> to show its facts and the before / after values (secrets hidden again here, whatever the row holds).
 *
 * Dot: red = it failed, gold = done by the Developer (also while working as someone), blue = staff work, grey = the system or the website.
 */

/** The Developer's own name out of a label like "Nino (Developer) as Neema (Reception)" (or the label itself). */
function developerNameOf(label: string): string {
  const i = label.indexOf(" (Developer)");
  return i > 0 ? label.slice(0, i) : label;
}

/** Who did it, as a person reads it: "Nino (Developer)", "Nino (Developer) as Neema (Reception)", "Neema (Reception)", "System". */
export function auditWho(row: AuditRow, t: T): string {
  // A failed sign-in is nobody's action: it is the system's entry about an account that someone tried.
  if (row.action === "auth.login_failed") return t("System");
  if (row.actorType === "DEVELOPER") {
    const label = row.actorName ?? t("Developer");
    if (row.actingAs) {
      const developer = developerNameOf(label);
      const person = row.actingAs.name;
      return row.actingAs.role
        ? t("{developer} (Developer) as {person} ({role})", { developer, person, role: t(row.actingAs.role) })
        : t("{developer} (Developer) as {person}", { developer, person });
    }
    return label.includes("(Developer)") ? label : t("{name} (Developer)", { name: label });
  }
  if (row.actorType === "STAFF") {
    const name = row.actorName ?? t("Unknown");
    return row.roleName ? t("{name} ({role})", { name, role: t(row.roleName) }) : name;
  }
  if (row.actorType === "WEBSITE") return t("Website");
  return !row.actorName || row.actorName.toLowerCase() === "system" ? t("System") : row.actorName;
}

/** The plain sentence of one entry: "Neema checked a guest in." — a failed sign-in has no subject. */
export function auditSentence(row: AuditRow, t: T): string {
  const words = t(auditActionWords(row.action));
  if (row.action === "auth.login_failed") return `${words}.`;
  const subject =
    row.actorType === "DEVELOPER" ? (row.actingAs ? t("Developer (as {person})", { person: row.actingAs.name }) : t("Developer"))
    : row.actorType === "STAFF" ? (row.actorName ?? t("Unknown"))
    : row.actorType === "WEBSITE" ? t("Website")
    : t("System");
  // A page the Developer looked at, or the part of Business, is named — it is what the entry is about.
  const about = (row.action === "developer.viewed" || row.action === "developer.business_viewed") && row.entityId ? ` (${row.entityId})` : "";
  return t("{who} {did}.", { who: subject, did: `${words}${about}` });
}

function Dot({ row }: { row: AuditRow }) {
  const colour = !row.ok ? "bg-red-500" : row.actorType === "DEVELOPER" ? "bg-amber-400" : row.actorType === "STAFF" ? "bg-sky-500" : "bg-slate-400";
  return <span aria-hidden="true" data-dot={!row.ok ? "failed" : row.actorType} className={cn("col-start-1 row-start-1 mt-1.5 size-2.5 rounded-full", colour)} />;
}

function Badges({ row, t }: { row: AuditRow; t: T }) {
  return (
    <span className="col-start-2 row-start-2 flex flex-wrap items-center gap-1.5 md:col-start-3 md:row-start-1 md:flex-col md:items-end">
      {row.actorType === "DEVELOPER" && (
        <span data-badge="developer" className="inline-flex h-5 items-center rounded-full bg-amber-500/15 px-2 text-xs font-semibold text-amber-800 dark:text-amber-300">{t("Developer")}</span>
      )}
      {row.ok ? (
        <span data-result="ok" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CircleCheck className="size-3.5" aria-hidden="true" />{t("Succeeded")}
        </span>
      ) : (
        <span data-result="failed" className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400">
          <CircleX className="size-3.5" aria-hidden="true" />{t("Failed")}
        </span>
      )}
      <span data-badge="module" className="inline-flex h-5 max-w-[12rem] items-center truncate rounded-full border border-border px-2 text-xs text-muted-foreground" title={row.entityType}>{row.entityType}</span>
    </span>
  );
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
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background p-2.5 text-xs">{showJson(value, t) ?? "—"}</pre>
    </div>
  );
}

function Entry({ row, t, timezone }: { row: AuditRow; t: T; timezone: string }) {
  const who = auditWho(row, t);
  const date = new Intl.DateTimeFormat(t.intl, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(row.at);
  const exact = new Intl.DateTimeFormat(t.intl, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: timezone }).format(row.at);
  return (
    <li data-entry data-actor-type={row.actorType} data-state={row.ok ? "ok" : "failed"} data-acting-as={row.actingAs ? row.actingAs.id : undefined}>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[0.625rem_minmax(0,1fr)_1rem] items-start gap-x-3 gap-y-2 px-4 py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 md:grid-cols-[0.625rem_minmax(0,1fr)_auto_1rem] [&::-webkit-details-marker]:hidden">
          <Dot row={row} />
          <span className="col-start-2 row-start-1 block min-w-0">
            <span className="block text-sm font-medium leading-snug">{auditSentence(row, t)}</span>
            <span className="mt-0.5 block break-words text-xs text-muted-foreground">
              {who} · {date} · <span className="font-mono" title={row.action}>{row.action}</span>
            </span>
          </span>
          <Badges row={row} t={t} />
          <ChevronDown className="col-start-3 row-start-1 mt-1 size-4 text-muted-foreground transition-transform group-open:rotate-180 md:col-start-4" aria-hidden="true" />
        </summary>
        <div className="space-y-3 border-t bg-muted/30 px-4 py-3 md:pl-9">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t("Exact time")}>{exact}</Fact>
            <Fact label={t("Business day")}>{t.date(row.businessDate)}</Fact>
            <Fact label={t("Who")}>{who}</Fact>
            {row.actingAs && <Fact label={t("Working as")}>{row.actingAs.name}{row.actingAs.role ? ` · ${t(row.actingAs.role)}` : ""}</Fact>}
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

export function DeveloperAuditList({ rows, t, timezone }: { rows: AuditRow[]; t: T; timezone: string }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_2px_4px_rgba(15,23,42,0.03)]">
      <ul className="divide-y">
        {rows.map((r) => <Entry key={r.id} row={r} t={t} timezone={timezone} />)}
      </ul>
    </div>
  );
}
