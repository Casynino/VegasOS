import { cn } from "@/lib/utils";

/**
 * The mobile-money networks a "Pay now" prompt reaches — small marks in each network's own colours (names, not logos),
 * shown wherever a customer pays: the checkout, the order and bill pages, the payment page, the website.
 */
const MARKS: { key: string; label: string; className: string; body: React.ReactNode }[] = [
  {
    key: "mpesa", label: "M-Pesa", className: "bg-[#e60000] text-white",
    body: <><span aria-hidden className="size-[6px] rounded-full bg-[#7ab800] ring-1 ring-white/70" />m-pesa</>,
  },
  { key: "airtel", label: "Airtel Money", className: "bg-white text-[#e40000] ring-1 ring-black/[0.07]", body: <>airtel</> },
  {
    key: "mixx", label: "Mixx by Yas", className: "bg-[#0b2a7a] text-[#ffd100]",
    body: <><span className="italic">mixx</span><span className="text-[7px] font-semibold not-italic text-white/85">by yas</span></>,
  },
  { key: "halopesa", label: "HaloPesa", className: "bg-[#f15a22] text-white", body: <>halopesa</> },
];

export function NetworkMarks({ className, label = "Works with", dark = false, center = false, compact = false }: { className?: string; label?: string | null; dark?: boolean; center?: boolean; /** Tighter, for inside a row. */ compact?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", center && "justify-center", className)}>
      {label && <span className={cn("mr-0.5 text-[10.5px] font-medium", dark ? "text-white/55" : "text-[#8a7f72]")}>{label}</span>}
      <ul className={cn("flex flex-wrap items-center", compact ? "gap-[3px]" : "gap-1")} aria-label="Mobile-money networks">
        {MARKS.map((m) => (
          <li key={m.key} title={m.label} aria-label={m.label}
            className={cn("inline-flex items-center gap-[3px] font-extrabold lowercase leading-none tracking-tight shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
              compact ? "h-[17px] rounded-[5px] px-[5px] text-[9px]" : "h-[20px] rounded-[6px] px-1.5 text-[10px]", m.className)}>
            {m.body}
          </li>
        ))}
      </ul>
    </div>
  );
}
