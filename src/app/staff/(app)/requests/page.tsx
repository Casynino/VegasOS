import type { Metadata } from "next";
import { ConciergeBell } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { isDeskUser } from "@/server/desk";
import { businessDayConfig, getSettings } from "@/server/settings";
import { requestHandlers } from "@/server/services/requests";
import { businessDateOf, businessDayBounds } from "@/lib/time/business-date";
import { LiveRefresh } from "@/components/live-refresh";
import { cn } from "@/lib/utils";
import { NewRequestDialog, RequestCard, type RequestView } from "./request-forms";

export const metadata: Metadata = { title: "Guest requests" };
export const dynamic = "force-dynamic";

const RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * GUEST REQUESTS — they work like orders: one comes in (the guest asks from their phone, or reception logs it), someone
 * accepts it ("I'm on it"), then marks it done. Reception handles most of them; a manager can give one to a person.
 */
export default async function RequestsPage() {
  const user = await requirePagePermission("requests.view");
  const s = await getSettings();
  const at = new Date();
  const { start } = businessDayBounds(businessDateOf(at, businessDayConfig(s)), businessDayConfig(s));
  const [rows, inHouse, handlers] = await Promise.all([
    db.serviceRequest.findMany({
      where: { OR: [{ status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } }, { status: "COMPLETED", completedAt: { gte: start } }] },
      orderBy: [{ createdAt: "asc" }],
      include: { room: { select: { number: true } }, guest: { select: { fullName: true } }, assignedTo: { select: { id: true, fullName: true } }, createdBy: { select: { fullName: true } } },
    }),
    db.reservation.findMany({ where: { status: "CHECKED_IN" }, include: { guest: true, rooms: { where: { status: "CHECKED_IN" }, include: { room: true } } }, orderBy: { guest: { fullName: "asc" } } }),
    requestHandlers(),
  ]);
  const manage = can(user, "requests.manage");
  // Managers, the MD and the owner give requests to people (and close complaints); reception accepts and does them.
  const boss = !isDeskUser(user) && (["dashboard.manager", "dashboard.owner", "dashboard.admin"] as const).some((p) => can(user, p));
  const guests = inHouse.map((r) => ({ reservationId: r.id, label: `${r.rooms.map((x) => x.room.number).join(", ")} — ${r.guest.fullName}` }));
  const now = at.getTime();

  const view = (r: (typeof rows)[number]): RequestView => ({
    id: r.id, type: r.type, priority: r.priority, status: r.status, description: r.description, source: r.source, resolution: r.resolution,
    room: r.room?.number ?? null, guest: r.guest?.fullName ?? null, reservationId: r.reservationId,
    createdBy: r.createdBy?.fullName ?? null, assignedTo: r.assignedTo,
    createdAt: r.createdAt.toISOString(), acceptedAt: r.acceptedAt?.toISOString() ?? null, completedAt: r.completedAt?.toISOString() ?? null,
  });
  const mine = (r: (typeof rows)[number]) => r.assignedToId === user.id;
  // Waiting: yours first, then the most pressing, then the oldest.
  const waiting = rows.filter((r) => r.status === "NEW" || r.status === "ASSIGNED")
    .sort((a, b) => Number(mine(b)) - Number(mine(a)) || RANK[a.priority] - RANK[b.priority] || a.createdAt.getTime() - b.createdAt.getTime());
  const onIt = rows.filter((r) => r.status === "IN_PROGRESS").sort((a, b) => Number(mine(b)) - Number(mine(a)) || RANK[a.priority] - RANK[b.priority]);
  const done = rows.filter((r) => r.status === "COMPLETED").sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const yours = rows.filter((r) => mine(r) && r.status !== "COMPLETED").length;
  const fromGuests = waiting.filter((r) => r.source !== "STAFF").length;

  const columns = [
    { key: "new", title: "New", sub: "Waiting for someone to accept", list: waiting, dot: "bg-sky-400", empty: "Nothing waiting. New requests ring the bell." },
    { key: "on", title: "On it", sub: "Accepted — being handled", list: onIt, dot: "bg-amber-400", empty: "Nobody is working on a request right now." },
    { key: "done", title: "Done today", sub: "Finished since the day began", list: done, dot: "bg-emerald-400", empty: "Nothing finished yet today." },
  ];

  return (
    <div className="w-full space-y-5">
      <LiveRefresh every={10} active />
      <header className="relative overflow-hidden rounded-3xl bg-[#15110c] text-white ring-1 ring-white/10">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-sky-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-[oklch(0.75_0.13_80)]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4 px-5 pb-4 pt-5 sm:px-6">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sky-500/20 text-sky-100 ring-1 ring-sky-300/30"><ConciergeBell className="size-6" /></span>
          <div className="min-w-[12rem] flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#f0cf86]">Guest care</p>
            <h1 className="font-display text-[28px] font-semibold leading-tight">Guest requests</h1>
            <p className="mt-0.5 text-xs text-white/60">Towels, cleaning, repairs, help — accept it, handle it, mark it done.{boss ? " Give one to a person when it needs someone." : ""}</p>
          </div>
          {manage && <NewRequestDialog guests={guests} staff={handlers} hero />}
        </div>
        <dl className="relative grid grid-cols-2 gap-px border-t border-white/10 bg-white/5 sm:grid-cols-4">
          {[
            { label: "New", value: waiting.length, sub: fromGuests ? `${fromGuests} from guests' phones` : "waiting to be accepted", tone: waiting.length ? "text-sky-200" : "text-white/50" },
            { label: "Yours", value: yours, sub: "given to you or accepted", tone: yours ? "text-violet-200" : "text-white/50" },
            { label: "On it", value: onIt.length, sub: "being handled now", tone: onIt.length ? "text-amber-200" : "text-white/50" },
            { label: "Done today", value: done.length, sub: "finished", tone: "text-emerald-300" },
          ].map((x) => (
            <div key={x.label} className="bg-[#15110c] px-5 py-3">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">{x.label}</dt>
              <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", x.tone)}>{x.value}</dd>
              <p className="text-[11px] text-white/40">{x.sub}</p>
            </div>
          ))}
        </dl>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {columns.map((c) => (
          <section key={c.key} className="rounded-3xl border border-border/70 bg-card/60 p-2.5">
            <h2 className="flex items-center gap-2 px-2 pb-2.5 pt-1.5">
              <span className={cn("size-2 rounded-full", c.dot)} />
              <span className="text-[15px] font-semibold">{c.title}</span>
              <span className="rounded-full bg-muted px-2 text-xs font-semibold tabular-nums">{c.list.length}</span>
              <span className="ml-auto truncate text-[11px] text-muted-foreground">{c.sub}</span>
            </h2>
            <ul className="space-y-2">
              {c.list.length === 0 && <li className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">{c.empty}</li>}
              {c.list.map((r) => (
                <RequestCard key={r.id} r={view(r)} meId={user.id} now={now} staff={handlers} manage={manage} boss={boss} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
