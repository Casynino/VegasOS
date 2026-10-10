"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, HandCoins, Loader2, Plus, Search, X } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChargeComposer, type RecentItem } from "@/components/staff/reception/room-charges";
import type { BillMenu } from "@/server/services/restaurant";
import { recordPaymentAction } from "@/app/staff/(app)/reservations/actions";
import { invoicePaymentAction } from "@/app/staff/(app)/invoices/actions";
import type { Party, PartyKind } from "@/server/services/income";
import { accountDetail, type PayAccount } from "@/lib/pay-account";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

const CHIPS: { key: string; label: string; test: (p: Party) => boolean }[] = [
  { key: "owes", label: msg("Everyone who owes"), test: (p) => p.owes > 0 },
  { key: "stay", label: msg("In the hotel"), test: (p) => p.kind === "STAY" && !p.meeting },
  { key: "leaving", label: msg("Leaving today"), test: (p) => p.tag === "Leaving today" || p.tag === "Overdue" },
  { key: "arrival", label: msg("Arriving"), test: (p) => p.kind === "ARRIVAL" && !p.meeting },
  { key: "left", label: msg("Left owing"), test: (p) => p.kind === "LEFT" && !p.meeting },
  { key: "company", label: msg("Companies & meetings"), test: (p) => p.kind === "INVOICE" || !!p.meeting },
];
const ACTION: Record<PartyKind, typeof recordPaymentAction> = {
  STAY: recordPaymentAction, LEFT: recordPaymentAction, ARRIVAL: recordPaymentAction, INVOICE: invoicePaymentAction,
};
const ID_FIELD: Record<PartyKind, string> = { STAY: "reservationId", LEFT: "reservationId", ARRIVAL: "reservationId", INVOICE: "invoiceId" };

/**
 * A party's line as the income service says it in English ("Room 305 · 0712…", "Left · room 305", "Group invoice · …")
 * — in the reader's words; numbers, phones and names as they are.
 */
function partyDetail(t: T, d: string | null): string | null {
  if (!d) return d;
  let m: RegExpMatchArray | null;
  if ((m = d.match(/^Room (.+) — Meeting room · (.*)$/))) return t("Room {rooms} — Meeting room · {time}", { rooms: m[1], time: m[2] });
  if ((m = d.match(/^Room (.+) · arriving today$/))) return t("Room {rooms} · arriving today", { rooms: m[1] });
  if ((m = d.match(/^Room (.+) · arriving tomorrow$/))) return t("Room {rooms} · arriving tomorrow", { rooms: m[1] });
  if ((m = d.match(/^Room ([^·]+?)(?: · (.+))?$/))) return m[2] ? `${t("Room {number}", { number: m[1] })} · ${m[2]}` : t("Room {number}", { number: m[1] });
  if ((m = d.match(/^Left · room (.+)$/))) return t("Left · room {rooms}", { rooms: m[1] });
  if ((m = d.match(/^Group invoice · (.+)$/))) return t("Group invoice · {name}", { name: m[1] });
  return d === "Company invoice" ? t(d) : d;
}

/**
 * RECORD PAYMENT — pick who is paying (everyone who owes, or any guest in the
 * hotel), then the amount and the account it went into. Guests staying or
 * arriving can also have things added to their bill here.
 */
