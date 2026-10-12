import { toCanvas } from "html-to-image";
import { jpegFromDataUrl, jpegsToPdf } from "@/lib/jpeg-pdf";

/**
 * The printed list as an A4 PDF, page by page — the same sheet the browser prints.
 * A page never ends inside a row, a part's heading never ends a page, the table's headings are drawn again at the
 * top of every later page, and each page carries the list's name, its date and "Page x of y" at the foot.
 */

const A4 = { short: 595, long: 842 };

export async function saveListPdf(el: HTMLElement, o: { landscape: boolean; footer: string; pageOf: (page: number, pages: number) => string; fileName: string }) {
  const scroll = el.closest<HTMLElement>(".list-scroll");
  const was = { width: el.style.width, min: el.style.minWidth, max: el.style.maxWidth, pad: el.style.padding, zoom: el.style.zoom, scroll: scroll?.style.overflow ?? "" };
  try {
    // Lay the sheet out at paper width whatever the screen is.
    el.style.width = o.landscape ? "1080px" : "760px";
    el.style.minWidth = "0";
    el.style.maxWidth = "none";
    el.style.padding = "0";
    // The screen shows the sheet enlarged; the PDF is the sheet at its paper size.
    el.style.zoom = "1";
    if (scroll) scroll.style.overflow = "visible";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const box = el.getBoundingClientRect();
    const top = (n: Element) => n.getBoundingClientRect().top - box.top;
    const head = el.querySelector("thead");
    const table = el.querySelector("table");
    // Safe places to end a page: the top of every row and block — but not between a part's heading and its first row.
    const breaks = [...el.querySelectorAll("[data-break]")]
      .filter((n) => !(n.previousElementSibling as HTMLElement | null)?.dataset.heading)
      .map(top);
    const headBox = head ? { y: top(head), h: head.getBoundingClientRect().height } : null;
    const tableEnd = table ? top(table) + table.getBoundingClientRect().height : 0;

    const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true, style: { borderRadius: "0", boxShadow: "none", margin: "0" } });
    const k = canvas.width / box.width;
    const cuts = breaks.map((y) => Math.round(y * k)).sort((a, b) => a - b);
    const hd = headBox ? { y: Math.round(headBox.y * k), h: Math.ceil(headBox.h * k) } : null;
    const bodyEnd = Math.round(tableEnd * k);

    const m = Math.round(canvas.width * 0.045);
    const pageW = canvas.width + m * 2;
    const pageH = Math.round(pageW * (o.landscape ? A4.short / A4.long : A4.long / A4.short));
    const foot = Math.round(m * 1.4);
    const room = pageH - m - foot;

    // Where each page starts and ends on the long picture.
    const slices: { y: number; h: number; head: boolean }[] = [];
    for (let y = 0; y < canvas.height - 1;) {
      // Later pages that continue the table start with its headings again.
      const again = !!hd && slices.length > 0 && y >= hd.y + hd.h && y < bodyEnd - 1;
      const fits = room - (again ? hd!.h : 0);
      let end = canvas.height;
      if (y + fits < canvas.height) {
        const safe = cuts.filter((c) => c > y && c <= y + fits);
        end = safe.length ? safe[safe.length - 1] : y + fits;
      }
      slices.push({ y, h: end - y, head: again });
      y = end;
    }

    const pages: Awaited<ReturnType<typeof jpegFromDataUrl>>[] = [];
    for (const [i, s] of slices.entries()) {
      const page = document.createElement("canvas");
      page.width = pageW;
      page.height = pageH;
      const ctx = page.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageW, pageH);
      let at = m;
      if (s.head && hd) { ctx.drawImage(canvas, 0, hd.y, canvas.width, hd.h, m, at, canvas.width, hd.h); at += hd.h; }
      ctx.drawImage(canvas, 0, s.y, canvas.width, s.h, m, at, canvas.width, s.h);
      ctx.fillStyle = "#111111";
      ctx.font = `${Math.round((pageW * 8) / (o.landscape ? A4.long : A4.short))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = "middle";
      const line = pageH - Math.round(foot / 2);
      ctx.textAlign = "left";
      ctx.fillText(o.footer, m, line);
      ctx.textAlign = "right";
      ctx.fillText(o.pageOf(i + 1, slices.length), pageW - m, line);
      pages.push(await jpegFromDataUrl(page.toDataURL("image/jpeg", 0.9)));
    }

    const href = URL.createObjectURL(new Blob([jpegsToPdf(pages, o.landscape ? A4.long : A4.short)], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = `${o.fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } finally {
    el.style.width = was.width;
    el.style.minWidth = was.min;
    el.style.maxWidth = was.max;
    el.style.padding = was.pad;
    el.style.zoom = was.zoom;
    if (scroll) scroll.style.overflow = was.scroll;
  }
}
