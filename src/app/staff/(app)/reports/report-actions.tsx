"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toCanvas } from "html-to-image";
import { FileDown, FileSpreadsheet, Loader2, Printer, Share2 } from "lucide-react";
import { jpegFromDataUrl, jpegsToPdf } from "@/lib/jpeg-pdf";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

const A4 = 842 / 595;
/** The width the document is drawn at for the PDF — the same on a phone and a computer. */
const PAPER_PX = 980;

function save(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

/**
 * Print the report (A4), save it as a PDF (pages cut between parts and table rows, never
 * through a line), download the CSV, or share the summary (WhatsApp or the phone's share sheet).
 */
export function ReportActions({ fileName, csv, share, target = "report" }: {
  fileName: string; csv?: string;
  /** The summary to share (WhatsApp / the phone's share sheet) — no Share button without it. */
  share?: string;
  /** The id of the document on the page that becomes the PDF. */
  target?: string;
}) {
  const [busy, setBusy] = useState(false);
  const t = useT();

  const pdf = async () => {
    const el = document.getElementById(target);
    if (!el) return;
    setBusy(true);
    const old = { width: el.style.width, maxWidth: el.style.maxWidth };
    try {
      // Draw it at paper width (tables open, nothing scrolled away), then cut into A4 pages.
      el.style.width = `${PAPER_PX}px`; el.style.maxWidth = "none";
      el.dataset.paper = "true"; // the letterhead and sign-off lines, as on paper
      el.querySelectorAll<HTMLElement>(".report-scroll").forEach((s) => { s.style.overflow = "visible"; });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const top = el.getBoundingClientRect().top;
      const breaks = [...el.querySelectorAll<HTMLElement>("[data-break]")].map((x) => x.getBoundingClientRect().top - top).filter((y) => y > 0);
      const ratio = 2;
      const canvas = await toCanvas(el, { pixelRatio: ratio, backgroundColor: "#ffffff", cacheBust: true, style: { borderRadius: "0", boxShadow: "none", margin: "0" } });
      const pageH = Math.floor(canvas.width * A4);
      const cuts = breaks.map((y) => Math.round(y * ratio)).sort((a, b) => a - b);
      const pages: Awaited<ReturnType<typeof jpegFromDataUrl>>[] = [];
      for (let y = 0; y < canvas.height;) {
        let end = Math.min(canvas.height, y + pageH);
        if (end < canvas.height) {
          const cut = cuts.filter((c) => c > y + pageH * 0.45 && c <= end).at(-1);
          if (cut) end = cut;
        }
        const page = document.createElement("canvas");
        page.width = canvas.width; page.height = pageH;
        const ctx = page.getContext("2d")!;
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, page.width, page.height);
        ctx.drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
        pages.push(await jpegFromDataUrl(page.toDataURL("image/jpeg", 0.9)));
        y = end;
      }
      const href = URL.createObjectURL(new Blob([jpegsToPdf(pages, 595)], { type: "application/pdf" }));
      save(href, `${fileName}.pdf`);
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      toast.error(t("Could not make the PDF — try Print and choose “Save as PDF”."));
    } finally {
      el.style.width = old.width; el.style.maxWidth = old.maxWidth;
      delete el.dataset.paper;
      el.querySelectorAll<HTMLElement>(".report-scroll").forEach((s) => { s.style.overflow = ""; });
      setBusy(false);
    }
  };

  const shareIt = async () => {
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: fileName, text: share }); return; } catch { /* closed — fall through to nothing */ return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(share ?? "")}`, "_blank", "noopener");
  };

  const btn = "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-card px-3 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60 sm:flex-none";
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto print:hidden">
      <button type="button" onClick={() => window.print()} className={cn(btn, "border-transparent bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] hover:brightness-105")}><Printer className="size-3.5" />{t("Print")}</button>
      <button type="button" onClick={pdf} disabled={busy} className={btn}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}PDF</button>
      {csv && <a href={csv} className={btn}><FileSpreadsheet className="size-3.5" />{t("Excel")}<span className="hidden sm:inline"> (CSV)</span></a>}
      {share && <button type="button" onClick={shareIt} className={btn}><Share2 className="size-3.5" />{t("Share")}</button>}
    </div>
  );
}
