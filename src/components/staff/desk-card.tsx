import Link from "next/link";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManagerCloseShift } from "./shift-controls";

type Open = { id: string; userId: string; startedAt: Date; user: { fullName: string } };
const initials = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/** Who is at the reception desk now — its places (two), each person since when; a manager can close one, saying why. */
export function DeskCard({ desk, limit, meId, manage = false, timezone, now, className }: { desk: Open[]; limit: number; meId: string; manage?: boolean; timezone: string; /** The page's "now" (for how long each has been on). */ now: Date; className?: string }) {
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(d);
  const dur = (d: Date) => { const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  return (
    <div className={cn("rounded-3xl border border-border/70 bg-card px-4 py-3.5", className)}>
      <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="flex items-center gap-1.5">{desk.length > 0 && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}At the desk</span>
        <span className="tabular-nums">{desk.length} of {limit}</span>
      </p>
      <ul className="mt-2 space-y-1.5">
        {Array.from({ length: limit }, (_, i) => desk[i] ?? null).map((o, i) => o ? (
          <li key={o.id} className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{initials(o.user.fullName)}</span>
            {(() => {
              const body = <><span className="block truncate text-sm font-semibold">{o.userId === meId ? "You" : o.user.fullName}</span><span className="block text-[10.5px] tabular-nums text-muted-foreground">since {clock(o.startedAt)} · {dur(o.startedAt)}</span></>;
              // A colleague's shift opens only for a manager (or their own).
              return manage || o.userId === meId ? <Link href={`/staff/shifts/${o.id}`} className="min-w-0 flex-1 leading-tight">{body}</Link> : <div className="min-w-0 flex-1 leading-tight">{body}</div>;
            })()}
            {manage && <ManagerCloseShift compact shiftId={o.id} name={o.user.fullName} />}
          </li>
        ) : (
          <li key={`free-${i}`} className="flex items-center gap-2 text-muted-foreground">
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-border"><UserRound className="size-3.5" /></span>
            <span className="text-sm">Free place</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
