"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, BedDouble, CalendarDays, Check, Circle, FileStack, UtensilsCrossed, FileText, Loader2, Minus, Plus, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { PAYMENT_TERMS, termsLabel } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import type { BookingCompany, CompanyStaff } from "@/lib/company-staff";
import { ACCOUNT_WORD, GROUP_TYPES } from "@/lib/group-types";
import { StayDatePicker } from "@/components/staff/date-picker";
import type { BillMenu } from "@/server/services/restaurant";
import type { MenuPick } from "@/components/staff/reception/menu-order";
import { ExtrasPicker, extrasIncomplete, extrasPayload, extrasTotal, type ExtraLine } from "@/components/staff/reception/extras-picker";
import { ID_TYPES } from "@/lib/company-staff";
import { QuickCompanyDialog, type PersonDraft } from "@/components/staff/company/quick-company";
import { checkAvailabilityAction, type AvailabilityResult } from "../../reservations/actions";
import { createGroupAction } from "../actions";

type GroupType = (typeof GROUP_TYPES)[number]["v"];
/** A person in the group: typed here, or one of the company's people (id). */
type Member = PersonDraft & { key: number; id: string | null };
/** A room: who sleeps there (a member; none = name given later) and who shares it. */
type Line = {
  key: number; typeId: string; roomId: string; guestKey: number | null; occupantKeys: number[]; adults: number; children: number; ownBill: boolean;
  /** This room's own dates (null = the group's dates). */
  arrival: string | null; departure: string | null;
  /** Food & drinks from the menu and typed-in extras, on this room's bill. */
  picks: MenuPick[]; extras: ExtraLine[];
};


const plusDay = (d: string, n = 1) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nightsOf = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
const floorOf = (n: string) => n.slice(0, -2) || "0";
const floorName = (f: string) => { const n = Number(f); return !n ? "Ground floor" : `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} floor`; };

/**
 * One page for a group: who they are, the dates, the rooms (picked on a floor
 * map so a family or team can be kept close together), the guest in each room,
 * and who pays. Every room becomes its own booking under the group.
 */
