"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { LoginFormView } from "./login-form-view";

/** The sign-in form: an email and a password. The same for everyone — the server decides, from the account, where the person lands. */
export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, undefined);
  return <LoginFormView state={state} pending={pending} action={action} />;
}
