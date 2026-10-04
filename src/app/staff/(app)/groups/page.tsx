import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { listGroups } from "@/server/services/groups";
import { businessToday } from "@/server/settings";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { GROUP_STATUS, GROUP_TYPE } from "@/lib/group-types";
import { cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Group bookings" };

const VIEWS = [
  { key: "today", label: "Arriving today" }, { key: "inhouse", label: "In the hotel" }, { key: "upcoming", label: "Coming" }, { key: "all", label: "All" },
] as const;

/** Every group: a company's staff, a family, an event — rooms, who is in, who pays, what is owed. */
export default async function GroupsPage({ searchParams }: PageProps<"/staff/groups">) {
  const user = await requirePagePermission("reservations.view");
  const sp = await searchParams;
  const today = await businessToday();
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? "today";
  const groups = await listGroups({ q, view, today });
  return (
    <div className="w-full space-y-5">
      <PageHeader title="Group bookings" description="Several rooms that belong together — each room its own booking, the group pays one bill (or one per room)."
        actions={can(user, "reservations.create") && <Link href="/staff/groups/new" className={buttonVariants()}><Plus />New group booking</Link>} />
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`?view=${v.key}`} aria-current={!q && view === v.key ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", !q && view === v.key ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>{v.label}</Link>
        ))}
        <form className="relative ml-auto w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Group, company, family, guest, room, phone, invoice…" className="h-10 rounded-2xl bg-card pl-9" aria-label="Search groups" />
        </form>
      </div>
      {groups.length === 0 ? (
        <EmptyState icon={<Users />} title={q ? `No group matches "${q}"` : view === "today" ? "No group arrives today" : "No groups here"}
          description="A company, family or event booking several rooms goes here." action={can(user, "reservations.create") ? <Link href="/staff/groups/new" className={buttonVariants()}>New group booking</Link> : undefined} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => {
            const I = GROUP_TYPE[g.type].icon;
            const done = g.checkedIn + g.checkedOut;
            return (
              <li key={g.id}>
                <Link href={`/staff/groups/${g.id}`} className="flex h-full flex-col gap-3 rounded-3xl border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-18px_rgba(15,23,42,0.4)]">
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-500/12 text-violet-700 dark:text-violet-300"><I className="size-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{g.name}</p>
                      <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{g.reference}</span> · {g.contact}{g.phone ? ` · ${g.phone}` : ""}</p>
                    </div>
                    {(() => {
                      const st = GROUP_STATUS[g.status === "CANCELLED" ? "CANCELLED" : g.finalized ? (g.outstanding > 0 ? "FINAL_INVOICE_GENERATED" : "CLOSED")
                        : g.status === "COMPLETED" ? "READY_FOR_FINAL_INVOICE" : g.checkedOut > 0 ? "PARTIALLY_CHECKED_OUT" : g.checkedIn > 0 ? "ACTIVE" : "UPCOMING"];
                      return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", st.cls)}>{st.label}</span>;
                    })()}
                  </div>
                  <p className="text-sm">{formatBusinessDate(g.arrival)} → {formatBusinessDate(g.departure)} · <strong>{g.rooms}</strong> room{g.rooms === 1 ? "" : "s"} · {g.guests} guest{g.guests === 1 ? "" : "s"}</p>
                  <div>
                    <div className="flex justify-between text-[11px] text-muted-foreground"><span>{g.checkedIn} in · {g.checkedOut} left · {g.pending} to come</span><span>{done}/{g.rooms}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${g.rooms ? Math.round((done / g.rooms) * 100) : 0}%` }} /></div>
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-2 border-t border-dashed border-border pt-2.5 text-xs">
                    <span className="text-muted-foreground">Pays: <strong className="text-foreground">{g.payer}</strong></span>
                    <span className="text-right tabular-nums">{formatTZS(g.total)}{g.outstanding > 0 && <span className="block font-semibold text-rose-600 dark:text-rose-400">owes {formatTZS(g.outstanding)}</span>}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
