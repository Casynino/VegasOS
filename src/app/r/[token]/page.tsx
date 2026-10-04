import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, CalendarCheck, Check, CircleSlash, MessageCircle, Phone, Presentation, Ruler, Users } from "lucide-react";
import { getSettings } from "@/server/settings";
import { redirect } from "next/navigation";
import { can, getCurrentUser } from "@/server/auth";
import { roomForQr, scanRoomQr } from "@/server/services/room-qr";
import { orderMenuSections } from "@/server/services/online-orders";
import { formatNumber } from "@/lib/format";
import { prettyPhone } from "@/lib/guest-messages";
import { telHref, whatsappHref } from "@/components/public/contact";
import { StayPage } from "@/components/restaurant/stay-page";
import { ExploreHotel, NightSky } from "@/components/ordering/explore-hotel";
import { heroPhotos, PlaceHero, stripPicks } from "@/components/ordering/place-hero";
import { DishMarquee, DishShowcase } from "@/components/ordering/dish-showcase";
import { MenuBrowse } from "@/components/ordering/menu-browse";
import { GOLD, GOLD_GRADIENT } from "@/components/ordering/menu-picker";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** How a room looks to someone scanning its card when nobody is checked in. */
const ROOM_STATE: Record<string, { label: string; tone: string }> = {
  AVAILABLE: { label: "Ready for guests", tone: "bg-emerald-400/20 text-emerald-200" },
  READY: { label: "Clean & ready", tone: "bg-emerald-400/20 text-emerald-200" },
  RESERVED: { label: "Reserved", tone: "bg-amber-400/20 text-amber-200" },
  OCCUPIED: { label: "Occupied", tone: "bg-sky-400/20 text-sky-200" },
  DIRTY: { label: "Being cleaned", tone: "bg-violet-400/20 text-violet-200" },
  CLEANING: { label: "Being cleaned", tone: "bg-violet-400/20 text-violet-200" },
  MAINTENANCE: { label: "Under maintenance", tone: "bg-rose-400/20 text-rose-200" },
  OUT_OF_SERVICE: { label: "Not in use", tone: "bg-white/10 text-white/70" },
};

/**
 * The QR card in a room opens here. The QR belongs to the room: the stay checked in to the
 * room right now is found on the server (today one guest, tomorrow the next). A guest staying
 * gets their stay page — room, bill, Wi-Fi, and the menu ordering to their room bill; when
 * nobody is checked in, the room itself and the menu.
 */
