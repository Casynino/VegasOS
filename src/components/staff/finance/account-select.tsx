"use client";

import { useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { accountDetail, accountLabel, type PayAccount } from "@/lib/pay-account";
import { cn } from "@/lib/utils";

/**
 * "Received through" — staff pick the hotel account; the holder and number are
 * shown back as confirmation (never typed). Works as a form field (`name`) or controlled.
 */
export function AccountSelect({ accounts, name, value, onChange, id, className }: {
  accounts: PayAccount[]; name?: string; value?: string; onChange?: (id: string) => void; id?: string; className?: string;
}) {
  const [own, setOwn] = useState(accounts[0]?.id ?? "");
  const current = value ?? own;
  const detail = accountDetail(accounts.find((a) => a.id === current));
  return (
    <div className="space-y-1">
      <NativeSelect id={id} name={name} aria-label="Received through" value={current} className={cn("h-10 w-full", className)}
        onChange={(e) => { setOwn(e.target.value); onChange?.(e.target.value); }}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
      </NativeSelect>
      {detail && <p className="truncate text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}
