"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Languages, Loader2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TranslationForm } from "@/components/staff/translation-fields";
import { saveTransportChineseAction, transportChineseAction } from "./actions";

type Text = { name: string; description: string };
const empty = (f?: TranslationForm): Text => ({ name: f?.values.name ?? "", description: f?.values.description ?? "" });

/**
 * A transport service's Chinese and its packages', beside the English in the service editor. Loaded when opened;
 * empty fields show the default Chinese (in grey), else the English. Packages not saved yet get theirs after saving.
 */
export function TransportChinese({ serviceId, description, packages }: { serviceId: string; description?: string | null; packages: { id?: string; name: string; description: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ service: TranslationForm; options: Record<string, TranslationForm> } | null>(null);
  const [service, setService] = useState<Text>(empty());
  const [options, setOptions] = useState<Record<string, Text>>({});
  const [pending, start] = useTransition();

  function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (data) return;
    start(async () => {
      const r = await transportChineseAction({ serviceId });
      if (!r.ok) { toast.error(r.error); setOpen(false); return; }
      setData(r.data);
      setService(empty(r.data.service));
      setOptions(Object.fromEntries(Object.entries(r.data.options).map(([id, f]) => [id, empty(f)])));
    });
  }
  function save() {
    start(async () => {
      const r = await saveTransportChineseAction({
        serviceId, service,
        options: Object.entries(options).map(([id, v]) => ({ id, ...v })),
      });
      if (r.ok) { toast.success(r.message ?? t("Chinese saved.")); setData(null); setOpen(false); router.refresh(); } else toast.error(r.error);
    });
  }
  const saved = packages.filter((p) => p.id);

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        <Languages className="size-3.5" />中文 · {open ? t("Hide Chinese") : t("Chinese name & description")}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
          {!data ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("Loading…")}</p> : (
            <>
              <p className="text-xs text-muted-foreground">{t("Leave a field empty to show the default Chinese (in grey) — or the English when there is none.")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input lang="zh-CN" value={service.name} placeholder={data.service.hints.name ?? t("Service name")} aria-label={t("Service name · Chinese")}
                  onChange={(e) => setService({ ...service, name: e.target.value })} className="h-9" />
                <Input lang="zh-CN" value={service.description} placeholder={data.service.hints.description ?? description ?? t("Description")} aria-label={t("Description · Chinese")}
                  onChange={(e) => setService({ ...service, description: e.target.value })} className="h-9" />
              </div>
              {saved.length > 0 && (
                <ul className="space-y-1.5 border-l-2 border-border/70 pl-3">
                  {saved.map((p) => {
                    const id = p.id!;
                    const v = options[id] ?? empty();
                    const hint = data.options[id]?.hints;
                    return (
                      <li key={id} className="grid gap-1.5 sm:grid-cols-[8rem_1fr_1.4fr] sm:items-center">
                        <span className="truncate text-xs font-medium">{p.name}</span>
                        <Input lang="zh-CN" value={v.name} placeholder={hint?.name ?? p.name} aria-label={t("Package name · Chinese")}
                          onChange={(e) => setOptions((o) => ({ ...o, [id]: { ...v, name: e.target.value } }))} className="h-8" />
                        <Input lang="zh-CN" value={v.description} placeholder={hint?.description ?? p.description} aria-label={t("Package description · Chinese")}
                          onChange={(e) => setOptions((o) => ({ ...o, [id]: { ...v, description: e.target.value } }))} className="h-8" />
                      </li>
                    );
                  })}
                </ul>
              )}
              {packages.some((p) => !p.id) && <p className="text-xs text-muted-foreground">{t("New packages can be translated after you save them.")}</p>}
              <div className="flex justify-end"><Button size="sm" variant="outline" disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />}{t("Save Chinese")}</Button></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
