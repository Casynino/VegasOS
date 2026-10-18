"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, Loader2, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";

type Book = { file: string; number: string; title: string; audience: string; size: number | null; uploaded: boolean };
type Data = { all: boolean; listed: boolean; books: Book[] };

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("en", { maximumFractionDigits: 1 })} MB`;

/**
 * THE "GUIDE BOOK" BUTTON (owner, 2026-10-19): a small button in the page's own row of small buttons; pressing it opens a pop-up right there with the
 * person's own book(s) — one book, or a list when there are several — each to download, view or print. The children are the button's look (the page's own
 * pill style); the books are asked for when it opens (/api/guides), so a page never waits for the file storage.
 */
export function GuideBookTrigger({ className, children }: { className: string; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/guides", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Data);
    } catch { setFailed(true); }
  };
  const show = () => { setOpen(true); void load(); };
  const base = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
  const outline = `${base} border-border bg-background text-foreground hover:bg-muted`;
  const solid = `${base} border-transparent bg-foreground text-background hover:bg-foreground/90`;
  return (
    <>
      <button type="button" onClick={show} className={className}>{children}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{data && data.books.length === 1 ? t("Guide book") : t("Guide books")}</DialogTitle>
            <DialogDescription>{t("Download it to keep, or open it to read and print.")}</DialogDescription>
          </DialogHeader>
          {failed ? (
            <p role="status" className="text-sm text-rose-600 dark:text-rose-400">{t("This could not be read just now.")}</p>
          ) : !data ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{t("Loading…")}</p>
          ) : data.books.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">{t("There is no guide book for your role yet.")}</p>
          ) : (
            <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {data.books.map((b) => (
                <li key={b.file} className="space-y-2.5 rounded-xl border border-border/70 bg-card p-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug"><span className="mr-2 tabular-nums text-muted-foreground">{b.number}</span>{b.title}</p>
                    {b.audience && <p className="mt-0.5 text-xs text-muted-foreground">{b.audience}</p>}
                    {b.uploaded && b.size !== null && <p className="mt-0.5 text-xs text-muted-foreground">PDF · {mb(b.size)}</p>}
                  </div>
                  {b.uploaded || !data.listed ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/api/guides/${b.file}`} className={solid}><Download className="size-4" aria-hidden />{t("Download")}</a>
                      <a href={`/api/guides/${b.file}?open=1`} target="_blank" rel="noopener noreferrer" className={outline}><Printer className="size-4" aria-hidden />{t("Open and print")}</a>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">{t("Not uploaded yet.")}</p>}
                </li>
              ))}
            </ul>
          )}
          {data?.all && <Link href="/staff/guides" onClick={() => setOpen(false)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">{t("Share the books from the Guide books page")}</Link>}
        </DialogContent>
      </Dialog>
    </>
  );
}
