import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatTZS } from "@/lib/format";
import { unitOf } from "@/lib/inventory";
import { boughtQty, num, type StockLineView } from "@/lib/stock-requests";
import { useT } from "@/i18n/client";

/**
 * A request's lines: asked · approved · bought — and, for buyers and approvers only, the price and
 * the total. Each line says which stock item it is, or that it is not kept in stock.
 */
export function LinesTable({ lines, money }: { lines: StockLineView[]; money: boolean }) {
  const t = useT();
  const showBought = lines.some((l) => l.purchasedQty != null);
  const showMoney = money && showBought;
  const total = lines.reduce((sum, l) => sum + ((l.purchasedQty ?? 0) > 0 ? l.lineTotal ?? 0 : 0), 0);
  const head = "pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className={cn("w-full text-sm", showMoney ? "min-w-[560px]" : showBought ? "min-w-[420px]" : "min-w-[300px]")}>
        <thead>
          <tr className="border-b border-border/70 text-left">
            <th className={head}>{t("Item")}</th>
            <th className={cn(head, "text-right")}>{t("Asked")}</th>
            <th className={cn(head, "text-right")}>{t("Approved")}</th>
            {showBought && <th className={cn(head, "text-right")}>{t("Bought")}</th>}
            {showMoney && <th className={cn(head, "text-right")}>{t("Price")}</th>}
            {showMoney && <th className={cn(head, "text-right")}>{t("Total")}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {lines.map((l) => {
            const changed = l.approvedQty != null && l.approvedQty !== l.quantity;
            const none = l.purchasedQty === 0;
            return (
              <tr key={l.id} className="align-top">
                <td className="py-2 pr-3">
                  <p className="font-medium">{t(l.name)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {l.stockItem ? t("Stock item: {name} ({unit})", { name: t(l.stockItem.name), unit: t(unitOf(l.stockItem.unit).label) }) : t("Not kept in stock")}
                    {l.received && <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-emerald-600 dark:text-emerald-300"><Check className="size-3" />{t("in stock")}</span>}
                  </p>
                  {l.note && <p className="text-[11px] italic text-muted-foreground">“{l.note}”</p>}
                </td>
                <td className="whitespace-nowrap py-2 text-right tabular-nums">{num(l.quantity)} <span className="text-muted-foreground">{t(l.unit)}</span></td>
                <td className={cn("whitespace-nowrap py-2 pl-3 text-right tabular-nums", changed ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  {l.approvedQty != null ? `${num(l.approvedQty)} ${t(l.unit)}` : "—"}
                </td>
                {showBought && (
                  <td className={cn("whitespace-nowrap py-2 pl-3 text-right tabular-nums", none ? "text-muted-foreground" : "font-semibold")}>
                    {l.purchasedQty == null ? "—" : none ? t("Not bought") : boughtQty(l, t)}
                  </td>
                )}
                {showMoney && <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums text-muted-foreground">{!none && l.unitPrice != null ? formatNumber(l.unitPrice) : "—"}</td>}
                {showMoney && <td className="whitespace-nowrap py-2 pl-3 text-right font-semibold tabular-nums">{!none && l.lineTotal != null ? formatNumber(l.lineTotal) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
        {showMoney && (
          <tfoot>
            <tr className="border-t-2 border-border">
              <td colSpan={5} className="pt-2 text-right text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Total paid")}</td>
              <td className="whitespace-nowrap pl-3 pt-2 text-right text-base font-semibold tabular-nums">{formatTZS(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
