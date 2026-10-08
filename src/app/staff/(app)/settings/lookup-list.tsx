"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ActionForm } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { addListItemAction, updateListItemAction } from "./actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Kind = "bookingSource" | "paymentMethod" | "expenseCategory" | "revenueCategory";
interface Item { id: string; name: string; isActive: boolean; isSystem?: boolean; hint?: string }

/** A revenue category's kind, shown in lower case beside its name. */
const HINT_LABEL: Record<string, string> = { RESTAURANT: msg("restaurant"), BAR: msg("bar"), OTHER: msg("other") };

export function LookupList({ kind, title, items }: { kind: Kind; title: string; items: Item[] }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function toggle(item: Item) {
    setBusyId(item.id);
    startTransition(async () => {
      const res = await updateListItemAction({ kind, id: item.id, isActive: item.isActive ? "false" : "true" });
      if (res.ok) toast.success(item.isActive ? t("{name} disabled.", { name: t(item.name) }) : t("{name} enabled.", { name: t(item.name) }));
      else toast.error(res.error);
      setBusyId(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-md border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className={item.isActive ? "" : "text-muted-foreground line-through"}>
                {t(item.name)}
                {item.hint && <Badge variant="outline" className="ml-2">{t(HINT_LABEL[item.hint] ?? item.hint.toLowerCase())}</Badge>}
                {item.isSystem && <Badge variant="secondary" className="ml-2">{t("system")}</Badge>}
              </span>
              {!item.isSystem && (
                <Button size="xs" variant="ghost" disabled={pending && busyId === item.id} onClick={() => toggle(item)}>
                  {item.isActive ? t("Disable") : t("Enable")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <ActionForm action={addListItemAction} resetOnSuccess className="flex gap-2">
          {({ pending: adding }) => (
            <>
              <input type="hidden" name="kind" value={kind} />
              <Input name="name" placeholder={t("Add new…")} required aria-label={t("New {what}", { what: title })} />
              {kind === "revenueCategory" && (
                <NativeSelect name="revenueKind" aria-label={t("Revenue type")} className="w-32">
                  <option value="OTHER">{t("Other")}</option>
                  <option value="RESTAURANT">{t("Restaurant")}</option>
                  <option value="BAR">{t("Bar")}</option>
                </NativeSelect>
              )}
              <Button type="submit" size="icon" variant="outline" disabled={adding} aria-label={t("Add")}>
                <Plus />
              </Button>
            </>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  );
}
