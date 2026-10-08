import { Languages } from "lucide-react";
import { hasCjk, type Locale } from "@/i18n/config";
import { requestLabel } from "@/lib/order-requests";
import { cn } from "@/lib/utils";

type Tr = { (key: string, vars?: Record<string, string | number | null | undefined>): string; locale: Locale };

/** Google Translate for a customer's own words — opened only when someone taps it; the original stays the source of truth. */
export const translateHref = (text: string) => `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(text)}`;

const TONE = {
  /** Board / kitchen / waiter cards (light and dark staff theme). */
  card: {
    box: "rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-900 dark:text-amber-200",
    chip: "rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-950 dark:text-amber-100",
    label: "text-[9.5px] font-semibold uppercase tracking-[0.14em] text-amber-800/70 dark:text-amber-200/60",
    tag: "rounded-full bg-sky-500/15 px-1.5 py-px text-[9.5px] font-semibold normal-case tracking-normal text-sky-800 dark:text-sky-200",
    link: "font-semibold text-sky-700 underline-offset-2 hover:underline dark:text-sky-300",
  },
  /** The order sheet (dark). */
  sheet: {
    box: "rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/20",
    chip: "rounded-full bg-amber-500/20 px-2 py-0.5 text-[11.5px] font-semibold text-amber-100",
    label: "text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/60",
    tag: "rounded-full bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold normal-case tracking-normal text-sky-200",
    link: "font-semibold text-sky-300 underline-offset-2 hover:underline",
  },
  /** Printed slips: black on white, no colour needed. */
  print: {
    box: "mt-1 border border-black px-1.5 py-1 text-[11px] text-black",
    chip: "border border-black px-1 font-bold",
    label: "text-[9px] font-semibold uppercase tracking-wider",
    tag: "border border-black px-1 text-[9px] normal-case tracking-normal",
    link: "",
  },
} as const;

/**
 * What the customer asked for, for staff: the requests they ticked (codes — shown in the STAFF person's own language),
 * then their own words exactly as typed under "Customer's note". Words written in Chinese, read by someone who is not
 * reading in Chinese, get a small "Written in Chinese" tag and a "Translate" link (opened only when tapped).
 * Works on the server (slips, `await getT()`) and in the browser (`useT()`): pass the translator.
 */
export function OrderNote({ codes, notes, t, tone = "card", className }: {
  codes?: readonly string[] | null; notes?: string | null; t: Tr; tone?: keyof typeof TONE; className?: string;
}) {
  const asks = codes ?? [];
  const words = notes?.trim() ? notes : null;
  if (!asks.length && !words) return null;
  const s = TONE[tone];
  const foreign = !!words && hasCjk(words) && t.locale !== "zh-CN";
  return (
    <div className={cn(s.box, "space-y-1", className)}>
      {asks.length > 0 && (
        <ul aria-label={t("Requests")} className="flex flex-wrap gap-1">
          {asks.map((c) => <li key={c} className={s.chip}>{t(requestLabel(c))}</li>)}
        </ul>
      )}
      {words && (
        <div>
          <p className={cn(s.label, "flex flex-wrap items-center gap-1.5")}>
            {t("Customer's note")}
            {foreign && <span className={s.tag}>{t("Written in Chinese")}</span>}
          </p>
          <p className="whitespace-pre-line break-words font-medium" lang={hasCjk(words) ? "zh-CN" : undefined}>“{words}”</p>
          {foreign && tone !== "print" && (
            <a href={translateHref(words)} target="_blank" rel="noopener noreferrer" className={cn(s.link, "mt-0.5 inline-flex items-center gap-1")}>
              <Languages className="size-3" aria-hidden="true" />{t("Translate")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** The requests a customer ticked, in their own language (their tracking page / receipt). */
export function RequestList({ codes, t, className, chipClass }: { codes?: readonly string[] | null; t: Tr; className?: string; chipClass?: string }) {
  if (!codes?.length) return null;
  return (
    <ul aria-label={t("Your requests")} className={cn("flex flex-wrap gap-1.5", className)}>
      {codes.map((c) => <li key={c} className={chipClass}>{t(requestLabel(c))}</li>)}
    </ul>
  );
}
