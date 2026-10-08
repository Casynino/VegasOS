"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { useT } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { TranslatableKind } from "@/server/services/translations";
import { saveContentTranslationAction, setChineseOfferedAction } from "./actions";

/** Offer Chinese to guests — the switch beside 简体中文. */
export function ChineseOfferedSwitch({ on }: { on: boolean }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={value}
      disabled={pending}
      aria-label={t("Offer Chinese to guests")}
      onCheckedChange={(next: boolean) => {
        setValue(next);
        start(async () => {
          const r = await setChineseOfferedAction({ on: next });
          if (r.ok) { toast.success(r.message ?? t("Saved")); router.refresh(); } else { setValue(!next); toast.error(r.error); }
        });
      }}
    />
  );
}

/** One item without Chinese yet: "Add Chinese" opens a small editor right in the list. */
export function AddChinese({ kind, id, name, description, withDescription }: {
  kind: TranslatableKind; id: string; name: string; description: string | null; withDescription: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [zhName, setZhName] = useState("");
  const [zhDescription, setZhDescription] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await saveContentTranslationAction({ kind, id, name: zhName, ...(withDescription ? { description: zhDescription } : {}) });
    if (r.ok) { toast.success(r.message ?? t("Saved")); setOpen(false); router.refresh(); } else toast.error(r.error);
  });
  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
        {!open && <Button size="xs" variant="outline" onClick={() => setOpen(true)}><Plus /> {t("Add Chinese")}</Button>}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <Input lang="zh-CN" autoFocus value={zhName} onChange={(e) => setZhName(e.target.value)} placeholder={t("Chinese name")} aria-label={t("Chinese name")} className="h-9" />
          {withDescription && (
            <Textarea lang="zh-CN" rows={2} value={zhDescription} onChange={(e) => setZhDescription(e.target.value)}
              placeholder={description ? `${t("English:")} ${description}` : t("Chinese description (optional)")} aria-label={t("Chinese description (optional)")} />
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{t("Cancel")}</Button>
            <Button size="sm" disabled={pending || !zhName.trim()} onClick={save}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button>
          </div>
        </div>
      )}
    </li>
  );
}
