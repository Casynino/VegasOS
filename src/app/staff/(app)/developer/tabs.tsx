import Link from "next/link";
import { ArrowRight, ChartColumn, ScrollText } from "lucide-react";
import type { T } from "@/i18n/translate";
import { CONSOLE_HREF } from "@/server/services/developer-console";
import type { RoleChoice } from "./access/add-account-dialog";
import { AddAccountCard, WorkAsCard, type PersonChoice } from "./home-dialogs";
import { TILE, TILE_ICON } from "./tile-style";

/** The four quick actions under the greeting: Work as and Add an account open a popup; Audit and Business are the console's other pages. */
export function Shortcuts({ t, people = [], roles = [] }: { t: T; people?: PersonChoice[]; roles?: RoleChoice[] }) {
  const links = [
    { href: CONSOLE_HREF.audit, icon: ScrollText, title: t("Audit"), text: t("Everything done in the system, by staff and by you.") },
    { href: CONSOLE_HREF.business, icon: ChartColumn, title: t("Business"), text: t("Stays, bills, payments and guests. Read only.") },
  ];
  return (
    <nav aria-label={t("Quick actions")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <WorkAsCard people={people} />
      <AddAccountCard roles={roles} />
      {links.map((c) => (
        <Link key={c.href} href={c.href} className={TILE}>
          <span className={TILE_ICON}><c.icon aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-base font-semibold text-foreground">{c.title}<ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
            <span className="mt-1 block text-sm leading-snug text-muted-foreground">{c.text}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