export function RecordIncome({ parties, accounts, recent, canCharge, start, compact, menu = null, menuPayNow = false, canType = true }: {
  parties: Party[]; accounts: PayAccount[]; recent: RecentItem[]; canCharge: boolean;
  /** The restaurant & bar menu (for guests staying now — orders need a checked-in guest). */
  menu?: BillMenu | null; menuPayNow?: boolean;
  /** May put typed extras on the bill (needs payments.record). */
  canType?: boolean;
  /** Open straight on this party (e.g. from "To collect"). */
  start?: string;
  /** Small text button instead of the main one. */
  compact?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("owes");
  // The party as it was when picked: the page refreshes after a payment, and the
  // form must stay until it has finished (and closed the dialog).
  const [party, setParty] = useState<Party | null>(null);
  const [mode, setMode] = useState<"pay" | "bill">("pay");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const router = useRouter();

  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const c = CHIPS.find((x) => x.key === chip)!;
    return parties.filter((p) => (needle ? [p.name, p.ref, p.detail].some((v) => v?.toLowerCase().includes(needle)) : c.test(p)));
  }, [parties, chip, needle]);

  const choose = (p: Party, m: "pay" | "bill" = "pay") => { setParty(p); setMode(m); setAmount(p.owes > 0 ? String(p.owes) : ""); };
  const close = () => { setOpen(false); setParty(null); setQ(""); setMode("pay"); };
  const value = Number(amount) || 0;
  const canBill = !!party?.room && canCharge && (party.kind === "STAY" || party.kind === "ARRIVAL") && (canType || (party.kind === "STAY" && !!menu));

  return (
    <>
      {compact
        ? <button type="button" onClick={() => { const p = parties.find((x) => x.key === start); if (p) choose(p); setOpen(true); }} className="text-[11px] font-semibold text-[oklch(0.55_0.11_76)] hover:underline dark:text-[#f0cf86]">{t("Receive payment →")}</button>
        : <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus />{t("Record payment")}</Button>}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader icon={<HandCoins />} eyebrow={t("Income")} tone="emerald">
            <DialogTitle>{t("Record payment")}</DialogTitle>
            <DialogDescription>{t("Choose who is paying, then the amount and the account.")}</DialogDescription>
          </DialogHeader>

          {!party ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={t("Guest name, room, booking reference, company or phone…")}
                  className="h-12 w-full rounded-2xl border-2 border-sky-500/50 bg-background pl-11 pr-10 text-[15px] outline-none focus:border-sky-500" />
                {q && <button type="button" onClick={() => setQ("")} aria-label={t("Clear")} className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-3.5" /></button>}
              </div>
              {!needle && (
                <div className="flex flex-wrap gap-1.5">
                  {CHIPS.map((c) => {
                    const count = parties.filter(c.test).length;
                    if (!count && c.key !== "owes") return null;
                    return (
                      <button key={c.key} type="button" onClick={() => setChip(c.key)} aria-pressed={chip === c.key}
                        className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", chip === c.key ? "border-sky-500 bg-sky-500 text-white" : "border-border hover:bg-muted")}>
                        {t(c.label)}<span className="ml-1 opacity-70">· {count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {list.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{needle ? t("No one matches “{q}”.", { q: q.trim() }) : t("Nobody here.")}</p> : (
                <ul className="overflow-hidden rounded-2xl border border-border/80">
                  {list.map((p) => (
                    <li key={p.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 px-4 py-3 last:border-0">
                      <span className="w-28 shrink-0 font-mono text-xs font-semibold">{p.ref}</span>
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate font-medium">{p.name === "Company" ? t("Company") : p.name}</p>
                        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", p.urgent ? "bg-rose-500/12 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground")}>{t(p.tag)}</span>
                          <span className="truncate">{partyDetail(t, p.detail)}</span>
                        </p>
                      </div>
                      <div className="text-right leading-tight">
                        <p className={cn("font-semibold tabular-nums", p.owes > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{p.owes > 0 ? formatTZS(p.owes) : t("Paid up")}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">{t("bill {total} · paid {paid}", { total: formatTZS(p.total), paid: formatTZS(p.paid) })}</p>
                      </div>
                      <div className="flex gap-1.5">
                        {p.room && canCharge && (p.kind === "STAY" || p.kind === "ARRIVAL") && (canType || (p.kind === "STAY" && !!menu)) && <button type="button" onClick={() => choose(p, "bill")} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">{t("Add to bill")}</button>}
                        {p.owes > 0 && <button type="button" onClick={() => choose(p)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:border-emerald-500 hover:bg-emerald-500/10">{t("Record payment")}</button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border/80 sm:grid-cols-4">
                {([[msg("Amount due"), formatTZS(party.owes), party.owes > 0], [msg("Total bill"), formatTZS(party.total), false], [msg("Paid so far"), formatTZS(party.paid), false], [msg("Status"), t(party.tag), party.urgent]] as const).map(([k, v, red], i) => (
                  <div key={k} className={cn("p-3", i > 0 && "border-l border-border/60", i === 2 && "border-l-0 sm:border-l", i >= 2 && "border-t border-border/60 sm:border-t-0")}>
                    <p className="text-xs text-muted-foreground">{t(k)}</p><p className={cn("mt-0.5 font-semibold tabular-nums", red && "text-rose-600 dark:text-rose-400")}>{v}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/80 px-4 py-3 text-sm">
                <span className="font-mono text-xs font-semibold">{party.ref}</span>
                <span className="font-medium">{party.name === "Company" ? t("Company") : party.name}</span>
                <span className="text-xs text-muted-foreground">{partyDetail(t, party.detail)}</span>
                <span className="ml-auto text-xs">{party.owes > 0 && <>{t.rich("owes <b>{amount}</b>", { b: (c) => <span className="font-semibold text-rose-600 dark:text-rose-400">{c}</span> }, { amount: formatTZS(party.owes) })} · </>}<button type="button" onClick={() => setParty(null)} className="underline underline-offset-2 hover:text-foreground">{t("pick another")}</button></span>
              </div>

              {canBill && (
                <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted/60 p-1">
                  {([["pay", t("Record payment")], ["bill", t("Add to bill")]] as const).map(([m, l]) => (
                    <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={cn("rounded-xl py-2 text-sm font-medium transition", mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                  ))}
                </div>
              )}

              {mode === "bill" && canBill ? (
                <ChargeComposer reservationId={party.id} roomLabel={party.room ?? ""} recent={recent} methods={accounts} menu={party.kind === "STAY" ? menu : null} menuPayNow={menuPayNow} canType={canType} onPosted={() => { close(); router.refresh(); }} />
              ) : party.owes <= 0 ? (
                <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("Nothing is owed right now.")}{canBill && ` ${t("Use “Add to bill” to put something on the room.")}`}</p>
              ) : (
                <ActionForm key={party.key} action={ACTION[party.kind]} onSuccess={() => { close(); router.refresh(); }} className="space-y-4">
                  {({ pending, fieldErrors: e }) => (
                    <>
                      <input type="hidden" name={ID_FIELD[party.kind]} value={party.id} />
                      <input type="hidden" name="accountId" value={accountId} />
                      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
                        <div className="space-y-1.5">
                          <label htmlFor="inc-amount" className="text-xs font-medium text-muted-foreground">{t("Amount received (TZS)")}</label>
                          <input id="inc-amount" name="amount" type="number" inputMode="numeric" min={1} max={party.owes} value={amount} onChange={(ev) => setAmount(ev.target.value)} autoFocus
                            className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-xl font-semibold tabular-nums outline-none focus:border-foreground/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                          <div className="flex gap-1.5 text-[11px]">
                            <button type="button" onClick={() => setAmount(String(party.owes))} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">{t("All {amount}", { amount: formatTZS(party.owes) })}</button>
                            {party.owes >= 2000 && <button type="button" onClick={() => setAmount(String(Math.round(party.owes / 2 / 1000) * 1000))} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">{t("Half")}</button>}
                          </div>
                          <FieldError message={e?.amount} />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="inc-ref" className="text-xs font-medium text-muted-foreground">{t("Reference")} <span className="font-normal">{t("(M-Pesa code, bank ref — optional)")}</span></label>
                          <input id="inc-ref" name="reference" placeholder={t("e.g. QK7XZ12ABC")} className="h-12 w-full rounded-2xl border border-border bg-background px-4 font-mono text-sm outline-none focus:border-foreground/40" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t("Into which account")}</p>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          {accounts.map((a) => (
                            <button key={a.id} type="button" onClick={() => setAccountId(a.id)} aria-pressed={accountId === a.id}
                              className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left leading-tight transition", accountId === a.id ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:bg-muted")}>
                              <span className="min-w-0"><span className="block truncate text-sm font-medium">{t(a.name)}</span><span className="font-mono text-[11px] text-muted-foreground">{a.number ?? "—"}</span></span>
                              {accountId === a.id && <Check className="size-4 shrink-0 text-emerald-600" />}
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{accountDetail(accounts.find((a) => a.id === accountId))}</p>
                        <FieldError message={e?.accountId} />
                      </div>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={pending || value <= 0 || value > party.owes || !accountId} className="h-12 rounded-2xl bg-emerald-600 px-6 text-base text-white hover:bg-emerald-500">
                          {pending && <Loader2 className="animate-spin" />}{value > 0 ? t("Record {amount}", { amount: formatTZS(value) }) : t("Enter the amount")}
                        </Button>
                      </div>
                    </>
                  )}
                </ActionForm>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
