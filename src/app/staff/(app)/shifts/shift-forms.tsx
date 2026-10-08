"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import { addNoteAction, generateRotationAction, resolveNoteAction, setScheduleAction, swapShiftsAction } from "./actions";
import { useT } from "@/i18n/client";

export function ScheduleSelect({ date, value, users, className, short = false, current = null }: {
  date: string; value: string; users: { id: string; fullName: string }[]; className?: string; /** First names only (a small day card). */ short?: boolean;
  /** Who is on the day now — shown even when no longer in the list (left the hotel, or not a receptionist any more). */
  current?: { id: string; fullName: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const t = useT();
  return (
    <NativeSelect value={value} disabled={pending} aria-label={t("Receptionist for {date}", { date })} className={className ?? "min-w-40"}
      onChange={(e) => start(async () => {
        const res = await setScheduleAction({ date, userId: e.target.value || null });
        if (res.ok) router.refresh(); else toast.error(res.error);
      })}>
      <option value="">{short ? t("Nobody") : t("Not scheduled")}</option>
      {current && !users.some((u) => u.id === current.id) && <option value={current.id}>{short ? current.fullName.replace(/\s*\(.*\)/, "").split(" ")[0] : current.fullName} ({t("inactive")})</option>}
      {users.map((u) => <option key={u.id} value={u.id}>{short ? u.fullName.replace(/\s*\(.*\)/, "").split(" ")[0] : u.fullName}</option>)}
    </NativeSelect>
  );
}

export function RotationForm({ users, from }: { users: { id: string; fullName: string }[]; from: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<string[]>([]);
  const t = useT();
  return (
    <ActionForm action={generateRotationAction} onSuccess={(d) => { const r = d as { created: number; updated: number }; toast.info(t("{created} days added, {updated} changed.", { created: r.created, updated: r.updated })); setOrder([]); router.refresh(); }} className="space-y-3">
      {({ pending, fieldErrors: e }) => (
        <>
          {order.map((id) => <input key={id} type="hidden" name="userIds[]" value={id} />)}
          <div className="space-y-1">
            {users.map((u) => {
              const i = order.indexOf(u.id);
              return (
                <NativeCheckbox key={u.id} checked={i >= 0} onChange={(ev) => setOrder(ev.target.checked ? [...order, u.id] : order.filter((x) => x !== u.id))}
                  label={<>{i >= 0 && <strong className="mr-1">{i + 1}.</strong>}{u.fullName}</>} />
              );
            })}
            <FieldError message={e?.userIds} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="rot-from">{t("Starting")}</Label><Input id="rot-from" name="from" type="date" defaultValue={from} min={from} /></div>
            <div className="space-y-1"><Label htmlFor="rot-days">{t("Days")}</Label><Input id="rot-days" name="days" type="number" min={1} max={92} defaultValue={28} /></div>
          </div>
          <NativeCheckbox name="overwrite" label={t("Replace days already scheduled")} />
          <Button type="submit" className="w-full" disabled={pending || order.length === 0}>{pending && <Loader2 className="animate-spin" />}{t("Generate")}</Button>
        </>
      )}
    </ActionForm>
  );
}

export function SwapForm({ today }: { today: string }) {
  const router = useRouter();
  const t = useT();
  return (
    <ActionForm action={swapShiftsAction} onSuccess={() => router.refresh()} className="space-y-2">
      {({ pending }) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Input name="a" type="date" min={today} aria-label={t("First day")} />
            <Input name="b" type="date" min={today} aria-label={t("Second day")} />
          </div>
          <Button type="submit" variant="outline" className="w-full" disabled={pending}>{t("Swap")}</Button>
        </>
      )}
    </ActionForm>
  );
}

export function NoteForm({ canManagerNote }: { canManagerNote: boolean }) {
  const router = useRouter();
  const t = useT();
  return (
    <ActionForm action={addNoteAction} resetOnSuccess onSuccess={() => router.refresh()} className="space-y-2">
      {({ pending, fieldErrors: e }) => (
        <>
          <Textarea name="body" rows={2} placeholder={t("Add a note for the next shift…")} aria-label={t("Note")} />
          <FieldError message={e?.body} />
          <div className="flex items-center gap-2">
            <NativeSelect name="kind" aria-label={t("Note type")} className="w-36">
              <option value="SHIFT">{t("Shift")}</option>
              <option value="GUEST">{t("Guest")}</option>
              <option value="MAINTENANCE">{t("Maintenance")}</option>
              {canManagerNote && <option value="MANAGER">{t("Manager")}</option>}
            </NativeSelect>
            <NativeCheckbox name="isImportant" label={t("Important")} />
            <Button type="submit" size="sm" className="ml-auto" disabled={pending}>{t("Add")}</Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function ResolveNoteButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const t = useT();
  return (
    <Button size="icon-xs" variant="ghost" aria-label={t("Mark resolved")} disabled={pending}
      onClick={() => start(async () => { const r = await resolveNoteAction({ noteId }); if (r.ok) router.refresh(); else toast.error(r.error); })}>
      <Check />
    </Button>
  );
}
