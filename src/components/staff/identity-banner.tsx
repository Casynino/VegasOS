import type { ReactNode } from "react";
import Link from "next/link";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { WORK_AS_HOURS } from "@/server/work-as-session";

/**
 * Who is signed in, always in view.
 *
 * - A Developer signed in as itself (in its own console) sees NO strip — the console's side menu says where it is (owner, 2026-10-18); formerly one strip: "DEVELOPER MODE — SUPER USER",
 *   its name, and two plain links — Console, and Sign out.
 * - A Developer WORKING AS someone sees one small floating pill, bottom right, on every page: "Working as Neema" and a Stop button (owner, 2026-10-18:
 *   the full-width bar was too much). It takes no room in the page; the time left is in its tooltip. Sign out is in the side menu.
 * - Everyone sees their own real name and role: beside the picture in the top bar from `xl`, the name alone at `lg` (the role is in the
 *   tooltip and in the side menu's account card), and in the bottom bar's Menu on a tablet or a phone. While a Developer works as
 *   someone, those show the PERSON being worked as.
 *
 * All of it is drawn on the server from the session (the account's role and the work-as record in the database, read on every request)
 * — nothing here comes from the page, the department or the browser. They are server components: no client code, and no setting that
 * the browser could change. (Removing the strip in the browser's tools only hides a picture — the server still treats the session as
 * a Developer's, refuses what a Developer must not do, and keeps every action in the audit trail under the Developer's own name.)
 */
export interface Identity {
  actorType: "DEVELOPER" | "STAFF";
  /** The person shown in the menus: the signed-in account, or — while a Developer works as someone — that person. */
  name: string;
  /** The role's name as stored (translated here). */
  role: string;
  /** Set only while a Developer is working as someone: who is really signed in, and since when. `name` / `role` above are then the person's. */
  workAs?: { developerName: string; startedAt: Date | string };
}

/** Work as ends by itself this many hours after it started — the server's own number (server/work-as-session.ts); here it is only told to the Developer. */
export { WORK_AS_HOURS };

/** The shell's offset variable for this identity: none — the pill floats, it takes no space in the page (kept so the shell and its sticky parts need no change). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const stripVars = (_identity: Identity) => "";

type SignOutAction = () => void | Promise<void>;

/** How long a working-as has lasted and how long is left of its hours, at `now` (never negative). */
export function workAsClock(startedAt: Date | string, now: Date = new Date()): { elapsedMs: number; leftMs: number } {
  const started = new Date(startedAt).getTime();
  return { elapsedMs: Math.max(0, now.getTime() - started), leftMs: Math.max(0, started + WORK_AS_HOURS * 3_600_000 - now.getTime()) };
}

/** "12 min", "3 h 48 min", "4 h", "less than a minute". */
export function spanWords(ms: number, t: T): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("less than a minute");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? t("{h} h {m} min", { h, m }) : t("{h} h", { h })) : t("{m} min", { m });
}


export function IdentityBanner({ identity, t, stopWorkAs, now }: {
  identity: Identity;
  t: T;
  /** Stop working as someone (the server action on the Access page): back to the console. */
  stopWorkAs: SignOutAction;
  /** The moment the page is drawn (for the time left in the tooltip). */
  now?: Date;
}) {
  if (identity.actorType !== "DEVELOPER" || !identity.workAs) return null;
  // A small pill, fixed bottom right (above the phone's bottom bar): who you are working as, and Stop. It floats over the page, so it adds no height.
  const clock = workAsClock(identity.workAs.startedAt, now);
  const label = t("Working as {name}", { name: identity.name });
  const tip = t("{name} ({role}) · started {elapsed} ago · ends in {left}", { name: identity.name, role: t(identity.role), elapsed: spanWords(clock.elapsedMs, t), left: spanWords(clock.leftMs, t) });
  return (
    <div
      role="region"
      aria-label={label}
      data-identity="work-as"
      title={tip}
      className="fixed bottom-20 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full bg-fuchsia-700 py-1 pl-3.5 pr-1 text-white shadow-lg shadow-black/30 lg:bottom-5 lg:right-5 print:hidden"
    >
      <span className="min-w-0 truncate text-xs font-semibold">{label}</span>
      <form action={stopWorkAs} className="shrink-0">
        <button type="submit" data-work-as-stop
          className="inline-flex h-7 items-center rounded-full bg-white px-3.5 text-xs font-bold text-fuchsia-800 transition-colors hover:bg-fuchsia-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {t("Stop")}
        </button>
      </form>
    </div>
  );
}

/**
 * Name and role beside the picture in the top bar. It never squeezes the date and the search:
 *  - from `xl` (wide screens): the name and the role, two short lines;
 *  - at `lg` (laptop, with the side menu open): the name only — the role is in the tooltip and in the side menu's account card;
 *  - below `lg` (tablet and phone): hidden — the bottom bar's Menu shows the name and the role.
 * A Developer's role line is tinted with the strip's colour, so the two are never mistaken for an ordinary account's.
 */
export function IdentityChip({ identity, t, className }: { identity: Identity; t: T; className?: string }) {
  const developer = identity.actorType === "DEVELOPER";
  const role = t(identity.role);
  return (
    <span data-identity-chip title={t("{name} · {role} — your account", { name: identity.name, role })} className={cn("hidden min-w-0 max-w-[7rem] text-left leading-tight lg:block xl:max-w-[12rem]", className)}>
      <span className="block truncate text-[13px] font-semibold text-foreground">{identity.name}</span>
      <span data-identity-role className={cn("hidden truncate text-[11px] xl:block", developer ? "font-semibold text-fuchsia-700 dark:text-fuchsia-300" : "text-muted-foreground")}>{role}</span>
    </span>
  );
}

/**
 * The same name and role as a small card in the side menu (laptop width only — from `xl` the top bar already shows both, and
 * below `lg` the side menu is not there: the bottom bar's Menu has its own account card). `children` is the picture.
 * While a Developer works as someone the card shows that person and is not a link (their account page is theirs).
 */
export function IdentityCard({ identity, t, className, children }: { identity: Identity; t: T; className?: string; children?: ReactNode }) {
  const developer = identity.actorType === "DEVELOPER";
  const title = t("{name} · {role} — your account", { name: identity.name, role: t(identity.role) });
  const cls = cn("flex items-center gap-3 rounded-2xl bg-muted p-2.5 xl:hidden", !identity.workAs && "transition-colors hover:bg-muted/70", className);
  const body = (
    <>
      {children}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-semibold text-foreground">{identity.name}</span>
        <span className={cn("block truncate text-[11px]", developer ? "font-semibold text-fuchsia-700 dark:text-fuchsia-300" : "text-muted-foreground")}>{t(identity.role)}</span>
      </span>
    </>
  );
  return identity.workAs
    ? <div data-identity-card title={title} className={cls}>{body}</div>
    : <Link href="/staff/account" data-identity-card title={title} className={cls}>{body}</Link>;
}
