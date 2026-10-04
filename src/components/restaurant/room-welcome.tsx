import Link from "next/link";
import { BedDouble, CalendarCheck, Check, CircleSlash, MessageCircle, Phone, Presentation, Ruler, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** How a room looks to someone scanning its card when nobody is checked in. */
const ROOM_STATE: Record<string, { label: string; dot: string }> = {
  AVAILABLE: { label: "Ready for guests", dot: "bg-emerald-400" },
  READY: { label: "Clean & ready", dot: "bg-emerald-400" },
  RESERVED: { label: "Reserved", dot: "bg-amber-400" },
  OCCUPIED: { label: "Occupied", dot: "bg-sky-400" },
  DIRTY: { label: "Being cleaned", dot: "bg-violet-400" },
  CLEANING: { label: "Being cleaned", dot: "bg-violet-400" },
  MAINTENANCE: { label: "Under maintenance", dot: "bg-rose-400" },
  OUT_OF_SERVICE: { label: "Not in use", dot: "bg-white/50" },
};

export type RoomWelcomeInfo = {
  type: string; slug: string; price: number; adults: number; children: number; bed: string | null; size: number | null;
  blurb: string | null; photo: string | null; amenities: string[];
};

/**
 * The top of the room QR page when nobody is checked in — the same look as a guest's stay page (the restaurant app):
 * the room, what it has, its price and "Book", and how to reach reception. The menu follows (order at the restaurant
 * or take out — nothing goes on a room bill without a stay).
 */
export function RoomWelcome({ room, info, hotel, callHref, waHref }: {
  room: { number: string; meeting: boolean; status: string; active: boolean } | null;
  info: RoomWelcomeInfo | null; hotel: string; callHref: string | null; waHref: string | null;
}) {
  const toMenu = <a href="#order" className="inline-flex h-10 items-center rounded-full bg-(--vr-gold) px-4 text-[13px] font-semibold text-(--vr-ink)">See the menu</a>;
  if (!room || !room.active) {
    return (
      <section className="relative mt-3 overflow-hidden rounded-3xl bg-(--vr-dark) p-5 text-white sm:mt-4 sm:p-6">
        <div aria-hidden className="absolute -left-10 -top-16 size-52 rounded-full bg-(--vr-gold)/10 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10"><CircleSlash className="size-5 text-white/70" /></span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-(--vr-gold)">Welcome to {hotel}</p>
            <h1 className="mt-1 font-display text-[26px] font-semibold leading-tight">This room card is not in use</h1>
            <p className="mt-1 text-[13px] text-white/65">Please call reception — or order from our menu below.</p>
            <div className="mt-3 flex flex-wrap gap-2">{toMenu}<Contact callHref={callHref} waHref={waHref} /></div>
          </div>
        </div>
      </section>
    );
  }
  const st = ROOM_STATE[room.status] ?? ROOM_STATE.AVAILABLE;
  const title = room.meeting ? `Meeting Room ${room.number}` : `Room ${room.number}`;
  const capacity = info ? (room.meeting ? `Up to ${info.adults} people` : `${info.adults} adult${info.adults === 1 ? "" : "s"}${info.children ? ` · ${info.children} child${info.children === 1 ? "" : "ren"}` : ""}`) : null;
  return (
    <section className="relative mt-3 overflow-hidden rounded-3xl bg-(--vr-dark) text-white sm:mt-4 lg:flex lg:items-stretch">
      <div aria-hidden className="absolute -left-10 -top-16 size-52 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <div className="relative min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90"><span className={cn("size-1.5 rounded-full", st.dot)} />{st.label}</span>
          <span className="text-[12.5px] font-medium text-(--vr-gold)">{room.meeting ? "Meeting room" : `Welcome to ${hotel}`}</span>
        </div>
        <h1 className="mt-2 font-display text-[30px] font-semibold leading-[1.05] sm:text-[36px] lg:text-[40px]">
          {title}{info?.type && !room.meeting && <span className="ml-2.5 align-middle font-display text-[17px] font-normal italic text-(--vr-gold) sm:text-[20px]">{info.type}</span>}
        </h1>
        {info?.blurb && <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/65">{info.blurb}</p>}
        {info && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
            {capacity && <Chip icon={Users}>{capacity}</Chip>}
            {info.bed && !room.meeting && <Chip icon={BedDouble}>{info.bed}</Chip>}
            {info.size && <Chip icon={Ruler}>{info.size} m²</Chip>}
          </div>
        )}
        {info && info.amenities.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-[12px] text-white/55">
            <Check className="mt-0.5 size-3.5 shrink-0 text-(--vr-gold)" strokeWidth={3} />{info.amenities.slice(0, 6).join(" · ")}{info.amenities.length > 6 ? ` · +${info.amenities.length - 6} more` : ""}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {info && (
            <Link href={room.meeting ? "/meeting-room" : `/rooms/${info.slug}`} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-(--vr-gold) px-4 text-[13px] font-semibold text-(--vr-ink)">
              {room.meeting ? <Presentation className="size-4" /> : <CalendarCheck className="size-4" />}
              {room.meeting ? "Book it" : "Book this room"} · {room.meeting ? "" : "from "}TZS {info.price.toLocaleString("en-US")}{room.meeting ? "" : " / night"}
            </Link>
          )}
          <Contact callHref={callHref} waHref={waHref} />
        </div>
        <p className="mt-3 text-[11.5px] text-white/45">Staying here? Your stay page opens on this card once reception checks you in. Meanwhile, order from our menu below — to eat at the restaurant or take out.</p>
      </div>
      {info?.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.photo} alt={title} className="relative hidden w-[38%] max-w-md object-cover lg:block" />
      )}
    </section>
  );
}

function Contact({ callHref, waHref }: { callHref: string | null; waHref: string | null }) {
  return (
    <>
      {callHref && <a href={callHref} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[13px] font-medium text-white hover:bg-white/15"><Phone className="size-4" />Call reception</a>}
      {waHref && <a href={waHref} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#25D366] px-4 text-[13px] font-semibold text-[#073b1f]"><MessageCircle className="size-4" />WhatsApp</a>}
    </>
  );
}

function Chip({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-white/85"><Icon className="size-3.5 text-(--vr-gold)" />{children}</span>;
}
