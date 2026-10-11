"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, Download, Eye, FileDown, Gift, Loader2, Power, Printer, QrCode, RefreshCw, Search } from "lucide-react";
import { QrPrintCard as PrintCard, saveFile as save, snapQrCard as snap, type Printable } from "@/components/staff/qr/qr-print-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jpegFromDataUrl, jpegsToPdf } from "@/lib/jpeg-pdf";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { GiftChoice, SpinSettingsInput } from "@/server/services/spin";
import type { SpinTier } from "@/lib/spin";
import { regenerateSpinQrAction, saveSpinSettingsAction, setSpinPrizeAction, setSpinQrActiveAction, setSpinTierAction } from "./actions";

type Card = { id: string; number: string; type: string; tier: SpinTier | null; url: string; qr: string; active: boolean; scans: number; lastScan: string | null; guest: string | null; used: number | null; allowed: number | null };
type GiftRow = { id: string; name: string; category: string; price: number; choice: GiftChoice; value: number; valueOverride: number | null; weight: number; gift: boolean; why: "NEVER" | "PRICE" | "OFF_MENU" | "NO_STOCK" | null };
type Recent = { id: string; at: string; spin: number; of: number; name: string; value: number; where: string | null; room: string; guest: string; order: string | null; status: string | null };
type Total = { count: number; value: number };

const box = "rounded-3xl border border-border/70 bg-card p-4 sm:p-5";
const label = "text-xs font-medium text-muted-foreground";

/**
 * Spin to Win, one page: what was given (never income), the switch and the numbers, the gifts, the room cards.
 * Everything is changed right here — and only by the Admin; managers and the MD see the same page without the buttons.
 */
