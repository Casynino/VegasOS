import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";

/** Quick find for the desk: reference, guest name, phone or room number. Plain GET form — works before hydration. */
export async function ReceptionSearch({ className, defaultValue, autoFocus }: { className?: string; defaultValue?: string; autoFocus?: boolean }) {
  const t = await getT();
  return (
    <form action="/staff/search" role="search" className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        name="q" type="search" defaultValue={defaultValue} autoFocus={autoFocus} autoComplete="off"
        placeholder={t("Find guest: name, phone, reference or room")}
        aria-label={t("Find a reservation or guest")}
        className="h-10 w-full rounded-xl border bg-card pl-9 pr-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </form>
  );
}
