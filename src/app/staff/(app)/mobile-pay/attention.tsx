"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Smartphone } from "lucide-react";
import { resolveMobileAttentionAction } from "./actions";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";

export type AttentionRow = {
  id: string; amount: number; phone: string; purpose: string; note: string | null; at: string;
  where: string; by: string; reference: string | null; href: string | null;
};

/**
 * MOBILE MONEY TO CHECK — money that came in by an nTZS prompt but needs a person: more than was owed, the bill changed,
 * or it could not be recorded. Stays here until someone says what they did.
 */
export function MobileMoneyAttention({ rows }: { rows: AttentionRow[] }) {
  const t = useT();
  if (!rows.length) return null;
  return (
    <section id="ntzs" className="scroll-mt-24 rounded-3xl border border-amber-500/40 bg-amber-500/[0.06] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold"><AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />{t("Mobile money to check")} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("Mobile money (nTZS) that came in but did not fit the bill. Refund it, record it by hand or put it on the right bill — then say what you did.")}</p>
      <ul className="mt-3 space-y-2">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>
    </section>
  );
}

/**
 * What the money was for, as the service says it in English ("Booking VLH-…", "Order #19", "Restaurant") — in the
 * reader's words. Only the last part is the "what" (before it: the customer's name, shown as it is).
 */
function whereLabel(t: T, where: string): string {
  const parts = where.split(" · ");
  const v = parts.pop() ?? "";
  let m: RegExpMatchArray | null;
  const what = (m = v.match(/^Orders? (#\d+(?:, #\d+)*)$/)) ? (m[1].includes(",") ? t("Orders {numbers}", { numbers: m[1] }) : t("Order {number}", { number: m[1] }))
    : (m = v.match(/^Booking (\S+)$/)) ? t("Booking {reference}", { reference: m[1] })
    : (m = v.match(/^Meeting room (\S+)$/)) ? t("Meeting room {reference}", { reference: m[1] })
    : (m = v.match(/^Invoice (\S+)$/)) ? t("Invoice {number}", { number: m[1] })
    : (m = v.match(/^Trip (\S+)$/)) ? t("Trip {reference}", { reference: m[1] })
    : t(v);
  return [...parts, what].join(" · ");
}

function Row({ r }: { r: AttentionRow }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <li className="rounded-2xl border border-border/70 bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500/12 text-sky-600 dark:text-sky-300"><Smartphone className="size-4" /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-semibold">TZS {r.amount.toLocaleString("en-US")} · {whereLabel(t, r.where)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{r.note ?? t("Needs checking.")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{r.phone} · {t("sent by {name}", { name: r.by === "the customer (online)" ? t("the customer (online)") : r.by })} · {new Date(r.at).toLocaleString(t.intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{r.reference ? ` · ${t("Ref {reference}", { reference: r.reference })}` : ""}{r.href && <> · <a href={r.href} className="font-medium underline underline-offset-2">{t("open")}</a></>}</p>
        </div>
        {!open && <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 ring-border hover:bg-muted">{t("Dealt with")}</button>}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("What was done — e.g. refunded to the guest by M-Pesa")} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none" />
          <button type="button" disabled={pending || note.trim().length < 3} onClick={() => start(async () => {
            const res = await resolveMobileAttentionAction({ id: r.id, note });
            if (res.ok) { toast.success(res.message ?? t("Marked as dealt with.")); router.refresh(); } else toast.error(res.error);
          })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-60">{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{t("Done")}</button>
        </div>
      )}
    </li>
  );
}