export function SpinBoard({ canManage, settings, running, today, given, giftsNow, types, gifts, recent, unclaimed, noGift, cards, hotel }: {
  canManage: boolean; settings: SpinSettingsInput; running: boolean; today: string; given: { today: Total; month: Total }; giftsNow: number;
  types: { id: string; name: string; chosen: string | null; tier: SpinTier | null }[]; gifts: GiftRow[]; recent: Recent[];
  unclaimed: { id: string; at: string; name: string; room: string; guest: string }[]; noGift: { id: string; at: string; room: string | null; guest: string | null }[]; cards: Card[]; hotel: string;
}) {
  const t = useT();
  const when = (iso: string) => new Date(iso).toLocaleString(t.intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const state = running ? t("Running") : settings.enabled ? (settings.startsOn && today < settings.startsOn ? t("Starts {date}", { date: settings.startsOn }) : t("Ended {date}", { date: settings.endsOn ?? "" })) : t("Switched off");
  const look = unclaimed.length + noGift.length;

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"><Gift className="size-4" />{t("Gifts for checked-in guests")}</p>
          <h1 className="font-display text-3xl font-semibold">{t("Spin to Win")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("Each room has its own Spin to Win card. A guest checked in to the room scans it and wins treats from the restaurant menu — nothing to pay, never on the bill. When nobody is checked in, the card gives nothing.")}</p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", running ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{state}</span>
      </div>

      {/* What was given — its own numbers, never part of income */}
      <div className="grid gap-3 sm:grid-cols-3 print:hidden">
        <Stat title={t("Gifts today")} main={String(given.today.count)} sub={t("Worth {amount}", { amount: formatTZS(given.today.value) })} />
        <Stat title={t("Gifts this month")} main={String(given.month.count)} sub={t("Worth {amount}", { amount: formatTZS(given.month.value) })} />
        <Stat title={t("Can be won right now")} main={t.plural(giftsNow, "{n} menu item", "{n} menu items")} sub={t("Gifts are a cost of the promotion — they are not counted as sales or income.")} warn={running && giftsNow === 0} />
      </div>

      <Tabs defaultValue={canManage && !running && !look ? "setup" : "given"} className="print:block">
        <TabsList className="print:hidden">
          <TabsTrigger value="given">{t("Given")}{look > 0 && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{look}</span>}</TabsTrigger>
          <TabsTrigger value="setup">{t("Set-up")}</TabsTrigger>
          <TabsTrigger value="gifts">{t("Gifts")}</TabsTrigger>
          <TabsTrigger value="cards">{t("Room cards")}</TabsTrigger>
        </TabsList>

        <TabsContent value="given" className="space-y-4 print:hidden">
          {look > 0 && (
            <section className={cn(box, "border-amber-500/40")}>
              <p className="flex items-center gap-2 font-semibold"><CircleAlert className="size-4 text-amber-600" />{t("Needs a look")}</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {noGift.map((n) => <li key={n.id}>{t("Room {room} could not spin — no gift was available ({when}). Check the menu and the stores; the guest's spin was not used.", { room: n.room ?? "—", when: when(n.at) })}</li>)}
                {unclaimed.map((u) => <li key={u.id}>{t("Room {room} · {guest} won {gift} and has not yet chosen where to enjoy it ({when}).", { room: u.room, guest: u.guest, gift: u.name, when: when(u.at) })}</li>)}
              </ul>
            </section>
          )}
          <section className={box}>
            <p className="font-semibold">{t("Latest gifts")}</p>
            {recent.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t("No gifts yet.")}</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">{t("When")}</th><th className="pb-2 font-medium">{t("Room")}</th><th className="pb-2 font-medium">{t("Gift")}</th>
                    <th className="pb-2 font-medium">{t("Where")}</th><th className="pb-2 font-medium">{t("Order")}</th><th className="pb-2 text-right font-medium">{t("Worth")}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {recent.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{when(r.at)}</td>
                        <td className="py-2 pr-3"><span className="font-semibold">{r.room}</span> <span className="text-muted-foreground">· {r.guest}</span></td>
                        <td className="py-2 pr-3">{r.name} <span className="text-xs text-muted-foreground">· {t("spin {n} of {total}", { n: r.spin, total: r.of })}</span></td>
                        <td className="py-2 pr-3">{r.where === "ROOM" ? t("To the room") : r.where === "RESTAURANT" ? t("At the restaurant") : <span className="text-amber-700 dark:text-amber-300">{t("Not chosen yet")}</span>}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{r.order ? <>{r.order} <span className="text-xs text-muted-foreground">· {t(orderWord(r.status))}</span></> : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{formatTZS(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="setup" className="space-y-4 print:hidden">
          <SettingsForm settings={settings} canManage={canManage} />
          <Tiers types={types} canManage={canManage} settings={settings} />
        </TabsContent>

        <TabsContent value="gifts" className="print:hidden">
          <Gifts gifts={gifts} canManage={canManage} limit={settings.maxItemPrice} />
        </TabsContent>

        <TabsContent value="cards" className="print:block">
          <Cards cards={cards} canManage={canManage} hotel={hotel} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const ORDER_WORDS: Record<string, string> = {
  PENDING: "New", ACCEPTED: "Accepted", PREPARING: "Being prepared", READY: "Ready", OUT_FOR_DELIVERY: "On its way", DELIVERED: "Delivered", COMPLETED: "Done", COLLECTED: "Collected", CANCELLED: "Cancelled",
};
const orderWord = (s: string | null) => ORDER_WORDS[s ?? ""] ?? "New";

function Stat({ title, main, sub, warn }: { title: string; main: string; sub: string; warn?: boolean }) {
  return (
    <div className={cn(box, warn && "border-amber-500/50")}>
      <p className={label}>{title}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{main}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function SettingsForm({ settings, canManage }: { settings: SpinSettingsInput; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState(settings);
  const [pending, start] = useTransition();
  const set = <K extends keyof SpinSettingsInput>(k: K, v: SpinSettingsInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (k: "spinsPerStay" | "budgetStandard" | "budgetPremium" | "maxItemPrice") => ({
    type: "number" as const, inputMode: "numeric" as const, min: 0, value: Number.isFinite(f[k]) ? f[k] : "", disabled: !canManage,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === "" ? NaN : Number(e.target.value)),
  });
  const save = (next: SpinSettingsInput) => start(async () => {
    const res = await saveSpinSettingsAction(next);
    if (res.ok) { toast.success(res.message ?? t("Saved.")); router.refresh(); } else toast.error(res.error);
  });
  const dirty = JSON.stringify(f) !== JSON.stringify(settings);
  return (
    <section className={box}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">{f.enabled ? t("Spin to Win is on") : t("Spin to Win is off")}</p>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{t("On: checked-in guests can spin from the card in their room. Off: every card shows a kind note and gives nothing — gifts already won stay with the guest.")}</p>
        </div>
        {/* The switch saves at once — the one thing that must never wait for a Save button. */}
        <Switch checked={f.enabled} disabled={!canManage || pending} aria-label={t("Spin to Win on or off")} onCheckedChange={(v) => { set("enabled", v); save({ ...settings, enabled: v }); }} />
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field title={t("Spins for each stay")} hint={t("Every spin wins a gift.")}><Input {...num("spinsPerStay")} max={10} /></Field>
        <Field title={t("Gift budget · Standard rooms")} hint={t("All the gifts of one stay together, TZS.")}><Input {...num("budgetStandard")} step={500} /></Field>
        <Field title={t("Gift budget · Premium rooms")} hint={t("All the gifts of one stay together, TZS.")}><Input {...num("budgetPremium")} step={500} /></Field>
        <Field title={t("Menu items up to this price are gifts")} hint={t("TZS. Change single items under Gifts.")}><Input {...num("maxItemPrice")} step={500} /></Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field title={t("First day")} hint={t("Empty = from now.")}><Input type="date" value={f.startsOn ?? ""} disabled={!canManage} onChange={(e) => set("startsOn", e.target.value || null)} /></Field>
        <Field title={t("Last day")} hint={t("Empty = no end.")}><Input type="date" value={f.endsOn ?? ""} disabled={!canManage} onChange={(e) => set("endsOn", e.target.value || null)} /></Field>
        <Toggle title={t("Guests may have a gift brought to the room")} checked={f.allowRoom} disabled={!canManage} onChange={(v) => set("allowRoom", v)} />
        <Toggle title={t("Guests may enjoy a gift at the restaurant")} checked={f.allowRestaurant} disabled={!canManage} onChange={(v) => set("allowRestaurant", v)} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("These numbers are for stays that start spinning from now on. A guest who has already begun keeps the spins and budget they started with — changing a booking or moving rooms never adds spins.")}</p>
      {canManage
        ? <div className="mt-4 flex gap-2"><Button disabled={!dirty || pending} onClick={() => save(f)}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button>{dirty && <Button variant="ghost" onClick={() => setF(settings)}>{t("Undo")}</Button>}</div>
        : <p className="mt-4 text-xs font-medium text-muted-foreground">{t("Only the Admin changes Spin to Win.")}</p>}
    </section>
  );
}

function Field({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className={label}>{title}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
function Toggle({ title, checked, disabled, onChange }: { title: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-3 py-2.5 text-sm">
      <span>{title}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function Tiers({ types, canManage, settings }: { types: { id: string; name: string; chosen: string | null; tier: SpinTier | null }[]; canManage: boolean; settings: SpinSettingsInput }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const change = (roomTypeId: string, v: string) => start(async () => {
    const res = await setSpinTierAction({ roomTypeId, tier: v === "" ? null : (v as "STANDARD" | "PREMIUM" | "NONE") });
    if (res.ok) { toast.success(res.message ?? t("Saved.")); router.refresh(); } else toast.error(res.error);
  });
  return (
    <section className={box}>
      <p className="font-semibold">{t("Which rooms get which budget")}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{t("Standard: {standard} of gifts a stay. Premium: {premium}.", { standard: formatTZS(settings.budgetStandard), premium: formatTZS(settings.budgetPremium) })}</p>
      <ul className="mt-3 divide-y divide-border/60">
        {types.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0 truncate font-medium">{x.name}</span>
            {canManage ? (
              <NativeSelect className="h-9 w-48" value={x.chosen ?? ""} disabled={pending} onChange={(e) => change(x.id, e.target.value)} aria-label={t("Budget for {type}", { type: x.name })}>
                <option value="">{x.tier === "PREMIUM" ? t("Premium (usual)") : t("Standard (usual)")}</option>
                <option value="STANDARD">{t("Standard")}</option>
                <option value="PREMIUM">{t("Premium")}</option>
                <option value="NONE">{t("No Spin to Win")}</option>
              </NativeSelect>
            ) : <span className="text-muted-foreground">{x.chosen === "NONE" ? t("No Spin to Win") : (x.chosen ?? x.tier) === "PREMIUM" ? t("Premium") : t("Standard")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Gifts({ gifts, canManage, limit }: { gifts: GiftRow[]; canManage: boolean; limit: number }) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<GiftRow | null>(null);
  const [form, setForm] = useState<{ choice: GiftChoice; value: string; weight: number }>({ choice: "RULE", value: "", weight: 1 });
  const [pending, start] = useTransition();
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return k ? gifts.filter((g) => `${g.name} ${g.category}`.toLowerCase().includes(k)) : gifts; }, [gifts, q]);
  const open = (g: GiftRow) => { setEdit(g); setForm({ choice: g.choice, value: g.valueOverride === null ? "" : String(g.valueOverride), weight: g.weight }); };
  const save = () => edit && start(async () => {
    const res = await setSpinPrizeAction({ menuItemId: edit.id, choice: form.choice, valueOverride: form.choice === "ALWAYS" && form.value !== "" ? Number(form.value) : null, weight: form.weight });
    if (res.ok) { toast.success(res.message ?? t("Saved.")); setEdit(null); router.refresh(); } else toast.error(res.error);
  });
  const why = (g: GiftRow) => g.why === "NEVER" ? t("Never a gift") : g.why === "PRICE" ? t("Above {amount}", { amount: formatTZS(limit) }) : g.why === "OFF_MENU" ? t("Not available on the menu now") : t("An ingredient has run out");
  return (
    <section className={box}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{t("Which menu items are gifts")}</p>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{t("Food and soft drinks up to {amount} are gifts by themselves. Drinks from the bar are never gifts. An item that is switched off on the menu, or whose ingredients have run out, is not on the wheel until it is back.", { amount: formatTZS(limit) })}</p>
        </div>
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a menu item")} className="h-9 w-56 pl-8" /></div>
      </div>
      <ul className="mt-3 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{g.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{g.category} · {formatTZS(g.price)}{g.gift && g.value !== g.price ? ` · ${t("worth {amount} as a gift", { amount: formatTZS(g.value) })}` : ""}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", g.gift ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{g.gift ? (g.choice === "ALWAYS" ? t("Gift · chosen") : t("Gift")) : why(g)}</span>
              {canManage && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => open(g)}>{t("Change")}</Button>}
            </span>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{t("Nothing found.")}</p>}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Gift />} eyebrow={t("Spin to Win gift")} tone="sky">
            <DialogTitle>{edit?.name}</DialogTitle>
            <DialogDescription>{t("Menu price {amount}.", { amount: formatTZS(edit?.price ?? 0) })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {([["RULE", t("By the price rule"), t("A gift while its menu price is {amount} or less.", { amount: formatTZS(limit) })], ["ALWAYS", t("Always a gift"), t("Whatever its price — while it is available.")], ["NEVER", t("Never a gift"), t("Not on the wheel.")]] as const).map(([v, title, sub]) => (
              <button key={v} type="button" onClick={() => setForm((x) => ({ ...x, choice: v }))} className={cn("rounded-2xl border px-3 py-2.5 text-left text-sm transition", form.choice === v ? "border-primary bg-primary/5" : "border-border/70 hover:bg-muted/60")}>
                <span className="block font-medium">{title}</span><span className="block text-xs text-muted-foreground">{sub}</span>
              </button>
            ))}
          </div>
          {form.choice === "ALWAYS" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field title={t("Worth as a gift (TZS)")} hint={t("Empty = the menu price.")}><Input type="number" inputMode="numeric" min={0} step={500} value={form.value} onChange={(e) => setForm((x) => ({ ...x, value: e.target.value }))} /></Field>
              <Field title={t("How often it comes up")}>
                <NativeSelect value={String(form.weight)} onChange={(e) => setForm((x) => ({ ...x, weight: Number(e.target.value) }))}>
                  <option value="1">{t("Like the others")}</option><option value="2">{t("Twice as often")}</option><option value="3">{t("Three times as often")}</option>
                </NativeSelect>
              </Field>
            </div>
          )}
          <div className="flex gap-2">
            <Button disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>{t("Cancel")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Cards({ cards, canManage, hotel }: { cards: Card[]; canManage: boolean; hotel: string }) {
  const t = useT();
  const router = useRouter();
  const [only, setOnly] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Card | null>(null);
  const [pending, start] = useTransition();
  const printable = (c: Card): Printable => ({ id: `spin-${c.id}`, kind: "spin", title: c.number, url: c.url, qr: c.qr });
  const live = cards.filter((c) => c.active && c.tier);

  const print = (ids: string[] | null) => {
    setOnly(ids);
    const reset = () => { setOnly(null); window.removeEventListener("afterprint", reset); };
    window.addEventListener("afterprint", reset);
    setTimeout(() => window.print(), 60);
  };
  const downloadOne = async (c: Card) => {
    const node = document.getElementById(`qr-spin-${c.id}`);
    if (!node) return;
    setBusy(c.id);
    try { save(await snap(node), `Spin-to-Win-Room-${c.number}.jpg`); } catch { toast.error(t("Could not make the image — try again.")); } finally { setBusy(null); }
  };
  const downloadAll = async () => {
    setBusy("all");
    try {
      const pages = [];
      for (const c of live) {
        const node = document.getElementById(`qr-spin-${c.id}`);
        if (node) pages.push(await jpegFromDataUrl(await snap(node)));
      }
      const href = URL.createObjectURL(new Blob([jpegsToPdf(pages, 298)], { type: "application/pdf" }));
      save(href, "Spin-to-Win-cards.pdf");
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch { toast.error(t("Could not make the PDF — try again.")); } finally { setBusy(null); }
  };
  const regenerate = (c: Card) => start(async () => {
    const res = await regenerateSpinQrAction({ roomId: c.id });
    if (res.ok) { toast.success(res.message ?? t("New QR made.")); setConfirm(null); router.refresh(); } else toast.error(res.error);
  });
  const toggle = (c: Card) => start(async () => {
    const res = await setSpinQrActiveAction({ roomId: c.id, active: !c.active });
    if (res.ok) { toast.success(res.message ?? t("Saved.")); router.refresh(); } else toast.error(res.error);
  });

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4; margin: 8mm; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("One card for each room — it stays in the room for good. It is not the room-service card: this one only opens the wheel, and only for the guest checked in to that room.")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => print(live.map((c) => c.id))}><Printer />{t("Print all ({n})", { n: live.length })}</Button>
          <Button disabled={!!busy} onClick={downloadAll}>{busy === "all" ? <Loader2 className="animate-spin" /> : <FileDown />}{t("Download all (PDF)")}</Button>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] justify-items-center gap-5 print:grid-cols-2 print:gap-[6mm]">
        {cards.map((c) => (
          <div key={c.id} className={cn("w-full max-w-[420px] space-y-2 print:max-w-none print:break-inside-avoid", ((only !== null && !only.includes(c.id)) || !c.active || !c.tier) && "print:hidden")}>
            <div className="relative">
              <PrintCard card={printable(c)} hotel={hotel} />
              {(!c.active || !c.tier) && <div className="absolute inset-0 grid place-items-center rounded-[22px] bg-black/60 px-6 text-center text-sm font-semibold text-white print:hidden">{!c.active ? t("Card switched off") : t("No Spin to Win for this room type")}</div>}
            </div>
            <div className="space-y-1.5 rounded-2xl border border-border/70 bg-card px-3 py-2 print:hidden">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate"><strong>{t("Room {room}", { room: c.number })}</strong> · {c.type}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">{c.tier === "PREMIUM" ? t("Premium") : c.tier === "STANDARD" ? t("Standard") : t("No spins")}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {c.guest ? (c.used === null ? t("In use · {name} · has not spun yet", { name: c.guest }) : t("In use · {name} · {used} of {total} spins used", { name: c.guest, used: c.used, total: c.allowed ?? 0 })) : t("Nobody checked in — the card gives nothing")}
                {" · "}{t.plural(c.scans, "{n} scan", "{n} scans")}
              </p>
              <div className="flex flex-wrap gap-1">
                <a href={c.url} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs hover:bg-muted" title={t("See what a guest sees when they scan")}><Eye className="size-3.5" />{t("Guest view")}</a>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => print([c.id])} disabled={!c.active}><Printer />{t("Print")}</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!busy} onClick={() => downloadOne(c)}>{busy === c.id ? <Loader2 className="animate-spin" /> : <Download />}{t("Download")}</Button>
                {canManage && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setConfirm(c)}><RefreshCw />{t("New QR")}</Button>}
                {canManage && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => toggle(c)}><Power />{c.active ? t("Switch off") : t("Switch on")}</Button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<QrCode />} eyebrow={t("Spin to Win card")} tone="sky">
            <DialogTitle>{t("New QR for room {room}?", { room: confirm?.number })}</DialogTitle>
            <DialogDescription>{t("The card in the room now stops working — print the new card and replace it. The guest's spins and gifts are not affected: a new card never gives new spins.")}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={() => confirm && regenerate(confirm)}>{pending && <Loader2 className="animate-spin" />}{t("Make a new QR")}</Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("Keep the current one")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
