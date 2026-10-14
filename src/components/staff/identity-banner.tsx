import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * Who is signed in, always in view.
 *
 * - A Developer sees one unmistakable strip across the top of EVERY staff page: "DEVELOPER MODE — SUPER USER", their name,
 *   and two plain links — Sign out, and Switch to a staff account (which signs out first; nothing carries over).
 * - Everyone sees their own real name and role: beside the picture in the top bar from `xl`, the name alone at `lg` (the role is in the
 *   tooltip and in the side menu's account card), and in the bottom bar's Menu on a tablet or a phone.
 *
 * Both are drawn on the server from the session (the account's role in the database, read on every request) — nothing
 * here comes from the page, the department or the browser. They are server components: no client code, and no setting that
 * the browser could change. (Removing the strip in the browser's tools only hides a picture — the server still treats the
 * session as a Developer's and keeps every action in the audit trail under it.)
 */
export interface Identity {
  actorType: "DEVELOPER" | "STAFF";
  name: string;
  /** The role's name as stored (translated here). */
  role: string;
}

/** The strip's height, set once on the shell: taller on a phone (two lines), one line from `sm` up. The sticky parts below it use it as their offset. */
export const DEV_STRIP_VARS = "[--dev-strip:3.75rem] sm:[--dev-strip:2.5rem]";

type SignOutAction = () => void | Promise<void>;

export function IdentityBanner({ identity, t, signOut, switchToStaff }: {
  identity: Identity;
  t: T;
  /** The existing sign-out server action. */
  signOut: SignOutAction;
  /** Signs out (through the same sign-out) and opens the staff sign-in. */
  switchToStaff: SignOutAction;
}) {
  if (identity.actorType !== "DEVELOPER") return null;
  const link =
    "whitespace-nowrap py-1.5 text-xs font-semibold underline decoration-white/55 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  return (
    <div
      role="region"
      aria-label={t("DEVELOPER MODE — SUPER USER")}
      data-identity="developer"
      className="sticky top-0 z-40 flex h-[var(--dev-strip)] shrink-0 flex-col justify-center gap-0.5 bg-fuchsia-700 px-3 text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] sm:flex-row sm:items-center sm:gap-5 sm:px-5 print:hidden"
      style={{ backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.1) 0 10px, transparent 10px 20px)" }}
    >
      <p className="flex shrink-0 items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.14em] sm:text-xs">
        <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
        <span>{t("DEVELOPER MODE — SUPER USER")}</span>
      </p>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <p className="min-w-0 flex-1 truncate text-xs text-white/90" title={identity.name}>{identity.name}</p>
        <form action={signOut} className="shrink-0">
          <button type="submit" className={link}>{t("Sign out")}</button>
        </form>
        <form action={switchToStaff} className="shrink-0">
          <button type="submit" className={link}>{t("Switch to a staff account")}</button>
        </form>
      </div>
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
 */
export function IdentityCard({ identity, t, className, children }: { identity: Identity; t: T; className?: string; children?: ReactNode }) {
  const developer = identity.actorType === "DEVELOPER";
  return (
    <Link href="/staff/account" data-identity-card title={t("{name} · {role} — your account", { name: identity.name, role: t(identity.role) })}
      className={cn("flex items-center gap-3 rounded-2xl bg-muted p-2.5 transition-colors hover:bg-muted/70 xl:hidden", className)}>
      {children}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-semibold text-foreground">{identity.name}</span>
        <span className={cn("block truncate text-[11px]", developer ? "font-semibold text-fuchsia-700 dark:text-fuchsia-300" : "text-muted-foreground")}>{t(identity.role)}</span>
      </span>
    </Link>
  );
}
