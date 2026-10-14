// Makes the guide books:  node guides/tools/build.mjs [book…]   (no name = every book in guides/books)
// A book is laid out as one web page (guides/html/<book>.html) and printed to A4 by Chrome (guides/pdf/<file>.pdf).
// It is printed twice: the first time to learn on which page each chapter starts, the second time with those numbers.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import QRCode from "qrcode";
import { launch } from "./chrome.mjs";
import { fmt, esc, shot, render, missing, table, rules } from "./kit.mjs";
import { CONTACT, JOURNEY, L as WORDS, LINKS, chapterLabel, mapSvg } from "./shared.mjs";

const ROOT = path.join(process.cwd(), "guides");
const asset = (f) => pathToFileURL(path.join(ROOT, "assets", f)).href;
const PDFTOTEXT = fs.existsSync("/opt/homebrew/bin/pdftotext") ? "/opt/homebrew/bin/pdftotext" : "pdftotext";

function page(book, pages = {}) {
  const lang = book.lang ?? "en";
  const L = WORDS[lang];
  const accent = book.accent ?? "#b3862a", soft = book.soft ?? "#f6efdd";
  let chapterNo = 0, taskNo = 0;
  const c = { L, lang, next: () => `${chapterNo}.${++taskNo}` };
  const head = (title, lead) => {
    chapterNo++; taskNo = 0;
    return `<header class="ch-head"><div class="ch-no">${chapterNo}</div><div><div class="ch-kicker">${chapterLabel(lang, chapterNo)}</div><h1>${fmt(title)}</h1></div>${lead ? `<p class="lead">${fmt(lead)}</p>` : ""}</header>`;
  };

  const chapters = [];
  if (book.map !== false) {
    chapters.push({
      title: L.together, lead: book.togetherLead ?? L.togetherLead,
      body: () => `<div class="map">${mapSvg(lang, book.dept, accent, soft)}</div>
        <ul class="links">${LINKS.map((l, i) => `<li class="${l.who.includes(book.dept) ? "me" : ""}"><span class="n">${i + 1}</span><span><b>${esc(l[lang][0])}</b> ${esc(l[lang][1])}</span></li>`).join("")}</ul>
        <h3 class="h">${L.journeyTitle}</h3>
        <div class="journey">${JOURNEY.map((j) => `<div class="${j.who.includes(book.dept) ? "me" : ""}"><b>${esc(j[lang][0])}</b>${esc(j[lang][1])}<span>${esc(j[lang][2])}</span></div>`).join("")}</div>
        ${render(c, book.place)}`,
    });
  }
  for (const ch of book.chapters) chapters.push({ title: ch.title, lead: ch.lead, body: () => render(c, ch.blocks) });
  if (book.rules || book.problems) {
    chapters.push({
      title: book.lastTitle ?? L.last, lead: book.lastLead ?? L.lastLead,
      body: () => `${book.rules ? `<h3 class="h">${L.rulesTitle}</h3>${rules(book.rules)}` : ""}${book.problems ? `<h3 class="h"${book.rules?.length >= 8 && book.problems.length >= 8 ? ' style="break-before:page;margin-top:0"' : ""}>${L.problemsTitle}</h3>${table(L.problemsHead, book.problems)}` : ""}${render(c, book.after)}`,
    });
  }
  book.titles = chapters.map((ch) => ch.title);
  const body = chapters.map((ch) => `<section class="chapter">${head(ch.title, ch.lead)}${ch.body()}</section>`).join("\n");

  const hero = (book.cover?.shots ?? []).map((id) => `<div class="hero ${book.cover.frame === "phone" ? "phone" : ""}">${shot(id, { wrap: "", frame: book.cover.frame, label: book.cover.label })}</div>`).join("");
  const cover = `<section class="cover ${book.title.length > 16 && lang !== "zh" ? "long" : ""}">
    ${hero}<div class="shade"></div><div class="frame"></div>
    <div class="top"><img src="${asset("logo.png")}" alt=""><div class="hotel">${L.hotel}</div><div class="kind">${fmt(book.kind ?? L.guide)}</div></div>
    <div class="title"><div class="kicker"><i></i>${fmt(book.kicker ?? L.guide)}</div><h1>${book.title.split(" | ").map(esc).join("<br>")}</h1><p class="sub">${fmt(book.sub)}</p></div>
    <div class="foot"><div><b>${L.hotel}</b><br>${L.edition}</div><div class="by">${L.by} <b>${CONTACT.name}</b><br>WhatsApp ${CONTACT.tz} · ${CONTACT.email}</div></div>
  </section>`;

  const front = `<section class="front"><h1>${L.contents}</h1><p class="lead">${fmt(book.lead)}</p>
    <ol class="toc">${chapters.map((ch, i) => `<li><span class="no">${i + 1}</span><span class="t"><b>${fmt(ch.title)}</b>${ch.lead ? `<span>${fmt(ch.lead.split(/(?<=[.。!?？！])\s*/)[0])}</span>` : ""}</span><span class="pg">${pages[i + 1] ?? ""}</span></li>`).join("")}</ol>
    <div class="read">${L.read.map(([t, d], i) => `<div><b>${i === 0 ? '<span class="n">1</span>' : ""}${esc(t)}</b>${fmt(d)}</div>`).join("")}</div>
  </section>`;

  const S = L.support;
  const support = `<section class="support"><div class="frame"></div><div class="in">
    <div class="kicker">${S.kicker}</div><h1>${S.title}</h1><p class="lead">${fmt(S.lead)}</p>
    <div class="who"><div class="rows">${S.rows.map(([l, v, d]) => `<div class="row"><div class="l">${l}</div><div class="v">${v}<small>${d}</small></div></div>`).join("")}</div>
      <div><div class="qr">${book.qr}</div><div class="qrcap">${S.qr}</div></div></div>
    <div class="send"><h3>${S.sendTitle}</h3><ol>${S.send.map((t) => `<li>${t}</li>`).join("")}</ol></div>
    <p class="lead" style="margin-top:9mm;font-size:9.6pt">${fmt(S.first)}</p>
    <div class="end"><img src="${asset("logo.png")}" alt=""><div>${fmt(S.end).replace("&lt;br&gt;", "<br>")}</div></div>
  </div></section>`;

  const foot = `font: 500 7pt "Inter", "PingFang SC", sans-serif; color: #8a91a0; letter-spacing: 0.02em;`;
  return `<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><title>${esc(book.name)}</title>
<link rel="stylesheet" href="../tools/book.css">
<style>
:root { --accent: ${accent}; --accent-soft: ${soft}; }
@page { size: 210mm 297mm; margin: 16mm 15mm 19mm 15mm;
  @bottom-left { content: "${book.name.replace(/"/g, "")}  ·  ${L.hotel}"; ${foot} padding-bottom: 7mm; }
  @bottom-center { content: "${L.help}"; ${foot} padding-bottom: 7mm; }
  @bottom-right { content: counter(page); font: 650 8pt "Inter", sans-serif; color: #141926; padding-bottom: 7mm; } }
@page cover { margin: 0; @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
</style></head><body class="${lang}">
${cover}
${front}
${body}
${support}
</body></html>`;
}

