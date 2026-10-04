"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { cn } from "@/lib/utils";
import { ArrowBadge } from "./pill-link";
import { CONTACT_SUBJECTS } from "./site-config";
import { fieldError, fieldInput, fieldLabel, fieldTextarea, pillGold } from "./ui";

type Action = (prev: ActionResult<null> | undefined, fd: FormData) => Promise<ActionResult<null>>;

export function ContactForm({ action, defaultSubject }: { action: Action; defaultSubject?: string }) {
  const [state, run, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
    if (state) statusRef.current?.focus();
  }, [state]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => run(fd));
  }

  const subject = CONTACT_SUBJECTS.find((s) => s.key === defaultSubject)?.label ?? CONTACT_SUBJECTS[0].label;

  return (
    <form ref={formRef} action={run} onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2" aria-describedby="contact-status">
      <div id="contact-status" ref={statusRef} tabIndex={-1} className="outline-none sm:col-span-2" aria-live="polite">
        {state?.ok && (
          <p className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-700/15">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {state.message}
          </p>
        )}
        {state && !state.ok && (
          <p role="alert" className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-700/15">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {state.error}
          </p>
        )}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-name" className={fieldLabel}>Your name <span aria-hidden="true">*</span></label>
        <input id="c-name" name="name" required autoComplete="name" aria-invalid={errors?.name ? true : undefined} className={fieldInput} />
        {errors?.name && <p className={fieldError}>{errors.name}</p>}
      </div>
      <div>
        <label htmlFor="c-email" className={fieldLabel}>Email</label>
        <input id="c-email" name="email" type="email" autoComplete="email" aria-invalid={errors?.email ? true : undefined} className={fieldInput} />
        {errors?.email && <p className={fieldError}>{errors.email}</p>}
      </div>
      <div>
        <label htmlFor="c-phone" className={fieldLabel}>Phone / WhatsApp</label>
        <input id="c-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" aria-invalid={errors?.phone ? true : undefined} className={fieldInput} />
        {errors?.phone && <p className={fieldError}>{errors.phone}</p>}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-subject" className={fieldLabel}>Subject</label>
        <select id="c-subject" name="subject" defaultValue={subject} className={cn(fieldInput, "appearance-auto")}>
          {CONTACT_SUBJECTS.map((s) => <option key={s.key} value={s.label}>{s.label}</option>)}
        </select>
        {errors?.subject && <p className={fieldError}>{errors.subject}</p>}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-message" className={fieldLabel}>Message <span aria-hidden="true">*</span></label>
        <textarea
          id="c-message"
          name="message"
          rows={5}
          required
          maxLength={3000}
          placeholder={defaultSubject === "meeting" ? "Preferred date, times and number of people…" : "How can we help?"}
          aria-invalid={errors?.message ? true : undefined}
          className={fieldTextarea}
        />
        {errors?.message && <p className={fieldError}>{errors.message}</p>}
      </div>
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="c-company">Company</label>
        <input id="c-company" name="company" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={cn(pillGold, "h-12 w-full justify-between py-1.5 pl-6 pr-1.5 sm:w-auto sm:min-w-60")}>
          <span className="relative inline-flex items-center gap-2">
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {pending ? "Sending…" : "Send message"}
          </span>
          <ArrowBadge />
        </button>
        <p className="mt-3 text-xs text-tone/55">We use your details only to reply to this message.</p>
      </div>
    </form>
  );
}