export function GroupForm(props: {
  today: string;
  sources: { code: string; name: string }[];
  companies: BookingCompany[];
  preselectCompany?: string | null;
  /** The hotel's default payment terms (days) when neither the group nor its company sets them. */
  defaultTerms?: number;
  /** The restaurant & bar menu — food & drinks for each room. */
  menu?: BillMenu | null;
}) {
  const router = useRouter();
  const keyRef = useRef(1);
  // Companies added here (before the page refreshes) join the list straight away.
  const [added, setAdded] = useState<BookingCompany[]>([]);
  const companies = [...added.filter((a) => !props.companies.some((c) => c.id === a.id)), ...props.companies];
  const [newCompany, setNewCompany] = useState(false);
  const [type, setType] = useState<GroupType>("COMPANY");
  const [name, setName] = useState(props.companies.find((c) => c.id === props.preselectCompany)?.companyName ?? "");
  const [companyId, setCompanyId] = useState(props.preselectCompany ?? "");
  const [members, setMembers] = useState<Member[]>([]);
  // Contact person — from the details given: the company account's, or typed in the billing details.
  const [contact, setContact] = useState({ fullName: "", phone: "" });
  const [source, setSource] = useState(props.preselectCompany ? "CORPORATE" : "PHONE");
  const [arrival, setArrival] = useState(props.today);
  const [departure, setDeparture] = useState(plusDay(props.today));
  const [lines, setLines] = useState<Line[]>([]);
  const [billing, setBilling] = useState<"COMBINED" | "SEPARATE">("COMBINED");
  const [terms, setTerms] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [requests, setRequests] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [avail, setAvail] = useState<AvailabilityResult | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();
  // Any group except a family can be billed to a company / organization account.
  // Each kind of group has its own saved accounts (companies, families, organizations…) and its own words.
  const word = ACCOUNT_WORD[type];
  const accounts = companies.filter((c) => c.kind === type);
  const company = accounts.find((c) => c.id === companyId) ?? null;
  // Billing profile: printed on the invoice when there is no company account.
  const [profile, setProfile] = useState({ billingEmail: "", address: "", billingAddress: "", taxId: "", vrn: "", registrationNo: "", billingNotes: "" });
  const memberBy = (key: number | null) => members.find((m) => m.key === key) ?? null;
  const nights = nightsOf(arrival, departure);
  // Everyone on the group's dates, or each room its own check-in and check-out.
  const [sameDates, setSameDates] = useState(true);
  const lineIn = (l: Line) => (sameDates ? arrival : l.arrival ?? arrival);
  const lineOut = (l: Line) => (sameDates ? departure : l.departure ?? departure);
  const lineNights = (l: Line) => nightsOf(lineIn(l), lineOut(l));
  const ownDates = (l: Line) => lineIn(l) !== arrival || lineOut(l) !== departure;

  useEffect(() => {
    const h = setTimeout(() => startCheck(async () => {
      const res = await checkAvailabilityAction({ stay: { kind: "overnight", arrivalDate: arrival, departureDate: departure }, sourceCode: source });
      if (res.ok) { setAvail(res.data); setAvailError(null); } else { setAvail(null); setAvailError(res.error); }
    }), 250);
    return () => clearTimeout(h);
  }, [arrival, departure, source]);

  const typeById = useMemo(() => new Map(avail?.types.map((t) => [t.id, t]) ?? []), [avail]);
  // A chosen room that is no longer free after a date change falls back to "any room of that type".
  const validRoom = (l: Line) => (typeById.get(l.typeId)?.rooms.some((r) => r.id === l.roomId) ? l.roomId : "");
  const chosen = new Set(lines.map(validRoom).filter(Boolean));
  // Free rooms not yet in the booking, to pick for a member straight from the Members list.
  const freeRooms = (avail?.types ?? []).flatMap((t) => t.rooms.filter((r) => !chosen.has(r.id)).map((r) => ({ id: r.id, number: r.number, typeId: t.id, typeName: t.name, price: t.netPerNight })))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  // Group dates: the exact quote. A room on its own dates: its nightly price × its nights (worked out exactly when saving).
  const price = (l: Line) => { const t = typeById.get(l.typeId); return !t ? 0 : ownDates(l) ? t.netPerNight * lineNights(l) : t.totalNet; };
  const setLineDates = (l: Line, a: string, d: string) => update(l.key, { arrival: a, departure: d > a ? d : plusDay(a) });
  // Each room's food, drinks & extras go on its own bill (the group pays unless the room pays its own).
  const extrasOf = (l: Line) => extrasTotal(l.picks, l.extras);
  const [openExtras, setOpenExtras] = useState<number | null>(null);
  const extrasSum = lines.reduce((s, l) => s + extrasOf(l), 0);
  const total = lines.reduce((s, l) => s + price(l) + extrasOf(l), 0);
  const groupPart = lines.filter((l) => !l.ownBill).reduce((s, l) => s + price(l) + extrasOf(l), 0);
  const guests = lines.reduce((s, l) => s + l.adults + l.children, 0);

  // Who is already put in a room (as its guest or sharing it).
  const placed = new Set(lines.flatMap((l) => [l.guestKey, ...l.occupantKeys]).filter((k): k is number => k != null));
  const roomOf = (key: number) => lines.findIndex((l) => l.guestKey === key || l.occupantKeys.includes(key));

  function addRoom(typeId: string, roomId = "") {
    const t = typeById.get(typeId);
    if (!t) return;
    const anyLeft = t.rooms.filter((r) => !chosen.has(r.id)).length - lines.filter((l) => l.typeId === typeId && !validRoom(l)).length;
    if (!roomId && anyLeft <= 0) return toast.error(`No more ${t.name} rooms free for these dates.`);
    const key = keyRef.current++;
    // Nobody is put in the room automatically — staff choose who sleeps where.
    setLines((ls) => [...ls, { key, typeId, roomId, guestKey: null, occupantKeys: [], adults: 1, children: 0, ownBill: false, arrival: null, departure: null, picks: [], extras: [] }]);
  }
  /**
   * Choose a member's room: one of the rooms already chosen ("line:<key>" — they share it if someone is
   * already there), a free room ("room:<type>|<room>", added to the booking with them in it), or none ("").
   */
  function setMemberRoom(memberKey: number, value: string) {
    const newKey = keyRef.current++;
    setLines((ls) => {
      const was = ls.find((l) => l.guestKey === memberKey || l.occupantKeys.includes(memberKey))?.key ?? null;
      let next = ls.map((l) => {
        if (l.guestKey === memberKey) { const [first, ...rest] = l.occupantKeys; return { ...l, guestKey: first ?? null, occupantKeys: rest }; }
        return l.occupantKeys.includes(memberKey) ? { ...l, occupantKeys: l.occupantKeys.filter((k) => k !== memberKey) } : l;
      });
      // The room they leave is dropped when nobody is left in it (e.g. they now share another room).
      if (was != null && value !== `line:${was}`) next = next.filter((l) => l.key !== was || l.guestKey != null || l.occupantKeys.length > 0);
      if (value.startsWith("line:")) {
        const lk = Number(value.slice(5));
        next = next.map((l) => (l.key !== lk ? l : fit(l.guestKey == null ? { ...l, guestKey: memberKey } : { ...l, occupantKeys: [...l.occupantKeys, memberKey] })));
      } else if (value.startsWith("room:")) {
        const [typeId, roomId] = value.slice(5).split("|");
        next = [...next, { key: newKey, typeId, roomId, guestKey: memberKey, occupantKeys: [], adults: 1, children: 0, ownBill: false, arrival: null, departure: null, picks: [], extras: [] }];
      }
      return next;
    });
  }
  /** A new person sharing this room: added to Members already placed in it (type their name in their row). */
  function addSharing(l: Line) {
    const m: Member = { fullName: "", phone: "", idType: "", idNumber: "", id: null, key: keyRef.current++ };
    setMembers((ms) => [...ms, m]);
    setLines((ls) => ls.map((x) => (x.key === l.key ? fit({ ...x, occupantKeys: [...x.occupantKeys, m.key] }) : x)));
  }
  /** Adults follow the people put in the room (up to what the room takes). */
  const fit = (l: Line): Line => ({ ...l, adults: Math.min(typeById.get(l.typeId)?.maxAdults ?? 2, Math.max(l.adults, (l.guestKey != null ? 1 : 0) + l.occupantKeys.length)) });
  /** Add people to the group; staff then choose each one's room. */
  function addMembers(people: (PersonDraft & { id?: string | null })[]) {
    const fresh = people.map((p) => ({ ...p, id: p.id ?? null, key: keyRef.current++ }));
    setMembers((ms) => [...ms, ...fresh]);
  }
  const fromStaff = (s: CompanyStaff): PersonDraft & { id: string } => ({ id: s.id, fullName: s.fullName, phone: s.phone ?? "", idType: s.idType ?? "", idNumber: s.idNumber ?? "" });
  function removeMember(key: number) {
    setMembers((ms) => ms.filter((m) => m.key !== key));
    // Whoever shares the room becomes its main guest.
    setLines((ls) => ls.map((l) => {
      if (l.guestKey === key) { const [first, ...rest] = l.occupantKeys; return { ...l, guestKey: first ?? null, occupantKeys: rest }; }
      return { ...l, occupantKeys: l.occupantKeys.filter((k) => k !== key) };
    }));
  }
  function pickCompany(id: string) {
    setCompanyId(id);
    const c = companies.find((x) => x.id === id);
    if (!c) return;
    if (!name.trim() || companies.some((x) => x.companyName === name.trim())) setName(c.companyName);
    if (c.kind === "COMPANY") setSource("CORPORATE");
  }
  const person = (m: Member) => ({ id: m.id, fullName: m.fullName.trim(), phone: m.phone.trim() || undefined, idType: m.idType || undefined, idNumber: m.idNumber.trim() || undefined });
  const numberOf = (l: Line) => typeById.get(l.typeId)?.rooms.find((r) => r.id === validRoom(l))?.number ?? null;
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeRoomId = (roomId: string) => setLines((ls) => ls.filter((l) => validRoom(l) !== roomId));

  function submit() {
    if (name.trim().length < 2) return toast.error(`Enter the ${word.one} name (e.g. ${word.placeholder}).`);
    const unnamed = members.find((m) => m.fullName.trim().length < 2);
    if (unnamed) return toast.error("Every member needs a name — or remove the empty row.");
    if (!lines.length) return toast.error("Add at least one room.");
    if (nights < 1) return toast.error("Check-out must be after check-in.");
    // The contact person comes from the details given: the company account, the billing details, or else the first guest.
    const firstGuest = members.find((m) => m.fullName.trim());
    const contactInput = company?.contact.name
      ? { fullName: company.contact.name, phone: company.contact.phone ?? undefined, email: company.contact.email ?? "" }
      : !company && contact.fullName.trim().length >= 2
        ? { fullName: contact.fullName.trim(), phone: contact.phone.trim() || undefined, email: profile.billingEmail.trim() }
        : firstGuest ? { ...person(firstGuest), email: "" } : null;
    if (!contactInput) return toast.error(company ? "Add the guests (the company account has no contact person)." : "Enter the contact person in the billing details, or add the guests.");
    const badExtra = lines.find((l) => extrasIncomplete(l.extras));
    if (badExtra) return toast.error(`Room ${numberOf(badExtra) ?? ""}: give each extra a name and a price.`);
    const badDates = lines.find((l) => lineNights(l) < 1);
    if (badDates) return toast.error(`Room ${numberOf(badDates) ?? ""}: check-out must be after check-in.`);
    const roomless = members.filter((m) => !placed.has(m.key));
    if (roomless.length) return toast.error(`${roomless.map((m) => m.fullName.trim()).join(", ")} ${roomless.length === 1 ? "has" : "have"} no room yet — put them in a room or remove them.`);
    startSave(async () => {
      const res = await createGroupAction({
        name: name.trim(), type, corporateCustomerId: company?.id ?? null,
        contact: contactInput,
        profile: company ? undefined : profile,
        sourceCode: source, billing, paymentTermDays: terms, notes: notes || undefined, specialRequests: requests || undefined,
        arrivalDate: arrival, departureDate: departure,
        creditOverride: needsApproval && creditReason.trim() ? { reason: creditReason.trim() } : null,
        rooms: lines.map((l) => ({
          roomTypeId: l.typeId, roomId: validRoom(l) || null, adults: l.adults, children: l.children, ownBill: l.ownBill,
          ...(ownDates(l) && { arrivalDate: lineIn(l), departureDate: lineOut(l) }),
          ...extrasPayload(l.picks, l.extras),
          guest: memberBy(l.guestKey) ? person(memberBy(l.guestKey)!) : null,
          occupants: l.occupantKeys.map(memberBy).filter((m): m is Member => !!m).map(person),
        })),
      });
      if (res.ok) { toast.success(`Group booked — ${res.data.reference}`); router.push(`/staff/groups/${res.data.id}`); }
      else {
        toast.error(res.error, { duration: 9000 });
        if (res.fieldErrors?.creditOverride) setNeedsApproval(true);
      }
    });
  }

  const chip = (on: boolean) => cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted");
  const box = "@container space-y-4 rounded-3xl border border-border/70 bg-card p-4 sm:p-5";
  const step = (n: number, title: string, aside?: React.ReactNode) => (
    <div className="flex items-center gap-3">
      <span className="grid size-7 place-items-center rounded-full bg-foreground text-xs font-bold text-background">{n}</span>
      <h2 className="flex-1 text-base font-semibold">{title}</h2>{aside}
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        {/* 1 — Who */}
        <section className={box}>
          {step(1, "The group")}
          <div className="grid grid-cols-2 gap-2 @[34rem]:grid-cols-3 @[62rem]:grid-cols-6" role="radiogroup" aria-label="Kind of group">
            {GROUP_TYPES.map(({ v, label, hint, icon: I }) => (
              <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => { setType(v); if (v !== type) setCompanyId(""); }}
                className={cn("flex items-center gap-2.5 rounded-2xl border p-3 text-left transition-all", type === v ? "border-[oklch(0.75_0.13_80)] bg-[oklch(0.75_0.13_80)]/[0.08]" : "border-border/70 hover:border-foreground/20")}>
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4", type === v ? "bg-[oklch(0.75_0.13_80)] text-black" : "bg-muted")}><I /></span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{label}</span><span className="block truncate text-[11px] text-muted-foreground">{hint}</span></span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 @[30rem]:grid-cols-2">
            <div className="space-y-1.5 @[30rem]:col-span-2">
              <span className="text-xs font-medium">Saved {word.one} <span className="font-normal text-muted-foreground">— its details and people are filled in for you</span></span>
              <div className="flex gap-2">
                <NativeSelect aria-label={`Saved ${word.one}`} className="flex-1" value={company?.id ?? ""} onChange={(e) => (e.target.value === "__new" ? setNewCompany(true) : e.target.value ? pickCompany(e.target.value) : setCompanyId(""))}>
                  <option value="">{accounts.length ? `Choose a saved ${word.one}… (or type a new one below)` : `No saved ${word.one} yet — type the name below`}</option>
                  {accounts.map((c) => <option key={c.id} value={c.id}>{c.companyName}{c.staff.length ? ` · ${c.staff.length} people` : ""}</option>)}
                  <option value="__new">+ New {word.one}…</option>
                </NativeSelect>
                <Button type="button" variant="outline" className="h-auto shrink-0 rounded-xl" onClick={() => setNewCompany(true)}><Plus />New {word.one}</Button>
              </div>
            </div>
            <label className="space-y-1.5 @[30rem]:col-span-2">
              <span className="text-xs font-medium">{word.title} name{company ? "" : " — the invoice is made out to it"} *</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={word.placeholder} className="h-11 rounded-xl text-base" />
            </label>
          </div>
          {/* Billing profile — printed on the invoice (a company account uses its own) */}
          {company ? (
            <p className="rounded-2xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
              The invoice is made out to <strong className="text-foreground">{company.companyName}</strong> with the address and tax details on its account.
              {" "}{company.contact.name
                ? <>Contact: <strong className="text-foreground">{company.contact.name}</strong>{[company.contact.phone, company.contact.email].filter(Boolean).map((x) => ` · ${x}`).join("")}.</>
                : "The account has no contact person — the first guest is used."}
            </p>
          ) : (
            <details className="group rounded-2xl border border-border/70 px-3 py-2.5" open={type !== "FAMILY"}>
              <summary className="cursor-pointer text-sm font-medium">Billing details <span className="font-normal text-muted-foreground">— printed on the invoice{type === "FAMILY" ? " (optional)" : ""}</span></summary>
              <div className="mt-3 grid gap-2.5 @[30rem]:grid-cols-2">
                <label className="space-y-1"><span className="text-[11px] text-muted-foreground">Contact person — who we call about the group</span>
                  <Input value={contact.fullName} onChange={(e) => setContact({ ...contact, fullName: e.target.value })} placeholder="e.g. John Michael (blank = the first guest)" className="h-10 rounded-xl" /></label>
                <label className="space-y-1"><span className="text-[11px] text-muted-foreground">Contact phone</span>
                  <Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} inputMode="tel" placeholder="07XX XXX XXX" className="h-10 rounded-xl" /></label>
                {([
                  ["billingEmail", "Invoice email — invoices & statements go here", "accounts@company.co.tz"],
                  ["address", "Address", "Dar es Salaam, Tanzania"],
                  ["taxId", "TIN", ""], ["vrn", "VRN", ""], ["registrationNo", "Registration no.", ""],
                ] as const).map(([k, label, ph]) => (
                  <label key={k} className="space-y-1"><span className="text-[11px] text-muted-foreground">{label}</span>
                    <Input value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} placeholder={ph} type={k === "billingEmail" ? "email" : "text"} className="h-10 rounded-xl" /></label>
                ))}
                <label className="space-y-1 @[30rem]:col-span-2"><span className="text-[11px] text-muted-foreground">Billing address (one line each; empty = the address)</span>
                  <Textarea rows={2} value={profile.billingAddress} onChange={(e) => setProfile({ ...profile, billingAddress: e.target.value })} placeholder={"P.O. Box 9184\nDar es Salaam"} /></label>
              </div>
            </details>
          )}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">How did they book?</p>
            <div className="flex flex-wrap gap-1.5">{props.sources.filter((s) => s.code !== "WALK_IN").map((s) => <button key={s.code} type="button" onClick={() => setSource(s.code)} aria-pressed={source === s.code} className={chip(source === s.code)}>{s.name}</button>)}</div>
          </div>
        </section>
        <QuickCompanyDialog open={newCompany} onOpenChange={setNewCompany} kind={type} initialName={!company ? name.trim() : ""}
          onSaved={(c) => {
            setAdded((a) => [c, ...a]);
            setCompanyId(c.id); setName(c.companyName); if (c.kind === "COMPANY") setSource("CORPORATE");
            // The people typed with the company join the group straight away.
            const fresh = c.staff.filter((st) => !members.some((m) => m.id === st.id)).map(fromStaff);
            if (fresh.length) addMembers(fresh);
          }} />

        {/* 2 — Members: the people staying */}
        <section className={box}>
          {step(2, "Members & dates", <span className="flex items-center gap-2 text-xs text-muted-foreground">{checking && <Loader2 className="size-3.5 animate-spin" />}{members.length} {members.length === 1 ? "person" : "people"}</span>)}
          {/* Dates: everyone together, or each person's room on its own dates */}
          <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/25 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex rounded-xl bg-background/70 p-0.5 ring-1 ring-border/60" role="radiogroup" aria-label="Dates">
                {([[true, "Same dates for everyone"], [false, "Different dates per person"]] as const).map(([v, label]) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={sameDates === v} onClick={() => setSameDates(v)}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors", sameDates === v ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>
                ))}
              </div>
              {!sameDates && <p className="text-xs text-muted-foreground">Set each person&apos;s dates below, next to their room.</p>}
            </div>
            {sameDates && (
              <>
                <div className="grid items-stretch gap-2 @[40rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <StayDatePicker size="sm" label="Check-in" value={arrival} min={props.today} today={props.today} availability range={{ from: arrival, to: departure }}
                    onChange={(v) => { setArrival(v); if (v >= departure) setDeparture(plusDay(v)); }} />
                  <span className="flex items-center justify-center gap-1 text-center @[40rem]:flex-col">
                    <span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-border/70">{nights} night{nights === 1 ? "" : "s"}</span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </span>
                  <StayDatePicker size="sm" label="Check-out" value={departure} min={plusDay(arrival)} today={props.today} availability range={{ from: arrival, to: departure }} onChange={setDeparture} />
                </div>
                <NightChips value={nights} onPick={(n) => setDeparture(plusDay(arrival, n))} />
              </>
            )}
          </div>
          {availError && <p className="text-sm text-destructive">{availError}</p>}
          {company && company.staff.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">People from {company.companyName} — tap to add</p>
              <div className="flex flex-wrap gap-1.5">
                {company.staff.map((st) => {
                  const inGroup = members.some((m) => m.id === st.id);
                  return (
                    <button key={st.id} type="button" disabled={inGroup} onClick={() => addMembers([fromStaff(st)])}
                      className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors", inGroup ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border hover:bg-muted")}>
                      {inGroup ? <Check className="size-3" /> : <Plus className="size-3" />}{st.fullName}
                    </button>
                  );
                })}
                {company.staff.filter((st) => !members.some((m) => m.id === st.id)).length > 1 && (
                  <button type="button" onClick={() => addMembers(company.staff.filter((st) => !members.some((m) => m.id === st.id)).map(fromStaff))} className="rounded-full px-3 py-1 text-xs font-semibold underline-offset-2 hover:underline">Add all</button>
                )}
              </div>
            </div>
          )}
          {members.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
              Add the people in the group{company?.staff.length ? " (tap them above, or add new ones)" : ""} — or add them right in a room below. Everyone is checked in by name; ID is optional.
            </p>
          ) : (
            <ul className="space-y-3">
              {members.map((m, i) => {
                const r = roomOf(m.key);
                const l = r >= 0 ? lines[r] : null;
                const set = (p: Partial<PersonDraft>) => setMembers((ms) => ms.map((x) => (x.key === m.key ? { ...x, ...p } : x)));
                const roomName = (x: Line) => numberOf(x) ? `Room ${numberOf(x)} · ${typeById.get(x.typeId)?.name ?? ""}` : `Any ${typeById.get(x.typeId)?.name ?? "room"}`;
                const others = l ? [l.guestKey, ...l.occupantKeys].filter((k) => k != null && k !== m.key).map((k) => memberBy(k)?.fullName.trim()).filter(Boolean) : [];
                // The room's adults, kids and "pays own bill" are set once — on the room's first person.
                const firstInRoom = !!l && (l.guestKey ?? l.occupantKeys[0]) === m.key;
                const t = l ? typeById.get(l.typeId) : undefined;
                const label = "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
                return (
                  <li key={m.key} className={cn("@container overflow-hidden rounded-2xl border bg-card transition-colors", l ? "border-border/70" : "border-amber-500/40")}>
                    {/* The person */}
                    <div className="flex items-start gap-3 p-3 sm:p-4">
                      <span className="mt-5 grid size-9 shrink-0 place-items-center rounded-full bg-[oklch(0.75_0.13_80)]/15 text-sm font-bold tabular-nums text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]">{i + 1}</span>
                      <div className="grid min-w-0 flex-1 gap-2.5 @[40rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
                        <label className="min-w-0 space-y-1"><span className={label}>Full name</span>
                          <Input autoFocus={!m.fullName && i === members.length - 1} value={m.fullName} onChange={(e) => set({ fullName: e.target.value })} placeholder="As on their ID" className="h-10 rounded-xl" /></label>
                        <label className="min-w-0 space-y-1"><span className={label}>Phone</span>
                          <Input value={m.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="07XX XXX XXX" inputMode="tel" className="h-10 rounded-xl" /></label>
                        <div className="min-w-0 space-y-1"><span className={cn(label, "flex items-center gap-1.5")}>ID <span className="font-normal normal-case tracking-normal">(optional)</span>{m.id && <span className="rounded-full bg-muted px-1.5 py-px text-[9px] normal-case tracking-normal">on file</span>}</span>
                          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-1.5">
                            <select value={m.idType} onChange={(e) => set({ idType: e.target.value })} aria-label={`Guest ${i + 1} — ID type`}
                              className="h-10 min-w-0 rounded-xl border border-input bg-transparent px-2 text-sm outline-none dark:bg-input/30">
                              <option value="">Type</option>
                              {ID_TYPES.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}
                            </select>
                            <Input value={m.idNumber} onChange={(e) => set({ idNumber: e.target.value })} placeholder="Number" aria-label={`Guest ${i + 1} — ID number`} className="h-10 rounded-xl" />
                          </div>
                        </div>
                      </div>
                      <button type="button" aria-label={`Remove ${m.fullName || `guest ${i + 1}`}`} onClick={() => removeMember(m.key)} className="mt-5 grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-rose-600"><X className="size-4" /></button>
                    </div>

                    {/* Their room */}
                    <div className={cn("space-y-2.5 border-t px-3 py-3 sm:px-4", l ? "border-border/60 bg-muted/35" : "border-amber-500/30 bg-amber-500/[0.06]")}>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="relative min-w-[15rem] flex-1 @[40rem]:max-w-sm">
                          <BedDouble className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                          <NativeSelect aria-label={`Room for ${m.fullName || `guest ${i + 1}`}`} value={l ? `line:${l.key}` : ""} onChange={(e) => setMemberRoom(m.key, e.target.value)}
                            className={cn("h-10 rounded-xl pl-9 font-semibold", l ? "bg-card" : "border-amber-500/50 text-amber-800 dark:text-amber-300")}>
                            <option value="">Choose a room…</option>
                            {lines.length > 0 && (
                              <optgroup label="Rooms in this booking">
                                {lines.map((x) => {
                                  const who = [x.guestKey, ...x.occupantKeys].filter((k) => k != null && k !== m.key).map((k) => memberBy(k)?.fullName.trim()).filter(Boolean);
                                  const mine = l?.key === x.key;
                                  return <option key={x.key} value={`line:${x.key}`}>{roomName(x)}{who.length ? ` — ${mine ? "with" : "share with"} ${who.join(", ")}` : mine ? "" : " — free"}</option>;
                                })}
                              </optgroup>
                            )}
                            {freeRooms.length > 0 && (
                              <optgroup label="Other free rooms">
                                {freeRooms.map((fr) => <option key={fr.id} value={`room:${fr.typeId}|${fr.id}`}>Room {fr.number} · {fr.typeName} · {formatTZS(fr.price)}/night</option>)}
                              </optgroup>
                            )}
                          </NativeSelect>
                        </div>
                        {l && (sameDates ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />{formatBusinessDate(lineIn(l))} → {formatBusinessDate(lineOut(l))} · {lineNights(l)} night{lineNights(l) === 1 ? "" : "s"}</span>
                        ) : (
                          <div className="w-full space-y-2">
                            <div className="grid items-stretch gap-2 @[40rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                              <StayDatePicker size="sm" label="Check-in" value={lineIn(l)} min={props.today} today={props.today} availability range={{ from: lineIn(l), to: lineOut(l) }}
                                onChange={(v) => setLineDates(l, v, lineOut(l))} />
                              <span className="flex items-center justify-center gap-1 text-center @[40rem]:flex-col">
                                <span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-border/70">{lineNights(l)} night{lineNights(l) === 1 ? "" : "s"}</span>
                                <ArrowRight className="size-4 text-muted-foreground" />
                              </span>
                              <StayDatePicker size="sm" label="Check-out" value={lineOut(l)} min={plusDay(lineIn(l))} today={props.today} availability range={{ from: lineIn(l), to: lineOut(l) }}
                                onChange={(v) => setLineDates(l, lineIn(l), v)} />
                            </div>
                            <NightChips value={lineNights(l)} onPick={(n) => setLineDates(l, lineIn(l), plusDay(lineIn(l), n))} />
                          </div>
                        ))}
                        {!l && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Choose the room this person sleeps in</span>}
                      </div>
                      {l && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {firstInRoom ? (
                            <>
                              <span className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card px-2.5 py-1">
                                <InlineStepper label="Adults" value={l.adults} min={Math.max(1, (l.guestKey != null ? 1 : 0) + l.occupantKeys.length)} max={t?.maxAdults ?? 2} onChange={(v) => update(l.key, { adults: v })} />
                                <span className="h-4 w-px bg-border" />
                                <InlineStepper label="Kids" value={l.children} min={0} max={t?.maxChildren ?? 0} onChange={(v) => update(l.key, { children: v })} />
                              </span>
                              <label className={cn("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 font-medium transition-colors",
                                l.ownBill ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "border-border/70 bg-card text-muted-foreground hover:text-foreground")}>
                                <input type="checkbox" checked={l.ownBill} onChange={(e) => update(l.key, { ownBill: e.target.checked })} />Pays own bill
                              </label>
                            </>
                          ) : (
                            <span className="inline-flex h-9 items-center gap-1 rounded-xl bg-violet-500/10 px-2.5 font-medium text-violet-700 dark:text-violet-300"><Users className="size-3.5" />Sharing with {others.join(", ")}</span>
                          )}
                          {firstInRoom && others.length > 0 && <span className="inline-flex h-9 items-center gap-1 rounded-xl bg-violet-500/10 px-2.5 font-medium text-violet-700 dark:text-violet-300"><Users className="size-3.5" />With {others.join(", ")}</span>}
                          <div className="ml-auto flex flex-wrap gap-2">
                            <button type="button" onClick={() => addSharing(l)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-3 font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground">
                              <UserPlus className="size-3.5" />Someone sharing
                            </button>
                            <button type="button" onClick={() => setOpenExtras(openExtras === l.key ? null : l.key)} aria-expanded={openExtras === l.key}
                              className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 font-medium transition-colors",
                                extrasOf(l) > 0 || openExtras === l.key ? "border-[oklch(0.75_0.13_80)]/60 bg-[oklch(0.75_0.13_80)]/10" : "border-border bg-card hover:bg-muted")}>
                              <UtensilsCrossed className="size-3.5" />Food, drinks &amp; extras{extrasOf(l) > 0 && <strong className="tabular-nums">· {formatTZS(extrasOf(l))}</strong>}
                            </button>
                          </div>
                        </div>
                      )}
                      {l && openExtras === l.key && (
                        <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4">
                          <p className="mb-3 text-xs text-muted-foreground">
                            On the bill of <strong className="text-foreground">{numberOf(l) ? `room ${numberOf(l)}` : "this room"}</strong>{l.ownBill ? " (pays its own bill)" : ` — paid by ${company?.companyName ?? (name.trim() || "the group")}`}. Booked ahead, they go on the bill as a pre-order at menu prices; tell the kitchen when the guest arrives.
                          </p>
                          <ExtrasPicker menu={props.menu ?? null}
                            picks={l.picks} onPicks={(p) => update(l.key, { picks: p })}
                            extras={l.extras} onExtras={(x) => update(l.key, { extras: x })} />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => addMembers([{ fullName: "", phone: "", idType: "", idNumber: "" }])}><UserPlus />Add member</Button>
          </div>
        </section>

        {/* 3 — Rooms */}
        <section className={box}>
          {step(3, "Rooms", avail && <span className="text-xs text-muted-foreground">{lines.length} chosen · tap free rooms close together</span>)}
          {!avail && !availError && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Finding free rooms…</p>}
          {avail && (
            <div className="space-y-3">
              {/* Floor map: free rooms by floor, so a family or team can be put near each other. */}
              {[...avail.types.flatMap((t) => [...t.rooms.map((r) => ({ ...r, t, free: true })), ...t.busy.map((b) => ({ ...b, status: "", t, free: false }))])
                .reduce((m, r) => m.set(floorOf(r.number), [...(m.get(floorOf(r.number)) ?? []), r]), new Map<string, { id: string; number: string; free: boolean; t: AvailabilityResult["types"][number] }[]>())]
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([floor, rooms]) => (
                  <div key={floor} className="rounded-2xl bg-muted/40 p-2.5">
                    <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{floorName(floor)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {rooms.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })).map((r) => {
                        const on = chosen.has(r.id);
                        return (
                          <button key={r.id} type="button" disabled={!r.free} title={`Room ${r.number} · ${r.t.name}${r.free ? "" : " · taken"}`}
                            onClick={() => (on ? removeRoomId(r.id) : addRoom(r.t.id, r.id))}
                            className={cn("flex h-12 w-[4.2rem] flex-col items-center justify-center rounded-xl border-2 text-[15px] font-bold leading-none tabular-nums transition-all",
                              on ? "border-[oklch(0.75_0.13_80)] bg-[oklch(0.75_0.13_80)] text-black" : r.free ? "border-emerald-500/35 bg-card hover:border-[oklch(0.75_0.13_80)]" : "border-transparent bg-zinc-500/10 text-muted-foreground/60")}>
                            {r.number}
                            <span className={cn("mt-1 max-w-full truncate px-1 text-[8.5px] font-semibold uppercase tracking-wide", on ? "text-black/70" : r.free ? "text-emerald-600 dark:text-emerald-400" : "")}>{on ? "Chosen" : r.free ? r.t.name.split(" ")[0] : "Taken"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              <div className="flex flex-wrap gap-1.5">
                {avail.types.map((t) => (
                  <button key={t.id} type="button" onClick={() => addRoom(t.id)} disabled={!t.rooms.length}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-left text-xs font-medium hover:bg-muted disabled:opacity-40">
                    <Plus className="size-3" />Any {t.name} · {formatTZS(t.netPerNight)}/night <span className="text-muted-foreground">({t.rooms.length} free)</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rooms booked by type (no number yet) — the chosen numbered rooms are the gold tiles above. */}
          {lines.some((l) => !numberOf(l)) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Any free room:</span>
              {lines.filter((l) => !numberOf(l)).map((l) => {
                const who = [l.guestKey, ...l.occupantKeys].map(memberBy).filter((m): m is Member => !!m && !!m.fullName.trim()).map((m) => m.fullName.trim());
                return (
                  <span key={l.key} className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/10 py-0.5 pl-2.5 pr-1 font-medium">
                    {typeById.get(l.typeId)?.name ?? "Room"}{who.length ? ` · ${who.join(", ")}` : ""}
                    <button type="button" aria-label="Remove this room" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid size-5 place-items-center rounded-full hover:bg-background"><X className="size-3" /></button>
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* 4 — Billing */}
        <section className={box}>
          {step(4, "Who pays")}
          <p className="text-sm">
            <strong>{company?.companyName ?? (name.trim() || "The group")}</strong> pays the whole bill of every room — room, food, drinks and extras —
            {" "}except rooms marked &ldquo;Pays own bill&rdquo;. Each room still checks in and out on its own.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ["COMBINED", "One invoice for the group", "Every room on one invoice, with a line per room and guest", FileStack],
              ["SEPARATE", "One invoice per room", "Each room gets its own invoice (still paid by the group)", FileText],
            ] as const).map(([v, label, hint, I]) => (
              <button key={v} type="button" aria-pressed={billing === v} onClick={() => setBilling(v)}
                className={cn("flex items-start gap-3 rounded-2xl border p-3 text-left", billing === v ? "border-[oklch(0.75_0.13_80)] bg-[oklch(0.75_0.13_80)]/[0.08]" : "border-border/70 hover:border-foreground/20")}>
                <I className="mt-0.5 size-4 shrink-0" /><span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Pay within</span>
            {PAYMENT_TERMS.map((d) => <button key={d} type="button" aria-pressed={(terms ?? company?.terms ?? props.defaultTerms ?? 14) === d} onClick={() => setTerms(d)} className={chip((terms ?? company?.terms ?? props.defaultTerms ?? 14) === d)}>{d === 0 ? "Now" : `${d} days`}</button>)}
          </div>
          {company?.available != null && (
            <p className={cn("text-xs", groupPart > company.available ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
              Credit left {formatTZS(Math.max(0, company.available))}{groupPart > company.available ? ` — this group puts about ${formatTZS(groupPart)} on the account; a manager must approve it` : ""}
            </p>
          )}
          {(needsApproval || (company?.available != null && groupPart > company.available)) && (
            <Input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="Manager approval: why may the company go over its limit?" className="h-10 rounded-xl" />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5"><span className="text-xs font-medium">Requests (every room)</span><Textarea rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} placeholder="e.g. rooms close together, airport pickup" /></label>
            <label className="space-y-1.5"><span className="text-xs font-medium">Staff notes</span><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Only staff see this" /></label>
          </div>
        </section>
      </div>

      {/* Summary — the same ticket as a single booking */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_2px_4px_rgba(15,23,42,0.03),0_22px_48px_-24px_rgba(15,23,42,0.45)]">
          {/* Dates */}
          <div className="relative overflow-hidden bg-[#15110c] px-5 pb-5 pt-4 text-white">
            <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[oklch(0.75_0.13_80)]/25 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">Group booking</p>
              <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">Vegas Luxury</span>
            </div>
            <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <TicketDate label="Check-in" date={arrival} />
              <div className="flex flex-col items-center gap-1 px-1">
                <span className="whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/15">{nights} night{nights === 1 ? "" : "s"}</span>
                <span className="flex w-16 items-center gap-1 text-white/30"><span className="h-px flex-1 border-t border-dashed border-white/30" /><ArrowRight className="size-3" /></span>
              </div>
              <TicketDate label="Check-out" date={departure} right />
            </div>
          </div>
          {/* Tear line */}
          <div className="relative h-0 border-t-2 border-dashed border-border">
            <span className="absolute -left-3.5 -top-3.5 size-7 rounded-full border border-border/70 bg-canvas" />
            <span className="absolute -right-3.5 -top-3.5 size-7 rounded-full border border-border/70 bg-canvas" />
          </div>

          <div className="space-y-4 p-5 text-sm">
            {/* The group and its rooms */}
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/25">
              <div className="flex items-center gap-3 px-3.5 py-3">
                <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", name.trim() ? "bg-[oklch(0.75_0.13_80)]/15 text-[oklch(0.84_0.11_82)] ring-1 ring-[oklch(0.75_0.13_80)]/30" : "border border-dashed border-border text-muted-foreground")}><Users className="size-4" /></span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{GROUP_TYPES.find((g) => g.v === type)?.label ?? "Group"}</span>
                  <span className={cn("block truncate", name.trim() ? "text-[15px] font-semibold" : "text-sm text-muted-foreground")}>{name.trim() || "Enter the group name"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{lines.length} room{lines.length === 1 ? "" : "s"} · {guests} guest{guests === 1 ? "" : "s"}{company ? ` · ${company.companyName}` : ""}</span>
                </span>
              </div>
              {lines.length === 0 ? (
                <div className="flex items-center gap-3 border-t border-border/60 px-3.5 py-3 text-muted-foreground">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-dashed border-border"><BedDouble className="size-4" /></span>
                  <span className="text-xs">No rooms yet — tap room numbers on the left.</span>
                </div>
              ) : (
                <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto border-t border-border/60">
                  {lines.map((l) => {
                    const t = typeById.get(l.typeId);
                    const number = t?.rooms.find((r) => r.id === validRoom(l))?.number;
                    const who = memberBy(l.guestKey)?.fullName.trim();
                    return (
                      <li key={l.key} className="flex items-center gap-3 px-3.5 py-2.5">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[oklch(0.75_0.13_80)] text-[14px] font-bold tabular-nums text-black shadow-[0_6px_14px_-8px_oklch(0.75_0.13_80)]">
                          {number ?? <BedDouble className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className={cn("block truncate text-[14px]", who ? "font-semibold" : "text-muted-foreground")}>{who || "Guest name later"}{l.occupantKeys.length > 0 && <span className="font-normal text-muted-foreground"> +{l.occupantKeys.length}</span>}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{number ? `Room ${number}` : "Any free room"} · {t?.name ?? ""}{l.ownBill ? " · pays own bill" : ""}</span>
                        </span>
                        <span className="shrink-0 text-right text-[14px] font-semibold tabular-nums">{formatTZS(price(l) + extrasOf(l)).replace("TZS ", "")}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Money */}
            <div className="rounded-2xl border border-border/70 p-3.5">
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Rooms, all nights</dt><dd className="tabular-nums">{formatTZS(total - extrasSum)}</dd></div>
                {extrasSum > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Food, drinks &amp; extras</dt><dd className="tabular-nums">+ {formatTZS(extrasSum)}</dd></div>}
                {total !== groupPart && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Rooms paying their own bill</dt><dd className="tabular-nums">{formatTZS(total - groupPart)}</dd></div>}
              </dl>
              <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-dashed border-border pt-2.5">
                <span className="text-xs font-medium text-muted-foreground">{company?.companyName ?? (name.trim() || "The group")} pays</span>
                <span className="whitespace-nowrap text-[1.7rem] font-semibold leading-none tracking-tight tabular-nums"><span className="mr-1 text-sm font-medium text-muted-foreground">TZS</span>{groupPart.toLocaleString("en-US")}</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{billing === "COMBINED" ? "One group invoice" : "One invoice per room"} · {termsLabel(terms ?? company?.terms ?? props.defaultTerms ?? 14)}{total !== groupPart ? ` · total ${formatTZS(total)}` : ""}</p>
            </div>

            {/* What is still missing */}
            {(!name.trim() || lines.length === 0) && (
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Still to do:</span>
                {!name.trim() && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-300"><Circle className="size-2.5" />Group name</span>}
                {lines.length === 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-300"><Circle className="size-2.5" />Rooms</span>}
              </p>
            )}

            <Button className="h-12 w-full rounded-2xl text-sm font-semibold" disabled={saving || !lines.length} onClick={submit}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />}Book {lines.length || ""} room{lines.length === 1 ? "" : "s"} for the group
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">Each room becomes its own booking under the group. Prices are worked out again when saving.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** A date on the ticket: "28 Sept" big, the weekday under it. */
function TicketDate({ label, date, right }: { label: string; date: string; right?: boolean }) {
  const d = new Date(`${date}T00:00:00Z`);
  const ok = !Number.isNaN(d.getTime());
  return (
    <div className={cn("min-w-0 leading-tight", right && "text-right")}>
      <p className="text-[10px] uppercase tracking-wider text-white/45">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{ok ? d.getUTCDate() : "—"} <span className="text-base font-medium text-white/80">{ok ? d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) : ""}</span></p>
      <p className="text-[11px] text-white/55">{ok ? d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }) : ""}</p>
    </div>
  );
}

/** A small "Adults − 2 +" control, on one line. */
function InlineStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex h-7 items-center rounded-lg border border-border bg-card">
        <button type="button" className="px-1.5 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label.toLowerCase()}`}><Minus className="size-3" /></button>
        <span className="w-4 text-center font-semibold tabular-nums">{value}</span>
        <button type="button" className="px-1.5 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label.toLowerCase()}`}><Plus className="size-3" /></button>
      </span>
    </span>
  );
}

/** Quick stay lengths: 1 night, 2 nights, 3 nights… */
function NightChips({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[1, 2, 3, 4, 5, 6, 7, 14, 30].map((n) => (
        <button key={n} type="button" aria-pressed={value === n} onClick={() => onPick(n)}
          className={cn("rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors",
            value === n ? "border-[oklch(0.7_0.13_80)] bg-[oklch(0.75_0.13_80)] font-semibold text-black" : "border-border bg-background/60 hover:bg-muted")}>
          {n === 30 ? "1 month" : n === 7 ? "1 week" : n === 14 ? "2 weeks" : `${n} night${n === 1 ? "" : "s"}`}
        </button>
      ))}
    </div>
  );
}
