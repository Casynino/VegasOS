"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Loader2, Upload } from "lucide-react";
import { useT } from "@/i18n/client";
import { GUIDE_FILE, GUIDE_FOLDER, GUIDE_MAX_BYTES } from "@/lib/guide-books";
import { recordGuideUploadsAction } from "./actions";

/**
 * The Developer's way to put the books in: choose the PDFs from guides/pdf on his computer (one, or all twelve at once). Each goes straight
 * from the browser to the file storage (they are too big for the server), under the name it already has; the same name replaces the old book.
 */
export function UploadBooks() {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const run = async (files: File[]) => {
    setFailed(false);
    const bad = files.find((f) => !GUIDE_FILE.test(f.name) || f.size > GUIDE_MAX_BYTES);
    if (bad) { setFailed(true); setStatus(t("{name} is not a guide book PDF (Vegas-Guide-07-Manager.pdf) or it is bigger than 60 MB.", { name: bad.name })); return; }
    setBusy(true);
    const done: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setStatus(t("Uploading {n} of {m}: {name}…", { n: i + 1, m: files.length, name: file.name }));
        await upload(`${GUIDE_FOLDER}${file.name}`, file, { access: "public", handleUploadUrl: "/api/guides/upload", contentType: "application/pdf", multipart: file.size > 8 * 1024 * 1024 });
        // Written to the audit trail right after each book is in, so a closed tab never leaves a replaced book unrecorded.
        const noted = await recordGuideUploadsAction([file.name]);
        if (!noted.ok) throw new Error(noted.error);
        done.push(file.name);
      }
      setStatus(t.plural(done.length, "{n} guide book uploaded.", "{n} guide books uploaded.", { n: done.length }));
      startTransition(() => router.refresh());
    } catch {
      setFailed(true);
      setStatus(done.length > 0 ? t("Stopped after {n} books. Choose the rest again.", { n: done.length }) : t("The upload did not work. Try again."));
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button" disabled={busy} onClick={() => input.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}{t("Upload books")}</button>
        <p className="text-sm text-muted-foreground">{t("Choose the PDFs from the guides/pdf folder. The same name replaces the old book.")}</p>
      </div>
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { const files = [...(e.target.files ?? [])]; if (files.length) void run(files); }} />
      {status && <p role="status" className={`mt-3 text-sm ${failed ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>{status}</p>}
    </div>
  );
}
