"use client";

import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * ONE GUEST, ONE ROOM. The server found this customer in another room and refused (its sentence names the room).
 * The desk answers right here: the same person taking another room, or someone else — who then gets their own name
 * and their own customer. Nothing is saved until they answer.
 */
export function SameGuestAsk({ message, pending, onSame, onOther, className }: {
  message: string; pending?: boolean; onSame: () => void; onOther: () => void; className?: string;
}) {
  const t = useT();
  return (
    <div role="alert" className={cn("space-y-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-500/40 dark:bg-amber-500/10", className)}>
      <p className="flex items-start gap-2 text-sm font-semibold text-amber-950 dark:text-amber-100"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{message}</p>
      <p className="text-xs text-amber-900/85 dark:text-amber-100/80">{t("Is the person at the desk the same guest, taking another room? If it is someone else, write their own name — they are saved as their own customer.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-auto min-h-10 flex-1 basis-56 whitespace-normal bg-card py-2" disabled={pending} onClick={onOther}>{t("No — it is someone else")}</Button>
        <Button type="button" className="h-auto min-h-10 flex-1 basis-56 whitespace-normal py-2" disabled={pending} onClick={onSame}>{pending ? <Loader2 className="animate-spin" /> : <Check />}{t("Yes — same guest, another room")}</Button>
      </div>
    </div>
  );
}
