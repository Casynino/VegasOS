/**
 * Marks English text for translation where it is DEFINED but shown somewhere else — labels in lookup maps, zod and
 * AppError messages, success messages. It returns the text unchanged (the English is the key); the place that SHOWS
 * it translates it (`t(label)`, or the server-action boundary for messages). `npm run i18n:check` finds these.
 */
export const msg = <S extends string>(text: S): S => text;

export type MsgVars = Record<string, string | number | null | undefined>;
/** A message with values in it, kept translatable: its English text, plus the key and values to translate it later. */
export interface Localized {
  readonly key: string;
  readonly vars: MsgVars;
  readonly text: string;
  toString(): string;
}

/**
 * Like msg(), for text with values: `new AppError(msgf("Room {room} is not ready.", { room }))`. The error's message
 * stays the English with the values filled in (logs, tests); the person who sees it gets it in their language.
 */
export function msgf(key: string, vars: MsgVars): Localized {
  const text = key.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  return { key, vars, text, toString: () => text };
}
