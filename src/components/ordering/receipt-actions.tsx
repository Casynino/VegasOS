"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { toJpeg } from "html-to-image";
import { FileDown, ImageDown, Loader2, Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jpegFromDataUrl, jpegsToPdf } from "@/lib/jpeg-pdf";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

const snap = { pixelRatio: 2.5, cacheBust: true, backgroundColor: "#ffffff", style: { margin: "0", boxShadow: "none" } };
function save(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

const noSubscribe = () => () => {};
const shareSupported = () => {
  try { return !!navigator.canShare?.({ files: [new File([""], "bill.jpg", { type: "image/jpeg" })] }); } catch { return false; }
};

/** Print the receipt (#bill), download it as a PDF or a picture — or share it (WhatsApp…) from a phone. */
export function ReceiptActions({ fileName, onDone }: { fileName: string; onDone?: (how: "print" | "pdf" | "image" | "share") => void }) {
  const t = useT();
  const [busy, setBusy] = useState<"pdf" | "image" | "share" | null>(null);
  // Sharing a picture works on phones (and some computers): offered only where the device can do it.
  const canShare = useSyncExternalStore(noSubscribe, shareSupported, () => false);
  const node = () => document.getElementById("bill");
  const pdf = async () => {
    const el = node(); if (!el) return;
    setBusy("pdf");
    try {
      const page = await jpegFromDataUrl(await toJpeg(el, { ...snap, quality: 0.95 }));
      const href = URL.createObjectURL(new Blob([jpegsToPdf([page], 420)], { type: "application/pdf" }));
      save(href, `${fileName}.pdf`);
      onDone?.("pdf");
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch { toast.error(t("Could not make the PDF — try again.")); } finally { setBusy(null); }
  };
  const image = async () => {
    const el = node(); if (!el) return;
    setBusy("image");
    try { save(await toJpeg(el, { ...snap, quality: 0.92 }), `${fileName}.jpg`); onDone?.("image"); } catch { toast.error(t("Could not make the image — try again.")); } finally { setBusy(null); }
  };
  const share = async () => {
    const el = node(); if (!el) return;
    setBusy("share");
    try {
      const blob = await (await fetch(await toJpeg(el, { ...snap, quality: 0.92 }))).blob();
      await navigator.share({ files: [new File([blob], `${fileName}.jpg`, { type: "image/jpeg" })], title: fileName });
      onDone?.("share");
    } catch (e) { if ((e as Error)?.name !== "AbortError") toast.error(t("Could not share the bill — download it instead.")); } finally { setBusy(null); }
  };
  return (
    <div className={cn("grid gap-2 font-sans print:hidden", canShare ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
      <Button onClick={() => { onDone?.("print"); window.print(); }} className="bg-[#1b1611] text-white hover:bg-black"><Printer />{t("Print")}</Button>
      <Button variant="outline" disabled={!!busy} onClick={pdf} className="border-black/15 bg-white text-black hover:bg-white/80">{busy === "pdf" ? <Loader2 className="animate-spin" /> : <FileDown />}PDF</Button>
      <Button variant="outline" disabled={!!busy} onClick={image} className="border-black/15 bg-white text-black hover:bg-white/80">{busy === "image" ? <Loader2 className="animate-spin" /> : <ImageDown />}{t("Image")}</Button>
      {canShare && <Button variant="outline" disabled={!!busy} onClick={share} className="border-black/15 bg-white text-black hover:bg-white/80">{busy === "share" ? <Loader2 className="animate-spin" /> : <Share2 />}{t("Share")}</Button>}
    </div>
  );
}
