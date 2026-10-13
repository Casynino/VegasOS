"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTZS } from "@/lib/format";
import { useT } from "@/i18n/client";
import { setMenuPriceAction } from "./actions";

/** A menu price on its own line: tap the pencil, type the new price, save. Only the price changes. */
export function PriceCell({ id, name, price, canEdit }: { id: string; name: string; price: number; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <span className="flex items-center gap-1.5 tabular-nums">
        {formatTZS(price)}
        {canEdit && <button type="button" onClick={() => setEditing(true)} aria-label={t("Change the price of {name}", { name })} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>}
      </span>
    );
  }
  return (
    <ActionForm action={setMenuPriceAction} onSuccess={() => { setEditing(false); router.refresh(); }} className="flex items-center gap-1.5">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Input name="price" type="number" min={1} step={100} inputMode="numeric" defaultValue={price} autoFocus aria-label={t("New price of {name} (TZS)", { name })} className="h-8 w-28 tabular-nums" />
          <Button type="submit" size="sm" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("Cancel")}</Button>
        </>
      )}
    </ActionForm>
  );
}
