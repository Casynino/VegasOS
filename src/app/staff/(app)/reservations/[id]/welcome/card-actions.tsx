"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toJpeg } from "html-to-image";
import { FileDown, ImageDown, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jpegFromDataUrl, jpegToPdf } from "@/lib/jpeg-pdf";
import { useT } from "@/i18n/client";

const CARD_WIDTH = 640;
const options = { pixelRatio: 2, cacheBust: true, width: CARD_WIDTH, style: { margin: "0" } };

function save(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Print the welcome card, or download it as an image (for WhatsApp) or a PDF. */
export function WelcomeCardActions({ fileName }: { fileName: string }) {
  const t = useT();
  const [busy, setBusy] = useState<"image" | "pdf" | null>(null);
  const card = () => document.getElementById("welcome-card");

  async function image() {
    const node = card();
    if (!node) return;
    setBusy("image");
    try {
      // JPEG keeps the file small for WhatsApp (a PNG of the photo is several MB).
      save(await toJpeg(node, { ...options, quality: 0.92, backgroundColor: "#0b1026" }), `${fileName}.jpg`);
    } catch {
      toast.error(t("Could not make the image — try again."));
    } finally { setBusy(null); }
  }

  async function pdf() {
    const node = card();
    if (!node) return;
    setBusy("pdf");
    try {
      const url = await toJpeg(node, { ...options, quality: 0.94, backgroundColor: "#ffffff" });
      const page = await jpegFromDataUrl(url);
      const blob = new Blob([jpegToPdf(page.jpeg, page.w, page.h)], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      save(href, `${fileName}.pdf`);
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      toast.error(t("Could not make the PDF — try again."));
    } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => window.print()}><Printer />{t("Print")}</Button>
      <Button variant="outline" disabled={!!busy} onClick={image}>{busy === "image" ? <Loader2 className="animate-spin" /> : <ImageDown />}{t("Download image")}</Button>
      <Button disabled={!!busy} onClick={pdf}>{busy === "pdf" ? <Loader2 className="animate-spin" /> : <FileDown />}{t("Download PDF")}</Button>
    </div>
  );
}
