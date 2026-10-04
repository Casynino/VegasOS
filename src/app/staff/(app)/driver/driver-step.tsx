"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tripStatusAction } from "../transport/actions";

const STEP: Record<string, { status: "EN_ROUTE" | "PICKED_UP" | "COMPLETED"; label: string }> = {
  ASSIGNED: { status: "EN_ROUTE", label: "I'm on the way" },
  EN_ROUTE: { status: "PICKED_UP", label: "Guest picked up" },
  PICKED_UP: { status: "COMPLETED", label: "Trip completed" },
};

export function DriverStepButton({ tripId, status }: { tripId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = STEP[status];
  if (!next) return null;
  return (
    <Button size="lg" className="h-12 w-full text-base" disabled={pending} onClick={() => start(async () => {
      const r = await tripStatusAction({ tripId, status: next.status });
      if (r.ok) { toast.success(next.label); router.refresh(); } else toast.error(r.error);
    })}>{pending && <Loader2 className="animate-spin" />}{next.label}</Button>
  );
}
