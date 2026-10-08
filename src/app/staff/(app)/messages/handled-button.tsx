"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markHandledAction } from "./actions";
import { useT } from "@/i18n/client";

export function HandledButton({ id }: { id: string }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await markHandledAction({ id }); if (r.ok) router.refresh(); else toast.error(r.error);
    })}><Check /> {t("Handled")}</Button>
  );
}
