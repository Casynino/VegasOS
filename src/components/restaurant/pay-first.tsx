"use client";

import { useRef, useState } from "react";
import { Check, Copy, ImagePlus, Landmark, Loader2, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadPaymentProofAction } from "@/app/order/actions";

/** An account customers can pay into (mobile money or bank — never cash). */
export type PayOption = { id: string; name: string; kind: string; number: string | null; holder: string | null };
export type PayFirstValue = { accountId: string | null; proofId: string | null; reference: string; confirmed: boolean };
export const NO_PAYMENT: PayFirstValue = { accountId: null, proofId: null, reference: "", confirmed: false };
export const payFirstReady = (v: PayFirstValue) => !!(v.accountId && v.proofId && v.confirmed);

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;

/** A phone photo is big: send a smaller JPEG (a screenshot stays sharp at 1600 px). */
async function shrink(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = document.createElement("img"); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 1_500_000 && /jpeg|png|webp/.test(file.type)) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    return blob ? new File([blob], "payment.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // the server says if it cannot take it
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Take out is paid first: where to pay (tap to copy the number), the payment code, a screenshot of
 * the payment and "I have paid" — only then can the order be placed. It is recorded as paid with the order;
 * staff only say "Payment not received" if it never reaches the account.
 */
export function PayFirst({ total, accounts, value, onChange }: { total: number; accounts: PayOption[]; value: PayFirstValue; onChange: (v: PayFirstValue) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const add = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setUploading(true);
    try {
      const small = await shrink(f);
      const fd = new FormData();
      fd.append("file", small);
      const res = await uploadPaymentProofAction(fd);
      if (!res.ok) { setError(res.error); return; }
      setPreview(URL.createObjectURL(small));
      onChange({ ...value, proofId: res.data.id });
    } catch {
      setError("The screenshot could not be sent — please try again.");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };
  const copy = (a: PayOption) => {
    if (!a.number) return;
    navigator.clipboard?.writeText(a.number).then(() => { setCopied(a.id); setTimeout(() => setCopied(null), 1600); }).catch(() => {});
  };

  if (!accounts.length) {
    return <p className="rounded-2xl bg-amber-50 p-3.5 text-[13px] text-amber-900 ring-1 ring-amber-200">Paying now needs our payment numbers, which are not set up yet — please pay after, or call us.</p>;
  }
  return (
    <section aria-label="Pay first" className="rounded-2xl bg-(--vr-bg) p-3.5 ring-1 ring-(--vr-gold)/45">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-semibold">Pay first</p>
        <p className="text-[16px] font-semibold tabular-nums">{tzs(total)}</p>
      </div>
      <p className="mt-0.5 text-[12px] leading-snug text-(--vr-muted)">Send {tzs(total)} to one of these, then add a screenshot of the payment — your order starts right away.</p>

      <ul className="mt-3 space-y-2">
        {accounts.map((a) => {
          const on = value.accountId === a.id;
          const Icon = a.kind === "BANK" ? Landmark : Smartphone;
          return (
            <li key={a.id} className={cn("flex items-center gap-2 rounded-xl bg-white p-2 ring-1 transition", on ? "ring-2 ring-(--vr-dark)" : "ring-(--vr-line)")}>
              <button type="button" onClick={() => onChange({ ...value, accountId: a.id })} aria-pressed={on} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", on ? "bg-(--vr-dark) text-(--vr-gold)" : "bg-(--vr-gold-soft) text-(--vr-gold-ink)")}>{on ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-semibold">{a.name}</span>
                  <span className="block truncate font-mono text-[14px] font-semibold tracking-wide">{a.number}</span>
                  {a.holder && <span className="block truncate text-[11px] text-(--vr-muted)">{a.holder}</span>}
                </span>
              </button>
              <button type="button" onClick={() => copy(a)} aria-label={`Copy ${a.name} number`}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold ring-1 ring-(--vr-line) hover:ring-(--vr-gold)">
                {copied === a.id ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}{copied === a.id ? "Copied" : "Copy"}
              </button>
            </li>
          );
        })}
      </ul>

      <label className="mt-3 block text-[12.5px] font-medium text-(--vr-ink)/80">Payment code <span className="font-normal text-(--vr-muted)">· from the SMS, optional</span>
        <input value={value.reference} onChange={(e) => onChange({ ...value, reference: e.target.value })} maxLength={60} placeholder="e.g. SGH4K2L9PQ"
          className="mt-1 block h-11 w-full rounded-xl border border-(--vr-line) bg-white px-3.5 font-mono text-[16px] uppercase outline-none transition placeholder:normal-case placeholder:text-(--vr-muted)/70 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15 sm:text-[14px]" />
      </label>

      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => add(e.target.files?.[0])} />
      {value.proofId && preview ? (
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-2 ring-1 ring-emerald-300">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your payment screenshot" className="h-16 w-12 shrink-0 rounded-lg object-cover" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700"><Check className="size-4" strokeWidth={3} />Screenshot added</span>
            <span className="text-[11.5px] text-(--vr-muted)">Your order starts right away.</span>
          </span>
          <button type="button" onClick={() => file.current?.click()} disabled={uploading} className="h-8 shrink-0 rounded-full px-3 text-[12px] font-medium ring-1 ring-(--vr-line) hover:ring-(--vr-gold)">Change</button>
        </div>
      ) : (
        <button type="button" onClick={() => file.current?.click()} disabled={uploading}
          className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--vr-gold)/60 bg-white text-[13.5px] font-semibold text-(--vr-gold-ink) transition hover:border-(--vr-gold) disabled:opacity-70">
          {uploading ? <><Loader2 className="size-4 animate-spin" />Adding the screenshot…</> : <><ImagePlus className="size-5" />Add payment screenshot</>}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{error}</p>}

      <button type="button" onClick={() => onChange({ ...value, confirmed: !value.confirmed })} aria-pressed={value.confirmed}
        className="mt-3 flex w-full items-start gap-2.5 text-left">
        <span className={cn("mt-px grid size-5 shrink-0 place-items-center rounded-md border-2 transition", value.confirmed ? "border-(--vr-dark) bg-(--vr-dark) text-(--vr-gold)" : "border-(--vr-muted)/50 bg-white")}>
          {value.confirmed && <Check className="size-3.5" strokeWidth={3.5} />}
        </span>
        <span className="text-[13px] leading-snug"><span className="font-semibold">I have paid {tzs(total)}</span>{value.accountId ? ` to ${accounts.find((a) => a.id === value.accountId)?.name ?? "your account"}` : ""}.</span>
      </button>
    </section>
  );
}
