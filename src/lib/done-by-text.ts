import type { T } from "@/i18n/translate";
import type { DeveloperMark } from "@/server/services/developer-marks";

/** The words of the tag: "Done by Developer", or "Done by Developer · as Neema" when it is known who he acted as. */
export function doneByText(t: T, mark: Pick<DeveloperMark, "as"> | null | undefined): string | null {
  if (!mark) return null;
  return mark.as?.name ? t("Done by Developer · as {name}", { name: mark.as.name }) : t("Done by Developer");
}
