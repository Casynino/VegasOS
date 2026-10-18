"use client";

import { useState } from "react";
import { Check, Download, Link2, Share2 } from "lucide-react";
import { useT } from "@/i18n/client";

/**
 * Download and Share for ONE book. Share sends the PDF itself through the phone's own share sheet (WhatsApp, email…) when the phone can;
 * otherwise it shares the link, and the WhatsApp and Copy-link buttons are always there. The link is the book's address in the hotel's file
 * storage: whoever has it can open the book, so it is for the staff the Boss means it for.
 */
export function ShareBook({ file, title, url, downloadUrl }: { file: string; title: string; url: string; downloadUrl: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");
  const message = t("{title}: the Vegas Luxury Hotel guide book", { title });
  const share = async () => {
    setState("busy");
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (typeof nav.share === "function") {
        // Get the PDF first; only a failure to GET it falls back to the link. Closing the share sheet is not a failure (it ends here).
        let pdf: File | null = null;
        try {
          const res = await fetch(downloadUrl);
          if (res.ok) pdf = new File([await res.blob()], file, { type: "application/pdf" });
        } catch { /* no file: share the link instead */ }
        if (pdf && nav.canShare?.({ files: [pdf] })) { await nav.share({ files: [pdf], title, text: message }); setState("idle"); return; }
        await nav.share({ title, text: message, url });
        setState("idle");
        return;
      }
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch (error) {
      setState((error as { name?: string })?.name === "AbortError" ? "idle" : "failed");
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setState("copied"); setTimeout(() => setState("idle"), 2500); } catch { setState("failed"); }
  };
  const base = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
  const button = `${base} border-border bg-background text-foreground hover:bg-muted`;
  const solid = `${base} border-transparent bg-foreground text-background hover:bg-foreground/90`; // the main button: its own colours, nothing inherited to fight with
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={downloadUrl} download={file} className={solid}><Download className="size-4" aria-hidden />{t("Download")}</a>
      <button type="button" onClick={share} disabled={state === "busy"} className={button}><Share2 className="size-4" aria-hidden />{state === "busy" ? t("Preparing…") : t("Share")}</button>
      <a href={`https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`} target="_blank" rel="noopener noreferrer" className={button}>{t("WhatsApp")}</a>
      <button type="button" onClick={copy} className={button}>{state === "copied" ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Link2 className="size-4" aria-hidden />}{state === "copied" ? t("Link copied") : t("Copy link")}</button>
      {state === "failed" && <span role="status" className="text-xs text-rose-600 dark:text-rose-400">{t("It could not be shared. Use Download.")}</span>}
    </div>
  );
}
