"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, BadgeCheck, BanknoteArrowUp, Check, CircleCheck, CircleX, Clock, Landmark, Loader2, RefreshCw, Send, Smartphone, Store, Timer, TriangleAlert } from "lucide-react";
import { useT } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, type DialogTone } from "@/components/ui/dialog";
import { NativeCheckbox } from "@/components/ui/native-select";
import { FieldError } from "@/components/staff/action-form";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  LIPA_BELOW_TZS, LIPA_MIN_TZS, WITHDRAW_BANKS, WITHDRAW_MIN_TZS, WITHDRAWAL_EVENTS, WITHDRAWAL_NOTES, WITHDRAWAL_STATUS, withdrawalProblem, type WithdrawalStatusCode, type WithdrawalTone,
} from "@/lib/withdrawals";
import type { WithdrawalHistoryLine, WithdrawalPrice, WithdrawalView } from "@/server/services/withdrawals";
import {
  acknowledgeWithdrawalAction, cancelWithdrawalPriceAction, checkNtzsBalanceAction, checkWithdrawalAction, confirmWithdrawalAction, priceWithdrawalAction,
  settleWithdrawalAction, withdrawalDetailAction,
} from "./actions";

const TONE: Record<WithdrawalTone, { chip: string; text: string; dialog: DialogTone }> = {
  ok: { chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", text: "text-emerald-700 dark:text-emerald-300", dialog: "emerald" },
  wait: { chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", text: "text-sky-700 dark:text-sky-300", dialog: "sky" },
  warn: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", text: "text-amber-700 dark:text-amber-300", dialog: "amber" },
  bad: { chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", text: "text-rose-700 dark:text-rose-300", dialog: "rose" },
  muted: { chip: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300", text: "text-muted-foreground", dialog: "gold" },
};
const TONE_ICON = { ok: CircleCheck, wait: Clock, warn: TriangleAlert, bad: CircleX, muted: Clock } as const;
const FIXED_NOTES: readonly string[] = Object.values(WITHDRAWAL_NOTES);
const SELECT = "h-10 w-full rounded-xl border border-border bg-background px-2 text-sm";
const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "").slice(0, 10);
const grouped = (s: string) => (s ? Number(s).toLocaleString("en-US") : "");
/** One key per press of "See the price": pressed twice, it is still one request. */
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`);

/** A withdrawal's state, in words and a colour — never the colour alone. */
/** The state of a withdrawal; one made with nTZS's test key says so beside it. */
export function StatusChip({ status, test }: { status: WithdrawalStatusCode; test?: boolean }) {
  const t = useT();
  const s = WITHDRAWAL_STATUS[status];
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONE[s.tone].chip)}>{t(s.label)}</span>
      {test && <span className="text-[11px] whitespace-nowrap text-muted-foreground">{t("Test — no real money")}</span>}
    </span>
  );
}

function Line({ label, sub, value, strong }: { label: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{label}{sub && <span className="mt-0.5 block text-xs">{sub}</span>}</dt>
      <dd className={cn("shrink-0 text-right tabular-nums", strong && "text-base font-semibold")}>{value}</dd>
    </div>
  );
}

const KIND_ICON = { PHONE: Smartphone, LIPA: Store, BANK: Landmark } as const;

/** What the destination is ("Lipa number") and the number itself — from the whole text ("Lipa · 65562884") or the masked one ("Lipa •••• 0987"). */
function destinationParts(destination: string, kind: "PHONE" | "BANK" | "LIPA", t: (k: string) => string) {
  if (kind === "LIPA") return { label: t("Lipa number"), value: destination.replace(/^Lipa\s*·?\s*/, "") };
  if (kind === "PHONE") return { label: t("Phone number"), value: destination };
  // A bank: "CRDB Bank · 0150123456700" or masked "CRDB Bank •••• 6700" — the bank's name, then the account.
  const at = destination.search(/\s·\s|\s•/);
  return at > 0 ? { label: destination.slice(0, at), value: destination.slice(at).replace(/^\s·\s/, "").trim() } : { label: t("Bank account"), value: destination };
}

/** Who is paid — the name first and big (it is the thing to be sure of), then the number, then how much. */
function PayCard({ name, confirmed, kind, destination, amount, amountLabel, t }: {
  name: string | null; confirmed: boolean; kind: "PHONE" | "BANK" | "LIPA"; destination: string; amount: string; amountLabel: string; t: (k: string) => string;
}) {
  const Kind = KIND_ICON[kind];
  const d = destinationParts(destination, kind, t);
  return (
    <div className="overflow-hidden rounded-3xl border border-amber-500/30 bg-linear-to-br from-amber-500/[0.10] via-card to-card">
      <div className="flex items-start gap-4 px-5 pb-4 pt-5">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300 [&_svg]:size-6"><Kind /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("Paying")}</p>
          <p className="mt-0.5 break-words text-2xl font-bold leading-tight tracking-tight">
            {name ?? t("Name not confirmed")}
            {confirmed && name && <BadgeCheck className="ml-2 inline size-5 -translate-y-px text-emerald-500" aria-label={t("Name confirmed by the network")} />}
          </p>
          <p className="mt-1.5 text-sm"><span className="text-muted-foreground">{d.label}</span> <strong className="ml-1 tabular-nums">{d.value}</strong></p>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-amber-500/20 bg-background/40 px-5 py-3.5">
        <span className="text-sm text-muted-foreground">{amountLabel}</span>
        <span className="text-3xl font-bold tabular-nums tracking-tight">{amount}</span>
      </div>
    </div>
  );
}

/** How long a price still holds, counting down — a bar that empties and the minutes left. */
function PriceTimer({ until, label, ranOut }: { until: Date | string; label: string; ranOut: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(until).getTime() - Date.now()));
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [until]);
  if (left === null) return null;
  const mm = Math.floor(left / 60_000), ss = Math.floor((left % 60_000) / 1000);
  const low = left < 60_000;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground"><Timer className="size-3.5" />{left === 0 ? ranOut : label}</span>
        <span className={cn("font-semibold tabular-nums", low ? "text-amber-600 dark:text-amber-300" : "text-foreground")}>{mm}:{String(ss).padStart(2, "0")}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", low ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, (left / (5 * 60_000)) * 100)}%` }} /></div>
    </div>
  );
}

