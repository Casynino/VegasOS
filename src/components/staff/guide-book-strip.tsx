import Link from "next/link";
import { BookOpenText, Download, Printer } from "lucide-react";
import { GUIDE_CATALOG, type GuideAccess } from "@/lib/guide-books";
import type { T } from "@/i18n/translate";

/**
 * The slim strip at the top of each person's own dashboard (owner, 2026-10-19): their department's guide book(s), one tap to download, one to
 * open and print. The Boss, the MD and the Manager (every book) get one line that opens the Guide books page. `uploaded` = the books that are in
 * the file storage (null = not known: the links are shown and the download says so if the book is missing).
 */
export function GuideBookStrip({ t, access, uploaded }: { t: T; access: GuideAccess; uploaded: readonly string[] | null }) {
  if (access.files.length === 0) return null;
  const link = "inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm";
  if (access.all) {
    return (
      <section aria-label={t("Guide books")} className="mb-4 flex items-center gap-x-4 rounded-2xl border border-border/70 bg-card px-4 py-2.5 print:hidden">
        <span className="inline-flex items-center gap-2 text-sm font-semibold"><BookOpenText className="size-4 text-muted-foreground" aria-hidden />{t("Guide books")}</span>
        <span className="hidden min-w-0 flex-1 text-sm text-muted-foreground sm:block">{t("One book for each department — download, print or share them.")}</span>
        <Link href="/staff/guides" className={`${link} ml-auto`}>{t("Open")}</Link>
      </section>
    );
  }
  const books = GUIDE_CATALOG.filter((b) => access.files.includes(b.file));
  return (
    <section aria-label={books.length === 1 ? t("Your guide book") : t("Your guide books")} className="mb-4 flex flex-col gap-1.5 rounded-2xl border border-border/70 bg-card px-4 py-2.5 sm:flex-row sm:items-start sm:gap-x-6 print:hidden">
      <span className="inline-flex shrink-0 items-center gap-2 py-0.5 text-sm font-semibold"><BookOpenText className="size-4 text-muted-foreground" aria-hidden />{books.length === 1 ? t("Your guide book") : t("Your guide books")}</span>
      <ul className="w-full min-w-0 space-y-1.5 sm:flex-1">
        {books.map((b) => {
          const here = uploaded === null || uploaded.includes(b.file);
          return (
            <li key={b.file} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t(b.title)}</span>
              {here ? (
                <span className="inline-flex items-center gap-4">
                  <a href={`/api/guides/${b.file}`} className={link}><Download className="size-4" aria-hidden />{t("Download")}</a>
                  <a href={`/api/guides/${b.file}?open=1`} target="_blank" rel="noopener noreferrer" className={link}><Printer className="size-4" aria-hidden />{t("Open and print")}</a>
                </span>
              ) : <span className="text-sm text-muted-foreground">{t("Coming soon.")}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
