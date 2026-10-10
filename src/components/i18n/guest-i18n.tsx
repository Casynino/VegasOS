import type { ReactNode } from "react";
import { LOCALE_META } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { Toaster } from "@/components/ui/sonner";
import { clientCatalog, guestLocale } from "@/i18n/server";
import type { Bundle } from "@/i18n/catalog";

/**
 * The language for a guest page (QR menus, stay link, order tracking, payment, thank-you, Hotel QR) and for the
 * report links the boss opens: the visitor's own choice, else a Chinese phone → Chinese, else English.
 */
export async function GuestI18n({ children, bundle = "public" }: { children: ReactNode; bundle?: Bundle }) {
  const locale = await guestLocale();
  const catalog = await clientCatalog(locale, [bundle]);
  return (
    <I18nProvider locale={locale} catalog={catalog}>
      <div lang={LOCALE_META[locale].html} className="contents">{children}</div>
      <Toaster richColors position="top-center" />
    </I18nProvider>
  );
}
