"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, PlugZap, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkAllOnlinePaymentsAction, checkOnlinePaymentAction, saveOnlinePaySettingsAction, testNtzsConnectionAction } from "./actions";

/** "Test connection": asks nTZS with the hotel's key — no money moves. */
export function TestConnection() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => start(async () => {
        const r = await testNtzsConnectionAction();
        setResult(r.ok ? { ok: true, text: `Connected · ${r.data.live ? "live" : "test"} key accepted` } : { ok: false, text: r.error });
      })} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}Test connection
      </button>
      {result && <span className={cn("text-xs font-medium", result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>{result.text}</span>}
    </div>
  );
}

type Service = { key: string; label: string; hint: string; on: boolean };

/** On / off — for everything, and service by service. Only those who manage settings can change it. */
export function OnlinePaySwitches({ enabled, services, canManage, connected }: { enabled: boolean; services: Service[]; canManage: boolean; connected: boolean }) {
  const router = useRouter();
  const [all, setAll] = useState(enabled);
  const [each, setEach] = useState<Record<string, boolean>>(() => Object.fromEntries(services.map((s) => [s.key, s.on])));
  const [pending, start] = useTransition();
  const dirty = all !== enabled || services.some((s) => each[s.key] !== s.on);
  const save = () => start(async () => {
    const r = await saveOnlinePaySettingsAction({ enabled: all, services: each });
    if (r.ok) { toast.success(all ? "Online payment settings saved." : "Online payments are off — customers see only the other ways to pay."); router.refresh(); } else toast.error(r.error);
  });
  return (
    <div className="space-y-3">
      <Toggle label="Online payments" hint={connected ? "Customers can pay online (nTZS) wherever a service below is on." : "Add the nTZS key on the server first."} on={all} onChange={setAll} disabled={!canManage} strong />
      <ul className={cn("divide-y divide-border/70 rounded-2xl border border-border/70", !all && "opacity-55")}>
        {services.map((s) => (
          <li key={s.key} className="px-3 py-2.5"><Toggle label={s.label} hint={s.hint} on={each[s.key]} onChange={(v) => setEach((x) => ({ ...x, [s.key]: v }))} disabled={!canManage || !all} /></li>
        ))}
      </ul>
      {canManage ? (
        <button type="button" onClick={save} disabled={!dirty || pending} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-40">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Save
        </button>
      ) : <p className="text-xs text-muted-foreground">Only the MD or admin changes these.</p>}
    </div>
  );
}

function Toggle({ label, hint, on, onChange, disabled, strong }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; strong?: boolean }) {
  return (
    <label className={cn("flex items-start justify-between gap-3", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <span className="min-w-0 leading-tight">
        <span className={cn("block text-sm", strong ? "font-semibold" : "font-medium")}>{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full p-0 transition-colors disabled:opacity-60", on ? "bg-emerald-600" : "bg-muted-foreground/30")}>
        <span className={cn("absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0")} />
      </button>
    </label>
  );
}

/** "Check with nTZS" on one payment not recorded: money nTZS has is recorded at once. */
export function CheckPayment({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => {
      const r = await checkOnlinePaymentAction({ id });
      if (!r.ok) { toast.error(r.error); return; }
      if (r.data.status === "COMPLETED") toast.success("nTZS has the money — the payment is recorded."); else toast.info(`nTZS says: ${r.data.text}.`);
      router.refresh();
    })} className="mt-1 inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-60">
      {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}Check with nTZS
    </button>
  );
}

/** "Check all with nTZS": every payment of the last two days not recorded yet. */
export function CheckAllPayments() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => {
      const r = await checkAllOnlinePaymentsAction();
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.data.checked ? `Checked ${r.data.checked} payment${r.data.checked === 1 ? "" : "s"} with nTZS.` : "Nothing waiting to check.");
      router.refresh();
    })} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Check unrecorded with nTZS
    </button>
  );
}
