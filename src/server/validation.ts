import "server-only";
import type { z } from "zod";
import { AppError } from "./errors";
import { msg } from "@/i18n/msg";

const ZOD_DEFAULT = /^(Too (big|small): expected|Invalid (input|option|string|type|value|format|key|element|union)\b|Unrecognized key)/;

/** Parse FormData/object with a zod schema; throw AppError with field errors. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const data = input instanceof FormData ? formDataToObject(input) : input;
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      // Zod's own wording ("Too big: expected string to have <=40 characters") is never shown to people.
      fieldErrors[key] ??= ZOD_DEFAULT.test(issue.message) ? msg("Something in the form is not right — please check it and try again.") : issue.message;
    }
    throw new AppError(Object.values(fieldErrors)[0] ?? msg("Please check the form."), "VALIDATION", fieldErrors);
  }
  return result.data;
}

function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      const list = (out[k] as unknown[] | undefined) ?? [];
      list.push(value);
      out[k] = list;
    } else {
      out[key] = value;
    }
  }
  return out;
}
