import type { Metadata } from "next";
import { BookOpen, FileText } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { GUIDE_CATALOG, GUIDE_VIEW_RIGHTS, guideInfo } from "@/lib/guide-books";
import { guideStorageReady, storedGuides } from "@/server/services/guide-books";
import { ShareBook } from "./share-book";
import { UploadBooks } from "./upload-books";
import { RemoveBook } from "./remove-book";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Guide books") };
}
export const dynamic = "force-dynamic";

const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("en", { maximumFractionDigits: 1 })} MB`;

/**
 * GUIDE BOOKS (owner, 2026-10-18): the twelve department guide books for the Boss, the MD, the Manager and the Developer to download and
 * share with their staff. The Developer also puts the PDFs in (and takes one out). The page is read-only for everyone else.
 */
export default async function GuideBooksPage() {
  const user = await requirePagePermission(...GUIDE_VIEW_RIGHTS);
  const t = await getT();
  const isDeveloper = user.actorType === "DEVELOPER" && !user.workAs && user.permissions.has("developer.access");
  const ready = guideStorageReady();
  const stored = await storedGuides();
  const byFile = new Map((stored ?? []).map((g) => [g.file, g]));
  const others = (stored ?? []).filter((g) => !GUIDE_CATALOG.some((b) => b.file === g.file));
  const rows = [
    ...GUIDE_CATALOG.map((b) => ({ info: b, file: byFile.get(b.file) ?? null })),
    ...others.map((g) => ({ info: guideInfo(g.file)!, file: g })),
  ];
  const have = rows.filter((r) => r.file).length;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400" aria-hidden><BookOpen className="size-6" /></span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("Guide books")}</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{t("One book for each department. Download a book or share it with the staff it is for.")}</p>
        </div>
      </header>

      {isDeveloper && ready && <UploadBooks />}
      {!ready && <p role="status" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">{t("The file storage is not set up on this computer, so the books cannot be listed here. They are on the live site.")}</p>}
      {ready && stored === null && <p role="status" className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{t("This could not be read just now.")}</p>}

      {stored !== null && have === 0 && (
        <p role="status" className="rounded-2xl bg-muted/40 px-4 py-4 text-sm text-muted-foreground">{isDeveloper ? t("No guide book is here yet. Use Upload books to put them in.") : t("The guide books are being put here. Please come back soon.")}</p>
      )}

      <ul className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ info, file }) => (
          <li key={info.file} className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground/70" aria-hidden><FileText className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold leading-snug"><span className="mr-2 tabular-nums text-muted-foreground">{info.number}</span>{t(info.title)}</h2>
                {info.audience && <p className="mt-0.5 text-sm text-muted-foreground">{t(info.audience)}</p>}
                {file && <p className="mt-1 text-xs text-muted-foreground">PDF · {size(file.size)} · {t.dateTime(file.uploadedAt)}</p>}
              </div>
            </div>
            {file
              ? <ShareBook file={file.file} title={t(info.title)} url={file.url} downloadUrl={file.downloadUrl} />
              : stored !== null && <p className="text-sm text-muted-foreground">{t("Not uploaded yet.")}</p>}
            {isDeveloper && file && <div className="border-t border-border/60 pt-2"><RemoveBook file={file.file} title={t(info.title)} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
