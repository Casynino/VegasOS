import { msg } from "@/i18n/msg";

/**
 * What an error means and what to do about it, in plain words (owner, 2026-10-18). The Developer console shows an error as "what it
 * means · what to do · who" — never as a raw code alone. The mapping is small and goes by the error's NAME and CODE (and, for the few
 * things that have neither, its first line); anything it does not know is said honestly as "Unknown". The words are English keys: the
 * page shows them through t() (zh-CN: src/i18n/catalog/zh-CN/staff/system-events.ts).
 *
 * Every "what to do" names WHO does it: the Developer (code), or the system owner (a key, a plan, a provider's account).
 */
export type ErrorKind = "Database" | "Validation" | "Permission" | "Network" | "Code" | "Unknown";

export interface ErrorHint {
  kind: ErrorKind;
  what: string;
  todo: string;
}

const DB_BUSY: ErrorHint = {
  kind: "Database",
  what: msg("The database was slow, busy or could not be reached for a moment."),
  todo: msg("Developer: check the database provider's status (Neon) and the connection limits. A single one is harmless; if it repeats, look at Speed & size."),
};

/** Prisma / Postgres codes that mean something specific. */
const BY_CODE: Record<string, ErrorHint> = {
  P2002: { kind: "Database", what: msg("A duplicate was refused: the database would not save the same record twice, usually a double click or two requests at once."), todo: msg("Developer: nothing if it happens once. If it repeats, the action does not guard against a second press: add a duplicate check.") },
  "23505": { kind: "Database", what: msg("A duplicate was refused: the database would not save the same record twice, usually a double click or two requests at once."), todo: msg("Developer: nothing if it happens once. If it repeats, the action does not guard against a second press: add a duplicate check.") },
  P2003: { kind: "Database", what: msg("A record points to something that does not exist (any more)."), todo: msg("Developer: find the action named below. It saves a link to a record that was removed or never made.") },
  "23503": { kind: "Database", what: msg("A record points to something that does not exist (any more)."), todo: msg("Developer: find the action named below. It saves a link to a record that was removed or never made.") },
  P2025: { kind: "Database", what: msg("The record an action wanted to change was already gone or changed by someone else."), todo: msg("Developer: nothing if it happens once. If it repeats, the action should check the record first and answer with a clear message.") },
  P2024: DB_BUSY,
  P2028: DB_BUSY,
  P1001: DB_BUSY,
  P1002: DB_BUSY,
  P1008: DB_BUSY,
  P1017: DB_BUSY,
  "57P01": DB_BUSY,
  "53300": DB_BUSY,
  P2034: { kind: "Database", what: msg("Two actions changed the same records at the same time and the database stopped one."), todo: msg("Developer: nothing if it happens once. If it repeats, shorten that action's transaction or let it try again.") },
  "40001": { kind: "Database", what: msg("Two actions changed the same records at the same time and the database stopped one."), todo: msg("Developer: nothing if it happens once. If it repeats, shorten that action's transaction or let it try again.") },
  "40P01": { kind: "Database", what: msg("Two actions waited for each other and the database stopped one (a deadlock)."), todo: msg("Developer: make those actions take their records in the same order.") },
  P2021: { kind: "Database", what: msg("The database is behind the code: a table the code needs is missing."), todo: msg("Developer: a migration did not run. Run the migrations on this database (npm run db:deploy) and check the build log.") },
  P2022: { kind: "Database", what: msg("The database is behind the code: a column the code needs is missing."), todo: msg("Developer: a migration did not run. Run the migrations on this database (npm run db:deploy) and check the build log.") },
  "42P01": { kind: "Database", what: msg("The database is behind the code: a table the code needs is missing."), todo: msg("Developer: a migration did not run. Run the migrations on this database (npm run db:deploy) and check the build log.") },
  "42703": { kind: "Database", what: msg("The database is behind the code: a column the code needs is missing."), todo: msg("Developer: a migration did not run. Run the migrations on this database (npm run db:deploy) and check the build log.") },
  "23P01": { kind: "Database", what: msg("The database refused an overlap (for example the same room booked twice)."), todo: msg("Developer: nothing if the action answered with a clear message. If not, make it check availability first.") },
  P2000: { kind: "Validation", what: msg("A value was too long for the field it was saved in."), todo: msg("Developer: limit that field in the form, the same as the database's limit.") },
  P2011: { kind: "Validation", what: msg("A required value was missing when a record was saved."), todo: msg("Developer: the action saved a record without a value the database requires. Fix the action named below.") },
  P2012: { kind: "Validation", what: msg("A required value was missing when a record was saved."), todo: msg("Developer: the action saved a record without a value the database requires. Fix the action named below.") },
  "23502": { kind: "Validation", what: msg("A required value was missing when a record was saved."), todo: msg("Developer: the action saved a record without a value the database requires. Fix the action named below.") },
  "23514": { kind: "Validation", what: msg("A value broke a rule the database keeps (a check)."), todo: msg("Developer: the action saved a value the database refuses. Check the value before it is saved.") },
  ECONNREFUSED: { kind: "Network", what: msg("A service could not be reached: the connection was refused."), todo: msg("Developer: find out which service it was (see where it happened). If it is the database or a provider, check its status page and its keys in the settings.") },
  ECONNRESET: { kind: "Network", what: msg("A connection was cut in the middle."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status.") },
  ETIMEDOUT: { kind: "Network", what: msg("A service did not answer in time."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status and the time limits in the code.") },
  ENOTFOUND: { kind: "Network", what: msg("A service's address could not be found."), todo: msg("Developer: an address in the settings or keys is wrong, or the provider's address changed. System owner: check the keys on the hosting.") },
  EACCES: { kind: "Permission", what: msg("The server was not allowed to do something (a file or a port)."), todo: msg("Developer: the server tried to write where it may not. Use the database or the temporary folder instead.") },
  UND_ERR_CONNECT_TIMEOUT: { kind: "Network", what: msg("A service did not answer in time."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status and the time limits in the code.") },
  UND_ERR_SOCKET: { kind: "Network", what: msg("A connection was cut in the middle."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status.") },
  EPIPE: { kind: "Network", what: msg("A connection was cut in the middle."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status.") },
  UND_ERR_HEADERS_TIMEOUT: { kind: "Network", what: msg("A service did not answer in time."), todo: msgTimeout() },
  UND_ERR_BODY_TIMEOUT: { kind: "Network", what: msg("A service did not answer in time."), todo: msgTimeout() },
  EAI_AGAIN: { kind: "Network", what: msg("A service's address could not be looked up right now."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status and the network of the hosting.") },
  ENETUNREACH: { kind: "Network", what: msg("A service could not be reached: there was no route to it."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status.") },
  EHOSTUNREACH: { kind: "Network", what: msg("A service could not be reached: there was no route to it."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status.") },
};

function msgTimeout(): string {
  return msg("Developer: nothing if it happens once. If it repeats, check the provider's status and the time limits in the code.");
}

const CODE_BUG: ErrorHint = {
  kind: "Code",
  what: msg("A bug in the code: something was missing or in a shape the code did not expect."),
  todo: msg("Developer: open the file and line listed below and fix it. This is not a mistake of the person using the system."),
};

const BY_NAME: Record<string, ErrorHint> = {
  TypeError: CODE_BUG,
  ReferenceError: CODE_BUG,
  RangeError: CODE_BUG,
  SyntaxError: { ...CODE_BUG, what: msg("A bug in the code, or text that could not be read (for example broken data from outside).") },
  EvalError: CODE_BUG,
  ZodError: { kind: "Validation", what: msg("Data in the wrong shape reached the server: a form or a call sent something the code did not expect."), todo: msg("Developer: the form and the server disagree about the fields. Fix the one that is wrong (see where it happened).") },
  PrismaClientValidationError: { kind: "Validation", what: msg("The code asked the database for something in the wrong shape."), todo: msg("Developer: a query or a save has a wrong or missing field. Fix the code at the place listed below.") },
  PrismaClientInitializationError: { ...DB_BUSY, what: msg("The database could not be reached or opened."), todo: msg("Developer: check the database address in the settings and the database provider's status (Neon).") },
  PrismaClientRustPanicError: { kind: "Database", what: msg("The database driver crashed."), todo: msg("Developer: restart by redeploying. If it repeats, update the database driver.") },
  ForbiddenError: { kind: "Permission", what: msg("Something was refused because of rights."), todo: msg("Developer: a page or an action asked for a right the person does not have. Check that the button is hidden for them.") },
  UnauthorizedError: { kind: "Permission", what: msg("Something was refused because nobody was signed in."), todo: msg("Developer: nothing if it happens once. If it repeats, check the sign-in and session settings.") },
  TimeoutError: { kind: "Network", what: msg("A service did not answer in time."), todo: msg("Developer: nothing if it happens once. If it repeats, check the provider's status and the time limits in the code.") },
  AbortError: { kind: "Network", what: msg("A request was cancelled before it finished."), todo: msg("Developer: nothing, unless it repeats a lot.") },
};

/**
 * By the first line. The first three are asked BEFORE the error's name: a failed network call is a TypeError ("fetch failed"), and the
 * generic "TypeError means a bug in the code" must not hide that it was only the network.
 */
const BY_TEXT_FIRST: { test: RegExp; hint: ErrorHint }[] = [
  { test: /failed to find server action/i, hint: { kind: "Unknown", what: msg("A browser had an old page open while the system was updated and asked for something that no longer exists."), todo: msg("Developer: nothing, it clears when the page is reloaded. If it keeps coming long after an update, check the last release.") } },
  { test: /fetch failed|failed to fetch|network error|socket hang up|getaddrinfo|econnrefused|econnreset|etimedout|enotfound/i, hint: { kind: "Network", what: msg("A service could not be reached (the database, nTZS, the WhatsApp provider or another)."), todo: msg("Developer: find out which service it was (see where it happened) and check its status and the keys in the settings. System owner: check the provider's account and billing.") } },
  { test: /can't reach database|connection (terminated|timeout|refused)|too many (clients|connections)|timed out fetching a new connection|pool timeout/i, hint: DB_BUSY },
];

/** By the first line, for errors that have neither a useful name nor a code. */
const BY_TEXT: { test: RegExp; hint: ErrorHint }[] = [
  { test: /unauthori[sz]ed|forbidden|not allowed|permission denied|access denied/i, hint: { kind: "Permission", what: msg("Something was refused because of rights."), todo: msg("Developer: a page or an action asked for something the person may not do. Check the rights of that role and that the button is hidden for them.") } },
  { test: /invalid|validation|expected .* received|required|must be/i, hint: { kind: "Validation", what: msg("Data in the wrong shape reached the server."), todo: msg("Developer: the form and the server disagree about a field. Fix the one that is wrong (see where it happened).") } },
  { test: /cannot read propert|undefined is not|is not a function|is not defined|is not iterable|null is not/i, hint: CODE_BUG },
];

const UNKNOWN: ErrorHint = {
  kind: "Unknown",
  what: msg("An error the system does not recognise."),
  todo: msg("Developer: open the place it happened and the lines listed below. If it is only seen once, watch whether it comes back."),
};

/** The hint for an error: by its code, then its name, then its first line; "Unknown" when none of them is known. */
export function errorHint(input: { name?: string | null; code?: string | null; message?: string | null }): ErrorHint {
  const code = input.code ? String(input.code) : "";
  const byCode = code && Object.hasOwn(BY_CODE, code) ? BY_CODE[code] : null;
  if (byCode) return byCode;
  const line = input.message ?? "";
  for (const { test, hint } of BY_TEXT_FIRST) if (test.test(line)) return hint;
  const name = input.name ?? "";
  const byName = name && Object.hasOwn(BY_NAME, name) ? BY_NAME[name] : null;
  if (byName) return byName;
  for (const { test, hint } of BY_TEXT) if (test.test(line)) return hint;
  return UNKNOWN;
}

/** The kinds, in the order the page lists them. */
export const ERROR_KINDS: readonly ErrorKind[] = [msg("Database"), msg("Validation"), msg("Permission"), msg("Network"), msg("Code"), msg("Unknown")] as const;
