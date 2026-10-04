"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, CalendarRange, Clock, Hash, Phone, Users, Waypoints, type LucideIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type BarInfo = {
  id: string; reference: string; who: string; guest: string; phone: string | null; company: string | null;
  status: string; dot: string; room: string; type: string; dates: string; nights: string; times: string;
  people: string; source: string; net: number; paid: number; balance: number; billTo: string | null;
  actions: { label: string; href: string; primary?: boolean }[];
};

const n = (v: number) => v.toLocaleString("en-US");

/** A booking on the room chart: tap it for its card — who, when, the bill — without leaving the chart. */
export function BookingBar({ className, style, title, info, children }: { className: string; style: React.CSSProperties; title: string; info: BarInfo; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={cn(className, "text-left")} style={style} title={title} onClick={() => setOpen(true)}>{children}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-md">
          {/* The shared dark band (content is p-0, so no pull-out). The room number takes the icon's place;
              the tile sits at the top so the figures below can run the band's full width. */}
          <DialogHeader icon={<span className="text-base font-bold tabular-nums sm:text-lg">{info.room}</span>} eyebrow="Booking" tone="violet" className="mx-0 mt-0 [&>div:last-child]:items-start">
            <DialogTitle className="truncate">{info.who}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2">
              <span className="inline-flex items-center gap-1"><span className={cn("size-1.5 rounded-full", info.dot)} />{info.status}</span><span>·</span><span>{info.type}</span>
            </DialogDescription>
            {/* Pulled back under the tile (size-11 / sm:size-12 + gap-3.5) and over the close button's room (pr-8). */}
            <div className="relative mt-3 -mr-8 -ml-[3.625rem] grid grid-cols-3 gap-2 sm:-ml-[3.875rem]">
              <Mini label="Stay" value={info.nights} />
              <Mini label="Bill" value={n(info.net)} />
              <Mini label={info.billTo ? "Paid by" : info.balance > 0 ? "Owes" : "Owes"} value={info.billTo ?? (info.balance > 0 ? n(info.balance) : "Paid")} tone={info.billTo ? "text-violet-300" : info.balance > 0 ? "text-rose-300" : "text-emerald-300"} />
            </div>
          </DialogHeader>
          <DialogClose render={<button type="button" aria-label="Close" className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" />}>
            <span aria-hidden className="text-lg leading-none">×</span>
          </DialogClose>
          <div className="space-y-4 p-5">
            <div className="space-y-2 text-sm">
              <Row icon={CalendarRange} label="Dates" value={info.dates} />
              <Row icon={Clock} label="Times" value={info.times} />
              <Row icon={Users} label="People" value={info.people} />
              {info.company && <Row icon={Building2} label="Company" value={info.company} />}
              {info.company && <Row icon={Users} label="Guest" value={info.guest} />}
              {info.phone && <Row icon={Phone} label="Phone" value={<a href={`tel:${info.phone}`} className="underline-offset-2 hover:underline">{info.phone}</a>} />}
              <Row icon={Waypoints} label="Booked through" value={info.source} />
              <Row icon={Hash} label="Reference" value={<span className="font-mono">{info.reference}</span>} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {([["Bill", info.net, ""], ["Paid", info.paid, "text-emerald-600 dark:text-emerald-400"], ["To pay", Math.max(0, info.balance), info.balance > 0 ? "text-rose-600 dark:text-rose-400" : ""]] as const).map(([k, v, c]) => (
                <div key={k} className="rounded-xl bg-muted/50 px-2 py-2"><p className="text-[10px] text-muted-foreground">{k}</p><p className={cn("text-sm font-semibold tabular-nums", c)}>{n(v)}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
              {info.actions.map((a) => (
                <Link key={a.label} href={a.href} className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors",
                  a.primary ? "bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] hover:brightness-105" : "border border-border hover:bg-muted")}>
                  {a.label}{!a.primary && <ArrowUpRight className="size-3.5" />}
                </Link>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
      <p className="truncate text-[10px] uppercase tracking-wider text-white/50">{label}</p>
      <p className={cn("truncate text-base font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="size-3.5 shrink-0" />{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </p>
  );
}
