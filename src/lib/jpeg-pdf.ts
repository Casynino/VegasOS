/**
 * A PDF made of JPEG pictures, one per page (page size follows each picture) —
 * e.g. the welcome card, or every room's QR card. Written by hand: no PDF library.
 */
export function jpegsToPdf(pages: { jpeg: Uint8Array; w: number; h: number }[], pageWidthPt = 432) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: Uint8Array | string) => { const b = typeof p === "string" ? enc.encode(p) : p; parts.push(b); length += b.length; };
  const obj = (n: number, body: string) => { offsets[n] = length; push(`${n} 0 obj\n${body}\nendobj\n`); };
  // Objects: 1 catalog, 2 pages, then per page: page, image, content.
  const pageObj = (i: number) => 3 + i * 3;
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const n = pageObj(i);
    const pw = pageWidthPt, ph = Math.round((pageWidthPt * p.h) / p.w);
    const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    offsets[n + 1] = length;
    push(`${n + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push("\nendstream\nendobj\n");
    obj(n + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${Array.from({ length: count - 1 }, (_, k) => `${String(offsets[k + 1]).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** One picture, one page. */
export function jpegToPdf(jpeg: Uint8Array, w: number, h: number) {
  return jpegsToPdf([{ jpeg, w, h }]);
}

/** A JPEG data URL → its bytes and size (in the browser). */
export async function jpegFromDataUrl(url: string) {
  const jpeg = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
  const img = new Image();
  img.src = url;
  await img.decode();
  return { jpeg, w: img.naturalWidth, h: img.naturalHeight };
}
