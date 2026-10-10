"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { LOCALE_META, type Locale } from "./config";
import { englishT, makeT, type Catalog, type T } from "./translate";

const I18nContext = createContext<T>(englishT);

/**
 * Gives the browser side its person's language. Placed by each area's layout (website, guest pages, staff app) with
 * only that area's strings; anything outside a provider is English. Switching language re-renders with the new
 * strings — component state (a cart, a half-filled form) stays.
 */
export function I18nProvider({ locale, catalog, children }: { locale: Locale; catalog: Catalog | null; children: ReactNode }) {
  const t = useMemo(() => makeT(locale, catalog), [locale, catalog]);
  useEffect(() => {
    document.documentElement.lang = LOCALE_META[locale].html;
  }, [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

/** The translator in a client component: `const t = useT(); t("Save")`. */
export const useT = () => useContext(I18nContext);
export const useLocale = () => useContext(I18nContext).locale;
