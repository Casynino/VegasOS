"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { LoginFormView, type AccountType } from "./login-form-view";

/**
 * The sign-in form: a choice of door (Staff account / Developer account) above the email and password. The choice is sent
 * as `accountType`; the server checks the account against it and never trusts the choice as proof of anything.
 */
export function LoginForm({ initialType = "STAFF" }: { initialType?: AccountType }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, undefined);
  return <LoginFormView state={state} pending={pending} action={action} initialType={initialType} />;
}