export default async function RoomQrPage({ params, searchParams }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  // Staff scanning a room's card get the room control page (not the guest's). "?view=guest" shows what guests see.
  if (sp.view !== "guest") {
    const [user, qrRoom] = await Promise.all([getCurrentUser(), roomForQr(token)]);
    if (qrRoom && user && can(user, "rooms.view")) redirect(`/staff/rooms/${qrRoom.roomId}`);
  }
  const [scan, s, sections] = await Promise.all([scanRoomQr(token), getSettings(), orderMenuSections()]);

  // Someone is staying in the room: their page — the stay on top, the menu to order to the room bill.
  if (scan?.stay) return <StayPage stay={scan.stay} s={s} target={{ kind: "room", token }} via="room" />;

  const phone = prettyPhone(s.whatsapp || s.phone);
  const room = scan?.room ?? null;
  const info = scan?.info ?? null;
  const state = room ? ROOM_STATE[room.status] ?? ROOM_STATE.AVAILABLE : null;
  const where = room?.meeting ? "the meeting room" : `Room ${room?.number}`;

  return (
    <main className="relative min-h-svh overflow-x-clip bg-[#070b1c] pb-16 text-white">
      <NightSky />
      <PlaceHero hotel={s.hotelName} media={<DishShowcase picks={heroPhotos(sections, 6)} />} below={<DishMarquee picks={stripPicks(sections, heroPhotos(sections, 6))} />}
        eyebrow={room ? (room.meeting ? "Meeting room" : "Welcome to") : "Welcome"}
        title={room ? (room.meeting ? `Meeting Room ${room.number}` : `Room ${room.number}`) : s.hotelName}
        accent={info?.type ?? null}
        line={`Welcome to ${s.hotelName}. Our kitchen and bar menu is below.`}
        chips={state && room?.active ? <span className={cn("rounded-full px-3 py-1.5 font-semibold", state.tone)}>{state.label}</span> : null} />

      <div className="relative mx-auto grid max-w-6xl gap-5 px-4 sm:px-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {!room || !room.active ? (
            <section className="rounded-3xl border border-white/10 bg-[#111833]/90 p-5">
              <CircleSlash className="size-7 text-white/60" />
              <p className="mt-2 font-display text-2xl">{room ? "This QR card is switched off" : "We don’t recognise this QR code"}</p>
              <p className="mt-1 text-sm text-white/65">Please contact reception — we are happy to help. You can still see our menu and order to take away.</p>
              <Link href="/order" className="mt-3 flex h-11 items-center justify-center rounded-2xl text-sm font-bold text-[#1a1206]" style={{ background: GOLD_GRADIENT }}>Order from our menu</Link>
            </section>
          ) : (
            <>
              {/* The room */}
              {info && (
                <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#111833]/90 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)]">
                  {info.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={info.photo} alt={info.type} className="aspect-[16/10] w-full object-cover" />
                  )}
                  <div className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: GOLD }}>{room.meeting ? "Meeting room" : "This room"}</p>
                    <p className="font-display text-2xl">{info.type}</p>
                    {info.blurb && <p className="mt-1 text-sm text-white/65">{info.blurb}</p>}
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                      <Chip icon={Users}>{room.meeting ? `Up to ${info.adults} people` : `${info.adults} adult${info.adults === 1 ? "" : "s"}${info.children ? ` · ${info.children} child${info.children === 1 ? "" : "ren"}` : ""}`}</Chip>
                      {info.bed && <Chip icon={BedDouble}>{info.bed}</Chip>}
                      {info.size && <Chip icon={Ruler}>{info.size} m²</Chip>}
                    </div>
                    {info.amenities.length > 0 && <p className="mt-3 flex items-start gap-1.5 text-[12px] text-white/60"><Check className="mt-0.5 size-3.5 shrink-0" style={{ color: GOLD }} />{info.amenities.join(" · ")}</p>}
                    <div className="mt-4 flex items-end justify-between gap-3 border-t border-white/10 pt-3">
                      <div><p className="text-[11px] text-white/55">{room.meeting ? "Price" : "From"}</p><p className="text-xl font-semibold tabular-nums" style={{ color: GOLD }}>TZS {formatNumber(info.price)}</p><p className="text-[11px] text-white/50">{room.meeting ? "per booking" : "per night"}</p></div>
                      <Link href={room.meeting ? "/meeting-room" : `/rooms/${info.slug}`} className="inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-bold text-[#1a1206]" style={{ background: GOLD_GRADIENT }}>
                        {room.meeting ? <Presentation className="size-4" /> : <CalendarCheck className="size-4" />}{room.meeting ? "Book it" : "Book this room"}
                      </Link>
                    </div>
                  </div>
                </section>
              )}
              <section className="rounded-3xl border border-[#e3bd6a]/40 bg-[#e3bd6a]/10 p-4 text-sm">
                <p className="font-semibold">Ordering to {where}</p>
                <p className="mt-1 text-white/75">Room orders open for the guest checked in to {where}. Please contact Reception to place an order — or order to take away from our menu.</p>
              </section>
            </>
          )}
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <p className="font-display text-xl">Reception</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {s.phone && <a href={telHref(s.phone)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-[#1a1206]" style={{ background: GOLD }}><Phone className="size-4" />Call</a>}
              {s.whatsapp && <a href={whatsappHref(s.whatsapp, room ? `Hello, this is about ${where}.` : "Hello")} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#25D366] text-sm font-semibold text-[#073b1f]"><MessageCircle className="size-4" />WhatsApp</a>}
            </div>
            {phone && <p className="mt-2 text-center text-xs text-white/50">{phone}</p>}
          </section>
        </aside>

        <div className="min-w-0 space-y-5">
          <MenuBrowse sections={sections} subtitle={<>Everything our kitchen and bar serve today. <Link href="/order" className="font-semibold underline underline-offset-2" style={{ color: GOLD }}>Order to take away or dine in →</Link></>} />
          <ExploreHotel hotel={s.hotelName} />
        </div>
      </div>
    </main>
  );
}

function Chip({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-white/85"><Icon className="size-3.5" style={{ color: GOLD }} />{children}</span>;
}
