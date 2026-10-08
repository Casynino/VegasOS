import type { ReactNode } from "react";
import { LOCALE_META } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { Toaster } from "@/components/ui/sonner";
import { clientCatalog, getLocale } from "@/i18n/server";

/** Printed bills and slips: in the signed-in staff member's own language (outside the staff shell, so mounted here). */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const catalog = await clientCatalog(locale, ["staff"]);
  return (
    <I18nProvider locale={locale} catalog={catalog}>
      <div lang={LOCALE_META[locale].html} className="contents">{children}</div>
      <Toaster richColors position="top-center" />
    </I18nProvider>
  );
}
