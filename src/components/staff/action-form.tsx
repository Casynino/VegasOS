"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";

type Action = (prev: ActionResult<unknown> | undefined, formData: FormData) => Promise<ActionResult<unknown>>;

/**
 * Form wired to a server action returning ActionResult: shows a toast on
 * success/failure, exposes field errors, keeps input on failure and
 * optionally resets on success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  onSuccess,
}: {
  action: Action;
  children: (state: { pending: boolean; fieldErrors?: Record<string, string> }) => ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (data: unknown) => void;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state.data);
    } else {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Submit manually so React does not auto-reset the form: on a validation
  // error the user keeps what they typed; we reset only after success.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className={className} noValidate>
      {children({ pending, fieldErrors: state && !state.ok ? state.fieldErrors : undefined })}
    </form>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
