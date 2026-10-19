"use client";

import { Eye, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/** Who the Developer acted as. `actedAs` ("Neema (Receptionist)") arrives ready from the server: set only on a Developer's entry written while working as someone. */
export function ActedAsLine({ actedAs }: { actedAs?: string | null }) {
  const t = useT();
  if (!actedAs) return null;
  return <p className="text-sm"><span className="text-xs font-semibold uppercase text-muted-foreground">{t("Acted as")}</span> {actedAs}</p>;
}

export function AuditDetail({ action, before, after, actedAs }: { action: string; before: unknown; after: unknown; actedAs?: string | null }) {
  const t = useT();
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("View details")} />}><Eye /></DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader icon={<History />} eyebrow={t("Activity")} tone="violet"><DialogTitle className="font-mono break-all">{action}</DialogTitle></DialogHeader>
        <ActedAsLine actedAs={actedAs} />
        <div className="grid gap-3 sm:grid-cols-2">
          {[[msg("Before"), before], [msg("After"), after]].map(([label, value]) => (
            <div key={label as string}>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t(label as string)}</p>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-2 text-xs">{value ? JSON.stringify(value, null, 2) : "—"}</pre>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
