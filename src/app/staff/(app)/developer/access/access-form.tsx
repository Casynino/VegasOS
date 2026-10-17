"use client";

import { startTransition, useActionState, useEffect, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";

type Action = (prev: ActionResult<unknown> | undefined, formData: FormData) => Promise<ActionResult<unknown>>;

/**
 * A form for the Access dialogs. Like ActionForm, but a refusal is shown IN the dialog, in plain words (the dialog covers the
 * page, so a toast alone could be missed) — a success is a toast and the dialog closes. What the person typed stays after a refusal.
 */
export function AccessForm({ action, onSuccess, className, children }: {
  action: Action;
  onSuccess?: () => void;
  className?: string;
  children: (state: { pending: boolean; error?: string; fieldErrors?: Record<string, string> }) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  useEffect(() => {
    if (!state?.ok) return;
    if (state.message) toast.success(state.message);
    onSuccess?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Submitted by hand so React does not clear the fields after a refusal.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const failed = state && !state.ok ? state : undefined;
  return (
    <form onSubmit={handleSubmit} className={className} noValidate>
      {children({ pending, error: failed?.error, fieldErrors: failed?.fieldErrors })}
    </form>
  );
}

/** The answer to a refused attempt, said in the dialog. */
export function FormProblem({ message }: { message?: string }) {
  if (!message) return null;
  return <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>;
}