async function print(tab, html, out) {
  await tab.goto(pathToFileURL(html).href, { settle: 500 });
  const { stream } = await tab.cmd("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, transferMode: "ReturnAsStream" });
  const parts = [];
  for (;;) {
    const r = await tab.cmd("IO.read", { handle: stream, size: 1 << 20 });
    parts.push(Buffer.from(r.data, r.base64Encoded ? "base64" : "utf8"));
    if (r.eof) break;
  }
  await tab.cmd("IO.close", { handle: stream });
  fs.writeFileSync(out, Buffer.concat(parts));
}

const want = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = fs.readdirSync(path.join(ROOT, "books")).filter((f) => f.endsWith(".mjs") && !f.startsWith("_")).map((f) => f.replace(/\.mjs$/, ""))
  .filter((id) => !want.length || want.includes(id));
if (!files.length) { console.error("No such book."); process.exit(1); }
for (const d of ["html", "pdf"]) fs.mkdirSync(path.join(ROOT, d), { recursive: true });

const chrome = await launch({ port: 9900 + Math.floor(Math.random() * 500) });
try {
  const tab = await (await chrome.context()).page();
  for (const id of files) {
    const book = (await import(pathToFileURL(path.join(ROOT, "books", id + ".mjs")).href)).default;
    book.qr = await QRCode.toString(CONTACT.tzLink, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0c1019", light: "#ffffff" } });
    const html = path.join(ROOT, "html", id + ".html");
    const pdf = path.join(ROOT, "pdf", book.file);
    missing.clear();
    fs.writeFileSync(html, page(book));
    await print(tab, html, pdf);
    // where does each chapter start?
    const text = execFileSync(PDFTOTEXT, [pdf, "-"], { maxBuffer: 1 << 28 }).toString().split("\f").map((t) => t.replace(/\s+/g, ""));
    const pages = {};
    const flat = (t) => t.replace(/\*\*|\[\[!?|\]\]|\s+/g, "").toUpperCase();
    let from = 2; // after the cover and the contents page
    for (const [i, title] of book.titles.entries()) {
      const marks = [flat(chapterLabel(book.lang ?? "en", i + 1)), flat(title)];
      const at = text.findIndex((t, k) => k >= from && marks.every((m) => t.toUpperCase().includes(m)));
      if (at < 0) continue;
      pages[i + 1] = at + 1; from = at + 1;
    }
    fs.writeFileSync(html, page(book, pages));
    await print(tab, html, pdf);
    const count = execFileSync(PDFTOTEXT, [pdf, "-"], { maxBuffer: 1 << 28 }).toString().split("\f").length - 1;
    console.log(`${book.file}  ${count} pages  ${(fs.statSync(pdf).size / 1e6).toFixed(1)} MB  chapters on ${Object.values(pages).join(", ")}${missing.size ? `\n  MISSING PICTURES: ${[...missing].join(", ")}` : ""}`);
  }
} finally { await chrome.close(); }
