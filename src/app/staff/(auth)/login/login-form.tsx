"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

const field =
  "h-11 w-full rounded-xl border border-white/12 bg-white/[0.06] px-3.5 text-[16px] text-white sm:h-12 sm:px-4 sm:text-[15px] placeholder:text-white/30 outline-none transition-colors focus:border-gold/70 focus:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-gold/30";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, undefined);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-3.5 sm:space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/60 sm:text-xs">Email</label>
        <input key={state?.email ?? ""} id="email" name="email" type="email" autoComplete="username" required autoFocus
          defaultValue={state?.email} placeholder="you@vegashoteltz.com" className={field} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/60 sm:text-xs">Password</label>
        <div className="relative">
          <input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className={`${field} pr-12`} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      {state?.error && (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-sm text-red-100">{state.error}</p>
      )}
      <button type="submit" disabled={pending}
        className="group mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-gold/70 bg-gold/[0.08] text-[14px] font-medium text-[#f0d6a0] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-gold hover:bg-gold/[0.16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
      </button>
    </form>
  );
}