// ───────────────────────── Withdraw: the form → the check → what nTZS said ─────────────────────────

type Destination = { id: string; label: string; name: string | null; kind: "PHONE" | "BANK" | "LIPA" };
type Step = { at: "form" } | { at: "check"; price: WithdrawalPrice } | { at: "result"; view: WithdrawalView } | { at: "stopped"; message: string };

/**
 * The Withdraw funds button and its three steps. Nothing is sent until the person has seen nTZS's own price — who is
 * paid, the fee, what leaves the balance — and confirmed it. What is shown at the end is what nTZS answered: a
 * withdrawal that is only accepted is never shown as finished.
 */
export function WithdrawButton({ disabled, accounts, destinations, lastBooks, compact, available }: {
  /** What can be withdrawn now (the books' balance less what is on its way): the amount starts as all of it, and the person lowers it. */
  available?: number | null;
  disabled?: boolean; accounts: { id: string; name: string }[]; destinations: Destination[]; /** "owner", or a hotel account. */ lastBooks: string | null; timezone: string;
  /** Among a page's other actions (the nTZS account's page): an ordinary button, not the page's main one. */
  compact?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ at: "form" });
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const [amount, setAmount] = useState("");
  const [way, setWay] = useState<string>(destinations[0]?.id ?? "PHONE");
  const [phone, setPhone] = useState("");
  const [lipa, setLipa] = useState("");
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [books, setBooks] = useState(lastBooks && (lastBooks === "owner" || accounts.some((a) => a.id === lastBooks)) ? lastBooks : "");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [expired, setExpired] = useState(false);
  // The kind of the chosen way: typed (phone, Lipa, bank) or an earlier destination picked from the list — it decides the least and the most.
  const chosenKind = way === "PHONE" || way === "LIPA" || way === "BANK" ? way : destinations.find((d) => d.id === way)?.kind ?? "PHONE";
  const leastFor = (k: string) => (k === "LIPA" ? LIPA_MIN_TZS : WITHDRAW_MIN_TZS);
  /** All of what is available — except that a Lipa number takes less than TZS 1,000,000 at a time. */
  const allOf = (k: string) => (available == null ? null : k === "LIPA" ? Math.min(available, LIPA_BELOW_TZS - 1) : available);

  // The price holds for a few minutes — after that, sending is closed and the person prices it again.
  const holdsUntil = step.at === "check" ? step.price.view.quoteExpiresAt : null;
  useEffect(() => {
    if (!holdsUntil) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, new Date(holdsUntil).getTime() - 20_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [holdsUntil]);

  function begin() {
    setStep({ at: "form" }); setAmount((allOf(chosenKind) ?? 0) >= leastFor(chosenKind) ? String(allOf(chosenKind)) : ""); setNote(""); setErrors({}); setProblem(null); setChecked(false); setExpired(false);
    setKey(newKey());
    setOpen(true);
  }
  function close() {
    if (pending) return;
    // A price nobody confirmed is dropped (nothing was sent).
    if (step.at === "check") { const id = step.price.view.id; start(async () => { await cancelWithdrawalPriceAction({ id }).catch(() => null); }); }
    setOpen(false);
  }

  function price() {
    const e: Record<string, string> = {};
    const n = Number(amount);
    const kind = chosenKind;
    const least = kind === "LIPA" ? LIPA_MIN_TZS : WITHDRAW_MIN_TZS;
    if (!n) e.amount = t("Enter the amount.");
    else if (n < least) e.amount = t("The least is {amount}.", { amount: formatTZS(least) });
    else if (kind === "LIPA" && n >= LIPA_BELOW_TZS) e.amount = t("A Lipa number takes less than {amount} at a time, fee included.", { amount: formatTZS(LIPA_BELOW_TZS) });
    if (way === "PHONE" && !phone.trim()) e.phone = t("Enter the phone number.");
    if (way === "LIPA" && !lipa.trim()) e.payNumber = t("Enter the Lipa number.");
    if (way === "BANK" && !bank) e.bankCode = t("Choose the bank.");
    if (way === "BANK" && !account.trim()) e.accountNumber = t("Enter the account number.");
    if (!books) e.toAccountId = t("Choose one.");
    setErrors(e); setProblem(null);
    if (Object.keys(e).length) return;
    const destination = way === "PHONE" ? { kind: "PHONE" as const, phone } : way === "LIPA" ? { kind: "LIPA" as const, payNumber: lipa } : way === "BANK" ? { kind: "BANK" as const, bankCode: bank, accountNumber: account } : { kind: "AGAIN" as const, withdrawalId: way };
    start(async () => {
      try {
        const r = await priceWithdrawalAction({ amount: n, destination, toAccountId: books === "owner" ? null : books, note: note.trim() || null, clientKey: key });
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); setProblem(r.error); router.refresh(); return; }
        setChecked(false); setExpired(false);
        setStep({ at: "check", price: r.data });
      } catch {
        setProblem(t("The price could not be asked — nothing was sent. Check the connection and try again."));
      }
    });
  }

  function back() {
    if (step.at !== "check") return;
    const id = step.price.view.id;
    setKey(newKey()); setStep({ at: "form" }); setProblem(null);
    start(async () => { await cancelWithdrawalPriceAction({ id }).catch(() => null); });
  }

  function send() {
    if (step.at !== "check" || !checked || expired) return;
    const id = step.price.view.id;
    start(async () => {
      try {
        const r = await confirmWithdrawalAction({ id });
        router.refresh();
        setStep(r.ok ? { at: "result", view: r.data } : { at: "stopped", message: r.error });
      } catch {
        // The answer never reached this screen: nobody here knows whether it was sent.
        router.refresh();
        setStep({ at: "stopped", message: t("The answer did not reach this screen. Do not send it again — look at the withdrawals on this page first: they show what happened.") });
      }
    });
  }

  const booksLine = (id: string | null) => (id && id !== "owner" ? t("Goes to {account}", { account: accounts.find((a) => a.id === id)?.name ?? "" }) : t("The owner takes it out"));

  return (
    <>
      {compact
        ? <Button onClick={begin} disabled={disabled} variant="outline"><BanknoteArrowUp />{t("Withdraw funds")}</Button>
        : <Button onClick={begin} disabled={disabled} className="h-11 px-5 text-sm font-semibold"><BanknoteArrowUp />{t("Withdraw funds")}</Button>}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
          {step.at === "form" && (
            <>
              <DialogHeader icon={<BanknoteArrowUp />} eyebrow={t("Finance")} tone="emerald">
                <DialogTitle>{t("Withdraw funds")}</DialogTitle>
                <DialogDescription>{t("From the hotel's nTZS balance, to a phone, a Lipa number or a bank account.")}</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); price(); }}>
                <div className="space-y-1.5">
                  <Label htmlFor="wd-amount">{t("Amount the recipient gets (TZS)")}</Label>
                  <Input id="wd-amount" inputMode="numeric" autoComplete="off" value={grouped(amount)} onChange={(e) => setAmount(digits(e.target.value))} placeholder="0" className="h-12 text-lg font-semibold tabular-nums" />
                  {available != null && (
                    <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span><span className="text-muted-foreground">{t("Available to withdraw")}</span> <strong className="tabular-nums">{formatTZS(available)}</strong></span>
                      {(allOf(chosenKind) ?? 0) >= leastFor(chosenKind) && Number(amount) !== allOf(chosenKind) && <button type="button" onClick={() => setAmount(String(allOf(chosenKind)))} className="text-xs font-medium underline-offset-4 hover:underline">{t("Use all of it")}</button>}
                    </p>
                  )}
                  {available != null && Number(amount) > available && <p className="rounded-xl bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">{t("That is more than what is available — nTZS will refuse it if the money is not there.")}</p>}
                  <p className="text-xs text-muted-foreground">{t("nTZS adds its fee on top — you see it before anything is sent. If all of it is asked, lower the amount a little when nTZS says the fee does not fit.")}</p>
                  <FieldError message={errors.amount} />
                </div>

                <div className="space-y-1.5">
                  <Label>{t("Send to")}</Label>
                  <div className="grid gap-1.5">
                    {destinations.map((d) => (
                      <button key={d.id} type="button" onClick={() => setWay(d.id)} aria-pressed={way === d.id}
                        className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm", way === d.id ? "border-foreground bg-foreground/[0.04]" : "border-border hover:bg-muted")}>
                        {d.kind === "BANK" ? <Landmark className="size-4 shrink-0 text-muted-foreground" /> : d.kind === "LIPA" ? <Store className="size-4 shrink-0 text-muted-foreground" /> : <Smartphone className="size-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.name ?? d.label}</span>{d.name && <span className="block text-xs text-muted-foreground tabular-nums">{d.label}</span>}</span>
                        {way === d.id && <Check className="size-4 shrink-0" />}
                      </button>
                    ))}
                    <div className="grid grid-cols-3 gap-1.5">
                      {([["PHONE", destinations.length ? t("Another phone number") : t("Phone number"), Smartphone], ["LIPA", t("Lipa number"), Store], ["BANK", t("Bank account"), Landmark]] as const).map(([k, label, Icon]) => (
                        <button key={k} type="button" onClick={() => setWay(k)} aria-pressed={way === k}
                          className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center text-xs font-medium leading-tight", way === k ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                          <Icon className="size-3.5" />{label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <FieldError message={errors.destination} />
                  {way === "PHONE" && (
                    <div className="space-y-1.5 pt-1">
                      <Input id="wd-phone" type="tel" inputMode="tel" autoComplete="off" aria-label={t("Phone number")} value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 20))} placeholder="07XX XXX XXX" className="h-10 tabular-nums" />
                      <p className="text-xs text-muted-foreground">{t("A Tanzanian mobile-money number.")}</p>
                      <FieldError message={errors.phone} />
                    </div>
                  )}
                  {way === "LIPA" && (
                    <div className="space-y-1.5 pt-1">
                      <Input id="wd-lipa" inputMode="numeric" autoComplete="off" aria-label={t("Lipa number")} value={lipa} onChange={(e) => setLipa(e.target.value.replace(/[^\d\s]/g, "").slice(0, 16))} placeholder={t("Lipa number")} className="h-10 tabular-nums" />
                      <p className="text-xs text-muted-foreground">{t("A Lipa Namba (a till). nTZS finds its network by itself. It takes less than {amount} at a time, fee included.", { amount: formatTZS(LIPA_BELOW_TZS) })}</p>
                      <FieldError message={errors.payNumber} />
                    </div>
                  )}
                  {way === "BANK" && (
                    <div className="grid gap-2 pt-1 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <select aria-label={t("Bank")} value={bank} onChange={(e) => setBank(e.target.value)} className={SELECT}>
                          <option value="">{t("Choose the bank")}</option>
                          {WITHDRAW_BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                        </select>
                        <FieldError message={errors.bankCode} />
                      </div>
                      <div className="space-y-1.5">
                        <Input aria-label={t("Account number")} inputMode="numeric" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value.replace(/[^\d\s]/g, "").slice(0, 30))} placeholder={t("Account number")} className="h-10 tabular-nums" />
                        <FieldError message={errors.accountNumber} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wd-books">{t("In the hotel's books")}</Label>
                  <select id="wd-books" value={books} onChange={(e) => setBooks(e.target.value)} className={SELECT}>
                    <option value="">{t("Choose where this money goes")}</option>
                    <option value="owner">{t("The owner takes it out")}</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{t("It goes to {account}", { account: a.name })}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground">{t("A withdrawal is not income and not an expense — it only moves money. Only nTZS's fee is a cost.")}</p>
                  <FieldError message={errors.toAccountId} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wd-note">{t("Note (optional)")}</Label>
                  <Input id="wd-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} className="h-10" />
                </div>

                {problem && <p role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2 text-sm">{problem}</p>}
                <Button type="submit" className="h-11 w-full" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : null}{pending ? t("Asking nTZS for the price…") : t("See the price")}
                </Button>
                <p className="text-center text-xs text-muted-foreground">{t("Nothing is sent yet.")}</p>
              </form>
            </>
          )}

          {step.at === "check" && (() => {
            const v = step.price.view;
            const gets = step.price.receiveTzs ?? v.amount;
            const left = v.availableTzs !== null && v.debitedTzs !== null ? Math.max(0, v.availableTzs - v.debitedTzs) : null;
            return (
              <>
                <DialogHeader icon={<Send />} eyebrow={t("Check before you send")} tone="amber">
                  <DialogTitle>{t("Send {amount}?", { amount: formatTZS(gets) })}</DialogTitle>
                  <DialogDescription>{t("Read this once more. After you send it, it cannot be taken back.")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <PayCard name={v.recipientName} confirmed={!!v.recipientName} kind={v.destinationKind} destination={step.price.destination} amount={formatTZS(gets)} amountLabel={t("The recipient gets")} t={t} />
                  {!v.recipientName && (
                    <p className="flex gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />{t("nTZS could not confirm the name on this number. Check the number yourself, digit by digit, before you send.")}</p>
                  )}
                  <dl className="divide-y divide-border/60 px-1 text-sm">
                    <Line label={t("nTZS's fee")} sub={t("nTZS's price now — it confirms the real fee when it pays.")} value={v.feeTzs === null ? "—" : `+ ${formatTZS(v.feeTzs)}`} />
                    <Line label={t("Leaves the nTZS balance")} sub={left !== null ? t("About {amount} is left after this.", { amount: formatTZS(left) }) : undefined} value={v.debitedTzs === null ? "—" : formatTZS(v.debitedTzs)} strong />
                    <Line label={t("In the hotel's books")} value={booksLine(books)} />
                  </dl>
                  {gets !== v.amount && <p className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm">{t("You asked for {asked}, and nTZS says the recipient gets {gets}.", { asked: formatTZS(v.amount), gets: formatTZS(gets) })}</p>}
                  {v.needsApproval && <p className="rounded-2xl border border-sky-500/40 bg-sky-500/[0.06] px-3 py-2 text-sm">{t(WITHDRAWAL_STATUS.AWAITING_APPROVAL.hint)}</p>}
                  {expired
                    ? <p role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2 text-sm">{t("This price ran out — nothing was sent. Go back and ask for the price again.")}</p>
                    : v.quoteExpiresAt && <PriceTimer until={v.quoteExpiresAt} label={t("This price holds for")} ranOut={t("This price ran out")} />}
                  <NativeCheckbox checked={checked} disabled={pending || expired} onChange={(e) => setChecked(e.target.checked)} label={t("I checked the name, the number and the amount.")} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="h-12" onClick={back} disabled={pending}><ArrowLeft />{t("Back")}</Button>
                    <Button type="button" className="h-12 flex-1 text-base font-semibold" onClick={send} disabled={pending || !checked || expired}>
                      {pending ? <Loader2 className="animate-spin" /> : <Send />}{pending ? t("Sending to nTZS…") : t("Send {amount}", { amount: formatTZS(gets) })}
                    </Button>
                  </div>
                  {pending && <p className="text-center text-xs text-muted-foreground">{t("Keep this page open — this can take up to half a minute.")}</p>}
                </div>
              </>
            );
          })()}

          {step.at === "result" && (() => {
            const v = step.view;
            const s = WITHDRAWAL_STATUS[v.status];
            const Icon = TONE_ICON[s.tone];
            const why = v.status === "REJECTED" || v.status === "CANCELLED" ? withdrawalProblem(v.failureCode, v.destinationKind) : null;
            return (
              <>
                <DialogHeader icon={<Icon />} eyebrow={v.number ?? t("Withdrawal")} tone={TONE[s.tone].dialog}>
                  <DialogTitle>{t(s.label)}</DialogTitle>
                  <DialogDescription>{t(s.hint)}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {why && <p className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2 text-sm">{t(why)}</p>}
                  {v.attention.map((n) => <p key={n} className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm">{t(n)}</p>)}
                  <PayCard name={v.recipientName} confirmed={!!v.recipientName} kind={v.destinationKind} destination={v.destination} amount={formatTZS(v.amount)} amountLabel={t("Amount")} t={t} />
                  {v.status !== "COMPLETED" && v.status !== "REJECTED" && v.status !== "CANCELLED" && <p className="text-sm text-muted-foreground">{t("You can close this — the page follows it by itself and shows its state when nTZS reports.")}</p>}
                  <Button type="button" className="h-11 w-full" onClick={() => setOpen(false)}>{t("Close")}</Button>
                </div>
              </>
            );
          })()}

          {step.at === "stopped" && (
            <>
              <DialogHeader icon={<TriangleAlert />} eyebrow={t("Withdraw funds")} tone="amber">
                <DialogTitle>{t("It did not go through here")}</DialogTitle>
                <DialogDescription>{t("Read what happened before you try again.")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <p role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm">{step.message}</p>
                <Button type="button" className="h-11 w-full" onClick={() => setOpen(false)}>{t("Close and look at the withdrawals")}</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────── One withdrawal: everything about it, and what a person can do ─────────────────────────

type Detail = { view: WithdrawalView; history: WithdrawalHistoryLine[]; at: number };

/** Opens one withdrawal right where it is listed: its state, its figures, its history — and the few things a person may do. */
export function WithdrawalDetails({ id, label, timezone, className }: { id: string; label: string; timezone: string; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [settling, setSettling] = useState(false);
  const [outcome, setOutcome] = useState<"ARRIVED" | "NOT_SENT" | "">("");
  const [reference, setReference] = useState("");
  const [how, setHow] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function load() {
    try {
      const r = await withdrawalDetailAction({ id });
      if (!r.ok) { setFailed(r.error); return; }
      setFailed(null); setDetail({ ...r.data, at: Date.now() });
    } catch {
      setFailed(t("This could not be opened. Close it and try again."));
    }
  }
  function show() {
    setDetail(null); setFailed(null); setSettling(false); setOutcome(""); setReference(""); setHow(""); setErrors({});
    setOpen(true);
    start(load);
  }
  function ask() {
    start(async () => {
      try {
        const r = await checkWithdrawalAction({ id });
        if (r.ok) toast.info(t("nTZS says: {state}", { state: t(WITHDRAWAL_STATUS[r.data.status].label) })); else toast.error(r.error);
      } catch { toast.error(t("nTZS could not be asked just now. Try again in a moment.")); }
      await load();
      router.refresh();
    });
  }
  function seen() {
    start(async () => {
      const r = await acknowledgeWithdrawalAction({ id }).catch(() => null);
      if (r && !r.ok) toast.error(r.error);
      await load();
      router.refresh();
    });
  }
  function settle() {
    const e: Record<string, string> = {};
    if (!outcome) e.outcome = t("Choose one.");
    if (outcome === "ARRIVED" && reference.trim().length < 4) e.reference = t("Enter nTZS's own reference for this payout.");
    if (how.trim().length < 5) e.note = t("Say how you know — what nTZS shows or told you.");
    setErrors(e);
    if (!outcome || Object.keys(e).length) return;
    start(async () => {
      try {
        const r = await settleWithdrawalAction({ id, outcome, reference: reference.trim() || null, note: how.trim() });
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
        toast.success(t("Settled — recorded under your name."));
        setSettling(false);
      } catch { toast.error(t("That did not go through. Try again.")); }
      await load();
      router.refresh();
    });
  }

  const v = detail?.view;
  const s = v ? WITHDRAWAL_STATUS[v.status] : null;
  const moved = !!v && !["REJECTED", "CANCELLED", "QUOTED"].includes(v.status);
  const waitUntil = v?.checkAfter && detail && new Date(v.checkAfter).getTime() > detail.at ? v.checkAfter : null;
  const why = v && v.failureCode && v.status !== "COMPLETED" ? withdrawalProblem(v.failureCode, v.destinationKind) : null;
  // A payout nTZS turned back: the line under the state already says it — only nTZS's own words are added.
  const said = v?.status === "FAILED" && v.failureCode === "payout_failed";
  const when = (d: Date | null | undefined) => (d ? t.dateTime(d, timezone) : "—");

  return (
    <>
      <button type="button" onClick={show} className={cn("font-medium underline-offset-4 hover:underline", className)}>{label}</button>
      <Dialog open={open} onOpenChange={(o) => { if (!pending || !o) setOpen(o); }}>
        <DialogContent className="sm:max-w-lg">
          {!v || !s ? (
            <>
              <DialogHeader><DialogTitle>{t("Withdrawal")}</DialogTitle><DialogDescription>{failed ?? t("Opening…")}</DialogDescription></DialogHeader>
              {!failed && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
            </>
          ) : (
            <>
              <DialogHeader icon={<BanknoteArrowUp />} eyebrow={v.number ?? t("Withdrawal")} tone={TONE[s.tone].dialog}>
                <DialogTitle>{formatTZS(v.amount)}</DialogTitle>
                <DialogDescription>{v.recipientName ? `${v.recipientName} · ${v.destination}` : v.destination}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <StatusChip status={v.status} test={v.test} />
                  <p className="mt-1.5 text-sm text-muted-foreground">{t(s.hint)}</p>
                </div>
                {v.attention.map((n) => <p key={n} className="flex gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />{t(n)}</p>)}
                {why && (!said || v.failureReason) && <p className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2 text-sm">{!said && t(why)}{v.failureReason && <span className={cn("block text-xs text-muted-foreground", !said && "mt-1")}>{t("nTZS's own words: {words}", { words: v.failureReason })}</span>}</p>}

                <dl className="divide-y divide-border/60 text-sm">
                  <Line label={t("Asked for")} sub={t("What the recipient was to get")} value={formatTZS(v.amount)} strong />
                  {moved && v.status !== "FAILED" && v.feeTzs !== null && <Line label={t("nTZS's fee")} sub={v.feeConfirmed ? t("Confirmed by nTZS") : t("nTZS's estimate — not confirmed yet")} value={formatTZS(v.feeTzs)} />}
                  {moved && v.status !== "FAILED" && v.debitedTzs !== null && <Line label={v.status === "COMPLETED" ? t("Left the nTZS balance") : t("Leaves the nTZS balance")} sub={v.status === "COMPLETED" && v.feeConfirmed ? undefined : t("An estimate until nTZS confirms")} value={formatTZS(v.debitedTzs)} />}
                  {v.receivedTzs !== null && v.status === "COMPLETED" && <Line label={t("Arrived")} sub={t("Confirmed by nTZS")} value={formatTZS(v.receivedTzs)} strong />}
                  <Line label={t("In the hotel's books")} sub={v.booked ? t("Recorded") : moved && v.status !== "FAILED" ? t("Recorded only when nTZS confirms the money arrived") : t("Nothing recorded — no money moved")} value={v.books ? t("Goes to {account}", { account: v.books }) : t("The owner takes it out")} />
                  <Line label={t("Asked by")} value={<>{v.requestedBy}<span className="block text-xs text-muted-foreground">{when(v.createdAt)}</span></>} />
                  {v.submittedAt && <Line label={t("Sent to nTZS")} value={when(v.submittedAt)} />}
                  {v.completedAt && <Line label={t("Completed")} value={when(v.completedAt)} />}
                  {v.failedAt && <Line label={v.status === "REJECTED" ? t("Refused") : t("Failed")} value={when(v.failedAt)} />}
                  {v.providerId && <Line label={t("nTZS reference")} value={<span className="font-mono text-xs break-all">{v.providerId}</span>} />}
                  {v.payoutReference && <Line label={t("Payout reference")} value={<span className="font-mono text-xs break-all">{v.payoutReference}</span>} />}
                  {v.note && <Line label={t("Note")} value={<span className="whitespace-pre-wrap">{v.note}</span>} />}
                  {v.reconciled && <Line label={t("Settled by hand")} sub={v.reconciled.note} value={<>{v.reconciled.by}<span className="block text-xs text-muted-foreground">{when(v.reconciled.at)}</span></>} />}
                </dl>

                {(v.canCheck || v.canSettle || v.canAcknowledge) && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {v.canCheck && <Button type="button" variant="outline" size="sm" onClick={ask} disabled={pending || !!waitUntil}>{pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t("Ask nTZS now")}</Button>}
                      {v.canAcknowledge && <Button type="button" variant="outline" size="sm" onClick={seen} disabled={pending}><Check />{t("I have seen this")}</Button>}
                      {v.canSettle && !settling && <Button type="button" variant="outline" size="sm" onClick={() => setSettling(true)} disabled={pending}>{t("Settle by hand")}</Button>}
                    </div>
                    {v.canCheck && waitUntil && <p className="text-xs text-muted-foreground">{t("nTZS can be asked again after {time} — its own report may arrive before that.", { time: t.time(waitUntil, timezone) })}</p>}
                    {v.lastCheckedAt && <p className="text-xs text-muted-foreground">{t("Last asked {when}", { when: when(v.lastCheckedAt) })}</p>}
                  </div>
                )}

                {v.canSettle && settling && (
                  <div className="space-y-3 rounded-2xl border border-border/70 p-3">
                    <p className="text-sm font-semibold">{t("Settle by hand")}</p>
                    <p className="text-xs text-muted-foreground">{t("Only after you have checked at nTZS itself. It is recorded under your name and cannot be undone here.")}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {([["ARRIVED", t("The money arrived")], ["NOT_SENT", t("It was never sent")]] as const).map(([k, text]) => (
                        <button key={k} type="button" onClick={() => setOutcome(k)} aria-pressed={outcome === k}
                          className={cn("rounded-xl border px-2 py-2 text-xs font-medium", outcome === k ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{text}</button>
                      ))}
                    </div>
                    <FieldError message={errors.outcome} />
                    {outcome === "ARRIVED" && (
                      <div className="space-y-1.5"><Label htmlFor={`wd-ref-${id}`}>{t("nTZS's reference for this payout")}</Label><Input id={`wd-ref-${id}`} value={reference} onChange={(e) => setReference(e.target.value.slice(0, 80))} className="h-10" /><FieldError message={errors.reference} /></div>
                    )}
                    <div className="space-y-1.5"><Label htmlFor={`wd-how-${id}`}>{t("How do you know?")}</Label><Textarea id={`wd-how-${id}`} rows={2} value={how} onChange={(e) => setHow(e.target.value.slice(0, 500))} placeholder={t("e.g. what nTZS shows, or who at nTZS told you")} /><FieldError message={errors.note} /></div>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSettling(false)} disabled={pending}>{t("Cancel")}</Button>
                      <Button type="button" size="sm" onClick={settle} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null}{t("Settle it")}</Button>
                    </div>
                  </div>
                )}

                {detail.history.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("What happened")}</p>
                    <ol className="mt-2 space-y-2 text-sm">
                      {detail.history.map((h, i) => {
                        const to = h.to && h.to in WITHDRAWAL_STATUS ? t(WITHDRAWAL_STATUS[h.to as WithdrawalStatusCode].label) : null;
                        return (
                          <li key={i} className="flex gap-3">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                            <span className="min-w-0">
                              <span className="block">{h.action in WITHDRAWAL_EVENTS ? t(WITHDRAWAL_EVENTS[h.action]) : h.action}{to && <span className="text-muted-foreground"> — {to}</span>}</span>
                              {h.note && <span className="block text-xs text-muted-foreground">{FIXED_NOTES.includes(h.note) ? t(h.note) : h.note}</span>}
                              <span className="block text-xs text-muted-foreground">{when(h.at)}{h.by ? ` · ${h.by}` : ""}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "Check balance": asks nTZS what is available now. Nothing moves. nTZS tells its balance only with a price, and a price needs a place to pay to:
 * when no withdrawal was ever priced (`needsPhone`), the person gives a phone number to ask with — it is used for the question only.
 */
export function CheckBalanceButton({ needsPhone = false }: { needsPhone?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The page may have been drawn when a destination still existed: if the server now needs a number, the same question is asked here.
  const [forced, setForced] = useState(false);
  const askForPhone = needsPhone || forced;
  const ask = (withPhone?: string) => start(async () => {
    setError(null);
    const r = await checkNtzsBalanceAction(withPhone ? { phone: withPhone } : undefined).catch(() => null);
    if (!r) { toast.error(t("nTZS did not answer — try again in a moment.")); return; }
    if (!r.ok) {
      if (!askForPhone && r.fieldErrors?.phone) { setForced(true); setOpen(true); router.refresh(); return; }
      if (askForPhone) setError(r.error); else toast.error(r.error);
      return;
    }
    toast.success(t("nTZS reports {amount} available.", { amount: formatTZS(r.data.availableTzs) }));
    setOpen(false);
    router.refresh();
  });
  return (
    <>
      <button type="button" disabled={pending} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap underline-offset-4 hover:underline disabled:opacity-60"
        onClick={() => (askForPhone ? setOpen(true) : ask())}>
        {pending && !open ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}{t("Check balance")}
      </button>
      {askForPhone && (
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader icon={<RefreshCw />} eyebrow={t("nTZS")} tone="sky">
              <DialogTitle>{t("Check the nTZS balance")}</DialogTitle>
              <DialogDescription>{t("nTZS tells its balance only together with a price, and a price needs a phone number to ask about. Give any mobile-money number (yours is fine). Nothing is sent to it, and it is not kept as a place to pay to.")}</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); ask(phone); }}>
              <div className="space-y-1.5">
                <Label htmlFor="bal-phone">{t("Phone number")}</Label>
                <Input id="bal-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" placeholder="07xx xxx xxx" className="h-11 text-base" />
                {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={pending || !phone.trim()}>{pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t("Ask nTZS for the balance")}</Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
