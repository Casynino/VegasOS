"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/i18n/client";
import { createManualInvoiceAction } from "../actions";

type Line = { key: number; description: string; quantity: number; unitAmount: number; discountAmount: number };

export function ManualInvoiceForm({ companies, defaultCompanyId }: { companies: { id: string; companyName: string }[]; defaultCompanyId: string }) {
  const t = useT();
  const [company, setCompany] = useState(defaultCompanyId);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: "", quantity: 1, unitAmount: 0, discountAmount: 0 }]);
  const [pending, start] = useTransition();
  const set = (k: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const total = lines.reduce((s, l) => s + l.quantity * l.unitAmount - l.discountAmount, 0);

  return (
    <Card><CardContent className="space-y-4">
      <div className="space-y-1"><Label htmlFor="co">{t("Company")}</Label>
        <NativeSelect id="co" value={company} onChange={(e) => setCompany(e.target.value)}><option value="">{t("Choose…")}</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</NativeSelect></div>
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.key} className="grid items-end gap-2 sm:grid-cols-[1fr_70px_130px_110px_auto]">
            <div className="space-y-1"><Label className="text-xs">{t("Description")}</Label><Input value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} placeholder={t("e.g. Meeting Room 32 — full day, 12 Oct")} /></div>
            <div className="space-y-1"><Label className="text-xs">{t("Qty")}</Label><Input type="number" min={1} value={l.quantity} onChange={(e) => set(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></div>
            <div className="space-y-1"><Label className="text-xs">{t("Unit (TZS)")}</Label><Input type="number" min={0} step={1000} value={l.unitAmount} onChange={(e) => set(l.key, { unitAmount: Math.max(0, Number(e.target.value) || 0) })} /></div>
            <div className="space-y-1"><Label className="text-xs">{t("Discount")}</Label><Input type="number" min={0} step={1000} value={l.discountAmount} onChange={(e) => set(l.key, { discountAmount: Math.max(0, Number(e.target.value) || 0) })} /></div>
            <Button variant="ghost" size="icon" aria-label={t("Remove line")} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { key: Date.now(), description: "", quantity: 1, unitAmount: 0, discountAmount: 0 }])}><Plus /> {t("Add line")}</Button>
      </div>
      <div className="space-y-1"><Label htmlFor="nt">{t("Notes on invoice")}</Label><Textarea id="nt" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div className="flex items-center justify-between border-t pt-4">
        <p className="text-lg font-semibold tabular-nums">{formatTZS(total)}</p>
        <Button disabled={pending} onClick={() => start(async () => {
          const r = await createManualInvoiceAction({ corporateCustomerId: company, notes, lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, discountAmount: l.discountAmount })) });
          if (r && !r.ok) toast.error(r.error);
        })}>{pending && <Loader2 className="animate-spin" />}{t("Create draft")}</Button>
      </div>
    </CardContent></Card>
  );
}
