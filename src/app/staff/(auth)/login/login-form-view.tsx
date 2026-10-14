"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Terminal, UserRound } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { LoginState } from "./actions";

export type AccountType = "STAFF" | "DEVELOPER";

/** The drawn form, apart from the server action behind it (so it can be shown and tested without the database). */
const field =
  "h-11 w-full rounded-xl border border-white/12 bg-white/[0.06] px-3.5 text-[16px] text-white sm:h-12 sm:px-4 sm:text-[15px] placeholder:text-white/30 outline-none transition-colors focus:border-gold/70 focus:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-gold/30";

const CHOICES = [
  { value: "STAFF", icon: UserRound },
  { value: "DEVELOPER", icon: Terminal },
] as const;

export function LoginFormView({ state, pending, action, initialType = "STAFF" }: {
  state: LoginState;
  pending: boolean;
  action: (formData: FormData) => void;
  /** The door picked by the address (?as=developer / ?as=staff). */
  initialType?: AccountType;
}) {
  const [show, setShow] = useState(false);
  // What the person last picked here; before that, what the last attempt used; before that, the address's choice.
  const [picked, setPicked] = useState<AccountType | null>(null);
  const type: AccountType = picked ?? state?.accountType ?? initialType;
  const developer = type === "DEVELOPER";
  const t = useT();
  const label = { STAFF: t("Staff account"), DEVELOPER: t("Developer account") } as const;
  return (
    <form action={action} className="space-y-3.5 sm:space-y-4">
      {/* Which door. Only a choice of door: the server still checks the account itself, and a wrong door fails like a wrong password. */}
      <fieldset className="space-y-1.5">
        <legend className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/60 sm:text-xs">{t("Account type")}</legend>
        {/* New radios after each answer: the form resets itself after a try, and they must come back as the person chose them. */}
        <div key={`${state?.accountType ?? ""}|${state?.email ?? ""}|${state?.error ?? ""}`} className="grid grid-cols-2 gap-1 rounded-xl border border-white/12 bg-white/[0.04] p-1">
          {CHOICES.map(({ value, icon: Icon }) => (
            <label key={value} className="relative cursor-pointer">
              <input type="radio" name="accountType" value={value} defaultChecked={type === value} disabled={pending}
                onChange={() => setPicked(value)} className="peer sr-only" />
              <span className={cn(
                "flex h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-white/60 transition-colors hover:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-white/60 peer-disabled:opacity-60",
                value === "DEVELOPER"
                  ? "peer-checked:bg-fuchsia-600/30 peer-checked:text-fuchsia-50 peer-checked:shadow-[inset_0_0_0_1px_rgba(232,121,249,0.75)]"
                  : "peer-checked:bg-gold/15 peer-checked:text-[#f0d6a0] peer-checked:shadow-[inset_0_0_0_1px_rgba(212,175,106,0.7)]",
              )}>
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{label[value]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div aria-live="polite">
        {developer && (
          <p className="flex items-start gap-2 rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-2.5 text-[13px] leading-snug text-fuchsia-100">
            <Terminal className="mt-0.5 size-3.5 shrink-0 text-fuchsia-300" aria-hidden="true" />
            {t("Developer sign-in — every action is recorded as a Developer action.")}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/60 sm:text-xs">{t("Email")}</label>
        <input key={state?.email ?? ""} id="email" name="email" type="email" autoComplete="username" required autoFocus
          defaultValue={state?.email} placeholder={t("you@vegashoteltz.com")} className={field} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/60 sm:text-xs">{t("Password")}</label>
        <div className="relative">
          <input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className={`${field} pr-12`} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t("Hide password") : t("Show password")}
            className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      {state?.error && (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-sm text-red-100">{state.error}</p>
      )}
      <button type="submit" disabled={pending}
        className={cn(
          "group mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border text-[14px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60",
          developer
            ? "border-fuchsia-400/80 bg-fuchsia-500/[0.12] text-fuchsia-100 hover:border-fuchsia-300 hover:bg-fuchsia-500/25 focus-visible:outline-fuchsia-300"
            : "border-gold/70 bg-gold/[0.08] text-[#f0d6a0] hover:border-gold hover:bg-gold/[0.16] focus-visible:outline-gold",
        )}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? t("Signing in…") : t("Sign in")}
        {!pending && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
      </button>
    </form>
  );
}
