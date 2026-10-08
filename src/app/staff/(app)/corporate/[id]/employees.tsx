"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, IdCard, Loader2, Phone, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { idLabel, type CompanyStaff } from "@/lib/company-staff";
import { useT } from "@/i18n/client";
import { BLANK_PERSON, PersonRow, type PersonDraft } from "@/components/staff/company/quick-company";
import { addEmployeeAction, removeEmployeeAction } from "../actions";

/** The company's people: booked as guests by name, ID optional until check-in. */
export function Employees({ companyId, staff, canEdit, canBook }: { companyId: string; staff: (CompanyStaff & { stays: number })[]; canEdit: boolean; canBook: boolean }) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<PersonDraft | null>(null);
  const [pending, start] = useTransition();
  const add = () => draft && start(async () => {
    const res = await addEmployeeAction({ companyId, fullName: draft.fullName, phone: draft.phone || undefined, idType: draft.idType || undefined, idNumber: draft.idNumber || undefined });
    if (res.ok) { toast.success(t("{name} added.", { name: res.data.fullName })); setDraft({ ...BLANK_PERSON }); router.refresh(); } else toast.error(res.error);
  });
  const remove = (s: CompanyStaff) => start(async () => {
    const res = await removeEmployeeAction({ companyId, guestId: s.id });
    if (res.ok) { toast.success(t("{name} removed from the company.", { name: s.fullName })); router.refresh(); } else toast.error(res.error);
  });
  return (
    <div className="@container space-y-3">
      {staff.length === 0 && !draft && <p className="py-2 text-sm text-muted-foreground">{t("No people yet. Add them here — they show up to tap when you book for this company.")}</p>}
      {staff.length > 0 && (
        <ul className="grid gap-2 @[40rem]:grid-cols-2 @[64rem]:grid-cols-3">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">{s.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
              <Link href={`/staff/guests/${s.id}`} className="min-w-0 flex-1 leading-tight hover:underline">
                <span className="block truncate text-sm font-medium">{s.fullName}</span>
                <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                  {s.phone && <span className="inline-flex items-center gap-0.5"><Phone className="size-3" />{s.phone}</span>}
                  {s.idNumber ? <span className="inline-flex items-center gap-0.5"><IdCard className="size-3" />{t(idLabel(s.idType))} {s.idNumber}</span> : <span>{t("no ID yet")}</span>}
                  <span>· {t.plural(s.stays, "{n} stay", "{n} stays")}</span>
                </span>
              </Link>
              {canBook && <Link href={`/staff/reservations/new?company=${companyId}&guest=${s.id}`} title={t("Book a room for {name}", { name: s.fullName })} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><CalendarPlus className="size-4" /></Link>}
              {canEdit && <button type="button" disabled={pending} onClick={() => remove(s)} aria-label={t("Remove {name} from the company", { name: s.fullName })} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-600"><X className="size-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (draft ? (
        <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-3">
          <PersonRow p={draft} label={t("New person")} autoFocus onChange={setDraft} onRemove={() => setDraft(null)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>{t("Done")}</Button>
            <Button size="sm" disabled={pending || draft.fullName.trim().length < 2} onClick={add}>{pending ? <Loader2 className="animate-spin" /> : <UserPlus />}{t("Add")}</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setDraft({ ...BLANK_PERSON })}><UserPlus />{t("Add person")}</Button>
      ))}
    </div>
  );
}
