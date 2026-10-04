"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Clock3, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { StaffDetail, StaffPerson } from "@/server/services/staff-performance";
import { staffDetailAction } from "./actions";

const n = (v: number) => v.toLocaleString("en-US");
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const AREA_TONE: Record<string, string> = {
  "Front desk": "bg-sky-500", Bookings: "bg-violet-500", Money: "bg-emerald-500", Restaurant: "bg-amber-500",
  Rooms: "bg-teal-500", Customers: "bg-pink-500", Shifts: "bg-slate-400", Other: "bg-slate-500", "Sign-in": "bg-slate-400",
};
const initials = (name: string) => name.replace(/\(.*\)/, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** The team: one row each (so it stays neat with many people) — filter, sort, find; tap a person for their period in detail. */
export function StaffBoard({ people, days, from, to }: { people: StaffPerson[]; days: string[]; from: string; to: string }) {
  const [dept, setDept] = useState("All");
  const [sort, setSort] = useState<"active" | "money" | "name">("active");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<StaffPerson | null>(null);
  const departments = ["All", ...new Set(people.map((p) => p.department))];
  const shown = useMemo(() => people
    .filter((p) => (dept === "All" || p.department === dept) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => sort === "money" ? b.money - a.money : sort === "name" ? a.name.localeCompare(b.name) : b.actions - a.actions || a.name.localeCompare(b.name)),
  [people, dept, q, sort]);
  // Long periods: the little chart shows weeks instead of days.
  const weekly = days.length > 31;
  const bucket = (s: number[]) => weekly ? Array.from({ length: Math.ceil(s.length / 7) }, (_, i) => s.slice(i * 7, i * 7 + 7).reduce((t, v) => t + v, 0)) : s;
  const peak = Math.max(1, ...people.map((p) => Math.max(...bucket(p.series))));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {departments.map((d) => (
            <button key={d} type="button" onClick={() => setDept(d)} aria-pressed={dept === d}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                dept === d ? "border-transparent bg-foreground text-background" : "border-border/70 bg-card text-muted-foreground hover:text-foreground")}>
              {d}<span className="tabular-nums opacity-70">{d === "All" ? people.length : people.filter((p) => p.department === d).length}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Find a staff member</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone" className="h-8 w-40 rounded-full border border-border/70 bg-card pl-8 pr-3 text-xs outline-none focus:border-ring" />
          </label>
          <div className="inline-flex rounded-full border border-border/70 bg-card p-0.5 text-xs font-medium">
            {([["active", "Most active"], ["money", "Most money"], ["name", "A–Z"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}
                className={cn("rounded-full px-2.5 py-1 transition-colors", sort === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_1.25rem] gap-4 border-b border-border/70 bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <span>Person</span><span>{weekly ? "Week by week" : "Day by day"}</span><span>Usually starts</span><span className="text-right">Actions</span><span className="text-right">Money handled</span><span />
        </div>
        {shown.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nobody matches.</p> : (
          <ul className="divide-y divide-border/60">
            {shown.map((p) => {
              const bars = bucket(p.series);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpen(p)}
                    className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_1.25rem]",
                      !p.actions && "opacity-60")}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_80)]/15 text-xs font-bold text-[oklch(0.55_0.12_78)] dark:text-[#f0cf86]">{initials(p.name)}</span>
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.role} · {p.department}</span>
                      </span>
                    </span>
                    <span className="flex h-8 items-end gap-[3px] max-md:col-span-2 max-md:row-start-2" aria-label={`${p.actions} actions over ${p.daysActive} day${p.daysActive === 1 ? "" : "s"}`}>
                      {bars.map((v, i) => (
                        <span key={i} className={cn("min-w-[3px] flex-1 rounded-sm", v ? "bg-[oklch(0.72_0.12_80)]" : "bg-muted")} style={{ height: `${v ? Math.max(18, (v / peak) * 100) : 12}%` }} title={`${v} action${v === 1 ? "" : "s"}`} />
                      ))}
                    </span>
                    <span className="hidden text-sm md:block">{p.usualStart ? <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 text-muted-foreground" />{p.usualStart}<span className="text-xs text-muted-foreground">· {p.daysActive}d</span></span> : <span className="text-muted-foreground">—</span>}</span>
                    <span className="hidden text-right text-sm font-semibold tabular-nums md:block">{p.actions || "—"}</span>
                    <span className="text-right text-sm font-semibold tabular-nums max-md:row-start-1 max-md:col-start-2">{p.money ? n(p.money) : <span className="font-normal text-muted-foreground">{p.actions ? "—" : "No activity"}</span>}</span>
                    <ChevronRight className="hidden size-4 text-muted-foreground md:block" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          {open && <PersonCard key={open.id} p={open} from={from} to={to} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PersonCard({ p, from, to }: { p: StaffPerson; from: string; to: string }) {
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Their days are loaded when the card opens.
  useEffect(() => {
    let stop = false;
    staffDetailAction({ userId: p.id, from, to }).then((res) => {
      if (stop) return;
      if (res.ok) setDetail(res.data); else setError(res.error);
    }).catch(() => { if (!stop) setError("Could not load their days — try again."); });
    return () => { stop = true; };
  }, [p.id, from, to]);
  const counts = [["Check-ins", p.checkIns], ["Check-outs", p.checkOuts], ["Bookings", p.bookings], ["Orders", p.orders], ["Expenses", p.expenses ? n(p.expenses) : 0]] as const;
  return (
    <>
      {/* The content has no padding (p-0): the band starts at the edge. Their initials take the icon's place;
          the tile sits at the top so the figures below can run the band's full width. */}
      <DialogHeader icon={<span className="text-base font-bold">{initials(p.name)}</span>} eyebrow="Staff" tone="gold" className="mx-0 mt-0 [&>div:last-child]:items-start">
        <DialogTitle>{p.name}</DialogTitle>
        <DialogDescription>{p.role} · {p.department}</DialogDescription>
        {/* Pulled back under the tile (size-11 / sm:size-12 + gap-3.5) and over the close button's room (pr-8). */}
        <div className="relative mt-3 -mr-8 -ml-[3.625rem] grid grid-cols-2 gap-2 sm:-ml-[3.875rem] sm:grid-cols-4">
          <Mini label="Actions" value={n(p.actions)} />
          <Mini label="Days at work" value={String(p.daysActive)} />
          <Mini label="Usually starts" value={p.usualStart ?? "—"} />
          <Mini label="Money handled" value={p.money ? n(p.money) : "—"} strong />
        </div>
      </DialogHeader>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-1.5">
          {counts.map(([label, v]) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs"><strong className="tabular-nums">{v}</strong><span className="text-muted-foreground">{label.toLowerCase()}</span></span>
          ))}
        </div>

        {error ? <p className="rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">{error}</p> : !detail ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading their days…</p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Day by day</p>
              {detail.perDay.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">No activity in this period.</p> : (
                <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
                  {detail.perDay.map((d) => (
                    <li key={d.date} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)_auto]">
                      <span className="font-medium">{day(d.date)}</span>
                      <span className="text-right font-semibold tabular-nums sm:order-last">{d.money ? n(d.money) : <span className="font-normal text-muted-foreground">—</span>}</span>
                      <span className="col-span-2 min-w-0 text-xs text-muted-foreground sm:col-span-1 sm:row-start-1 sm:col-start-2">
                        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {d.signedIn && <span>signed in <strong className="font-semibold text-foreground">{d.signedIn}</strong></span>}
                          {d.shiftStart && <span>shift <strong className="font-semibold text-foreground">{d.shiftStart}–{d.shiftEnd}</strong></span>}
                          {d.first && <span>worked <strong className="font-semibold text-foreground">{d.first}–{d.last}</strong></span>}
                          <span>{d.actions} action{d.actions === 1 ? "" : "s"}</span>
                        </span>
                        {d.areas.length > 0 && (
                          <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted" title={d.areas.map((a) => `${a.name} ${a.count}`).join(" · ")}>
                            {d.areas.map((a) => <span key={a.name} className={AREA_TONE[a.name] ?? "bg-slate-500"} style={{ width: `${(a.count / Math.max(1, d.actions)) * 100}%` }} />)}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">What they did{detail.total > detail.timeline.length ? ` · latest ${detail.timeline.length} of ${n(detail.total)}` : ""}</p>
              {detail.timeline.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded.</p> : (
                <ol className="relative ml-2 space-y-2.5 border-l border-border/70 pl-4">
                  {detail.timeline.map((t, i) => {
                    const newDay = i === 0 || detail.timeline[i - 1].date !== t.date;
                    const body = (
                      <span className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0"><span className="text-muted-foreground tabular-nums">{t.when}</span> · {t.what}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{t.area}</span>
                      </span>
                    );
                    return (
                      <li key={t.id} className="relative">
                        {newDay && <p className="-ml-4 mb-1.5 pl-4 text-[11px] font-semibold text-muted-foreground">{day(t.date)}</p>}
                        <span className={cn("absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-background", AREA_TONE[t.area] ?? "bg-slate-500", newDay && "top-7")} />
                        {t.href ? <Link href={t.href} className="block rounded-lg hover:bg-muted/40">{body}</Link> : body}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
          <Link href={`/staff/finance/ledger?user=${p.id}&from=${from}&to=${to}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted">Their money in the ledger<ArrowUpRight className="size-3.5" /></Link>
          <Link href={`/staff/activity?user=${p.id}&from=${from}&to=${to}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted">Full history log<ArrowUpRight className="size-3.5" /></Link>
        </div>
      </div>
    </>
  );
}

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
      <p className="text-[10px] uppercase tracking-wider text-white/50">{label}</p>
      <p className={cn("font-semibold tabular-nums", strong ? "text-lg text-emerald-300" : "text-base")}>{value}</p>
    </div>
  );
}
