"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { cn } from "@/lib/utils";
import { Button, field } from "./kit";
import { CONTACT_SUBJECTS } from "./site-config";

type Action = (prev: ActionResult<null> | undefined, fd: FormData) => Promise<ActionResult<null>>;

const Req = () => (
  <span aria-hidden="true" className="ml-1 text-pub-eyebrow">
    *
  </span>
);

/**
 * The enquiry form on /contact (useActionState, FormData: name, email, phone, subject, message and the off-screen
 * honeypot "company"). Tone-aware fields; the reply arrives in the status line at the top, which takes focus.
 */
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
      {/* Always in the page (a live region must exist before it speaks); empty, it gives its row gap back. */}
      <div id="contact-status" ref={statusRef} tabIndex={-1} className="scroll-mt-header outline-none empty:-mb-5 sm:col-span-2" aria-live="polite">
        {state?.ok && (
          <p className="flex items-start gap-3 rounded-[0.75rem] border border-gold/45 bg-gold/[0.08] p-4 text-[15px] leading-snug text-pub-fg">
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" /> {state.message}
          </p>
        )}
        {state && !state.ok && (
          <p role="alert" className="flex items-start gap-3 rounded-[0.75rem] border border-pub-error/35 bg-pub-error/[0.08] p-4 text-[15px] leading-snug text-pub-error">
            <CircleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={1.6} aria-hidden="true" /> {state.error}
          </p>
        )}
      </div>
      <div className="min-w-0 sm:col-span-2">
        <label htmlFor="c-name" className={field.label}>Your name<Req /></label>
        <input id="c-name" name="name" required autoComplete="name" aria-invalid={errors?.name ? true : undefined} className={field.input} />
        {errors?.name && <p className={field.error}>{errors.name}</p>}
      </div>
      <div className="min-w-0">
        <label htmlFor="c-email" className={field.label}>Email</label>
        <input id="c-email" name="email" type="email" autoComplete="email" aria-invalid={errors?.email ? true : undefined} className={field.input} />
        {errors?.email && <p className={field.error}>{errors.email}</p>}
      </div>
      <div className="min-w-0">
        <label htmlFor="c-phone" className={field.label}>Phone / WhatsApp</label>
        <input id="c-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" aria-invalid={errors?.phone ? true : undefined} className={field.input} />
        {errors?.phone && <p className={field.error}>{errors.phone}</p>}
      </div>
      <div className="min-w-0 sm:col-span-2">
        <label htmlFor="c-subject" className={field.label}>Subject</label>
        <select id="c-subject" name="subject" defaultValue={subject} className={cn(field.input, "appearance-auto pr-3")}>
          {CONTACT_SUBJECTS.map((s) => <option key={s.key} value={s.label}>{s.label}</option>)}
        </select>
        {errors?.subject && <p className={field.error}>{errors.subject}</p>}
      </div>
      <div className="min-w-0 sm:col-span-2">
        <label htmlFor="c-message" className={field.label}>Message<Req /></label>
        <textarea
          id="c-message"
          name="message"
          rows={5}
          required
          maxLength={3000}
          placeholder={defaultSubject === "meeting" ? "Preferred date, times and number of people…" : "How can we help?"}
          aria-invalid={errors?.message ? true : undefined}
          className={field.textarea}
        />
        {errors?.message && <p className={field.error}>{errors.message}</p>}
      </div>
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="c-company">Company</label>
        <input id="c-company" name="company" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <Button type="submit" disabled={pending} icon={pending ? "none" : "arrow"} full className="sm:w-auto sm:min-w-48">
          <span className="inline-flex items-center gap-2">
            {pending && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
            {pending ? "Sending…" : "Send message"}
          </span>
        </Button>
        <p className="text-[13px] leading-relaxed text-pub-muted sm:max-w-60 sm:text-right">
          Leave an email or a phone number. We use your details only to reply to this message.
        </p>
      </div>
    </form>
  );
}
