"use client";

import { cn } from "@/lib/utils";

/** A filter dropdown that applies itself as soon as you pick (submits its form). */
export function AutoSelect({ name, value, options, label, className }: {
  name: string; value: string; options: { value: string; label: string }[]; label: string; className?: string;
}) {
  return (
    <select name={name} defaultValue={value} aria-label={label} onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={cn("h-10 min-w-36 rounded-xl border border-border bg-background px-3 text-sm", className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
